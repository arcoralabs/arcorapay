CREATE TYPE "public"."invoice_status" AS ENUM('created', 'paid', 'expired');--> statement-breakpoint
CREATE TABLE "indexer_state" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_invoice_id" text NOT NULL,
	"merchant_id" uuid NOT NULL,
	"pay_in_token" text NOT NULL,
	"payout_token" text NOT NULL,
	"amount_out" numeric NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"status" "invoice_status" NOT NULL,
	"paid_by" text,
	"paid_tx" text,
	"paid_at" timestamp with time zone,
	"metadata" jsonb,
	"success_url" text NOT NULL,
	"cancel_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "merchants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"address" text NOT NULL,
	"payout_token" text NOT NULL,
	"webhook_url" text,
	"api_key_hash" text NOT NULL,
	"webhook_secret_enc" "bytea" NOT NULL,
	"webhook_secret_iv" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merchants_address_unique" UNIQUE("address")
);
--> statement-breakpoint
CREATE TABLE "server_wallets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"address" text NOT NULL,
	"encrypted_pk" "bytea" NOT NULL,
	"pk_iv" "bytea" NOT NULL,
	"balance_alert_below" numeric,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "server_wallets_address_unique" UNIQUE("address")
);
--> statement-breakpoint
CREATE TABLE "siwe_nonces" (
	"nonce" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" text NOT NULL,
	"url" text NOT NULL,
	"payload" jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt" timestamp with time zone NOT NULL,
	"succeeded_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_attempts" ADD CONSTRAINT "webhook_attempts_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;