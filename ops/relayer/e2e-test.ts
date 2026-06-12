/**
 * DEV-ONLY single-wallet E2E test. Requires RELAYER_PRIVATE_KEY (raw hex).
 * In V10, the daemon signs via Vault (VAULT_* env vars); this script uses a
 * raw private key because the customer and relayer are the same wallet for
 * test convenience. Vault's single-key model doesn't map to this multi-role
 * setup without a full test Vault instance. Update or delete this script
 * before any production E2E suite.
 *
 * Manual E2E test for the v0.8 stack. Bypasses the SDK and the /api/checkout
 * routes — talks directly to the chain (gateway, Permit2, ERC20) and the DB
 * (`relayer_queue`). Lets us validate the daemon-side pipeline before any UI
 * is built on top.
 *
 * Steps:
 *   1. Ensure customer wallet has approved Permit2 for `USDC` (one-shot).
 *   2. Ensure merchant is registered on the v0.8 gateway.
 *   3. Call `gateway.createInvoice` to mint a fresh invoice on chain.
 *   4. Build EIP-712 typed data (Permit2 SignatureTransfer + Witness),
 *      sign it with the customer wallet.
 *   5. Insert a row into `relayer_queue` directly. The relayer daemon's
 *      poll loop will claim it within RELAYER_TICK_MS.
 *   6. Poll the queue row until status flips to `settled` or `failed`.
 *   7. Verify the on-chain `InvoicePaid` event matches.
 *
 * Customer == relayer wallet for this test (same private key); the swap
 * still goes through, the Permit2 transfer is just a same-account no-op.
 */

import {
  createPublicClient, createWalletClient, http, parseAbi,
  encodeAbiParameters, keccak256, type Address, type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import pg from "pg";
import { buildOpsPoolConfig } from "./db";
import { randomBytes } from "node:crypto";

const RPC          = need("ARC_TESTNET_RPC");
const PG_URL       = need("POSTGRES_URL_NON_POOLING");
const PRIVATE_KEY  = need("RELAYER_PRIVATE_KEY") as Hex;
const GATEWAY      = need("GATEWAY_ADDRESS").toLowerCase() as Address;
const PERMIT2      = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as Address;
const USDC         = "0x3600000000000000000000000000000000000000" as Address;
const EURC         = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a" as Address;

// Random throwaway merchant payee — funds end up here. Must NOT match the
// deployer; otherwise the transfer-to-merchant step gives the relayer wallet
// its own EURC back and we can't tell whether the gateway actually paid out.
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
  "function registerMerchant(address payoutAddress, address payoutToken)",
  "function createInvoice(bytes32 merchantInvoiceId, address payIn, uint256 amountOut, uint64 expiresAt) returns (bytes32 globalId)",
  "function merchants(address) view returns (address payoutAddress, address payoutToken, bool active)",
  "event InvoiceCreated(bytes32 indexed globalId, address indexed merchant, bytes32 indexed merchantInvoiceId, address payIn, address payoutToken, uint256 amountOut, uint64 expiresAt)",
  "event InvoicePaid(bytes32 indexed globalId, address indexed payer, uint256 amountIn, uint256 grossReceived, uint256 merchantPayout, uint256 fee)",
]);

const account = privateKeyToAccount(PRIVATE_KEY);
const chain = createPublicClient({ transport: http(RPC) });
const wallet = createWalletClient({ account, transport: http(RPC) });
const pool = new pg.Pool(buildOpsPoolConfig(PG_URL)); // AFG-011: verify-full TLS

async function ensurePermit2Approval() {
  const allowance = await chain.readContract({
    address: USDC, abi: ERC20, functionName: "allowance",
    args: [account.address, PERMIT2],
  });
  if (allowance > 10n ** 30n) {
    console.log(`[e2e] permit2 allowance already set: ${allowance}`);
    return;
  }
  console.log(`[e2e] approving Permit2 on USDC…`);
  const tx = await wallet.writeContract({
    chain: undefined,
    address: USDC, abi: ERC20, functionName: "approve",
    args: [PERMIT2, (1n << 256n) - 1n],
  });
  await chain.waitForTransactionReceipt({ hash: tx });
  console.log(`[e2e] permit2 approval tx ${tx}`);
}

async function ensureMerchantRegistered() {
  const m = await chain.readContract({
    address: GATEWAY, abi: GATEWAY_ABI, functionName: "merchants",
    args: [account.address],
  });
  if (m[2]) {
    console.log(`[e2e] merchant already registered, payee=${m[0]}, payoutToken=${m[1]}`);
    return;
  }
  console.log(`[e2e] registering merchant…`);
  const tx = await wallet.writeContract({
    chain: undefined,
    address: GATEWAY, abi: GATEWAY_ABI, functionName: "registerMerchant",
    args: [MERCHANT_PAYEE, EURC],
  });
  await chain.waitForTransactionReceipt({ hash: tx });
  console.log(`[e2e] registered merchant tx ${tx}`);
}

async function createInvoice(amountOutBaseUnits: bigint): Promise<{ globalId: Hex; merchantInvoiceId: Hex }> {
  const merchantInvoiceId = ("0x" + randomBytes(32).toString("hex")) as Hex;
  const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 30 * 60);
  console.log(`[e2e] createInvoice merchantInvoiceId=${merchantInvoiceId} amountOut=${amountOutBaseUnits}`);
  const tx = await wallet.writeContract({
    chain: undefined,
    address: GATEWAY, abi: GATEWAY_ABI, functionName: "createInvoice",
    args: [merchantInvoiceId, USDC, amountOutBaseUnits, expiresAt],
  });
  const receipt = await chain.waitForTransactionReceipt({ hash: tx });
  // Recover globalId from the InvoiceCreated event.
  const event = receipt.logs.find(l =>
    l.topics[0] === keccak256(new TextEncoder().encode("InvoiceCreated(bytes32,address,bytes32,address,address,uint256,uint64)")));
  const globalId = (event?.topics[1] ?? keccak256(encodeAbiParameters(
    [{ type: "address" }, { type: "bytes32" }],
    [account.address, merchantInvoiceId],
  ))) as Hex;
  console.log(`[e2e] invoice created globalId=${globalId} tx=${tx}`);
  return { globalId, merchantInvoiceId };
}

