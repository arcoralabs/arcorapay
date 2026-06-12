/**
 * DEV-ONLY two-wallet E2E test. Requires CUSTOMER_PRIVATE_KEY and
 * RELAYER_PRIVATE_KEY (raw hex). In V10, the daemon signs via Vault
 * (VAULT_* env vars); this script retains raw private keys because:
 *   1. The customer key is always a raw key (customer wallet, not relayer).
 *   2. The relayer key here serves double duty as the merchant wallet for
 *      test convenience — Vault's single-key model doesn't support this
 *      multi-role pattern without a dedicated test Vault instance.
 * Update this script (or replace with a proper integration test) before any
 * production E2E suite that targets V10.
 *
 * Two-wallet E2E test for the v0.8 stack. Customer and relayer are
 * different addresses — exercises the real Permit2 path where the relayer
 * pulls funds from a foreign wallet using only a signed message.
 *
 * Setup:
 *   - Customer wallet  (CUSTOMER_PRIVATE_KEY env): signs Permit2, never sends a tx
 *   - Relayer wallet   (RELAYER_PRIVATE_KEY env):  daemon already running on VPS
 *   - Merchant         = relayer wallet (already registered on v0.8)
 *
 * Steps:
 *   1. Customer approves Permit2 on USDC (one-time)
 *   2. Relayer (server-side) calls gateway.createInvoice (delegated path
 *      uses merchant; here we just call createInvoice directly since the
 *      relayer wallet IS the merchant in this test)
 *   3. Customer wallet signs Permit2 EIP-712 typed data
 *   4. Insert relayer_queue row with customer's signature
 *   5. Watch the daemon process: Permit2 pull (real cross-wallet transfer
 *      this time), kit.swap, settle. Confirm payee got EURC.
 */

import {
  createPublicClient, createWalletClient, http, parseAbi,
  encodeAbiParameters, keccak256, type Address, type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import pg from "pg";
import { buildOpsPoolConfig } from "./db";
import { randomBytes } from "node:crypto";

const RPC                  = need("ARC_TESTNET_RPC");
const PG_URL               = need("POSTGRES_URL_NON_POOLING");
const CUSTOMER_PRIVATE_KEY = need("CUSTOMER_PRIVATE_KEY") as Hex;
const RELAYER_PRIVATE_KEY  = need("RELAYER_PRIVATE_KEY")  as Hex;
const GATEWAY              = need("GATEWAY_ADDRESS").toLowerCase() as Address;
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as Address;
const USDC    = "0x3600000000000000000000000000000000000000" as Address;
const EURC    = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a" as Address;
const MERCHANT_PAYEE = "0x000000000000000000000000000000000000bEEF" as Address;

function need(k: string): string {
  const v = process.env[k];
  if (!v) throw new Error(`missing env ${k}`);
  return v;
}

const ERC20 = parseAbi([
  "function approve(address,uint256) returns (bool)",
  "function allowance(address,address) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
]);

const GATEWAY_ABI = parseAbi([
  "function createInvoice(bytes32 merchantInvoiceId, address payIn, uint256 amountOut, uint64 expiresAt) returns (bytes32 globalId)",
]);

const customer = privateKeyToAccount(CUSTOMER_PRIVATE_KEY);
const relayer  = privateKeyToAccount(RELAYER_PRIVATE_KEY);
const chain          = createPublicClient({ transport: http(RPC) });
const customerWallet = createWalletClient({ account: customer, transport: http(RPC) });
const relayerWallet  = createWalletClient({ account: relayer,  transport: http(RPC) });
const pool = new pg.Pool(buildOpsPoolConfig(PG_URL)); // AFG-011: verify-full TLS

async function ensurePermit2Approval() {
  const allowance = await chain.readContract({
    address: USDC, abi: ERC20, functionName: "allowance",
    args: [customer.address, PERMIT2],
  });
  if (allowance > 10n ** 30n) {
    console.log(`[e2e2] customer permit2 allowance already set: ${allowance}`);
    return;
  }
  console.log(`[e2e2] customer approving Permit2 on USDC…`);
  const tx = await customerWallet.writeContract({
    chain: undefined,
    address: USDC, abi: ERC20, functionName: "approve",
    args: [PERMIT2, (1n << 256n) - 1n],
  });
  await chain.waitForTransactionReceipt({ hash: tx });
  console.log(`[e2e2] customer permit2 approval tx ${tx}`);
}

async function createInvoiceForMerchant(amountOut: bigint): Promise<{ globalId: Hex; merchantInvoiceId: Hex }> {
  // The merchant in this test is the relayer wallet. (Merchant registry
  // already set during the earlier single-wallet test run.) We sign with
  // the relayer key so msg.sender == merchant and createInvoice succeeds.
  const merchantInvoiceId = ("0x" + randomBytes(32).toString("hex")) as Hex;
  const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 30 * 60);
  console.log(`[e2e2] createInvoice merchantInvoiceId=${merchantInvoiceId} amountOut=${amountOut}`);
  const tx = await relayerWallet.writeContract({
    chain: undefined,
    address: GATEWAY, abi: GATEWAY_ABI, functionName: "createInvoice",
    args: [merchantInvoiceId, USDC, amountOut, expiresAt],
  });
  await chain.waitForTransactionReceipt({ hash: tx });
  const globalId = keccak256(encodeAbiParameters(
    [{ type: "address" }, { type: "bytes32" }],
    [relayer.address, merchantInvoiceId],
  ));
  console.log(`[e2e2] invoice created globalId=${globalId} tx=${tx}`);
  return { globalId, merchantInvoiceId };
}

