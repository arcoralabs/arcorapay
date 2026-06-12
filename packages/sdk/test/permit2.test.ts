import { describe, it, expect } from "vitest";
import { randomNonce, buildArcoraSwapIntent } from "../src/permit2";
import { ArcoraError } from "../src/error";

function withCrypto(value: unknown, fn: () => void) {
  const orig = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  try {
    Object.defineProperty(globalThis, "crypto", {
      value,
      configurable: true,
      writable: true,
    });
    fn();
  } finally {
    if (orig) Object.defineProperty(globalThis, "crypto", orig);
    else delete (globalThis as { crypto?: unknown }).crypto;
  }
}

describe("randomNonce", () => {
  it("returns a 256-bit bigint when crypto.getRandomValues is available", () => {
    const n = randomNonce();
    expect(typeof n).toBe("bigint");
    expect(n).toBeLessThanOrEqual((1n << 256n) - 1n);
    expect(n).toBeGreaterThanOrEqual(0n);
  });

  it("throws when secure RNG unavailable instead of silently falling back to Math.random", () => {
    withCrypto(undefined, () => {
      expect(() => randomNonce()).toThrow(ArcoraError);
      try {
        randomNonce();
      } catch (e) {
        expect(e).toBeInstanceOf(ArcoraError);
        expect((e as ArcoraError).code).toBe("NO_SECURE_RANDOM");
      }
    });
  });

  it("throws when crypto exists but getRandomValues is missing", () => {
    withCrypto({}, () => {
      expect(() => randomNonce()).toThrow(/NO_SECURE_RANDOM|secure random/i);
    });
  });
});

describe("buildArcoraSwapIntent", () => {
  it("produces typed data with Permit2 domain and ArcoraSwapIntent witness", () => {
    const td = buildArcoraSwapIntent({
      chainId: 5042002,
      payInToken: "0x1111111111111111111111111111111111111111",
      amount: 200000n,
      relayer: "0x2222222222222222222222222222222222222222",
      invoiceId: ("0x" + "ab".repeat(32)) as `0x${string}`,
      deadline: 1234567890n,
      nonce: 42n,
    });
    expect(td.typedData.domain.name).toBe("Permit2");
    expect(td.typedData.domain.chainId).toBe(5042002);
    expect(td.typedData.message.witness.relayer).toBe("0x2222222222222222222222222222222222222222");
    expect(td.witnessForBackend.nonce).toBe("42");
  });
});