async function buildAndSignPermit2(globalId: Hex, amountIn: bigint): Promise<{
  nonce: string; deadline: string; witness: Hex; witnessTypeString: string; signature: Hex;
}> {
  const nonce = BigInt("0x" + randomBytes(32).toString("hex"));
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 30 * 60);
  const chainId = 5042002;

  // Witness binds the signature to (invoice, relayer). Relayer == account
  // here, so the witness types still parse with a real EIP-712 struct.
  const witnessTypeString =
    "ArcoraSwapIntent witness)ArcoraSwapIntent(bytes32 invoiceId,address relayer)TokenPermissions(address token,uint256 amount)";

  const witnessTypeHash = keccak256(new TextEncoder().encode(
    "ArcoraSwapIntent(bytes32 invoiceId,address relayer)",
  ));
  const witness = keccak256(encodeAbiParameters(
    [{ type: "bytes32" }, { type: "bytes32" }, { type: "address" }],
    [witnessTypeHash, globalId, account.address],
  ));

  const signature = await wallet.signTypedData({
    domain: { name: "Permit2", chainId, verifyingContract: PERMIT2 },
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
      spender:   account.address,
      nonce,
      deadline,
      witness:   { invoiceId: globalId, relayer: account.address },
    },
  });

  return { nonce: nonce.toString(), deadline: deadline.toString(), witness, witnessTypeString, signature };
}

async function ensureDbInvoice(globalId: Hex, merchantInvoiceId: Hex, amountOut: bigint): Promise<void> {
  // The relayer_queue → invoices FK fails until the indexer mirrors the
  // chain row. The test runs faster than the indexer cycle, so we backfill
  // the merchant + invoice rows ourselves. In production, /api/invoices
  // does this synchronously when the merchant creates an invoice.
  const merchantAddr = account.address.toLowerCase();
  let mr = await pool.query<{ id: string }>(
    "select id from merchants where lower(address) = $1 limit 1",
    [merchantAddr],
  );
  if (mr.rowCount === 0) {
    mr = await pool.query<{ id: string }>(
      `insert into merchants (address, payout_token, api_key_hash,
                              webhook_secret_enc, webhook_secret_iv)
       values ($1, $2, $3, ''::bytea, ''::bytea)
       returning id`,
      [merchantAddr, EURC.toLowerCase(), `e2e-test-${Date.now()}`],
    );
    console.log(`[e2e] created merchants row for ${merchantAddr}`);
  }
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
  console.log(`[e2e] backfilled invoices row for ${globalId}`);
}

async function enqueue(
  globalId: Hex,
  amountIn: bigint,
  amountOutMin: bigint,
  permit: { nonce: string; deadline: string; witness: Hex; witnessTypeString: string; signature: Hex },
): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `insert into relayer_queue
       (invoice_id, payer, pay_in_token, amount_in, payout_token, amount_out_min,
        permit2_data, permit2_signature)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
     returning id`,
    [
      globalId,
      account.address.toLowerCase(),
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

async function pollUntilTerminal(submissionId: string): Promise<{ status: string; lastError?: string; settleTxHash?: string }> {
  for (let i = 0; i < 60; i++) { // up to 60 × 5s = 5 min
    const r = await pool.query<{ status: string; last_error: string | null; settle_tx_hash: string | null }>(
      "select status, last_error, settle_tx_hash from relayer_queue where id = $1",
      [submissionId],
    );
    const row = r.rows[0];
    if (!row) throw new Error("queue row vanished");
    if (["settled", "refunded", "failed"].includes(row.status)) {
      return { status: row.status, lastError: row.last_error ?? undefined, settleTxHash: row.settle_tx_hash ?? undefined };
    }
    process.stdout.write(`\r[e2e] waiting… status=${row.status} (t=${i * 5}s)`);
    await new Promise(r => setTimeout(r, 5000));
  }
  throw new Error("timed out waiting for terminal status");
}

async function main() {
  console.log(`[e2e] customer + relayer wallet: ${account.address}`);
  await ensurePermit2Approval();
  await ensureMerchantRegistered();

  const amountIn  = 200_000n; // 0.20 USDC
  const expectMin = 100_000n; // 0.10 EURC floor (well below market 0.18)
  const { globalId, merchantInvoiceId } = await createInvoice(expectMin);
  await ensureDbInvoice(globalId, merchantInvoiceId, expectMin);

  const permit = await buildAndSignPermit2(globalId, amountIn);
  console.log(`[e2e] signature ok, witness=${permit.witness}`);

  const submissionId = await enqueue(globalId, amountIn, expectMin, permit);
  console.log(`[e2e] queued submission=${submissionId}`);

  const terminal = await pollUntilTerminal(submissionId);
  console.log(`\n[e2e] terminal status=${terminal.status}`, terminal);

  if (terminal.status !== "settled") {
    process.exit(1);
  }
  await pool.end();
}

main().catch(async e => {
  console.error("[e2e] fatal:", e);
  await pool.end().catch(() => {});
  process.exit(1);
});
