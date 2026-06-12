import { describe, it, expect } from "vitest";
import { isBlockedAddress, assertAddressesPublic } from "./ssrf.js";

describe("isBlockedAddress (AFG-002)", () => {
  it("allows public unicast addresses", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:4700:4700::1111", "2001:4860:4860::8888"]) {
      expect(isBlockedAddress(ip)).toBe(false);
    }
  });

  it("blocks IPv4 special ranges", () => {
    for (const ip of [
      "127.0.0.1", "10.0.0.1", "10.255.255.255", "172.16.0.1", "172.31.255.255",
      "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255",
    ]) {
      expect(isBlockedAddress(ip)).toBe(true);
    }
  });

  it("allows public IPv4 adjacent to private ranges (172.15 / 172.32)", () => {
    expect(isBlockedAddress("172.15.0.1")).toBe(false);
    expect(isBlockedAddress("172.32.0.1")).toBe(false);
  });

  it("blocks IPv6 special ranges", () => {
    for (const ip of ["::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "ff02::1"]) {
      expect(isBlockedAddress(ip)).toBe(true);
    }
  });

  it("blocks IPv6 transition forms the old classifier missed (the AFG-002 bypasses)", () => {
    for (const ip of [
      "::ffff:7f00:1",            // hex v4-mapped 127.0.0.1
      "::ffff:127.0.0.1",         // dotted v4-mapped 127.0.0.1
      "::ffff:a00:1",             // hex v4-mapped 10.0.0.1
      "::ffff:c0a8:1",            // hex v4-mapped 192.168.0.1
      "::ffff:a9fe:a9fe",         // hex v4-mapped 169.254.169.254
      "0:0:0:0:0:ffff:127.0.0.1", // fully-expanded v4-mapped loopback
      "64:ff9b::7f00:1",          // NAT64 embedding 127.0.0.1
      "2002:7f00:1::",            // 6to4 embedding 127.0.0.1
    ]) {
      expect(isBlockedAddress(ip)).toBe(true);
    }
  });

  it("blocks unparseable input (fail closed)", () => {
    expect(isBlockedAddress("not-an-ip")).toBe(true);
    expect(isBlockedAddress("")).toBe(true);
  });
});

describe("assertAddressesPublic", () => {
  it("passes when all records are public", () => {
    expect(() => assertAddressesPublic([{ address: "8.8.8.8" }, { address: "1.1.1.1" }])).not.toThrow();
  });
  it("throws if ANY record is private (multi-record rebind defense)", () => {
    expect(() => assertAddressesPublic([{ address: "8.8.8.8" }, { address: "127.0.0.1" }]))
      .toThrow(/private_address_blocked:127\.0\.0\.1/);
  });
  it("throws on an empty record set", () => {
    expect(() => assertAddressesPublic([])).toThrow(/dns_lookup_failed/);
  });
});
