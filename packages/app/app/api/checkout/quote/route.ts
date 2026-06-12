import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AppKit } from "@circle-fin/app-kit";
import { getThrowawayAdapter } from "@/lib/checkout/throwaway-adapter";
import { quoteAmountIn } from "@/lib/checkout/quote-server";
import { takeToken } from "@/lib/rate/limiter";
import { clientIp } from "@/lib/rate/clientIp";
import { decimalAmount } from "@/lib/validation/amount";

/**
 * Per-IP rate limit protecting the App Kit KIT_KEY quota. Each client IP may
 * call at most 30 times per 60-second window. Fail-open: if the limiter's
 * Postgres backend is unreachable, we allow the request rather than blocking
 * all callers. Audit L7 (2026-05-06).
 */
const QUOTE_LIMIT = 30;
const QUOTE_WINDOW_SECONDS = 60;

const STABLE_DECIMALS = 6;

function parseHuman(amount: string, decimals: number): bigint {
  const [whole = "0", fracRaw = ""] = amount.split(".");
  const frac = fracRaw.padEnd(decimals, "0").slice(0, decimals);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac || "0");
}

function humanize(baseUnits: bigint, decimals: number): string {
  const scale = 10n ** BigInt(decimals);
  const whole = baseUnits / scale;
  const frac  = (baseUnits % scale).toString().padStart(decimals, "0");
  // Always pad to fixed decimals so App Kit gets a deterministic string.
  return `${whole}.${frac}`;
}

/**
 * v0.8 quote endpoint. Uses Circle's App Kit Swap to fetch a real RFQ quote
 * from the Arc maker network. Replaces the v0.6 `/api/quote` (which read our
 * own pool); both endpoints coexist while the cutover happens.
 *
 * The estimate doesn't broadcast or sign anything that hits the chain — App
 * Kit just needs an adapter shape for chain context. We fabricate one with
 * a per-cold-start throwaway key so no funded private key has to exist in
 * the Vercel env.
 */

// The endpoint supports two modes:
//   1. forward      — caller knows amountIn, asks for estimated amountOut.
//   2. targetOutput — caller knows amountOut (the merchant's floor) and
//                     wants the payIn that delivers it. Used by the v0.8
//                     hosted checkout, where the customer's payIn isn't
//                     fixed up front. Internally we probe the rate with a
//                     1.0 sample and divide.
const Q = z.object({
  payInToken:   z.enum(["USDC", "EURC"]),
  payoutToken:  z.enum(["USDC", "EURC"]),
  amountIn:     decimalAmount().optional(),   // AFG-009: length/precision capped before BigInt
  targetOutput: decimalAmount().optional(),
  /** Slippage buffer added to the recommended payIn in targetOutput mode.
   *  Default 100 bps (1%) — stable→stable rates rarely move >1% within a
   *  signature TTL on Arc. Customer commits exactly the cushioned amount;
   *  any rate-favourable surplus accrues to the protocol fee bucket
   *  (covers the rate-unfavourable shortfalls that revert the swap). */
  slippageBps:  z.number().int().min(0).max(2000).optional(),
}).refine(d => d.amountIn || d.targetOutput, {
  message: "either amountIn or targetOutput is required",
});

// Throwaway adapter lives in lib/checkout/throwaway-adapter so this route
// and lib/checkout/quote-server share the exact same singleton (audit
// App-L2, 2026-05-24). Every use here is estimate-only — never wire this
// into kit.swap (see the INVARIANT comment in throwaway-adapter.ts).
const kit = new AppKit();

