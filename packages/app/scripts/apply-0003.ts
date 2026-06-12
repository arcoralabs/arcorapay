/**
 * One-shot migration runner for 0003_dizzy_mephisto. The auto-generated SQL
 * combines `ALTER TYPE ... ADD VALUE` with other DDL, but Postgres won't
 * commit an enum-add inside a multi-statement transaction. We split here
 * and run each statement on its own. Idempotent.
 */
import "dotenv/config";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("missing DATABASE_URL");

const STATEMENTS: { name: string; sql: string }[] = [
  {
    name: "create relayer_queue_status enum",
    sql:  `CREATE TYPE "relayer_queue_status" AS ENUM('pending','processing','settled','refunded','failed')`,
  },
  {
    name: "add 'failed' to invoice_status",
    sql:  `ALTER TYPE "invoice_status" ADD VALUE IF NOT EXISTS 'failed'`,
  },
  {
    name: "create relayer_queue table",
    sql: `CREATE TABLE IF NOT EXISTS "relayer_queue" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "invoice_id" text NOT NULL,
      "payer" text NOT NULL,
      "pay_in_token" text NOT NULL,
      "amount_in" numeric NOT NULL,
      "payout_token" text NOT NULL,
      "amount_out_min" numeric NOT NULL,
      "permit2_data" jsonb NOT NULL,
      "permit2_signature" text NOT NULL,
      "status" "relayer_queue_status" DEFAULT 'pending' NOT NULL,
      "attempts" integer DEFAULT 0 NOT NULL,
      "last_error" text,
      "swap_tx_hash" text,
      "settle_tx_hash" text,
      "refund_tx_hash" text,
      "next_attempt" timestamp with time zone DEFAULT now() NOT NULL,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL,
      "updated_at" timestamp with time zone DEFAULT now() NOT NULL
    )`,
  },
  {
    name: "add foreign key to invoices",
    sql: `DO $$ BEGIN
      ALTER TABLE "relayer_queue"
      ADD CONSTRAINT "relayer_queue_invoice_id_invoices_id_fk"
      FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id");
    EXCEPTION
      WHEN duplicate_object THEN null;
    END $$`,
  },
  {
    name: "index for queue scan",
    sql: `CREATE INDEX IF NOT EXISTS "idx_relayer_queue_pending"
          ON "relayer_queue" ("next_attempt")
          WHERE status IN ('pending','processing')`,
  },
];

async function main() {
  const client = new pg.Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    for (const stmt of STATEMENTS) {
      console.log(`[0003] ${stmt.name}`);
      try {
        await client.query(stmt.sql);
        console.log(`[0003] ✓ ${stmt.name}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("already exists")) {
          console.log(`[0003] ↺ ${stmt.name} (already applied)`);
        } else {
          console.error(`[0003] ✗ ${stmt.name}: ${msg}`);
          throw err;
        }
      }
    }
    const r = await client.query("select unnest(enum_range(null::invoice_status))::text as v");
    console.log("[0003] invoice_status now:", r.rows.map(r => r.v));
    const t = await client.query(
      "select count(*)::int as n from information_schema.tables where table_name='relayer_queue'",
    );
    console.log("[0003] relayer_queue exists:", t.rows[0]?.n === 1);
  } finally {
    await client.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
