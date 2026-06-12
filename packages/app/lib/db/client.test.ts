import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { buildPoolConfig } from "./client";
import { SUPABASE_CA } from "./supabase-ca";

const ORIGINAL_URL = process.env.POSTGRES_URL;

describe("buildPoolConfig", () => {
  beforeEach(() => {
    delete process.env.POSTGRES_URL;
  });
  afterEach(() => {
    if (ORIGINAL_URL === undefined) delete process.env.POSTGRES_URL;
    else process.env.POSTGRES_URL = ORIGINAL_URL;
  });

  it("returns no config when POSTGRES_URL is unset", () => {
    expect(buildPoolConfig()).toEqual({});
  });

  it("disables SSL for a local URL with no sslmode (plain Postgres)", () => {
    process.env.POSTGRES_URL = "postgres://postgres:postgres@localhost:5432/arcfx";
    const cfg = buildPoolConfig();
    expect(cfg.connectionString).toBe("postgres://postgres:postgres@localhost:5432/arcfx");
    expect(cfg.ssl).toBe(false);
  });

  it("disables SSL when sslmode=disable is explicit", () => {
    process.env.POSTGRES_URL = "postgres://u:p@localhost:5432/db?sslmode=disable";
    const cfg = buildPoolConfig();
    expect(cfg.ssl).toBe(false);
    // sslmode stripped so it can't override our explicit ssl option
    expect(cfg.connectionString).not.toContain("sslmode");
  });

  it("pins the Supabase CA + verify-full for the pooler host (AFG-011)", () => {
    process.env.POSTGRES_URL =
      "postgres://postgres:pw@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?sslmode=require";
    const cfg = buildPoolConfig();
    // No longer rejectUnauthorized:false — we pin the CA and fully verify.
    expect(cfg.ssl).toEqual({ ca: SUPABASE_CA, rejectUnauthorized: true });
    // sslmode stripped — see comment in client.ts
    expect(cfg.connectionString).not.toContain("sslmode");
    expect(cfg.connectionString).toContain("aws-0-eu-central-1.pooler.supabase.com");
  });

  it("FULLY verifies TLS for any non-pooler host (M-2 — no silent MITM)", () => {
    process.env.POSTGRES_URL = "postgres://u:p@db.example.com:5432/db?sslmode=verify-full";
    expect(buildPoolConfig().ssl).toEqual({ rejectUnauthorized: true });
  });

  it("FULLY verifies TLS for sslmode=require on a non-pooler host", () => {
    process.env.POSTGRES_URL = "postgres://u:p@some-managed-pg.aws.com:5432/db?sslmode=require";
    expect(buildPoolConfig().ssl).toEqual({ rejectUnauthorized: true });
  });

  it("falls back to the raw URL when the connection string isn't a valid URL", () => {
    // Pool() will surface the eventual parse error; we just don't crash here.
    process.env.POSTGRES_URL = "not a url";
    const cfg = buildPoolConfig();
    expect(cfg.connectionString).toBe("not a url");
    expect(cfg.ssl).toBeUndefined();
  });
});
