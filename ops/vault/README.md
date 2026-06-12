# Vault setup for Arcora relayer (V10)

The V10 relayer's private key lives in Vault's KV-v2 secret store, encrypted
at rest by Vault's master key. At boot, the relayer process AppRole-logs in,
fetches the key once via the transit-less KV API, and uses viem's
`privateKeyToAccount` for in-process signing.

**Why KV and not transit-sign:** Vault's native `transit` engine only supports
ECDSA on P-256/384/521, not secp256k1. Ethereum signing therefore requires
either a community plugin (third-party trust) or in-process signing. We chose
KV-v2 + AppRole — encrypted at rest, audit-logged, AppRole-gated — without
introducing unaudited plugin trust. Plan 11 (mainnet T-0) moves to a real
HSM with signing isolation (AWS KMS Cloud HSM or vetted secp256k1 plugin).

**Audit M1 closure scope (partial):**
- ✓ encrypted at rest in Vault (no plaintext on disk)
- ✓ AppRole-gated access; `secret_id` rotated daily
- ✓ every read audit-logged for forensic reconstruction
- ✗ key still lives in relayer process memory after fetch

## One-time setup (run on the VPS as root)

```bash
sudo bash ops/vault/install.sh
```

Then, interactively in an SSH session:

```bash
export VAULT_ADDR=http://127.0.0.1:8200

# 1. Init — save the 3 unseal keys offline, distributed across holders
#    (custody arrangement is documented in the private operator runbook).
vault operator init -key-shares=3 -key-threshold=2

# 2. Unseal — twice, with two of the three keys.
vault operator unseal <key1>
vault operator unseal <key2>

# 3. Authenticate as root (one-time; we mint a permanent admin token next).
vault login <root-token>

# 4. Enable the KV-v2 secrets engine at the default path.
vault secrets enable -version=2 -path=secret kv

# 5. Write the relayer private key. Use a fresh secp256k1 keypair generated
#    via `cast wallet new` locally (don't reuse the V9 relayer key — V10 is
#    a fresh deployment, fresh role assignment).
vault kv put secret/relayer-v10 privateKey=0x<32-byte-hex>

# 6. Apply the relayer policy (read-only on the KV path, login on AppRole).
vault policy write relayer /etc/vault.d/policy-relayer.hcl

# 7. Enable AppRole auth + create the relayer role.
vault auth enable approle
vault write auth/approle/role/relayer \
  secret_id_ttl=24h \
  token_ttl=2h \
  token_max_ttl=2h \
  policies=relayer

# 8. Mint role_id (long-lived) + first secret_id.
ROLE_ID=$(vault read -field=role_id auth/approle/role/relayer/role-id)
SECRET_ID=$(vault write -field=secret_id -f auth/approle/role/relayer/secret-id)

# 9. Mint a long-lived ops token for the rotation cron (separate from root).
#    Policy `approle-rotator` must be created first — it can mint secret_ids
#    for the relayer role but cannot read KV secrets.
cat > /tmp/rotator.hcl <<'HCL'
path "auth/approle/role/relayer/secret-id" { capabilities = ["update"] }
HCL
vault policy write approle-rotator /tmp/rotator.hcl
vault token create -policy=approle-rotator -ttl=8760h -orphan -field=token > <root-only token file>
chmod 600 <root-only token file>

# 10. Wire the rotation cron (root user crontab, NOT /etc/cron.d).
# Production: rotation runs from root's crontab so the VAULT_TOKEN env
# can be sourced from a scoped, root-only operator token file. The
# production layout (audit 2026-05-24 follow-up) is:
#
#   - script: a root-only copy of ops/vault/secret-id-rotation.sh, synced
#     from the repo on each change
#   - token : a root-only operator token file (chmod 600, scoped policy in
#     policy-rotation-operator.hcl — only allowed grant is
#     `update auth/approle/role/relayer/secret-id`)
#   - log   : a root-only rotation log
#
crontab -e
# Add a daily entry that sources VAULT_ADDR + the scoped operator token,
# runs the rotation script, and appends to the rotation log, e.g.:
# <schedule> VAULT_ADDR=http://127.0.0.1:8200 VAULT_TOKEN=$(cat <operator-token-file>) <rotation-script> >> <rotation-log> 2>&1

# 11. Wire the rotation freshness check (audit Ops-M4, 2026-05-24).
# Runs on a recurring schedule; exits 1 if no successful rotation within the
# secret-id TTL window. The cron MAILTO surfaces failures so a silent
# rotation outage (the 2026-05-12 root cause) can't recur. VAULT_ROTATION_LOG
# points at the log written by the cron above; the script accepts both the
# new "ok" line and the legacy "new secret_id rotated" line so this check can
# roll out without backfilling the log.
cat > /etc/cron.d/vault-rotation-health <<EOF
SHELL=/bin/bash
MAILTO=root
VAULT_ROTATION_LOG=<rotation-log>
<schedule> root <vault-rotation-health-script>
EOF
```

> **No MTA on the box → also wire ntfy.sh push alerts.** Cron `MAILTO` is
> discarded (no mail transfer agent). `vault-rotation-health.sh` honours the
> optional `ARCORA_NTFY_TOPIC` knob: when set, the freshness-FAIL path pushes
> the CRITICAL line to `https://ntfy.sh/<topic>` best-effort (the check only
> ever emits the rotation log's freshness — never a Vault secret). Add the env
> line to the cron file above (it can share the same secret topic as
> `arcora-health`). See `ops/health/README.md` for the full knob/subscribe
> docs and the rule that the topic name is a SECRET kept only in `/etc/cron.d`,
> never committed:
>
> ```
> ARCORA_NTFY_TOPIC=arcora-ops-xxxxxxxxxxxx
> ```

## What goes in the relayer .env file

```
VAULT_URL=http://127.0.0.1:8200
VAULT_ROLE_ID=<step 8 ROLE_ID>
VAULT_SECRET_ID=<step 8 SECRET_ID — rotated daily>
VAULT_KV_PATH=secret/data/relayer-v10
VAULT_KV_FIELD=privateKey
GATEWAY_ADDRESS=<from forge deploy>
ARC_TESTNET_RPC=https://rpc.testnet.arc.network
POSTGRES_URL_NON_POOLING=postgresql://…
KIT_KEY=KIT_KEY:...
```

The relayer derives both the viem `LocalAccount` and the App Kit adapter
from the single Vault-fetched private key — no separate
`RELAYER_ADAPTER_KEY` env var (audit Ops-I-4, 2026-05-24: the stale
"FIXME: AppKit kit.swap still requires raw key" comment that used to
sit here documented a pre-V10 dual-key arrangement that the daemon no
longer uses).

## Disaster recovery

See the private operator runbook.
