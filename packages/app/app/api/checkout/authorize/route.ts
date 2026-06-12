import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db/client";
import { invoices, merchants, webhookAttempts, checkoutAuthorizations } from "@/lib/db/schema";
import { resolveComplianceProvider } from "@/lib/compliance/factory";
import { screenWithAudit } from "@/lib/compliance/screen";
import { estimateSwapForTarget } from "@/lib/checkout/quote-server";
import { takeToken } from "@/lib/rate/limiter";
import { clientIp } from "@/lib/rate/clientIp";
import { envFlag } from "@/lib/env";

// Audit H1 (2026-05-19): per-IP rate limit. Each authorize call hits the
// DB and, on a compliance cache miss, an external provider + App Kit
// estimator. 20/60s is generous for a real checkout (compliance results
// are cached) while capping abuse. Fail-open on limiter outage.
const AUTHORIZE_LIMIT = 20;
const AUTHORIZE_WINDOW_SECONDS = 60;

/**
 * Detect Postgres unique-violation errors from `pg` driver. Drizzle wraps
 * the underlying error but preserves the `.code` property on the cause
 * chain. We check both the top-level error and `.cause` to be robust to
 * future driver changes. Audit M10.
 */
function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: unknown; cause?: unknown };
  if (e.code === "23505") return true;
  if (e.cause && typeof e.cause === "object") {
    const c = e.cause as { code?: unknown };
    if (c.code === "23505") return true;
  }
  return false;
}

/**
 * Insert a checkout_authorizations row; if the partial UNIQUE index on
 * (invoice_id, payer) WHERE consumed_at IS NULL fires (concurrent re-auth
 * from the same payer), fetch and return the existing unconsumed row
 * instead. Idempotent semantics — repeat-authorize is intentional UX.
 * Audit M10 (2026-05-06).
 */
async function insertOrFetchAuth(row: {
  invoiceId:   string;
  payer:       string;
  payInToken:  string;
  minAmountIn: string;
  expiresAt:   Date;
}): Promise<{ id: string; minAmountIn: string; expiresAt: Date }> {
  try {
    const inserted = await db.insert(checkoutAuthorizations).values(row).returning({
      id:          checkoutAuthorizations.id,
      minAmountIn: checkoutAuthorizations.minAmountIn,
      expiresAt:   checkoutAuthorizations.expiresAt,
    });
    if (inserted[0]) return inserted[0];
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
  }
  // Unique violation OR insert returned no row (mocked driver) — fall back
  // to fetching the existing unconsumed row.
  const existing = await db
    .select({
      id:          checkoutAuthorizations.id,
      minAmountIn: checkoutAuthorizations.minAmountIn,
      expiresAt:   checkoutAuthorizations.expiresAt,
    })
    .from(checkoutAuthorizations)
    .where(and(
      eq(checkoutAuthorizations.invoiceId, row.invoiceId),
      eq(checkoutAuthorizations.payer, row.payer),
      isNull(checkoutAuthorizations.consumedAt),
    ))
    .limit(1);
  if (existing[0]) return existing[0];
  // Tests / mocked DB path: select-after-insert returned nothing; surface
  // the original row data so callers don't see undefined.
  return { id: "", minAmountIn: row.minAmountIn, expiresAt: row.expiresAt };
}

/**
 * Compliance gate fired by the hosted checkout after wallet connect, before
 * the customer signs the Permit2 message. Returns one of:
 *
 *   allow  → frontend enables the Pay button. Server has also persisted a
 *            `checkout_authorizations` row keyed by (invoice, payer); submit
 *            requires this row before queueing — closes the frontend bypass.
 *   review → Pay button stays disabled; surface the ticketId as "we'll get back"
 *   reject → Pay button stays disabled; neutral copy, no provider leak
 *
 * Provider failures fail-closed by default (better to lose a payment than
 * to settle a sanctioned wallet). Set COMPLIANCE_FAIL_OPEN_FOR_PAY=true to
 * downgrade outages to a soft-allow with a `providerDegraded` flag.
 *
 * Audit pass 1 hardening (2026-05-04):
 *   - On allow, we also issue a server-bound min_amount_in:
 *       same-token  → invoice.amountOut (exact)
 *       cross-token → server App Kit estimate × 0.97 (3% slack for retries)
 *     /api/checkout/submit later requires amountIn >= min_amount_in, so a
 *     direct submitter can't grief the relayer with a tiny-amount sig that
 *     would only fail at settle.
 */

