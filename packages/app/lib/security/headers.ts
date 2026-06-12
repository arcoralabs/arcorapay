/**
 * Canonical HTTP security headers for the Arcora app.
 *
 * Static headers are applied via next.config.ts `async headers()`. The
 * Content-Security-Policy is NOT part of the static set: it carries a
 * per-request script nonce and is therefore built in middleware.ts via
 * `buildCsp(nonce)`.
 *
 * Audit M14 (2026-05-06): add defence-in-depth security headers that the
 * previous config omitted.
 * Audit MED-5 (2026-06-11): drop `script-src 'unsafe-inline'` in favour of a
 * per-request nonce + 'strict-dynamic'.
 */

/**
 * Build the Content-Security-Policy value for a single request.
 *
 * script-src uses a per-request nonce plus 'strict-dynamic': only scripts
 * carrying the nonce (and scripts those scripts load) execute, so injected
 * inline scripts are dead on arrival. 'self' is kept as a fallback for
 * CSP2-only browsers, which ignore 'strict-dynamic'.
 *
 * `next dev` serves its client bundles through eval-based source maps, so a
 * CSP without 'unsafe-eval' kills hydration on every client page in dev (and
 * with it the Playwright e2e suite, which runs against `pnpm dev`).
 * Production builds don't eval — the shipped CSP carries no 'unsafe-eval'.
 *
 * style-src keeps 'unsafe-inline': Next and the UI libraries emit inline
 * style attributes/tags, and styles are not the XSS vector this policy
 * targets.
 */
export function buildCsp(nonce: string): string {
  const isDev = process.env.NODE_ENV === "development";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    "connect-src 'self' https:",
    "frame-ancestors 'self'",
    // CSP3 'strict-dynamic' makes browsers ignore 'self' in script-src, so
    // plugin execution (<object>/<embed>) and <base href> hijacking must be
    // closed explicitly — default-src does NOT cover either.
    "object-src 'none'",
    "base-uri 'self'",
  ].join("; ");
}

export function securityHeaders(): { key: string; value: string }[] {
  return [
    {
      key: "X-Frame-Options",
      value: "SAMEORIGIN",
    },
    {
      key: "X-Content-Type-Options",
      value: "nosniff",
    },
    {
      key: "Referrer-Policy",
      value: "strict-origin-when-cross-origin",
    },
    {
      key: "Strict-Transport-Security",
      value: "max-age=63072000; includeSubDomains; preload",
    },
    // Content-Security-Policy is intentionally absent here — it needs the
    // per-request nonce, so middleware.ts sets it via buildCsp(nonce).
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=()",
    },
  ];
}
