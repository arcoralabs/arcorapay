// Run with: pnpm --filter arcora-relayer exec vitest run vault-signer.test.ts
//
// Architecture: V10 Vault signer fetches the relayer privkey from KV-v2 at
// boot via AppRole, then uses viem's privateKeyToAccount in-process. No
// transit signing, no community plugin trust. (See `ops/vault/README.md`.)
//
// Integration tests require a local Vault dev-mode instance and KV-v2 secret.
// Skipped unless VAULT_DEV=1.
//
//   vault server -dev -dev-root-token-id=root &
//   VAULT_ADDR=http://127.0.0.1:8200 VAULT_TOKEN=root vault secrets enable -path=secret kv-v2
//   vault kv put secret/relayer-test privateKey=0x<32-byte-hex>
//   vault auth enable approle
//   ... (see ops/vault/README.md for AppRole role + secret_id ceremony)

import { describe, it, expect, vi, beforeEach } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { vaultSigner } from "./vault-signer.js";

const enabled = process.env.VAULT_DEV === "1";
const itOnDev = enabled ? it : it.skip;

// ---------------------------------------------------------------------------
// Unit tests — fetch is mocked, no live Vault needed
// ---------------------------------------------------------------------------

describe("vaultSigner (unit, mocked fetch)", () => {
  const TEST_PRIV_KEY = "0x" + "ab".repeat(32);
  const expectedAddr = privateKeyToAccount(TEST_PRIV_KEY as `0x${string}`).address;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("logs in via AppRole, fetches the privkey from KV-v2, and returns a viem account", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ auth: { client_token: "s.fakeToken" } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { data: { privateKey: TEST_PRIV_KEY } } }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const account = await vaultSigner({
      vaultUrl: "http://127.0.0.1:8200",
      roleId:   "role-id",
      secretId: "secret-id",
      kvPath:   "secret/data/relayer-v10",
      kvField:  "privateKey",
    });

    expect(account.address.toLowerCase()).toBe(expectedAddr.toLowerCase());
    // first call is login, second is KV read
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/v1\/auth\/approle\/login$/);
    expect(fetchMock.mock.calls[1][0]).toMatch(/\/v1\/secret\/data\/relayer-v10$/);
    // KV read carries the AppRole-issued token
    expect((fetchMock.mock.calls[1][1] as { headers: Record<string, string> }).headers["X-Vault-Token"])
      .toBe("s.fakeToken");
  });

  // Audit 2026-06-11: plaintext-HTTP guard — the AppRole secret_id and the
  // fetched private key must never transit a network unencrypted.
  it("refuses plaintext HTTP to a non-loopback Vault before any request is sent", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(vaultSigner({
      vaultUrl: "http://vault.internal:8200",
      roleId:   "role-id",
      secretId: "secret-id",
      kvPath:   "secret/data/relayer-v10",
      kvField:  "privateKey",
    })).rejects.toThrow(/refusing plaintext HTTP to non-loopback Vault \(vault\.internal\)/);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows plaintext HTTP to localhost (loopback same-box Vault)", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ auth: { client_token: "s.fakeToken" } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { data: { privateKey: TEST_PRIV_KEY } } }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const account = await vaultSigner({
      vaultUrl: "http://localhost:8200",
      roleId:   "role-id",
      secretId: "secret-id",
      kvPath:   "secret/data/relayer-v10",
      kvField:  "privateKey",
    });
    expect(account.address.toLowerCase()).toBe(expectedAddr.toLowerCase());
  });

  // http://127.0.0.1 staying allowed is exercised by every other unit test in
  // this file (they all use vaultUrl http://127.0.0.1:8200).
  it("allows https to a non-loopback Vault", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ auth: { client_token: "s.fakeToken" } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { data: { privateKey: TEST_PRIV_KEY } } }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const account = await vaultSigner({
      vaultUrl: "https://vault.internal:8200",
      roleId:   "role-id",
      secretId: "secret-id",
      kvPath:   "secret/data/relayer-v10",
      kvField:  "privateKey",
    });
    expect(account.address.toLowerCase()).toBe(expectedAddr.toLowerCase());
    expect(fetchMock.mock.calls[0][0]).toMatch(/^https:\/\/vault\.internal:8200/);
  });

  it("throws when login returns non-200", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: async () => "permission denied",
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(vaultSigner({
      vaultUrl: "http://127.0.0.1:8200",
      roleId:   "bad",
      secretId: "bad",
      kvPath:   "secret/data/relayer-v10",
      kvField:  "privateKey",
    })).rejects.toThrow(/Vault login failed/);
  });

  // Audit 2026-05-24 H-1
  it("does not leak the Vault error body into Error.message on login failure", async () => {
    // Vault's login error body can reference the supplied secret_id (e.g.
    // "secret_id expired"). The thrown Error must surface only the status
    // code so the body never lands in node crash dumps / journald.
    const sensitiveBody = "1*-error 1 error occurred * invalid secret id";
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => sensitiveBody,
    });
    vi.stubGlobal("fetch", fetchMock);
    // Suppress the structured stderr log this path emits.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(vaultSigner({
      vaultUrl: "http://127.0.0.1:8200",
      roleId:   "role-id",
      secretId: "the-leaky-secret-id",
      kvPath:   "secret/data/relayer-v10",
      kvField:  "privateKey",
    })).rejects.toThrow(/^Vault login failed: 400$/);

    // Structured log captures body for operator forensics — but separately.
    expect(errSpy).toHaveBeenCalled();
    const logLine = errSpy.mock.calls[0]![0] as string;
    expect(logLine).toContain("vault.login_fail");
    expect(logLine).toContain(sensitiveBody);
  });

  // Audit 2026-05-31 L-12
  it("redacts the secret_id out of the structured Vault error log", async () => {
    const leakySecret = "s.AAAA-BBBB-CCCC-the-actual-secret-id";
    const body = `invalid secret_id ${leakySecret}: expired`;
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => body,
    });
    vi.stubGlobal("fetch", fetchMock);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(vaultSigner({
      vaultUrl: "http://127.0.0.1:8200",
      roleId:   "role-id",
      secretId: leakySecret,
      kvPath:   "secret/data/relayer-v10",
      kvField:  "privateKey",
    })).rejects.toThrow(/^Vault login failed: 400$/);

    const logLine = errSpy.mock.calls[0]![0] as string;
    expect(logLine).toContain("vault.login_fail");
    expect(logLine).not.toContain(leakySecret);
    expect(logLine).toContain("[redacted-secret_id]");
  });

  // Audit 2026-05-31 L-12
  it("caps the logged Vault error body length", async () => {
    const huge = "x".repeat(5000);
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => huge,
    });
    vi.stubGlobal("fetch", fetchMock);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(vaultSigner({
      vaultUrl: "http://127.0.0.1:8200",
      roleId:   "role-id",
      secretId: "secret-id",
      kvPath:   "secret/data/relayer-v10",
      kvField:  "privateKey",
    })).rejects.toThrow(/^Vault login failed: 500$/);

    const logLine = errSpy.mock.calls[0]![0] as string;
    expect(logLine).toContain("[truncated]");
    expect(logLine).not.toContain(huge);
  });

  // Audit 2026-05-24 H-1
  it("does not leak the Vault error body into Error.message on KV-read failure", async () => {
    const sensitiveBody = "permission denied — token does not have policy 'relayer-read'";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ auth: { client_token: "s.fakeToken" } }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: async () => sensitiveBody,
      });
    vi.stubGlobal("fetch", fetchMock);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(vaultSigner({
      vaultUrl: "http://127.0.0.1:8200",
      roleId:   "role-id",
      secretId: "secret-id",
      kvPath:   "secret/data/relayer-v10",
      kvField:  "privateKey",
    })).rejects.toThrow(/^Vault KV read failed: 403$/);

    expect(errSpy).toHaveBeenCalled();
    const logLine = errSpy.mock.calls[0]![0] as string;
    expect(logLine).toContain("vault.kv_read_fail");
    expect(logLine).toContain(sensitiveBody);
  });

  it("throws when KV secret has no privateKey field", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ auth: { client_token: "s.fakeToken" } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { data: { somethingElse: "x" } } }),
      });
    vi.stubGlobal("fetch", fetchMock);

    await expect(vaultSigner({
      vaultUrl: "http://127.0.0.1:8200",
      roleId:   "role-id",
      secretId: "secret-id",
      kvPath:   "secret/data/relayer-v10",
      kvField:  "privateKey",
    })).rejects.toThrow(/has no field 'privateKey'/);
  });

  it("throws when the KV value is not a 32-byte hex private key", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ auth: { client_token: "s.fakeToken" } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { data: { privateKey: "not-a-hex-key" } } }),
      });
    vi.stubGlobal("fetch", fetchMock);

    await expect(vaultSigner({
      vaultUrl: "http://127.0.0.1:8200",
      roleId:   "role-id",
      secretId: "secret-id",
      kvPath:   "secret/data/relayer-v10",
      kvField:  "privateKey",
    })).rejects.toThrow(/not a 32-byte hex private key/);
  });
});

// ---------------------------------------------------------------------------
// Integration tests — require VAULT_DEV=1
// ---------------------------------------------------------------------------

describe("vaultSigner (integration — skipped without VAULT_DEV=1)", () => {
  itOnDev("fetches a real KV secret and produces a working signer", async () => {
    const account = await vaultSigner({
      vaultUrl: "http://127.0.0.1:8200",
      roleId:   process.env.TEST_VAULT_ROLE_ID!,
      secretId: process.env.TEST_VAULT_SECRET_ID!,
      kvPath:   process.env.TEST_VAULT_KV_PATH ?? "secret/data/relayer-test",
      kvField:  process.env.TEST_VAULT_KV_FIELD ?? "privateKey",
    });
    expect(account.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });
});
