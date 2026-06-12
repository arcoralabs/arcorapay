import { NextRequest, NextResponse } from "next/server";
import { generateNonce } from "@/lib/auth/siwe";
import { takeToken } from "@/lib/rate/limiter";
import { clientIp } from "@/lib/rate/clientIp";
import { isSameOrigin } from "@/lib/security/csrf";

/**
 * SIWE nonce issuance. Per-IP rate-limited (10/60s) so a malicious caller
 * can't flood the siwe_nonces table by hammering this unauthenticated
 * endpoint. Audit M9 (2026-05-06).
 *
 * Audit App-L-4 (2026-05-31): this route used to carry its own copy of
 * clientIp() that trusted the leftmost (spoofable) x-forwarded-for hop.
 * Replaced with the shared, Vercel-trusted lib/rate/clientIp helper.
 */

const NONCE_LIMIT_PER_WINDOW = 10;
const NONCE_WINDOW_SECONDS = 60;

export async function POST(req: NextRequest) {
  // AFG-006 (2026-06-07): pair the verify-route login-CSRF guard so the whole
  // SIWE handshake is same-origin only (dashboard-driven). Lenient outside prod.
  // CRIT-1 (2026-06-11): no isJsonContentType gate here — the dashboard's
  // bodyless nonce fetch (ConnectMerchantButton) omits content-type entirely.
  if (!isSameOrigin(req)) return NextResponse.json({ error: "csrf" }, { status: 403 });
  const ip = clientIp(req);
  let allowed = true;
  try {
    allowed = await takeToken(`siwe-nonce:${ip}`, NONCE_LIMIT_PER_WINDOW, NONCE_WINDOW_SECONDS);
  } catch {
    // Limiter outage shouldn't lock everyone out — fail-open. The whole
    // endpoint is the second-line defence; the verify step still requires a
    // valid signed message + nonce, so an attacker who somehow bursts past
    // here still has to clear SIWE-verify.
    allowed = true;
  }
  if (!allowed) {
    return NextResponse.json(
      { error: "rate_limited", retryAfterSeconds: NONCE_WINDOW_SECONDS },
      { status: 429, headers: { "retry-after": String(NONCE_WINDOW_SECONDS) } },
    );
  }
  const nonce = await generateNonce();
  return NextResponse.json({ nonce });
}
