import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "../middleware";

function req(path: string, host = "localhost:3000"): NextRequest {
  return new NextRequest(`http://${host}${path}`, {
    headers: { host },
  });
}

function scriptSrc(csp: string): string {
  const d = csp
    .split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith("script-src"));
  expect(d).toBeDefined();
  return d!;
}

describe("middleware CSP (MED-5)", () => {
  it("sets a nonce-based Content-Security-Policy on the response", () => {
    const res = middleware(req("/"));
    const csp = res.headers.get("Content-Security-Policy");
    expect(csp).toBeTruthy();
    const d = scriptSrc(csp!);
    expect(d).toMatch(/'nonce-[a-f0-9]{32}'/);
    expect(d).toContain("'strict-dynamic'");
    expect(d).not.toContain("'unsafe-inline'");
  });

  it("uses a fresh nonce per request", () => {
    const a = middleware(req("/")).headers.get("Content-Security-Policy")!;
    const b = middleware(req("/")).headers.get("Content-Security-Policy")!;
    const nonceOf = (csp: string) => csp.match(/'nonce-([a-f0-9]{32})'/)?.[1];
    expect(nonceOf(a)).toBeTruthy();
    expect(nonceOf(b)).toBeTruthy();
    expect(nonceOf(a)).not.toBe(nonceOf(b));
  });

  it("forwards x-nonce and the CSP on the request headers (so Next tags its inline scripts)", () => {
    const res = middleware(req("/"));
    const csp = res.headers.get("Content-Security-Policy")!;
    const nonce = csp.match(/'nonce-([a-f0-9]{32})'/)![1];
    // NextResponse.next({ request }) encodes forwarded request headers as
    // x-middleware-request-* on the response.
    expect(res.headers.get("x-middleware-request-x-nonce")).toBe(nonce);
    expect(res.headers.get("x-middleware-request-content-security-policy")).toBe(csp);
  });

  it("preserves the x-pathname behaviour on /m/ routes", () => {
    const res = middleware(req("/m/dashboard"));
    expect(res.headers.get("x-pathname")).toBe("/m/dashboard");
    expect(res.headers.get("Content-Security-Policy")).toBeTruthy();

    const other = middleware(req("/i/test123"));
    expect(other.headers.get("x-pathname")).toBeNull();
    expect(other.headers.get("Content-Security-Policy")).toBeTruthy();
  });

  it("still rewrites the docs host, with CSP attached", () => {
    const res = middleware(req("/getting-started", "docs.arcorapay.xyz"));
    const rewrite = res.headers.get("x-middleware-rewrite");
    expect(rewrite).toContain("/docs/getting-started");
    expect(res.headers.get("Content-Security-Policy")).toBeTruthy();
  });

  it("docs-host rewrite uses a unique nonce per request", () => {
    const a = middleware(req("/getting-started", "docs.arcorapay.xyz")).headers.get("Content-Security-Policy")!;
    const b = middleware(req("/getting-started", "docs.arcorapay.xyz")).headers.get("Content-Security-Policy")!;
    const nonceOf = (csp: string) => csp.match(/'nonce-([a-f0-9]{32})'/)?.[1];
    expect(nonceOf(a)).toBeTruthy();
    expect(nonceOf(b)).toBeTruthy();
    expect(nonceOf(a)).not.toBe(nonceOf(b));
  });

  it("closes the strict-dynamic companions: object-src none, base-uri self", () => {
    const csp = middleware(req("/")).headers.get("Content-Security-Policy")!;
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
  });
});
