import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseBaseUnits } from "@arcora/crosschain-core";
import { POST } from "./route";

vi.mock("@/lib/auth/apikey", async () => {
  // Keep the real pure helpers (classifyKey / generators); stub only the
  // db-backed lookups so the route's key-class routing is exercised for real.
  const actual = await vi.importActual<typeof import("@/lib/auth/apikey")>("@/lib/auth/apikey");
  return {
    ...actual,
    lookupMerchantByApiKey: vi.fn(),
    lookupMerchantByPublishableKey: vi.fn(),
  };
});
vi.mock("@/lib/chain/client", () => ({
  publicClient: {
    waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: "success" }),
    // V9 default reads on-chain merchants struct for compliance screening;
    // return a non-zero payout so it's used as the screened address.
    readContract: vi.fn().mockResolvedValue([
      "0x1111111111111111111111111111111111111111",
      "0x2222222222222222222222222222222222222222",
      true,
    ]),
  },
  getServerWalletClient: vi.fn(),
  GATEWAY: "0xgw",
  POOL: "0xpool",
}));
// In tests we don't want to hit DNS for assertSafePublicUrl. We pass through
// real assertOriginAllowed (it's a pure string check) but stub the network call.
vi.mock("@/lib/security/safeUrl", async () => {
  const actual = await vi.importActual<typeof import("@/lib/security/safeUrl")>("@/lib/security/safeUrl");
  return {
    ...actual,
    assertSafePublicUrl: vi.fn().mockResolvedValue(undefined),
  };
});
vi.mock("@/lib/db/client", () => ({
  db: {
    insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue(undefined) })),
  },
}));
vi.mock("@/lib/compliance/factory", () => ({
  resolveComplianceProvider: vi.fn(),
  complianceRequired: () => process.env.COMPLIANCE_REQUIRED === "true",
}));
vi.mock("@/lib/compliance/screen", () => ({
  screenWithAudit: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  // Default: compliance allows everything (matches Phase 0 / testnet behaviour).
  return import("@/lib/compliance/factory").then((f) => {
    (f.resolveComplianceProvider as any).mockReturnValue({ name: "noop" });
  }).then(() => import("@/lib/compliance/screen")).then((s) => {
    (s.screenWithAudit as any).mockResolvedValue({
      decision: "allow", risk: "low", ticketId: null, ttlSeconds: 86400,
      cachedAt: new Date(), reasons: [], providerSnapshot: {}, rowId: "r1", cached: false,
    });
  });
});

function makeReq(body: any, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/invoices", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  }) as any;
}

describe("POST /api/invoices", () => {
  it("rejects missing API key with 401", async () => {
    const res = await POST(makeReq({ amountUsdc: 1, payInToken: "EURC", successUrl: "https://x" }));
    expect(res.status).toBe(401);
  });

  it("rejects bad API key with 401", async () => {
    const m = await import("@/lib/auth/apikey");
    (m.lookupMerchantByApiKey as any).mockResolvedValue(null);
    const res = await POST(makeReq(
      { amountUsdc: 1, payInToken: "EURC", successUrl: "https://x" },
      { "X-Arcora-Api-Key": "ak_live_bad" }
    ));
    expect(res.status).toBe(401);
  });

  it("creates invoice when key valid + chain tx succeeds", async () => {
    const apikey = await import("@/lib/auth/apikey");
    (apikey.lookupMerchantByApiKey as any).mockResolvedValue({
      id: "00000000-0000-0000-0000-000000000001",
      address: "0x1111111111111111111111111111111111111111",
      payoutToken: "0x2222222222222222222222222222222222222222",
      allowedOrigins: ["https://merchant.example"],
    });
    const chain = await import("@/lib/chain/client");
    const writeContract = vi.fn().mockResolvedValue("0xtxhash");
    (chain.getServerWalletClient as any).mockResolvedValue({ writeContract });

    const res = await POST(makeReq(
      { amountUsdc: 49.99, payInToken: "EURC", successUrl: "https://merchant.example/ok" },
      { "X-Arcora-Api-Key": "ak_live_good" }
    ));
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.invoiceId).toMatch(/^0x[0-9a-f]{64}$/);
    expect(body.url).toContain(body.invoiceId);
    expect(writeContract).toHaveBeenCalled();
  });

  it("blocks invoice creation with 403 when merchant payout is sanctioned", async () => {
    const apikey = await import("@/lib/auth/apikey");
    (apikey.lookupMerchantByApiKey as any).mockResolvedValue({
      id: "00000000-0000-0000-0000-000000000002",
      address: "0xb1ock",
      payoutToken: "0x2222222222222222222222222222222222222222",
      allowedOrigins: ["https://merchant.example"],
    });
    const screen = await import("@/lib/compliance/screen");
    (screen.screenWithAudit as any).mockResolvedValue({
      decision: "reject", risk: "sanctions", ticketId: null,
      ttlSeconds: 3600, cachedAt: new Date(), reasons: ["OFAC: x"],
      providerSnapshot: {}, rowId: "r-sanc", cached: false,
    });
    const chain = await import("@/lib/chain/client");
    const writeContract = vi.fn();
    (chain.getServerWalletClient as any).mockResolvedValue({ writeContract });

    const res = await POST(makeReq(
      { amountUsdc: 10, payInToken: "USDC", successUrl: "https://merchant.example/ok" },
      { "X-Arcora-Api-Key": "ak_live_good" }
    ));
    const body = await res.json();
    expect(res.status).toBe(403);
    expect(body.code).toBe("MERCHANT_PAYOUT_BLOCKED");
    expect(writeContract).not.toHaveBeenCalled();
  });

  it("queues invoice with 202 when merchant payout is medium-risk", async () => {
    const apikey = await import("@/lib/auth/apikey");
    (apikey.lookupMerchantByApiKey as any).mockResolvedValue({
      id: "00000000-0000-0000-0000-000000000003",
      address: "0x1111111111111111111111111111111111111111",
      payoutToken: "0x2222222222222222222222222222222222222222",
      allowedOrigins: ["https://merchant.example"],
    });
    const screen = await import("@/lib/compliance/screen");
    (screen.screenWithAudit as any).mockResolvedValue({
      decision: "review", risk: "medium", ticketId: "rev_xyz",
      ttlSeconds: 86400, cachedAt: new Date(), reasons: ["mid_exposure"],
      providerSnapshot: {}, rowId: "r-rev", cached: false,
    });
    const chain = await import("@/lib/chain/client");
    const writeContract = vi.fn();
    (chain.getServerWalletClient as any).mockResolvedValue({ writeContract });

    const res = await POST(makeReq(
      { amountUsdc: 10, payInToken: "USDC", successUrl: "https://merchant.example/ok" },
      { "X-Arcora-Api-Key": "ak_live_good" }
    ));
    const body = await res.json();
    expect(res.status).toBe(202);
    expect(body.status).toBe("queued");
    expect(body.ticketId).toBe("rev_xyz");
    expect(writeContract).not.toHaveBeenCalled();
  });

  // Audit M1 (2026-05-19): amountUsdc ceiling — values above $1,000,000 must
  // be rejected. A JS double above ~9e15 loses integer precision and would
  // silently corrupt the on-chain BigInt; Infinity would crash BigInt().
  // Audit M2 (2026-05-19): metadata size — cap key count at 50 and value
  // length at 256 chars to prevent JSONB row bloat.
  describe("audit M1/M2 — amountUsdc ceiling + metadata size", () => {
    async function makeMerchantReq(body: any) {
      const apikey = await import("@/lib/auth/apikey");
      (apikey.lookupMerchantByApiKey as any).mockResolvedValue({
        id: "00000000-0000-0000-0000-000000000099",
        address: "0x1111111111111111111111111111111111111111",
        payoutToken: "0x2222222222222222222222222222222222222222",
        allowedOrigins: [],
      });
      return makeReq(body, { "X-Arcora-Api-Key": "ak_live_good" });
    }

    it("rejects amountUsdc above $1,000,000 ceiling with 400 bad_body (audit M1)", async () => {
      const res = await POST(await makeMerchantReq({ amountUsdc: 5_000_000, payInToken: "USDC" }));
      const body = await res.json();
      expect(res.status).toBe(400);
      expect(body.error).toBe("bad_body");
    });

    it("rejects amountUsdc: 0 with 400 bad_body (positive guard)", async () => {
      const res = await POST(await makeMerchantReq({ amountUsdc: 0, payInToken: "USDC" }));
      const body = await res.json();
      expect(res.status).toBe(400);
      expect(body.error).toBe("bad_body");
    });

    it("rejects metadata with 60 keys with 400 bad_body (audit M2)", async () => {
      const metadata: Record<string, string> = {};
      for (let i = 0; i < 60; i++) metadata[`key${i}`] = "value";
      const res = await POST(await makeMerchantReq({ amountUsdc: 10, payInToken: "USDC", metadata }));
      const body = await res.json();
      expect(res.status).toBe(400);
      expect(body.error).toBe("bad_body");
    });

    it("rejects metadata with a value of 300 characters with 400 bad_body (audit M2)", async () => {
      const metadata = { orderId: "x".repeat(300) };
      const res = await POST(await makeMerchantReq({ amountUsdc: 10, payInToken: "USDC", metadata }));
      const body = await res.json();
      expect(res.status).toBe(400);
      expect(body.error).toBe("bad_body");
    });

    it("accepts valid amountUsdc and small metadata (happy path, audit M1/M2)", async () => {
      const apikey = await import("@/lib/auth/apikey");
      (apikey.lookupMerchantByApiKey as any).mockResolvedValue({
        id: "00000000-0000-0000-0000-000000000098",
        address: "0x1111111111111111111111111111111111111111",
        payoutToken: "0x2222222222222222222222222222222222222222",
        allowedOrigins: [],
      });
      const chain = await import("@/lib/chain/client");
      const writeContract = vi.fn().mockResolvedValue("0xtxhash");
      (chain.getServerWalletClient as any).mockResolvedValue({ writeContract });

      const res = await POST(makeReq(
        { amountUsdc: 99.99, payInToken: "USDC", metadata: { orderId: "abc" } },
        { "X-Arcora-Api-Key": "ak_live_good" }
      ));
      const body = await res.json();
      expect(res.status).toBe(201);
      expect(body.invoiceId).toMatch(/^0x[0-9a-f]{64}$/);
      expect(writeContract).toHaveBeenCalled();
    });
  });

  // AFG-005 (2026-06-06): when COMPLIANCE_REQUIRED=true, a provider/RPC error
  // must fail CLOSED (503) instead of creating the invoice.
  describe("AFG-005 — fail-closed when compliance is required", () => {
    afterEach(() => { delete process.env.COMPLIANCE_REQUIRED; });

    it("returns 503 on provider error instead of minting the invoice", async () => {
      process.env.COMPLIANCE_REQUIRED = "true";
      const apikey = await import("@/lib/auth/apikey");
      (apikey.lookupMerchantByApiKey as any).mockResolvedValue({
        id: "00000000-0000-0000-0000-0000000000c1",
        address: "0x1111111111111111111111111111111111111111",
        payoutToken: "0x2222222222222222222222222222222222222222",
        allowedOrigins: [],
      });
      const screen = await import("@/lib/compliance/screen");
      (screen.screenWithAudit as any).mockRejectedValue(new Error("provider down"));
      const chain = await import("@/lib/chain/client");
      const writeContract = vi.fn();
      (chain.getServerWalletClient as any).mockResolvedValue({ writeContract });

      const res = await POST(makeReq(
        { amountUsdc: 10, payInToken: "USDC" },
        { "X-Arcora-Api-Key": "ak_live_good" },
      ));
      expect(res.status).toBe(503);
      expect(writeContract).not.toHaveBeenCalled();
    });
  });

  // AFG-019 (2026-06-06): a browser-safe publishable key (pk_live_) may create
  // a checkout ONLY from an allowlisted Origin, and never authorizes the
  // privileged data routes. The secret key keeps its existing full capability.
  describe("AFG-019 — publishable key capability", () => {
    const PK = "pk_live_" + "p".repeat(56);
    async function mockPublishableMerchant(allowedOrigins: string[]) {
      const apikey = await import("@/lib/auth/apikey");
      (apikey.lookupMerchantByPublishableKey as any).mockResolvedValue({
        id: "00000000-0000-0000-0000-0000000000b1",
        address: "0x1111111111111111111111111111111111111111",
        payoutToken: "0x2222222222222222222222222222222222222222",
        allowedOrigins,
      });
      const chain = await import("@/lib/chain/client");
      const writeContract = vi.fn().mockResolvedValue("0xtxhash");
      (chain.getServerWalletClient as any).mockResolvedValue({ writeContract });
      return writeContract;
    }

    it("creates an invoice with a publishable key from an allowlisted origin", async () => {
      const writeContract = await mockPublishableMerchant(["https://shop.example.com"]);
      const res = await POST(makeReq(
        { amountUsdc: 9.99, payInToken: "USDC" },
        { "X-Arcora-Api-Key": PK, origin: "https://shop.example.com" },
      ));
      const body = await res.json();
      expect(res.status).toBe(201);
      expect(body.invoiceId).toMatch(/^0x[0-9a-f]{64}$/);
      expect(writeContract).toHaveBeenCalled();
    });

    it("rejects a publishable key when the Origin is not allowlisted (403)", async () => {
      const writeContract = await mockPublishableMerchant(["https://shop.example.com"]);
      const res = await POST(makeReq(
        { amountUsdc: 9.99, payInToken: "USDC" },
        { "X-Arcora-Api-Key": PK, origin: "https://evil.example.com" },
      ));
      const body = await res.json();
      expect(res.status).toBe(403);
      expect(body.error).toBe("publishable_origin_not_allowed");
      expect(writeContract).not.toHaveBeenCalled();
    });

    it("rejects a publishable key with no Origin header (403)", async () => {
      const writeContract = await mockPublishableMerchant(["https://shop.example.com"]);
      const res = await POST(makeReq(
        { amountUsdc: 9.99, payInToken: "USDC" },
        { "X-Arcora-Api-Key": PK },
      ));
      const body = await res.json();
      expect(res.status).toBe(403);
      expect(body.error).toBe("publishable_origin_not_allowed");
      expect(writeContract).not.toHaveBeenCalled();
    });

    it("rejects an unknown (non-ak/pk) key with 401", async () => {
      const res = await POST(makeReq(
        { amountUsdc: 9.99, payInToken: "USDC" },
        { "X-Arcora-Api-Key": "xx_live_nope", origin: "https://shop.example.com" },
      ));
      expect(res.status).toBe(401);
    });
  });

  // Audit H1 (2026-05-05): merchant-supplied successUrl/cancelUrl is the
  // post-payment redirect target. Without an allowlist check, an attacker
  // who steals a merchant API key (or any merchant configured to be hostile)
  // can use the hosted checkout as an open redirect / phishing launchpad.
  describe("audit H1 — successUrl/cancelUrl origin enforcement", () => {
    it("rejects successUrl outside merchant allowed_origins", async () => {
      const apikey = await import("@/lib/auth/apikey");
      (apikey.lookupMerchantByApiKey as any).mockResolvedValue({
        id: "00000000-0000-0000-0000-0000000000a1",
        address: "0x1111111111111111111111111111111111111111",
        payoutToken: "0x2222222222222222222222222222222222222222",
        allowedOrigins: ["https://shop.example.com"],
      });
      const chain = await import("@/lib/chain/client");
      const writeContract = vi.fn().mockResolvedValue("0xtxhash");
      (chain.getServerWalletClient as any).mockResolvedValue({ writeContract });

      const res = await POST(makeReq(
        { amountUsdc: 10, payInToken: "USDC", successUrl: "https://attacker.example.com/?x=1" },
        { "X-Arcora-Api-Key": "ak_live_good" }
      ));
      const body = await res.json();
      expect(res.status).toBe(400);
      expect(body.error).toMatch(/origin_not_allowed/);
      // Critical: no on-chain createInvoiceFor call should have happened.
      expect(writeContract).not.toHaveBeenCalled();
    });

    it("rejects cancelUrl outside merchant allowed_origins", async () => {
      const apikey = await import("@/lib/auth/apikey");
      (apikey.lookupMerchantByApiKey as any).mockResolvedValue({
        id: "00000000-0000-0000-0000-0000000000a2",
        address: "0x1111111111111111111111111111111111111111",
        payoutToken: "0x2222222222222222222222222222222222222222",
        allowedOrigins: ["https://shop.example.com"],
      });
      const chain = await import("@/lib/chain/client");
      const writeContract = vi.fn().mockResolvedValue("0xtxhash");
      (chain.getServerWalletClient as any).mockResolvedValue({ writeContract });

      const res = await POST(makeReq(
        {
          amountUsdc: 10, payInToken: "USDC",
          successUrl: "https://shop.example.com/ok",
          cancelUrl:  "https://attacker.example.com/cancel",
        },
        { "X-Arcora-Api-Key": "ak_live_good" }
      ));
      const body = await res.json();
      expect(res.status).toBe(400);
      expect(body.error).toMatch(/origin_not_allowed/);
      expect(writeContract).not.toHaveBeenCalled();
    });

    it("rejects successUrl that fails the SSRF guard (private IP)", async () => {
      const safeUrl = await import("@/lib/security/safeUrl");
      // The merchant's allowlist is satisfied but the URL still resolves to
      // an internal IP — SSRF guard must catch that second.
      (safeUrl.assertSafePublicUrl as any).mockRejectedValueOnce(
        new Error("private_address_blocked:169.254.169.254"),
      );
      const apikey = await import("@/lib/auth/apikey");
      (apikey.lookupMerchantByApiKey as any).mockResolvedValue({
        id: "00000000-0000-0000-0000-0000000000a3",
        address: "0x1111111111111111111111111111111111111111",
        payoutToken: "0x2222222222222222222222222222222222222222",
        // even if merchant tried to declare it
        allowedOrigins: ["http://169.254.169.254"],
      });
      const chain = await import("@/lib/chain/client");
      const writeContract = vi.fn().mockResolvedValue("0xtxhash");
      (chain.getServerWalletClient as any).mockResolvedValue({ writeContract });

      const res = await POST(makeReq(
        { amountUsdc: 10, payInToken: "USDC", successUrl: "http://169.254.169.254/latest/meta-data/" },
        { "X-Arcora-Api-Key": "ak_live_good" }
      ));
      const body = await res.json();
      expect(res.status).toBe(400);
      expect(body.error).toBe("unsafe_redirect_url");
      expect(writeContract).not.toHaveBeenCalled();
    });

    it("fails-closed when merchant has no configured origins (legacy rows)", async () => {
      const apikey = await import("@/lib/auth/apikey");
      (apikey.lookupMerchantByApiKey as any).mockResolvedValue({
        id: "00000000-0000-0000-0000-0000000000a4",
        address: "0x1111111111111111111111111111111111111111",
        payoutToken: "0x2222222222222222222222222222222222222222",
        allowedOrigins: [], // legacy row pre-Phase 2
      });
      const chain = await import("@/lib/chain/client");
      const writeContract = vi.fn().mockResolvedValue("0xtxhash");
      (chain.getServerWalletClient as any).mockResolvedValue({ writeContract });

      const res = await POST(makeReq(
        { amountUsdc: 10, payInToken: "USDC", successUrl: "https://shop.example.com/ok" },
        { "X-Arcora-Api-Key": "ak_live_good" }
      ));
      const body = await res.json();
      expect(res.status).toBe(400);
      expect(body.error).toBe("merchant_origins_not_configured");
      expect(writeContract).not.toHaveBeenCalled();
    });
  });

  // Audit H-1 — the route converts amountUsdc to base units via
  // parseBaseUnits(amountUsdc.toFixed(6), 6) instead of
  // BigInt(Math.round(amountUsdc * 1e6)), so IEEE-754 float artifacts can
  // never corrupt the on-chain amount.
  describe("audit H-1 — exact USDC base-unit conversion", () => {
    it("amountUsdc float artifacts do not corrupt base units", () => {
      for (const [usd, expected] of [
        ["4.50", 4_500_000n],
        ["10.99", 10_990_000n],
        ["0.000001", 1n],
        ["1005.55", 1_005_550_000n],
      ] as const) {
        expect(parseBaseUnits(usd, 6)).toBe(expected);
      }
    });

    it("toFixed(6) bridge from the Zod-validated number is exact", () => {
      expect(parseBaseUnits((4.5).toFixed(6), 6)).toBe(4_500_000n);
      expect(parseBaseUnits((10.99).toFixed(6), 6)).toBe(10_990_000n);
    });
  });
});
