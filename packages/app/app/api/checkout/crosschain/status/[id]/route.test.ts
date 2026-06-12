import { describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const INTENT_ID = "11111111-1111-4111-8111-111111111111";

const limitFn = vi.fn(async () => [
  {
    id: INTENT_ID,
    invoiceId: "0x" + "1".repeat(64),
    status: "bridge_pending",
    settleTxHash: null,
    lastError: null,
    updatedAt: new Date("2026-06-08T12:00:00Z"),
  },
]);

vi.mock("@/lib/db/client", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: limitFn,
        }),
      }),
    }),
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (a: any, b: any) => ({ a, b }),
}));

describe("GET /api/checkout/crosschain/status/[id]", () => {
  it("returns minimal crosschain payment status (pins full body contract)", async () => {
    const res = await GET(new Request("https://arcorapay.xyz") as any, {
      params: Promise.resolve({ id: INTENT_ID }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    // Pin the full response contract — proves absence of burnTxHash / sourceChainId / etc.
    expect(body).toEqual({
      intentId: INTENT_ID,
      invoiceId: "0x" + "1".repeat(64),
      status: "bridge_pending",
      settleTxHash: null,
      error: null,
      updatedAt: "2026-06-08T12:00:00.000Z",
    });
  });

  it("returns settleTxHash when status is paid", async () => {
    const PAID_ID = "44444444-4444-4444-8444-444444444444";
    const SETTLE_HASH = "0x" + "e".repeat(64);

    limitFn.mockResolvedValueOnce([
      {
        id: PAID_ID,
        invoiceId: "0x" + "4".repeat(64),
        status: "paid",
        settleTxHash: SETTLE_HASH,
        lastError: null,
        updatedAt: new Date("2026-06-08T15:00:00Z"),
      },
    ]);

    const res = await GET(new Request("https://arcorapay.xyz") as any, {
      params: Promise.resolve({ id: PAID_ID }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.settleTxHash).toBe(SETTLE_HASH);
    // Wallet-linking fields must not be present
    expect(body).not.toHaveProperty("burnTxHash");
    expect(body).not.toHaveProperty("bridgeReceiveTxHash");
    expect(body).not.toHaveProperty("arcSwapTxHash");
    expect(body).not.toHaveProperty("sourceChainId");
  });

  it("returns 404 for an unknown intent id", async () => {
    limitFn.mockResolvedValueOnce([]);

    const res = await GET(new Request("https://arcorapay.xyz") as any, {
      params: Promise.resolve({ id: "99999999-9999-4999-8999-999999999999" }),
    });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe("not_found");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("returns 404 and does not query db for an invalid (non-UUID) id", async () => {
    limitFn.mockClear();

    const res = await GET(new Request("https://arcorapay.xyz") as any, {
      params: Promise.resolve({ id: "not-a-uuid" }),
    });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe("not_found");
    expect(limitFn).not.toHaveBeenCalled();
  });

  it("exposes lastError only for failed states", async () => {
    limitFn.mockResolvedValueOnce([
      {
        id: "22222222-2222-4222-8222-222222222222",
        invoiceId: "0x" + "2".repeat(64),
        status: "bridge_failed",
        settleTxHash: null,
        lastError: "CCTP_ATTESTATION_TIMEOUT",
        updatedAt: new Date("2026-06-08T13:00:00Z"),
      },
    ]);

    const res = await GET(new Request("https://arcorapay.xyz") as any, {
      params: Promise.resolve({ id: "22222222-2222-4222-8222-222222222222" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.error).toBe("CCTP_ATTESTATION_TIMEOUT");
  });

  it("hides lastError on non-failed states", async () => {
    limitFn.mockResolvedValueOnce([
      {
        id: "33333333-3333-4333-8333-333333333333",
        invoiceId: "0x" + "3".repeat(64),
        status: "bridge_pending",
        settleTxHash: null,
        lastError: "transient_rpc_error",
        updatedAt: new Date("2026-06-08T14:00:00Z"),
      },
    ]);

    const res = await GET(new Request("https://arcorapay.xyz") as any, {
      params: Promise.resolve({ id: "33333333-3333-4333-8333-333333333333" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.error).toBeNull();
  });
});
