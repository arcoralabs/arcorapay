import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { merchants } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { generatePublishableKey, PREFIX_LEN } from "@/lib/auth/apikey";
import { isSameOrigin, isJsonContentType } from "@/lib/security/csrf";
import { privateJson } from "@/lib/security/respond";

// MED-6 (2026-06-11): rotation path for publishable keys — without it, a
// leaked pk_live_ key could mint checkouts from spoofed origins forever.
export async function POST(req: NextRequest) {
  // AFG-006 (2026-06-06): same Origin/Referer CSRF guard the webhook route uses.
  if (!isSameOrigin(req)) return privateJson({ error: "csrf" }, { status: 403 });
  // CRIT-1 (2026-06-11): JSON gate — bodyless rotate, but the dashboard fetch
  // (ApiKeyCard) always sends content-type: application/json, so enforce it.
  if (!isJsonContentType(req)) {
    return privateJson({ error: "unsupported_content_type" }, { status: 415 });
  }
  const session = await getSession();
  if (!session.merchantAddress) return privateJson({ error: "unauthorized" }, { status: 401 });

  const publishableKey = generatePublishableKey();
  // Lookup is full-key equality on publishable_key, so the old key stops
  // working the instant this row is updated.
  const updated = await db.update(merchants)
    .set({ publishableKey, publishableKeyPrefix: publishableKey.slice(0, PREFIX_LEN) })
    .where(eq(merchants.address, session.merchantAddress))
    .returning();
  if (updated.length === 0) return privateJson({ error: "no_merchant" }, { status: 404 });

  // Not a secret (it's also returned by GET /api/merchant), but key material
  // still goes out privateJson so it is never cached.
  return privateJson({ publishableKey });
}