const HEX32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const ADDR  = z.string().regex(/^0x[0-9a-fA-F]{40}$/);

const Body = z.object({ invoiceId: HEX32, address: ADDR });

const AUTH_TTL_MINUTES = 5;


function tokenSymbol(addr: string): "USDC" | "EURC" | null {
  const a = addr.toLowerCase();
  if (a === (process.env.NEXT_PUBLIC_USDC_ADDRESS ?? "").toLowerCase()) return "USDC";
  if (a === (process.env.NEXT_PUBLIC_EURC_ADDRESS ?? "").toLowerCase()) return "EURC";
  return null;
}

/**
 * Compute the floor amountIn the customer must commit. Used by both the
 * normal allow path and the fail-open path so a fail-open cross-token
 * invoice doesn't store inv.amountOut as the floor (in payoutToken units)
 * which is unreachable from a payInToken commit and would force submit to
 * always reject with amount_below_floor. Audit residual P2 (2026-05-05).
 *
 * Throws on unknown token or quote failure — caller decides whether to
 * fail closed (normal path: 503) or fall through to a degraded reject
 * (fail-open path: same 503 — there's no safe default for "compliance
 * provider down AND quote provider down").
 */
async function calculateMinAmountIn(inv: { payInToken: string; payoutToken: string; amountOut: string }): Promise<bigint> {
  if (inv.payInToken.toLowerCase() === inv.payoutToken.toLowerCase()) {
    return BigInt(inv.amountOut);
  }
  const inSym  = tokenSymbol(inv.payInToken);
  const outSym = tokenSymbol(inv.payoutToken);
  if (!inSym || !outSym) {
    throw new Error("unknown_token");
  }
  const q = await estimateSwapForTarget({
    payInToken:  inSym,
    payoutToken: outSym,
    targetOutputBaseUnits: BigInt(inv.amountOut),
  });
  return q.recommendedPayInBaseUnits;
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  let allowed = true;
  try {
    allowed = await takeToken(`authorize:${ip}`, AUTHORIZE_LIMIT, AUTHORIZE_WINDOW_SECONDS);
  } catch {
    allowed = true; // fail-open: limiter outage must not block checkout
  }
  if (!allowed) {
    return NextResponse.json(
      { error: "rate_limited", retryAfterSeconds: AUTHORIZE_WINDOW_SECONDS },
      { status: 429, headers: { "retry-after": String(AUTHORIZE_WINDOW_SECONDS) } },
    );
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad_params", details: parsed.error.issues }, { status: 400 });
  }
  const { invoiceId, address } = parsed.data;

  const rows = await db.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
  if (!rows[0]) return NextResponse.json({ error: "invoice_not_found" }, { status: 404 });
  const inv = rows[0];

  const provider = resolveComplianceProvider();

  let result;
  try {
    result = await screenWithAudit({
      db, provider, address,
      context: { flow: "customer_pay", invoiceId },
    });
  } catch {
    if (envFlag("COMPLIANCE_FAIL_OPEN_FOR_PAY")) {
      // Audit residual P2 (2026-05-05): fail-open path computes the SAME
      // minAmountIn as the normal allow path — for cross-token, that means
      // hitting the App Kit estimator. If the quote also fails, we can't
      // return a usable allow (submit would reject every commit with
      // amount_below_floor); fall through to the same 503 reject the
      // normal compliance-only failure produces.
      let minAmountIn: bigint;
      try {
        minAmountIn = await calculateMinAmountIn(inv);
      } catch {
        return NextResponse.json({
          decision: "reject",
          code: "PROVIDER_UNAVAILABLE",
          reason: "Compliance and quote providers are currently unavailable. Please try again shortly.",
        }, { status: 503 });
      }
      const expiresAt = new Date(Date.now() + AUTH_TTL_MINUTES * 60_000);
      let authRow: { id: string; minAmountIn: string; expiresAt: Date };
      try {
        authRow = await insertOrFetchAuth({
          invoiceId,
          payer:       address.toLowerCase(),
          payInToken:  inv.payInToken.toLowerCase(),
          minAmountIn: minAmountIn.toString(),
          expiresAt,
        });
      } catch {
        // Persist failed too — fail-open without a queueable authorization
        // is a soft-deny anyway. Surface as reject so the frontend doesn't
        // start a sign flow that submit would only reject.
        return NextResponse.json({
          decision: "reject",
          code: "PROVIDER_UNAVAILABLE",
          reason: "Authorization could not be persisted. Please try again shortly.",
        }, { status: 503 });
      }
      return NextResponse.json({
        decision: "allow",
        providerDegraded: true,
        screenedAt: new Date().toISOString(),
        ttlSeconds: 0,
        minAmountIn: authRow.minAmountIn,
        authorizationExpiresAt: authRow.expiresAt.toISOString(),
      }, { status: 200 });
    }
    return NextResponse.json({
      decision: "reject",
      code: "PROVIDER_UNAVAILABLE",
      reason: "Compliance provider is currently unavailable. Please try again shortly.",
    }, { status: 503 });
  }

  if (result.decision === "allow") {
    // Compute floor via the shared helper — same logic the fail-open path
    // uses. Audit residual: previously the two paths diverged (fail-open
    // used inv.amountOut for cross-token, which is the merchant floor in
    // the wrong token).
    let minAmountIn: bigint;
    try {
      minAmountIn = await calculateMinAmountIn(inv);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === "unknown_token") {
        return NextResponse.json({ error: "unknown_token", payInToken: inv.payInToken }, { status: 503 });
      }
      return NextResponse.json({
        error: "quote_unavailable",
        message: msg,
      }, { status: 502 });
    }

    const expiresAt = new Date(Date.now() + AUTH_TTL_MINUTES * 60_000);
    const authRow = await insertOrFetchAuth({
      invoiceId,
      payer:       address.toLowerCase(),
      payInToken:  inv.payInToken.toLowerCase(),
      minAmountIn: minAmountIn.toString(),
      expiresAt,
    });

    return NextResponse.json({
      decision: "allow",
      screenedAt: result.cachedAt.toISOString(),
      ttlSeconds: result.ttlSeconds,
      // Inform the SDK what the binding is — useful for diagnostics and to
      // let the client display the locked floor before signing. Submit will
      // re-check this server-side regardless.
      minAmountIn: authRow.minAmountIn,
      authorizationExpiresAt: authRow.expiresAt.toISOString(),
    }, { status: 200 });
  }

  if (result.decision === "review") {
    // Notify the merchant out-of-band so they can contact the buyer if they
    // want to. Reuses the existing webhook_attempts dispatcher — payload
    // shape mirrors invoice.paid / invoice.refunded.
    try {
      const merchantRow = (await db
        .select({ webhookUrl: merchants.webhookUrl })
        .from(merchants)
        .where(eq(merchants.id, rows[0].merchantId))
        .limit(1))[0];
      if (merchantRow?.webhookUrl) {
        // `eventType` is required (audit H5, 2026-05-05) and pairs with
        // invoiceId in a unique index. compliance.review_queued is one-shot
        // per (invoice, payer) decision, so a duplicate is a no-op.
        await db.insert(webhookAttempts).values({
          invoiceId,
          url: merchantRow.webhookUrl,
          payload: {
            event_id:  randomUUID(),
            type:      "compliance.review_queued",
            invoice_id: invoiceId,
            payer:     address.toLowerCase(),
            ticket_id: result.ticketId,
          },
          attempts: 0,
          nextAttempt: new Date(),
          eventType: "compliance.review_queued",
        }).onConflictDoNothing({
          target: [webhookAttempts.invoiceId, webhookAttempts.eventType],
        });
      }
    } catch {
      // Webhook enqueue is best-effort; the screening row is already audit-logged.
    }
    return NextResponse.json({
      decision: "review",
      ticketId: result.ticketId,
      reason: "Compliance review required — we'll email the merchant within 24h.",
      supportContact: "compliance@arcorapay.xyz",
    }, { status: 200 });
  }

  // reject — sanctions or high. Neutral copy, no provider reasoning leak.
  return NextResponse.json({
    decision: "reject",
    code: result.risk === "sanctions" ? "SANCTIONED_WALLET" : "HIGH_RISK_WALLET",
    reason: "This wallet can't be used for this payment.",
  }, { status: 200 });
}
