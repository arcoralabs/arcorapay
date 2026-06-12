import bcrypt from "bcryptjs";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db/client";
import { merchants } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const PREFIX_LEN = 12; // "<prefix>_" + 4 chars of body, e.g. "ak_live_AB12"
// Privileged secret key — server-side only. Authorizes invoice creation,
// escrow listing, and reading private invoice fields.
const SECRET_PREFIX = "ak_live_";
// Browser-safe publishable key (AFG-019, 2026-06-06). Narrow capability:
// may only trigger checkout/invoice creation from an allowlisted origin. It
// can NOT list escrows or read private invoice data. Stored in plaintext
// because it is meant to be embedded in client code.
const PUBLISHABLE_PREFIX = "pk_live_";
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

export { SECRET_PREFIX, PUBLISHABLE_PREFIX };

export type ApiKeyKind = "secret" | "publishable";

/** Returns which key class a raw key belongs to, or null if unrecognized. */
export function classifyKey(key: string): ApiKeyKind | null {
  if (key.startsWith(SECRET_PREFIX)) return "secret";
  if (key.startsWith(PUBLISHABLE_PREFIX)) return "publishable";
  return null;
}

function randomBody(): string {
  const bytes = randomBytes(56);
  let out = "";
  for (let i = 0; i < 56; i++) out += ALPHABET[bytes[i]! % ALPHABET.length];
  return out;
}

export function generateApiKey(): string {
  return SECRET_PREFIX + randomBody();
}

/** Browser-safe publishable key. Not a secret — safe to embed in client code. */
export function generatePublishableKey(): string {
  return PUBLISHABLE_PREFIX + randomBody();
}

export async function hashApiKey(key: string): Promise<string> {
  return bcrypt.hash(key, 10);
}

export async function verifyApiKey(key: string, hash: string): Promise<boolean> {
  return bcrypt.compare(key, hash);
}

/** Constant-time string compare for two equal-length ASCII keys. */
function keysEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Returns the matching merchant for a SECRET key, or null. O(1) via the
 * api_key_prefix index (audit H2, 2026-05-05). Only ever matches `ak_live_`
 * keys — a publishable `pk_live_` key returns null here, so the privileged
 * surfaces that call this (invoice creation, escrows, private invoice fields)
 * can never be authorized by a browser publishable key. (AFG-019)
 */
export async function lookupMerchantByApiKey(key: string) {
  // Audit 2026-06-11 MED-4: reject garbage before bcrypt. Real keys are
  // `ak_live_` + a [A-Za-z0-9_] body — generateApiKey emits exactly 56 chars
  // of [A-Za-z0-9]; the e2e fixture key has a 57-char body containing `_`.
  // Bounds are exact (56–57) so anything else costs O(1), not a db
  // round-trip plus a hash. (No `ak_test_` class exists; secret keys are
  // ak_live_ only.)
  if (!/^ak_live_[A-Za-z0-9_]{56,57}$/.test(key)) return null;
  const prefix = key.slice(0, PREFIX_LEN);
  const candidates = await db.select().from(merchants).where(eq(merchants.apiKeyPrefix, prefix));
  for (const m of candidates) {
    if (await verifyApiKey(key, m.apiKeyHash)) return m;
  }
  return null;
}

/**
 * Returns the matching merchant for a PUBLISHABLE key, or null. Publishable
 * keys are public, so they're stored in plaintext and compared directly
 * (constant-time) via the publishable_key_prefix index. (AFG-019)
 */
export async function lookupMerchantByPublishableKey(key: string) {
  if (!key.startsWith(PUBLISHABLE_PREFIX)) return null;
  const prefix = key.slice(0, PREFIX_LEN);
  const candidates = await db
    .select()
    .from(merchants)
    .where(eq(merchants.publishableKeyPrefix, prefix));
  for (const m of candidates) {
    if (m.publishableKey && keysEqual(m.publishableKey, key)) return m;
  }
  return null;
}
