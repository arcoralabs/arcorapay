import { NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { merchants } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { assertSafePublicUrl } from "@/lib/security/safeUrl";
import { isSameOrigin, isJsonContentType } from "@/lib/security/csrf";
import { privateJson } from "@/lib/security/respond";

// Audit H1 (2026-05-05): post-bootstrap merchants update their redirect
// allowlist via this endpoint. Bootstrap collects the initial set; this
// is the parallel "edit" path used by AllowedOriginsCard in /m/settings.
//
// We mirror the WebhookSettingsCard PATCH /api/merchant/webhook shape:
// session-auth, zod-validate, normalize to origin, update the row.
const Body = z.object({
  allowedOrigins: z.array(z.string().url()).min(1).max(20),
});

export async function PATCH(req: NextRequest) {
  // AFG-006 (2026-06-06): same Origin/Referer CSRF guard the webhook route uses.
  if (!isSameOrigin(req)) return privateJson({ error: "csrf" }, { status: 403 });
  if (!isJsonContentType(req)) {
    return privateJson({ error: "unsupported_content_type" }, { status: 415 });
  }
  const session = await getSession();
  if (!session.merchantAddress) return privateJson({ error: "unauthorized" }, { status: 401 });

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return privateJson({ error: "bad_body" }, { status: 400 });

  // Normalize each entry to scheme+host[:port] only — anything beyond
  // URL.origin (path/query/fragment) is meaningless for the allowlist
  // check and only invites mismatch confusion later.
  let normalized: string[];
  try {
    normalized = Array.from(
      new Set(parsed.data.allowedOrigins.map((u) => new URL(u).origin)),
    );
  } catch {
    return privateJson({ error: "bad_body" }, { status: 400 });
  }

  // Audit M3 (2026-05-19): origins are redirect targets — apply the same
  // SSRF/DNS guard webhook + bootstrap use, and require https. A merchant
  // (or stolen session) must not be able to persist an RFC1918 / cloud-
  // metadata origin that a future redirect-path regression could exploit.
  for (const origin of normalized) {
    if (!origin.startsWith("https://")) {
      return privateJson(
        { error: "unsafe_origin", detail: `origin must be https: ${origin}` },
        { status: 400 },
      );
    }
    try {
      await assertSafePublicUrl(origin);
    } catch (e) {
      return privateJson(
        { error: "unsafe_origin", detail: e instanceof Error ? e.message : String(e) },
        { status: 400 },
      );
    }
  }

  const updated = await db.update(merchants)
    .set({ allowedOrigins: normalized })
    .where(eq(merchants.address, session.merchantAddress))
    .returning({ address: merchants.address });
  if (updated.length === 0) return privateJson({ error: "no_merchant" }, { status: 404 });

  return privateJson({ ok: true, allowedOrigins: normalized });
}
