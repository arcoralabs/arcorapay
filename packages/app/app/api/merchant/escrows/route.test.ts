import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth/session", () => ({
  getSession: vi.fn(),
}));

vi.mock("@/lib/auth/apikey", () => ({
  lookupMerchantByApiKey: vi.fn(),
}));

// Module-level result arrays — tests populate these before each scenario.
const merchantRows: any[] = [];
const pendingRows: any[] = [];
const maturedRows: any[] = [];
const claimedRows: any[] = [];

vi.mock("@/lib/db/client", () => {
  // The route's session path issues these queries in order:
  //   1. select().from(merchants).where().limit(1)         → merchant row
  //   2. select().from(invoices).where().limit(PAGE_SIZE+1) → pending
  //   3. select().from(invoices).where().limit(PAGE_SIZE+1) → matured
  //   4. select().from(invoices).where().limit(PAGE_SIZE+1) → claimed
  // The API-key path skips (1) (merchant resolved via lookupMerchantByApiKey).
  // Calls 2-4 are issued concurrently via Promise.all; the mock resolves them
  // deterministically by counting .where() invocations.
  let callSeq = 0;
  let bucketSeqStart = 1; // 1 for session path, 0 for api-key path
  (globalThis as any).__resetEscrowMock = (apiKeyPath = false) => {
    callSeq = 0;
    bucketSeqStart = apiKeyPath ? 0 : 1;
  };

  const builder: any = {
    select: vi.fn().mockReturnThis(),
    from:   vi.fn().mockReturnThis(),
    where:  vi.fn(),
  };

  builder.where.mockImplementation(() => {
    callSeq++;
    const seq = callSeq;
    if (bucketSeqStart === 1 && seq === 1) {
      return { limit: (n: number) => Promise.resolve(merchantRows.slice(0, n)) };
    }
    const bucketIdx = seq - bucketSeqStart;
    if (bucketIdx === 1) return { limit: (n: number) => Promise.resolve(pendingRows.slice(0, n)) };
    if (bucketIdx === 2) return { limit: (n: number) => Promise.resolve(maturedRows.slice(0, n)) };
    return                { limit: (n: number) => Promise.resolve(claimedRows.slice(0, n)) };
  });

  return { db: builder };
});

vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual<any>("drizzle-orm");
  return { ...actual };
});

import { GET } from "./route";

function makeReq(headers: Record<string, string> = {}): NextRequest {
  const h = new Headers(headers);
  return { headers: h } as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  merchantRows.length = 0;
  pendingRows.length  = 0;
  maturedRows.length  = 0;
  claimedRows.length  = 0;
  merchantRows.push({ id: "merch-1", address: "0xMerchant", payoutToken: "0xUSDC" });
  (globalThis as any).__resetEscrowMock?.(false);
});

describe("GET /api/merchant/escrows", () => {
  it("returns 401 when unauthenticated and no API key supplied", async () => {
    const { getSession } = await import("@/lib/auth/session");
    (getSession as any).mockResolvedValue({});
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
  });

  it("returns pending + matured + claimed groups for the authed merchant (cookie path)", async () => {
    const { getSession } = await import("@/lib/auth/session");
    (getSession as any).mockResolvedValue({ merchantAddress: "0xMerchant" });

    const now = new Date();
    const future = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const past   = new Date(now.getTime() - 1000);

    pendingRows.push({ id: "0xinv-pending", status: "paid",    claimableAt: future });
    maturedRows.push({ id: "0xinv-matured", status: "paid",    claimableAt: past });
    claimedRows.push({ id: "0xinv-claimed", status: "claimed", claimableAt: past });

    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.counts.pending).toBe(1);
    expect(body.counts.matured).toBe(1);
    expect(body.counts.claimed).toBe(1);
    expect(body.pending[0].id).toBe("0xinv-pending");
    expect(body.matured[0].id).toBe("0xinv-matured");
    expect(body.claimed[0].id).toBe("0xinv-claimed");
    expect(body.truncated).toEqual({ pending: false, matured: false, claimed: false });
  });

  it("flags truncated=true when a bucket exceeds PAGE_SIZE (cookie path)", async () => {
    const { getSession } = await import("@/lib/auth/session");
    (getSession as any).mockResolvedValue({ merchantAddress: "0xMerchant" });

    // Fill pending with 201 rows — caps at 200, truncated.pending = true.
    for (let i = 0; i < 201; i++) {
      pendingRows.push({ id: `pend-${i}`, status: "paid", claimableAt: new Date(Date.now() + 60_000) });
    }

    const res = await GET(makeReq());
    const body = await res.json();
    expect(body.pending.length).toBe(200);
    expect(body.counts.pending).toBe(200);
    expect(body.truncated.pending).toBe(true);
    expect(body.truncated.matured).toBe(false);
    expect(body.truncated.claimed).toBe(false);
  });

  // Audit App-H1 (2026-05-24): SDK ships X-Arcora-Api-Key, not a session
  // cookie. Before this fix, sdk.escrows() always 401'd.
  it("authenticates via X-Arcora-Api-Key header (SDK path)", async () => {
    const { getSession } = await import("@/lib/auth/session");
    (getSession as any).mockResolvedValue({}); // no session
    const { lookupMerchantByApiKey } = await import("@/lib/auth/apikey");
    (lookupMerchantByApiKey as any).mockResolvedValue({ id: "merch-1", address: "0xMerchant" });
    (globalThis as any).__resetEscrowMock?.(true);

    pendingRows.push({ id: "0xsdk-pending", status: "paid", claimableAt: new Date(Date.now() + 60_000) });

    const res = await GET(makeReq({ "x-arcora-api-key": "ak_test_123" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pending[0].id).toBe("0xsdk-pending");
    expect(lookupMerchantByApiKey).toHaveBeenCalledWith("ak_test_123");
  });

  it("returns 401 when the X-Arcora-Api-Key header is present but invalid", async () => {
    const { getSession } = await import("@/lib/auth/session");
    (getSession as any).mockResolvedValue({});
    const { lookupMerchantByApiKey } = await import("@/lib/auth/apikey");
    (lookupMerchantByApiKey as any).mockResolvedValue(null);

    const res = await GET(makeReq({ "x-arcora-api-key": "ak_bogus" }));
    expect(res.status).toBe(401);
  });

  it("also accepts the legacy x-api-key header alias", async () => {
    const { getSession } = await import("@/lib/auth/session");
    (getSession as any).mockResolvedValue({});
    const { lookupMerchantByApiKey } = await import("@/lib/auth/apikey");
    (lookupMerchantByApiKey as any).mockResolvedValue({ id: "merch-1", address: "0xMerchant" });
    (globalThis as any).__resetEscrowMock?.(true);

    const res = await GET(makeReq({ "x-api-key": "ak_legacy_456" }));
    expect(res.status).toBe(200);
    expect(lookupMerchantByApiKey).toHaveBeenCalledWith("ak_legacy_456");
  });
});
