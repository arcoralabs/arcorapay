import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { randomBytes } from "node:crypto";
import { provisionServerWallet, loadServerWallet } from "./server-wallet";
import { db } from "@/lib/db/client";
import { serverWallets } from "@/lib/db/schema";

describe("server-wallet", () => {
  beforeAll(() => {
    if (!process.env.MASTER_KEY) {
      process.env.MASTER_KEY = randomBytes(32).toString("base64");
    }
  });
  afterEach(async () => {
    await db.delete(serverWallets);
  });

  it("provisions a new wallet and stores encrypted key", async () => {
    const account = await provisionServerWallet();
    expect(account.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    const rows = await db.select().from(serverWallets);
    expect(rows.length).toBe(1);
    expect(rows[0]!.address).toBe(account.address);
  });

  it("round-trips: provision then load returns same address", async () => {
    const a = await provisionServerWallet();
    const b = await loadServerWallet();
    expect(b.address).toBe(a.address);
  });

  it("loadServerWallet throws when none provisioned", async () => {
    await expect(loadServerWallet()).rejects.toThrow(/no server wallet/);
  });
});
