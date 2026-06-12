import { and, desc, eq, gt } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { complianceScreenings } from "@/lib/db/schema";
import type { ComplianceProvider } from "./provider";
import {
  decisionFor,
  type Decision,
  type ScreeningContext,
  type ScreeningResult,
} from "./types";

const RETENTION_SANCTIONS_MS = 7 * 365 * 24 * 3600 * 1000;
const RETENTION_DEFAULT_MS   = 13 * 30 * 24 * 3600 * 1000;

export interface ScreenWithAuditArgs {
  db: any;
  provider: ComplianceProvider;
  address: string;
  context: ScreeningContext;
}

export interface ScreenWithAuditResult extends ScreeningResult {
  decision: Decision;
  ticketId: string | null;
  rowId: string;
  cached: boolean;
}

function newTicketId(): string {
  return "rev_" + randomBytes(8).toString("hex");
}

function retentionFor(risk: ScreeningResult["risk"]): number {
  return risk === "sanctions" ? RETENTION_SANCTIONS_MS : RETENTION_DEFAULT_MS;
}

/**
 * Cache-aware screening with audit logging. Returns the active decision +
 * a row id that the caller can use for joins (e.g. webhook payload, dashboard
 * link). If a fresh row exists for this `(address, flow)` within its TTL,
 * the provider is not called.
 */
export async function screenWithAudit(args: ScreenWithAuditArgs): Promise<ScreenWithAuditResult> {
  const { db, provider, address, context } = args;
  const lower = address.toLowerCase();

  // Cache: latest row for (address, flow) whose expires_at is in the future.
  //
  // Audit App-M2 (2026-05-24): for merchant_payout the cache MUST also be
  // scoped by merchantId. Two merchants can legitimately configure the
  // same payout address (shared multisig, exchange deposit, etc.); without
  // the merchantId filter, merchant B's lookup returned merchant A's row
  // — same risk verdict, but the cached rowId pointed at a screening
  // stamped with the wrong merchantId, polluting B's compliance dashboard
  // join.
  //
  // customer_pay flow is intentionally NOT scoped by invoiceId. Same payer
  // paying multiple invoices within the cache TTL is the common case; the
  // sanctions/risk verdict is an address-level fact, so re-screening per
  // invoice would burn provider credits without changing the answer. The
  // audit trail still records a fresh complianceScreenings row each time
  // we DO call the provider (on cache miss), and the webhook emitted on
  // `review` decisions carries the invoice context.
  const cacheWhere = [
    eq(complianceScreenings.address, lower),
    eq(complianceScreenings.flow, context.flow),
    gt(complianceScreenings.expiresAt, new Date()),
  ];
  if (context.flow === "merchant_payout" && context.merchantId) {
    cacheWhere.push(eq(complianceScreenings.merchantId, context.merchantId));
  }

  const cached = await db
    .select()
    .from(complianceScreenings)
    .where(and(...cacheWhere))
    .orderBy(desc(complianceScreenings.createdAt))
    .limit(1);

  if (cached[0]) {
    const row = cached[0];
    return {
      risk: row.risk,
      reasons: row.reasons ?? [],
      providerScore: row.providerScore ? Number(row.providerScore) : undefined,
      providerSnapshot: row.providerSnapshot,
      cachedAt: row.createdAt,
      ttlSeconds: Math.max(0, Math.floor((row.expiresAt.getTime() - Date.now()) / 1000)),
      decision: row.decision,
      ticketId: row.ticketId ?? null,
      rowId: row.id,
      cached: true,
    };
  }

  const screened = await provider.screenAddress(lower, context);
  const decision = decisionFor(screened.risk);
  const ticketId = decision === "review" ? newTicketId() : null;
  const expiresAt = new Date(Date.now() + retentionFor(screened.risk));

  const inserted = await db
    .insert(complianceScreenings)
    .values({
      address: lower,
      flow: context.flow,
      invoiceId: context.invoiceId ?? null,
      merchantId: context.merchantId ?? null,
      provider: provider.name,
      risk: screened.risk,
      reasons: screened.reasons,
      providerScore: screened.providerScore?.toString() ?? null,
      providerSnapshot: screened.providerSnapshot,
      decision,
      ticketId,
      expiresAt,
    })
    .returning({ id: complianceScreenings.id });

  return {
    ...screened,
    decision,
    ticketId,
    rowId: inserted[0]!.id,
    cached: false,
  };
}
