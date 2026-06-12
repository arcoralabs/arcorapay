import { db } from "@/lib/db/client";
import { checkoutTelemetry } from "@/lib/db/schema";

export async function recordCheckoutEvent(args: {
  invoiceId?: string;
  crosschainPaymentId?: string;
  eventType: string;
  sourceChainId?: number;
  elapsedMs?: number;
  errorCode?: string;
  metadata?: Record<string, string | number | boolean | null>;
}): Promise<void> {
  await db.insert(checkoutTelemetry).values({
    invoiceId: args.invoiceId ?? null,
    crosschainPaymentId: args.crosschainPaymentId ?? null,
    eventType: args.eventType,
    sourceChainId: args.sourceChainId ?? null,
    elapsedMs: args.elapsedMs ?? null,
    errorCode: args.errorCode ?? null,
    metadata: args.metadata ?? {},
  });
}
