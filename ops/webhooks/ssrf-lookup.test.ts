import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock node:dns so we can drive what the pinned lookup "resolves" to.
vi.mock("node:dns", () => {
  const lookup = vi.fn();
  return { default: { lookup }, lookup };
});

import dns from "node:dns";
import { pinnedLookup } from "./ssrf.js";

function runLookup(host: string): Promise<{ err: unknown; addr?: string }> {
  return new Promise((resolve) => {
    (pinnedLookup as any)(host, { all: false }, (err: unknown, addr: string) =>
      resolve({ err, addr }),
    );
  });
}

beforeEach(() => vi.clearAllMocks());

describe("pinnedLookup (AFG-001 connect-time guard)", () => {
  it("returns the validated address when every record is public", async () => {
    (dns.lookup as any).mockImplementation((_h: string, _o: unknown, cb: any) =>
      cb(null, [{ address: "8.8.8.8", family: 4 }]),
    );
    const { err, addr } = await runLookup("api.merchant.test");
    expect(err).toBeNull();
    expect(addr).toBe("8.8.8.8");
  });

  it("rejects when ANY record is private (rebinding answer with a public + a loopback)", async () => {
    (dns.lookup as any).mockImplementation((_h: string, _o: unknown, cb: any) =>
      cb(null, [{ address: "93.184.216.34", family: 4 }, { address: "127.0.0.1", family: 4 }]),
    );
    const { err } = await runLookup("rebind.test");
    expect(String(err)).toMatch(/private_address_blocked:127\.0\.0\.1/);
  });

  it("propagates a resolver error", async () => {
    (dns.lookup as any).mockImplementation((_h: string, _o: unknown, cb: any) =>
      cb(new Error("ENOTFOUND"), []),
    );
    const { err } = await runLookup("nope.test");
    expect(String(err)).toMatch(/ENOTFOUND/);
  });
});
