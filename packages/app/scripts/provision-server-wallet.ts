import "dotenv/config";
import { provisionServerWallet } from "@/lib/wallet/server-wallet";

async function main() {
  if (!process.env.MASTER_KEY) {
    console.error("MASTER_KEY missing — set it in .env or env before running.");
    process.exit(1);
  }
  if (!process.env.POSTGRES_URL) {
    console.error("POSTGRES_URL missing — set it in .env or env before running.");
    process.exit(1);
  }

  const acc = await provisionServerWallet();
  console.log("");
  console.log("Server wallet provisioned:");
  console.log("  address:", acc.address);
  console.log("");
  console.log("Add this to your Vercel env (Project Settings → Environment Variables):");
  console.log("  NEXT_PUBLIC_SERVER_WALLET_ADDRESS=" + acc.address);
  console.log("");
  console.log("Fund the address with ~5 USDC from https://faucet.circle.com (Arc Testnet),");
  console.log("then trigger a Vercel redeploy so the new env var is picked up.");
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
