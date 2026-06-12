import { describe, it, expect, beforeEach, vi } from "vitest";
import bcrypt from "bcryptjs";
import {
  generateApiKey,
  generatePublishableKey,
  classifyKey,
  hashApiKey,
  verifyApiKey,
  lookupMerchantByApiKey,
  lookupMerchantByPublishableKey,
} from "./apikey";
import { db } from "@/lib/db/client";
import { merchants, invoices, webhookAttempts } from "@/lib/db/schema";
import { randomBytes } from "node:crypto";

beforeEach(async () => {
  // Order matters: webhookAttempts → invoices → merchants (FK chain)
  await db.delete(webhookAttempts);
  await db.delete(invoices);
  await db.delete(merchants);
  process.env.MASTER_KEY = randomBytes(32).toString("base64");
});

describe("api key", () => {
  it("generateApiKey returns prefixed 64-char string", () => {
    const k = generateApiKey();
    expect(k).toMatch(/^ak_live_[A-Za-z0-9]{56}$/);
  });

  it("hashApiKey + verifyApiKey round-trip", async () => {
    const a = await hashApiKey("ak_live_xxx");
    const b = await hashApiKey("ak_live_xxx");
    expect(a).not.toBe(b); // bcrypt salt makes hashes differ
    expect(await verifyApiKey("ak_live_xxx", a)).toBe(true);
    expect(await verifyApiKey("ak_live_xxx", b)).toBe(true);
    expect(await verifyApiKey("ak_live_yyy", a)).toBe(false);
  });

  it("lookupMerchantByApiKey returns the merchant when key matches", async () => {
    const k = generateApiKey();
    const hash = await hashApiKey(k);
    await db.insert(merchants).values({
      address: "0x" + "a".repeat(40),
      payoutToken: "0x" + "b".repeat(40),
      apiKeyHash: hash,
      apiKeyPrefix: k.slice(0, 12),
      webhookSecretEnc: Buffer.alloc(48),
      webhookSecretIv: Buffer.alloc(12),
    });
    const m = await lookupMerchantByApiKey(k);
    expect(m).not.toBeNull();
    expect(m!.address).toBe("0x" + "a".repeat(40));
  });

  it("lookupMerchantByApiKey returns null on bad key", async () => {
    expect(await lookupMerchantByApiKey("ak_live_nonexistent")).toBeNull();
  });

  it("only bcrypt-compares rows whose api_key_prefix matches", async () => {
    const target = generateApiKey();
    const decoy = generateApiKey();
    await db.insert(merchants).values([
      { address: "0x" + "1".repeat(40), payoutToken: "USDC", apiKeyHash: await hashApiKey(target), apiKeyPrefix: target.slice(0, 12), webhookSecretEnc: Buffer.alloc(48), webhookSecretIv: Buffer.alloc(12) },
      { address: "0x" + "2".repeat(40), payoutToken: "USDC", apiKeyHash: await hashApiKey(decoy),  apiKeyPrefix: decoy.slice(0, 12),  webhookSecretEnc: Buffer.alloc(48), webhookSecretIv: Buffer.alloc(12) },
    ]);
    const got = await lookupMerchantByApiKey(target);
    expect(got?.address).toBe("0x" + "1".repeat(40));

    // Wrong-prefix random key: should still return null fast.
    const bogus = "ak_live_ZZZZZZZZZZZZZZZZ" + "A".repeat(40);
    expect(await lookupMerchantByApiKey(bogus)).toBeNull();
  });
});

