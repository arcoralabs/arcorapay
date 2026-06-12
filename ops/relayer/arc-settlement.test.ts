import { describe, expect, it } from "vitest";
import type { Hex } from "viem";
import { buildSettleArgs, tokenSymbolForArcAddress } from "./arc-settlement";

describe("arc settlement executor helpers", () => {
  it("maps Arc USDC and EURC addresses to App Kit symbols", () => {
    expect(tokenSymbolForArcAddress("0x3600000000000000000000000000000000000000")).toBe("USDC");
    expect(tokenSymbolForArcAddress("0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a")).toBe("EURC");
  });

  it("builds settleInvoice args with merchant payout invariant", () => {
    const args = buildSettleArgs({
      invoiceId: "0x" + "1".repeat(64),
      payer: "0x" + "a".repeat(40),
      payInToken: "0x3600000000000000000000000000000000000000",
      amountIn: 5_000_000n,
      grossPayout: 4_999_000n,
      swapTxHash: ("0x" + "2".repeat(64)) as Hex,
    });

    expect(args[0]).toMatch(/^0x/);
    expect(args[3]).toBe(5_000_000n);
    expect(args[4]).toBe(4_999_000n);
  });
});
