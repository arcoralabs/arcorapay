/**
 * Apply migration 0008 (relayer_queue.permit2_tx_hash). Idempotent — uses
 * IF NOT EXISTS, safe to re-run.
 */
import "dotenv/config";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("missing DATABASE_URL");

async function main() {
  const c = new pg.Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    console.log("[0008] add relayer_queue.permit2_tx_hash");
    await c.query(`ALTER TABLE "relayer_queue" ADD COLUMN IF NOT EXISTS "permit2_tx_hash" text`);
    const r = await c.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'relayer_queue' AND column_name = 'permit2_tx_hash'`);
    console.log("[0008] permit2_tx_hash exists:", r.rows.length === 1);
  } finally { await c.end(); }
}

main().catch(e => { console.error(e); process.exit(1); });
