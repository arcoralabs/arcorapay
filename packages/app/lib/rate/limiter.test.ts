import { describe, it, expect, vi, beforeEach } from "vitest";

let counts = new Map<string, number>();

vi.mock("@/lib/db/client", () => ({
  db: {
    execute: vi.fn(async (q: any) => {
      // The test exercises the limiter logic against an in-memory map keyed
      // by the bucket name + window_start. We don't introspect the SQL; we
      // assume any execute() call here is the INSERT-OR-UPDATE-RETURNING
      // statement and bump the most-recently-seen bucket counter.
      // The bucket+window_start are encoded in q.queryChunks (drizzle's
      // SQL.raw shape) — the test doesn't need to parse it precisely; it
      // just needs sequential calls within a window to share state.
      // We rely on the test's beforeEach to control window membership.
      const key = (q?.__bucketKey ?? lastBucketKey)!;
      const next = (counts.get(key) ?? 0) + 1;
      counts.set(key, next);
      return { rows: [{ count: next }] };
    }),
  },
}));

let lastBucketKey: string | null = null;

vi.mock("drizzle-orm", () => ({
  // We hijack `sql` so every limiter call captures the bucket+window key.
  // The limiter passes (bucket, windowStart) as template-literal interpolations.
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => {
    // takeToken's call shape: sql`INSERT ... VALUES (${bucket}, ${windowStart}, 1) ...`
    const bucket = String(values[0] ?? "");
    const windowStart = (values[1] as Date)?.getTime?.() ?? 0;
    lastBucketKey = `${bucket}@${windowStart}`;
    return { __bucketKey: lastBucketKey };
  },
}));

import { takeToken } from "./limiter";

beforeEach(() => {
  counts = new Map();
  lastBucketKey = null;
});

describe("takeToken (M9)", () => {
  it("allows up to `limit` calls per window then rejects further ones", async () => {
    const results: boolean[] = [];
    for (let i = 0; i < 12; i++) {
      results.push(await takeToken("test:ip-1", 10, 60));
    }
    // First 10 allowed, last 2 over the limit.
    expect(results.slice(0, 10).every(Boolean)).toBe(true);
    expect(results.slice(10)).toEqual([false, false]);
  });

  it("isolates buckets — a different IP isn't affected by another IP's count", async () => {
    for (let i = 0; i < 10; i++) {
      await takeToken("test:ip-noisy", 10, 60);
    }
    // ip-noisy is at 10. ip-quiet should still get its first nonce.
    const r1 = await takeToken("test:ip-quiet", 10, 60);
    expect(r1).toBe(true);
    const noisyOver = await takeToken("test:ip-noisy", 10, 60);
    expect(noisyOver).toBe(false);
  });

  it("rejects on the boundary — the 11th call within a window is denied", async () => {
    let firstReject = -1;
    for (let i = 0; i < 15; i++) {
      const ok = await takeToken("test:edge", 10, 60);
      if (!ok && firstReject < 0) firstReject = i;
    }
    expect(firstReject).toBe(10); // 0-indexed; first ten allowed, eleventh denied
  });
});
