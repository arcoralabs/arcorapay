/**
 * Arcora relayer daemon (v0.8). Drains `relayer_queue`, runs `kit.swap` on
 * Arc, and tells `ArcFXGatewayV8.settleInvoice` to deliver the merchant
 * payout. On swap failure, refunds the customer off-chain and records the
 * failure on the gateway so the indexer/webhook flow surfaces it.
 *
 * Flow per row (one at a time — keeps the hot wallet's nonce sane on a
 * single VPS without coordination machinery):
 *   pending  ─▶ processing  ─┐
 *                            ├─ Permit2.permitTransferFrom (payer → relayer)
 *                            ├─ kit.swap (payIn → payoutToken)  ──fail──▶ refund
 *                            ├─ ERC20.approve(gateway, gross)
 *                            ├─ gateway.settleInvoice
 *                            └─▶ settled
 *   refund:    ERC20.transfer(payer, amountIn)
 *              ├─ gateway.recordPayerRefund
 *              └─▶ refunded
 *
 * Cross-chain v2 (Q1, feature-flagged via CROSSCHAIN_ENABLED): the same
 * daemon also drains `crosschain_payments` (CCTP burn on a source chain →
 * IRIS attestation → receiveMessage mint on Arc → optional kit.swap →
 * gateway.settleInvoice). The state machine itself is pure and lives in
 * crosschain-worker.ts; this file only wires the real chain/DB deps.
 *
 * Env: see .env.example.
 */

import {
  createPublicClient, createWalletClient, http, parseAbi, parseEventLogs,
  type Address, type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { AppKit } from "@circle-fin/app-kit";
import { createViemAdapterFromPrivateKey } from "@circle-fin/adapter-viem-v2";
import pg from "pg";
import {
  chainById, parseChainRegistryJson,
  type ChainRegistry, type CrosschainState,
} from "@arcora/crosschain-core";
import { fetchPrivateKeyFromVault } from "./vault-signer";
import { buildOpsPoolConfig, describeDbTls, assertSecureDbTls } from "./db";
import { buildGatewayAllowlist, resolveGateway } from "./gateway-allowlist";
import { fetchIrisAttestation, receiveMessageCall } from "./cctp";
import { buildSettleArgs, tokenSymbolForArcAddress } from "./arc-settlement";
import { processCrosschainPayment } from "./crosschain-worker";
import type { CrosschainPaymentRow, CrosschainWorkerDeps } from "./crosschain-types";

const RPC           = need("ARC_TESTNET_RPC");
const PG_URL        = need("POSTGRES_URL_NON_POOLING");
const KIT_KEY       = need("KIT_KEY");
const GATEWAY       = need("GATEWAY_ADDRESS").toLowerCase() as Address;
const PERMIT2       = (process.env.PERMIT2_ADDRESS ?? "0x000000000022D473030F116dDEE9F6B43aC78BA3").toLowerCase() as Address;
const FEE_RECIPIENT = need("CUSTOM_FEE_RECIPIENT") as Address;
const CUSTOM_FEE_BPS = Number(process.env.CUSTOM_FEE_BPS ?? "100"); // 1% default
const SLIPPAGE_BPS  = Number(process.env.SLIPPAGE_BPS ?? "100");    // 1% default
const TICK_MS       = Number(process.env.RELAYER_TICK_MS ?? "5000");
const MAX_ATTEMPTS  = Number(process.env.RELAYER_MAX_ATTEMPTS ?? "3");
// Audit Ops-L-11 (2026-05-31): bound EVERY receipt wait. An un-timed
// waitForTransactionReceipt inside processOne could hang past systemd's
// TimeoutStopSec on SIGTERM → SIGKILL mid-flight, leaving the row to a later
// lease reclaim. 30s matches the resume path; on timeout the await throws and
// the persist-before-send checkpoint makes the row recoverable.
const RECEIPT_TIMEOUT_MS = 30_000;
// A row stuck in `processing` beyond this window is treated as crashed mid-
// flight (prev daemon died after permit2 pull / between swap + settle, etc.)
// and reclaimed by the next claimNext call. Set generously above worst-case
// kit.swap + settle latency. Audit P2 #5, 2026-05-03.
const LEASE_SECONDS = Number(process.env.RELAYER_LEASE_SECONDS ?? "480"); // 8 min

// ── Cross-chain v2 (Q1) env ─────────────────────────────────────────
// Feature-flagged: the daemon only claims `crosschain_payments` rows when
// CROSSCHAIN_ENABLED=true. The chain registry and IRIS URL then become
// required and are validated at boot (fail fast on malformed config —
// parseChainRegistryJson throws on unknown chains / zero addresses).
const CROSSCHAIN_ENABLED = process.env.CROSSCHAIN_ENABLED === "true";
const crosschainRegistry: ChainRegistry | null = CROSSCHAIN_ENABLED
  ? parseChainRegistryJson(need("CROSSCHAIN_CHAIN_CONFIG_JSON"))
  : null;
const CCTP_IRIS_API_URL = CROSSCHAIN_ENABLED ? need("CCTP_IRIS_API_URL") : "";
const CROSSCHAIN_MAX_ATTEMPTS  = Number(process.env.CROSSCHAIN_MAX_ATTEMPTS ?? "12");
const CROSSCHAIN_RETRY_BASE_MS = Number(process.env.CROSSCHAIN_RETRY_BASE_MS ?? "15000");
const CROSSCHAIN_RETRY_MAX_MS  = Number(process.env.CROSSCHAIN_RETRY_MAX_MS ?? "900000");
// Wall-clock bound on attestation polling (measured from burn_submitted_at):
// past this, a still-missing IRIS attestation goes terminal bridge_failed
// instead of polling forever. Default 2 hours.
const CROSSCHAIN_ATTESTATION_DEADLINE_MS = Number(process.env.CROSSCHAIN_ATTESTATION_DEADLINE_MS ?? "7200000");

function need(k: string): string {
  const v = process.env[k];
  if (!v) throw new Error(`missing env ${k}`);
  return v;
}

// ── ABIs ─────────────────────────────────────────────────────────────

const ERC20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function transfer(address,uint256) returns (bool)",
]);

const GATEWAY_ABI = parseAbi([
  "function settleInvoice(bytes32 globalId, address payer, address payInToken, uint256 amountIn, uint256 grossPayout, bytes32 swapTxHash)",
  "function recordPayerRefund(bytes32 globalId, address payer, address payInToken, uint256 amount, bytes32 reasonHash)",
]);

// Permit2 SignatureTransfer surface. The `witness` flavour lets us bind the
// signed message to the trade context (invoice id + relayer address).
const PERMIT2_ABI = parseAbi([
  "struct TokenPermissions { address token; uint256 amount; }",
  "struct PermitTransferFrom { TokenPermissions permitted; uint256 nonce; uint256 deadline; }",
  "struct SignatureTransferDetails { address to; uint256 requestedAmount; }",
  "function permitWitnessTransferFrom(PermitTransferFrom permit, SignatureTransferDetails transferDetails, address owner, bytes32 witness, string witnessTypeString, bytes signature)",
]);

