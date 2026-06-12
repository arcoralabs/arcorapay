import { privateKeyToAccount } from "viem/accounts";
import type { Hex, LocalAccount } from "viem";

export interface VaultSignerOpts {
  vaultUrl:  string;   // e.g. http://127.0.0.1:8200
  roleId:    string;   // VAULT_ROLE_ID — long-lived
  secretId:  string;   // VAULT_SECRET_ID — rotated daily by ops/vault/secret-id-rotation.sh
  kvPath:    string;   // KV-v2 path, e.g. "secret/data/relayer-v10" (note: KV-v2 "data" prefix)
  kvField:   string;   // field within the secret, e.g. "privateKey"
}

/**
 * V10 relayer key isolation via Vault KV-v2 + AppRole.
 *
 * The relayer's private key lives in Vault's KV-v2 secret store (encrypted at
 * rest with Vault's master key). At boot, the relayer process AppRole-logs in,
 * fetches the key once, and uses viem's `privateKeyToAccount` for in-process
 * signing.
 *
 * Honest M1 partial-closure scope:
 *   - encrypted at rest in Vault (no plaintext in /etc/arcora/*.env)
 *   - access gated by AppRole secret_id rotated daily
 *   - every read audit-logged by Vault for forensic reconstruction
 *   - key still in relayer process memory after fetch (mitigated by short-lived
 *     process restarts on env-file rewrite; no key rotation needed mid-process)
 *
 * Plan 11 (mainnet T-0) will move to a signing-isolated HSM (AWS KMS Cloud HSM
 * or a vetted Vault transit secp256k1 plugin) where the key never leaves the
 * HSM boundary.
 */
export async function vaultSigner(opts: VaultSignerOpts): Promise<LocalAccount> {
  const privateKey = await fetchPrivateKeyFromVault(opts);
  return privateKeyToAccount(privateKey);
}

/**
 * Fetch the raw 32-byte hex private key from Vault KV-v2.
 *
 * Use this when an external library (like Circle's AppKit
 * `createViemAdapterFromPrivateKey`) requires a raw key and cannot accept a
 * viem `LocalAccount`. The returned key lives in process memory only —
 * never log, never persist to disk.
 */
export async function fetchPrivateKeyFromVault(opts: VaultSignerOpts): Promise<Hex> {
  assertVaultUrlSafe(opts.vaultUrl);
  const token = await login(opts);
  return fetchPrivateKey(opts.vaultUrl, token, opts.kvPath, opts.kvField);
}

// Audit 2026-06-11: refuse plaintext HTTP to any non-loopback Vault — the
// AppRole secret_id (request body) and the returned private key would
// transit the network unencrypted. Loopback (127.0.0.1 / localhost) stays
// allowed for the current same-box deployment and dev-mode Vault.
//
// TLS trust note: this module uses the global `fetch` (Node/undici), which
// has no per-request CA-bundle option — wiring a `caCertPath`/VAULT_CACERT
// opt would require swapping to a custom undici Agent. When Vault moves to
// https with a self-signed/private CA (including https on loopback), trust
// the CA process-wide via NODE_EXTRA_CA_CERTS=/path/to/vault-ca.pem in the
// systemd unit's Environment= — https URLs then work with no code change.
function assertVaultUrlSafe(vaultUrl: string): void {
  const u = new URL(vaultUrl);
  if (u.protocol === "http:" && u.hostname !== "127.0.0.1" && u.hostname !== "localhost") {
    throw new Error(`vault-signer: refusing plaintext HTTP to non-loopback Vault (${u.hostname}); use https`);
  }
}

// Audit 2026-05-24 H-1: Vault error response bodies can reference the
// supplied secret_id (e.g. "secret_id expired" / "invalid secret_id"). When
// the body was interpolated into Error.message, it ended up in node crash
// dumps and journald via the top-level catch in run.ts. We now read the
// body for operator visibility (structured `vault.*_fail` log) but throw a
// status-only message so it never leaks into stack traces.
//
// Audit 2026-05-31 L-12: even the structured log wrote the body verbatim and
// unbounded — on a shared, root-readable VPS journald that is still a leak if
// Vault ever echoes the secret_id. Mask any occurrence of the live secret_id
// and cap the length before logging.
const MAX_VAULT_BODY_LOG = 512;
function redactAndCap(body: string, secret?: string): string {
  let out = body;
  if (secret && secret.length >= 6) out = out.split(secret).join("[redacted-secret_id]");
  return out.length > MAX_VAULT_BODY_LOG ? `${out.slice(0, MAX_VAULT_BODY_LOG)}…[truncated]` : out;
}

function logVaultError(stage: "login" | "kv_read", status: number, body: string, secret?: string): void {
  // eslint-disable-next-line no-console
  console.error(JSON.stringify({ msg: `vault.${stage}_fail`, status, body: redactAndCap(body, secret) }));
}

async function login(opts: VaultSignerOpts): Promise<string> {
  const res = await fetch(`${opts.vaultUrl}/v1/auth/approle/login`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ role_id: opts.roleId, secret_id: opts.secretId }),
  });
  if (!res.ok) {
    logVaultError("login", res.status, await res.text(), opts.secretId);
    throw new Error(`Vault login failed: ${res.status}`);
  }
  const json = await res.json() as { auth: { client_token: string } };
  return json.auth.client_token;
}

async function fetchPrivateKey(
  vaultUrl: string,
  token:    string,
  kvPath:   string,
  kvField:  string,
): Promise<Hex> {
  const res = await fetch(`${vaultUrl}/v1/${kvPath}`, {
    headers: { "X-Vault-Token": token },
  });
  if (!res.ok) {
    logVaultError("kv_read", res.status, await res.text());
    throw new Error(`Vault KV read failed: ${res.status}`);
  }
  const json = await res.json() as { data: { data: Record<string, string> } };
  const raw = json.data?.data?.[kvField];
  if (!raw) throw new Error(`Vault KV secret '${kvPath}' has no field '${kvField}'`);
  const hex = raw.startsWith("0x") ? raw : `0x${raw}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("Vault KV secret is not a 32-byte hex private key");
  }
  return hex as Hex;
}
