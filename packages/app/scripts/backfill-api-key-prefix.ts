// packages/app/scripts/backfill-api-key-prefix.ts
// Run: pnpm --filter @arcora/app exec tsx scripts/backfill-api-key-prefix.ts
//
// Lists merchants whose api_key_prefix is empty (legacy rows from before
// audit H2 fix). Such merchants must rotate their API key via /m/dashboard
// → API Keys → Rotate, which calls hashApiKey + writes the new prefix.
import { db } from "@/lib/db/client";
import { merchants } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

async function main() {
  const stale = await db.select().from(merchants).where(eq(merchants.apiKeyPrefix, ""));
  if (stale.length === 0) {
    console.log("OK: all merchants have api_key_prefix populated");
    return;
  }
  console.log(`WARN: ${stale.length} merchant(s) need API-key rotation:`);
  for (const m of stale) console.log(`  - ${m.id}  ${m.address}`);
  process.exit(2);
}

main().catch((e) => { console.error(e); process.exit(1); });
