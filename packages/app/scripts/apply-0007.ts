/**
 * Apply migration 0007 (checkout_authorizations + relayer_queue partial
 * unique index) directly via SQL exec. Drizzle migration tracking is empty
 * on prod (legacy quirk — see compliance_phase0 memory) so we apply by
 * statement to be idempotent and explicit. Each statement uses IF NOT
 * EXISTS so re-running is safe.
 */
import "dotenv/config";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("missing DATABASE_URL");

const STATEMENTS: { name: string; sql: string }[] = [
  {
    name: "create checkout_authorizations table",
    sql: `CREATE TABLE IF NOT EXISTS "checkout_authorizations" (
      "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "invoice_id"    text NOT NULL REFERENCES "invoices"("id") ON DELETE CASCADE,
      "payer"         text NOT NULL,
      "pay_in_token"  text NOT NULL,
      "min_amount_in" numeric NOT NULL,
      "expires_at"    timestamp with time zone NOT NULL,
      "consumed_at"   timestamp with time zone,
      "created_at"    timestamp with time zone NOT NULL DEFAULT now()
    )`,
  },
  {
    name: "index checkout_authorizations active lookup",
    sql: `CREATE INDEX IF NOT EXISTS "idx_checkout_auth_active"
      ON "checkout_authorizations" ("invoice_id", "payer")
      WHERE "consumed_at" IS NULL`,
  },
  {
    name: "partial unique index on relayer_queue active invoices",
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS "uniq_relayer_queue_active_invoice"
      ON "relayer_queue" ("invoice_id")
      WHERE status IN ('pending','processing','settled')`,
  },
];

async function main() {
  const c = new pg.Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    for (const stmt of STATEMENTS) {
      console.log(`[0007] ${stmt.name}`);
      await c.query(stmt.sql);
      console.log(`[0007] ✓ ${stmt.name}`);
    }
    const t = await c.query(
      "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name='checkout_authorizations'",
    );
    console.log("[0007] checkout_authorizations exists:", t.rows[0]?.n === 1);
  } finally { await c.end(); }
}

main().catch(e => { console.error(e); process.exit(1); });
