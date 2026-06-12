/**
 * DEV-ONLY smoke test for the cross-chain v2 pipeline.
 * Connects to the same Postgres the relayer daemon uses and queries
 * crosschain_payments row counts by status. Requires no funded wallet
 * or live RPC — it only exercises the DB connection and TLS guard.
 *
 * Usage:
 *   pnpm --filter arcora-relayer smoke:crosschain
 *
 * Or with an explicit DSN override (e.g. local Docker Postgres):
 *   POSTGRES_URL_NON_POOLING="postgres://postgres:postgres@localhost:5432/arcfx" \
 *     pnpm --filter arcora-relayer smoke:crosschain
 */

import pg from "pg";
import { buildOpsPoolConfig, assertSecureDbTls } from "./db.js";

const pgUrl = process.env.POSTGRES_URL_NON_POOLING;
if (!pgUrl) throw new Error("missing POSTGRES_URL_NON_POOLING");

const cfg = buildOpsPoolConfig(pgUrl);
assertSecureDbTls(cfg);
const pool = new pg.Pool(cfg);

const rows = await pool.query(`
  select status, count(*)::int as count
    from crosschain_payments
   group by status
   order by status
`);

console.log(JSON.stringify({
  ok: true,
  crosschainPaymentsByStatus: rows.rows,
}, null, 2));

await pool.end();
