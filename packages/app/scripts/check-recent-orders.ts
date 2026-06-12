import "dotenv/config";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("missing DATABASE_URL");

async function main() {
  const c = new pg.Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    console.log("\n=== last 5 invoices ===");
    const inv = await c.query(`
      SELECT id, status, pay_in_token, payout_token, amount_out, amount_in, refund_tx, paid_tx, created_at, paid_at, refunded_at
      FROM invoices
      ORDER BY created_at DESC
      LIMIT 5
    `);
    for (const r of inv.rows) console.log(JSON.stringify(r, null, 2));

    console.log("\n=== last 5 relayer_queue rows ===");
    const q = await c.query(`
      SELECT id, invoice_id, status, attempts, last_error, swap_tx_hash, settle_tx_hash, refund_tx_hash, created_at, updated_at
      FROM relayer_queue
      ORDER BY created_at DESC
      LIMIT 5
    `);
    for (const r of q.rows) console.log(JSON.stringify(r, null, 2));
  } finally { await c.end(); }
}
main().catch(e => { console.error(e); process.exit(1); });
