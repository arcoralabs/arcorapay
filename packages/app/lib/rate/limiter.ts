import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";

/**
 * Postgres-backed fixed-window rate limiter. Each call atomically increments
 * the counter for `(bucket, currentWindow)` via INSERT ... ON CONFLICT
 * UPDATE RETURNING, then compares the post-increment count against `limit`.
 *
 * - Returns `true` if the request is allowed (count <= limit).
 * - Returns `false` if the request is over the limit (and the row's count
 *   keeps incrementing — that's fine, the limiter is fixed-window not
 *   leaky-bucket).
 *
 * Window is anchored to wall-clock time / windowSec, so all callers within
 * the same second-aligned bucket see the same window — keeps the math
 * stateless across instances. We don't need stronger semantics than that
 * for the threat we're defending against (nonce flooding by a single IP).
 *
 * Audit M9 (2026-05-06).
 *
 * @param bucket    string keyed by route + caller (e.g. `siwe-nonce:1.2.3.4`)
 * @param limit     max events per window
 * @param windowSec window size in seconds
 */
export async function takeToken(
  bucket: string,
  limit: number,
  windowSec: number,
): Promise<boolean> {
  const windowStart = new Date(
    Math.floor(Date.now() / (windowSec * 1000)) * windowSec * 1000,
  );
  const result = await db.execute(sql`
    INSERT INTO rate_limit_counters (bucket, window_start, count)
    VALUES (${bucket}, ${windowStart}, 1)
    ON CONFLICT (bucket, window_start)
      DO UPDATE SET count = rate_limit_counters.count + 1
    RETURNING count
  `);
  // node-postgres / drizzle wraps results — `.rows[0].count` returns a
  // string OR number depending on driver settings. Coerce safely.
  const rows = (result as unknown as { rows?: ReadonlyArray<{ count: string | number }> }).rows;
  if (!rows || rows.length === 0) return true; // pathological: allow rather than block
  const count = Number(rows[0]!.count);
  return count <= limit;
}
