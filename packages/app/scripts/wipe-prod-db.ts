/**
 * Destructive: wipes app data for a clean re-onboarding pass. Preserves
 * __drizzle_migrations, indexer_state, and server_wallets.
 *
 * Usage:  pnpm tsx scripts/wipe-prod-db.ts --yes
 *
 * Without --yes the script prints what it would do and exits.
 */
import "dotenv/config";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("missing DATABASE_URL");

const TABLES_TO_WIPE = [
  "webhook_attempts",
  "compliance_screenings",
  "relayer_queue",
  "invoices",
  "merchants",
  "siwe_nonces",
] as const;

const PRESERVED = ["__drizzle_migrations", "indexer_state", "server_wallets"] as const;

async function main() {
  const confirmed = process.argv.includes("--yes");
  const client = new pg.Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  console.log("[wipe] target tables:", TABLES_TO_WIPE.join(", "));
  console.log("[wipe] preserved:", PRESERVED.join(", "));

  const before: Record<string, number> = {};
  for (const t of TABLES_TO_WIPE) {
    const r = await client.query(`SELECT count(*)::int AS n FROM ${t}`);
    before[t] = r.rows[0]?.n ?? 0;
  }
  console.log("[wipe] row counts before:", before);

  if (!confirmed) {
    console.log("[wipe] dry run — pass --yes to actually truncate");
    await client.end();
    return;
  }

  try {
    await client.query("BEGIN");
    await client.query(
      `TRUNCATE TABLE ${TABLES_TO_WIPE.join(", ")} RESTART IDENTITY CASCADE`,
    );
    await client.query("COMMIT");
    console.log("[wipe] truncate ok");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  }

  const after: Record<string, number> = {};
  for (const t of TABLES_TO_WIPE) {
    const r = await client.query(`SELECT count(*)::int AS n FROM ${t}`);
    after[t] = r.rows[0]?.n ?? 0;
  }
  console.log("[wipe] row counts after:", after);

  await client.end();
}

main().catch(e => { console.error(e); process.exit(1); });
