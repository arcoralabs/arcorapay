/**
 * Compliance screening types. Provider-agnostic — Elliptic / TRM Labs /
 * Noop all map onto these shapes.
 */

export type Risk =
  | "low"        // no flags; proceed
  | "medium"     // flagged exposure; queue for human review
  | "high"       // strong adverse signal; reject
  | "sanctions"; // OFAC / EU sanctions match; hard reject

export type ScreeningFlow = "merchant_payout" | "customer_pay";

export type Decision = "allow" | "review" | "reject";

export interface ScreeningContext {
  flow: ScreeningFlow;
  invoiceId?: string;
  merchantId?: string;
}

export interface ScreeningResult {
  risk: Risk;
  reasons: string[];
  providerScore?: number;
  providerSnapshot: unknown;
  cachedAt: Date;
  ttlSeconds: number;
}

export type ProviderName = "elliptic" | "trmlabs" | "noop";

/**
 * Map a `Risk` to a customer-facing `Decision`. Sanctions and high are hard
 * rejects; medium queues for review; low passes. Centralised so phase flips
 * (e.g. Phase 2 "medium becomes allow with quiet log") are a one-line edit.
 */
export function decisionFor(risk: Risk): Decision {
  if (risk === "sanctions" || risk === "high") return "reject";
  if (risk === "medium") return "review";
  return "allow";
}
