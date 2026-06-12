import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// Mock the db client so no real Postgres connection is needed.
vi.mock("@/lib/db/client", () => ({
  db: {
    execute: vi.fn().mockResolvedValue({ rowCount: 0 }),
  },
}));

// Stub drizzle sql tag so the route's template literal calls don't fail.
vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual<any>("drizzle-orm");
  return { ...actual, sql: (strs: TemplateStringsArray, ...vals: any[]) => ({ strs, vals }) };
});

import { GET } from "./route";

const SECRET = "test-cron-secret-xyz";

function makeRequest(authHeader?: string, xCronSecret?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (authHeader) headers["authorization"] = authHeader;
  if (xCronSecret) headers["x-cron-secret"] = xCronSecret;
  return new NextRequest("http://localhost/api/internal/cron/siwe-nonce-cleanup", { headers });
}

let originalSecret: string | undefined;

beforeEach(() => {
  originalSecret = process.env.CRON_SECRET;
  vi.clearAllMocks();
});

afterEach(() => {
  if (originalSecret === undefined) {
    delete process.env.CRON_SECRET;
  } else {
    process.env.CRON_SECRET = originalSecret;
  }
});

describe("GET /api/internal/cron/siwe-nonce-cleanup", () => {
  it("returns 401 when CRON_SECRET is set but no authorization header is provided", async () => {
    process.env.CRON_SECRET = SECRET;
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toMatchObject({ error: "unauthorized" });
  });

  it("returns 401 when CRON_SECRET is set but the wrong secret is provided", async () => {
    process.env.CRON_SECRET = SECRET;
    const res = await GET(makeRequest("Bearer wrong-secret"));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toMatchObject({ error: "unauthorized" });
  });

  it("returns 200 with ok:true when the correct Bearer token is provided", async () => {
    process.env.CRON_SECRET = SECRET;
    const res = await GET(makeRequest(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true });
  });

  it("returns 200 when the correct bare secret (no Bearer prefix) is provided", async () => {
    process.env.CRON_SECRET = SECRET;
    const res = await GET(makeRequest(SECRET));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true });
  });

  it("returns 200 when the correct bare secret is provided in x-cron-secret header", async () => {
    process.env.CRON_SECRET = SECRET;
    const res = await GET(makeRequest(undefined, SECRET));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true });
  });

  it("returns 401 (fail-closed) when CRON_SECRET is not set", async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(makeRequest(`Bearer ${SECRET}`));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toMatchObject({ error: "unauthorized" });
  });
});
