import { NextResponse, type NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { publicClient } from "@/lib/chain/client";
import { takeToken } from "@/lib/rate/limiter";
import { clientIp } from "@/lib/rate/clientIp";
import { version as pkgVersion } from "@/package.json";

/** Deploy identity: Vercel commit SHA when available, package version locally. */
const version = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? pkgVersion;

/**
 * Liveness/readiness probe for uptime monitoring (a VPS cron curls this).
 *
 * Design constraints (public-beta launch, Task 2):
 *   - Dependency-light, secret-free: the body is exactly { ok, db, rpc,
 *     version } — NO URLs, NO chain ids, NO secrets. Anyone can hit it.
 *   - Must not lie: each dependency is probed live (DB `select 1`, RPC
 *     `getBlockNumber`) and reported as a boolean. `ok` is the AND of all
 *     probes; status is 200 only when every probe passed, else 503.
 *   - Each probe is wrapped in a 3s timeout + try/catch so a hung dependency
 *     degrades to `false` rather than hanging the probe itself.
 *   - `Cache-Control: no-store` so no CDN/proxy serves a stale "healthy".
 *
 * Rate limiting is best-effort: the limiter is DB-backed, and the whole point
 * of this endpoint is to still answer when the DB is down. So the limiter call
 * is wrapped in try/catch and fails OPEN — a limiter outage must never turn a
 * health probe into a 500 or a false 429.
 */

const PROBE_TIMEOUT_MS = 3_000;
const RATE_LIMIT_PER_WINDOW = 30;
const RATE_WINDOW_SECONDS = 60;

/** Resolve `p` to a boolean: true if it settles ok within the timeout, false
 *  if it rejects OR exceeds `timeoutMs`. Never throws. */
async function probe(p: () => Promise<unknown>, timeoutMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      p(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
      }),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function GET(req: NextRequest) {
  // Best-effort, fail-open rate limit. The limiter touches the DB; if the DB
  // (or the limiter) is down, health must still report — so swallow errors and
  // treat them as "allowed".
  try {
    // Race the limiter against the probe timeout: a *hung* DB must not stall
    // the handler before the probes get to report { db: false }.
    const allowed = await Promise.race([
      takeToken(`health:${clientIp(req)}`, RATE_LIMIT_PER_WINDOW, RATE_WINDOW_SECONDS),
      new Promise<boolean>((resolve) => {
        const t = setTimeout(() => resolve(true), PROBE_TIMEOUT_MS);
        t.unref?.();
      }),
    ]);
    if (!allowed) {
      return NextResponse.json(
        { error: "rate_limited", retryAfterSeconds: RATE_WINDOW_SECONDS },
        {
          status: 429,
          headers: {
            "retry-after": String(RATE_WINDOW_SECONDS),
            "cache-control": "no-store",
          },
        },
      );
    }
  } catch {
    // Limiter outage — proceed with the probe.
  }

  const [dbOk, rpcOk] = await Promise.all([
    probe(() => db.execute(sql`select 1`), PROBE_TIMEOUT_MS),
    probe(() => publicClient.getBlockNumber(), PROBE_TIMEOUT_MS),
  ]);

  const ok = dbOk && rpcOk;
  return NextResponse.json(
    { ok, db: dbOk, rpc: rpcOk, version },
    { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
