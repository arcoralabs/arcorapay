import type { NextRequest } from "next/server";

/**
 * Per-IP rate-limit key derivation.
 *
 * Audit App-L-4 (2026-05-31): the old implementation returned the LEFTMOST
 * `x-forwarded-for` hop. Vercel's edge *appends* the real connecting IP to
 * XFF rather than replacing it, so the leftmost value is whatever the client
 * sent — letting an attacker drop into a fresh rate-limit bucket on every
 * request by spoofing a new left-XFF and sail past the siwe-nonce / quote /
 * authorize / submit / invoices limiters. We trust, in order:
 *
 *   1. `x-vercel-forwarded-for` — Vercel-injected single canonical client IP
 *      (always present on Vercel, so prod never reaches the XFF branch).
 *   2. `x-real-ip`              — also platform-injected.
 *   3. The RIGHTMOST `x-forwarded-for` hop — the last value appended by the
 *      trusted proxy. Only consulted as a fallback for non-Vercel edges, and
 *      how many trailing hops are "ours" is set explicitly via TRUST_XFF_HOPS
 *      (default 1) since a non-appending proxy leaves even the right side
 *      client-influenced.
 *
 * Missing/uninterpretable → "unknown": one shared bucket so abuse from
 * spoofed/missing headers is still capped, just collectively.
 */
export function clientIp(req: NextRequest): string {
  const vercel = req.headers.get("x-vercel-forwarded-for");
  if (vercel) return vercel.split(",")[0]!.trim();

  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();

  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const hops = xff.split(",").map(h => h.trim()).filter(Boolean);
    if (hops.length > 0) {
      const trusted = Math.max(1, Number(process.env.TRUST_XFF_HOPS ?? "1") || 1);
      // Take the hop just before our own trailing proxy chain — the
      // furthest-right value a client could not have forged past our proxy.
      const idx = Math.max(0, hops.length - trusted);
      return hops[idx]!;
    }
  }
  return "unknown";
}
