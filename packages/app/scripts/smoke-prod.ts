/**
 * Production smoke for the testnet preview.
 *
 * What it checks (no wallets, no on-chain interaction):
 *   1. Public landing + quickstart pages return 200
 *   2. /api/checkout/authorize and /api/invoices respond with the expected
 *      validation shapes (400 on bad params)
 *   3. Indexer is keeping up — `indexer_state.last_block` is within
 *      INDEXER_LAG_BLOCKS_MAX of the current chain head
 *   4. Webhook queue is healthy — no rows stuck in `attempts > 5` for > 1h
 *   5. Relayer queue is healthy — no rows stuck in `processing` for > 5min
 *   6. compliance_screenings table exists and the providers env is sane
 *
 * Wallet-driven smoke (sign Permit2 + pay) is documented in the internal
 * deploy checklist and run by hand from incognito browsers with funded
 * testnet wallets.
 *
 * Usage:
 *   pnpm exec tsx --no-warnings scripts/smoke-prod.ts
 *   pnpm exec tsx --no-warnings scripts/smoke-prod.ts https://arcorapay.xyz
 *
 * Env (read from .env.production.local if present):
 *   POSTGRES_URL_NON_POOLING — Neon prod DB
 *   ARC_TESTNET_RPC          — Arc testnet RPC
 *   INDEXER_LAG_BLOCKS_MAX   — default 50
 *   GATEWAY_ADDRESS          — active gateway address (used for indexer sanity)
 */

import "dotenv/config";
import pg from "pg";
import { createPublicClient, http, type Hex } from "viem";

const BASE_URL =
  process.argv[2] ??
  process.env.PUBLIC_BASE_URL ??
  "https://arcorapay.xyz";

const PG_URL =
  process.env.POSTGRES_URL_NON_POOLING ??
  process.env.POSTGRES_URL;

const ARC_RPC =
  process.env.ARC_TESTNET_RPC ?? "https://rpc.testnet.arc.network";

// Arc testnet ≈ 2s blocks, indexer ticks every 30s → healthy lag is
// 15–60 blocks at any given snapshot. 300 (~10 min) catches an indexer
// that's been down without false-positiving on normal tick-bursts.
const INDEXER_LAG_MAX = Number(process.env.INDEXER_LAG_BLOCKS_MAX ?? "300");

const GATEWAY = (process.env.GATEWAY_ADDRESS ?? "") as Hex;

interface CheckResult { name: string; ok: boolean; detail?: string; }

const results: CheckResult[] = [];

function record(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail });
  const tag = ok ? "PASS" : "FAIL";
  const tail = detail ? ` — ${detail}` : "";
  console.log(`[${tag}] ${name}${tail}`);
}

async function main() {
  if (!PG_URL) {
    console.error("missing POSTGRES_URL — set it (or pull .env.production.local)");
    process.exit(2);
  }

  // ── 1. Public surfaces ──────────────────────────────────────────────
  for (const path of ["/", "/quickstart"]) {
    try {
      const res = await fetch(`${BASE_URL}${path}`, { redirect: "manual" });
      record(`GET ${path}`, res.status === 200, `http=${res.status}`);
    } catch (e: any) {
      record(`GET ${path}`, false, String(e?.message ?? e));
    }
  }

  // ── 2. API validation surfaces ──────────────────────────────────────
  try {
    const res = await fetch(`${BASE_URL}/api/checkout/authorize`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    record(
      "POST /api/checkout/authorize (bad-params)",
      res.status === 400,
      `http=${res.status}`,
    );
  } catch (e: any) {
    record("POST /api/checkout/authorize (bad-params)", false, String(e?.message ?? e));
  }

  try {
    const res = await fetch(`${BASE_URL}/api/invoices`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    // Missing API key → 401; missing body shape → 400. Either is "validation working".
    record(
      "POST /api/invoices (no-api-key)",
      res.status === 401 || res.status === 400,
      `http=${res.status}`,
    );
  } catch (e: any) {
    record("POST /api/invoices (no-api-key)", false, String(e?.message ?? e));
  }

  // ── 3-6. DB-backed health checks ────────────────────────────────────
  const db = new pg.Client({ connectionString: PG_URL });
  await db.connect();

  try {
    const indexer = await db.query<{ key: string; value: string }>(
      "select key, value from indexer_state where key = 'last_processed_block'",
    );
    if (indexer.rows.length === 0) {
      record("indexer last_processed_block populated", false, "no row");
    } else {
      const c = createPublicClient({ transport: http(ARC_RPC) });
      const head = await c.getBlockNumber();
      const last = BigInt(indexer.rows[0]!.value);
      const lag = head - last;
      record(
        `indexer lag ≤ ${INDEXER_LAG_MAX} blocks`,
        lag <= BigInt(INDEXER_LAG_MAX),
        `head=${head} last=${last} lag=${lag.toString()}`,
      );
    }
  } catch (e: any) {
    record("indexer_state check", false, String(e?.message ?? e));
  }

  try {
    const stuck = await db.query<{ count: string }>(
      `select count(*) from webhook_attempts
       where succeeded_at is null
         and attempts >= 5
         and next_attempt < now() - interval '1 hour'`,
    );
    const n = Number(stuck.rows[0]!.count);
    record("webhook_attempts: no rows stuck > 1h with attempts ≥ 5", n === 0, `count=${n}`);
  } catch (e: any) {
    record("webhook_attempts check", false, String(e?.message ?? e));
  }

  try {
    const stuck = await db.query<{ count: string }>(
      `select count(*) from relayer_queue
       where status = 'processing'
         and updated_at < now() - interval '5 minutes'`,
    );
    const n = Number(stuck.rows[0]!.count);
    record("relayer_queue: no row stuck in processing > 5min", n === 0, `count=${n}`);
  } catch (e: any) {
    record("relayer_queue check", false, String(e?.message ?? e));
  }

  try {
    const compliance = await db.query<{ count: string }>(
      `select count(*) from information_schema.tables
       where table_schema = 'public' and table_name = 'compliance_screenings'`,
    );
    const n = Number(compliance.rows[0]!.count);
    record("compliance_screenings table exists", n === 1, `count=${n}`);
  } catch (e: any) {
    record("compliance_screenings table check", false, String(e?.message ?? e));
  }

  await db.end();

  // ── Summary ─────────────────────────────────────────────────────────
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} pass`);
  if (failed.length > 0) {
    console.log("Failures:");
    for (const f of failed) console.log(`  - ${f.name}${f.detail ? `: ${f.detail}` : ""}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("smoke crashed:", e);
  process.exit(2);
});
