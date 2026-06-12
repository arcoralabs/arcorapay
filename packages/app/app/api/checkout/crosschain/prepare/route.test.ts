import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { crosschainPayments, checkoutTelemetry } from "@/lib/db/schema";

const takeTokenMock = vi.fn(async () => true);
vi.mock("@/lib/rate/limiter", () => ({ takeToken: (...args: any[]) => takeTokenMock(...args) }));

const EXISTING_ID = "22222222-2222-4222-8222-222222222222";
const FRESH_ID = "11111111-1111-4111-8111-111111111111";

const dbState = {
  invoices: [{
    id: "0x" + "1".repeat(64),
    status: "created",
    payInToken: "0x3600000000000000000000000000000000000000",
    payoutToken: "0x3600000000000000000000000000000000000000",
    amountOut: "5000000",
    expiresAt: new Date(Date.now() + 30 * 60_000),
    merchantId: "merchant-1",
  }],
  crosschainRows: [] as any[],
  telemetryRows: [] as any[],
  failTelemetry: false,
  updateCalls: [] as any[],
};

vi.mock("@/lib/db/client", () => ({
  db: {
    select: () => ({
      from: (table: any) => ({
        where: () => ({
          limit: async () =>
            table === crosschainPayments ? dbState.crosschainRows.slice(0, 1) : dbState.invoices,
        }),
      }),
    }),
    insert: (table: any) => ({
      values: (row: any) => {
        if (table === checkoutTelemetry) {
          if (dbState.failTelemetry) return Promise.reject(new Error("telemetry db down"));
          dbState.telemetryRows.push(row);
          return Promise.resolve();
        }
        const returning = async () => {
          const inserted = { id: FRESH_ID, ...row };
          dbState.crosschainRows.push(inserted);
          return [{ id: FRESH_ID }];
        };
        return {
          returning,
          onConflictDoUpdate: () => ({ returning }),
        };
      },
    }),
    update: (_table: any) => ({
      set: (values: any) => ({
        where: () => ({
          returning: async () => {
            dbState.updateCalls.push(values);
            const existing = dbState.crosschainRows[0];
            // Mirror the route's race guard: only rows still "authorized"
            // are updatable.
            if (!existing || existing.status !== "authorized") return [];
            Object.assign(existing, values);
            return [{ id: existing.id }];
          },
        }),
      }),
    }),
  },
}));

vi.mock("@/lib/compliance/factory", () => ({
  resolveComplianceProvider: () => ({ name: "noop" }),
}));

const screenWithAuditMock = vi.fn(async () => ({
  decision: "allow", risk: "low", reasons: [], ticketId: null,
}));
vi.mock("@/lib/compliance/screen", () => ({
  screenWithAudit: (...args: any[]) => screenWithAuditMock(...args),
}));

function req(body: unknown) {
  return new Request("https://arcorapay.xyz/api/checkout/crosschain/prepare", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.10" },
    body: JSON.stringify(body),
  }) as any;
}

function existingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: EXISTING_ID,
    invoiceId: "0x" + "1".repeat(64),
    idempotencyKey: `cc_${"0x" + "1".repeat(64)}_${"0x" + "a".repeat(40)}_84532`,
    payer: "0x" + "a".repeat(40),
    sourceChainId: 84532,
    status: "authorized",
    ...overrides,
  };
}

