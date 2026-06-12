import { describe, it, expect } from "vitest";
import { privateJson } from "./respond";

describe("privateJson (audit 2026-06-11 HIGH-3)", () => {
  it("sets Cache-Control: no-store, private", async () => {
    const res = privateJson({ ok: true });
    expect(res.headers.get("Cache-Control")).toBe("no-store, private");
    expect(await res.json()).toEqual({ ok: true });
  });

  it("preserves status from init", () => {
    const res = privateJson({ error: "unauthorized" }, { status: 401 });
    expect(res.status).toBe(401);
    expect(res.headers.get("Cache-Control")).toBe("no-store, private");
  });

  it("overrides a caller-supplied Cache-Control header", () => {
    const res = privateJson({ ok: true }, { headers: { "Cache-Control": "public, max-age=60" } });
    expect(res.headers.get("Cache-Control")).toBe("no-store, private");
  });
});
