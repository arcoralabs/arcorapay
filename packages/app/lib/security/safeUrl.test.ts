import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isPrivateAddress, assertSafePublicUrl, assertOriginAllowed } from "./safeUrl";

// Mock DNS so tests don't depend on network state.
vi.mock("node:dns/promises", () => {
  const lookup = vi.fn();
  return { default: { lookup }, lookup };
});

import dns from "node:dns/promises";

const lookupMock = dns.lookup as unknown as ReturnType<typeof vi.fn>;

const savedNodeEnv = process.env.NODE_ENV;

beforeEach(() => {
  lookupMock.mockReset();
});

afterEach(() => {
  if (savedNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = savedNodeEnv;
});

describe("isPrivateAddress", () => {
  it("flags RFC1918 ranges", () => {
    expect(isPrivateAddress("10.0.0.1")).toBe(true);
    expect(isPrivateAddress("172.16.0.1")).toBe(true);
    expect(isPrivateAddress("172.31.255.255")).toBe(true);
    expect(isPrivateAddress("192.168.1.1")).toBe(true);
  });

  it("flags loopback + link-local + cloud metadata", () => {
    expect(isPrivateAddress("127.0.0.1")).toBe(true);
    expect(isPrivateAddress("169.254.169.254")).toBe(true); // AWS metadata
  });

  it("flags carrier-grade NAT range", () => {
    expect(isPrivateAddress("100.64.0.1")).toBe(true);
    expect(isPrivateAddress("100.127.255.254")).toBe(true);
  });

  it("flags IPv6 loopback + link-local + ULA", () => {
    expect(isPrivateAddress("::1")).toBe(true);
    expect(isPrivateAddress("fe80::1")).toBe(true);
    expect(isPrivateAddress("fc00::1")).toBe(true);
    expect(isPrivateAddress("fd12:3456::1")).toBe(true);
  });

  it("flags IPv4-mapped IPv6 private addresses (dotted-quad spelling)", () => {
    expect(isPrivateAddress("::ffff:10.0.0.1")).toBe(true);
    expect(isPrivateAddress("::ffff:127.0.0.1")).toBe(true);
  });

  it("flags IPv4-mapped IPv6 private addresses in HEX spelling (M-1)", () => {
    // dns.lookup returns the hex form, not dotted-quad.
    expect(isPrivateAddress("::ffff:7f00:1")).toBe(true);    // 127.0.0.1
    expect(isPrivateAddress("::ffff:a9fe:a9fe")).toBe(true); // 169.254.169.254 metadata
    expect(isPrivateAddress("::ffff:0a00:0001")).toBe(true); // 10.0.0.1
    expect(isPrivateAddress("::ffff:c0a8:0101")).toBe(true); // 192.168.1.1
  });

  it("flags IPv4-mapped IPv6 PUBLIC addresses in hex as public (M-1)", () => {
    expect(isPrivateAddress("::ffff:0808:0808")).toBe(false); // 8.8.8.8
  });

  it("flags NAT64 well-known prefix wrapping a private v4 (M-1)", () => {
    expect(isPrivateAddress("64:ff9b::a9fe:a9fe")).toBe(true);        // 169.254.169.254
    expect(isPrivateAddress("64:ff9b::169.254.169.254")).toBe(true); // dotted spelling
    expect(isPrivateAddress("64:ff9b::7f00:1")).toBe(true);          // 127.0.0.1
  });

  it("flags IPv4-compatible ::/96 wrapping a private v4 (M-1)", () => {
    expect(isPrivateAddress("::7f00:1")).toBe(true); // 127.0.0.1
    expect(isPrivateAddress("::a00:1")).toBe(true);  // 10.0.0.1
  });

  it("flags the whole Teredo range 2001:0000::/32 (M-1)", () => {
    expect(isPrivateAddress("2001:0:4137:9e76::1")).toBe(true);
    expect(isPrivateAddress("2001:0000:4137:9e76::1")).toBe(true);
  });

  it("passes public addresses", () => {
    expect(isPrivateAddress("8.8.8.8")).toBe(false);
    expect(isPrivateAddress("1.1.1.1")).toBe(false);
    expect(isPrivateAddress("2606:4700:4700::1111")).toBe(false);
    expect(isPrivateAddress("64:ff9b::0808:0808")).toBe(false); // NAT64 wrapping public 8.8.8.8
  });
});

describe("assertSafePublicUrl", () => {
  it("rejects malformed URL", async () => {
    await expect(assertSafePublicUrl("not a url")).rejects.toThrow(/invalid_url/);
  });

  it("rejects unsupported schemes", async () => {
    await expect(assertSafePublicUrl("ftp://example.com")).rejects.toThrow(/unsupported_scheme/);
    await expect(assertSafePublicUrl("file:///etc/passwd")).rejects.toThrow(/unsupported_scheme/);
  });

  it("requires https in production", async () => {
    process.env.NODE_ENV = "production";
    await expect(assertSafePublicUrl("http://example.com/hook")).rejects.toThrow(/https_required/);
  });

  it("allows http in non-production", async () => {
    process.env.NODE_ENV = "development";
    lookupMock.mockResolvedValue([{ address: "8.8.8.8", family: 4 }]);
    await expect(assertSafePublicUrl("http://example.com/hook")).resolves.toBeUndefined();
  });

  it("rejects when DNS resolves to a private IP", async () => {
    lookupMock.mockResolvedValue([{ address: "10.0.0.5", family: 4 }]);
    await expect(assertSafePublicUrl("https://internal.example/hook"))
      .rejects.toThrow(/private_address_blocked/);
  });

  it("rejects when ANY resolved IP is private (DNS-rebind defense)", async () => {
    lookupMock.mockResolvedValue([
      { address: "8.8.8.8", family: 4 },
      { address: "169.254.169.254", family: 4 },
    ]);
    await expect(assertSafePublicUrl("https://hostile.example/hook"))
      .rejects.toThrow(/private_address_blocked/);
  });

  it("accepts a public URL with public DNS records", async () => {
    lookupMock.mockResolvedValue([{ address: "1.1.1.1", family: 4 }]);
    await expect(assertSafePublicUrl("https://merchant.example.com/webhook"))
      .resolves.toBeUndefined();
  });

  it("rejects when DNS lookup fails", async () => {
    lookupMock.mockRejectedValue(new Error("ENOTFOUND"));
    await expect(assertSafePublicUrl("https://nope.example/")).rejects.toThrow(/dns_lookup_failed/);
  });

  it("rejects with dns_timeout when DNS lookup never resolves (M7)", async () => {
    // Simulate a resolver that hangs forever; the 3s timeout should fire.
    // Use vi.useFakeTimers so the test doesn't actually wait 3 seconds.
    vi.useFakeTimers();
    lookupMock.mockImplementation(() => new Promise(() => {})); // never resolves
    const p = assertSafePublicUrl("https://slow-resolver.example/");
    // Advance past the 3-second DNS timeout
    vi.advanceTimersByTime(3500);
    await expect(p).rejects.toThrow(/dns_timeout/);
    vi.useRealTimers();
  });
});

describe("assertOriginAllowed", () => {
  it("accepts a URL whose origin matches the allowlist", () => {
    expect(() => assertOriginAllowed(
      "https://shop.example.com/checkout/success?x=1",
      ["https://shop.example.com"],
    )).not.toThrow();
  });

  it("rejects when origin is not in the allowlist", () => {
    expect(() => assertOriginAllowed(
      "https://attacker.example.com/?x=1",
      ["https://shop.example.com"],
    )).toThrow(/origin_not_allowed/);
  });

  it("treats different schemes as different origins", () => {
    // https://shop and http://shop differ — http NOT allowed unless declared.
    expect(() => assertOriginAllowed(
      "http://shop.example.com/ok",
      ["https://shop.example.com"],
    )).toThrow(/origin_not_allowed/);
  });

  it("treats different ports as different origins", () => {
    expect(() => assertOriginAllowed(
      "https://shop.example.com:8443/ok",
      ["https://shop.example.com"],
    )).toThrow(/origin_not_allowed/);
  });

  it("rejects malformed URLs with invalid_url", () => {
    expect(() => assertOriginAllowed(
      "not a url",
      ["https://shop.example.com"],
    )).toThrow(/invalid_url/);
  });

  it("rejects when allowlist is empty (no origins configured)", () => {
    expect(() => assertOriginAllowed(
      "https://shop.example.com/ok",
      [],
    )).toThrow(/origin_not_allowed/);
  });
});
