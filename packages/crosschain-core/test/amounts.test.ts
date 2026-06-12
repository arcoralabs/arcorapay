import { describe, expect, it } from "vitest";
import { ceilDiv, formatBaseUnits, parseBaseUnits } from "../src/amounts";

describe("amount helpers", () => {
  it("parses 6-decimal USDC strings into base units", () => {
    expect(parseBaseUnits("1", 6)).toBe(1_000_000n);
    expect(parseBaseUnits("1.23", 6)).toBe(1_230_000n);
    expect(parseBaseUnits("0.000001", 6)).toBe(1n);
  });

  it("rejects over-precision instead of truncating money", () => {
    expect(() => parseBaseUnits("1.0000001", 6)).toThrow(/too many decimal places/);
  });

  it("formats base units without losing precision", () => {
    expect(formatBaseUnits(1_230_000n, 6)).toBe("1.23");
    expect(formatBaseUnits(1n, 6)).toBe("0.000001");
    expect(formatBaseUnits(1_000_000n, 6)).toBe("1");
  });

  it("rejects non-integer or negative decimals in parseBaseUnits", () => {
    expect(() => parseBaseUnits("1", -1)).toThrow(/decimals must be a non-negative integer/);
  });

  it("rejects non-integer decimals in formatBaseUnits", () => {
    expect(() => formatBaseUnits(1n, 1.5)).toThrow(/decimals must be a non-negative integer/);
  });
});

describe("ceilDiv", () => {
  it("rounds up correctly", () => {
    expect(ceilDiv(10n, 3n)).toBe(4n);
    expect(ceilDiv(9n, 3n)).toBe(3n);
    expect(ceilDiv(0n, 5n)).toBe(0n);
  });

  it("throws on negative numerator", () => {
    expect(() => ceilDiv(-3n, 3n)).toThrow(/numerator must be non-negative/);
  });

  it("throws on zero or negative denominator", () => {
    expect(() => ceilDiv(5n, 0n)).toThrow(/denominator must be positive/);
  });
});