export async function POST(req: NextRequest) {
  // Audit L7: rate-limit per-IP to protect KIT_KEY quota from abuse.
  const ip = clientIp(req);
  let allowed = true;
  try {
    allowed = await takeToken(`quote:${ip}`, QUOTE_LIMIT, QUOTE_WINDOW_SECONDS);
  } catch {
    // Fail-open: limiter outage shouldn't block legitimate traffic.
    allowed = true;
  }
  if (!allowed) {
    return NextResponse.json(
      { error: "rate_limited", retryAfterSeconds: QUOTE_WINDOW_SECONDS },
      { status: 429, headers: { "retry-after": String(QUOTE_WINDOW_SECONDS) } },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = Q.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "bad_params", details: parsed.error.issues }, { status: 400 });
  }
  const { payInToken, payoutToken, amountIn, targetOutput, slippageBps } = parsed.data;
  if (payInToken === payoutToken) {
    return NextResponse.json({ error: "same_token" }, { status: 400 });
  }

  const kitKey = process.env.KIT_KEY;
  if (!kitKey) {
    return NextResponse.json({ error: "kit_key_missing" }, { status: 500 });
  }

  try {
    let resolvedAmountIn = amountIn;

    // targetOutput mode: probe the rate with a 1.0 sample, divide, add a
    // slippage cushion. This is the path the hosted checkout takes when
    // the customer hasn't been asked to pick a payIn manually.
    if (!resolvedAmountIn && targetOutput) {
      // Include customFee in the probe so the returned rate already reflects
      // the 1% fee App Kit takes off the input at execution time. Without
      // this, the probe is 1% optimistic and the real swap delivers below
      // the merchant's floor. Recipient is the relayer's configured fee
      // address (same one the actual swap uses) to keep the math identical.
      const customFeeBps   = Number(process.env.CUSTOM_FEE_BPS ?? "100");
      const feeRecipient   = process.env.CUSTOM_FEE_RECIPIENT;
      const probe = await kit.estimateSwap({
        from:     { adapter: getThrowawayAdapter(), chain: "Arc_Testnet" as const },
        tokenIn:  payInToken,
        tokenOut: payoutToken,
        amountIn: "1.0",
        config:   {
          kitKey,
          slippageBps: Number(process.env.SLIPPAGE_BPS ?? "100"),
          ...(feeRecipient ? { customFee: { percentageBps: customFeeBps, recipientAddress: feeRecipient } } : {}),
        },
      });
      const probeOut = (probe as { estimatedOutput?: { amount: string } }).estimatedOutput?.amount;
      if (!probeOut) throw new Error("probe quote returned no estimatedOutput");
      // amountIn = targetOutput / rate, where rate = probeOut/1.0.
      // Default cushion 250 bps — covers RFQ rate drift between probe and
      // actual execution. (Was 100 bps; bumped after settle reverts under
      // adverse rate movement on testnet.)
      // Computed via the canonical BigInt helper shared with quote-server.ts
      // so the HTTP path and the server-side authorize path agree to the
      // base unit (M11).
      const recommendedBase = quoteAmountIn({
        targetBaseUnits: parseHuman(targetOutput, STABLE_DECIMALS),
        rateScaled1e18:  parseHuman(probeOut, 18),
        bufferBps:       BigInt(slippageBps ?? 250),
        payInDecimals:   STABLE_DECIMALS,
        payoutDecimals:  STABLE_DECIMALS,
      });
      resolvedAmountIn = humanize(recommendedBase, STABLE_DECIMALS);
    }

    if (!resolvedAmountIn) {
      return NextResponse.json({ error: "missing_amount" }, { status: 400 });
    }

    const estimate = await kit.estimateSwap({
      from:     { adapter: getThrowawayAdapter(), chain: "Arc_Testnet" as const },
      tokenIn:  payInToken,
      tokenOut: payoutToken,
      amountIn: resolvedAmountIn,
      config:   { kitKey, slippageBps: Number(process.env.SLIPPAGE_BPS ?? "100") },
    });

    const e = estimate as {
      estimatedOutput?: { amount: string; token: string };
      stopLimit?:       { amount: string; token: string };
      fees?:            readonly { token: string; amount: string; type: string }[];
    };

    return NextResponse.json({
      payInToken, payoutToken,
      amountIn:        resolvedAmountIn,
      estimatedOutput: e.estimatedOutput?.amount,
      stopLimit:       e.stopLimit?.amount,
      fees:            e.fees ?? [],
      // 30 seconds is the lifetime the SDK shows the operator before forcing a
      // refresh; the underlying RFQ rate moves and old quotes won't fill.
      ttlSeconds:      30,
      issuedAt:        new Date().toISOString(),
    });
  } catch (err) {
    // Log internally for ops — App Kit error messages can include the RFQ node
    // identifier and (occasionally) a fragment of the kit key, so they must
    // not appear in the response body (Pulse-AI M8 closure carried forward).
    console.error("[quote] estimateSwap failed:", err);
    return NextResponse.json({ error: "estimate_failed" }, { status: 502 });
  }
}
