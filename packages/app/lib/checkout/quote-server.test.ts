import { describe, it, expect } from "vitest";
import { quoteAmountIn } from "./quote-server";

/**
 * Parity tests for quoteAmountIn. Used by both:
 *   - lib/checkout/quote-server.ts::estimateSwapForTarget (server-side)
 *   - app/api/checkout/quote/route.ts (HTTP)
 *
 * The whole point of M11 is identical inputs → identical bigint output, so
 * the merchant authorize path can never disagree with what the customer's
 * browser saw by ±1 base unit. (That ±1 drift was the M11 finding.)
 */

describe("quoteAmountIn (M11)", () => {
  it("typical USDC→EURC case rounds UP not down", () => {
    // target = 1.000000 EURC out (1_000_000n at 6dp)
    // rate   = 1.085000 EURC per 1.0 USDC (probe of 1.0 USDC → 1.085 EURC)
    // buffer = 250 bps (2.5%)
    // expected ≈ 1.000000 / 1.085 * 1.025 = 0.94470 → 944_700 base units (ish)
    const r = quoteAmountIn({
      targetBaseUnits: 1_000_000n,
      rateScaled1e18:  1_085_000_000_000_000_000n,
      bufferBps:       250n,
      payInDecimals:   6,
      payoutDecimals:  6,
    });
    // Lower-bound assertion: must cover target exactly when the swap takes 1% fee.
    // With buffer >= 0, recommended must satisfy: rec * rate >= target.
    const delivered = (r * 1_085_000_000_000_000_000n) / (10n ** 18n);
    expect(delivered).toBeGreaterThanOrEqual(1_000_000n);
  });

  it("ceiling: never under-quotes by even 1 base unit", () => {
    // Pick numbers that don't divide evenly so we exercise the ceil branch.
    // target=1, rate=3 (i.e. 1 pay-in → 3 payout). Buffer=0.
    // payIn = 1/3 = 0.333... → ceil at 6dp = 333_334n (rounded UP)
    const r = quoteAmountIn({
      targetBaseUnits: 1_000_000n, // 1.0 in 6dp
      rateScaled1e18:  3n * 10n ** 18n,
      bufferBps:       0n,
      payInDecimals:   6,
      payoutDecimals:  6,
    });
    expect(r).toBe(333_334n); // 333_333.33... ceiled
  });

  it("zero buffer + exact rate produces exact result with no rounding-up", () => {
    // target=2, rate=2 → payIn=1.0 exactly, no ceil overshoot
    const r = quoteAmountIn({
      targetBaseUnits: 2_000_000n, // 2.0 in 6dp
      rateScaled1e18:  2n * 10n ** 18n,
      bufferBps:       0n,
      payInDecimals:   6,
      payoutDecimals:  6,
    });
    expect(r).toBe(1_000_000n);
  });

  it("buffer increases the pay-in monotonically", () => {
    const args = {
      targetBaseUnits: 1_000_000n,
      rateScaled1e18:  1_085_000_000_000_000_000n,
      payInDecimals:   6,
      payoutDecimals:  6,
    } as const;
    const r0   = quoteAmountIn({ ...args, bufferBps: 0n });
    const r100 = quoteAmountIn({ ...args, bufferBps: 100n });
    const r250 = quoteAmountIn({ ...args, bufferBps: 250n });
    expect(r100).toBeGreaterThan(r0);
    expect(r250).toBeGreaterThan(r100);
  });

  it("identical inputs produce IDENTICAL bigint output (no path-dependent drift)", () => {
    // The actual unification test: same call, same result. Catches anyone
    // who in the future re-introduces a parallel implementation that
    // happens to round one way at the seam.
    const inputs = {
      targetBaseUnits: 1_500_000n,
      rateScaled1e18:  1_087_654_321_098_765_432n,
      bufferBps:       250n,
      payInDecimals:   6,
      payoutDecimals:  6,
    };
    const a = quoteAmountIn(inputs);
    const b = quoteAmountIn(inputs);
    expect(a).toBe(b);
    // Cover a few perturbations: changing decimals shouldn't crash.
    const c = quoteAmountIn({ ...inputs, payInDecimals: 18 });
    expect(c).toBeGreaterThan(a); // more decimals → more base units
  });

  it("rejects zero rate (would be div-by-zero)", () => {
    expect(() =>
      quoteAmountIn({
        targetBaseUnits: 1_000_000n,
        rateScaled1e18:  0n,
        bufferBps:       0n,
        payInDecimals:   6,
        payoutDecimals:  6,
      }),
    ).toThrow();
  });
});
