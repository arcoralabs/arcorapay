import { generateNonce as siweGenerateNonce, SiweMessage } from "siwe";
import { db } from "@/lib/db/client";
import { siweNonces } from "@/lib/db/schema";
import { arcTestnet } from "@/lib/chain/client";
import { and, eq, gt } from "drizzle-orm";

const NONCE_TTL_MINUTES = 10;

/**
 * Chain id we accept SIWE messages on. Arc Testnet only — refuse messages
 * signed for any other chain so a leaked signature can't authenticate here.
 *
 * Audit #28: derive from the canonical viem chain definition rather than
 * hardcoding the number, so a future chain id change (mainnet cutover) ripples
 * everywhere from one source.
 */
const SUPPORTED_CHAIN_ID = arcTestnet.id;

/**
 * The hostname an Arcora SIWE message must be signed for. Derived from
 * PUBLIC_BASE_URL with a localhost fallback for local dev / tests.
 *
 * Hardening (audit P1): without this binding, a SIWE signature collected on
 * a different domain (phishing site, malicious dApp) that happened to use an
 * Arcora-issued nonce could authenticate here.
 */
function expectedSiweDomain(): string {
  const base = process.env.PUBLIC_BASE_URL ?? process.env.NEXT_PUBLIC_BASE_URL;
  // Audit L-9 (2026-05-31): silently defaulting to 'localhost' when the base
  // URL is unset/malformed turns the anti-phishing domain binding into a
  // no-op in production (any host's signature would verify against
  // 'localhost'). Fail closed in prod; keep the localhost fallback for
  // local dev / tests only.
  if (!base) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("PUBLIC_BASE_URL (or NEXT_PUBLIC_BASE_URL) is required in production for SIWE domain binding");
    }
    return "localhost";
  }
  try {
    return new URL(base).hostname;
  } catch {
    if (process.env.NODE_ENV === "production") {
      throw new Error(`PUBLIC_BASE_URL is malformed, cannot derive SIWE domain: ${base}`);
    }
    return "localhost";
  }
}

export async function generateNonce(): Promise<string> {
  const nonce = siweGenerateNonce();
  const expiresAt = new Date(Date.now() + NONCE_TTL_MINUTES * 60_000);
  await db.insert(siweNonces).values({ nonce, expiresAt, used: false });
  return nonce;
}

export interface VerifyResult { address: string; chainId: number; }

export async function verifySiweMessage(args: { message: string; signature: string }): Promise<VerifyResult> {
  const siwe = new SiweMessage(args.message);

  // siwe.verify enforces signature recovery + the bindings we pass: domain
  // (the host the message was signed for) and time (expirationTime /
  // notBefore window). chainId we check ourselves below.
  const verification = await siwe.verify({
    signature: args.signature,
    domain: expectedSiweDomain(),
    time: new Date().toISOString(),
  });
  if (!verification.success) {
    throw new Error("siwe verification failed");
  }

  if (siwe.chainId !== SUPPORTED_CHAIN_ID) {
    throw new Error(`siwe chainId mismatch: got ${siwe.chainId}, expected ${SUPPORTED_CHAIN_ID}`);
  }

  // Atomic nonce consume — single UPDATE that only succeeds when the row is
  // currently unused and not yet expired. Two concurrent requests cannot
  // both see used=false anymore (the previous select-then-update pattern
  // had a race window between the two queries).
  const updated = await db.update(siweNonces)
    .set({ used: true })
    .where(and(
      eq(siweNonces.nonce, siwe.nonce),
      eq(siweNonces.used, false),
      gt(siweNonces.expiresAt, new Date()),
    ))
    .returning({ nonce: siweNonces.nonce });
  if (updated.length === 0) {
    throw new Error("siwe nonce unknown, used, or expired");
  }

  return { address: siwe.address, chainId: siwe.chainId };
}