async function ensureDbInvoice(globalId: Hex, merchantInvoiceId: Hex, amountOut: bigint) {
  // Same DB-bootstrap shortcut the single-wallet script uses.
  const merchantAddr = relayer.address.toLowerCase();
  const mr = await pool.query<{ id: string }>(
    "select id from merchants where lower(address) = $1 limit 1",
    [merchantAddr],
  );
  if (mr.rowCount === 0) throw new Error("merchant row missing — run e2e-test.ts first to bootstrap");
  const merchantId = mr.rows[0]!.id;

  await pool.query(
    `insert into invoices
       (id, merchant_invoice_id, merchant_id, pay_in_token, payout_token,
        amount_out, expires_at, status, success_url, metadata)
     values ($1, $2, $3, $4, $5, $6, to_timestamp($7), 'created',
             'https://example.test/success', '{}'::jsonb)
     on conflict (id) do nothing`,
    [
      globalId,
      merchantInvoiceId,
      merchantId,
      USDC.toLowerCase(),
      EURC.toLowerCase(),
      amountOut.toString(),
      Math.floor(Date.now() / 1000) + 30 * 60,
    ],
  );
  console.log(`[e2e2] backfilled invoices row`);
}

async function buildAndSignPermit2(globalId: Hex, amountIn: bigint) {
  const nonce    = BigInt("0x" + randomBytes(32).toString("hex"));
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 30 * 60);
  const witnessTypeString =
    "ArcoraSwapIntent witness)ArcoraSwapIntent(bytes32 invoiceId,address relayer)TokenPermissions(address token,uint256 amount)";
  const witnessTypeHash = keccak256(new TextEncoder().encode(
    "ArcoraSwapIntent(bytes32 invoiceId,address relayer)",
  ));
  const witness = keccak256(encodeAbiParameters(
    [{ type: "bytes32" }, { type: "bytes32" }, { type: "address" }],
    [witnessTypeHash, globalId, relayer.address],
  ));

  const signature = await customerWallet.signTypedData({
    domain: { name: "Permit2", chainId: 5042002, verifyingContract: PERMIT2 },
    types: {
      TokenPermissions: [
        { name: "token",  type: "address" },
        { name: "amount", type: "uint256" },
      ],
      ArcoraSwapIntent: [
        { name: "invoiceId", type: "bytes32" },
        { name: "relayer",   type: "address" },
      ],
      PermitWitnessTransferFrom: [
        { name: "permitted", type: "TokenPermissions" },
        { name: "spender",   type: "address" },
        { name: "nonce",     type: "uint256" },
        { name: "deadline",  type: "uint256" },
        { name: "witness",   type: "ArcoraSwapIntent" },
      ],
    },
    primaryType: "PermitWitnessTransferFrom",
    message: {
      permitted: { token: USDC, amount: amountIn },
      spender:   relayer.address,    // relayer is the spender in two-wallet flow
      nonce,
      deadline,
      witness:   { invoiceId: globalId, relayer: relayer.address },
    },
  });
  return { nonce: nonce.toString(), deadline: deadline.toString(), witness, witnessTypeString, signature };
}

