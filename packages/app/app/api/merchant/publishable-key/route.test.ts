import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ db: { update: vi.fn() } }));
vi.mock("@/lib/auth/apikey", () => ({
  generatePublishableKey: () => "pk_live_" + "R".repeat(56),
  PREFIX_LEN: 12,
}));

import { POST } from "./route";
import { NextRequest } from "next/server";

const SESSION = { merchantAddress: "0xabc0000000000000000000000000000000000000", save: vi.fn().mockResolvedValue(undefined) };

let setMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.clearAllMocks();
  const dbm = await import("@/lib/db/client");
  const returning = vi.fn().mockResolvedValue([{ address: SESSION.merchantAddress }]);
  const where = vi.fn().mockReturnValue({ returning });
  setMock = vi.fn().mockReturnValue({ where });
  (dbm.db.update as any).mockReturnValue({ set: setMock });
  const session = await import("@/lib/auth/session");
  (session.getSession as any).mockResolvedValue({ ...SESSION });
});

// MED-6 (2026-06-11): publishable-key rotation. Same CSRF posture as the
// secret-key rotation route: fail-closed isSameOrigin + JSON content-type gate.
function makeReq(headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/merchant/publishable-key", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost:3000", ...headers },
  });
}

describe("POST /api/merchant/publishable-key", () => {
  it("rotates the publishable key and returns it (same-origin)", async () => {
    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    expect((await res.json()).publishableKey).toMatch(/^pk_live_/);
    // Authenticated key material must never be cacheable (HIGH-3).
    expect(res.headers.get("Cache-Control")).toBe("no-store, private");
    // Both columns are replaced so the old key dies immediately.
    expect(setMock).toHaveBeenCalledWith({
      publishableKey: "pk_live_" + "R".repeat(56),
      publishableKeyPrefix: ("pk_live_" + "R".repeat(56)).slice(0, 12),
    });
  });

  it("rejects a request with neither Origin nor Referer with 403 (CRIT-1 fail-closed)", async () => {
    const res = await POST(new NextRequest("http://localhost/api/merchant/publishable-key", { method: "POST" }));
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
    const dbm = await import("@/lib/db/client");
    expect(dbm.db.update).not.toHaveBeenCalled();
  });
});
