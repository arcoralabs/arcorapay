import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { crosschainPayments } from "@/lib/db/schema";

/** UUID v4 regex used to guard against drizzle/pg uuid cast errors (→ 500). */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** States where we surface lastError to the caller.
 *
 * FORWARD CONTRACT: the relayer worker MUST only write stable, enumerated
 * error codes to `last_error` (e.g. "CCTP_ATTESTATION_TIMEOUT") — never raw
 * RPC text, stack traces, or internal host names. This route gates on status,
 * but it is the worker's responsibility to keep last_error safe to expose.
 */
const FAILED_STATES = new Set(["bridge_failed", "arc_swap_failed", "settle_failed"]);

const NO_STORE = { "cache-control": "no-store" } as const;

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  // Validate UUID before querying — avoids pg casting "not-a-uuid" to a uuid
  // type, which would turn into an unhandled 500.
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
  }

  // Security trim (M12 parity): anonymous callers only get the fields the
  // checkout UI needs — status for polling, settleTxHash on success, error
  // code on failure. burnTxHash / bridgeReceiveTxHash / arcSwapTxHash / sourceChainId
  // link the invoice to customer wallet activity and must not be exposed here.
  const row = (await db
    .select({
      id: crosschainPayments.id,
      invoiceId: crosschainPayments.invoiceId,
      status: crosschainPayments.status,
      settleTxHash: crosschainPayments.settleTxHash,
      lastError: crosschainPayments.lastError,
      updatedAt: crosschainPayments.updatedAt,
    })
    .from(crosschainPayments)
    .where(eq(crosschainPayments.id, id))
    .limit(1))[0];

  if (!row) {
    return NextResponse.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
  }

  return NextResponse.json(
    {
      intentId: row.id,
      invoiceId: row.invoiceId,
      status: row.status,
      settleTxHash: row.status === "paid" ? row.settleTxHash : null,
      // Only expose lastError on terminal failure states. See FORWARD CONTRACT
      // above — the worker must write only stable error codes here.
      error: FAILED_STATES.has(row.status) ? row.lastError : null,
      updatedAt: row.updatedAt.toISOString(),
    },
    { headers: NO_STORE },
  );
}
