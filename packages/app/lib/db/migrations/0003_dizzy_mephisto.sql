CREATE TYPE "public"."relayer_queue_status" AS ENUM('pending', 'processing', 'settled', 'refunded', 'failed');--> statement-breakpoint
ALTER TYPE "public"."invoice_status" ADD VALUE 'failed';--> statement-breakpoint
CREATE TABLE "relayer_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" text NOT NULL,
	"payer" text NOT NULL,
	"pay_in_token" text NOT NULL,
	"amount_in" numeric NOT NULL,
	"payout_token" text NOT NULL,
	"amount_out_min" numeric NOT NULL,
	"permit2_data" jsonb NOT NULL,
	"permit2_signature" text NOT NULL,
	"status" "relayer_queue_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"swap_tx_hash" text,
	"settle_tx_hash" text,
	"refund_tx_hash" text,
	"next_attempt" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "relayer_queue" ADD CONSTRAINT "relayer_queue_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;