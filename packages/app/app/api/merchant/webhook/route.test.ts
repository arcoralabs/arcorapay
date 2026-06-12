import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth/session", () => ({
  getSession: vi.fn(),
}));
vi.mock("@/lib/db/client", () => ({
  db: {
    update: vi.fn(),
  },
}));
vi.mock("@/lib/crypto/secret", () => ({
  encrypt: vi.fn().mockReturnValue({ iv: "iv", ciphertext: "ct" }),
}));
vi.mock("@/lib/security/safeUrl", () => ({
  assertSafePublicUrl: vi.fn().mockResolvedValue(undefined),
}));

import { PATCH, POST } from "./route";
import { NextRequest } from "next/server";

const SESSION_WITH_MERCHANT = {
  merchantAddress: "0xabc0000000000000000000000000000000000000",
};

// CRIT-1 (2026-06-11): isSameOrigin is now fail-closed, so every legitimate
// request must carry a same-origin Origin header (matches .env PUBLIC_BASE_URL).
// PATCH additionally carries the JSON content-type gate; the bodyless POST
// rotate does NOT (the dashboard's rotate fetch omits content-type entirely).
function makePatchReq(body: unknown) {
  return new NextRequest("http://localhost/api/merchant/webhook", {
    method: "PATCH",
    headers: { "content-type": "application/json", origin: "http://localhost:3000" },
    body: JSON.stringify(body),
  });
}

function makePostReq() {
  return new NextRequest("http://localhost/api/merchant/webhook", {
    method: "POST",
    headers: { origin: "http://localhost:3000" },
  });
}

// Helper: set up db mock so update().set().where().returning() resolves to rows
async function setupDbMock(returningRows: unknown[]) {
  const dbm = await import("@/lib/db/client");
  const returningSpyFn = vi.fn().mockResolvedValue(returningRows);
  const whereSpy = vi.fn().mockReturnValue({ returning: returningSpyFn });
  const setSpy = vi.fn().mockReturnValue({ where: whereSpy });
  (dbm.db.update as any).mockReturnValue({ set: setSpy });
}

beforeEach(async () => {
  vi.clearAllMocks();

  // Default: authenticated session with merchant
  const session = await import("@/lib/auth/session");
  (session.getSession as any).mockResolvedValue({ ...SESSION_WITH_MERCHANT });

  // Default: merchant exists → .returning() resolves to [{ address: "0xabc..." }]
  await setupDbMock([{ address: SESSION_WITH_MERCHANT.merchantAddress }]);

  // Default: assertSafePublicUrl resolves
  const safeUrl = await import("@/lib/security/safeUrl");
  (safeUrl.assertSafePublicUrl as any).mockResolvedValue(undefined);
});

describe("PATCH /api/merchant/webhook", () => {
  it("merchant exists → 200 { ok: true }", async () => {
    const res = await PATCH(makePatchReq({ webhookUrl: "https://shop.example.com/hook" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });

  it("merchant missing (returning []) → 404 { error: 'no_merchant' }", async () => {
    await setupDbMock([]);
    const res = await PATCH(makePatchReq({ webhookUrl: "https://shop.example.com/hook" }));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: "no_merchant" });
  });

  it("rejects a cross-site Origin with 403 (L-5 CSRF)", async () => {
    const prev = process.env.PUBLIC_BASE_URL;
    process.env.PUBLIC_BASE_URL = "https://app.arcorapay.xyz";
    try {
      const req = new NextRequest("http://localhost/api/merchant/webhook", {
        method: "PATCH",
        headers: { origin: "https://evil.example.com" },
        body: JSON.stringify({ webhookUrl: "https://shop.example.com/hook" }),
      });
      const res = await PATCH(req);
      expect(res.status).toBe(403);
      expect((await res.json()).error).toBe("csrf");
    } finally {
      if (prev === undefined) delete process.env.PUBLIC_BASE_URL;
      else process.env.PUBLIC_BASE_URL = prev;
    }
  });

  it("allows a same-origin Origin (L-5 CSRF)", async () => {
    const prev = process.env.PUBLIC_BASE_URL;
    process.env.PUBLIC_BASE_URL = "https://app.arcorapay.xyz";
    try {
      const req = new NextRequest("http://localhost/api/merchant/webhook", {
        method: "PATCH",
        headers: { origin: "https://app.arcorapay.xyz", "content-type": "application/json" },
        body: JSON.stringify({ webhookUrl: "https://shop.example.com/hook" }),
      });
      const res = await PATCH(req);
      expect(res.status).toBe(200);
    } finally {
      if (prev === undefined) delete process.env.PUBLIC_BASE_URL;
      else process.env.PUBLIC_BASE_URL = prev;
    }
  });
});

describe("PATCH /api/merchant/webhook — CRIT-1 gates", () => {
  it("rejects a request with neither Origin nor Referer with 403 (fail-closed)", async () => {
    const req = new NextRequest("http://localhost/api/merchant/webhook", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ webhookUrl: "https://shop.example.com/hook" }),
    });
    const res = await PATCH(req);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("csrf");
  });

  it("rejects a non-JSON content type with 415", async () => {
    const req = new NextRequest("http://localhost/api/merchant/webhook", {
      method: "PATCH",
      headers: { "content-type": "text/plain", origin: "http://localhost:3000" },
      body: JSON.stringify({ webhookUrl: "https://shop.example.com/hook" }),
    });
    const res = await PATCH(req);
    expect(res.status).toBe(415);
    expect((await res.json()).error).toBe("unsupported_content_type");
  });
});

describe("POST /api/merchant/webhook", () => {
  it("merchant exists → 200 with webhookSecret in body (no content-type, like the dashboard rotate fetch)", async () => {
    const res = await POST(makePostReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("webhookSecret");
    expect(typeof body.webhookSecret).toBe("string");
  });

  it("merchant missing (returning []) → 404 { error: 'no_merchant' }", async () => {
    await setupDbMock([]);
    const res = await POST(makePostReq());
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: "no_merchant" });
  });

  it("rejects a request with neither Origin nor Referer with 403 (CRIT-1 fail-closed)", async () => {
    const req = new NextRequest("http://localhost/api/merchant/webhook", { method: "POST" });
    const res = await POST(req);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("csrf");
    const dbm = await import("@/lib/db/client");
    expect(dbm.db.update).not.toHaveBeenCalled();
  });

  it("still rotates on a non-JSON content type (bodyless rotate deliberately skips the JSON gate)", async () => {
    const req = new NextRequest("http://localhost/api/merchant/webhook", {
      method: "POST",
      headers: { "content-type": "text/plain", origin: "http://localhost:3000" },
    });
    const res = await POST(req);
    expect(res.status).not.toBe(415);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("webhookSecret");
  });
});