describe("POST /api/checkout/crosschain/prepare", () => {
  beforeEach(() => {
    dbState.crosschainRows = [];
    dbState.telemetryRows = [];
    dbState.failTelemetry = false;
    dbState.updateCalls = [];
    delete process.env.COMPLIANCE_FAIL_OPEN_FOR_PAY;
  });

  it("creates an authorized cross-chain intent for enabled Base Sepolia", async () => {
    const res = await POST(req({
      invoiceId: "0x" + "1".repeat(64),
      payer: "0x" + "a".repeat(40),
      sourceChainId: 84532,
    }));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.intentId).toBe(FRESH_ID);
    expect(body.sourceChain.chainId).toBe(84532);
    expect(body.depositForBurn.amount).toBe("5000000");
    expect(dbState.crosschainRows[0].status).toBe("authorized");
  });

  it("rejects disabled source chains", async () => {
    const res = await POST(req({
      invoiceId: "0x" + "1".repeat(64),
      payer: "0x" + "a".repeat(40),
      sourceChainId: 421614,
    }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("source_chain_disabled");
  });

  it("rate limits per IP", async () => {
    takeTokenMock.mockResolvedValueOnce(false);
    const res = await POST(req({
      invoiceId: "0x" + "1".repeat(64),
      payer: "0x" + "a".repeat(40),
      sourceChainId: 84532,
    }));
    expect(res.status).toBe(429);
  });

  it("re-prepares an authorized intent in place (same payer + chain) with 200", async () => {
    dbState.crosschainRows = [existingRow()];

    const res = await POST(req({
      invoiceId: "0x" + "1".repeat(64),
      payer: "0x" + "a".repeat(40),
      sourceChainId: 84532,
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.intentId).toBe(EXISTING_ID);
    expect(dbState.crosschainRows).toHaveLength(1);
    expect(dbState.updateCalls).toHaveLength(1);
    expect(dbState.crosschainRows[0].status).toBe("authorized");
  });

  it("re-prepares an authorized intent onto a different source chain", async () => {
    dbState.crosschainRows = [existingRow()];

    const res = await POST(req({
      invoiceId: "0x" + "1".repeat(64),
      payer: "0x" + "a".repeat(40),
      sourceChainId: 11155111,
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.intentId).toBe(EXISTING_ID);
    expect(body.sourceChain.chainId).toBe(11155111);
    expect(dbState.crosschainRows).toHaveLength(1);
    expect(dbState.crosschainRows[0].sourceChainId).toBe(11155111);
    expect(dbState.crosschainRows[0].idempotencyKey)
      .toBe(`cc_${"0x" + "1".repeat(64)}_${"0x" + "a".repeat(40)}_11155111`);
  });

  it("refuses to overwrite an intent past authorized", async () => {
    dbState.crosschainRows = [existingRow({ status: "bridge_pending" })];

    const res = await POST(req({
      invoiceId: "0x" + "1".repeat(64),
      payer: "0x" + "a".repeat(40),
      sourceChainId: 84532,
    }));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toBe("invoice_already_in_progress");
    expect(dbState.updateCalls).toHaveLength(0);
    expect(dbState.crosschainRows[0].status).toBe("bridge_pending");
  });

  // Audit 2026-06-11 MED-2: a compliance-provider outage must behave exactly
  // like /api/checkout/authorize — fail-closed 503 PROVIDER_UNAVAILABLE by
  // default, fail-open only when COMPLIANCE_FAIL_OPEN_FOR_PAY is set.
  it("fails closed by default when screenWithAudit throws (audit 2026-06-11 MED-2)", async () => {
    screenWithAuditMock.mockRejectedValueOnce(new Error("provider_error: elliptic 503"));

    const res = await POST(req({
      invoiceId: "0x" + "1".repeat(64),
      payer: "0x" + "a".repeat(40),
      sourceChainId: 84532,
    }));
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.decision).toBe("reject");
    expect(body.code).toBe("PROVIDER_UNAVAILABLE");
    // No intent may be persisted on an unscreened payer.
    expect(dbState.crosschainRows).toHaveLength(0);
  });

  it("fails open when COMPLIANCE_FAIL_OPEN_FOR_PAY=true and screenWithAudit throws", async () => {
    process.env.COMPLIANCE_FAIL_OPEN_FOR_PAY = "true";
    screenWithAuditMock.mockRejectedValueOnce(new Error("provider_error"));

    const res = await POST(req({
      invoiceId: "0x" + "1".repeat(64),
      payer: "0x" + "a".repeat(40),
      sourceChainId: 84532,
    }));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.intentId).toBe(FRESH_ID);
    expect(dbState.crosschainRows[0].status).toBe("authorized");
  });

  it("does not fail the request when the telemetry write fails", async () => {
    dbState.failTelemetry = true;
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(req({
      invoiceId: "0x" + "1".repeat(64),
      payer: "0x" + "a".repeat(40),
      sourceChainId: 84532,
    }));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.intentId).toBe(FRESH_ID);
    expect(dbState.telemetryRows).toHaveLength(0);
    // Let the fire-and-forget telemetry rejection settle before restoring.
    await new Promise((r) => setTimeout(r, 0));
    consoleError.mockRestore();
  });
});
