import { describe, it, expect, afterEach } from "vitest";
import { securityHeaders, buildCsp } from "./headers";

const savedNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  if (savedNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = savedNodeEnv;
});

describe("securityHeaders (M14)", () => {
  it("returns an array of header objects", () => {
    const headers = securityHeaders();
    expect(Array.isArray(headers)).toBe(true);
    expect(headers.length).toBeGreaterThan(0);
    for (const h of headers) {
      expect(typeof h.key).toBe("string");
      expect(typeof h.value).toBe("string");
      expect(h.key.length).toBeGreaterThan(0);
      expect(h.value.length).toBeGreaterThan(0);
    }
  });

  it("includes X-Frame-Options", () => {
    const headers = securityHeaders();
    const h = headers.find((x) => x.key === "X-Frame-Options");
    expect(h).toBeDefined();
    expect(h!.value).toBe("SAMEORIGIN");
  });

  it("includes Strict-Transport-Security with long max-age", () => {
    const headers = securityHeaders();
    const h = headers.find((x) => x.key === "Strict-Transport-Security");
    expect(h).toBeDefined();
    expect(h!.value).toMatch(/max-age=\d+/);
    const match = h!.value.match(/max-age=(\d+)/);
    expect(Number(match![1])).toBeGreaterThanOrEqual(31536000); // at least 1 year
  });

  it("includes X-Content-Type-Options: nosniff", () => {
    const headers = securityHeaders();
    const h = headers.find((x) => x.key === "X-Content-Type-Options");
    expect(h).toBeDefined();
    expect(h!.value).toBe("nosniff");
  });

  it("includes Referrer-Policy and Permissions-Policy", () => {
    const headers = securityHeaders();
    expect(headers.find((x) => x.key === "Referrer-Policy")?.value).toBe(
      "strict-origin-when-cross-origin",
    );
    expect(headers.find((x) => x.key === "Permissions-Policy")).toBeDefined();
  });

  it("does NOT include Content-Security-Policy (set per-request in middleware)", () => {
    const headers = securityHeaders();
    const h = headers.find((x) => x.key === "Content-Security-Policy");
    expect(h).toBeUndefined();
  });

  it("does not contain duplicate keys", () => {
    const headers = securityHeaders();
    const keys = headers.map((h) => h.key);
    const unique = new Set(keys);
    expect(unique.size).toBe(keys.length);
  });
});

describe("buildCsp (MED-5)", () => {
  const NONCE = "deadbeefdeadbeefdeadbeefdeadbeef";

  function scriptSrc(csp: string): string {
    const d = csp
      .split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith("script-src"));
    expect(d).toBeDefined();
    return d!;
  }

  it("script-src carries the nonce and 'strict-dynamic'", () => {
    const csp = buildCsp(NONCE);
    const d = scriptSrc(csp);
    expect(d).toContain(`'nonce-${NONCE}'`);
    expect(d).toContain("'strict-dynamic'");
    expect(d).toContain("'self'");
  });

  it("script-src does NOT contain 'unsafe-inline'", () => {
    const d = scriptSrc(buildCsp(NONCE));
    expect(d).not.toContain("'unsafe-inline'");
  });

  it("script-src omits 'unsafe-eval' in production, includes it in development", () => {
    process.env.NODE_ENV = "production";
    expect(scriptSrc(buildCsp(NONCE))).not.toContain("'unsafe-eval'");

    process.env.NODE_ENV = "development";
    expect(scriptSrc(buildCsp(NONCE))).toContain("'unsafe-eval'");
  });

  it("style-src keeps 'unsafe-inline' (styles are not the targeted XSS vector)", () => {
    const csp = buildCsp(NONCE);
    const d = csp
      .split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith("style-src"));
    expect(d).toBe("style-src 'self' 'unsafe-inline'");
  });

  it("keeps all legacy directives", () => {
    const csp = buildCsp(NONCE);
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("img-src 'self' data: https:");
    expect(csp).toContain("font-src 'self' data:");
    expect(csp).toContain("connect-src 'self' https:");
    expect(csp).toContain("frame-ancestors 'self'");
  });

  it("uses the exact nonce it was given (different per call)", () => {
    const a = buildCsp("aaaa");
    const b = buildCsp("bbbb");
    expect(a).toContain("'nonce-aaaa'");
    expect(b).toContain("'nonce-bbbb'");
    expect(a).not.toContain("'nonce-bbbb'");
  });
});
