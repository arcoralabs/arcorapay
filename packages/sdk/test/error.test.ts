import { describe, it, expect } from "vitest";
import { ArcoraError } from "../src/error";

describe("ArcoraError", () => {
  it("has a discriminated code", () => {
    const e = new ArcoraError("INVALID_API_KEY", "bad key");
    expect(e.code).toBe("INVALID_API_KEY");
    expect(e.message).toBe("bad key");
    expect(e.name).toBe("ArcoraError");
  });
  it("preserves cause", () => {
    const cause = new Error("network down");
    const e = new ArcoraError("NETWORK", "fetch failed", { cause });
    expect(e.cause).toBe(cause);
  });
  it("retains optional context", () => {
    const e = new ArcoraError("SERVER_ERROR", "oops", { retryAfter: 30 });
    expect(e.retryAfter).toBe(30);
  });
});
