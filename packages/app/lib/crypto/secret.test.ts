import { describe, it, expect, beforeEach } from "vitest";
import { encrypt, decrypt } from "./secret";
import { randomBytes } from "node:crypto";

describe("AES-256-GCM secret helper", () => {
  beforeEach(() => {
    process.env.MASTER_KEY = randomBytes(32).toString("base64");
  });

  it("round-trips a string", () => {
    const { iv, ciphertext } = encrypt("hello world");
    expect(decrypt(iv, ciphertext)).toBe("hello world");
  });

  it("different IVs produce different ciphertexts", () => {
    const a = encrypt("same plaintext");
    const b = encrypt("same plaintext");
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
  });

  it("rejects tampered ciphertext", () => {
    const { iv, ciphertext } = encrypt("secret");
    ciphertext[0] ^= 0xff;
    expect(() => decrypt(iv, ciphertext)).toThrow();
  });

  it("rejects wrong IV", () => {
    const { ciphertext } = encrypt("secret");
    expect(() => decrypt(randomBytes(12), ciphertext)).toThrow();
  });

  it("throws if MASTER_KEY is missing", () => {
    delete process.env.MASTER_KEY;
    expect(() => encrypt("x")).toThrow(/MASTER_KEY/);
  });
});
