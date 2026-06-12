import { describe, it, expect } from "vitest";
import { signWebhook, verifyWebhookSignature } from "./webhook";

describe("webhook signing", () => {
  it("HMAC-SHA256 produces hex prefixed sha256=", () => {
    const sig = signWebhook("hello", "secret");
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it("verify returns true for valid signature", () => {
    const sig = signWebhook("payload", "key");
    expect(verifyWebhookSignature("payload", sig, "key")).toBe(true);
  });

  it("verify returns false for tampered signature", () => {
    expect(verifyWebhookSignature("payload", "sha256=" + "0".repeat(64), "key")).toBe(false);
  });

  it("verify returns false for tampered body", () => {
    const sig = signWebhook("payload", "key");
    expect(verifyWebhookSignature("payload2", sig, "key")).toBe(false);
  });
});
