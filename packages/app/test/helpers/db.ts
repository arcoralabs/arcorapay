import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import * as schema from "@/lib/db/schema";

let pool: Pool | undefined;
export function getTestPool() {
  if (!pool) pool = new Pool({ connectionString: process.env.POSTGRES_URL });
  return pool;
}

export async function withTx<T>(fn: (db: ReturnType<typeof drizzle>) => Promise<T>): Promise<T> {
  const client: PoolClient = await getTestPool().connect();
  try {
    await client.query("BEGIN");
    const txDb = drizzle(client, { schema });
    const result = await fn(txDb);
    await client.query("ROLLBACK");
    return result;
  } finally {
    client.release();
  }
}
