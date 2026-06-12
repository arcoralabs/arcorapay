#!/usr/bin/env bash
# Daily rotation: mint a fresh AppRole secret_id, update the relayer env
# file atomically, signal-reload the relayer service.
set -euo pipefail

: "${VAULT_ADDR:=http://127.0.0.1:8200}"
: "${VAULT_TOKEN:?VAULT_TOKEN must be set (long-lived rotation operator token)}"

# jq does the JSON field extraction below (the old sed -n parsing broke on
# key reordering / escaped quotes); refuse to run without it.
if ! command -v jq >/dev/null 2>&1; then
  echo "[rotation] ERROR: jq is required but not installed" >&2
  exit 7
fi

# Must match `EnvironmentFile=` in ops/relayer/arcora-relayer.service.
ENV_FILE="/opt/arcora-ops/relayer/.env"
ENV_DIR="$(dirname "$ENV_FILE")"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "[rotation] ERROR: $ENV_FILE does not exist — fix the service env layout first" >&2
  exit 1
fi

# Audit Ops-M-3 (2026-05-31): verify-before-commit. To prove the new secret_id
# can authenticate BEFORE we overwrite the working one, we need the role_id the
# daemon logs in with — same env file.
ROLE_ID=$(grep -E '^VAULT_ROLE_ID=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"' | xargs)
if [[ -z "$ROLE_ID" ]]; then
  echo "[rotation] ERROR: VAULT_ROLE_ID not found in $ENV_FILE — cannot pre-verify the new secret_id" >&2
  exit 4
fi

# The pre-commit test login below consumes one use of the new secret_id, so
# verify-before-commit only holds if uses aren't capped at 1. Require unlimited
# uses within TTL (secret_id_num_uses=0) — a capped role is itself the
# AppRole-lockout class this fix exists to prevent.
ROLE_USES=$(vault read -format=json auth/approle/role/relayer 2>/dev/null \
  | jq -r '.data.secret_id_num_uses')
if [[ "${ROLE_USES:-}" != "0" ]]; then
  echo "[rotation] ERROR: role secret_id_num_uses='${ROLE_USES:-unknown}'; verify-before-commit needs 0 (unlimited within TTL). Fix the role before rotating." >&2
  exit 6
fi

# Audit Ops-I-1 (2026-05-24): also pull the accessor for the new
# secret_id. We never log the secret_id itself (would defeat the purpose
# of rotation), but the accessor is a non-secret handle Vault writes to
# its audit log. Capturing it on rotation gives the operator a way to
# correlate the live secret_id with Vault's own audit trail without
# guessing at timestamps during an incident.
NEW_SECRET_BUNDLE=$(vault write -format=json -f auth/approle/role/relayer/secret-id)
NEW_SECRET_ID=$(echo "$NEW_SECRET_BUNDLE" | jq -r '.data.secret_id // empty')
NEW_ACCESSOR=$(echo "$NEW_SECRET_BUNDLE" | jq -r '.data.secret_id_accessor // "unknown"')

if [[ -z "$NEW_SECRET_ID" ]]; then
  echo "[rotation] ERROR: vault returned an empty secret_id — refusing to rewrite env" >&2
  exit 3
fi

# Audit Ops-M-3 (2026-05-31): PROVE the new secret_id authenticates BEFORE
# touching the working credential. A bad mint (clock skew, role change, Vault
# momentarily sealed, num_uses exhausted) must abort here with the old secret_id
# untouched — never destroy the one credential the daemon has. This is exactly
# the 2026-05-12 AppRole-lockout class of failure.
if ! vault write -format=json auth/approle/login \
      role_id="$ROLE_ID" secret_id="$NEW_SECRET_ID" >/dev/null 2>&1; then
  echo "[rotation] ERROR: new secret_id failed a pre-commit test login — aborting; existing credential left in place" >&2
  exit 5
fi

# Atomic env-file rewrite — mktemp in the same directory so the final mv stays
# on the same filesystem (rename is atomic only within a single fs).
TMP=$(mktemp "${ENV_DIR}/.relayer.env.XXXXXX")
trap 'rm -f "$TMP"' EXIT
grep -v '^VAULT_SECRET_ID=' "$ENV_FILE" > "$TMP"
echo "VAULT_SECRET_ID=$NEW_SECRET_ID" >> "$TMP"
chmod 0600 "$TMP"
chown root:root "$TMP"
mv -f "$TMP" "$ENV_FILE"

# `restart` (not `reload`): the service unit is Type=simple with no
# ExecReload, and the daemon only AppRole-logs in at boot — a hot reload
# wouldn't pick up the new VAULT_SECRET_ID anyway. Restart re-reads the
# EnvironmentFile and re-authenticates. 2026-05-13 prod incident: the
# `reload` call failed with "Job type reload is not applicable", the script
# exited under `set -e` before the is-active check, and the env was updated
# but the daemon kept crashing with the stale credentials.
# Capture the journal cursor so we only inspect lines emitted AFTER this
# restart, then restart.
CURSOR=$(journalctl -u arcora-relayer.service -n0 --show-cursor -o cat 2>/dev/null | sed -n 's/^-- cursor: //p')
systemctl restart arcora-relayer.service

# Audit Ops-M-3 (2026-05-31): synchronously confirm the daemon re-authenticated
# instead of a blind `sleep 5` + is-active. `relayer.start` is logged only AFTER
# the AppRole login + KV fetch succeed, so seeing it post-restart proves the new
# secret_id works end-to-end inside the daemon, not just in the pre-commit test
# login above (closes the is-active-true-then-crash race the freshness monitor
# would otherwise miss for ~25h).
started=""
for _ in $(seq 1 15); do
  sleep 1
  if [[ -n "$CURSOR" ]]; then
    JLINES=$(journalctl -u arcora-relayer.service --after-cursor "$CURSOR" -o cat 2>/dev/null)
  else
    JLINES=$(journalctl -u arcora-relayer.service --since "20 seconds ago" -o cat 2>/dev/null)
  fi
  if grep -q 'relayer.start' <<<"$JLINES"; then started=1; break; fi
done
if [[ -z "$started" ]]; then
  echo "[rotation] ERROR: relayer did not emit relayer.start within 15s of restart — new secret_id may not have authenticated inside the daemon" >&2
  exit 2
fi
if ! systemctl is-active --quiet arcora-relayer.service; then
  echo "[rotation] ERROR: arcora-relayer is not active after restart" >&2
  exit 2
fi

# Audit Ops-M4 (2026-05-24): structured success line. /etc/cron.d redirects
# the script's stdout/stderr to /var/log/vault-rotation.log; this line is
# what the freshness monitor below greps for. The accessor is logged
# alongside the timestamp so an operator can cross-reference with Vault's
# audit log during an incident without having to guess.
echo "[rotation] $(date -Iseconds) ok accessor=${NEW_ACCESSOR:-unknown}"
