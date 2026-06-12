import { NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { merchants } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { generateApiKey, generatePublishableKey, hashApiKey, PREFIX_LEN } from "@/lib/auth/apikey";
import { encrypt } from "@/lib/crypto/secret";
import { assertSafePublicUrl } from "@/lib/security/safeUrl";
import { isSameOrigin, isJsonContentType } from "@/lib/security/csrf";
import { privateJson } from "@/lib/security/respond";
import { randomBytes } from "node:crypto";

// Audit H1 (2026-05-05): merchant must declare which origins may receive
// customers after a successful payment. We persist `new URL(...).origin`
// (scheme+host+port only) so /api/invoices can validate successUrl/cancelUrl
// at create-time and the checkout client can re-check before redirecting.
// See packages/app/lib/security/safeUrl.ts#assertOriginAllowed.
const Body = z.object({
  payoutToken: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  webhookUrl: z.string().url().optional(),
  allowedOrigins: z.array(z.string().url()).min(1).max(20),
});

export async function POST(req: NextRequest) {
  // AFG-006 (2026-06-06): same Origin/Referer CSRF guard the webhook route uses.
  if (!isSameOrigin(req)) return privateJson({ error: "csrf" }, { status: 403 });
  if (!isJsonContentType(req)) {
    return privateJson({ error: "unsupported_content_type" }, { status: 415 });
  }
  const session = await getSession();
  if (!session.merchantAddress) return privateJson({ error: "unauthorized" }, { status: 401 });

  const existing = await db.select().from(merchants).where(eq(merchants.address, session.merchantAddress)).limit(1);
  if (existing.length > 0) return privateJson({ error: "already_bootstrapped" }, { status: 409 });

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return privateJson({ error: "bad_body" }, { status: 400 });

  // Audit L5 (2026-05-06): validate payoutToken against the server-side
  // allowlist. If SUPPORTED_PAYOUT_TOKENS env is set (comma-separated ERC-20
  // addresses), use that; otherwise default to USDC + EURC. Comparison is
  // case-insensitive (normalised to lowercase).
  const supportedTokens: string[] = process.env.SUPPORTED_PAYOUT_TOKENS
    ? process.env.SUPPORTED_PAYOUT_TOKENS.split(",").map((a) => a.trim().toLowerCase()).filter(Boolean)
    : [
        (process.env.USDC_ADDRESS ?? "").toLowerCase(),
        (process.env.EURC_ADDRESS ?? "").toLowerCase(),
      ].filter(Boolean);
  if (supportedTokens.length > 0 && !supportedTokens.includes(parsed.data.payoutToken.toLowerCase())) {
    return privateJson({ error: "unsupported_payout_token" }, { status: 400 });
  }

  // Audit pass 3 (2026-05-04): bootstrap previously stored any URL that
  // passed `z.string().url()`, including localhost / RFC1918 / link-local
  // addresses. The webhook daemon would later fetch them, exposing internal
  // services. Same SSRF guard the merchant settings PATCH already runs.
  if (parsed.data.webhookUrl) {
    try {
      await assertSafePublicUrl(parsed.data.webhookUrl);
    } catch (e) {
      return privateJson({
        error: "unsafe_webhook_url",
        detail: e instanceof Error ? e.message : String(e),
      }, { status: 400 });
    }
  }

  // Normalize each allowedOrigin to scheme+host[:port] only — anything
  // beyond `URL.origin` (path, query, fragment) is meaningless for the
  // post-payment redirect check and only invites footguns later.
  let allowedOrigins: string[];
  try {
    allowedOrigins = Array.from(
      new Set(parsed.data.allowedOrigins.map((u) => new URL(u).origin)),
    );
  } catch {
    return privateJson({ error: "bad_body" }, { status: 400 });
  }

  const apiKey = generateApiKey();
  const apiKeyHash = await hashApiKey(apiKey);
  // AFG-019 (2026-06-06): also mint a browser-safe publishable key. Stored in
  // plaintext (it's public) and returned so the merchant can embed it in
  // client code instead of the secret key.
  const publishableKey = generatePublishableKey();
  const webhookSecret = "whsec_" + randomBytes(32).toString("hex");
  const { iv, ciphertext } = encrypt(webhookSecret);

  await db.insert(merchants).values({
    address: session.merchantAddress,
    payoutToken: parsed.data.payoutToken,
    webhookUrl: parsed.data.webhookUrl ?? null,
    apiKeyHash,
    apiKeyPrefix: apiKey.slice(0, PREFIX_LEN),
    publishableKey,
    publishableKeyPrefix: publishableKey.slice(0, PREFIX_LEN),
    allowedOrigins,
    webhookSecretEnc: ciphertext,
    webhookSecretIv: iv,
  });

  await session.save();

  return privateJson(
    { apiKey, publishableKey, webhookSecret },
    { status: 201 },
  );
}
