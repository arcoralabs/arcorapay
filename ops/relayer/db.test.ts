import { describe, it, expect } from "vitest";
import { buildOpsPoolConfig, describeDbTls, assertSecureDbTls } from "./db.js";
import { SUPABASE_CA } from "./supabase-ca.js";

describe("buildOpsPoolConfig (AFG-011)", () => {
  it("pins the Supabase CA + verify-full for the pooler host", () => {
    const cfg = buildOpsPoolConfig(
      "postgres://postgres.ref:pw@aws-1-eu-central-1.pooler.supabase.com:6543/postgres?sslmode=require",
    );
    expect(cfg.ssl).toEqual({ ca: SUPABASE_CA, rejectUnauthorized: true });
    expect(cfg.connectionString).not.toContain("sslmode");
  });

  it("pins the Supabase CA for the direct db.<ref>.supabase.co host too", () => {
    const cfg = buildOpsPoolConfig("postgres://postgres:pw@db.abc.supabase.co:5432/postgres");
    expect(cfg.ssl).toEqual({ ca: SUPABASE_CA, rejectUnauthorized: true });
  });

  it("disables ssl only for localhost (plain dev Postgres)", () => {
    const cfg = buildOpsPoolConfig("postgres://postgres:postgres@localhost:5432/arcfx");
    expect(cfg.ssl).toBe(false);
  });

  it("verify-full against system trust for any other remote host", () => {
    const cfg = buildOpsPoolConfig("postgres://u:p@some-managed-pg.aws.com:5432/db?sslmode=require");
    expect(cfg.ssl).toEqual({ rejectUnauthorized: true });
  });

  it("never produces a rejectUnauthorized:false config", () => {
    for (const dsn of [
      "postgres://postgres.ref:pw@aws-1-eu-central-1.pooler.supabase.com:6543/postgres",
      "postgres://u:p@db.abc.supabase.co:5432/db",
      "postgres://u:p@managed.example.com:5432/db",
    ]) {
      const cfg = buildOpsPoolConfig(dsn);
      expect(cfg.ssl !== false && cfg.ssl.rejectUnauthorized).toBe(true);
    }
  });

  it("describeDbTls is secret-free and accurate", () => {
    expect(describeDbTls(buildOpsPoolConfig("postgres://x:y@aws-1-eu-central-1.pooler.supabase.com:6543/p")))
      .toBe("verify-full (pinned Supabase CA)");
    expect(describeDbTls(buildOpsPoolConfig("postgres://x:y@localhost:5432/p"))).toBe("off (local)");
  });

  it("assertSecureDbTls throws for a remote host without verify-full", () => {
    // hand-build an insecure config to prove the guard fires
    expect(() => assertSecureDbTls({ connectionString: "postgres://u:p@aws-1-eu-central-1.pooler.supabase.com:6543/p", ssl: false }))
      .toThrow(/insecure_db_tls/);
    // secure configs pass
    expect(() => assertSecureDbTls(buildOpsPoolConfig("postgres://u:p@aws-1-eu-central-1.pooler.supabase.com:6543/p"))).not.toThrow();
    expect(() => assertSecureDbTls(buildOpsPoolConfig("postgres://u:p@localhost:5432/p"))).not.toThrow();
  });
});
