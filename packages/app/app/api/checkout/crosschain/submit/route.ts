import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import type { Address, Hex } from "viem";
import { db } from "@/lib/db/client";
import { crosschainPayments } from "@/lib/db/schema";
import { verifySourceBurnTx } from "@/lib/crosschain/receipt";
import { recordCheckoutEvent } from "@/lib/crosschain/telemetry";
import { takeToken } from "@/lib/rate/limiter";
import { clientIp } from "@/lib/rate/clientIp";

// Per-IP rate limit, mirroring /api/checkout/crosschain/prepare. Each submit
// hits the DB and fans out two source-chain RPC reads for burn verification.
// 30/60s is generous for a real checkout while capping abuse. Fail-open on
// limiter outage.
const SUBMIT_LIMIT = 30;
const SUBMIT_WINDOW_SECONDS = 60;

const Body = z.object({
  intentId: z.string().uuid(),
  burnTxHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
});

// Stable verifier error codes safe to surface to anonymous clients. Anything
// else (raw RPC failures, registry/env errors) is collapsed to a generic code
// so internal hostnames and infrastructure details never leak; the raw
// message still goes to server logs and internal telemetry.
const KNOWN_BURN_ERRORS = new Set([
  "burn_tx_reverted", "burn_tx_wrong_token_messenger", "burn_tx_wrong_payer",
  "burn_tx_invalid_calldata", "burn_tx_wrong_function", "burn_tx_wrong_amount",
  "burn_tx_wrong_destination_domain", "burn_tx_wrong_mint_recipient",
  "burn_tx_wrong_burn_token", "burn_tx_wrong_destination_caller",
  "burn_tx_unexpected_max_fee", "burn_tx_wrong_finality_threshold",
]);

function isUniqueViolation(e: unknown): boolean {
  return (e as any)?.code === "23505" || (e as any)?.cause?.code === "23505";
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  let allowed = true;
  try {
    allowed = await takeToken(`cc-submit:${ip}`, SUBMIT_LIMIT, SUBMIT_WINDOW_SECONDS);
  } catch {
    allowed = true; // fail-open: limiter outage must not block checkout
  }
  if (!allowed) {
    return NextResponse.json(
      { error: "rate_limited", retryAfterSeconds: SUBMIT_WINDOW_SECONDS },
      { status: 429, headers: { "retry-after": String(SUBMIT_WINDOW_SECONDS) } },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "bad_params", details: parsed.error.issues }, { status: 400 });
  }

  const { intentId, burnTxHash } = parsed.data;
  const payment = (await db
    .select()
    .from(crosschainPayments)
    .where(eq(crosschainPayments.id, intentId))
    .limit(1))[0];

  if (!payment) return NextResponse.json({ error: "intent_not_found" }, { status: 404 });
  if (payment.status !== "authorized") {
    return NextResponse.json({ error: "intent_not_submittable", status: payment.status }, { status: 409 });
  }

  // Cross-invoice replay guard: one on-chain burn tx may back at most one
  // intent. CCTP receiveMessage is replay-protected, so a second intent
  // claiming the same burn would become an unsettleable bridge_pending row.
  // Checked before the (expensive) RPC verification; the partial unique index
  // uniq_crosschain_payments_burn_tx closes the TOCTOU window below.
  const claimed = (await db
    .select({ id: crosschainPayments.id })
    .from(crosschainPayments)
    .where(and(
      eq(crosschainPayments.sourceChainId, payment.sourceChainId),
      eq(crosschainPayments.burnTxHash, burnTxHash),
    ))
    .limit(1))[0];
  if (claimed && claimed.id !== intentId) {
    return NextResponse.json({ error: "burn_tx_already_used" }, { status: 409 });
  }

  try {
    await verifySourceBurnTx({
      sourceChainId: payment.sourceChainId,
      burnTxHash: burnTxHash as Hex,
      expectedPayer: payment.payer,
      // numeric columns can render as "5000000.00"; BigInt() would throw on
      // the decimal point. Take the integer part (AFG-009 posture: bound the
      // string before BigInt conversion).
      expectedAmount: BigInt(payment.sourceAmount.split(".")[0]!),
      expectedDestinationDomain: payment.destinationDomain,
      expectedMintRecipient: payment.mintRecipient as Hex,
      expectedBurnToken: payment.sourceToken as Address,
    });
  } catch (e) {
    // A failed verification leaves the row "authorized" so the customer can
    // retry with the correct transaction hash.
    const raw = e instanceof Error ? e.message : String(e);
    const error = KNOWN_BURN_ERRORS.has(raw) ? raw : "burn_tx_verification_failed";
    if (error !== raw) {
      console.error("crosschain_submit burn verification failed (sanitized for client)", raw);
    }
    recordCheckoutEvent({
      invoiceId: payment.invoiceId,
      crosschainPaymentId: intentId,
      eventType: "crosschain_burn_rejected",
      sourceChainId: payment.sourceChainId,
      errorCode: raw, // telemetry is internal: keep the raw code for triage
    }).catch((err) => console.error("crosschain_submit telemetry write failed", err));
    return NextResponse.json({ error }, { status: 400 });
  }

  let updated;
  try {
    updated = await db.update(crosschainPayments)
      .set({
        status: "bridge_pending",
        burnTxHash,
        burnSubmittedAt: new Date(),
        updatedAt: new Date(),
      })
      // Status race guard: two concurrent submits must not both transition the
      // row or overwrite burnTxHash. Only the one that finds the row still
      // "authorized" wins; the loser gets a 409 like any late submit.
      .where(and(eq(crosschainPayments.id, intentId), eq(crosschainPayments.status, "authorized")))
      .returning({ id: crosschainPayments.id });
  } catch (e) {
    // uniq_crosschain_payments_burn_tx fired: a concurrent submit for a
    // *different* intent claimed this burn tx between our pre-flight select
    // and this update. Same outcome as the pre-flight 409.
    if (isUniqueViolation(e)) {
      return NextResponse.json({ error: "burn_tx_already_used" }, { status: 409 });
    }
    throw e;
  }
  if (!updated[0]) {
    return NextResponse.json({ error: "intent_not_submittable" }, { status: 409 });
  }

  recordCheckoutEvent({
    invoiceId: payment.invoiceId,
    crosschainPaymentId: intentId,
    eventType: "crosschain_burn_submitted",
    sourceChainId: payment.sourceChainId,
  }).catch((err) => console.error("crosschain_submit telemetry write failed", err));

  return NextResponse.json({
    intentId,
    invoiceId: payment.invoiceId,
    status: "bridge_pending",
    statusUrl: `/api/checkout/crosschain/status/${intentId}`,
  }, { status: 202 });
}
