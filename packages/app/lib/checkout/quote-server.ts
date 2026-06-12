import { AppKit } from "@circle-fin/app-kit";
import { getThrowawayAdapter } from "@/lib/checkout/throwaway-adapter";

/**
 * Server-side App Kit quote helper. Used by /api/checkout/authorize to
 * compute the min_amount_in for cross-token invoices without an HTTP
 * round-trip back to /api/checkout/quote. Same adapter pattern: we
 * fabricate a throwaway viem adapter so App Kit has a chain context;
 * estimateSwap doesn't broadcast or sign anything that hits the chain.
 *
 * Audit App-L2 (2026-05-24): the throwaway adapter now lives in
 * lib/checkout/throwaway-adapter so this module and the HTTP quote
 * route share a single in-process singleton instead of each minting
 * their own warm-instance key. Every call here is estimate-only —
 * never wire `getThrowawayAdapter()` into kit.swap.
 *
 * Returns the resolved customer payIn in base units (6-decimal stables on
 * Arc Testnet — USDC, EURC). Caller is expected to apply its own slack /
 * cushion before storing as min_amount_in.
 */

const kit = new AppKit();

const STABLE_DECIMALS = 6;

function humanize(baseUnits: bigint, decimals: number): string {
  const scale = 10n ** BigInt(decimals);
  const whole = baseUnits / scale;
  const frac  = (baseUnits % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return frac.length === 0 ? whole.toString() : `${whole}.${frac}`;
}

function parseHuman(amount: string, decimals: number): bigint {
  const [whole = "0", fracRaw = ""] = amount.split(".");
  const frac = fracRaw.padEnd(decimals, "0").slice(0, decimals);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac || "0");
}

/**
 * Canonical pay-in computation for a given payout target. BigInt-only —
 * NEVER use floats for money math. Rounded UP so we never under-quote.
 *
 * Inputs:
 *   - `targetBaseUnits`: payout-token amount the merchant wants delivered,
 *     in payout-token base units (e.g. 1.5 USDC = 1_500_000n at 6dp).
 *   - `rateScaled1e18`:  payout-per-1.0-pay-in ratio, scaled by 1e18. So
 *     for a probe quote that returns "1.085000" payout per 1.0 pay-in, this
 *     is `1085000000000000000n`. (Match the way `parseHuman(probeOut, 18)`
 *     would scale a stringified ratio.)
 *   - `bufferBps`:       slippage cushion, e.g. 250n for 2.5%.
 *   - `payInDecimals`/`payoutDecimals`: token decimals for the two sides.
 *
 * Returns the recommended pay-in in pay-in-token base units, rounded up.
 *
 * Used by BOTH `lib/checkout/quote-server.ts` (server-side authorize path)
 * AND `app/api/checkout/quote/route.ts` (HTTP quote endpoint) so callers
 * cannot disagree by ±1 base unit. Audit M11.
 */
export function quoteAmountIn(args: {
  targetBaseUnits:  bigint;
  rateScaled1e18:   bigint;
  bufferBps:        bigint;
  payInDecimals:    number;
  payoutDecimals:   number;
}): bigint {
  if (args.rateScaled1e18 <= 0n) throw new Error("rateScaled1e18 must be > 0");
  // recBase = targetBase * 1e18 * 10^payInDec * (10000+buf) / (10^payoutDec * rateScaled * 10000)
  const num =
    args.targetBaseUnits *
    10n ** 18n *
    10n ** BigInt(args.payInDecimals) *
    (10_000n + args.bufferBps);
  const den =
    10n ** BigInt(args.payoutDecimals) *
    args.rateScaled1e18 *
    10_000n;
  return (num + den - 1n) / den; // ceil
}

export interface ServerQuoteParams {
  payInToken:           "USDC" | "EURC";
  payoutToken:          "USDC" | "EURC";
  /** Merchant floor in payoutToken base units (= invoice.amountOut). */
  targetOutputBaseUnits: bigint;
  /** Slippage bps for the recommended payIn. Default 250 (2.5%). */
  slippageBps?:         number;
}

export interface ServerQuoteResult {
  recommendedPayInBaseUnits: bigint;
  estimatedOutputBaseUnits:  bigint;
}

/**
 * Audit App-L-10 (2026-05-31): bps env vars used to be read with a bare
 * Number(), so an empty value silently became 0 and a typo became NaN, both
 * flowing straight into the App Kit swap config (broken / wildly-off quote).
 * Parse strictly — empty falls back to the documented default; anything that
 * isn't an integer in [0, 10000] bps fails fast (matching KIT_KEY's posture)
 * so a misconfig is loud rather than producing a silently-wrong quote.
 */
function bpsEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 10_000) {
    throw new Error(`${name} must be an integer in [0,10000] bps, got: ${JSON.stringify(raw)}`);
  }
  return n;
}

export async function estimateSwapForTarget(params: ServerQuoteParams): Promise<ServerQuoteResult> {
  const kitKey = process.env.KIT_KEY;
  if (!kitKey) throw new Error("KIT_KEY missing");

  const customFeeBps = bpsEnv("CUSTOM_FEE_BPS", 100);
  const slippageBps = bpsEnv("SLIPPAGE_BPS", 100);
  const feeRecipient = process.env.CUSTOM_FEE_RECIPIENT;

  // Probe the rate with 1.0 of payInToken (matches /api/checkout/quote so
  // both clients see the same numbers within the same request burst).
  const probe = await kit.estimateSwap({
    from:     { adapter: getThrowawayAdapter(), chain: "Arc_Testnet" as const },
    tokenIn:  params.payInToken,
    tokenOut: params.payoutToken,
    amountIn: "1.0",
    config:   {
      kitKey,
      slippageBps,
      ...(feeRecipient ? { customFee: { percentageBps: customFeeBps, recipientAddress: feeRecipient } } : {}),
    },
  });
  const probeOut = (probe as { estimatedOutput?: { amount: string } }).estimatedOutput?.amount;
  if (!probeOut) throw new Error("probe quote returned no estimatedOutput");

  // BigInt-only quote rounding. Same helper used by /api/checkout/quote
  // (HTTP) so the route handler and the authorize path agree to the unit.
  // Audit M11.
  const recommended = quoteAmountIn({
    targetBaseUnits: params.targetOutputBaseUnits,
    rateScaled1e18:  parseHuman(probeOut, 18),
    bufferBps:       BigInt(params.slippageBps ?? 250),
    payInDecimals:   STABLE_DECIMALS,
    payoutDecimals:  STABLE_DECIMALS,
  });
  const recommendedHuman = humanize(recommended, STABLE_DECIMALS);

  // Run a second estimate with the resolved amountIn for the estimated output.
  const final = await kit.estimateSwap({
    from:     { adapter: getThrowawayAdapter(), chain: "Arc_Testnet" as const },
    tokenIn:  params.payInToken,
    tokenOut: params.payoutToken,
    amountIn: recommendedHuman,
    config:   { kitKey, slippageBps },
  });
  const finalOut = (final as { estimatedOutput?: { amount: string } }).estimatedOutput?.amount ?? "0";

  return {
    recommendedPayInBaseUnits: recommended,
    estimatedOutputBaseUnits:  parseHuman(finalOut, STABLE_DECIMALS),
  };
}