// V10 (audit M1 partial): relayer key fetched once from Vault KV-v2 at boot.
// AppRole-authenticated, audit-logged, encrypted at rest. The same fetched
// key feeds (a) the gateway-signing LocalAccount and (b) the AppKit swap
// adapter, so the raw key never lives on disk in any env file.
//
// Single fetch: previously called fetchPrivateKeyFromVault + vaultSigner
// (which itself called fetchPrivateKeyFromVault) — two AppRole logins +
// two KV reads on boot, with a small race window if secret_id rotated
// between them. Now one fetch, both consumers derive from the same key.
// Audit #17 (2026-05-12).
const _vaultOpts = {
  vaultUrl: need("VAULT_URL"),
  roleId:   need("VAULT_ROLE_ID"),
  secretId: need("VAULT_SECRET_ID"),
  kvPath:   need("VAULT_KV_PATH"),
  kvField:  process.env.VAULT_KV_FIELD ?? "privateKey",
};
const _relayerKey = await fetchPrivateKeyFromVault(_vaultOpts);
const account = privateKeyToAccount(_relayerKey);
const RELAYER_ADDR = account.address;
// Env-skew fail-fast: the app's prepare route pins each cross-chain intent's
// CCTP mintRecipient to NEXT_PUBLIC_RELAYER_ADDRESS. If that var is mirrored
// onto this box and disagrees with the Vault-derived key (key rotation, stale
// env), every payment would burn on the source chain and then fail at bridge
// receive — so refuse to boot. Guard is skipped when the var is unset; the
// crosschain-v2-demo runbook covers the parity requirement.
const _appRelayerAddr = process.env.NEXT_PUBLIC_RELAYER_ADDRESS;
if (_appRelayerAddr && _appRelayerAddr.toLowerCase() !== RELAYER_ADDR.toLowerCase()) {
  throw new Error(
    `relayer address mismatch: vault key ${RELAYER_ADDR} vs NEXT_PUBLIC_RELAYER_ADDRESS ${_appRelayerAddr}; cross-chain intents would fail at bridge receive`,
  );
}
const wallet = createWalletClient({ account, transport: http(RPC) });
const adapter = createViemAdapterFromPrivateKey({ privateKey: _relayerKey });

const chain = createPublicClient({ transport: http(RPC) });
const kit   = new AppKit();

// AFG-011: verify-full TLS (pinned Supabase CA) — no disabled cert checks.
const _poolCfg = buildOpsPoolConfig(PG_URL);
assertSecureDbTls(_poolCfg);
console.log(`[relayer] DB TLS: ${describeDbTls(_poolCfg)}`);
const pool = new pg.Pool(_poolCfg);

// AFG-010: constrain the row gateway (approve spender + settle target) to an
// allowlist so a tampered DB value can't redirect funds.
const GATEWAY_ALLOWLIST = buildGatewayAllowlist(GATEWAY, process.env.GATEWAY_ALLOWLIST);

// ── Queue row shape ─────────────────────────────────────────────────

type QueueRow = {
  id: string;
  invoice_id: string;
  payer: string;
  pay_in_token: string;
  amount_in: string;
  payout_token: string;
  amount_out_min: string;
  permit2_data: {
    nonce: string;
    deadline: string;
    witness: Hex;
    witnessTypeString: string;
  };
  permit2_signature: Hex;
  attempts: number;
  gateway_address: string | null;
  // Stage progress markers — populated by persistPermit2Tx / persistSwapTx
  // / markSettled / markRefunded as each step succeeds. claimNext re-reads
  // them on reclaim so processOne knows where to resume. Audit P1 #3.
  permit2_tx_hash: string | null;
  swap_tx_hash:    string | null;
  /** Exact kit.swap amountOut in base units of payoutToken — persisted
   *  alongside swap_tx_hash so resume can use the real gross instead of
   *  conservatively settling at the merchant floor. Audit residual 2026-05-05. */
  swap_amount_out: string | null;
  settle_tx_hash:  string | null;
  refund_tx_hash:  string | null;
  /** Audit 2026-05-24 H-2: surfaced for resumeRefund so the re-issued
   *  recordPayerRefund can preserve the original swap-failure reason
   *  instead of stamping "resumed" as the only on-chain trail. */
  last_error:      string | null;
};

/** Plan-9 dispatch — every queue row carries the gateway address its invoice
 *  was created against. settleInvoice + recordPayerRefund get routed there.
 *  Legacy rows without gateway_address fall back to the daemon's default. */
function gatewayFor(row: QueueRow): Address {
  // AFG-010: reject any row whose gateway_address isn't allowlisted instead of
  // trusting the mutable DB value as the approve spender / settle target.
  return resolveGateway(row.gateway_address, GATEWAY, GATEWAY_ALLOWLIST);
}

// Token symbol resolution for kit.swap (App Kit takes ticker symbols, not
// addresses) lives in arc-settlement.ts — tokenSymbolForArcAddress — so the
// Arc address → ticker map exists in exactly one place. Throws on unknown.

// ── DB helpers ──────────────────────────────────────────────────────

/** SQL fragment for atomic claim that also surfaces invoices.gateway_address
 *  for per-row dispatch (Plan 9). The CTE + `for update skip locked` keeps
 *  two relayer instances from grabbing the same row even though we run one
 *  daemon today. */
function claimSql(where: string): string {
  return `with claimed as (
            update relayer_queue
               set status     = 'processing',
                   attempts   = attempts + 1,
                   updated_at = now()
             where id = (
               select id from relayer_queue
                where ${where}
                order by next_attempt
                limit 1
                for update skip locked
             )
             returning id, invoice_id, payer, pay_in_token, amount_in, payout_token,
                       amount_out_min, permit2_data, permit2_signature, attempts,
                       permit2_tx_hash, swap_tx_hash, swap_amount_out,
                       settle_tx_hash, refund_tx_hash, last_error
          )
          select c.*, i.gateway_address
            from claimed c
            left join invoices i on i.id = c.invoice_id`;
}

async function claimNext(): Promise<QueueRow | null> {
  // Audit P2 #5 (2026-05-03) — two-step claim:
  //
  //   1. Reclaim any row stuck in `processing` beyond the lease window. A
  //      daemon crash after Permit2 pull but before mark-settled/refunded
  //      leaves a row invisible to plain pending claims; this rescues those
  //      so customer funds (potentially in the relayer hot wallet) can
  //      finish flowing.
  //   2. Otherwise, claim a normal pending row.
  //
  // The lease reclaim still increments `attempts`, so chronic stuck rows
  // hit MAX_ATTEMPTS and surface for operator investigation rather than
  // silently retrying forever.
  const reclaim = await pool.query<QueueRow>(
    claimSql(`status = 'processing' and updated_at < now() - ($1 || ' seconds')::interval`),
    [String(LEASE_SECONDS)],
  );
  if (reclaim.rows[0]) {
    const row = reclaim.rows[0];
    console.warn(
      `relayer.lease_reclaimed id=${row.id} invoice=${row.invoice_id} attempts=${row.attempts} ` +
      `lease_seconds=${LEASE_SECONDS} — previous daemon crashed mid-flight; resuming.`,
    );
    return row;
  }

  const pending = await pool.query<QueueRow>(
    claimSql(`status = 'pending' and next_attempt <= now()`),
  );
  return pending.rows[0] ?? null;
}

