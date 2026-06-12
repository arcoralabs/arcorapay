import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth/session", () => ({
  getSession: vi.fn(),
}));

const ORDER_BY_RES: any[] = [];
const aggregateRows: any[] = [];
const timeSeriesRows: any[] = [];

vi.mock("@/lib/db/client", () => {
  const builder = {
    select: vi.fn(),
    from: vi.fn(),
    where: vi.fn(),
    groupBy: vi.fn(),
    limit: vi.fn(),
    orderBy: vi.fn(),
  };
  // Sequence the route walks (current as of v1.x #2.1):
  //   1. select().from(merchants).where().limit(1)            → merchant row
  //   2. select().from(invoices).where().groupBy()             → aggregateRows
  //   3. select().from(invoices).where().groupBy()             → timeSeriesRows
  //   4. select().from(invoices).where().orderBy().limit(20)   → ORDER_BY_RES
  let call = 0;
  const reset = () => { call = 0; };
  (globalThis as any).__resetTreasuryMock = reset;

  builder.select.mockImplementation(() => builder);
  builder.from.mockImplementation(() => builder);
  builder.where.mockImplementation(() => builder);
  builder.limit.mockImplementation((_n: number) => {
    call += 1;
    if (call === 1) {
      return Promise.resolve([{ id: "merch-1", address: "0xMerchant", payoutToken: "0xUSDC" }]);
    }
    // limit(20) call lands here as the 4th call after merchant→aggregate→timeseries.
    return Promise.resolve(ORDER_BY_RES);
  });
  builder.groupBy.mockImplementation(() => {
    call += 1;
    // Second invocation is aggregates; third is the 30-day time series.
    return Promise.resolve(call === 2 ? aggregateRows : timeSeriesRows);
  });
  builder.orderBy.mockImplementation(() => builder);

  return {
    db: builder,
  };
});

// drizzle helpers used by the route — stub them so they don't break imports.
vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual<any>("drizzle-orm");
  return { ...actual, sql: (strs: TemplateStringsArray, ...vals: any[]) => ({ strs, vals }) };
});

import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  ORDER_BY_RES.length = 0;
  aggregateRows.length = 0;
  timeSeriesRows.length = 0;
  (globalThis as any).__resetTreasuryMock?.();
});

describe("GET /api/merchant/treasury", () => {
  it("rejects when there is no session", async () => {
    const sess = await import("@/lib/auth/session");
    (sess.getSession as any).mockResolvedValue({});
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns empty rollup when the merchant row is absent", async () => {
    const sess = await import("@/lib/auth/session");
    (sess.getSession as any).mockResolvedValue({ merchantAddress: "0xnobody" });

    // Override the first limit() to return [] (no merchant) for this case.
    const { db } = await import("@/lib/db/client");
    (db.limit as any).mockResolvedValueOnce([]);

    const res = await GET();
    const body = await res.json();
    expect(body).toMatchObject({ merchant: null, totals: [], activity: [] });
  });

  it("aggregates paid + refunded rows into per-token totals", async () => {
    const sess = await import("@/lib/auth/session");
    (sess.getSession as any).mockResolvedValue({ merchantAddress: "0xMerchant" });

    const USDC = "0x3600000000000000000000000000000000000000";
    aggregateRows.push(
      { payoutToken: USDC, status: "paid",     payoutSum: "999000",  feeSum: "1000", count: 1 },
      { payoutToken: USDC, status: "refunded", payoutSum: "999000",  feeSum: "1000", count: 1 },
    );
    ORDER_BY_RES.push({
      id: "0xinv1",
      payoutToken: USDC,
      payInToken:  "0xEURC",
      amountOut:   "1000000",
      merchantPayout: "999000",
      status: "refunded",
      paidAt:     new Date("2026-04-29T17:50:00Z"),
      paidTx:     "0xpay",
      refundedAt: new Date("2026-04-29T17:55:00Z"),
      refundTx:   "0xrefund",
    });

    const res = await GET();
    const body = await res.json();
    expect(body.totals).toHaveLength(1);
    const t = body.totals[0];
    expect(t.token).toBe(USDC);
    // paid=999000, refunded=999000 → net received should be 0 (paid out == refunded back)
    expect(t.received).toBe("0");
    // gross = paid + refunded
    expect(t.grossVolume).toBe("1998000");
    expect(t.refunded).toBe("999000");
    expect(t.feesPaid).toBe("2000");
    expect(t.paidCount).toBe(1);
    expect(t.refundedCount).toBe(1);
    // Activity: refundedAt newer than paidAt → eventAt should be the refundedAt timestamp.
    expect(body.activity[0].eventAt).toBe("2026-04-29T17:55:00.000Z");
    expect(body.activity[0].txHash).toBe("0xrefund");
  });

  it("flips received negative when refunds exceed payouts (sanity)", async () => {
    const sess = await import("@/lib/auth/session");
    (sess.getSession as any).mockResolvedValue({ merchantAddress: "0xMerchant" });

    const USDC = "0x3600000000000000000000000000000000000000";
    // One small paid, one larger historical refund attributed to this merchant in
    // some exotic accounting state — the route should not crash and should report
    // the negative `received`.
    aggregateRows.push(
      { payoutToken: USDC, status: "paid",     payoutSum: "100000", feeSum: "100",  count: 1 },
      { payoutToken: USDC, status: "refunded", payoutSum: "500000", feeSum: "500",  count: 1 },
    );

    const res = await GET();
    const body = await res.json();
    expect(body.totals[0].received).toBe("-400000");
  });
});
