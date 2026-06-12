import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { Address, Hex } from "viem";
import { db } from "@/lib/db/client";
import { invoices, relayerQueue, checkoutAuthorizations } from "@/lib/db/schema";
import { takeToken } from "@/lib/rate/limiter";
import { clientIp } from "@/lib/rate/clientIp";
import { expectedWitnessHash, PERMIT2_WITNESS_TYPE_STRING } from "@/lib/checkout/witness";
import { verifyPermit2Signature, ARC_TESTNET_CHAIN_ID } from "@/lib/checkout/permit2-verify";
import { integerAmount } from "@/lib/validation/amount";

// Audit H1 (2026-05-19): submit is one-shot per invoice; 10/60s never
// bothers a real user while capping abuse. Fail-open on limiter outage.
const SUBMIT_LIMIT = 10;
const SUBMIT_WINDOW_SECONDS = 60;

/** Status token TTL — long enough for the customer to walk away and come
 *  back, short enough that a leaked token from a logging proxy doesn't
 *  reveal post-settle details indefinitely. Audit M12. */
const STATUS_TOKEN_TTL_MS = 30 * 60_000;

/**
 * v0.8 customer-side submit. The customer signs a Permit2 EIP-712 message
 * in their wallet (gas-less); the SDK POSTs it here. We validate, persist
 * to relayer_queue, and the daemon picks it up on its next tick.
 *
 * Audit pass 1 hardening (2026-05-04):
 *  - Authorization required: an active (unconsumed, unexpired) row must
 *    exist in `checkout_authorizations` for (invoice_id, payer). Closes
 *    the frontend-only compliance gate bypass.
 *  - Off-chain Permit2 signature recovery: we reconstruct the typed-data
 *    server-side from bound parameters (chain id, our relayer, invoice id,
 *    token, amount, nonce, deadline) and recover the signer. If recovery
 *    doesn't match the claimed payer, reject — relayer never burns gas on
 *    a forged sig.
 *  - Min amountIn: amountIn must clear the floor recorded at authorize
 *    time (same-token: invoice.amountOut; cross-token: 97% of server quote).
 *    Closes the tiny-amount grief vector that wasted relayer gas at swap
 *    or settle.
 *  - Idempotency: relayer_queue has a partial unique index on (invoice_id)
 *    over active statuses, so the unique-constraint violation on concurrent
 *    submits maps to `duplicate_submission` instead of double-pulling.
 *
 * Pre-existing hardening (kept):
 *  - Witness re-derivation: witness hash sent in must equal the value we
 *    compute from (invoiceId, relayer).
 *  - payInToken bind to invoice.
 *  - amountIn sanity bounds.
 */

const HEX = /^0x[0-9a-fA-F]+$/;
const ADDR = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "must be a 0x-prefixed address");
const HEX32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "must be 32 bytes hex");

const SubmitBody = z.object({
  invoiceId:        HEX32,
  payer:            ADDR,
  payInToken:       ADDR,
  amountIn:         integerAmount("amountIn must be a base-units integer string"), // AFG-009: length-capped
  permit2Data: z.object({
    nonce:             z.string().regex(/^\d+$/),
    deadline:          z.string().regex(/^\d+$/),
    witness:           HEX32,
    witnessTypeString: z.string().min(1),
  }),
  permit2Signature: z.string().regex(HEX, "must be hex"),
});

