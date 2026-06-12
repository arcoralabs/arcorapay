CREATE TYPE "public"."compliance_decision" AS ENUM('allow', 'review', 'reject');--> statement-breakpoint
CREATE TYPE "public"."compliance_flow" AS ENUM('merchant_payout', 'customer_pay');--> statement-breakpoint
CREATE TYPE "public"."compliance_risk" AS ENUM('low', 'medium', 'high', 'sanctions');--> statement-breakpoint
CREATE TABLE "compliance_screenings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"address" text NOT NULL,
	"flow" "compliance_flow" NOT NULL,
	"invoice_id" text,
	"merchant_id" uuid,
	"provider" text NOT NULL,
	"risk" "compliance_risk" NOT NULL,
	"reasons" jsonb NOT NULL,
	"provider_score" numeric,
	"provider_snapshot" jsonb NOT NULL,
	"decision" "compliance_decision" NOT NULL,
	"ticket_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "compliance_screenings" ADD CONSTRAINT "compliance_screenings_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_screenings" ADD CONSTRAINT "compliance_screenings_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;