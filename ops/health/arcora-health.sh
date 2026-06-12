#!/usr/bin/env bash
# Public-beta launch Task 3 (2026-06-10): single health cron for the Arcora
# testnet stack. Mirrors the ops/vault/vault-rotation-health.sh pattern —
# quiet when healthy, loud + non-zero exit on failure so the cron MAILTO
# surfaces it to operators.
#
# Checks, in order:
#   1. systemd units active: arcora-indexer, arcora-relayer, arcora-webhooks,
#      vault (override list via ARCORA_UNITS for testing).
#   2. relayer queue age: oldest relayer_queue row still in a non-terminal
#      status ('pending' | 'processing') older than QUEUE_MAX_AGE_SECONDS
#      (default 900s = 15 min) → FAIL. Uses the same DSN the relayer daemon
#      uses (POSTGRES_URL_NON_POOLING from its EnvironmentFile) and connects
#      verify-full against the pinned Supabase CA (AFG-011 posture) by
#      extracting the PEM from the relayer's supabase-ca.ts.
#      Note: crosschain_payments is deliberately NOT age-checked here — its
#      attestation-poll states are legitimately long-lived (up to
#      CROSSCHAIN_ATTESTATION_DEADLINE_MS, default 2 h).
#   3. app health endpoint GET $APP_HEALTH_URL (default
#      https://arcorapay.xyz/api/health): 200 → OK; 404 → WARN while the
#      endpoint is not yet deployed (flip via ARCORA_APP_404=fail after the
#      app deploy lands — see ops/health/README.md); anything else → FAIL.
#
# Output contract (cron MAILTO hygiene, same as vault-rotation-health.sh):
#   - all checks OK, or OK + the known 404 WARN → no output, exit 0
#     (no mail every 10 minutes for a condition we already know about).
#   - any FAIL → every check line is printed (including WARNs) and the
#     script exits 1, so the mail contains the full picture.
#   - ARCORA_HEALTH_VERBOSE=1 prints all check lines even when healthy
#     (for manual runs).
#
# Install (mirror the vault-rotation-health cron pattern):
#   cp ops/health/arcora-health.sh /root/arcora-ops/health/
#   cat > /etc/cron.d/arcora-health <<EOF
#   SHELL=/bin/bash
#   MAILTO=root
#   */10 * * * * root flock -n /run/arcora-health.lock /root/arcora-ops/health/arcora-health.sh
#   EOF
set -euo pipefail

