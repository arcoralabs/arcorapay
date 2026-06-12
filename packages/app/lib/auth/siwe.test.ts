import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { generateNonce, verifySiweMessage } from "./siwe";
import { db } from "@/lib/db/client";
import { siweNonces } from "@/lib/db/schema";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { SiweMessage } from "siwe";

beforeEach(async () => { await db.delete(siweNonces); });
afterEach(async () => { await db.delete(siweNonces); });

describe("siwe helpers", () => {
  it("generates a nonce, stores it, returns it", async () => {
    const nonce = await generateNonce();
    expect(nonce).toMatch(/^[A-Za-z0-9]{17,32}$/);
    const rows = await db.select().from(siweNonces);
    expect(rows.length).toBe(1);
    expect(rows[0]!.nonce).toBe(nonce);
    expect(rows[0]!.used).toBe(false);
  });

  it("verifies a valid SIWE signature", async () => {
    const pk = generatePrivateKey();
    const acct = privateKeyToAccount(pk);
    const nonce = await generateNonce();
    const msg = new SiweMessage({
      domain: "localhost",
      address: acct.address,
      statement: "Sign in to Arcora",
      uri: "http://localhost:3000",
      version: "1",
      chainId: 5042002,
      nonce,
    });
    const message = msg.prepareMessage();
    const signature = await acct.signMessage({ message });
    const { address } = await verifySiweMessage({ message, signature });
    expect(address.toLowerCase()).toBe(acct.address.toLowerCase());
  });

  it("rejects reused nonce", async () => {
    const pk = generatePrivateKey();
    const acct = privateKeyToAccount(pk);
    const nonce = await generateNonce();
    const msg = new SiweMessage({
      domain: "localhost", address: acct.address, statement: "Sign in",
      uri: "http://localhost:3000", version: "1", chainId: 5042002, nonce,
    });
    const message = msg.prepareMessage();
    const signature = await acct.signMessage({ message });
    await verifySiweMessage({ message, signature });
    await expect(verifySiweMessage({ message, signature })).rejects.toThrow(/nonce/i);
  });

  it("rejects message signed for a different domain", async () => {
    const pk = generatePrivateKey();
    const acct = privateKeyToAccount(pk);
    const nonce = await generateNonce();
    const msg = new SiweMessage({
      domain: "phishing.example.com",
      address: acct.address, statement: "Sign in",
      uri: "https://phishing.example.com", version: "1", chainId: 5042002, nonce,
    });
    const message = msg.prepareMessage();
    const signature = await acct.signMessage({ message });
    await expect(verifySiweMessage({ message, signature })).rejects.toThrow();
  });

  it("rejects message signed for a different chain", async () => {
    const pk = generatePrivateKey();
    const acct = privateKeyToAccount(pk);
    const nonce = await generateNonce();
    const msg = new SiweMessage({
      domain: "localhost",
      address: acct.address, statement: "Sign in",
      uri: "http://localhost:3000", version: "1",
      chainId: 1,           // mainnet ETH — not what we accept
      nonce,
    });
    const message = msg.prepareMessage();
    const signature = await acct.signMessage({ message });
    await expect(verifySiweMessage({ message, signature })).rejects.toThrow(/chainId/i);
  });

  it("rejects unknown nonce (not generated server-side)", async () => {
    const pk = generatePrivateKey();
    const acct = privateKeyToAccount(pk);
    const msg = new SiweMessage({
      domain: "localhost", address: acct.address, statement: "Sign in",
      uri: "http://localhost:3000", version: "1", chainId: 5042002,
      nonce: "fakeNonce0123456",
    });
    const message = msg.prepareMessage();
    const signature = await acct.signMessage({ message });
    await expect(verifySiweMessage({ message, signature })).rejects.toThrow(/nonce/i);
  });
});
