// AFG-011 (2026-06-06): build a pg pool config that NEVER disables TLS
// certificate verification. Replaces the old `ssl: { rejectUnauthorized: false }`
// across the ops daemons. Returns a plain object (no `pg` import here, so this
// file stays dependency-free and copy-paste portable across daemon dirs); each
// daemon passes it to `new pg.Pool(...)`.
//
// KEEP IN SYNC across ops/{relayer,indexer,webhooks}/db.ts (the VPS deploys each
// daemon dir independently, so they each carry their own copy).
import { SUPABASE_CA } from "./supabase-ca.js";

export type OpsSsl = false | { rejectUnauthorized: boolean; ca?: string };
export interface OpsPoolConfig {
  connectionString: string;
  ssl: OpsSsl;
}

function isSupabaseHost(h: string): boolean {
  return h.endsWith(".supabase.com") || h.endsWith(".supabase.co");
}

function isLocalHost(h: string): boolean {
  return h === "localhost" || h === "127.0.0.1" || h === "::1";
}

/**
 * TLS policy:
 *   • Supabase host → pin the Supabase CA, verify-full (chain + hostname).
 *   • localhost     → ssl off (local dev / CI plain Postgres).
 *   • anything else → verify-full against the system trust store.
 * `sslmode` is stripped so a DSN query param can't override our ssl option.
 */
export function buildOpsPoolConfig(connectionString: string): OpsPoolConfig {
  const u = new URL(connectionString);
  u.searchParams.delete("sslmode");
  const host = u.hostname;
  if (isLocalHost(host)) {
    return { connectionString: u.toString(), ssl: false };
  }
  if (isSupabaseHost(host)) {
    return { connectionString: u.toString(), ssl: { ca: SUPABASE_CA, rejectUnauthorized: true } };
  }
  return { connectionString: u.toString(), ssl: { rejectUnauthorized: true } };
}

/** Secret-free description of the effective TLS mode, for startup logs. */
export function describeDbTls(cfg: OpsPoolConfig): string {
  if (cfg.ssl === false) return "off (local)";
  if (cfg.ssl.ca) return "verify-full (pinned Supabase CA)";
  return "verify-full (system trust)";
}

/** Fail-closed startup guard: a remote DB must use verify-full. */
export function assertSecureDbTls(cfg: OpsPoolConfig): void {
  const host = new URL(cfg.connectionString).hostname;
  if (isLocalHost(host)) return;
  if (cfg.ssl === false || cfg.ssl.rejectUnauthorized !== true) {
    throw new Error("insecure_db_tls: remote Postgres requires verify-full (rejectUnauthorized:true)");
  }
}
