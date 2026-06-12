import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { invoices, merchants } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { lookupMerchantByApiKey } from "@/lib/auth/apikey";
import { privateJson } from "@/lib/security/respond";
import { takeToken } from "@/lib/rate/limiter";
import { clientIp } from "@/lib/rate/clientIp";

// Audit 2026-06-11 MED-4: per-IP rate limit on invoice reads. Each GET costs
// a DB join and, when an API key is presented, a bcrypt compare; 30/60s is
// generous for a real checkout widget while capping scraping/grind abuse.
// Fail-open on limiter outage, same as checkout/submit.
const INVOICE_GET_LIMIT = 30;
const INVOICE_GET_WINDOW_SECONDS = 60;

/**
 * Public GET — returns the minimal fields the checkout widget needs.
 * Audit L8 (2026-05-06): `metadata` is merchant-controlled JSONB and must
 * NOT be returned to anonymous callers (it may contain internal order refs,
 * PII-adjacent notes, or custom pricing data). Also drop `paidBy` / `paidTx`
 * from the public shape for the same reason (payer address leaks).
 *
 * Authenticated callers (merchant API key matching this invoice's merchant)
 * receive the full record including `metadata`, `paidBy`, and `paidTx`.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const ip = clientIp(req);
  let allowed = true;
  try {
    allowed = await takeToken(`invoice-get:${ip}`, INVOICE_GET_LIMIT, INVOICE_GET_WINDOW_SECONDS);
  } catch {
    allowed = true; // fail-open: limiter outage must not block checkout
  }
  if (!allowed) {
    return NextResponse.json(
      { error: "rate_limited", retryAfterSeconds: INVOICE_GET_WINDOW_SECONDS },
      { status: 429, headers: { "retry-after": String(INVOICE_GET_WINDOW_SECONDS) } },
    );
  }

  const { id } = await ctx.params;
  // Audit H1 (2026-05-05): expose merchant's allowed_origins so the checkout
  // client can do a defense-in-depth check before redirecting after pay
  // (server enforces it at create-time; this guards stale/cached invoices).
  const rows = await db
    .select({
      id: invoices.id,
      status: invoices.status,
      payInToken: invoices.payInToken,
      payoutToken: invoices.payoutToken,
      amountOut: invoices.amountOut,
      expiresAt: invoices.expiresAt,
      paidBy: invoices.paidBy,
      paidTx: invoices.paidTx,
      paidAt: invoices.paidAt,
      metadata: invoices.metadata,
      merchantId: invoices.merchantId,
      allowedOrigins: merchants.allowedOrigins,
    })
    .from(invoices)
    .innerJoin(merchants, eq(merchants.id, invoices.merchantId))
    .where(eq(invoices.id, id))
    .limit(1);
  if (rows.length === 0) return privateJson({ error: "not_found" }, { status: 404 });
  const inv = rows[0]!;

  // Determine if the caller is the owning merchant (authenticated). The SDK
  // and POST /api/invoices send `X-Arcora-Api-Key`; older callers and a few
  // docs examples used `x-api-key`. Accept both — checking the canonical
  // header first — so merchants who follow the docs aren't silently
  // downgraded to the public invoice shape.
  const apiKeyHeader =
    req.headers.get("x-arcora-api-key") ??
    req.headers.get("x-api-key") ??
    "";
  let isAuthed = false;
  if (apiKeyHeader) {
    try {
      const merchant = await lookupMerchantByApiKey(apiKeyHeader);
      if (merchant && merchant.id === inv.merchantId) {
        isAuthed = true;
      }
    } catch {
      // Lookup failure → treat as unauthenticated; safe default.
    }
  }

  const publicResponse = {
    id: inv.id,
    status: inv.status,
    payInToken: inv.payInToken,
    payoutToken: inv.payoutToken,
    amountOut: inv.amountOut,
    expiresAt: inv.expiresAt.toISOString(),
    allowedOrigins: inv.allowedOrigins ?? [],
  };

  if (!isAuthed) {
    return privateJson(publicResponse);
  }

  // Authenticated merchant: return full record.
  return privateJson({
    ...publicResponse,
    metadata: inv.metadata,
    paidBy: inv.paidBy,
    paidTx: inv.paidTx,
    paidAt: inv.paidAt?.toISOString() ?? null,
  });
}
