import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ db: { update: vi.fn() } }));
vi.mock("@/lib/auth/apikey", () => ({
  generateApiKey: () => "ak_live_" + "R".repeat(56),
  hashApiKey: vi.fn().mockResolvedValue("$2a$10$hashhashhashhash"),
  PREFIX_LEN: 12,
}));

import { POST } from "./route";
import { NextRequest } from "next/server";

const SESSION = { merchantAddress: "0xabc0000000000000000000000000000000000000", save: vi.fn().mockResolvedValue(undefined) };

beforeEach(async () => {
  vi.clearAllMocks();
  const dbm = await import("@/lib/db/client");
  const returning = vi.fn().mockResolvedValue([{ address: SESSION.merchantAddress }]);
  const where = vi.fn().mockReturnValue({ returning });
  const set = vi.fn().mockReturnValue({ where });
  (dbm.db.update as any).mockReturnValue({ set });
  const session = await import("@/lib/auth/session");
  (session.getSession as any).mockResolvedValue({ ...SESSION });
});

// CRIT-1 (2026-06-11): isSameOrigin is now fail-closed and the route carries a
// JSON content-type gate, mirroring the dashboard's ApiKeyCard fetch headers.
function makeReq(headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/merchant/api-key", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost:3000", ...headers },
  });
}

describe("POST /api/merchant/api-key", () => {
  it("rotates the key and returns it (same-origin)", async () => {
    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    expect((await res.json()).apiKey).toMatch(/^ak_live_/);
  });

  it("rejects a request with neither Origin nor Referer with 403 (CRIT-1 fail-closed)", async () => {
    const res = await POST(new NextRequest("http://localhost/api/merchant/api-key", { method: "POST" }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("csrf");
    const dbm = await import("@/lib/db/client");
    expect(dbm.db.update).not.toHaveBeenCalled();
  });

  it("rejects a non-JSON content type with 415 (CRIT-1 gate)", async () => {
    const res = await POST(makeReq({ "content-type": "text/plain" }));
    expect(res.status).toBe(415);
    expect((await res.json()).error).toBe("unsupported_content_type");
    const dbm = await import("@/lib/db/client");
    expect(dbm.db.update).not.toHaveBeenCalled();
  });

  it("rejects a cross-site Origin with 403 (AFG-006 CSRF)", async () => {
    const prev = process.env.PUBLIC_BASE_URL;
    process.env.PUBLIC_BASE_URL = "https://app.arcorapay.xyz";
    try {
      const res = await POST(makeReq({ origin: "https://evil.example.com" }));
      expect(res.status).toBe(403);
      expect((await res.json()).error).toBe("csrf");
      const dbm = await import("@/lib/db/client");
      expect(dbm.db.update).not.toHaveBeenCalled();
    } finally {
      if (prev === undefined) delete process.env.PUBLIC_BASE_URL;
      else process.env.PUBLIC_BASE_URL = prev;
    }
  });

  it("returns 401 when there is no merchant session", async () => {
    const session = await import("@/lib/auth/session");
    (session.getSession as any).mockResolvedValue({ merchantAddress: undefined, save: vi.fn() });
    const res = await POST(makeReq());
    expect(res.status).toBe(401);
  });
});
