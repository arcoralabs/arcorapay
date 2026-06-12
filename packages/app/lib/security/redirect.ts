/**
 * Defense-in-depth client-side allowlist check before
 * `window.location.href = url`.
 *
 * The server already enforces the merchant's `allowed_origins` allowlist at
 * invoice-create (see /api/invoices/route.ts and audit H1, 2026-05-05) — so
 * any successUrl/cancelUrl that reaches the checkout client SHOULD already
 * be safe. But this is the last line in front of the customer's browser:
 *   - a stale cached invoice could carry a now-revoked origin;
 *   - a tampered DOM/runtime override could push a different URL into props;
 *   - a future regression could reintroduce the un-validated path server-side.
 *
 * Returns true when the redirect was performed, false otherwise. On false
 * the caller is expected to render a non-redirecting fallback ("Return to
 * merchant" button) rather than silently swallow the click.
 */
export function safeClientRedirect(url: string, allowedOrigins: readonly string[]): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    if (!allowedOrigins.includes(parsed.origin)) return false;
    window.location.href = parsed.toString();
    return true;
  } catch {
    return false;
  }
}