// Stage-aware persistors — write each tx hash as soon as the chain receipt
// returns so a daemon crash mid-flight is recoverable. Audit P1 #3.
async function persistPermit2Tx(id: string, tx: Hex): Promise<void> {
  await pool.query(
    `update relayer_queue set permit2_tx_hash = $2, updated_at = now() where id = $1`,
    [id, tx],
  );
}

async function persistSwapTx(id: string, tx: Hex, amountOutBaseUnits: bigint): Promise<void> {
  await pool.query(
    `update relayer_queue
        set swap_tx_hash = $2, swap_amount_out = $3, updated_at = now()
      where id = $1`,
    [id, tx, amountOutBaseUnits.toString()],
  );
}

async function persistSettleTx(id: string, tx: Hex): Promise<void> {
  await pool.query(
    `update relayer_queue set settle_tx_hash = $2, updated_at = now() where id = $1`,
    [id, tx],
  );
}

// Audit 2026-05-24 H-2: mirror the settle/permit2 persist-before-await
// pattern on the refund path. The customer-facing ERC-20 transfer goes out
// before the gateway's recordPayerRefund call — if the daemon crashed
// between transfer broadcast and the receipt wait, the tx hash was lost,
// the reclaim re-entered refundPayer, the balance check failed (funds
// already gone), and the customer ended up paid on-chain while the DB
// row said `failed` and the gateway never saw recordPayerRefund. We now
// persist refund_tx_hash the moment writeContract returns and resume
// from this checkpoint via resumeRefund() instead of restarting the
// refund flow.
async function persistRefundTx(id: string, tx: Hex): Promise<void> {
  await pool.query(
    `update relayer_queue set refund_tx_hash = $2, updated_at = now() where id = $1`,
    [id, tx],
  );
}

async function markSettled(id: string, swapTx: Hex, settleTx: Hex): Promise<void> {
  // Same-token rows never wrote swap_tx_hash; backfill it here for
  // observability. swap_tx_hash on cross-token rows was already persisted
  // by persistSwapTx; coalesce to keep that value if non-null.
  await pool.query(
    `update relayer_queue
        set status = 'settled',
            swap_tx_hash   = coalesce(swap_tx_hash, $2),
            settle_tx_hash = $3,
            updated_at = now()
      where id = $1`,
    [id, swapTx, settleTx],
  );
}

async function markRefunded(id: string, refundTx: Hex, lastError: string): Promise<void> {
  await pool.query(
    `update relayer_queue
        set status = 'refunded', refund_tx_hash = $2, last_error = $3,
            updated_at = now()
      where id = $1`,
    [id, refundTx, lastError],
  );
}

async function markFailed(id: string, lastError: string): Promise<void> {
  // Terminal: we couldn't even get the customer's pay-in back. Operator
  // intervention required — replay.ts can re-queue once the upstream
  // problem is fixed.
  await pool.query(
    `update relayer_queue
        set status = 'failed', last_error = $2, updated_at = now()
      where id = $1`,
    [id, lastError],
  );
}

async function reschedule(id: string, lastError: string, attempts: number): Promise<void> {
  if (attempts >= MAX_ATTEMPTS) {
    await markFailed(id, `max attempts (${MAX_ATTEMPTS}) reached: ${lastError}`);
    return;
  }
  const backoffSec = Math.min(2 ** attempts * 30, 30 * 60); // 30s, 60s, 120s, …, capped at 30 min
  await pool.query(
    `update relayer_queue
        set status = 'pending', last_error = $2,
            next_attempt = now() + ($3 || ' seconds')::interval,
            updated_at = now()
      where id = $1`,
    [id, lastError, backoffSec],
  );
}

// ── On-chain step helpers ───────────────────────────────────────────

async function pullViaPermit2(
  row: QueueRow,
  onBroadcast: (tx: Hex) => Promise<void>,
): Promise<Hex> {
  // Permit2 permitWitnessTransferFrom: pulls amountIn of payInToken from
  // payer → relayer wallet, atomically validating the customer's signature
  // and the witness binding.
  //
  // Audit residual P2 (2026-05-05): persist permit2_tx_hash via
  // onBroadcast() the moment writeContract returns, before awaiting the
  // receipt — same pattern as callSettle. A daemon crash in the
  // receipt-await window used to lose the hash; reclaim then re-issued
  // permitWitnessTransferFrom against an already-spent nonce → InvalidNonce
  // → markFailed/manual-reconciliation, with the customer's payIn already
  // in the relayer wallet.
  const tx = await wallet.writeContract({
    chain: undefined,
    address: PERMIT2 as Address,
    abi: PERMIT2_ABI,
    functionName: "permitWitnessTransferFrom",
    args: [
      {
        permitted: {
          token:  row.pay_in_token as Address,
          amount: BigInt(row.amount_in),
        },
        nonce:    BigInt(row.permit2_data.nonce),
        deadline: BigInt(row.permit2_data.deadline),
      },
      {
        to:              RELAYER_ADDR,
        requestedAmount: BigInt(row.amount_in),
      },
      row.payer as Address,
      row.permit2_data.witness,
      row.permit2_data.witnessTypeString,
      row.permit2_signature,
    ],
  });
  await onBroadcast(tx);
  await chain.waitForTransactionReceipt({ hash: tx, timeout: RECEIPT_TIMEOUT_MS });
  return tx;
}

async function runSwap(row: QueueRow): Promise<{ amountOut: string; txHash: Hex }> {
  const tokenIn  = tokenSymbolForArcAddress(row.pay_in_token);
  const tokenOut = tokenSymbolForArcAddress(row.payout_token);
  const amountInHumanReadable = humanizeAmount(row.amount_in, tokenIn);

  const result = await kit.swap({
    from: { adapter, chain: "Arc_Testnet" as const },
    tokenIn, tokenOut,
    amountIn: amountInHumanReadable,
    config: {
      kitKey:      KIT_KEY,
      slippageBps: SLIPPAGE_BPS,
      customFee:   { percentageBps: CUSTOM_FEE_BPS, recipientAddress: FEE_RECIPIENT },
    },
  });
  const r = result as { amountOut?: string; txHash: Hex };
  if (!r.amountOut) throw new Error("kit.swap returned no amountOut");
  return { amountOut: r.amountOut, txHash: r.txHash };
}

