import { describe, it, expect, vi, beforeEach } from "vitest";
import { screenWithAudit } from "./screen";
import { NoopProvider } from "./noop";
import type { ComplianceProvider } from "./provider";
import type { ScreeningResult } from "./types";

function fakeDb() {
  const inserted: any[] = [];
  const cached: any[] = [];
  return {
    inserted,
    cached,
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: () => Promise.resolve(cached),
          }),
        }),
      }),
    }),
    insert: () => ({
      values: (row: any) => ({
        returning: () => {
          const r = { ...row, id: `row-${inserted.length + 1}` };
          inserted.push(r);
          return Promise.resolve([r]);
        },
      }),
    }),
  } as any;
}

beforeEach(() => { vi.clearAllMocks(); });

describe("screenWithAudit", () => {
  it("calls the provider and writes one audit row when cache empty", async () => {
    const db = fakeDb();
    const provider = new NoopProvider();
    const result = await screenWithAudit({
      db,
      provider,
      address: "0xabc",
      context: { flow: "customer_pay", invoiceId: "0xdead" },
    });
    expect(result.decision).toBe("allow");
    expect(result.risk).toBe("low");
    expect(db.inserted).toHaveLength(1);
    expect(db.inserted[0].provider).toBe("noop");
    expect(db.inserted[0].decision).toBe("allow");
  });

  it("attaches a ticketId when decision=review and writes it on the row", async () => {
    const reviewProvider: ComplianceProvider = {
      name: "elliptic",
      async screenAddress(): Promise<ScreeningResult> {
        return {
          risk: "medium",
          reasons: ["mid_exposure"],
          providerScore: 5,
          providerSnapshot: { score: 5 },
          cachedAt: new Date(),
          ttlSeconds: 3600,
        };
      },
    };
    const db = fakeDb();
    const result = await screenWithAudit({
      db, provider: reviewProvider, address: "0xabc",
      context: { flow: "customer_pay", invoiceId: "0xdead" },
    });
    expect(result.decision).toBe("review");
    expect(result.ticketId).toMatch(/^rev_/);
    expect(db.inserted[0].ticketId).toBe(result.ticketId);
  });

  it("reuses cached row within ttl and does not call the provider again", async () => {
    const db = fakeDb();
    db.cached.push({
      id: "cached-row",
      address: "0xabc",
      flow: "customer_pay",
      provider: "noop",
      risk: "low",
      reasons: [],
      providerSnapshot: {},
      decision: "allow",
      ticketId: null,
      expiresAt: new Date(Date.now() + 3600 * 1000), // valid for 1h
      createdAt: new Date(),
    });
    const screen = vi.fn();
    const provider: ComplianceProvider = { name: "noop", screenAddress: screen as any };
    const result = await screenWithAudit({
      db, provider, address: "0xabc",
      context: { flow: "customer_pay", invoiceId: "0xdead" },
    });
    expect(screen).not.toHaveBeenCalled();
    expect(result.decision).toBe("allow");
    expect(db.inserted).toHaveLength(0);
  });

  it("retention window: sanctions hits get 7y, others 13mo expires_at", async () => {
    const sanctionsProvider: ComplianceProvider = {
      name: "trmlabs",
      async screenAddress(): Promise<ScreeningResult> {
        return {
          risk: "sanctions",
          reasons: ["OFAC: tornado_cash"],
          providerScore: 0,
          providerSnapshot: {},
          cachedAt: new Date(),
          ttlSeconds: 3600,
        };
      },
    };
    const db = fakeDb();
    const before = Date.now();
    await screenWithAudit({
      db, provider: sanctionsProvider, address: "0xabc",
      context: { flow: "customer_pay", invoiceId: "0xdead" },
    });
    const expiresAt = (db.inserted[0].expiresAt as Date).getTime();
    // 7 years ≈ 220.752M seconds; allow some slack
    expect(expiresAt - before).toBeGreaterThan(6 * 365 * 24 * 3600 * 1000);

    const db2 = fakeDb();
    const noopProvider = new NoopProvider();
    const before2 = Date.now();
    await screenWithAudit({
      db: db2, provider: noopProvider, address: "0xabc",
      context: { flow: "customer_pay", invoiceId: "0xdead" },
    });
    const expiresAt2 = (db2.inserted[0].expiresAt as Date).getTime();
    // 13 months ≈ 33.7M seconds; should be way under 6 years
    expect(expiresAt2 - before2).toBeLessThan(2 * 365 * 24 * 3600 * 1000);
  });
});
