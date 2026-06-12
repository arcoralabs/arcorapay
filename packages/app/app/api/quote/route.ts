import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { POOL_ABI } from "@/lib/chain/pool-abi";
import { publicClient, POOL } from "@/lib/chain/client";
import { takeToken } from "@/lib/rate/limiter";
import { clientIp } from "@/lib/rate/clientIp";
import { integerAmount } from "@/lib/validation/amount";

/**
 * v0.6 quote endpoint. Reads our own on-chain pool (calculateSwap).
 * Superseded by POST /api/checkout/quote (v0.8, App Kit RFQ), but kept
 * alive until any remaining SDK/demo-merchant consumers cut over. The
 * v0.8 route already carries a per-IP rate limit; v0.6 used to be wide
 * open and could be hammered to exhaust the shared publicClient RPC
 * quota that the relayer and indexer also use.
 *
 * Audit App-L1 (2026-05-24): match v0.8's per-IP limiter shape so a
 * legacy caller can't accidentally take the platform-wide RPC quota down
 * with it. Same fail-open posture.
 */
const QUOTE_LIMIT = 30;
const QUOTE_WINDOW_SECONDS = 60;

// Audit App-L-6 (2026-05-31): amountIn used to be an unbounded coerced bigint,
// so `?amountIn=-1` (or a uint256-sized garbage value) sailed straight into
// readContract and surfaced as a 500 instead of a 400. Bound it to a positive,
// sane ceiling. 1e18 base units is ~$1e12 at 6 decimals — far past any real
// pool liquidity, so it only rejects obvious garbage.
const MAX_QUOTE_IN = 10n ** 18n;

const Q = z.object({
  from: z.enum(["USDC", "EURC"]),
  to: z.enum(["USDC", "EURC"]),
  // AFG-009: validate (length-capped) string BEFORE BigInt, then transform —
  // z.coerce.bigint() would BigInt() an unbounded string during coercion.
  amountIn: integerAmount("amountIn out of range")
    .transform((s) => BigInt(s))
    .refine((v) => v > 0n && v <= MAX_QUOTE_IN, { message: "amountIn out of range" }),
});

const TOKEN_INDEX = { USDC: 0, EURC: 1 } as const;

export async function GET(req: NextRequest) {
  const ip = clientIp(req);
  let allowed = true;
  try {
    allowed = await takeToken(`quote-v06:${ip}`, QUOTE_LIMIT, QUOTE_WINDOW_SECONDS);
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

  const params = Object.fromEntries(new URL(req.url).searchParams);
  const parsed = Q.safeParse(params);
  if (!parsed.success) return NextResponse.json({ error: "bad_params" }, { status: 400 });
  const { from, to, amountIn } = parsed.data;
  if (from === to) return NextResponse.json({ error: "same_token" }, { status: 400 });

  let out: bigint;
  try {
    out = await publicClient.readContract({
      address: POOL,
      abi: POOL_ABI,
      functionName: "calculateSwap",
      args: [TOKEN_INDEX[from], TOKEN_INDEX[to], amountIn],
    });
  } catch {
    // Pool revert / RPC hiccup → 502, not an unhandled 500. (Audit App-L-6)
    return NextResponse.json({ error: "quote_unavailable" }, { status: 502 });
  }
  return NextResponse.json({ from, to, amountIn: amountIn.toString(), amountOut: out.toString() });
}
