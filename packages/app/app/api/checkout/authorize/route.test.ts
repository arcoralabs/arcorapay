import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "./route";

vi.mock("@/lib/rate/limiter", () => ({
  takeToken: vi.fn(async () => true),
}));

vi.mock("@/lib/db/client", () => ({ db: {} }));

vi.mock("@/lib/compliance/factory", () => ({
  resolveComplianceProvider: vi.fn(),
}));

vi.mock("@/lib/compliance/screen", () => ({
  screenWithAudit: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: any[]) => args,
  eq:  (a: any, b: any) => ({ a, b }),
  gt:  (a: any, b: any) => ({ a, b }),
  isNull: (a: any) => ({ a }),
  desc: (x: any) => x,
}));

// Server-side App Kit estimate — we never let it be invoked in these tests
// (every invoice we set up uses same-token, which short-circuits the helper).
vi.mock("@/lib/checkout/quote-server", () => ({
  estimateSwapForTarget: vi.fn(async () => ({
    recommendedPayInBaseUnits: 0n,
    estimatedOutputBaseUnits:  0n,
  })),
}));

const dbMod = await import("@/lib/db/client");
const factoryMod = await import("@/lib/compliance/factory");
const screenMod = await import("@/lib/compliance/screen");
const limiterMod = await import("@/lib/rate/limiter");

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.COMPLIANCE_FAIL_OPEN_FOR_PAY;
  // Default: invoice + merchant rows exist; webhook insert is a no-op.
  // Same-token invoice (USDC pay-in, USDC payout) avoids the App Kit quote
  // path. Tests that need different shapes override these directly.
  let selectCount = 0;
  (dbMod.db as any).select = () => ({
    from: () => ({
      where: () => ({
        limit: async () => {
          selectCount++;
          if (selectCount === 1) {
            return [{
              id:           "0x" + "a".repeat(64),
              status:       "created",
              merchantId:   "00000000-0000-0000-0000-000000000001",
              payInToken:   "0x3600000000000000000000000000000000000000",
              payoutToken:  "0x3600000000000000000000000000000000000000",
              amountOut:    "100000000",
            }];
          }
          return [{ webhookUrl: null }];
        },
      }),
    }),
  });
  (dbMod.db as any).insert = () => ({
    values: (row: any) => ({
      // .returning() shape used by insertOrFetchAuth (M10 idempotent insert)
      returning: vi.fn().mockResolvedValue([{
        id: "auth-1",
        minAmountIn: row?.minAmountIn ?? "0",
        expiresAt: row?.expiresAt ?? new Date(),
      }]),
      onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
      then: (resolve: any) => Promise.resolve(undefined).then(resolve),
    }),
  });
});

const ADDR = "0x3687d36e8b0fee06bcd935b6312ca5b59f8e4317";
const INV = "0x" + "a".repeat(64);

