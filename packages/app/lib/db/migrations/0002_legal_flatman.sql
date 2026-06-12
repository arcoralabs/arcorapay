ALTER TABLE "invoices" ADD COLUMN "amount_in" numeric;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "merchant_payout" numeric;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "protocol_fee" numeric;