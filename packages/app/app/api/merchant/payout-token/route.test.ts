import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ db: { update: vi.fn() } }));
vi.mock("@/lib/chain/client", () => ({
  GATEWAY_ADDRESS: "0x07BAC123A682D24d3eC439ce454cA8AC64eAe3A3",
  publicClient: { readContract: vi.fn() },
}));
vi.mock("@/lib/chain/gateway-abi", () => ({ GATEWAY_ABI: [] }));

import { POST } from "./route";
import { NextRequest } from "next/server";

const MERCHANT = "0xabc0000000000000000000000000000000000000";
const TOKEN = "0x3600000000000000000000000000000000000000";

beforeEach(async () => {
  vi.clearAllMocks();
  const session = await import("@/lib/auth/session");
  (session.getSession as any).mockResolvedValue({ merchantAddress: MERCHANT });
  const chain = await import("@/lib/chain/client");
  // on-chain payoutToken == requested → happy path
  (chain.publicClient.readContract as any).mockResolvedValue(["0x0", TOKEN, true]);
  const dbm = await import("@/lib/db/client");
  const where = vi.fn().mockResolvedValue(undefined);
  const set = vi.fn().mockReturnValue({ where });
  (dbm.db.update as any).mockReturnValue({ set });
});

// CRIT-1 (2026-06-11): isSameOrigin is now fail-closed, so every legitimate
// request must carry a same-origin Origin header (matches .env PUBLIC_BASE_URL).
function makeReq(headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/merchant/payout-token", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost:3000", ...headers },
    body: JSON.stringify({ payoutToken: TOKEN }),
  });
}

describe("POST /api/merchant/payout-token", () => {
  it("syncs the DB when on-chain payoutToken matches (same-origin)", async () => {
    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it("rejects a cross-site Origin with 403 before touching session/chain (AFG-006 CSRF)", async () => {
    const prev = process.env.PUBLIC_BASE_URL;
    process.env.PUBLIC_BASE_URL = "https://app.arcorapay.xyz";
    try {
      const res = await POST(makeReq({ origin: "https://evil.example.com" }));
      expect(res.status).toBe(403);
      expect((await res.json()).error).toBe("csrf");
      const session = await import("@/lib/auth/session");
      expect((session.getSession as any)).not.toHaveBeenCalled();
    } finally {
      if (prev === undefined) delete process.env.PUBLIC_BASE_URL;
      else process.env.PUBLIC_BASE_URL = prev;
    }
  });

  it("returns 401 when there is no merchant session", async () => {
    const session = await import("@/lib/auth/session");
    (session.getSession as any).mockResolvedValue({ merchantAddress: undefined });
    const res = await POST(makeReq());
    expect(res.status).toBe(401);
  });
});
