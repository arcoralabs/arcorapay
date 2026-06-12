import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock deps per repo convention (handler-import + mocked deps, see
// quote/route.test.ts and siwe/nonce/route.test.ts).
vi.mock("@/lib/db/client", () => ({
  db: { execute: vi.fn() },
}));

vi.mock("@/lib/chain/client", () => ({
  publicClient: { getBlockNumber: vi.fn() },
}));

// Stub drizzle sql tag so the route's `sql\`select 1\`` doesn't need a real
// driver (mirrors siwe-nonce-cleanup/route.test.ts).
vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual<any>("drizzle-orm");
  return { ...actual, sql: (strs: TemplateStringsArray, ...vals: any[]) => ({ strs, vals }) };
});

// In-memory limiter mirroring takeToken semantics (see siwe/nonce test). The
// route calls it best-effort; default is "always allowed".
let counts = new Map<string, number>();
vi.mock("@/lib/rate/limiter", () => ({
  takeToken: vi.fn(async (bucket: string, limit: number) => {
    const next = (counts.get(bucket) ?? 0) + 1;
    counts.set(bucket, next);
    return next <= limit;
  }),
}));

import { GET } from "./route";
import { version } from "../../../package.json";

function makeReq(ip = "1.2.3.4"): Request {
  return new Request("http://localhost/api/health", {
    headers: { "x-forwarded-for": ip },
  });
}

beforeEach(() => {
  counts = new Map();
  vi.clearAllMocks();
});

describe("GET /api/health", () => {
  it("returns 200 with ok:true when all deps are up", async () => {
    const db = await import("@/lib/db/client");
    const chain = await import("@/lib/chain/client");
    (db.db.execute as any).mockResolvedValue({ rows: [{ "?column?": 1 }] });
    (chain.publicClient.getBlockNumber as any).mockResolvedValue(123n);

    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body).toEqual({ ok: true, db: true, rpc: true, version });
    expect(typeof body.version).toBe("string");
    expect(body.version.length).toBeGreaterThan(0);
  });

  it("returns 503 with db:false when the DB check throws", async () => {
    const db = await import("@/lib/db/client");
    const chain = await import("@/lib/chain/client");
    (db.db.execute as any).mockRejectedValue(new Error("connection refused"));
    (chain.publicClient.getBlockNumber as any).mockResolvedValue(123n);

    const res = await GET(makeReq());
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false, db: false, rpc: true });
    expect(typeof body.version).toBe("string");
    expect(body.version.length).toBeGreaterThan(0);
  });

  it("returns 503 with rpc:false when the RPC check throws", async () => {
    const db = await import("@/lib/db/client");
    const chain = await import("@/lib/chain/client");
    (db.db.execute as any).mockResolvedValue({ rows: [{ "?column?": 1 }] });
    (chain.publicClient.getBlockNumber as any).mockRejectedValue(new Error("rpc down"));

    const res = await GET(makeReq());
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false, db: true, rpc: false });
  });

  it("returns 503 with db:false when the DB check times out (exceeds 3s)", async () => {
    const db = await import("@/lib/db/client");
    const chain = await import("@/lib/chain/client");
    // Never resolves within the timeout window.
    (db.db.execute as any).mockImplementation(() => new Promise(() => {}));
    (chain.publicClient.getBlockNumber as any).mockResolvedValue(123n);

    const res = await GET(makeReq());
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false, db: false, rpc: true });
  });

  it("does not leak secrets/urls/chain ids — body shape is exactly {ok,db,rpc,version}", async () => {
    const db = await import("@/lib/db/client");
    const chain = await import("@/lib/chain/client");
    (db.db.execute as any).mockResolvedValue({ rows: [{ "?column?": 1 }] });
    (chain.publicClient.getBlockNumber as any).mockResolvedValue(123n);

    const res = await GET(makeReq());
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["db", "ok", "rpc", "version"]);
  });

  it("returns 429 when the per-IP rate limit is exceeded", async () => {
    const db = await import("@/lib/db/client");
    const chain = await import("@/lib/chain/client");
    (db.db.execute as any).mockResolvedValue({ rows: [{ "?column?": 1 }] });
    (chain.publicClient.getBlockNumber as any).mockResolvedValue(123n);

    let res: Response | undefined;
    // Generous bucket (30/min). 31st call from one IP should 429.
    for (let i = 0; i < 31; i++) {
      res = await GET(makeReq("9.9.9.9"));
    }
    expect(res!.status).toBe(429);
  });

  it("still responds (health truth) even when the rate limiter itself is down", async () => {
    const db = await import("@/lib/db/client");
    const chain = await import("@/lib/chain/client");
    const limiter = await import("@/lib/rate/limiter");
    (db.db.execute as any).mockResolvedValue({ rows: [{ "?column?": 1 }] });
    (chain.publicClient.getBlockNumber as any).mockResolvedValue(123n);
    // Limiter depends on the DB; if it throws, health must not 500.
    (limiter.takeToken as any).mockRejectedValue(new Error("limiter db down"));

    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, db: true, rpc: true });
  });
});
