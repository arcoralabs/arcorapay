import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import type { Address } from "viem";
import { chainById, parseChainRegistryJson } from "@arcora/crosschain-core";
import { db } from "@/lib/db/client";
import { invoices, crosschainPayments } from "@/lib/db/schema";
import { resolveComplianceProvider } from "@/lib/compliance/factory";
import { screenWithAudit } from "@/lib/compliance/screen";
import { buildCrosschainIntent } from "@/lib/crosschain/intent";
import { recordCheckoutEvent } from "@/lib/crosschain/telemetry";
import { estimateSwapForTarget } from "@/lib/checkout/quote-server";
import { takeToken } from "@/lib/rate/limiter";
import { clientIp } from "@/lib/rate/clientIp";
import { envFlag } from "@/lib/env";

// Per-IP rate limit, mirroring /api/checkout/authorize. Each prepare call
// hits the DB, the compliance provider on a cache miss, and (for EURC
// payouts) the App Kit estimator. 30/60s is generous for a real checkout
// while capping abuse. Fail-open on limiter outage.
const PREPARE_LIMIT = 30;
const PREPARE_WINDOW_SECONDS = 60;

const HEX32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const ADDR = z.string().regex(/^0x[0-9a-fA-F]{40}$/);

const Body = z.object({
  invoiceId: HEX32,
  payer: ADDR,
  sourceChainId: z.number().int().positive(),
});


