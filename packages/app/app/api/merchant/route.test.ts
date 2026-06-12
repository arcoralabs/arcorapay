import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/auth/apikey", () => ({
  generatePublishableKey: () => "pk_live_" + "Q".repeat(56),
  PREFIX_LEN: 12,
}));

const state: { merchantRow: any } = { merchantRow: null };
let selectCall = 0;
const updateSpy = vi.fn();

vi.mock("@/lib/db/client", () => ({
  db: {
    select: vi.fn(() => {
      selectCall++;
      if (selectCall === 1) {
        // merchants lookup
        return {
          from: () => ({
            where: () => ({ limit: () => Promise.resolve(state.merchantRow ? [state.merchantRow] : []) }),
          }),
        };
      }
      // invoices lookup
      return {
        from: () => ({ where: () => ({ orderBy: () => ({ limit: () => Promise.resolve([]) }) }) }),
      };
    }),
    update: vi.fn(() => ({
      set: (v: any) => ({ where: () => { updateSpy(v); return Promise.resolve(); } }),
    })),
  },
}));

import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  selectCall = 0;
  state.merchantRow = null;
});

describe("GET /api/merchant — publishable key (AFG-019)", () => {
  it("exposes the existing publishable key without rewriting it", async () => {
    const { getSession } = await import("@/lib/auth/session");
    (getSession as any).mockResolvedValue({ merchantAddress: "0xMerchant" });
    state.merchantRow = {
      id: "m1", address: "0xMerchant", payoutToken: "0xUSDC", webhookUrl: null,
      allowedOrigins: ["https://shop.example.com"],
      publishableKey: "pk_live_" + "E".repeat(56),
    };

    const res = await GET();
    const body = await res.json();
    expect(body.merchant.publishableKey).toBe("pk_live_" + "E".repeat(56));
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("lazily backfills a publishable key for a pre-AFG-019 merchant row", async () => {
    const { getSession } = await import("@/lib/auth/session");
    (getSession as any).mockResolvedValue({ merchantAddress: "0xMerchant" });
    state.merchantRow = {
      id: "m1", address: "0xMerchant", payoutToken: "0xUSDC", webhookUrl: null,
      allowedOrigins: [], publishableKey: "",
    };

    const res = await GET();
    const body = await res.json();
    expect(body.merchant.publishableKey).toMatch(/^pk_live_/);
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy.mock.calls[0]![0].publishableKey).toMatch(/^pk_live_/);
  });
});

describe("GET /api/merchant — cache hygiene (audit 2026-06-11 HIGH-3)", () => {
  it("marks authenticated responses Cache-Control: no-store, private", async () => {
    const { getSession } = await import("@/lib/auth/session");
    (getSession as any).mockResolvedValue({ merchantAddress: "0xMerchant" });
    state.merchantRow = {
      id: "m1", address: "0xMerchant", payoutToken: "0xUSDC", webhookUrl: null,
      allowedOrigins: [],
      publishableKey: "pk_live_" + "E".repeat(56),
    };

    const res = await GET();
    expect(res.headers.get("Cache-Control")).toBe("no-store, private");
  });

  it("marks the unauthorized error response no-store too", async () => {
    const { getSession } = await import("@/lib/auth/session");
    (getSession as any).mockResolvedValue({ merchantAddress: undefined });

    const res = await GET();
    expect(res.status).toBe(401);
    expect(res.headers.get("Cache-Control")).toBe("no-store, private");
  });
});
