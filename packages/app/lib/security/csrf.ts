import type { NextRequest } from "next/server";

/**
 * CSRF defence for state-changing, cookie-authenticated routes.
 *
 * V2 (audit 2026-06-11 CRIT-1): fail CLOSED when neither Origin nor Referer is
 * present. Browsers stamp Origin on every fetch/XHR/form POST, so a legitimate
 * dashboard request always carries it. Header-less mutations are curl /
 * server-to-server — those callers must use an API key (no ambient cookie),
 * not the session cookie, so rejecting them here costs nothing.
 */
export function isSameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  const referer = req.headers.get("referer");
  if (!origin && !referer) return false;

  const base = process.env.PUBLIC_BASE_URL ?? process.env.NEXT_PUBLIC_BASE_URL;
  let expected: string | null = null;
  if (base) {
    try { expected = new URL(base).origin; } catch { expected = null; }
  }
  if (!expected) return process.env.NODE_ENV !== "production";

  if (origin) return origin === expected;
  try { return new URL(referer!).origin === expected; } catch { return false; }
}

/**
 * Defence-in-depth: browsers cannot send Content-Type: application/json
 * cross-origin without a CORS preflight. Form posts are x-www-form-urlencoded.
 * Call at the top of every cookie-authed mutation handler.
 */
export function isJsonContentType(req: NextRequest): boolean {
  const ct = req.headers.get("content-type") ?? "";
  return (ct.split(";")[0] ?? "").trim().toLowerCase() === "application/json";
}
