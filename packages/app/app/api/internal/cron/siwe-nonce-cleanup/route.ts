import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";

/** Constant-time compare of two equal-length secrets. A length-mismatch
 *  early-return intentionally leaks whether the lengths match — acceptable
 *  here because CRON_SECRET is a static operator secret, not user input.
 *  timingSafeEqual requires equal-length buffers, hence the guard. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Daily housekeeping for the SIWE/rate-limit tables introduced in M9
 * (2026-05-06). Without this, both tables grow unbounded:
 *
 *   - `siwe_nonces`         — issued nonces stay forever (5-min TTL is
 *                              advisory; the verify route checks expires_at
 *                              but never deletes consumed/expired rows).
 *   - `rate_limit_counters` — fixed-window counters from past windows are
 *                              dead weight. Anything older than 1h is junk.
 *
 * Despite the "siwe-nonce" name (kept to preserve the Vercel cron path), the
 * counters DELETE below is bucket-agnostic: it is the canonical cleaner for
 * EVERY per-IP limiter (siwe-nonce, quote, quote-v06, authorize, submit,
 * invoices). Retiring this cron unbounds rate_limit_counters — replace it
 * before removing it (audit App-L-8, 2026-05-31).
 *
 * Auth: shared CRON_SECRET (matches the H4 cron pattern).
 */

export async function GET(req: NextRequest) {
  const provided = req.headers.get("authorization") ?? req.headers.get("x-cron-secret") ?? "";
  const expected = process.env.CRON_SECRET ?? "";
  const ok = !!expected && (safeEqual(provided, `Bearer ${expected}`) || safeEqual(provided, expected));
  if (!ok) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Delete expired SIWE nonces (5-min TTL but rows can outlive that without
  // verify ever consuming them).
  const noncesDeleted = await db.execute(sql`
    DELETE FROM siwe_nonces WHERE expires_at < now()
  `);
  // Delete rate-limit counters older than 1h. (Windows are 60s; 1h is a
  // generous safety margin in case anything ever uses a longer window.)
  const countersDeleted = await db.execute(sql`
    DELETE FROM rate_limit_counters WHERE window_start < now() - interval '1 hour'
  `);

  // pg returns rowCount on the result; drizzle's wrap exposes it on
  // result.rowCount. Reach for both shapes defensively.
  const noncesCount = Number(
    (noncesDeleted as { rowCount?: number; rows?: unknown[] }).rowCount ?? 0,
  );
  const countersCount = Number(
    (countersDeleted as { rowCount?: number; rows?: unknown[] }).rowCount ?? 0,
  );

  return NextResponse.json({
    ok: true,
    nonces_deleted:   noncesCount,
    counters_deleted: countersCount,
  });
}
