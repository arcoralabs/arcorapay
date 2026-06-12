import { NextRequest } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import type { Address } from "viem";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { merchants } from "@/lib/db/schema";
import { publicClient, GATEWAY_ADDRESS } from "@/lib/chain/client";
import { GATEWAY_ABI } from "@/lib/chain/gateway-abi";
import { isSameOrigin, isJsonContentType } from "@/lib/security/csrf";
import { privateJson } from "@/lib/security/respond";

const Body = z.object({
  payoutToken: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
});

/**
 * Update the merchant's settle currency.
 *
 * Flow: merchant signs `updatePayoutToken(newToken)` on the gateway from
 * the client. After the tx confirms, the client calls this endpoint to sync
 * the DB. We don't trust client-supplied tx hashes — instead we read the
 * merchant's current `payoutToken` directly from the contract and require
 * it to match the requested address. If the on-chain state doesn't agree,
 * the DB is left untouched.
 *
 * Existing invoices are not affected: amountOut/payoutToken are frozen at
 * invoice creation. Only invoices created after this update settle in the
 * new token.
 */
export async function POST(req: NextRequest) {
  // AFG-006 (2026-06-07): same Origin/Referer CSRF guard the sibling
  // state-changing merchant routes (api-key, origins, bootstrap, webhook) carry.
  if (!isSameOrigin(req)) return privateJson({ error: "csrf" }, { status: 403 });
  if (!isJsonContentType(req)) {
    return privateJson({ error: "unsupported_content_type" }, { status: 415 });
  }
  const session = await getSession();
  if (!session.merchantAddress) {
    return privateJson({ error: "unauthorized" }, { status: 401 });
  }

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) {
    return privateJson({ error: "bad_body" }, { status: 400 });
  }
  const requested = parsed.data.payoutToken.toLowerCase();

  // Same allowlist used by /api/merchant/bootstrap (Audit L5).
  const supportedTokens: string[] = process.env.SUPPORTED_PAYOUT_TOKENS
    ? process.env.SUPPORTED_PAYOUT_TOKENS.split(",").map((a) => a.trim().toLowerCase()).filter(Boolean)
    : [
        (process.env.USDC_ADDRESS ?? "").toLowerCase(),
        (process.env.EURC_ADDRESS ?? "").toLowerCase(),
      ].filter(Boolean);
  if (supportedTokens.length > 0 && !supportedTokens.includes(requested)) {
    return privateJson({ error: "unsupported_payout_token" }, { status: 400 });
  }

  // Verify on-chain that the merchant has actually switched to this token.
  // The chain is the source of truth; the DB row mirrors it.
  let onChainPayoutToken: string;
  try {
    const info = await publicClient.readContract({
      address: GATEWAY_ADDRESS,
      abi: GATEWAY_ABI,
      functionName: "merchants",
      args: [session.merchantAddress as Address],
    }) as readonly [string, string, boolean];
    onChainPayoutToken = info[1].toLowerCase();
  } catch {
    return privateJson({ error: "chain_read_failed" }, { status: 502 });
  }

  if (onChainPayoutToken !== requested) {
    return privateJson(
      { error: "onchain_mismatch", onChain: onChainPayoutToken },
      { status: 409 },
    );
  }

  await db
    .update(merchants)
    .set({ payoutToken: parsed.data.payoutToken })
    .where(eq(merchants.address, session.merchantAddress));

  return privateJson({ ok: true, payoutToken: parsed.data.payoutToken });
}