async function callSettle(
  row: QueueRow,
  grossPayoutBaseUnits: bigint,
  swapTxHash: Hex,
  onBroadcast: (tx: Hex) => Promise<void>,
): Promise<Hex> {
  // The relayer holds payoutToken in its hot wallet now. Approve the gateway
  // to pull `grossPayoutBaseUnits`, then call settleInvoice.
  //
  // Audit residual P2 (2026-05-05): persist the settle tx hash via
  // onBroadcast() the moment writeContract returns, before awaiting the
  // receipt. Crashing during the receipt-await window used to lose the
  // hash; reclaim would then re-call settleInvoice → V9 reverts as already
  // paid → markFailed even though the on-chain payment landed. Approve
  // doesn't get the same treatment because it's idempotent (raises
  // allowance to the same value); resuming can re-issue it safely.
  const targetGateway = gatewayFor(row);

  const approveTx = await wallet.writeContract({
    chain: undefined,
    address: row.payout_token as Address,
    abi: ERC20,
    functionName: "approve",
    args: [targetGateway, grossPayoutBaseUnits],
  });
  await chain.waitForTransactionReceipt({ hash: approveTx, timeout: RECEIPT_TIMEOUT_MS });

  const tx = await wallet.writeContract({
    chain: undefined,
    address: targetGateway,
    abi: GATEWAY_ABI,
    functionName: "settleInvoice",
    args: [
      row.invoice_id as Hex,
      row.payer as Address,
      row.pay_in_token as Address,
      BigInt(row.amount_in),
      grossPayoutBaseUnits,
      swapTxHash,
    ],
  });
  await onBroadcast(tx);
  await chain.waitForTransactionReceipt({ hash: tx, timeout: RECEIPT_TIMEOUT_MS });
  return tx;
}

/** Build the bytes32 reasonHash field from a free-text reason string.
 *  Audit #34: slice the encoded byte array, not the character string —
 *  multi-byte UTF-8 chars would otherwise overflow bytes32. */
function reasonToHash(reason: string): Hex {
  const reasonBytes = new TextEncoder().encode(reason).slice(0, 32);
  return ("0x" +
    Array.from(reasonBytes)
      .map(b => b.toString(16).padStart(2, "0")).join("")
      .padEnd(64, "0")
  ) as Hex;
}

async function refundPayer(
  row: QueueRow,
  reason: string,
  onTransferBroadcast: (tx: Hex) => Promise<void>,
): Promise<Hex> {
  // Best-effort: if the relayer wallet never received the pay-in (Permit2
  // call itself failed before any token movement), there's nothing to send
  // back — just record the failure.
  const balance = await chain.readContract({
    address: row.pay_in_token as Address,
    abi: ERC20,
    functionName: "balanceOf",
    args: [RELAYER_ADDR],
  });
  const owedBack = BigInt(row.amount_in);
  if (balance < owedBack) {
    throw new Error(`insufficient pay-in balance to refund: have ${balance}, need ${owedBack}`);
  }

  // Audit 2026-05-24 H-2: persist refund_tx_hash the moment writeContract
  // returns and BEFORE waiting for the receipt, mirroring the settle and
  // permit2 paths. A crash inside the receipt-await window used to leave
  // the customer paid on-chain while the DB row said `failed` and the
  // gateway never saw recordPayerRefund. resumeRefund() picks up from
  // this checkpoint on lease reclaim.
  const transferTx = await wallet.writeContract({
    chain: undefined,
    address: row.pay_in_token as Address,
    abi: ERC20,
    functionName: "transfer",
    args: [row.payer as Address, owedBack],
  });
  await onTransferBroadcast(transferTx);
  await chain.waitForTransactionReceipt({ hash: transferTx, timeout: RECEIPT_TIMEOUT_MS });

  // Tell the gateway: the indexer flips the invoice to `failed` from this event.
  const recordTx = await wallet.writeContract({
    chain: undefined,
    address: gatewayFor(row),
    abi: GATEWAY_ABI,
    functionName: "recordPayerRefund",
    args: [
      row.invoice_id as Hex,
      row.payer as Address,
      row.pay_in_token as Address,
      owedBack,
      reasonToHash(reason),
    ],
  });
  await chain.waitForTransactionReceipt({ hash: recordTx, timeout: RECEIPT_TIMEOUT_MS });
  return transferTx;
}

/** Audit 2026-05-24 H-2: resume a refund flow that crashed after the
 *  customer-facing transfer was broadcast. refund_tx_hash being set means
 *  the transfer reached the network; verify it landed, then call
 *  recordPayerRefund (the contract's `inv.status == Created` guard makes
 *  it idempotent — InvoiceNotInCreatedState revert => already recorded). */
async function resumeRefund(row: QueueRow): Promise<{ ok: true; tx: Hex } | { ok: false; err: string }> {
  const transferTx = row.refund_tx_hash as Hex;

  let rcpt;
  try {
    rcpt = await chain.waitForTransactionReceipt({ hash: transferTx, timeout: 30_000 });
  } catch (e) {
    // Receipt not yet available — leave row in processing for next reclaim.
    // Don't escalate to failed unless we hit MAX_ATTEMPTS so a stuck refund
    // tx eventually surfaces for operator triage.
    if (row.attempts >= MAX_ATTEMPTS) {
      return { ok: false, err:
        `refund transfer ${transferTx} stuck unconfirmed after ${row.attempts} attempts — manual reconciliation needed`,
      };
    }
    throw e;  // let processOne's outer catch log + reschedule
  }

  if (rcpt.status !== "success") {
    return { ok: false, err: `refund transfer ${transferTx} reverted — manual reconciliation needed` };
  }

  // Transfer landed. Re-issue recordPayerRefund; revert with
  // InvoiceNotInCreatedState means it already ran on the previous attempt
  // and we can mark the row done.
  try {
    const recordTx = await wallet.writeContract({
      chain: undefined,
      address: gatewayFor(row),
      abi: GATEWAY_ABI,
      functionName: "recordPayerRefund",
      args: [
        row.invoice_id as Hex,
        row.payer as Address,
        row.pay_in_token as Address,
        BigInt(row.amount_in),
        reasonToHash(row.last_error ?? "resumed"),
      ],
    });
    await chain.waitForTransactionReceipt({ hash: recordTx, timeout: RECEIPT_TIMEOUT_MS });
    return { ok: true, tx: transferTx };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    if (/InvoiceNotInCreatedState/i.test(err)) {
      // Gateway already saw recordPayerRefund on a prior attempt; safe to close.
      return { ok: true, tx: transferTx };
    }
    return { ok: false, err: `refund record on resume: ${err}` };
  }
}

// USDC and EURC on Arc testnet are both 6-decimal in their ERC-20 surface;
// kit.swap takes human-readable strings ("0.50") so we format from base
// units back to decimal here. Hard-coded for now — extend when we onboard
// tokens with different decimals.
function humanizeAmount(baseUnits: string, _symbol: "USDC" | "EURC"): string {
  const decimals = 6n;
  const base = BigInt(baseUnits);
  const whole = base / 10n ** decimals;
  const frac  = (base % 10n ** decimals).toString().padStart(Number(decimals), "0").replace(/0+$/, "");
  return frac.length === 0 ? whole.toString() : `${whole.toString()}.${frac}`;
}

// ── Main loop ───────────────────────────────────────────────────────

const ZERO_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex;

