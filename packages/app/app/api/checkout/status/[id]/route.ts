import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { invoices, relayerQueue } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { timingSafeEqual } from "node:crypto";

/**
 * Polled by the SDK / hosted checkout while the customer waits for the
 * relayer to settle their submission. Status values:
 *
 *   pending     queued, waiting for the daemon to claim
 *   processing  daemon has started — Permit2 + swap + settle in flight
 *   settled     gateway emitted InvoicePaid; safe to redirect to successUrl
 *   refunded    swap failed and the relayer auto-refunded the customer
 *   failed      terminal — relayer couldn't settle and couldn't refund;
 *               operator intervention required
 *
 * Audit M12 (2026-05-06): without a valid status token (issued at submit
 * time, 30-min TTL), this endpoint returns ONLY the bare status. With a
 * matching token, it returns the full detail (lastError, tx hashes, etc.).
 * The token comes back in the submit response and is forwarded by the
 * hosted checkout poller via the `x-status-token` header.
 *
 * Audit 2026-06-11 HIGH-4: the `?token=` query channel was removed —
 * query strings end up in access logs (CWE-598); the header is the only
 * accepted channel. A token present in the query string is ignored.
 */

// Audit 2026-06-11: polled anonymously by the hosted checkout / SDK — every
// branch must be uncacheable. Deliberately NOT privateJson: this is a public
// endpoint, so `private` would be misleading; plain no-store is the contract.
const PUBLIC_NO_STORE = { "Cache-Control": "no-store" } as const;

function tokensEqual(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  // Constant-time compare to avoid leaking token prefix length on guessing.
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const rows = await db
    .select({
      status:       relayerQueue.status,
      invoiceId:    relayerQueue.invoiceId,
      attempts:     relayerQueue.attempts,
      swapTxHash:   relayerQueue.swapTxHash,
      settleTxHash: relayerQueue.settleTxHash,
      refundTxHash: relayerQueue.refundTxHash,
      lastError:    relayerQueue.lastError,
      createdAt:    relayerQueue.createdAt,
      updatedAt:    relayerQueue.updatedAt,
    })
    .from(relayerQueue)
    .where(eq(relayerQueue.id, id))
    .limit(1);

  const row = rows[0];
  if (!row) {
    return NextResponse.json(
      { error: "not_found" },
      { status: 404, headers: PUBLIC_NO_STORE },
    );
  }

  // Status token gate (audit M12). Without a valid token, return only the
  // bare status. The hosted checkout poller forwards the token from the
  // submit response on each poll; SDK consumers do the same.
  // Audit 2026-06-11 HIGH-4: header-only — query strings end up in access logs.
  const presented = req.headers.get("x-status-token");

  let tokenOk = false;
  if (presented) {
    const inv = (await db
      .select({
        statusToken:          invoices.statusToken,
        statusTokenExpiresAt: invoices.statusTokenExpiresAt,
      })
      .from(invoices)
      .where(eq(invoices.id, row.invoiceId))
      .limit(1))[0];
    if (inv?.statusToken &&
        inv.statusTokenExpiresAt &&
        inv.statusTokenExpiresAt.getTime() > Date.now() &&
        tokensEqual(inv.statusToken, presented)) {
      tokenOk = true;
    }
  }

  if (!tokenOk) {
    // Public minimum: status only. Even submissionId/invoiceId are arguably
    // a leak, but a polling client already knows the submissionId (it was
    // returned from submit), and the invoiceId is in the on-chain hosted
    // checkout URL. Hide everything else.
    return NextResponse.json({ status: row.status }, { headers: PUBLIC_NO_STORE });
  }

  return NextResponse.json({
    submissionId: id,
    invoiceId:    row.invoiceId,
    status:       row.status,
    attempts:     row.attempts,
    swapTxHash:   row.swapTxHash,
    settleTxHash: row.settleTxHash,
    refundTxHash: row.refundTxHash,
    // Only surface the error string if it's terminal. Mid-flight retry
    // errors are noise to the customer.
    error:        row.status === "failed" ? row.lastError : null,
    createdAt:    row.createdAt.toISOString(),
    updatedAt:    row.updatedAt.toISOString(),
  }, { headers: PUBLIC_NO_STORE });
}