export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  let allowed = true;
  try {
    allowed = await takeToken(`cc-prepare:${ip}`, PREPARE_LIMIT, PREPARE_WINDOW_SECONDS);
  } catch {
    allowed = true; // fail-open: limiter outage must not block checkout
  }
  if (!allowed) {
    return NextResponse.json(
      { error: "rate_limited", retryAfterSeconds: PREPARE_WINDOW_SECONDS },
      { status: 429, headers: { "retry-after": String(PREPARE_WINDOW_SECONDS) } },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "bad_params", details: parsed.error.issues }, { status: 400 });
  }

  const { invoiceId, payer, sourceChainId } = parsed.data;
  const inv = (await db.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1))[0];
  if (!inv) return NextResponse.json({ error: "invoice_not_found" }, { status: 404 });
  if (inv.status !== "created") return NextResponse.json({ error: "invoice_not_payable", status: inv.status }, { status: 409 });
  if (inv.expiresAt.getTime() < Date.now()) return NextResponse.json({ error: "invoice_expired" }, { status: 410 });

  const provider = resolveComplianceProvider();
  // Audit 2026-06-11 MED-2: mirror /api/checkout/authorize's outage semantics.
  // Default is fail-closed (503 PROVIDER_UNAVAILABLE, same shape as
  // authorize); operators may opt into fail-open for the pay flow via
  // COMPLIANCE_FAIL_OPEN_FOR_PAY — the same flag authorize honors — so a
  // compliance-provider outage treats crosschain and same-chain payments
  // identically instead of 500ing crosschain.
  let screen: Pick<Awaited<ReturnType<typeof screenWithAudit>>, "decision" | "ticketId">;
  try {
    screen = await screenWithAudit({
      db,
      provider,
      address: payer,
      context: { flow: "customer_pay", invoiceId },
    });
  } catch {
    if (!envFlag("COMPLIANCE_FAIL_OPEN_FOR_PAY")) {
      return NextResponse.json({
        decision: "reject",
        code: "PROVIDER_UNAVAILABLE",
        reason: "Compliance provider is currently unavailable. Please try again shortly.",
      }, { status: 503 });
    }
    // Fail-open: proceed as a degraded allow, mirroring authorize's path.
    screen = { decision: "allow", ticketId: null };
  }
  if (screen.decision !== "allow") {
    recordCheckoutEvent({
      invoiceId,
      eventType: "crosschain_prepare_blocked",
      sourceChainId,
      errorCode: screen.decision,
    }).catch((err) => console.error("crosschain_prepare telemetry write failed", err));
    return NextResponse.json({
      decision: screen.decision,
      ticketId: screen.ticketId,
    }, { status: screen.decision === "review" ? 202 : 403 });
  }

  // Server-side security binding — prefer the server-only env var. The
  // NEXT_PUBLIC_ fallback keeps current deploys working and dies at mainnet.
  const relayer = (process.env.RELAYER_ADDRESS ?? process.env.NEXT_PUBLIC_RELAYER_ADDRESS) as Address | undefined;
  if (!relayer) return NextResponse.json({ error: "relayer_unconfigured" }, { status: 503 });

  let intent;
  try {
    const registryJson = process.env.CROSSCHAIN_CHAIN_CONFIG_JSON;
    if (!registryJson) throw new Error("CROSSCHAIN_CHAIN_CONFIG_JSON missing");
    const arc = chainById(parseChainRegistryJson(registryJson), 5_042_002);
    if (inv.payInToken.toLowerCase() !== arc.tokens.USDC.address.toLowerCase()) {
      return NextResponse.json({ error: "crosschain_requires_arc_usdc_payin" }, { status: 409 });
    }

    let sourceAmountBaseUnits = BigInt(inv.amountOut);
    if (inv.payoutToken.toLowerCase() !== arc.tokens.USDC.address.toLowerCase()) {
      if (!arc.tokens.EURC || inv.payoutToken.toLowerCase() !== arc.tokens.EURC.address.toLowerCase()) {
        return NextResponse.json({ error: "unsupported_payout_token" }, { status: 400 });
      }
      const quote = await estimateSwapForTarget({
        payInToken: "USDC",
        payoutToken: "EURC",
        targetOutputBaseUnits: BigInt(inv.amountOut),
      });
      sourceAmountBaseUnits = quote.recommendedPayInBaseUnits;
    }

    intent = buildCrosschainIntent({
      invoiceId,
      payer: payer as Address,
      sourceChainId,
      payoutToken: inv.payoutToken as Address,
      sourceAmountBaseUnits,
      relayerAddress: relayer,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/source chain disabled/.test(msg)) {
      return NextResponse.json({ error: "source_chain_disabled", detail: msg }, { status: 400 });
    }
    // Config-class failures (missing env, unconfigured services, App Kit key)
    // are server-side problems, not bad client input: surface them as 503 so
    // monitoring and clients treat them as outages rather than rejections.
    const status = /missing|unconfigured|KIT_KEY/.test(msg) ? 503 : 400;
    return NextResponse.json({ error: "route_unavailable", detail: msg }, { status });
  }

  // Re-prepare policy: an `authorized` intent is just a stored quote/route —
  // no on-chain value has moved yet — so it is freely replaceable. The payer
  // field is unauthenticated (anonymous checkout), so anyone can pre-create an
  // intent; refusing to re-prepare would let an attacker lock an invoice.
  // Re-prepare (chain switch, payer switch, idempotent retry) overwrites the
  // existing row in place. Once a burn has been submitted (status past
  // "authorized") the row is immutable from this endpoint.
  const computedFields = {
    idempotencyKey: intent.idempotencyKey,
    payer: payer.toLowerCase(),
    sourceChainId,
    sourceDomain: intent.route.source.cctpDomain,
    sourceToken: intent.route.sourceToken.address.toLowerCase(),
    sourceAmount: intent.sourceAmountBaseUnits.toString(),
    destinationChainId: intent.destinationChainId,
    destinationDomain: intent.destinationDomain,
    destinationToken: intent.destinationToken.toLowerCase(),
    mintRecipient: intent.mintRecipient.toLowerCase(),
    payoutToken: inv.payoutToken.toLowerCase(),
    amountOutMin: inv.amountOut,
    routeVersion: intent.routeVersion,
    status: "authorized" as const,
  };

  let intentId: string;
  let httpStatus = 201;
  try {
    const existing = (await db.select().from(crosschainPayments)
      .where(eq(crosschainPayments.invoiceId, invoiceId)).limit(1))[0];

    if (existing) {
      if (existing.status !== "authorized") {
        return NextResponse.json({ error: "invoice_already_in_progress" }, { status: 409 });
      }
      const updated = await db.update(crosschainPayments)
        .set({ ...computedFields, updatedAt: new Date() })
        // status guard: don't clobber a row the bridge worker advanced
        // between our select and this update.
        .where(and(eq(crosschainPayments.id, existing.id), eq(crosschainPayments.status, "authorized")))
        .returning({ id: crosschainPayments.id });
      if (!updated[0]) {
        return NextResponse.json({ error: "invoice_already_in_progress" }, { status: 409 });
      }
      intentId = updated[0].id;
      httpStatus = 200;
    } else {
      const inserted = await db.insert(crosschainPayments).values({
        invoiceId,
        ...computedFields,
      }).onConflictDoUpdate({
        // Race backstop: if a concurrent prepare with the same idempotency key
        // landed first, refresh the row so the response matches the store.
        target: crosschainPayments.idempotencyKey,
        set: { ...computedFields, updatedAt: new Date() },
      }).returning({ id: crosschainPayments.id });
      intentId = inserted[0]!.id;
    }
  } catch (e) {
    // A raced concurrent prepare with a different idempotency key can still
    // trip the invoice_id unique constraint. Drizzle may wrap the pg error,
    // so check both the error itself and its cause.
    const code = (e as any)?.code ?? (e as any)?.cause?.code;
    if (code === "23505") {
      return NextResponse.json({ error: "invoice_already_prepared" }, { status: 409 });
    }
    throw e;
  }

  recordCheckoutEvent({
    invoiceId,
    crosschainPaymentId: intentId,
    eventType: "crosschain_prepare_created",
    sourceChainId,
    metadata: { routeVersion: intent.routeVersion },
  }).catch((err) => console.error("crosschain_prepare telemetry write failed", err));

  return NextResponse.json({
    intentId,
    invoiceId,
    sourceChain: {
      chainId: intent.route.source.chainId,
      label: intent.route.source.label,
      cctpDomain: intent.route.source.cctpDomain,
    },
    destinationChain: {
      chainId: intent.route.destination.chainId,
      label: intent.route.destination.label,
      cctpDomain: intent.route.destination.cctpDomain,
    },
    depositForBurn: {
      amount: intent.sourceAmountBaseUnits.toString(),
      burnToken: intent.route.sourceToken.address,
      tokenMessenger: intent.route.source.tokenMessenger,
      destinationDomain: intent.destinationDomain,
      mintRecipient: intent.mintRecipient,
      maxFee: "0",
      finalityThreshold: 2000,
    },
    expiresAt: inv.expiresAt.toISOString(),
  }, { status: httpStatus });
}
