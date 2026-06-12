import { Pool } from "pg";
import * as bcryptjs from "bcryptjs";
import { randomBytes, createCipheriv } from "node:crypto";

// bcryptjs may export as default or as named exports depending on module resolution
const bcrypt = (bcryptjs as any).default ?? bcryptjs;

const URL = process.env.POSTGRES_URL ?? "postgres://postgres:postgres@localhost:5432/arcfx";

/** Encrypt a webhook secret using AES-256-GCM with the MASTER_KEY env var. */
function encryptSecret(plaintext: string): { iv: Buffer; ciphertext: Buffer } {
  const masterKey = process.env.MASTER_KEY;
  if (!masterKey) throw new Error("MASTER_KEY missing from env");
  const key = Buffer.from(masterKey, "base64");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = (cipher as any).getAuthTag();
  return { iv, ciphertext: Buffer.concat([enc, tag]) };
}

export function newPool() {
  return new Pool({ connectionString: URL });
}

export async function clearAll() {
  const pool = newPool();
  await pool.query("DELETE FROM webhook_attempts");
  await pool.query("DELETE FROM invoices");
  await pool.query("DELETE FROM merchants");
  await pool.query("DELETE FROM siwe_nonces");
  await pool.query("DELETE FROM indexer_state");
  await pool.end();
}

export async function seedMerchant(opts: {
  address?: string;
  apiKey?: string;
  webhookUrl?: string | null;
} = {}): Promise<{ merchantId: string; apiKey: string; address: string }> {
  const pool = newPool();
  const apiKey = opts.apiKey ?? "ak_live_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
  const apiKeyHash = await bcrypt.hash(apiKey, 10);
  const address = opts.address ?? "0xe8E5AAa3d8c705A07de02aADF98CE31F20A5754b";
  const { iv: webhookIv, ciphertext: webhookEnc } = encryptSecret("webhook_secret_placeholder");
  const result = await pool.query(
    `INSERT INTO merchants (address, payout_token, webhook_url, api_key_hash, webhook_secret_enc, webhook_secret_iv)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [address, "0x3600000000000000000000000000000000000000", opts.webhookUrl ?? null,
     apiKeyHash, webhookEnc, webhookIv],
  );
  await pool.end();
  return { merchantId: result.rows[0].id, apiKey, address };
}

interface SeedInvoiceOpts {
  merchantId: string;
  status?: "created" | "paid" | "expired" | "refunded";
  expiresAtSecondsFromNow?: number;
  payInToken?: string;
  payoutToken?: string;
  amountOut?: string;          // raw 6-dec units, default "49990000" (49.99)
  // Required for status=paid|refunded (so /m/treasury aggregations are sensible).
  amountIn?: string;
  merchantPayout?: string;
  protocolFee?: string;
  paidTx?: string;
  refundTx?: string;
}

export async function seedInvoice(opts: SeedInvoiceOpts): Promise<string> {
  const pool = newPool();
  const id    = "0x" + Buffer.from(crypto.randomUUID().replace(/-/g, "")).toString("hex").slice(0, 64);
  // merchant_invoice_id became NOT NULL with v0.4's namespacing; tests must mint one.
  const minv  = "0x" + Buffer.from(crypto.randomUUID().replace(/-/g, "")).toString("hex").slice(0, 64);
  const status = opts.status ?? "created";
  const isPaidLike = status === "paid" || status === "refunded";

  await pool.query(
    `INSERT INTO invoices (
       id, merchant_invoice_id, merchant_id,
       pay_in_token, payout_token, amount_out, expires_at, status, success_url,
       amount_in, merchant_payout, protocol_fee,
       paid_tx, paid_at,
       refund_tx, refunded_at
     ) VALUES (
       $1, $2, $3,
       $4, $5, $6, NOW() + ($7 || ' seconds')::interval, $8, $9,
       $10, $11, $12,
       $13, ${isPaidLike ? "NOW()" : "NULL"},
       $14, ${status === "refunded" ? "NOW()" : "NULL"}
     )`,
    [
      id,
      minv,
      opts.merchantId,
      opts.payInToken  ?? "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a", // EURC
      opts.payoutToken ?? "0x3600000000000000000000000000000000000000", // USDC
      opts.amountOut   ?? "49990000",
      opts.expiresAtSecondsFromNow ?? 1800,
      status,
      "http://localhost:4000/?paid=1",
      isPaidLike ? (opts.amountIn       ?? "49990000") : null,
      isPaidLike ? (opts.merchantPayout ?? "49940010") : null,
      isPaidLike ? (opts.protocolFee    ?? "49990")    : null,
      isPaidLike ? (opts.paidTx         ?? "0x" + "ab".repeat(32)) : null,
      status === "refunded" ? (opts.refundTx ?? "0x" + "cd".repeat(32)) : null,
    ],
  );
  await pool.end();
  return id;
}