/** Heuristic: did Permit2 revert because the nonce was already consumed?
 *  Permit2's `_useUnorderedNonce` reverts with `InvalidNonce()` (selector
 *  0x756688fe) when the bit is already flipped. viem surfaces both the name
 *  and the hex selector in the error message depending on whether ABI
 *  decoding succeeded — match either. */
function isPermit2NonceUsed(err: string): boolean {
  return /InvalidNonce/i.test(err) || /0x756688fe/i.test(err);
}

async function processOne(row: QueueRow): Promise<void> {
  const log = (level: string, fields: Record<string, unknown>) => {
    console.log(JSON.stringify({
      ts: new Date().toISOString(), level, queueId: row.id,
      invoiceId: row.invoice_id, attempt: row.attempts, ...fields,
    }));
  };

  log("info", {
    msg: "row.claimed",
    resume: {
      permit2: !!row.permit2_tx_hash,
      swap:    !!row.swap_tx_hash,
      settle:  !!row.settle_tx_hash,
      refund:  !!row.refund_tx_hash,
    },
  });

  // Audit 2026-05-24 H-2: refund resume short-circuits everything else.
  // refund_tx_hash being set means the prior attempt already broadcast the
  // customer-facing transfer and we crashed inside the receipt-await
  // window or before recordPayerRefund. Don't re-enter the swap/settle
  // flow — finish reconciling this refund and exit.
  if (row.refund_tx_hash) {
    log("info", { msg: "refund.resume", tx: row.refund_tx_hash });
    const res = await resumeRefund(row);
    if (res.ok) {
      await markRefunded(row.id, res.tx, "resumed after mid-flight crash");
      log("info", { msg: "refund.resume.ok", tx: res.tx });
    } else {
      await markFailed(row.id, res.err);
      log("error", { msg: "refund.resume.fail", err: res.err });
    }
    return;
  }

  // Step 1: pull pay-in via Permit2 (skip if a previous attempt already
  // pulled — Permit2 nonce is consumed on-chain, retrying would revert).
  if (!row.permit2_tx_hash) {
    try {
      const pullTx = await pullViaPermit2(row, async (tx) => {
        await persistPermit2Tx(row.id, tx);
        row.permit2_tx_hash = tx;
      });
      log("info", { msg: "permit2.ok", tx: pullTx });
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      log("error", { msg: "permit2.fail", err, attempts: row.attempts });
      // If a previous attempt actually pulled the funds but we crashed
      // before persisting permit2_tx_hash, the next attempt will hit
      // InvalidNonce. The customer's payIn is sitting in the relayer wallet;
      // operator needs to reconcile rather than letting us silently retry
      // forever. Surface as failed so it shows up in the ops dashboard.
      if (isPermit2NonceUsed(err) && row.attempts > 1) {
        await markFailed(
          row.id,
          `permit2 nonce already used on retry — pay-in likely in relayer wallet, ` +
          `manual reconciliation needed: ${err}`,
        );
        return;
      }
      await reschedule(row.id, `permit2: ${err}`, row.attempts);
      return;
    }
  } else {
    log("info", { msg: "permit2.skip", reason: "already-pulled", tx: row.permit2_tx_hash });
  }

  // Step 2: swap (skipped when payIn == payout — App Kit refuses identical
  // legs with "Swap from USDC to USDC ... not supported" and the customer
  // ends up refunded for a payment that should have settled directly).
  const sameToken = row.pay_in_token.toLowerCase() === row.payout_token.toLowerCase();
  let grossPayout: bigint;
  let swapTxHash:  Hex;

  if (sameToken) {
    grossPayout = BigInt(row.amount_in);
    swapTxHash  = ZERO_HASH;
    log("info", { msg: "swap.skip", reason: "same-token", grossPayout: grossPayout.toString() });
  } else if (row.swap_tx_hash) {
    // Resumed after swap — kit.swap was called and persisted. Audit
    // residual P2 (2026-05-05): the prior approach defaulted grossPayout
    // to amount_out_min when resuming, which left swap surplus stranded
    // in the relayer wallet (no protocolFeesAccrued credit). Now we use
    // the persisted swap_amount_out for an exact resume; legacy rows
    // written before the column landed fall back to the conservative
    // floor (one-time during the migration window).
    swapTxHash  = row.swap_tx_hash as Hex;
    grossPayout = row.swap_amount_out
      ? BigInt(row.swap_amount_out)
      : BigInt(row.amount_out_min);
    log("info", {
      msg: "swap.skip", reason: "already-swapped",
      tx: swapTxHash,
      grossPayout: grossPayout.toString(),
      source: row.swap_amount_out ? "persisted" : "legacy-floor",
    });
  } else {
    try {
      const swap = await runSwap(row);
      grossPayout = parseHumanAmount(swap.amountOut, 6);
      swapTxHash  = swap.txHash;
      await persistSwapTx(row.id, swap.txHash, grossPayout);
      row.swap_tx_hash    = swap.txHash;
      row.swap_amount_out = grossPayout.toString();
      log("info", { msg: "swap.ok", tx: swap.txHash, amountOut: swap.amountOut });
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      log("error", { msg: "swap.fail", err });
      try {
        const refundTx = await refundPayer(row, err, async (tx) => {
          await persistRefundTx(row.id, tx);
          row.refund_tx_hash = tx;
        });
        await markRefunded(row.id, refundTx, err);
        log("info", { msg: "refund.ok", tx: refundTx });
      } catch (re) {
        const rerr = re instanceof Error ? re.message : String(re);
        log("error", { msg: "refund.fail", err: rerr });
        await markFailed(row.id, `swap=${err}; refund=${rerr}`);
      }
      return;
    }
  }

  // Step 3: settle. If settle_tx_hash is already set, the previous attempt
  // broadcast settleInvoice — query the receipt to learn the outcome:
  //   success → the merchant was paid, just markSettled and bail.
  //   reverted → don't re-broadcast (would revert again as InvoicePayment
  //              already exists or as some other terminal state); markFailed
  //              for operator review.
  //   pending/missing → wait briefly and recurse the same logic; failing
  //              that, leave the row in `processing` for the next lease
  //              reclaim to retry.
  if (row.settle_tx_hash) {
    try {
      const rcpt = await chain.waitForTransactionReceipt({
        hash: row.settle_tx_hash as Hex,
        timeout: 30_000,
      });
      if (rcpt.status === "success") {
        await markSettled(row.id, swapTxHash, row.settle_tx_hash as Hex);
        log("info", { msg: "settle.skip", reason: "already-broadcast-success", tx: row.settle_tx_hash });
        return;
      }
      await markFailed(row.id, `settle: prior tx ${row.settle_tx_hash} reverted, manual reconciliation needed`);
      log("error", { msg: "settle.prior_reverted", tx: row.settle_tx_hash });
      return;
    } catch (e) {
      // Receipt unavailable — likely still pending or RPC timeout. Don't
      // re-broadcast (would race the pending tx); leave the row in
      // processing and let the next lease reclaim retry.
      //
      // Audit #18: if a tx sits stuck in the mempool indefinitely (gas too
      // low, network congestion, dropped from peer pools), repeated lease
      // reclaims would otherwise spin forever without ever surfacing the
      // problem. `attempts` is incremented on every claim, so once it
      // crosses MAX_ATTEMPTS we mark the row failed for operator triage.
      // Manual reconciliation: the tx might still land on-chain, in which
      // case the operator replays settleInvoice externally or rebroadcasts
      // with higher gas.
      if (row.attempts >= MAX_ATTEMPTS) {
        await markFailed(
          row.id,
          `settle: prior tx ${row.settle_tx_hash} stuck unconfirmed after ${row.attempts} attempts — manual reconciliation needed`,
        );
        log("error", {
          msg: "settle.stuck_unconfirmed_max_attempts",
          tx: row.settle_tx_hash,
          attempts: row.attempts,
        });
        return;
      }
      log("warn", {
        msg: "settle.receipt_unavailable",
        tx: row.settle_tx_hash,
        attempts: row.attempts,
        err: e instanceof Error ? e.message : String(e),
      });
      return;
    }
  }

  try {
    if (grossPayout < BigInt(row.amount_out_min)) {
      throw new Error(`gross ${grossPayout} below floor ${row.amount_out_min}`);
    }
    const settleTx = await callSettle(
      row, grossPayout, swapTxHash,
      async (tx) => { await persistSettleTx(row.id, tx); },
    );
    await markSettled(row.id, swapTxHash, settleTx);
    log("info", { msg: "settle.ok", tx: settleTx, gross: grossPayout.toString() });
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    log("error", { msg: "settle.fail", err });
    // Settlement failed but we already swapped; refund flow needs payInToken
    // which we no longer hold. Mark failed for operator review (rare path —
    // would mean the gateway reverted, e.g. invoice expired between submit
    // and settle).
    await markFailed(row.id, `settle: ${err} (post-swap, manual reconciliation needed)`);
  }
}

