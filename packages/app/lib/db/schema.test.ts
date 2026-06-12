import { describe, it, expect } from "vitest";
import {
  merchants, invoices, webhookAttempts,
  crosschainPayments,
  checkoutTelemetry,
  crosschainPaymentStatus,
  settlementTier,
} from "./schema";

describe("schema", () => {
  it("merchants table has expected columns", () => {
    expect(merchants.address).toBeDefined();
    expect(merchants.apiKeyHash).toBeDefined();
    expect(merchants.webhookSecretEnc).toBeDefined();
  });
  it("invoices table is defined with status enum column", () => {
    expect(invoices.status).toBeDefined();
  });
  it("merchants table exposes apiKeyPrefix and allowedOrigins", () => {
    expect(merchants.apiKeyPrefix.name).toBe("api_key_prefix");
    expect(merchants.allowedOrigins.name).toBe("allowed_origins");
  });
  // Audit H5 (2026-05-05): the indexer dedupes webhook_attempts via
  // (invoice_id, event_type) — `eventType` must exist as a NOT NULL column
  // for the `ON CONFLICT (invoice_id, event_type) DO NOTHING` insert path.
  it("webhookAttempts exposes eventType column required for dedupe", () => {
    expect(webhookAttempts.eventType).toBeDefined();
    expect(webhookAttempts.eventType.name).toBe("event_type");
    expect(webhookAttempts.eventType.notNull).toBe(true);
  });
});

describe("cross-chain v2 schema", () => {
  it("exports cross-chain payment tables and enums", () => {
    expect(crosschainPaymentStatus.enumValues).toContain("bridge_pending");
    expect(crosschainPaymentStatus.enumValues).toContain("paid");
    expect(settlementTier.enumValues).toEqual(["zero_day", "one_day", "seven_day"]);
    expect(crosschainPayments.invoiceId.name).toBe("invoice_id");
    expect(checkoutTelemetry.eventType.name).toBe("event_type");
  });
  it("crosschainPayments and invoices have required NOT NULL columns", () => {
    expect(crosschainPayments.invoiceId.notNull).toBe(true);
    expect(crosschainPayments.idempotencyKey.notNull).toBe(true);
    expect(invoices.settlementTier.notNull).toBe(true);
  });
});
