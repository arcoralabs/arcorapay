import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Account, Hex } from "viem";
import { db } from "@/lib/db/client";
import { serverWallets } from "@/lib/db/schema";
import { encrypt, decrypt } from "@/lib/crypto/secret";

export async function provisionServerWallet(): Promise<Account> {
  const pk = generatePrivateKey();
  const account = privateKeyToAccount(pk);
  const { iv, ciphertext } = encrypt(pk);
  await db.insert(serverWallets).values({
    address: account.address,
    encryptedPk: ciphertext,
    pkIv: iv,
  });
  return account;
}

export async function loadServerWallet(): Promise<Account> {
  const rows = await db.select().from(serverWallets).limit(1);
  if (rows.length === 0) throw new Error("no server wallet provisioned");
  const row = rows[0]!;
  const pk = decrypt(row.pkIv, row.encryptedPk) as Hex;
  return privateKeyToAccount(pk);
}