function parseHumanAmount(amount: string, decimals: number): bigint {
  const [whole, frac = ""] = amount.split(".");
  const fracPadded = frac.padEnd(decimals, "0").slice(0, decimals);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fracPadded || "0");
}

// ── Cross-chain v2 worker wiring ────────────────────────────────────
// The state machine itself (crosschain-worker.ts) is pure; everything below
// is the real-world dependency set: lease-based claim over
// `crosschain_payments`, CCTP receive on Arc, kit.swap, gateway settle, and
// the retry/backoff bookkeeping.

const CROSSCHAIN_LEASE_OWNER = `relayer:${RELAYER_ADDR.toLowerCase()}#${process.pid}`;

const TRANSFER_EVENT = parseAbi([
  "event Transfer(address indexed from,address indexed to,uint256 value)",
]);

/** Resolve a chain config from the boot-validated registry. Only reachable
 *  when CROSSCHAIN_ENABLED (the claim never runs otherwise). */
function crosschainChain(chainId: number) {
  if (!crosschainRegistry) throw new Error("crosschain_disabled");
  return chainById(crosschainRegistry, chainId);
}

/** Lease-based claim (FOR UPDATE SKIP LOCKED) over the processable
 *  cross-chain statuses. `attempts` increments on every claim so chronically
 *  stuck rows eventually hit CROSSCHAIN_MAX_ATTEMPTS and surface as terminal
 *  failures instead of retrying forever. */
async function claimNextCrosschain(): Promise<CrosschainPaymentRow | null> {
  const res = await pool.query(
    `with claimed as (
       update crosschain_payments
          set attempts = attempts + 1,
              lease_owner = $1,
              lease_expires_at = now() + ($2 || ' seconds')::interval,
              updated_at = now()
        where id = (
          select id from crosschain_payments
           -- Claimable set must cover every non-terminal processable state in
           -- crosschain-core's transition map (bridge_pending, bridge_confirmed,
           -- arc_swap_pending, settle_pending) — update both together.
           where status in ('bridge_pending', 'bridge_confirmed', 'arc_swap_pending', 'settle_pending')
             and next_attempt <= now()
             and (lease_expires_at is null or lease_expires_at < now())
           order by next_attempt
           limit 1
           for update skip locked
        )
        returning *
     )
     select * from claimed`,
    [CROSSCHAIN_LEASE_OWNER, String(LEASE_SECONDS)],
  );
  return (res.rows[0] as CrosschainPaymentRow | undefined) ?? null;
}

// Allowlisted column map for markCrosschain — SET clauses are built ONLY
// from these literal names; keys arriving in `values` that aren't listed
// throw instead of being interpolated into SQL.
const CROSSCHAIN_MARK_COLUMNS: ReadonlySet<string> = new Set([
  "status", "next_attempt", "updated_at", "attempts",
  "cctp_message", "cctp_attestation",
  "bridge_receive_tx_hash", "bridge_amount_received", "bridge_confirmed_at",
  "arc_swap_tx_hash", "arc_swap_amount_out",
  "settle_tx_hash", "refund_tx_hash", "last_error",
]);

/** Parameterized UPDATE of crosschain_payments. Transitions release the
 *  lease by default so the row is reclaimable the moment its next_attempt
 *  allows; mid-flight persists (broadcast-hash checkpoints before a receipt
 *  wait) pass `releaseLease: false` to keep the claim held. */
async function markCrosschain(
  id: string,
  values: Record<string, unknown>,
  opts?: { releaseLease?: boolean },
): Promise<void> {
  const keys = Object.keys(values);
  for (const k of keys) {
    if (!CROSSCHAIN_MARK_COLUMNS.has(k)) {
      throw new Error(`crosschain_mark_unknown_column:${k}`);
    }
  }
  const sets = keys.map((k, i) => `${k} = $${i + 2}`);
  if (opts?.releaseLease !== false) {
    sets.push("lease_owner = null", "lease_expires_at = null");
  }
  if (!keys.includes("updated_at")) sets.push("updated_at = now()");
  await pool.query(
    `update crosschain_payments set ${sets.join(", ")} where id = $1`,
    [id, ...keys.map((k) => values[k])],
  );
}

/** Stable error codes only into last_error — collapse whitespace and cap at
 *  200 chars so giant RPC/ABI dumps don't bloat the row. */
function crosschainErrorCode(error: string): string {
  return error.replace(/\s+/g, " ").trim().slice(0, 200);
}

/** Retry semantics: below the attempts cap, keep the row's CURRENT
 *  processable status (do NOT write the failure state) and reschedule with
 *  exponential backoff; at/after the cap, write the terminal failure status
 *  for operator triage. Lease is released either way. */