// Server-side security binding — prefer the server-only env var. The
// NEXT_PUBLIC_ fallback keeps current deploys working and dies at mainnet.
const RELAYER_ADDRESS = (process.env.RELAYER_ADDRESS ?? process.env.NEXT_PUBLIC_RELAYER_ADDRESS ?? "") as Address;
const MAX_AMOUNT_IN_BASE_UNITS = 10n ** 30n; // ~10^30, generous upper bound covers any sane stable transfer

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  let allowed = true;
  try {
    allowed = await takeToken(`submit:${ip}`, SUBMIT_LIMIT, SUBMIT_WINDOW_SECONDS);
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
  const parsed = SubmitBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "bad_params", details: parsed.error.issues }, { status: 400 });
  }
  const { invoiceId, payer, payInToken, amountIn, permit2Data, permit2Signature } = parsed.data;

  // Reject obviously-stale signatures.
  const deadlineMs = Number(permit2Data.deadline) * 1000;
  if (deadlineMs < Date.now()) {
    return NextResponse.json({ error: "permit_expired" }, { status: 400 });
  }

  // amountIn must be positive and within a sane bound.
  let amountInBig: bigint;
  try {
    amountInBig = BigInt(amountIn);
  } catch {
    return NextResponse.json({ error: "bad_amount_in" }, { status: 400 });
  }
  if (amountInBig <= 0n || amountInBig > MAX_AMOUNT_IN_BASE_UNITS) {
    return NextResponse.json({ error: "amount_in_out_of_range" }, { status: 400 });
  }

  // Invoice must exist and be in `created` state.
  const invRows = await db.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
  const inv = invRows[0];
  if (!inv) {
    return NextResponse.json({ error: "invoice_not_found" }, { status: 404 });
  }
  if (inv.status !== "created") {
    return NextResponse.json({ error: "invoice_not_payable", status: inv.status }, { status: 409 });
  }
  if (inv.expiresAt.getTime() < Date.now()) {
    return NextResponse.json({ error: "invoice_expired" }, { status: 410 });
  }

  // Bind payInToken to the invoice's expected pay-in token.
  if (inv.payInToken.toLowerCase() !== payInToken.toLowerCase()) {
    return NextResponse.json({ error: "pay_in_token_mismatch" }, { status: 400 });
  }

  // Bind witness to (invoiceId, our relayer). Fail closed if relayer not configured.
  if (!RELAYER_ADDRESS || !RELAYER_ADDRESS.startsWith("0x")) {
    return NextResponse.json({ error: "relayer_unconfigured" }, { status: 503 });
  }
  const expected = expectedWitnessHash(invoiceId as Hex, RELAYER_ADDRESS);
  if (permit2Data.witness.toLowerCase() !== expected.toLowerCase()) {
    return NextResponse.json({ error: "witness_mismatch" }, { status: 400 });
  }

  // Audit residual P1 (2026-05-05): server-side EIP-712 recovery uses our
  // canonical types and ignores the request's witnessTypeString — but the
  // relayer passes the request value verbatim to Permit2 on-chain, where
  // any mutation produces a different typed-data hash and triggers a gas
  // burn. Pin the field exactly to the SDK constant.
  if (permit2Data.witnessTypeString !== PERMIT2_WITNESS_TYPE_STRING) {
    return NextResponse.json({ error: "witness_type_string_mismatch" }, { status: 400 });
  }

  // Authorization gate (audit pass 1 #2): require an unconsumed, unexpired
  // checkout_authorizations row for (invoice, payer). The compliance check
  // happened there; without an active row, the customer either skipped
  // authorize or it returned review/reject — either way, no queueing.
  const auth = (await db
    .select()
    .from(checkoutAuthorizations)
    .where(and(
      eq(checkoutAuthorizations.invoiceId, invoiceId),
      eq(checkoutAuthorizations.payer, payer.toLowerCase()),
      isNull(checkoutAuthorizations.consumedAt),
      gt(checkoutAuthorizations.expiresAt, new Date()),
    ))
    .orderBy(sql`${checkoutAuthorizations.createdAt} desc`)
    .limit(1))[0];
  if (!auth) {
    return NextResponse.json({ error: "authorization_required" }, { status: 401 });
  }

  // Min amountIn (audit pass 1 #4): customer's commit must clear the floor
  // we recorded at authorize time. Same-token = exact invoice.amountOut;
  // cross-token = 97% of the server's quote.
  if (amountInBig < BigInt(auth.minAmountIn)) {
    return NextResponse.json({
      error: "amount_below_floor",
      minAmountIn: auth.minAmountIn,
    }, { status: 400 });
  }

  // Off-chain Permit2 signature recovery (audit pass 1 #1). Reconstruct the
  // typed-data from server-bound parameters and verify the signer is the
  // claimed payer. This is the load-bearing check — without it, a griefer
  // could submit forged signatures and burn relayer gas in
  // permitWitnessTransferFrom.
  let sigOk = false;
  try {
    sigOk = await verifyPermit2Signature({
      chainId:    ARC_TESTNET_CHAIN_ID,
      invoiceId:  invoiceId as Hex,
      payer:      payer as Address,
      payInToken: inv.payInToken as Address,
      amountIn:   amountInBig,
      relayer:    RELAYER_ADDRESS,
      nonce:      BigInt(permit2Data.nonce),
      deadline:   BigInt(permit2Data.deadline),
      signature:  permit2Signature as Hex,
    });
  } catch {
    sigOk = false;
  }
  if (!sigOk) {
    return NextResponse.json({ error: "signature_invalid" }, { status: 401 });
  }

  // Atomic auth-consume + queue insert. Two layers of race protection:
  //   (a) UPDATE ... WHERE consumed_at IS NULL — only one writer wins.
  //   (b) partial UNIQUE INDEX on relayer_queue (invoice_id) WHERE
  //       status IN ('pending','processing','settled') — fallback even if
  //       (a) somehow doesn't catch (e.g. multiple authorizations).
  const consumed = await db
    .update(checkoutAuthorizations)
    .set({ consumedAt: new Date() })
    .where(and(
      eq(checkoutAuthorizations.id, auth.id),
      isNull(checkoutAuthorizations.consumedAt),
    ))
    .returning({ id: checkoutAuthorizations.id });
  if (consumed.length === 0) {
    return NextResponse.json({ error: "authorization_consumed" }, { status: 409 });
  }

  let inserted: { id: string }[];
  try {
    inserted = await db.insert(relayerQueue).values({
      invoiceId,
      payer:            payer.toLowerCase(),
      payInToken:       payInToken.toLowerCase(),
      amountIn,
      payoutToken:      inv.payoutToken,
      amountOutMin:     inv.amountOut,
      permit2Data,
      permit2Signature,
    }).returning({ id: relayerQueue.id });
  } catch (e) {
    // Partial unique index violation — concurrent submitter beat us.
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("uniq_relayer_queue_active_invoice")) {
      return NextResponse.json({ error: "duplicate_submission" }, { status: 409 });
    }
    throw e;
  }

  // Issue a status token bound to this invoice. Audit M12.
  // Without this token, /api/checkout/status/[id] returns only { status } —
  // no lastError, no tx hashes, no internal state.
  const statusToken = randomBytes(24).toString("hex");
  const statusTokenExpiresAt = new Date(Date.now() + STATUS_TOKEN_TTL_MS);
  try {
    await db.update(invoices)
      .set({ statusToken, statusTokenExpiresAt })
      .where(eq(invoices.id, invoiceId));
  } catch {
    // Token persistence failure isn't fatal — status route degrades to
    // public-minimum mode for everyone, which is the safe default.
  }

  return NextResponse.json({
    submissionId: inserted[0]!.id,
    invoiceId,
    statusUrl:    `/api/checkout/status/${inserted[0]!.id}`,
    statusToken,
    statusTokenExpiresAt: statusTokenExpiresAt.toISOString(),
  }, { status: 202 });
}
