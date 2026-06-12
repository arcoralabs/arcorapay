ALTER TYPE "public"."invoice_status" ADD VALUE 'refunded';--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "refund_tx" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "refunded_at" timestamp with time zone;