CREATE INDEX "idx_compliance_screenings_address_flow" ON "compliance_screenings" USING btree ("address","flow");--> statement-breakpoint
CREATE INDEX "idx_compliance_screenings_invoice" ON "compliance_screenings" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "idx_compliance_screenings_merchant" ON "compliance_screenings" USING btree ("merchant_id");