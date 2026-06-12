import { getSession } from "@/lib/auth/session";
import { privateJson } from "@/lib/security/respond";
import { db } from "@/lib/db/client";
import { merchants, invoices } from "@/lib/db/schema";
import { and, eq, desc, inArray } from "drizzle-orm";
import { sql } from "drizzle-orm";

const USDC = (process.env.USDC_ADDRESS ?? "").toLowerCase();
const EURC = (process.env.EURC_ADDRESS ?? "").toLowerCase();

export async function GET() {
  const session = await getSession();
  if (!session.merchantAddress) {
    return privateJson({ error: "unauthorized" }, { status: 401 });
  }

  const merchantRow = (
    await db.select().from(merchants).where(eq(merchants.address, session.merchantAddress)).limit(1)
  )[0];
  if (!merchantRow) {
    return privateJson({ merchant: null, totals: [], activity: [] });
  }

  // Per-stable aggregate: sum payouts + fees, partitioned by status (paid vs refunded).
  const aggregates = await db
    .select({
      payoutToken: invoices.payoutToken,
      status:      invoices.status,
      payoutSum:   sql<string>`coalesce(sum(${invoices.merchantPayout}::numeric), 0)::text`,
      feeSum:      sql<string>`coalesce(sum(${invoices.protocolFee}::numeric), 0)::text`,
      count:       sql<number>`count(*)::int`,
    })
    .from(invoices)
    .where(
      and(
        eq(invoices.merchantId, merchantRow.id),
        inArray(invoices.status, ["paid", "refunded"]),
      ),
    )
    .groupBy(invoices.payoutToken, invoices.status);

  // Reshape into per-token rollup.
  type Rollup = {
    token: string;
    received: string;        // paid - refunded, the merchant's actual current holdings credited from Arcora
    grossVolume: string;     // paid + refunded, total settled volume
    refunded: string;
    feesPaid: string;        // protocol fees from this merchant's paid invoices (irrespective of refund)
    paidCount: number;
    refundedCount: number;
  };
  const byToken = new Map<string, Rollup>();
  for (const row of aggregates) {
    const tk = row.payoutToken;
    if (!byToken.has(tk)) {
      byToken.set(tk, {
        token: tk,
        received: "0",
        grossVolume: "0",
        refunded: "0",
        feesPaid: "0",
        paidCount: 0,
        refundedCount: 0,
      });
    }
    const r = byToken.get(tk)!;
    if (row.status === "paid") {
      r.received    = (BigInt(r.received)    + BigInt(row.payoutSum)).toString();
      r.grossVolume = (BigInt(r.grossVolume) + BigInt(row.payoutSum)).toString();
      r.feesPaid    = (BigInt(r.feesPaid)    + BigInt(row.feeSum)).toString();
      r.paidCount   = row.count;
    } else if (row.status === "refunded") {
      r.refunded    = (BigInt(r.refunded)    + BigInt(row.payoutSum)).toString();
      r.grossVolume = (BigInt(r.grossVolume) + BigInt(row.payoutSum)).toString();
      r.feesPaid    = (BigInt(r.feesPaid)    + BigInt(row.feeSum)).toString();
      // Refunded invoices: merchant's holdings DROP by payoutSum (they paid the customer back).
      r.received    = (BigInt(r.received)    - BigInt(row.payoutSum)).toString();
      r.refundedCount = row.count;
    }
  }

  // 30-day daily volume time series, per payout token. Refunds count negative
  // toward the day's net payout. Days with no activity get a zero bucket so
  // the chart x-axis is continuous, not jagged.
  const timeSeriesRaw = await db
    .select({
      day:         sql<string>`date_trunc('day', coalesce(${invoices.refundedAt}, ${invoices.paidAt}))::date::text`,
      payoutToken: invoices.payoutToken,
      status:      invoices.status,
      payoutSum:   sql<string>`coalesce(sum(${invoices.merchantPayout}::numeric), 0)::text`,
      count:       sql<number>`count(*)::int`,
    })
    .from(invoices)
    .where(
      and(
        eq(invoices.merchantId, merchantRow.id),
        inArray(invoices.status, ["paid", "refunded"]),
        sql`coalesce(${invoices.refundedAt}, ${invoices.paidAt}) >= now() - interval '30 days'`,
      ),
    )
    .groupBy(sql`1`, invoices.payoutToken, invoices.status);

  // Reshape: per-token daily map { day → { paidIn, refundedOut, paidCount, refundedCount } }
  type DailyEntry = { day: string; paidIn: bigint; refundedOut: bigint; paidCount: number; refundedCount: number };
  const seriesByToken = new Map<string, Map<string, DailyEntry>>();
  for (const row of timeSeriesRaw) {
    if (!seriesByToken.has(row.payoutToken)) seriesByToken.set(row.payoutToken, new Map());
    const dayMap = seriesByToken.get(row.payoutToken)!;
    if (!dayMap.has(row.day)) dayMap.set(row.day, {
      day: row.day, paidIn: 0n, refundedOut: 0n, paidCount: 0, refundedCount: 0,
    });
    const entry = dayMap.get(row.day)!;
    if (row.status === "paid") {
      entry.paidIn   += BigInt(row.payoutSum);
      entry.paidCount = row.count;
    } else {
      entry.refundedOut += BigInt(row.payoutSum);
      entry.refundedCount = row.count;
    }
  }

  // Fill missing days with zeros across the 30-day window so the chart x-axis
  // is continuous regardless of activity gaps.
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const fullDays: string[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    fullDays.push(d.toISOString().slice(0, 10));
  }
  const timeSeries = Array.from(seriesByToken.entries()).map(([token, dayMap]) => ({
    token,
    days: fullDays.map(day => {
      const entry = dayMap.get(day);
      const net = entry ? entry.paidIn - entry.refundedOut : 0n;
      return {
        day,
        netPayout:    net.toString(),
        paidCount:    entry?.paidCount ?? 0,
        refundedCount: entry?.refundedCount ?? 0,
      };
    }),
  }));

  // Recent activity: last 20 paid or refunded invoices, newest first.
  const activity = await db
    .select({
      id:         invoices.id,
      payoutToken: invoices.payoutToken,
      payInToken:  invoices.payInToken,
      amountOut:   invoices.amountOut,
      merchantPayout: invoices.merchantPayout,
      status:     invoices.status,
      paidAt:     invoices.paidAt,
      paidTx:     invoices.paidTx,
      refundedAt: invoices.refundedAt,
      refundTx:   invoices.refundTx,
    })
    .from(invoices)
    .where(
      and(
        eq(invoices.merchantId, merchantRow.id),
        inArray(invoices.status, ["paid", "refunded"]),
      ),
    )
    .orderBy(desc(invoices.paidAt))
    .limit(20);

  return privateJson({
    timeSeries,
    merchant: {
      address: merchantRow.address,
      payoutToken: merchantRow.payoutToken,
    },
    knownTokens: { USDC, EURC },
    totals: Array.from(byToken.values()),
    activity: activity.map(a => ({
      id: a.id,
      payoutToken: a.payoutToken,
      payInToken:  a.payInToken,
      amountOut:   a.amountOut,
      merchantPayout: a.merchantPayout,
      status: a.status,
      eventAt: (a.refundedAt ?? a.paidAt)?.toISOString() ?? null,
      txHash:  a.refundTx ?? a.paidTx,
    })),
  });
}
