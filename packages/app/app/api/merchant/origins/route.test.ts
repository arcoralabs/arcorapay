import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth/session", () => ({
  getSession: vi.fn(),
}));
vi.mock("@/lib/db/client", () => ({
  db: {
    update: vi.fn(),
  },
}));
vi.mock("@/lib/security/safeUrl", () => ({
  assertSafePublicUrl: vi.fn().mockResolvedValue(undefined),
}));

import { PATCH } from "./route";

// CRIT-1 (2026-06-11): isSameOrigin is now fail-closed and the route carries a
// JSON content-type gate, mirroring the dashboard's AllowedOriginsCard fetch.
function makeReq(body: unknown) {
  return new NextRequest("http://localhost/api/merchant/origins", {
    method: "PATCH",
    headers: { "content-type": "application/json", origin: "http://localhost:3000" },
    body: JSON.stringify(body),
  });
}

// NextRequest needs to be imported after vi.mock calls
import { NextRequest } from "next/server";

const SESSION_WITH_MERCHANT = {
  merchantAddress: "0xabc0000000000000000000000000000000000000",
};

const SESSION_NO_MERCHANT = {
  merchantAddress: undefined,
};

beforeEach(async () => {
  vi.clearAllMocks();

  // Default: update().set().where().returning() chain resolves with existing row
  const dbm = await import("@/lib/db/client");
  const returningSpyFn = vi.fn().mockResolvedValue([{ address: SESSION_WITH_MERCHANT.merchantAddress }]);
  const whereSpy = vi.fn().mockReturnValue({ returning: returningSpyFn });
  const setSpy = vi.fn().mockReturnValue({ where: whereSpy });
  (dbm.db.update as any).mockReturnValue({ set: setSpy });
  (dbm.db.update as any)._setSpy = setSpy;
  (dbm.db.update as any)._whereSpy = whereSpy;
  (dbm.db.update as any)._returningSpyFn = returningSpyFn;

  // Default: authenticated session
  const session = await import("@/lib/auth/session");
  (session.getSession as any).mockResolvedValue({ ...SESSION_WITH_MERCHANT });

  // Default: assertSafePublicUrl resolves
  const safeUrl = await import("@/lib/security/safeUrl");
  (safeUrl.assertSafePublicUrl as any).mockResolvedValue(undefined);
});

describe("PATCH /api/merchant/origins", () => {
  it("case 1: valid https origin → 200 with ok + allowedOrigins", async () => {
    const res = await PATCH(makeReq({ allowedOrigins: ["https://shop.example.com"] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, allowedOrigins: ["https://shop.example.com"] });
  });

  it("case 2: http origin → 400 unsafe_origin (rejected before DNS)", async () => {
    const safeUrl = await import("@/lib/security/safeUrl");
    const res = await PATCH(makeReq({ allowedOrigins: ["http://shop.example.com"] }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("unsafe_origin");
    // assertSafePublicUrl must NOT be called — http rejected before DNS
    expect(safeUrl.assertSafePublicUrl).not.toHaveBeenCalled();
  });

  it("case 3: assertSafePublicUrl throws (private IP) → 400 unsafe_origin", async () => {
    const safeUrl = await import("@/lib/security/safeUrl");
    (safeUrl.assertSafePublicUrl as any).mockRejectedValueOnce(
      new Error("private_address_blocked:169.254.169.254"),
    );
    const res = await PATCH(makeReq({ allowedOrigins: ["https://169.254.169.254"] }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("unsafe_origin");
  });

  it("case 4: no session merchantAddress → 401", async () => {
    const session = await import("@/lib/auth/session");
    (session.getSession as any).mockResolvedValue({ ...SESSION_NO_MERCHANT });
    const res = await PATCH(makeReq({ allowedOrigins: ["https://shop.example.com"] }));
    expect(res.status).toBe(401);
  });

  it("rejects a cross-site Origin with 403 (AFG-006 CSRF)", async () => {
    const prev = process.env.PUBLIC_BASE_URL;
    process.env.PUBLIC_BASE_URL = "https://app.arcorapay.xyz";
    try {
      const req = new NextRequest("http://localhost/api/merchant/origins", {
        method: "PATCH",
        headers: { origin: "https://evil.example.com" },
        body: JSON.stringify({ allowedOrigins: ["https://shop.example.com"] }),
      });
      const res = await PATCH(req);
      expect(res.status).toBe(403);
      expect((await res.json()).error).toBe("csrf");
    } finally {
      if (prev === undefined) delete process.env.PUBLIC_BASE_URL;
      else process.env.PUBLIC_BASE_URL = prev;
    }
  });

  it("case 5: valid https origins but returning [] (merchant row gone) → 404 { error: 'no_merchant' }", async () => {
    const dbm = await import("@/lib/db/client");
    const returningSpyFn = vi.fn().mockResolvedValue([]);
    const whereSpy = vi.fn().mockReturnValue({ returning: returningSpyFn });
    const setSpy = vi.fn().mockReturnValue({ where: whereSpy });
    (dbm.db.update as any).mockReturnValue({ set: setSpy });

    const res = await PATCH(makeReq({ allowedOrigins: ["https://shop.example.com"] }));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: "no_merchant" });
  });
});
