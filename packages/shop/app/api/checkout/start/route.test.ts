import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { POST } from "./route";

const ORIG_FETCH = globalThis.fetch;
const ORIG_KEY = process.env.ARCORA_API_KEY;

beforeEach(() => {
  process.env.ARCORA_API_KEY = "ak_live_test";
  // Upstream /api/invoices stub — captures what the shop forwards.
  globalThis.fetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ invoiceId: "0xabc", url: "https://arcorapay.xyz/i/0xabc" }), {
      status: 201, headers: { "content-type": "application/json" },
    }),
  ) as any;
});
afterAll(() => {
  globalThis.fetch = ORIG_FETCH;
  if (ORIG_KEY === undefined) delete process.env.ARCORA_API_KEY; else process.env.ARCORA_API_KEY = ORIG_KEY;
});

const ADDRESS = {
  email: "a@b.com", fullName: "A B", line1: "1 St", city: "X", postalCode: "1", country: "US",
};

function makeReq(body: unknown, ip = "1.2.3.4") {
  return new Request("https://shop.test/api/checkout/start", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  }) as any;
}

function forwardedAmount(): number {
  const call = (globalThis.fetch as any).mock.calls[0];
  return JSON.parse(call[1].body).amountUsdc;
}

describe("POST /api/checkout/start — AFG-003 server-priced cart", () => {
  it("ignores client-supplied price and uses the server catalog (10 tees = $99.90, not $0.10)", async () => {
    const res = await POST(makeReq({
      items: [{ sku: "tee", name: "Hacked", price: 0.01, qty: 10, size: "M" }],
      address: ADDRESS, payIn: "USDC",
    }));
    expect(res.status).toBe(200);
    expect(forwardedAmount()).toBe(99.9);
  });

  it("rejects an unknown SKU with 400 and makes no upstream call", async () => {
    const res = await POST(makeReq({
      items: [{ sku: "rolex", price: 0.01, qty: 1 }],
      address: ADDRESS, payIn: "USDC",
    }));
    expect(res.status).toBe(400);
    expect((globalThis.fetch as any)).not.toHaveBeenCalled();
  });

  it("rejects quantity above the per-line bound (10) with 400", async () => {
    const res = await POST(makeReq({
      items: [{ sku: "cap", qty: 9999 }],
      address: ADDRESS, payIn: "USDC",
    }));
    expect(res.status).toBe(400);
    expect((globalThis.fetch as any)).not.toHaveBeenCalled();
  });

  it("rejects a size that isn't offered for the product", async () => {
    const res = await POST(makeReq({
      items: [{ sku: "tee", qty: 1, size: "XXXL" }],
      address: ADDRESS, payIn: "USDC",
    }));
    expect(res.status).toBe(400);
  });

  it("computes a multi-line total from the catalog", async () => {
    const res = await POST(makeReq({
      items: [{ sku: "cap", qty: 2 }, { sku: "mug", qty: 1 }, { sku: "tee", qty: 1, size: "L" }],
      address: ADDRESS, payIn: "USDC",
    }));
    expect(res.status).toBe(200);
    expect(forwardedAmount()).toBe(39.96); // 4 × 9.99
  });

  it("still rejects an empty cart and a bad pay token", async () => {
    expect((await POST(makeReq({ items: [], address: ADDRESS, payIn: "USDC" }))).status).toBe(400);
    expect((await POST(makeReq({ items: [{ sku: "cap", qty: 1 }], address: ADDRESS, payIn: "DOGE" }))).status).toBe(400);
  });
});
