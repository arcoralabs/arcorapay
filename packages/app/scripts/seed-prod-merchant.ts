import "dotenv/config";
import { db } from "@/lib/db/client";
import { merchants } from "@/lib/db/schema";
import { generateApiKey, hashApiKey } from "@/lib/auth/apikey";
import { encrypt } from "@/lib/crypto/secret";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";

async function main() {
  const merchantAddress = process.env.MERCHANT_ADDRESS;
  const payoutToken = process.env.MERCHANT_PAYOUT_TOKEN ?? process.env.USDC_ADDRESS;

  if (!merchantAddress) throw new Error("MERCHANT_ADDRESS missing");
  if (!payoutToken) throw new Error("payout token missing");

  const existing = await db.select().from(merchants).where(eq(merchants.address, merchantAddress)).limit(1);
  if (existing.length > 0) {
    console.log(`Merchant ${merchantAddress} already exists in DB.`);
    console.log(`To rotate the key, use the dashboard /m/settings or call POST /api/merchant/api-key.`);
    return;
  }

  const apiKey = generateApiKey();
  const apiKeyHash = await hashApiKey(apiKey);
  const webhookSecret = "whsec_" + randomBytes(32).toString("hex");
  const { iv, ciphertext } = encrypt(webhookSecret);

  await db.insert(merchants).values({
    address: merchantAddress,
    payoutToken,
    webhookUrl: null,
    apiKeyHash,
    webhookSecretEnc: ciphertext,
    webhookSecretIv: iv,
  });

  console.log("Seeded merchant:");
  console.log("  address:        ", merchantAddress);
  console.log("  payout token:   ", payoutToken);
  console.log("");
  console.log("API KEY (save now — won't be visible again):");
  console.log(`  ${apiKey}`);
  console.log("");
  console.log("Webhook secret:");
  console.log(`  ${webhookSecret}`);
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
