import { describe, it, expect } from "vitest";
import { formatCurrency, formatTokenAmount, abbreviateAddress, formatRelativeTime, symbolForAddress } from "./format";

describe("formatters", () => {
  it("formatCurrency renders USDC as USD", () => {
    expect(formatCurrency("49990000", "0x3600000000000000000000000000000000000000")).toBe("$49.99");
  });
  it("formatCurrency renders EURC as EUR", () => {
    expect(formatCurrency("46020000", "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a")).toBe("€46.02");
  });
  it("formatTokenAmount renders raw 6-dec to fixed-4", () => {
    expect(formatTokenAmount("100000")).toBe("0.1000");
  });
  it("abbreviateAddress shows 0x...xxxx", () => {
    expect(abbreviateAddress("0xabcdef0123456789abcdef0123456789abcdef01"))
      .toBe("0xabcd...ef01");
  });
  it("symbolForAddress maps known tokens", () => {
    expect(symbolForAddress("0x3600000000000000000000000000000000000000")).toBe("USDC");
    expect(symbolForAddress("0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a")).toBe("EURC");
    expect(symbolForAddress("0xother")).toBe("TOKEN");
  });
  it("formatRelativeTime renders 'X seconds ago' for recent", () => {
    const r = formatRelativeTime(new Date(Date.now() - 5_000));
    expect(r).toMatch(/[0-9]+s ago/);
  });
});
