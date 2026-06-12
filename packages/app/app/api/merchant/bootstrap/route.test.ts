import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth/session", () => ({
  getSession: vi.fn(),
}));
vi.mock("@/lib/db/client", () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
  },
}));
vi.mock("@/lib/security/safeUrl", () => ({
  assertSafePublicUrl: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/auth/apikey", () => ({
  generateApiKey: () => "ak_live_AAAABBBBCCCC1111111111",
  generatePublishableKey: () => "pk_live_" + "P".repeat(56),
  hashApiKey: vi.fn().mockResolvedValue("$2a$10$hashhashhashhash"),
  PREFIX_LEN: 12,
}));
vi.mock("@/lib/crypto/secret", () => ({
  encrypt: () => ({ iv: Buffer.from("iv"), ciphertext: Buffer.from("ct") }),
}));

import { POST } from "./route";

// Use the USDC address matching the test env (setup.ts loads .env which has
// USDC_ADDRESS=0x3600...). Audit L5: only this address (and EURC) passes the
// payoutToken allowlist check in the bootstrap route.
const VALID_PAYOUT_TOKEN = "0x3600000000000000000000000000000000000000"; // USDC
const UNSUPPORTED_TOKEN  = "0x1111111111111111111111111111111111111111";

// CRIT-1 (2026-06-11): isSameOrigin is now fail-closed, so every legitimate
// request must carry a same-origin Origin header (matches .env PUBLIC_BASE_URL).
function makeReq(body: unknown) {
  return new Request("http://localhost/api/merchant/bootstrap", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost:3000" },
    body: JSON.stringify(body),
  }) as any;
}

const SESSION_BASE = {
  merchantAddress: "0xabc",
  save: vi.fn().mockResolvedValue(undefined),
};

beforeEach(() => {
  vi.clearAllMocks();
  // Default: no existing merchant row
  return import("@/lib/db/client").then((m) => {
    (m.db.select as any).mockReturnValue({
      from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }),
    });
    const valuesSpy = vi.fn().mockResolvedValue(undefined);
    (m.db.insert as any).mockReturnValue({ values: valuesSpy });
    (m.db.insert as any)._valuesSpy = valuesSpy;
  }).then(() => import("@/lib/auth/session")).then((s) => {
    (s.getSession as any).mockResolvedValue({ ...SESSION_BASE });
  });
});

describe("POST /api/merchant/bootstrap allowed_origins", () => {
  it("rejects when allowedOrigins is missing", async () => {
    const res = await POST(makeReq({ payoutToken: VALID_PAYOUT_TOKEN }));
    expect(res.status).toBe(400);
  });

  it("rejects when allowedOrigins is empty array", async () => {
    const res = await POST(makeReq({
      payoutToken: VALID_PAYOUT_TOKEN,
      allowedOrigins: [],
    }));
    expect(res.status).toBe(400);
  });

  it("rejects when allowedOrigins contains a non-URL string", async () => {
    const res = await POST(makeReq({
      payoutToken: VALID_PAYOUT_TOKEN,
      allowedOrigins: ["not a url"],
    }));
    expect(res.status).toBe(400);
  });

  it("persists normalized origins (path stripped) on bootstrap", async () => {
    const dbm = await import("@/lib/db/client");
    const res = await POST(makeReq({
      payoutToken: VALID_PAYOUT_TOKEN,
      allowedOrigins: ["https://shop.example.com/checkout/return", "https://staging.example.com"],
    }));
    expect(res.status).toBe(201);
    const valuesSpy = (dbm.db.insert as any)._valuesSpy as ReturnType<typeof vi.fn>;
    expect(valuesSpy).toHaveBeenCalled();
    const inserted = valuesSpy.mock.calls[0]![0];
    expect(inserted.allowedOrigins).toEqual([
      "https://shop.example.com",
      "https://staging.example.com",
    ]);
  });

  it("rejects a cross-site Origin with 403 (AFG-006 CSRF)", async () => {
    const prev = process.env.PUBLIC_BASE_URL;
    process.env.PUBLIC_BASE_URL = "https://app.arcorapay.xyz";
    try {
      const req = new Request("http://localhost/api/merchant/bootstrap", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://evil.example.com" },
        body: JSON.stringify({ payoutToken: VALID_PAYOUT_TOKEN, allowedOrigins: ["https://shop.example.com"] }),
      }) as any;
      const res = await POST(req);
      expect(res.status).toBe(403);
      expect((await res.json()).error).toBe("csrf");
    } finally {
      if (prev === undefined) delete process.env.PUBLIC_BASE_URL;
      else process.env.PUBLIC_BASE_URL = prev;
    }
  });

  it("generates and returns a publishable key alongside the secret key (AFG-019)", async () => {
    const dbm = await import("@/lib/db/client");
    const res = await POST(makeReq({
      payoutToken: VALID_PAYOUT_TOKEN,
      allowedOrigins: ["https://shop.example.com"],
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.apiKey).toMatch(/^ak_live_/);
    expect(body.publishableKey).toMatch(/^pk_live_/);

    const valuesSpy = (dbm.db.insert as any)._valuesSpy as ReturnType<typeof vi.fn>;
    const inserted = valuesSpy.mock.calls[0]![0];
    expect(inserted.publishableKey).toBe(body.publishableKey);
    expect(inserted.publishableKeyPrefix).toBe(body.publishableKey.slice(0, 12));
  });

  it("rejects unsupported payoutToken (Audit L5)", async () => {
    const res = await POST(makeReq({
      payoutToken: UNSUPPORTED_TOKEN,
      allowedOrigins: ["https://shop.example.com"],
    }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("unsupported_payout_token");
  });
});
