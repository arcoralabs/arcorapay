import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { merchants, invoices } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { generatePublishableKey, PREFIX_LEN } from "@/lib/auth/apikey";
import { privateJson } from "@/lib/security/respond";

export async function GET() {
  const session = await getSession();
  if (!session.merchantAddress) return privateJson({ error: "unauthorized" }, { status: 401 });

  const rows = await db.select().from(merchants).where(eq(merchants.address, session.merchantAddress)).limit(1);
  if (rows.length === 0) {
    return privateJson({ merchant: null, invoices: [] });
  }
  const m = rows[0]!;

  // AFG-019 (2026-06-06): merchants created before publishable keys existed
  // have an empty publishable_key. Lazily mint and persist one the first time
  // the dashboard loads so they get a browser-safe key without re-bootstrapping.
  let publishableKey = m.publishableKey ?? "";
  if (!publishableKey) {
    publishableKey = generatePublishableKey();
    await db.update(merchants)
      .set({ publishableKey, publishableKeyPrefix: publishableKey.slice(0, PREFIX_LEN) })
      .where(eq(merchants.id, m.id));
  }

  const invs = await db.select().from(invoices)
    .where(eq(invoices.merchantId, m.id))
    .orderBy(desc(invoices.createdAt))
    .limit(50);
  return privateJson({
    merchant: {
      address: m.address,
      payoutToken: m.payoutToken,
      webhookUrl: m.webhookUrl,
      // Audit H1 (2026-05-05): exposed so AllowedOriginsCard can show /
      // edit the current list. Not a secret — it's an allowlist of
      // post-payment redirect targets.
      allowedOrigins: m.allowedOrigins ?? [],
      // AFG-019: browser-safe publishable key. Safe to return to the dashboard
      // and embed in client code; the secret key is never exposed here.
      publishableKey,
    },
    invoices: invs.map(i => ({
      id: i.id,
      payInToken: i.payInToken,
      amountOut: i.amountOut,
      status: i.status,
      paidTx: i.paidTx,
      gatewayAddress: i.gatewayAddress,
      createdAt: i.createdAt.toISOString(),
    })),
    // apiKey removed from GET response (Audit L9): use bootstrap / rotation
    // response body to retrieve it; it is no longer held in session.
  });
}