async function failCrosschain(
  row: CrosschainPaymentRow,
  status: CrosschainState,
  error: string,
): Promise<void> {
  const code = crosschainErrorCode(error);
  if (row.attempts >= CROSSCHAIN_MAX_ATTEMPTS) {
    await pool.query(
      `update crosschain_payments
          set status = $2, last_error = $3,
              lease_owner = null, lease_expires_at = null, updated_at = now()
        where id = $1`,
      [row.id, status, code],
    );
    return;
  }
  const backoffMs = Math.min(
    CROSSCHAIN_RETRY_BASE_MS * 2 ** Math.max(row.attempts - 1, 0),
    CROSSCHAIN_RETRY_MAX_MS,
  );
  await pool.query(
    `update crosschain_payments
        set last_error = $2,
            next_attempt = now() + ($3 || ' milliseconds')::interval,
            lease_owner = null, lease_expires_at = null, updated_at = now()
      where id = $1`,
    [row.id, code, String(backoffMs)],
  );
}

/** CCTP receive on Arc with replay-safe receipt-log accounting: the minted
 *  amount is read from the receipt's Transfer logs (zero address →
 *  relayer on the destination USDC), NOT from balance deltas, so a daemon
 *  restart can reconstruct the exact received amount from the persisted
 *  bridge_receive_tx_hash. */
async function receiveCrosschainMessage(
  row: CrosschainPaymentRow,
  att: { message: Hex; attestation: Hex },
  onBroadcast: (txHash: Hex) => Promise<void>,
): Promise<{ txHash: Hex; amountReceived: bigint }> {
  const destination = crosschainChain(row.destination_chain_id);
  const txHash = (row.bridge_receive_tx_hash as Hex | null)
    ?? await wallet.writeContract({
      chain: undefined,
      ...receiveMessageCall({
        messageTransmitter: destination.messageTransmitter,
        message: att.message,
        attestation: att.attestation,
      }),
    });
  // Persist-before-wait: a crash inside the receipt-await window must not
  // lose the broadcast hash (CCTP replay protection makes a re-broadcast
  // revert, and the mint would otherwise be unaccountable).
  if (!row.bridge_receive_tx_hash) await onBroadcast(txHash);
  const receipt = await chain.waitForTransactionReceipt({ hash: txHash, timeout: RECEIPT_TIMEOUT_MS });
  if (receipt.status !== "success") throw new Error("cctp_receive_reverted");
  const transfers = parseEventLogs({
    abi: TRANSFER_EVENT,
    eventName: "Transfer",
    logs: receipt.logs,
    strict: false,
  });
  // Accept the mint if it lands on EITHER the env-derived relayer address OR
  // the recipient embedded in the stored intent (bytes32 mint_recipient) —
  // self-heals app/relayer env skew so funds already minted on Arc aren't stranded.
  const intentRecipient = "0x" + row.mint_recipient.slice(-40);
  // Audit LOW-5 (2026-06-11): the accepted mint must clear 98% of the
  // source burn (2% CCTP fast-transfer fee tolerance) instead of the old
  // `> 0n` bound, so a dust Transfer in the receipt can never be picked up
  // as the bridge mint. The worker re-checks the same floor on the
  // persisted amount and routes below-floor rows to bridge_failed.
  const minMint = (BigInt(row.source_amount) * 98n) / 100n;
  const mint = transfers.find((event) => {
    const to = event.args.to?.toLowerCase();
    return event.address.toLowerCase() === row.destination_token.toLowerCase()
      && event.args.from?.toLowerCase() === "0x0000000000000000000000000000000000000000"
      && (to === RELAYER_ADDR.toLowerCase() || to === intentRecipient)
      && (event.args.value ?? 0n) >= minMint;
  });
  if (!mint?.args.value) {
    throw new Error(
      `cctp_receive_mint_amount_mismatch: no mint >= ${minMint} (98% of source_amount ${row.source_amount}) to the relayer in receipt`,
    );
  }
  return { txHash, amountReceived: mint.args.value };
}

/** Swap the bridged Arc USDC (exact-in bridge_amount_received) to the
 *  invoice's payout token via App Kit — same swap surface as the Arc-only
 *  flow in runSwap. The worker persists arc_swap_tx_hash/amount_out
 *  immediately after this returns (kit.swap is atomic, so there is no
 *  broadcast/receipt window to checkpoint inside). */
async function swapCrosschainOnArc(
  row: CrosschainPaymentRow,
): Promise<{ amountOut: bigint; txHash: Hex }> {
  if (!row.bridge_amount_received) throw new Error("crosschain_bridge_amount_missing");
  const tokenIn  = tokenSymbolForArcAddress(row.destination_token);
  const tokenOut = tokenSymbolForArcAddress(row.payout_token);

  const result = await kit.swap({
    from: { adapter, chain: "Arc_Testnet" as const },
    tokenIn, tokenOut,
    amountIn: humanizeAmount(row.bridge_amount_received, tokenIn),
    config: {
      kitKey:      KIT_KEY,
      slippageBps: SLIPPAGE_BPS,
      customFee:   { percentageBps: CUSTOM_FEE_BPS, recipientAddress: FEE_RECIPIENT },
    },
  });
  const r = result as { amountOut?: string; txHash: Hex };
  if (!r.amountOut) throw new Error("kit.swap returned no amountOut");
  return { amountOut: parseHumanAmount(r.amountOut, 6), txHash: r.txHash };
}

/** Gateway settle, mirroring callSettle's semantics against
 *  ArcFXGateway.settleInvoice(bytes32 globalId, address payer, address
 *  payInToken, uint256 amountIn, uint256 grossPayout, bytes32 swapTxHash).
 *  Cross-chain arg mapping: payInToken = the Arc-side token CCTP delivered
 *  (row.destination_token), amountIn = the minted bridge_amount_received. */
async function settleCrosschainOnArc(args: {
  row: CrosschainPaymentRow;
  grossPayout: bigint;
  swapTxHash: Hex;
}): Promise<Hex> {
  const { row, grossPayout, swapTxHash } = args;

  // Resume guard: settle_tx_hash persisted by a prior attempt means
  // settleInvoice already hit the wire — re-broadcasting would revert as
  // InvoiceAlreadyPaid even though the merchant was paid. Verify the
  // recorded tx instead (mirrors the relayer_queue settle resume).
  if (row.settle_tx_hash) {
    const prior = await chain.waitForTransactionReceipt({
      hash: row.settle_tx_hash as Hex,
      timeout: RECEIPT_TIMEOUT_MS,
    });
    if (prior.status !== "success") {
      throw new Error(`crosschain_settle_prior_tx_reverted:${row.settle_tx_hash}`);
    }
    return row.settle_tx_hash as Hex;
  }

  if (!row.bridge_amount_received) throw new Error("crosschain_bridge_amount_missing");

  // crosschain_payments rows carry no per-row gateway; settle against the
  // daemon default, still passed through the AFG-010 allowlist assertion.
  const targetGateway = resolveGateway(null, GATEWAY, GATEWAY_ALLOWLIST);

  // Approve the gateway to pull `payout_token` (what settleInvoice transfers
  // to the merchant). Note the distinction: `destination_token` is what CCTP
  // minted on Arc (and was swapped FROM when the two differ) — the gateway
  // never pulls it. Approve is idempotent (same allowance value on
  // re-issue) — no checkpoint needed before its receipt wait.
  const approveTx = await wallet.writeContract({
    chain: undefined,
    address: row.payout_token as Address,
    abi: ERC20,
    functionName: "approve",
    args: [targetGateway, grossPayout],
  });
  await chain.waitForTransactionReceipt({ hash: approveTx, timeout: RECEIPT_TIMEOUT_MS });

  try {
    const tx = await wallet.writeContract({
      chain: undefined,
      address: targetGateway,
      abi: GATEWAY_ABI,
      functionName: "settleInvoice",
      args: buildSettleArgs({
        invoiceId: row.invoice_id,
        payer: row.payer,
        payInToken: row.destination_token,
        amountIn: BigInt(row.bridge_amount_received),
        grossPayout,
        swapTxHash,
      }),
    });
    // Persist-before-wait (lease kept — the receipt wait is still in
    // flight), then let the worker stamp status='paid'.
    await markCrosschain(row.id, { settle_tx_hash: tx }, { releaseLease: false });
    await chain.waitForTransactionReceipt({ hash: tx, timeout: RECEIPT_TIMEOUT_MS });
    return tx;
  } catch (e) {
    // Best-effort allowance cleanup: a stranded non-zero allowance against
    // the gateway outlives terminal failures otherwise.
    await wallet.writeContract({
      chain: undefined,
      address: row.payout_token as Address,
      abi: ERC20,
      functionName: "approve",
      args: [targetGateway, 0n],
    }).catch(() => {});
    throw e;
  }
}