function req(body: any) {
  return new Request("http://localhost/api/checkout/authorize", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

describe("POST /api/checkout/authorize", () => {
  it("allows when screen returns risk=low", async () => {
    (factoryMod.resolveComplianceProvider as any).mockReturnValue({ name: "noop" });
    (screenMod.screenWithAudit as any).mockResolvedValue({
      decision: "allow", risk: "low", ticketId: null, ttlSeconds: 86400,
      cachedAt: new Date(), reasons: [], providerSnapshot: {}, rowId: "r1", cached: false,
    });
    const res = await POST(req({ invoiceId: INV, address: ADDR }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.decision).toBe("allow");
    expect(body.ttlSeconds).toBe(86400);
  });

  it("returns review with ticketId on risk=medium", async () => {
    (factoryMod.resolveComplianceProvider as any).mockReturnValue({ name: "elliptic" });
    (screenMod.screenWithAudit as any).mockResolvedValue({
      decision: "review", risk: "medium", ticketId: "rev_abc",
      ttlSeconds: 86400, cachedAt: new Date(), reasons: ["mid_exposure"],
      providerSnapshot: {}, rowId: "r2", cached: false,
    });
    const res = await POST(req({ invoiceId: INV, address: ADDR }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.decision).toBe("review");
    expect(body.ticketId).toBe("rev_abc");
    // Customer-facing reason MUST NOT leak provider details
    expect(JSON.stringify(body)).not.toContain("mid_exposure");
  });

  it("returns reject on sanctions match without leaking provider reasoning", async () => {
    (factoryMod.resolveComplianceProvider as any).mockReturnValue({ name: "trmlabs" });
    (screenMod.screenWithAudit as any).mockResolvedValue({
      decision: "reject", risk: "sanctions", ticketId: null,
      ttlSeconds: 3600, cachedAt: new Date(),
      reasons: ["OFAC: tornado_cash"], providerSnapshot: {}, rowId: "r3", cached: false,
    });
    const res = await POST(req({ invoiceId: INV, address: ADDR }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.decision).toBe("reject");
    expect(body.code).toBe("SANCTIONED_WALLET");
    expect(JSON.stringify(body)).not.toContain("tornado_cash");
  });

  it("returns 404 when invoice does not exist", async () => {
    (dbMod.db as any).select = () => ({
      from: () => ({
        where: () => ({ limit: async () => [] }),
      }),
    });
    (factoryMod.resolveComplianceProvider as any).mockReturnValue({ name: "noop" });
    const res = await POST(req({ invoiceId: INV, address: ADDR }));
    expect(res.status).toBe(404);
  });

  it("enqueues compliance.review_queued webhook when merchant has webhookUrl", async () => {
    let selectCount = 0;
    (dbMod.db as any).select = () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            selectCount++;
            if (selectCount === 1) return [{
              id: INV, status: "created", merchantId: "m-1",
              payInToken:  "0x3600000000000000000000000000000000000000",
              payoutToken: "0x3600000000000000000000000000000000000000",
              amountOut:   "100000000",
            }];
            return [{ webhookUrl: "https://m.example/hook" }];
          },
        }),
      }),
    });
    const insertValues = vi.fn().mockResolvedValue(undefined);
    (dbMod.db as any).insert = () => ({ values: insertValues });

    (factoryMod.resolveComplianceProvider as any).mockReturnValue({ name: "elliptic" });
    (screenMod.screenWithAudit as any).mockResolvedValue({
      decision: "review", risk: "medium", ticketId: "rev_xyz",
      ttlSeconds: 86400, cachedAt: new Date(), reasons: [], providerSnapshot: {},
      rowId: "r-rev", cached: false,
    });

    const res = await POST(req({ invoiceId: INV, address: ADDR }));
    expect(res.status).toBe(200);
    expect(insertValues).toHaveBeenCalledTimes(1);
    const payload = insertValues.mock.calls[0]![0];
    expect(payload.url).toBe("https://m.example/hook");
    expect(payload.payload.type).toBe("compliance.review_queued");
    expect(payload.payload.ticket_id).toBe("rev_xyz");
  });

  it("rejects bad params with 400", async () => {
    const res = await POST(req({ invoiceId: "not-hex", address: "not-an-address" }));
    expect(res.status).toBe(400);
  });

  it("fails closed by default when provider throws on customer_pay", async () => {
    (factoryMod.resolveComplianceProvider as any).mockReturnValue({ name: "elliptic" });
    (screenMod.screenWithAudit as any).mockRejectedValue(new Error("provider_error: elliptic 503"));
    const res = await POST(req({ invoiceId: INV, address: ADDR }));
    const body = await res.json();
    expect(res.status).toBe(503);
    expect(body.decision).toBe("reject");
    expect(body.code).toBe("PROVIDER_UNAVAILABLE");
  });

  it("repeat authorize from same payer returns existing unconsumed row (M10 idempotency)", async () => {
    // Simulate the second insert hitting the partial UNIQUE index
    // (idx_checkout_auth_active). The route MUST swallow the 23505 and
    // return the existing unconsumed row's id rather than 5xx-ing the user.
    let invoiceLookups = 0;
    (dbMod.db as any).select = () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            invoiceLookups++;
            // First select: invoice. Second-and-on: existing unconsumed auth row.
            if (invoiceLookups === 1) {
              return [{
                id: INV, status: "created", merchantId: "m-1",
                payInToken:  "0x3600000000000000000000000000000000000000",
                payoutToken: "0x3600000000000000000000000000000000000000",
                amountOut:   "100000000",
              }];
            }
            // The fallback fetch in insertOrFetchAuth.
            return [{
              id: "auth-existing-1",
              minAmountIn: "100000000",
              expiresAt: new Date(Date.now() + 5 * 60_000),
            }];
          },
        }),
      }),
    });

    // First insert succeeds; second insert throws 23505. Both flows must
    // return decision=allow with the same id.
    const calls: any[] = [];
    let attempt = 0;
    (dbMod.db as any).insert = () => ({
      values: (row: any) => {
        calls.push(row);
        return {
          returning: vi.fn().mockImplementation(async () => {
            attempt++;
            if (attempt === 1) {
              return [{
                id: "auth-existing-1",
                minAmountIn: row.minAmountIn,
                expiresAt: row.expiresAt,
              }];
            }
            const e: any = new Error("duplicate key value violates unique constraint");
            e.code = "23505";
            throw e;
          }),
          onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
        };
      },
    });

    (factoryMod.resolveComplianceProvider as any).mockReturnValue({ name: "noop" });
    (screenMod.screenWithAudit as any).mockResolvedValue({
      decision: "allow", risk: "low", ticketId: null, ttlSeconds: 86400,
      cachedAt: new Date(), reasons: [], providerSnapshot: {}, rowId: "r1", cached: false,
    });

    const r1 = await POST(req({ invoiceId: INV, address: ADDR }));
    const b1 = await r1.json();
    expect(r1.status).toBe(200);
    expect(b1.decision).toBe("allow");

    // Reset invoice-lookup counter so the second call sees the invoice again.
    invoiceLookups = 0;

    const r2 = await POST(req({ invoiceId: INV, address: ADDR }));
    const b2 = await r2.json();
    expect(r2.status).toBe(200);
    expect(b2.decision).toBe("allow");
    // Same minAmountIn surfaces both times (idempotent).
    expect(b2.minAmountIn).toBe(b1.minAmountIn);
  });

  it("fails open when COMPLIANCE_FAIL_OPEN_FOR_PAY=true", async () => {
    process.env.COMPLIANCE_FAIL_OPEN_FOR_PAY = "true";
    (factoryMod.resolveComplianceProvider as any).mockReturnValue({ name: "elliptic" });
    (screenMod.screenWithAudit as any).mockRejectedValue(new Error("provider_error"));
    const res = await POST(req({ invoiceId: INV, address: ADDR }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.decision).toBe("allow");
    expect(body.providerDegraded).toBe(true);
  });

  it("returns 429 with rate_limited when takeToken returns false (audit H1)", async () => {
    vi.mocked(limiterMod.takeToken).mockResolvedValueOnce(false);

    const res = await POST(req({ invoiceId: "0x" + "a".repeat(64), address: "0x" + "b".repeat(40) }));
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toBe("rate_limited");
    expect(res.headers.get("retry-after")).toBe("60");
    expect(vi.mocked(limiterMod.takeToken)).toHaveBeenCalledWith("authorize:unknown", 20, 60);
  });
});
