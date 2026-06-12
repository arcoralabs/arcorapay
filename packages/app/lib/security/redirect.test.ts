/** @vitest-environment happy-dom */
import { describe, it, expect, beforeEach } from "vitest";
import { safeClientRedirect } from "./redirect";

describe("safeClientRedirect", () => {
  beforeEach(() => {
    // happy-dom default location is http://localhost:3000 — overwrite it.
    Object.defineProperty(window, "location", {
      writable: true,
      value: { href: "http://localhost/" },
    });
  });

  it("redirects when origin is in the allowlist", () => {
    const ok = safeClientRedirect(
      "https://shop.example.com/order/123",
      ["https://shop.example.com"],
    );
    expect(ok).toBe(true);
    expect(window.location.href).toBe("https://shop.example.com/order/123");
  });

  it("refuses to redirect when origin is NOT in the allowlist (defense-in-depth)", () => {
    const ok = safeClientRedirect(
      "https://attacker.example.com/?x=1",
      ["https://shop.example.com"],
    );
    expect(ok).toBe(false);
    expect(window.location.href).toBe("http://localhost/");
  });

  it("refuses to redirect for non-http(s) schemes", () => {
    const ok = safeClientRedirect(
      "javascript:alert(1)",
      ["https://shop.example.com"],
    );
    expect(ok).toBe(false);
    expect(window.location.href).toBe("http://localhost/");
  });

  it("refuses to redirect for malformed URLs", () => {
    const ok = safeClientRedirect("not a url", ["https://shop.example.com"]);
    expect(ok).toBe(false);
    expect(window.location.href).toBe("http://localhost/");
  });

  it("refuses to redirect when allowlist is empty", () => {
    const ok = safeClientRedirect("https://shop.example.com/ok", []);
    expect(ok).toBe(false);
    expect(window.location.href).toBe("http://localhost/");
  });
});
