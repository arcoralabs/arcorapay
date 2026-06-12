import { describe, it, expect } from "vitest";
import { buildGatewayAllowlist, resolveGateway } from "./gateway-allowlist.js";

const GW = "0x07BAC123A682D24d3eC439ce454cA8AC64eAe3A3";
const ATTACKER = "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";

describe("gateway allowlist (AFG-010)", () => {
  it("allowlist always contains the daemon's own gateway (lowercased)", () => {
    const set = buildGatewayAllowlist(GW);
    expect(set.has(GW.toLowerCase())).toBe(true);
  });

  it("includes extra GATEWAY_ALLOWLIST entries (in-flight migrations)", () => {
    const extra = "0xAAA0000000000000000000000000000000000001,0xBBB0000000000000000000000000000000000002";
    const set = buildGatewayAllowlist(GW, extra);
    expect(set.has("0xaaa0000000000000000000000000000000000001")).toBe(true);
    expect(set.has("0xbbb0000000000000000000000000000000000002")).toBe(true);
  });

  it("resolves a row's gateway when it equals the env gateway", () => {
    const set = buildGatewayAllowlist(GW);
    expect(resolveGateway(GW, GW, set)).toBe(GW.toLowerCase());
  });

  it("falls back to the daemon default for legacy rows (null gateway)", () => {
    const set = buildGatewayAllowlist(GW);
    expect(resolveGateway(null, GW, set)).toBe(GW.toLowerCase());
  });

  it("THROWS when the row's gateway is not allowlisted (tampered DB value)", () => {
    const set = buildGatewayAllowlist(GW);
    expect(() => resolveGateway(ATTACKER, GW, set)).toThrow(/gateway_not_allowlisted:0xdeadbeef/);
  });
});
