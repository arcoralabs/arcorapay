import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Arcora } from "../src/client";
import { ArcoraError } from "../src/error";

// AFG-019 / audit 2026-06-11 C-2: constructing a client with a secret key in a
// browser must THROW (v1.2 only console.warn'ed, and only for ak_live_).
describe("browser secret-key guard", () => {
  const g = globalThis as any;
  beforeEach(() => { g.window = {}; });
  afterEach(() => { delete g.window; });

  it("throws for ak_live_ in a browser", () => {
    expect(() => new Arcora({ apiKey: "ak_live_abc123" })).toThrow(/server-side/);
  });

  it("throws for any ak_ variant in a browser (ak_test_)", () => {
    expect(() => new Arcora({ apiKey: "ak_test_abc123" })).toThrow(/server-side/);
  });

  it("throws an ArcoraError with code SECRET_KEY_IN_BROWSER", () => {
    try {
      new Arcora({ apiKey: "ak_live_abc123" });
      throw new Error("expected throw");
    } catch (e: any) {
      expect(e).toBeInstanceOf(ArcoraError);
      expect(e.code).toBe("SECRET_KEY_IN_BROWSER");
    }
  });

  it("allows pk_live_ in a browser", () => {
    expect(() => new Arcora({ apiKey: "pk_live_abc123" })).not.toThrow();
  });

  it("allows ak_live_ server-side", () => {
    delete g.window;
    expect(() => new Arcora({ apiKey: "ak_live_abc123" })).not.toThrow();
  });

  it("deprecated Arcora.init throws for ak_ keys in a browser", () => {
    expect(() => Arcora.init({ apiKey: "ak_live_abc123" })).toThrow(/server-side/);
  });

  it("deprecated Arcora.init allows pk_live_ in a browser", () => {
    expect(() => Arcora.init({ apiKey: "pk_live_abc123" })).not.toThrow();
  });
});
