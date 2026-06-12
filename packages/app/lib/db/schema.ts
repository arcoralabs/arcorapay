import {
  pgTable, text, uuid, timestamp, integer, numeric, jsonb, customType, boolean, pgEnum, index, uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm/sql";

const bytea = customType<{ data: Buffer; default: false }>({
  dataType() { return "bytea"; },
});

// `failed` is new with the v0.8 (relayer-driven) gateway: marks an invoice the
// relayer could not settle (kit.swap fail, slippage breach) after the pay-in
// was returned to the customer off-chain. Indexer + webhook flow surface it
// as a terminal "this won't pay" state so the row doesn't sit in `created`.
// `claimed` and `recovered` are custody-escrow states: escrow settled by
// claim (claimed) or swept by admin after merchant deactivation + 14-day
// window (recovered).
export const invoiceStatus = pgEnum("invoice_status", ["created", "paid", "expired", "refunded", "failed", "claimed", "recovered"]);

export const relayerQueueStatus = pgEnum("relayer_queue_status",
  ["pending", "processing", "settled", "refunded", "failed"],
);

export const crosschainPaymentStatus = pgEnum("crosschain_payment_status", [
  "created",
  "authorized",
  "bridge_pending",
  "bridge_confirmed",
  "arc_swap_pending",
  "settle_pending",
  "paid",
  "bridge_failed",
  "arc_swap_failed",
  "settle_failed",
  "refunded",
  "expired",
]);

export const settlementTier = pgEnum("settlement_tier", ["zero_day", "one_day", "seven_day"]);

export const merchants = pgTable("merchants", {
  id: uuid("id").defaultRandom().primaryKey(),
  address: text("address").notNull().unique(),
  payoutToken: text("payout_token").notNull(),
  webhookUrl: text("webhook_url"),
  apiKeyHash: text("api_key_hash").notNull(),
  // First 12 chars of the raw API key (e.g. "ak_live_AB12"). Used as a
  // fast-path lookup index so we don't bcrypt-compare every merchant row
  // on each authenticated request. Audit H2 (2026-05-05).
  apiKeyPrefix: text("api_key_prefix").notNull().default(""),
  // AFG-019 (2026-06-06): browser-safe publishable key (pk_live_…). Stored in
  // plaintext — it is meant to be embedded in client code and carries only the
  // narrow "create checkout from an allowlisted origin" capability. The secret
  // api_key above stays server-side. publishable_key_prefix indexes the lookup.
  publishableKey: text("publishable_key").notNull().default(""),
  publishableKeyPrefix: text("publishable_key_prefix").notNull().default(""),
  allowedOrigins: text("allowed_origins").array().notNull().default(sql`'{}'::text[]`),
  webhookSecretEnc: bytea("webhook_secret_enc").notNull(),
  webhookSecretIv: bytea("webhook_secret_iv").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // Set when admin calls deactivateMerchant; cleared on MerchantReactivated.
  // Surfaces "deactivated since X" copy in the dashboard.
  deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
});

export const invoices = pgTable("invoices", {
  id: text("id").primaryKey(), // chain globalId = keccak256(merchant, merchantInvoiceId)
  merchantInvoiceId: text("merchant_invoice_id").notNull(),
  merchantId: uuid("merchant_id").notNull().references(() => merchants.id),
  payInToken: text("pay_in_token").notNull(),
  payoutToken: text("payout_token").notNull(), // locked at creation
  amountOut: numeric("amount_out").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  status: invoiceStatus("status").notNull(),
  paidBy: text("paid_by"),
  paidTx: text("paid_tx"),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  amountIn: numeric("amount_in"),
  merchantPayout: numeric("merchant_payout"),
  protocolFee: numeric("protocol_fee"),
  refundTx: text("refund_tx"),
  refundedAt: timestamp("refunded_at", { withTimezone: true }),
  // Which on-chain gateway this invoice lives on. Set at create time so the
  // relayer knows which contract to call settleInvoice against, and the
  // indexer knows which gateway's events to associate. Lower-cased 0x-address.
  gatewayAddress: text("gateway_address"),
  metadata: jsonb("metadata"),
  successUrl: text("success_url").notNull(),
  cancelUrl: text("cancel_url"),
  // Short-lived bearer token issued at /api/checkout/submit; required for the
  // status route to reveal anything beyond { status }. 30-min TTL. Audit M12.
  statusToken: text("status_token"),
  statusTokenExpiresAt: timestamp("status_token_expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // Custody-escrow state — set by EscrowCreated / InvoiceClaimed / EscrowRecovered events.
  claimableAt: timestamp("claimable_at", { withTimezone: true }),
  claimedAt:   timestamp("claimed_at",   { withTimezone: true }),
  claimTx:     text("claim_tx"),
  recoveredAt: timestamp("recovered_at", { withTimezone: true }),
  recoveryTx:  text("recovery_tx"),
  settlementTier: settlementTier("settlement_tier").notNull().default("seven_day"),
  settlementPolicySnapshot: jsonb("settlement_policy_snapshot").notNull().default({}),
});

export const webhookAttempts = pgTable("webhook_attempts", {
  id: uuid("id").defaultRandom().primaryKey(),
  invoiceId: text("invoice_id").notNull().references(() => invoices.id),
  url: text("url").notNull(),
  payload: jsonb("payload").notNull(),
  attempts: integer("attempts").notNull().default(0),
  nextAttempt: timestamp("next_attempt", { withTimezone: true }).notNull(),
  succeededAt: timestamp("succeeded_at", { withTimezone: true }),
  lastError: text("last_error"),
  // Dedupe key: paired with `invoiceId` in a unique index so out-of-order or
  // replayed events ("invoice.paid", "invoice.refunded", "invoice.failed")
  // can't double-enqueue webhooks for the same invoice. Audit H5 (2026-05-05).
  eventType: text("event_type").notNull(),
  // Audit M5 (2026-05-06): once a 4xx response causes permanent termination
  // of this attempt row, `terminalReason` is set to a short code (e.g.
  // "http_404") and `nextAttempt` is set to NULL so fetchDue never picks it
  // up again. NULL means "still retryable".
  terminalReason: text("terminal_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const indexerState = pgTable("indexer_state", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const serverWallets = pgTable("server_wallets", {
  id: uuid("id").defaultRandom().primaryKey(),
  address: text("address").notNull().unique(),
  encryptedPk: bytea("encrypted_pk").notNull(),
  pkIv: bytea("pk_iv").notNull(),
  balanceAlertBelow: numeric("balance_alert_below"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const siweNonces = pgTable("siwe_nonces", {
  nonce: text("nonce").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  used: boolean("used").notNull().default(false),
}, (t) => [
  // Cron cleanup deletes WHERE expires_at < now(); without this index the
  // job runs a full scan every minute (audit DB hygiene gap, 2026-05-12).
  index("idx_siwe_nonces_expires_at").on(t.expiresAt),
]);

// Generic fixed-window rate-limit counters, keyed by `<limiter>:<ip>` per
// window. Shared by EVERY per-IP limiter — siwe-nonce, quote, quote-v06,
// authorize, submit, invoices — not just SIWE (audit App-L-8, 2026-05-31; the
// old "SIWE-only" note was wrong). Cleanup runs daily via
// /api/internal/cron/siwe-nonce-cleanup, which deletes counters older than 1h
// regardless of bucket; the window_start index keeps that DELETE off a full
// table scan. If that cron is ever retired this table grows unbounded — retire
// it only alongside a replacement cleaner.
export const rateLimitCounters = pgTable("rate_limit_counters", {
  bucket: text("bucket").notNull(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  count: integer("count").notNull().default(0),
}, (t) => [
  index("idx_rate_limit_counters_window_start").on(t.windowStart),
]);

// Compliance screening audit log. One row per provider call (or cache hit
// recorded for replay). `expires_at` drives retention pruning — sanctions
// hits live 7 years, everything else 13 months. See plan-5 spec.
export const complianceFlow = pgEnum("compliance_flow", ["merchant_payout", "customer_pay"]);
export const complianceRisk = pgEnum("compliance_risk", ["low", "medium", "high", "sanctions"]);
export const complianceDecision = pgEnum("compliance_decision", ["allow", "review", "reject"]);

export const complianceScreenings = pgTable("compliance_screenings", {
  id: uuid("id").defaultRandom().primaryKey(),
  address: text("address").notNull(),
  flow: complianceFlow("flow").notNull(),
  invoiceId: text("invoice_id").references(() => invoices.id),
  merchantId: uuid("merchant_id").references(() => merchants.id),
  provider: text("provider").notNull(), // 'elliptic' | 'trmlabs' | 'noop'
  risk: complianceRisk("risk").notNull(),
  reasons: jsonb("reasons").notNull(),
  providerScore: numeric("provider_score"),
  providerSnapshot: jsonb("provider_snapshot").notNull(),
  decision: complianceDecision("decision").notNull(),
  ticketId: text("ticket_id"),                           // set when decision='review' so the dashboard can join queue rows
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("idx_compliance_screenings_address_flow").on(t.address, t.flow),
  index("idx_compliance_screenings_invoice").on(t.invoiceId),
  index("idx_compliance_screenings_merchant").on(t.merchantId),
  // Cron prunes by expires_at; without the index the retention job scans
  // the full table (audit DB hygiene gap, 2026-05-12).
  index("idx_compliance_screenings_expires_at").on(t.expiresAt),
]);

// Short-lived authorization row written by /api/checkout/authorize when
// compliance returns `allow`. /api/checkout/submit fetches an unconsumed,
// unexpired row for (invoice_id, payer) and consumes it atomically before
// queueing the Permit2 message. Without this binding, a blocked wallet could
// skip the React-side authorize call and POST to /submit directly — see audit
// pass 1, finding #2.
//
// `min_amount_in` is the floor the customer's amountIn must meet. Same-token
// invoices store invoice.amountOut here; cross-token store a server-issued
// quote less a small slippage cushion.
export const checkoutAuthorizations = pgTable("checkout_authorizations", {
  id:           uuid("id").defaultRandom().primaryKey(),
  invoiceId:    text("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
  payer:        text("payer").notNull(),
  payInToken:   text("pay_in_token").notNull(),
  minAmountIn:  numeric("min_amount_in").notNull(),
  expiresAt:    timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt:   timestamp("consumed_at", { withTimezone: true }),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Queue of customer-signed Permit2 messages waiting for the Arcora relayer to
// pull funds, run kit.swap, and settle the invoice. Producer: /api/checkout/submit.
// Consumer: ops/relayer/run.ts.
export const relayerQueue = pgTable("relayer_queue", {
  id: uuid("id").defaultRandom().primaryKey(),
  invoiceId: text("invoice_id").notNull().references(() => invoices.id),
  payer: text("payer").notNull(),
  payInToken: text("pay_in_token").notNull(),
  amountIn: numeric("amount_in").notNull(),         // base units
  payoutToken: text("payout_token").notNull(),      // copied from invoice for queue-scan locality
  amountOutMin: numeric("amount_out_min").notNull(), // invoice.amountOut, gateway-enforced floor
  permit2Data: jsonb("permit2_data").notNull(),     // { permit, witness, deadline }
  permit2Signature: text("permit2_signature").notNull(),
  status: relayerQueueStatus("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  // Per-stage tx hashes — populated immediately after each step succeeds so
  // a daemon crash mid-flight can resume from the next pending stage on
  // reclaim instead of replaying step 1 (which would revert with
  // Permit2 InvalidNonce). Audit pass 2 / finding #3, 2026-05-04.
  permit2TxHash: text("permit2_tx_hash"),
  swapTxHash: text("swap_tx_hash"),
  // Exact kit.swap output (decimal string, base units of payoutToken). Stored
  // alongside swap_tx_hash so a stage-aware resume can use the real gross
  // payout instead of falling back to the merchant floor — surplus would
  // otherwise sit silently in the relayer hot wallet. Audit residual P2,
  // 2026-05-05.
  swapAmountOut: numeric("swap_amount_out"),
  settleTxHash: text("settle_tx_hash"),
  refundTxHash: text("refund_tx_hash"),
  nextAttempt: timestamp("next_attempt", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const crosschainPayments = pgTable("crosschain_payments", {
  id: uuid("id").defaultRandom().primaryKey(),
  invoiceId: text("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
  idempotencyKey: text("idempotency_key").notNull(),
  payer: text("payer").notNull(),
  sourceChainId: integer("source_chain_id").notNull(),
  sourceDomain: integer("source_domain").notNull(),
  sourceToken: text("source_token").notNull(),
  sourceAmount: numeric("source_amount").notNull(),
  destinationChainId: integer("destination_chain_id").notNull(),
  destinationDomain: integer("destination_domain").notNull(),
  destinationToken: text("destination_token").notNull(),
  mintRecipient: text("mint_recipient").notNull(),
  payoutToken: text("payout_token").notNull(),
  amountOutMin: numeric("amount_out_min").notNull(),
  routeVersion: text("route_version").notNull(),
  status: crosschainPaymentStatus("status").notNull().default("created"),
  burnTxHash: text("burn_tx_hash"),
  burnSubmittedAt: timestamp("burn_submitted_at", { withTimezone: true }),
  cctpMessage: text("cctp_message"),
  cctpAttestation: text("cctp_attestation"),
  bridgeReceiveTxHash: text("bridge_receive_tx_hash"),
  bridgeAmountReceived: numeric("bridge_amount_received"),
  bridgeConfirmedAt: timestamp("bridge_confirmed_at", { withTimezone: true }),
  arcSwapTxHash: text("arc_swap_tx_hash"),
  arcSwapAmountOut: numeric("arc_swap_amount_out"),
  settleTxHash: text("settle_tx_hash"),
  refundTxHash: text("refund_tx_hash"),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  nextAttempt: timestamp("next_attempt", { withTimezone: true }).notNull().defaultNow(),
  leaseOwner: text("lease_owner"),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("uniq_crosschain_payments_invoice").on(t.invoiceId),
  uniqueIndex("uniq_crosschain_payments_idempotency").on(t.idempotencyKey),
  index("idx_crosschain_payments_status_next_attempt").on(t.status, t.nextAttempt),
  index("idx_crosschain_payments_invoice").on(t.invoiceId),
  // One burn tx may back at most one intent (cross-invoice replay guard);
  // partial so multiple un-submitted rows (NULL burn_tx_hash) coexist.
  uniqueIndex("uniq_crosschain_payments_burn_tx").on(t.sourceChainId, t.burnTxHash).where(sql`${t.burnTxHash} IS NOT NULL`),
]);

export const checkoutTelemetry = pgTable("checkout_telemetry", {
  id: uuid("id").defaultRandom().primaryKey(),
  invoiceId: text("invoice_id").references(() => invoices.id, { onDelete: "cascade" }),
  crosschainPaymentId: uuid("crosschain_payment_id").references(() => crosschainPayments.id, { onDelete: "set null" }),
  eventType: text("event_type").notNull(),
  sourceChainId: integer("source_chain_id"),
  elapsedMs: integer("elapsed_ms"),
  errorCode: text("error_code"),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("idx_checkout_telemetry_invoice_created").on(t.invoiceId, t.createdAt),
  index("idx_checkout_telemetry_event_created").on(t.eventType, t.createdAt),
]);