async function enqueue(globalId: Hex, amountIn: bigint, amountOutMin: bigint, permit: {
  nonce: string; deadline: string; witness: Hex; witnessTypeString: string; signature: Hex;
}) {
  const r = await pool.query<{ id: string }>(
    `insert into relayer_queue
       (invoice_id, payer, pay_in_token, amount_in, payout_token, amount_out_min,
        permit2_data, permit2_signature)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
     returning id`,
    [
      globalId,
      customer.address.toLowerCase(),       // payer = NEW wallet, not relayer
      USDC.toLowerCase(),
      amountIn.toString(),
      EURC.toLowerCase(),
      amountOutMin.toString(),
      JSON.stringify({
        nonce:             permit.nonce,
        deadline:          permit.deadline,
        witness:           permit.witness,
        witnessTypeString: permit.witnessTypeString,
      }),
      permit.signature,
    ],
  );
  return r.rows[0]!.id;
}

async function pollUntilTerminal(submissionId: string) {
  for (let i = 0; i < 60; i++) {
    const r = await pool.query<{ status: string; last_error: string | null; settle_tx_hash: string | null; swap_tx_hash: string | null }>(
      "select status, last_error, settle_tx_hash, swap_tx_hash from relayer_queue where id = $1",
      [submissionId],
    );
    const row = r.rows[0];
    if (!row) throw new Error("queue row vanished");
    if (["settled", "refunded", "failed"].includes(row.status)) {
      return row;
    }
    process.stdout.write(`\r[e2e2] waiting… status=${row.status} (t=${i * 5}s)`);
    await new Promise(r => setTimeout(r, 5000));
  }
  throw new Error("timed out");
}

async function main() {
  console.log(`[e2e2] customer wallet: ${customer.address}`);
  console.log(`[e2e2] relayer wallet:  ${relayer.address}`);

  const customerUsdcPre = await chain.readContract({
    address: USDC, abi: ERC20, functionName: "balanceOf", args: [customer.address],
  });
  const merchantPayeePre = await chain.readContract({
    address: EURC, abi: ERC20, functionName: "balanceOf", args: [MERCHANT_PAYEE],
  });
  console.log(`[e2e2] customer USDC pre: ${customerUsdcPre}`);
  console.log(`[e2e2] merchantPayee EURC pre: ${merchantPayeePre}`);

  await ensurePermit2Approval();

  const amountIn  = 200_000n; // 0.20 USDC
  const expectMin = 100_000n; // 0.10 EURC floor
  const { globalId, merchantInvoiceId } = await createInvoiceForMerchant(expectMin);
  await ensureDbInvoice(globalId, merchantInvoiceId, expectMin);

  const permit = await buildAndSignPermit2(globalId, amountIn);
  console.log(`[e2e2] signature ok, witness=${permit.witness}`);

  const submissionId = await enqueue(globalId, amountIn, expectMin, permit);
  console.log(`[e2e2] queued submission=${submissionId}`);

  const terminal = await pollUntilTerminal(submissionId);
  console.log(`\n[e2e2] terminal:`, terminal);

  const customerUsdcPost = await chain.readContract({
    address: USDC, abi: ERC20, functionName: "balanceOf", args: [customer.address],
  });
  const merchantPayeePost = await chain.readContract({
    address: EURC, abi: ERC20, functionName: "balanceOf", args: [MERCHANT_PAYEE],
  });
  console.log(`[e2e2] customer USDC delta:    ${customerUsdcPre - customerUsdcPost} (expected ~${amountIn})`);
  console.log(`[e2e2] merchantPayee EURC delta: ${merchantPayeePost - merchantPayeePre}`);

  if (terminal.status !== "settled") process.exit(1);
  if (customerUsdcPre - customerUsdcPost < amountIn) {
    console.error(`[e2e2] FAIL: customer USDC didn't decrease by amountIn — Permit2 transfer didn't happen?`);
    process.exit(1);
  }
  console.log("[e2e2] PASS");
  await pool.end();
}

main().catch(async e => {
  console.error("[e2e2] fatal:", e);
  await pool.end().catch(() => {});
  process.exit(1);
});
