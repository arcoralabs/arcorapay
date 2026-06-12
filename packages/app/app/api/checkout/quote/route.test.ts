import { describe, it, expect, vi, beforeEach } from "vitest";

// In-memory limiter that mirrors `takeToken` semantics so the route under
// test exercises real 429 behaviour on the 31st call. Audit L7.
let counts = new Map<string, number>();

vi.mock("@/lib/rate/limiter", () => ({
  takeToken: vi.fn(async (bucket: string, limit: number) => {
    const next = (counts.get(bucket) ?? 0) + 1;
    counts.set(bucket, next);
    return next <= limit;
  }),
}));

// Minimal App Kit / adapter stubs so the route can be imported without real creds.
vi.mock("@circle-fin/app-kit", () => ({
  AppKit: vi.fn().mockImplementation(() => ({
    estimateSwap: vi.fn().mockResolvedValue({
      estimatedOutput: { amount: "1.000000", token: "USDC" },
      stopLimit: { amount: "0.990000", token: "USDC" },
      fees: [],
    }),
  })),
}));

vi.mock("@circle-fin/adapter-viem-v2", () => ({
  createViemAdapterFromPrivateKey: vi.fn().mockReturnValue({}),
}));

vi.mock("viem/accounts", () => ({
  generatePrivateKey: vi.fn().mockReturnValue("0x" + "ab".repeat(32)),
}));

vi.mock("@/lib/checkout/quote-server", () => ({
  quoteAmountIn: vi.fn().mockReturnValue(1000000n),
}));

import { POST } from "./route";

beforeEach(() => {
  counts = new Map();
  vi.stubEnv("KIT_KEY", "KIT_KEY:test-key");
});

function makeReq(ip: string, body: unknown = { payInToken: "USDC", payoutToken: "EURC", amountIn: "1.0" }) {
  return new Request("http://localhost/api/checkout/quote", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": ip,
    },
    body: JSON.stringify(body),
  }) as any;
}

describe("POST /api/checkout/quote — rate limit (L7)", () => {
  it("allows the first 30 requests from one IP", async () => {
    for (let i = 0; i < 30; i++) {
      const res = await POST(makeReq("10.0.0.1"));
      expect(res.status).toBe(200);
    }
  });

  it("returns 429 on the 31st request from the same IP within the window", async () => {
    for (let i = 0; i < 30; i++) {
      await POST(makeReq("10.0.0.1"));
    }
    const res = await POST(makeReq("10.0.0.1"));
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toBe("rate_limited");
    expect(res.headers.get("retry-after")).toBe("60");
  });

  it("a different IP is unaffected by another IP's burst", async () => {
    for (let i = 0; i < 30; i++) {
      await POST(makeReq("10.0.0.1"));
    }
    // 10.0.0.2 still has its full budget.
    const res = await POST(makeReq("10.0.0.2"));
    expect(res.status).toBe(200);
  });
});
