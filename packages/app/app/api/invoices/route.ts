import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { classifyKey, lookupMerchantByApiKey, lookupMerchantByPublishableKey } from "@/lib/auth/apikey";
import { GATEWAY_ABI } from "@/lib/chain/gateway-abi";
import { GATEWAY, getServerWalletClient, publicClient } from "@/lib/chain/client";
import { db } from "@/lib/db/client";
import { invoices } from "@/lib/db/schema";
import { resolveComplianceProvider, complianceRequired } from "@/lib/compliance/factory";
import { screenWithAudit } from "@/lib/compliance/screen";
import { assertOriginAllowed, assertSafePublicUrl } from "@/lib/security/safeUrl";
import { takeToken } from "@/lib/rate/limiter";
import { parseBaseUnits } from "@arcora/crosschain-core";
import { encodeAbiParameters, keccak256, type Address, type Hex } from "viem";

/**
 * Per-merchant rate limit on invoice creation. Each authenticated merchant
 * may create at most INVOICE_LIMIT invoices per window. Audit App-M1
 * (2026-05-24): unlike /api/checkout/quote (which is read-only RPC), every
 * call here costs an on-chain createInvoiceFor tx — a stolen API key
 * looping this endpoint can drain the server wallet's gas balance and
 * exhaust RPC quota for every other merchant. Keyed on merchant.id (NOT
 * IP), because the caller is authenticated and the right constraint is
 * per-merchant; an IP key would penalise multi-merchant hosts.
 *
 * Fail-open on limiter outage so a Postgres hiccup doesn't take invoice
 * creation down for everyone — matches the policy used by other write
 * routes (checkout/authorize, checkout/submit).
 */
const INVOICE_LIMIT = 60;
const INVOICE_WINDOW_SECONDS = 60;

// The active custody-escrow gateway address comes from lib/chain/client.ts
// via the GATEWAY_ADDRESS env. Every invoice also records its own
// `gatewayAddress`, so the gateway in force at create time stays pinned to
// the row even across a future cutover.

// successUrl is optional for standalone invoices (link sent directly to a
// customer with no merchant site). When omitted, the invoice page itself
// shows the paid status — no external redirect happens.
// amountUsdc ceiling: $1,000,000 per invoice. Above ~9e15 a JS double loses
// integer precision, so the float→base-unit conversion would silently corrupt
// the on-chain BigInt; an Infinity input would break the conversion outright.
// $1M is well clear of both and a sane single-invoice cap. (Audit M1)
// metadata is stored verbatim as JSONB and echoed back on GET — cap key
// count and value length so a merchant can't bloat every row. (Audit M2)
const Body = z.object({
  // Audit App-L-7 (2026-05-31): `.positive()` alone allowed sub-micro-dollar
  // amounts (e.g. 0.0000004) that amountUsdc.toFixed(6) rounds to 0 — a
  // zero-value on-chain invoice that burns gas and pollutes the treasury
  // aggregate. Floor at 1 micro-USDC (the smallest representable base unit)
  // so the converted amount is always >= 1.
  amountUsdc: z.number().min(0.000001).max(1_000_000),
  payInToken: z.enum(["USDC", "EURC"]),
  successUrl: z.string().url().optional(),
  cancelUrl: z.string().url().optional(),
  metadata: z.record(z.string().max(256)).optional()
    .refine((m) => !m || Object.keys(m).length <= 50, {
      message: "metadata may not exceed 50 keys",
    }),
});

const TOKEN_ADDR: Record<"USDC" | "EURC", Address> = {
  USDC: (process.env.USDC_ADDRESS ?? "") as Address,
  EURC: (process.env.EURC_ADDRESS ?? "") as Address,
};

const INVOICE_TTL_SEC = 30 * 60;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, x-arcora-api-key",
  "Access-Control-Max-Age": "86400",
};