/** Refund the bridged Arc USDC to the payer (shortfall before any swap).
 *  Persist-before-wait + resume guard so a crash inside the receipt-await
 *  window can never double-refund. */
async function refundCrosschainOnArc(args: {
  row: CrosschainPaymentRow;
  token: string;
  amount: bigint;
}): Promise<Hex> {
  const { row, token, amount } = args;

  if (row.refund_tx_hash) {
    const prior = await chain.waitForTransactionReceipt({
      hash: row.refund_tx_hash as Hex,
      timeout: RECEIPT_TIMEOUT_MS,
    });
    if (prior.status !== "success") {
      throw new Error(`crosschain_refund_prior_tx_reverted:${row.refund_tx_hash}`);
    }
    return row.refund_tx_hash as Hex;
  }

  const txHash = await wallet.writeContract({
    chain: undefined,
    address: token as Address,
    abi: ERC20,
    functionName: "transfer",
    args: [row.payer as Address, amount],
  });
  // Persist-before-wait (lease kept — the receipt wait is still in flight).
  await markCrosschain(row.id, { refund_tx_hash: txHash }, { releaseLease: false });
  const receipt = await chain.waitForTransactionReceipt({ hash: txHash, timeout: RECEIPT_TIMEOUT_MS });
  if (receipt.status !== "success") throw new Error("crosschain_refund_reverted");
  return txHash;
}

async function processCrosschainRow(row: CrosschainPaymentRow): Promise<void> {
  const log = (level: string, fields: Record<string, unknown>) => {
    console.log(JSON.stringify({
      ts: new Date().toISOString(), level, crosschainId: row.id,
      invoiceId: row.invoice_id, status: row.status, attempt: row.attempts,
      ...fields,
    }));
  };
  log("info", {
    msg: "crosschain.claimed",
    resume: {
      attestation: !!(row.cctp_message && row.cctp_attestation),
      bridge:      !!row.bridge_receive_tx_hash,
      swap:        !!row.arc_swap_tx_hash,
      settle:      !!row.settle_tx_hash,
      refund:      !!row.refund_tx_hash,
    },
  });

  const deps: CrosschainWorkerDeps = {
    fetchAttestation: async (r) => {
      if (!r.burn_tx_hash) throw new Error("crosschain_burn_tx_missing");
      return fetchIrisAttestation({
        irisBaseUrl: CCTP_IRIS_API_URL,
        sourceDomain: r.source_domain,
        burnTxHash: r.burn_tx_hash as Hex,
      });
    },
    receiveMessage: receiveCrosschainMessage,
    swapOnArc: swapCrosschainOnArc,
    settleOnArc: settleCrosschainOnArc,
    refundOnArc: refundCrosschainOnArc,
    mark: markCrosschain,
    fail: async (id, status, error) => {
      log("error", {
        msg: "crosschain.fail",
        // Status the row WOULD get if this attempt is the terminal one;
        // below the cap failCrosschain keeps the processable status.
        wouldBeTerminalStatus: status,
        terminal: row.attempts >= CROSSCHAIN_MAX_ATTEMPTS,
        err: crosschainErrorCode(error),
      });
      await failCrosschain(row, status, error);
    },
    attestationDeadlineMs: CROSSCHAIN_ATTESTATION_DEADLINE_MS,
  };

  const disposition = await processCrosschainPayment(row, deps);
  log("info", { msg: "crosschain.processed", disposition });
}

async function main() {
  console.log(JSON.stringify({
    msg: "relayer.start",
    relayer: RELAYER_ADDR,
    gateway: GATEWAY,
    tickMs: TICK_MS,
    customFeeBps: CUSTOM_FEE_BPS,
    slippageBps: SLIPPAGE_BPS,
    crosschain: CROSSCHAIN_ENABLED,
    crosschainChains: crosschainRegistry ? [...crosschainRegistry.keys()] : [],
  }));

  // Audit Ops-L-1 (2026-05-24): graceful drain. The previous handler
  // immediately closed the pool + exited even if a processOne await was
  // in-flight (e.g. waiting on a chain receipt between persistSwapTx and
  // callSettle). With the persist-before-await pattern + lease reclaim the
  // row was recoverable, but a SIGTERM during rotation restarts every 24h
  // was a routine source of avoidable lease-reclaim cycles. Now we set a
  // flag and let the current iteration land before tearing down.
  let shuttingDown = false;
  const requestShutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(JSON.stringify({ ts: new Date().toISOString(), msg: "relayer.shutdown_requested", signal }));
  };
  process.on("SIGINT",  () => requestShutdown("SIGINT"));
  process.on("SIGTERM", () => requestShutdown("SIGTERM"));

  while (!shuttingDown) {
    try {
      // Cross-chain rows first (feature-flagged), then the Arc-only queue.
      // Still strictly one row at a time — same single-hot-wallet nonce
      // discipline as the relayer_queue path.
      if (CROSSCHAIN_ENABLED) {
        const ccRow = await claimNextCrosschain();
        if (ccRow) {
          await processCrosschainRow(ccRow);
          continue; // back to the top — drain anything else queued
        }
      }
      const row = await claimNext();
      if (row) {
        await processOne(row);
        continue; // back to the top — drain anything else queued
      }
    } catch (e) {
      console.error(JSON.stringify({
        ts: new Date().toISOString(), msg: "tick.error",
        error: e instanceof Error ? e.message : String(e),
      }));
    }
    if (shuttingDown) break;
    await new Promise(r => setTimeout(r, TICK_MS));
  }

  console.log(JSON.stringify({ ts: new Date().toISOString(), msg: "relayer.shutdown_complete" }));
  await pool.end().catch(() => {});
  process.exit(0);
}

main();
