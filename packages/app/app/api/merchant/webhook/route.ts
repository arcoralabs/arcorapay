import { NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { merchants } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { encrypt } from "@/lib/crypto/secret";
import { randomBytes } from "node:crypto";
import { assertSafePublicUrl } from "@/lib/security/safeUrl";
import { isSameOrigin, isJsonContentType } from "@/lib/security/csrf";
import { privateJson } from "@/lib/security/respond";

const PatchBody = z.object({ webhookUrl: z.string().url().nullable() });

export async function PATCH(req: NextRequest) {
  // Audit L-5 (2026-05-31): state-changing merchant routes now carry the same
  // Origin/Referer CSRF guard as auth/logout, not just SameSite=Lax.
  if (!isSameOrigin(req)) return privateJson({ error: "csrf" }, { status: 403 });
  if (!isJsonContentType(req)) {
    return privateJson({ error: "unsupported_content_type" }, { status: 415 });
  }
  const session = await getSession();
  if (!session.merchantAddress) return privateJson({ error: "unauthorized" }, { status: 401 });
  const parsed = PatchBody.safeParse(await req.json());
  if (!parsed.success) return privateJson({ error: "bad_body" }, { status: 400 });

  // Audit P2 (2026-05-03): block SSRF via merchant-controlled webhook URL.
  // We resolve DNS and reject private/loopback/link-local/cloud-metadata
  // ranges so a merchant cannot point us at internal infra.
  if (parsed.data.webhookUrl) {
    try {
      await assertSafePublicUrl(parsed.data.webhookUrl);
    } catch (e: unknown) {
      const reason = (e as Error).message ?? "url_rejected";
      return privateJson({ error: "webhook_url_rejected", reason }, { status: 400 });
    }
  }

  const updated = await db.update(merchants).set({ webhookUrl: parsed.data.webhookUrl })
    .where(eq(merchants.address, session.merchantAddress))
    .returning({ address: merchants.address });
  if (updated.length === 0) return privateJson({ error: "no_merchant" }, { status: 404 });
  return privateJson({ ok: true });
}

export async function POST(req: NextRequest) {
  // Audit L-5 (2026-05-31): same CSRF guard on the signing-secret rotation.
  // CRIT-1 (2026-06-11): no isJsonContentType gate here — the dashboard's
  // bodyless rotate fetch (WebhookSettingsCard) omits content-type entirely.
  if (!isSameOrigin(req)) return privateJson({ error: "csrf" }, { status: 403 });
  const session = await getSession();
  if (!session.merchantAddress) return privateJson({ error: "unauthorized" }, { status: 401 });

  const webhookSecret = "whsec_" + randomBytes(32).toString("hex");
  const { iv, ciphertext } = encrypt(webhookSecret);
  const updated = await db.update(merchants)
    .set({ webhookSecretEnc: ciphertext, webhookSecretIv: iv })
    .where(eq(merchants.address, session.merchantAddress))
    .returning({ address: merchants.address });
  if (updated.length === 0) return privateJson({ error: "no_merchant" }, { status: 404 });
  return privateJson({ webhookSecret });
}