UNITS=${ARCORA_UNITS:-"arcora-indexer arcora-relayer arcora-webhooks vault"}
RELAYER_DIR=${ARCORA_RELAYER_DIR:-/opt/arcora-ops/relayer}
RELAYER_ENV_FILE=${ARCORA_RELAYER_ENV_FILE:-$RELAYER_DIR/.env}
QUEUE_MAX_AGE_SECONDS=${ARCORA_QUEUE_MAX_AGE_SECONDS:-900}
APP_HEALTH_URL=${ARCORA_APP_HEALTH_URL:-https://arcorapay.xyz/api/health}
# TODO(Task 10): flip the default to "fail" once /api/health is deployed.
APP_404=${ARCORA_APP_404:-warn}
VERBOSE=${ARCORA_HEALTH_VERBOSE:-0}
# Optional ntfy.sh push alerting. When ARCORA_NTFY_TOPIC is non-empty, the
# failure paths below POST the same body that goes to stdout/stderr to
# https://ntfy.sh/<topic> as a best-effort side channel — the box has no MTA
# so cron MAILTO is discarded. The topic name is a SECRET (kept only in
# /etc/cron.d on the box, never committed); see ops/health/README.md.
NTFY_TOPIC=${ARCORA_NTFY_TOPIC:-}
# The topic is interpolated into the ntfy.sh URL below — reject anything
# outside the safe charset before it can reshape the request (audit
# 2026-06-11). Hard exit 2: a malformed secret is an install error, not a
# health finding, so it must not flow into the normal fail/ntfy path.
if [[ -n "${ARCORA_NTFY_TOPIC:-}" && ! "$ARCORA_NTFY_TOPIC" =~ ^[A-Za-z0-9_-]+$ ]]; then
  echo "[health] FAIL: ARCORA_NTFY_TOPIC contains unexpected characters" >&2
  exit 2
fi

# Best-effort push to ntfy.sh. Never fails the script (|| true), capped at
# 10s, no-op when the knob is empty. $1 is the alert body (already DSN-redacted
# by the callers — the script never echoes a DSN verbatim).
ntfy_push() {
  [[ -z "$NTFY_TOPIC" ]] && return 0
  local alert_body="$1"
  curl -s --max-time 10 \
    -H "Title: Arcorapay health FAIL ($(hostname))" \
    -H "Priority: high" \
    -H "Tags: rotating_light" \
    --data-binary "$alert_body" \
    "https://ntfy.sh/${NTFY_TOPIC}" >/dev/null 2>&1 || true
}

RESULTS=()
FAILS=0
CA_FILE=""   # script-scoped so the EXIT trap (global scope) can clean it up
ok()   { RESULTS+=("[health] OK:   $1"); }
warn() { RESULTS+=("[health] WARN: $1"); }
fail() { RESULTS+=("[health] FAIL: $1"); FAILS=$((FAILS + 1)); }

# Belt-and-suspenders: under `set -euo pipefail` any unexpected non-zero
# (an unguarded command, a missing var) would otherwise abort the script
# silently. Flush whatever we've gathered so far and emit a CRITICAL line to
# stderr so the cron MAILTO surfaces the abort instead of mailing nothing.
on_err() {
  local rc=$?
  local critical="[health] CRITICAL: script aborted unexpectedly (exit $rc) on $(hostname) at $(date -Iseconds)"
  if ((${#RESULTS[@]})); then printf '%s\n' "${RESULTS[@]}" >&2; fi
  echo "$critical" >&2
  # Push the same picture (accumulated check lines + the CRITICAL footer) to
  # ntfy.sh. Built into a local so stdout/stderr and the push stay identical.
  local alert_body
  if ((${#RESULTS[@]})); then
    alert_body=$(printf '%s\n' "${RESULTS[@]}"; printf '%s\n' "$critical")
  else
    alert_body="$critical"
  fi
  ntfy_push "$alert_body"
  exit "$rc"
}
trap on_err ERR

# ── 1. systemd units ─────────────────────────────────────────────────
for u in $UNITS; do
  state=$(systemctl is-active "$u" 2>&1 || true)
  if [[ "$state" == "active" ]]; then
    ok "unit $u active"
  else
    fail "unit $u is '$state' (expected active)"
  fi
done

# ── 2. relayer queue age ─────────────────────────────────────────────
# Non-terminal relayer_queue statuses are 'pending' and 'processing'
# ('settled' | 'refunded' | 'failed' are terminal — see
# packages/app/lib/db/schema.ts relayerQueueStatus). Age is measured from
# created_at: with RELAYER_MAX_ATTEMPTS=3 and an 8-min processing lease, no
# row should legitimately stay non-terminal past 15 min — whether the cause
# is a dead daemon or a crash/retry loop, the operator wants to know.
queue_check() {
  if [[ ! -f "$RELAYER_ENV_FILE" ]]; then
    fail "queue: relayer env file $RELAYER_ENV_FILE not found"
    return
  fi
  local dsn
  dsn=$(grep -E '^POSTGRES_URL_NON_POOLING=' "$RELAYER_ENV_FILE" | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' || true)
  if [[ -z "$dsn" ]]; then
    fail "queue: POSTGRES_URL_NON_POOLING not set in $RELAYER_ENV_FILE"
    return
  fi
  # Sanity-gate the value before handing it to psql: anything that isn't a
  # postgres URL (a mangled env line, a stray flag) must not become a psql
  # argument (audit 2026-06-11). Never echo the value itself — it's a secret.
  if [[ "$dsn" != postgresql://* && "$dsn" != postgres://* ]]; then
    fail "queue: POSTGRES_URL_NON_POOLING in $RELAYER_ENV_FILE is not a postgresql:// or postgres:// DSN — refusing to pass it to psql"
    return
  fi

  # AFG-011 posture: verify-full against the pinned Supabase CA. The PEM is
  # extracted from the relayer's own supabase-ca.ts (single source of truth
  # on the box) into a private temp file. If extraction fails the check
  # FAILs and refuses to run the queue query — no sslmode=require downgrade
  # (encrypted-but-unverified TLS; audit 2026-06-11).
  local sslmode="verify-full" ca_file=""
  local ca_ts="$RELAYER_DIR/supabase-ca.ts"
  if [[ -f "$ca_ts" ]]; then
    ca_file=$(mktemp)
    # Register cleanup immediately so the temp file is removed on any exit
    # path (normal, error trap, or the empty-extraction fallback below).
    CA_FILE="$ca_file"
    trap 'rm -f "${CA_FILE:-}"' EXIT
    chmod 600 "$ca_file"
    grep -o '"-----BEGIN CERTIFICATE-----.*-----END CERTIFICATE-----\\n"' "$ca_ts" \
      | sed -e 's/^"//' -e 's/"$//' \
      | { IFS= read -r escaped && printf '%b' "$escaped"; } > "$ca_file" || true
  fi
  if [[ ! -s "${ca_file:-/nonexistent}" ]]; then
    # Audit 2026-06-11: this used to WARN and downgrade to sslmode=require
    # (encrypted but UNVERIFIED — a MITM with any cert passes). The queue
    # query carries the DSN's credentials, so refuse to run it over
    # unverified TLS and fail loudly instead.
    fail "queue: could not extract Supabase CA from $ca_ts — refusing to run the queue query over unverified TLS (sslmode=require downgrade removed)"
    # Marker file kept for the README's tooling: its presence means the most
    # recent run could not establish verify-full.
    touch /run/arcora-health-tls-degraded 2>/dev/null || true
    return
  fi
  # verify-full is in effect — clear any stale degraded marker so the file's
  # presence always reflects the most recent run.
  rm -f /run/arcora-health-tls-degraded 2>/dev/null || true

  local sql="select coalesce(extract(epoch from (now() - min(created_at)))::int, 0)
             from relayer_queue where status in ('pending','processing')"
  local age rc=0
  # `env` (not bare prefix assignments): the PGSSLROOTCERT word comes from a
  # parameter expansion, which bash would otherwise parse as a command name.
  # `timeout 30` caps a hung connection so a stuck psql can't pile up across
  # overlapping cron runs (flock in the cron line is the other half of this).
  age=$(timeout 30 env PGCONNECT_TIMEOUT=10 PGSSLMODE="$sslmode" ${ca_file:+"PGSSLROOTCERT=$ca_file"} \
        psql "$dsn" -tAc "$sql" 2>&1) || rc=$?
  # Temp CA file is cleaned up by the EXIT trap (registered at mktemp time).

  if [[ $rc -ne 0 ]]; then
    # psql error text can embed the DSN on some failure modes — keep the
    # message generic and never echo $age (which holds stderr) verbatim
    # beyond the first sanitized line.
    fail "queue: relayer_queue query failed (psql exit $rc): $(echo "$age" | head -1 | sed 's/postgres[^ ]*/<dsn-redacted>/g')"
    return
  fi
  if ! [[ "$age" =~ ^[0-9]+$ ]]; then
    fail "queue: unexpected query output '$age'"
    return
  fi
  if (( age > QUEUE_MAX_AGE_SECONDS )); then
    fail "queue: oldest non-terminal relayer_queue row is ${age}s old (>${QUEUE_MAX_AGE_SECONDS}s) — relayer not draining"
  else
    ok "queue: oldest non-terminal relayer_queue row ${age}s old (<=${QUEUE_MAX_AGE_SECONDS}s)"
  fi
}
queue_check

# ── 3. app health endpoint ───────────────────────────────────────────
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$APP_HEALTH_URL") || code="000"
case "$code" in
  200) ok "app: $APP_HEALTH_URL → 200" ;;
  404)
    if [[ "$APP_404" == "fail" ]]; then
      fail "app: $APP_HEALTH_URL → 404 (endpoint should be deployed — ARCORA_APP_404=fail)"
    else
      warn "app: $APP_HEALTH_URL → 404 (endpoint not yet deployed — warn-only until Task 10; see README)"
    fi
    ;;
  *) fail "app: $APP_HEALTH_URL → $code (expected 200, or 404 pre-deploy)" ;;
esac

# ── verdict ──────────────────────────────────────────────────────────
if (( FAILS > 0 )); then
  critical="[health] CRITICAL: $FAILS check(s) failed on $(hostname) at $(date -Iseconds)"
  printf '%s\n' "${RESULTS[@]}"
  echo "$critical" >&2
  # Same body as stdout/stderr: all check lines (including WARNs) + the
  # CRITICAL footer. RESULTS is already DSN-redacted by the queue check.
  ntfy_push "$(printf '%s\n' "${RESULTS[@]}"; printf '%s\n' "$critical")"
  exit 1
fi
if [[ "$VERBOSE" == "1" ]]; then
  printf '%s\n' "${RESULTS[@]}"
fi
exit 0
