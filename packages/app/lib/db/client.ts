import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";
import { SUPABASE_CA } from "./supabase-ca";

type SslConfig = boolean | { rejectUnauthorized: boolean } | { ca: string; rejectUnauthorized: boolean };

/** True for Supabase's connection-pooler hosts, whose TLS endpoint presents a
 *  private CA chain that Node's default verify-full rejects. */
function isSupabasePooler(hostname: string): boolean {
  return hostname === "pooler.supabase.com" || hostname.endsWith(".pooler.supabase.com");
}

/**
 * Build pool config from POSTGRES_URL. Behavior:
 *
 *   • No `sslmode` (or `disable`): SSL is left off. Local-dev / CI path
 *     against plain Postgres, which would otherwise fail with "the server
 *     does not support SSL connections" if we forced a handshake.
 *
 *   • Supabase pooler host (`*.pooler.supabase.com`): SSL on with the pinned
 *     Supabase CA and FULL verification (`{ ca, rejectUnauthorized: true }`).
 *     The pooler presents a leaf signed by Supabase's private "2021 CA" chain,
 *     which the system trust store rejects (SELF_SIGNED_CERT_IN_CHAIN); pinning
 *     that CA lets us verify the chain AND hostname instead of disabling checks.
 *
 *   • Any other host with a non-disable `sslmode`: SSL on with FULL
 *     verification (`rejectUnauthorized:true`) — hostname + CA chain are
 *     checked against the system trust store.
 *
 * Audit M-2 (2026-05-31): the relaxed (rejectUnauthorized:false) path used to
 * apply to EVERY non-disable host, structurally disabling cert verification and
 * opening a self-signed-MITM path on app↔Postgres traffic (API-key hashes,
 * encrypted server-wallet PKs, webhook secrets). M-2 scoped it to the pooler.
 * AFG-011 (2026-06-06) closes it entirely: the pooler now uses the pinned CA
 * with verify-full, so NO code path disables certificate verification.
 */
export function buildPoolConfig(): { connectionString?: string; ssl?: SslConfig } {
  const raw = process.env.POSTGRES_URL;
  if (!raw) return {};
  try {
    const u = new URL(raw);
    const sslmode = u.searchParams.get("sslmode");
    u.searchParams.delete("sslmode");
    if (!sslmode || sslmode === "disable") {
      return { connectionString: u.toString(), ssl: false };
    }
    if (isSupabasePooler(u.hostname)) {
      // Pin Supabase's CA and verify fully (chain + hostname). (AFG-011)
      return { connectionString: u.toString(), ssl: { ca: SUPABASE_CA, rejectUnauthorized: true } };
    }
    return {
      connectionString: u.toString(),
      ssl: { rejectUnauthorized: true },
    };
  } catch {
    return { connectionString: raw };
  }
}

let _pool: Pool | undefined;
export function getPool(): Pool {
  if (!_pool) {
    _pool = new Pool(buildPoolConfig());
  }
  return _pool;
}

export const db = drizzle(getPool(), { schema });
export { schema };