// Audit 2026-06-11 MED-4: malformed keys must be rejected O(1) — no db
// round-trip, no bcrypt compare. Real secret keys are `ak_live_` + a
// [A-Za-z0-9_] body (generateApiKey emits 56 chars of [A-Za-z0-9]; the e2e
// fixture key uses a 57-char body containing `_`), so the cheap-reject
// bounds the body to 20..64 of that charset.
describe("cheap-reject before bcrypt (audit 2026-06-11 MED-4)", () => {
  const malformed: Array<[string, string]> = [
    ["empty string", ""],
    ["wrong prefix (publishable)", "pk_live_" + "A".repeat(56)],
    ["wrong prefix (unknown)", "sk_live_" + "A".repeat(56)],
    ["uppercase prefix", "AK_LIVE_" + "A".repeat(56)],
    ["prefix only", "ak_live_"],
    ["body too short", "ak_live_" + "A".repeat(19)],
    ["body too long", "ak_live_" + "A".repeat(65)],
    ["illegal chars in body", "ak_live_" + "A".repeat(30) + "!$%" + "A".repeat(23)],
    ["trailing newline", "ak_live_" + "A".repeat(56) + "\n"],
  ];

  it.each(malformed)("returns null for %s without any db or bcrypt work", async (_label, bad) => {
    const dbSpy = vi.spyOn(db, "select");
    const bcryptSpy = vi.spyOn(bcrypt, "compare");
    try {
      expect(await lookupMerchantByApiKey(bad)).toBeNull();
      expect(dbSpy).not.toHaveBeenCalled();
      expect(bcryptSpy).not.toHaveBeenCalled();
    } finally {
      dbSpy.mockRestore();
      bcryptSpy.mockRestore();
    }
  });

  it("a well-formed generated key still reaches the db lookup path", async () => {
    const dbSpy = vi.spyOn(db, "select");
    try {
      // No merchant row exists, so the result is null — but the db IS consulted.
      expect(await lookupMerchantByApiKey(generateApiKey())).toBeNull();
      expect(dbSpy).toHaveBeenCalledTimes(1);
    } finally {
      dbSpy.mockRestore();
    }
  });

  it("accepts the e2e fixture key shape (underscores in body)", async () => {
    const dbSpy = vi.spyOn(db, "select");
    try {
      const fixture = "ak_live_test_" + "x".repeat(52); // mirrors e2e/fixtures/seed.ts
      expect(await lookupMerchantByApiKey(fixture)).toBeNull();
      expect(dbSpy).toHaveBeenCalledTimes(1);
    } finally {
      dbSpy.mockRestore();
    }
  });
});

// AFG-019 (2026-06-06): a separate, browser-safe publishable key (pk_live_)
// with no data-read capability, distinct from the privileged secret key.
describe("publishable api key (AFG-019)", () => {
  it("generatePublishableKey returns prefixed 64-char string", () => {
    expect(generatePublishableKey()).toMatch(/^pk_live_[A-Za-z0-9]{56}$/);
  });

  it("classifyKey distinguishes secret, publishable, and unknown", () => {
    expect(classifyKey(generateApiKey())).toBe("secret");
    expect(classifyKey(generatePublishableKey())).toBe("publishable");
    expect(classifyKey("nope")).toBeNull();
    expect(classifyKey("")).toBeNull();
  });

  it("lookupMerchantByPublishableKey returns the merchant on exact match", async () => {
    const pk = generatePublishableKey();
    await db.insert(merchants).values({
      address: "0x" + "c".repeat(40),
      payoutToken: "0x" + "d".repeat(40),
      apiKeyHash: await hashApiKey(generateApiKey()),
      apiKeyPrefix: "ak_live_AAAA",
      publishableKey: pk,
      publishableKeyPrefix: pk.slice(0, 12),
      webhookSecretEnc: Buffer.alloc(48),
      webhookSecretIv: Buffer.alloc(12),
    });
    const m = await lookupMerchantByPublishableKey(pk);
    expect(m).not.toBeNull();
    expect(m!.address).toBe("0x" + "c".repeat(40));
  });

  it("lookupMerchantByPublishableKey returns null for a secret key (no privilege crossover)", async () => {
    expect(await lookupMerchantByPublishableKey(generateApiKey())).toBeNull();
  });

  it("lookupMerchantByApiKey returns null for a publishable key (browser key can't reach secret routes)", async () => {
    // The whole AFG-019 boundary depends on this: even if a merchant row has a
    // publishable key, lookupMerchantByApiKey (used by escrows + private invoice
    // fields) must reject pk_ keys so a browser credential can't read data.
    const pk = generatePublishableKey();
    await db.insert(merchants).values({
      address: "0x" + "9".repeat(40),
      payoutToken: "0x" + "8".repeat(40),
      apiKeyHash: await hashApiKey(generateApiKey()),
      apiKeyPrefix: "ak_live_CCCC",
      publishableKey: pk,
      publishableKeyPrefix: pk.slice(0, 12),
      webhookSecretEnc: Buffer.alloc(48),
      webhookSecretIv: Buffer.alloc(12),
    });
    expect(await lookupMerchantByApiKey(pk)).toBeNull();
  });

  it("lookupMerchantByPublishableKey returns null when the prefix matches but the full key differs", async () => {
    const pk = generatePublishableKey();
    const samePrefixDifferentKey = pk.slice(0, 12) + "Z".repeat(52); // 12 + 52 = 64 chars
    await db.insert(merchants).values({
      address: "0x" + "e".repeat(40),
      payoutToken: "0x" + "f".repeat(40),
      apiKeyHash: await hashApiKey(generateApiKey()),
      apiKeyPrefix: "ak_live_BBBB",
      publishableKey: samePrefixDifferentKey,
      publishableKeyPrefix: pk.slice(0, 12),
      webhookSecretEnc: Buffer.alloc(48),
      webhookSecretIv: Buffer.alloc(12),
    });
    expect(await lookupMerchantByPublishableKey(pk)).toBeNull();
  });
});
