import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth/session";
import { lookupMerchantByApiKey } from "@/lib/auth/apikey";
import { db } from "@/lib/db/client";
import { merchants, invoices } from "@/lib/db/schema";
import { and, eq, gt, lte } from "drizzle-orm";
import { privateJson } from "@/lib/security/respond";

/**
 * GET /api/merchant/escrows
 *
 * Returns escrow state grouped into three buckets:
 *   pending  — paid, claimableAt in the future (still within 7-day refund window)
 *   matured  — paid, claimableAt ≤ now (window elapsed, ready to claim)
 *   claimed  — already claimed
 *
 * All three buckets cap at PAGE_SIZE rows. When a bucket has more, the
 * response includes `truncated.<bucket> = true` so the UI can render a
 * "200+ — narrow filters or contact support" hint and the edge function
 * doesn't get DoS'd by a merchant with tens of thousands of invoices.
 *
 * Auth (audit App-H1, 2026-05-24): accepts EITHER
 *   - iron-session cookie (merchant dashboard / /m/treasury), OR
 *   - X-Arcora-Api-Key header (SDK / programmatic).
 *
 * The dual-auth shape matches the SDK's contract (`sdk.escrows()` ships
 * an API key, not a session cookie). Before this fix, every SDK call hit
 * a hard 401 and the SDK reported INVALID_API_KEY for valid keys.
 *
 * Auth resolution order:
 *   1. iron-session cookie. If `session.merchantAddress` is set but the
 *      merchant row doesn't exist yet (the brief window between SIWE
 *      verify and the bootstrap call), we keep the existing behaviour
 *      and return the empty-bucket shape so the dashboard renders.
 *   2. X-Arcora-Api-Key header (canonical) or x-api-key (legacy alias),
 *      matching the pair recognised by /api/invoices/[id]. Lookup
 *      failure → 401.
 */
const PAGE_SIZE = 200;

const EMPTY_RESPONSE = {
  pending: [],
  matured: [],
  claimed: [],
  counts:    { pending: 0,     matured: 0,     claimed: 0     },
  truncated: { pending: false, matured: false, claimed: false },
};

export async function GET(req: NextRequest) {
  // Path 1 — session cookie. Preserves the original behaviour, including
  // the "session but no merchant row yet" empty response.
  const session = await getSession();
  if (session.merchantAddress) {
    const merchantRow = (
      await db.select().from(merchants).where(eq(merchants.address, session.merchantAddress)).limit(1)
    )[0];
    if (!merchantRow) {
      return privateJson(EMPTY_RESPONSE);
    }
    return privateJson(await buildBuckets(merchantRow.id));
  }

  // Path 2 — API key. Same header pair as /api/invoices/[id].
  const apiKey =
    req.headers.get("x-arcora-api-key") ??
    req.headers.get("x-api-key") ??
    "";
  if (!apiKey) {
    return privateJson({ error: "unauthorized" }, { status: 401 });
  }
  let merchant: { id: string } | null = null;
  try {
    merchant = (await lookupMerchantByApiKey(apiKey)) ?? null;
  } catch {
    merchant = null;
  }
  if (!merchant) {
    return privateJson({ error: "unauthorized" }, { status: 401 });
  }
  return privateJson(await buildBuckets(merchant.id));
}

async function buildBuckets(merchantId: string) {
  const now = new Date();

  // Fetch PAGE_SIZE + 1 so we can detect truncation without a second count query.
  const probeLimit = PAGE_SIZE + 1;
  const [pendingRows, maturedRows, claimedRows] = await Promise.all([
    db.select().from(invoices).where(and(
      eq(invoices.merchantId, merchantId),
      eq(invoices.status, "paid"),
      gt(invoices.claimableAt, now),
    )).limit(probeLimit),
    db.select().from(invoices).where(and(
      eq(invoices.merchantId, merchantId),
      eq(invoices.status, "paid"),
      lte(invoices.claimableAt, now),
    )).limit(probeLimit),
    db.select().from(invoices).where(and(
      eq(invoices.merchantId, merchantId),
      eq(invoices.status, "claimed"),
    )).limit(probeLimit),
  ]);

  const cap = <T>(rows: T[]) => ({
    rows:       rows.slice(0, PAGE_SIZE),
    truncated:  rows.length > PAGE_SIZE,
  });
  const pending = cap(pendingRows);
  const matured = cap(maturedRows);
  const claimed = cap(claimedRows);

  return {
    pending: pending.rows,
    matured: matured.rows,
    claimed: claimed.rows,
    counts: {
      pending: pending.rows.length,
      matured: matured.rows.length,
      claimed: claimed.rows.length,
    },
    truncated: {
      pending: pending.truncated,
      matured: matured.truncated,
      claimed: claimed.truncated,
    },
  };
}