function corsResponse(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  return NextResponse.json(body, { ...init, headers });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get("X-Arcora-Api-Key") ?? "";
  if (!apiKey) return corsResponse({ error: "missing_api_key" }, { status: 401 });

  // AFG-019 (2026-06-06): two credential classes reach this route.
  //   - secret `ak_live_`     → full capability (server-side only).
  //   - publishable `pk_live_`→ browser-safe; may ONLY create a checkout, and
  //                             only from an origin the merchant declared.
  // An unknown prefix authorizes nothing. The privileged data routes
  // (/api/merchant/escrows, GET /api/invoices/[id] private fields) call
  // lookupMerchantByApiKey, which rejects pk_ keys outright — so a browser key
  // can never list escrows or read private invoice data.
  const keyKind = classifyKey(apiKey);
  const merchant =
    keyKind === "publishable" ? await lookupMerchantByPublishableKey(apiKey)
    : keyKind === "secret"    ? await lookupMerchantByApiKey(apiKey)
    : null;
  if (!merchant) return corsResponse({ error: "invalid_api_key" }, { status: 401 });

  // Publishable keys are bound to the merchant's allowlisted origins. This is
  // defense-in-depth (a scraped pk_ can be replayed with a spoofed Origin from
  // a non-browser client), but combined with the per-merchant rate limit below
  // and the zero data-read capability it keeps the browser credential narrow.
  if (keyKind === "publishable") {
    const originHeader = req.headers.get("origin") ?? "";
    const allowed = (merchant as { allowedOrigins?: string[] }).allowedOrigins ?? [];
    let originOk = false;
    try { originOk = !!originHeader && allowed.includes(new URL(originHeader).origin); }
    catch { originOk = false; }
    if (!originOk) {
      return corsResponse({ error: "publishable_origin_not_allowed" }, { status: 403 });
    }
  }

  // Audit App-M1 (2026-05-24): rate-limit by merchant.id AFTER auth so an
  // unauthenticated caller's noise can't poison a merchant's bucket. Fail
  // open on limiter outage (matches checkout/authorize, checkout/submit).
  let allowed = true;
  try {
    allowed = await takeToken(`invoices:${merchant.id}`, INVOICE_LIMIT, INVOICE_WINDOW_SECONDS);
  } catch {
    allowed = true;
  }
  if (!allowed) {
    return corsResponse(
      { error: "rate_limited", retryAfterSeconds: INVOICE_WINDOW_SECONDS },
      { status: 429, headers: { "retry-after": String(INVOICE_WINDOW_SECONDS) } },
    );
  }

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return corsResponse({ error: "bad_body", detail: parsed.error.format() }, { status: 400 });
  const { amountUsdc, payInToken, successUrl, cancelUrl, metadata } = parsed.data;

  // Audit H1 (2026-05-05): merchant-supplied successUrl/cancelUrl was
  // previously accepted as any well-formed URL. After payment we redirect
  // the customer with `window.location.href = successUrl`, so an attacker
  // with a stolen API key (or any merchant who turns hostile) could turn
  // arcorapay.xyz into an open-redirect / phishing launchpad. Two layers:
  //   1. allowlist — origin must match a value the merchant declared at
  //      bootstrap (or via PATCH /api/merchant/origins).
  //   2. SSRF guard — even merchant-declared values can resolve to private
  //      IPs (cloud metadata, internal admin, RFC1918), which would let a
  //      hostile merchant exfiltrate via the customer's redirect chain or
  //      worse if we ever fetched the URL server-side.
  // Allowlist + SSRF checks only run when a redirect URL is supplied. A
  // standalone invoice (no successUrl) skips both — no redirect happens, the
  // invoice page just shows the paid status. If the merchant DID supply a
  // URL, we still require an allowlist to be configured.
  const merchantAllowedOrigins = (merchant as { allowedOrigins?: string[] }).allowedOrigins ?? [];
  const hasRedirect = !!(successUrl || cancelUrl);
  if (hasRedirect && merchantAllowedOrigins.length === 0) {
    return corsResponse({
      error: "merchant_origins_not_configured",
      detail: "Set allowed redirect origins in /m/settings before using successUrl / cancelUrl.",
    }, { status: 400 });
  }
  try {
    if (successUrl) assertOriginAllowed(successUrl, merchantAllowedOrigins);
    if (cancelUrl)  assertOriginAllowed(cancelUrl,  merchantAllowedOrigins);
  } catch (e) {
    return corsResponse({
      error: "origin_not_allowed",
      detail: e instanceof Error ? e.message : String(e),
    }, { status: 400 });
  }
  try {
    if (successUrl) await assertSafePublicUrl(successUrl);
    if (cancelUrl)  await assertSafePublicUrl(cancelUrl);
  } catch (e) {
    return corsResponse({
      error: "unsafe_redirect_url",
      detail: e instanceof Error ? e.message : String(e),
    }, { status: 400 });
  }

  // All invoices route to GATEWAY — the active custody-escrow gateway
  // (lib/chain/client.ts reads GATEWAY_ADDRESS from env).
  const targetGateway: Address = GATEWAY;

  // Audit pass 4 (2026-05-04, finding #8): we used to screen
  // `merchant.address` (the identity wallet) but V9 settles to
  // `merchants[m].payoutAddress` which can be a separate wallet (or rotated
  // post-onboarding). Read the on-chain payoutAddress and screen THAT — a
  // merchant who rotates to an unscreened wallet must hit the gate before
  // we mint a fresh invoice routed to it.
  //
  // Audit residual P2 (2026-05-05): RPC failure used to silently fall back
  // to the DB identity wallet. createInvoiceFor would then proceed against
  // the same RPC moments later and likely succeed, settling to a wallet
  // that was never screened. Now we fail closed by default; the existing
  // COMPLIANCE_FAIL_OPEN_FOR_INVOICE flag (currently default-true for
  // compliance provider outages) explicitly governs whether to fall through
  // here too. Different surface, same operator-level decision.
  let payoutAddress: Address = merchant.address as Address;
  try {
    const onchain = await publicClient.readContract({
      address: targetGateway,
      abi: GATEWAY_ABI,
      functionName: "merchants",
      args: [merchant.address as Address],
    }) as readonly [Address, Address, boolean];
    const [onchainPayoutAddr] = onchain;
    if (onchainPayoutAddr && onchainPayoutAddr !== "0x0000000000000000000000000000000000000000") {
      payoutAddress = onchainPayoutAddr;
    }
    // If the on-chain merchant struct is zero, the merchant isn't registered
    // on this gateway yet — fall through; createInvoiceFor below will revert
    // with the right error and we won't have wasted a provider call here.
  } catch (e: any) {
    // AFG-005: when compliance is required (mainnet), never fail open — the
    // COMPLIANCE_FAIL_OPEN_FOR_INVOICE escape hatch only applies on testnet.
    const failOpen = !complianceRequired() && (process.env.COMPLIANCE_FAIL_OPEN_FOR_INVOICE ?? "true") !== "false";
    if (!failOpen) {
      return corsResponse({
        error: "payout_read_failed",
        detail: e?.shortMessage ?? String(e),
      }, { status: 503 });
    }
    // failOpen: identity wallet is the conservative target. The flag
    // already governs compliance-provider outages; same operator decision
    // applies here.
  }

  // Compliance gate on the merchant payout address. Cached per-address for
  // the provider's TTL so this is a DB hit on the hot path, not a provider
  // call. In Phase 0 (testnet / Noop) this is unconditionally `allow`.
  let payoutScreen: Awaited<ReturnType<typeof screenWithAudit>> | null = null;
  try {
    const provider = resolveComplianceProvider();
    payoutScreen = await screenWithAudit({
      db, provider,
      address: payoutAddress,
      context: { flow: "merchant_payout", merchantId: merchant.id },
    });
  } catch (e: any) {
    // Default fail-open for invoice creation: a provider outage shouldn't
    // block legitimate merchants. Override via COMPLIANCE_FAIL_OPEN_FOR_INVOICE=false.
    // AFG-005: when compliance is required (mainnet), never fail open — the
    // COMPLIANCE_FAIL_OPEN_FOR_INVOICE escape hatch only applies on testnet.
    const failOpen = !complianceRequired() && (process.env.COMPLIANCE_FAIL_OPEN_FOR_INVOICE ?? "true") !== "false";
    if (!failOpen) {
      return corsResponse({ error: "compliance_unavailable" }, { status: 503 });
    }
  }
  if (payoutScreen?.decision === "reject") {
    return corsResponse({
      error: "merchant_payout_blocked",
      code: "MERCHANT_PAYOUT_BLOCKED",
    }, { status: 403 });
  }
  if (payoutScreen?.decision === "review") {
    return corsResponse({
      status: "queued",
      ticketId: payoutScreen.ticketId,
      reason: "Merchant payout address is under compliance review. Invoice creation will resume once review completes.",
    }, { status: 202 });
  }

  const merchantInvoiceId = ("0x" + randomBytes(32).toString("hex")) as Hex;
  const globalId = keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "bytes32" }],
      [merchant.address as Address, merchantInvoiceId],
    ),
  );
  // Audit H-1: string-based conversion — BigInt(Math.round(amountUsdc * 1e6))
  // is exposed to IEEE-754 artifacts; toFixed(6) is exact to the charged unit
  // because amountUsdc is Zod-validated positive finite <= 1,000,000.
  const amountOut = parseBaseUnits(amountUsdc.toFixed(6), 6);
  const expiresAt = BigInt(Math.floor(Date.now() / 1000) + INVOICE_TTL_SEC);

  let txHash: Hex;
  try {
    const wallet = await getServerWalletClient();
    txHash = await wallet.writeContract({
      address: targetGateway,
      abi: GATEWAY_ABI,
      functionName: "createInvoiceFor",
      args: [merchant.address as Address, merchantInvoiceId, TOKEN_ADDR[payInToken], amountOut, expiresAt],
    });
    await publicClient.waitForTransactionReceipt({ hash: txHash });
  } catch (e: any) {
    if (/DelegateNotAuthorized/.test(e?.shortMessage ?? "")) {
      return corsResponse({ error: "delegate_not_authorized" }, { status: 412 });
    }
    return corsResponse({ error: "chain_error", detail: e?.shortMessage ?? String(e) }, { status: 502 });
  }

  await db.insert(invoices).values({
    id: globalId,
    merchantInvoiceId,
    merchantId: merchant.id,
    payInToken: TOKEN_ADDR[payInToken],
    payoutToken: merchant.payoutToken,
    amountOut: amountOut.toString(),
    expiresAt: new Date(Number(expiresAt) * 1000),
    status: "created",
    gatewayAddress: targetGateway.toLowerCase(),
    metadata: metadata ?? {},
    successUrl: successUrl ?? "",
    cancelUrl: cancelUrl ?? null,
  });

  // Falls back to arcorapay.xyz (the canonical live host) when PUBLIC_BASE_URL
  // is unset. The previous `checkout.arcorapay.com` default pointed at an
  // unregistered DNS record, so any deploy that forgot to set this env var
  // returned working API responses with dead checkout URLs.
  const baseUrl = process.env.PUBLIC_BASE_URL ?? "https://arcorapay.xyz";
  return corsResponse({ invoiceId: globalId, url: `${baseUrl}/i/${globalId}` }, { status: 201 });
}
