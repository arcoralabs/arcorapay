#!/usr/bin/env bash
# Audit Ops-M4 (2026-05-24): freshness check for the daily Vault secret_id
# rotation. The rotation cron writes a structured "ok" line to
# /var/log/vault-rotation.log on success; if that line stops appearing
# (token expired, vault down, script renamed, anyone), the existing
# secret_id ages out and the relayer eventually starts rejecting login
# with 400/invalid — the same root cause as the 2026-05-12 5-day outage.
#
# This script runs hourly. If the newest "ok" line is older than 25h
# (one cron tick of slack), it exits 1 — the cron's MAILTO surfaces that
# to operators. If the log doesn't exist at all (post-deploy, log
# rotated) it ALSO exits 1, so a missing log can't silently mask a
# missing rotation.
#
# Install (mirror the rotation cron pattern):
#   cp ops/vault/vault-rotation-health.sh /root/arcora-ops/vault/
#   cat > /etc/cron.d/vault-rotation-health <<EOF
#   SHELL=/bin/bash
#   MAILTO=root
#   15 * * * * root /root/arcora-ops/vault/vault-rotation-health.sh
#   EOF
set -euo pipefail

LOG="${VAULT_ROTATION_LOG:-/var/log/vault-rotation.log}"
MAX_AGE_SECONDS="${VAULT_ROTATION_MAX_AGE_SECONDS:-90000}"  # 25h
# Optional ntfy.sh push alerting (same pattern as ops/health/arcora-health.sh).
# The box has no MTA, so cron MAILTO is discarded; when this knob is set the
# failure path pushes the CRITICAL line to https://ntfy.sh/<topic> as a
# best-effort side channel. Topic name is a SECRET — kept only in /etc/cron.d
# on the box, never committed. This check only ever emits the freshness state
# of the rotation log; it never reads or echoes a Vault secret.
NTFY_TOPIC="${ARCORA_NTFY_TOPIC:-}"

# Emit a CRITICAL line to stderr (cron MAILTO) AND, if the knob is set, push it
# to ntfy.sh best-effort, then exit 1. Used for every failure path below so the
# operator gets the alert regardless of whether mail is wired up.
critical_exit() {
  local msg="[health] CRITICAL: $1"
  echo "$msg" >&2
  if [[ -n "$NTFY_TOPIC" ]]; then
    curl -s --max-time 10 \
      -H "Title: Arcorapay vault-rotation health FAIL ($(hostname))" \
      -H "Priority: high" \
      -H "Tags: rotating_light" \
      --data-binary "$msg" \
      "https://ntfy.sh/${NTFY_TOPIC}" >/dev/null 2>&1 || true
  fi
  exit 1
}

if [[ ! -f "$LOG" ]]; then
  critical_exit "$LOG does not exist — rotation has never run"
fi

# Last success line. The new (audit-2026-05-24) rotation script writes
# "[rotation] <iso-ts> ok accessor=…"; the previous version wrote
# "[rotation] <iso-ts> new secret_id rotated, relayer reloaded". We
# accept both so this check can roll out without backfilling the log.
LAST_OK_LINE=$(grep -E '^\[rotation\] [^ ]+ (ok|new secret_id rotated)' "$LOG" | tail -n 1 || true)
if [[ -z "$LAST_OK_LINE" ]]; then
  critical_exit "no successful rotation lines in $LOG"
fi

# Field 2 is the ISO-8601 timestamp written by `date -Iseconds`.
LAST_OK_TS=$(echo "$LAST_OK_LINE" | awk '{print $2}')
if [[ -z "$LAST_OK_TS" ]]; then
  critical_exit "latest 'ok' line is malformed: $LAST_OK_LINE"
fi

LAST_OK_EPOCH=$(date -d "$LAST_OK_TS" +%s 2>/dev/null || echo "0")
if [[ "$LAST_OK_EPOCH" == "0" ]]; then
  critical_exit "could not parse timestamp '$LAST_OK_TS'"
fi

NOW_EPOCH=$(date +%s)
AGE=$(( NOW_EPOCH - LAST_OK_EPOCH ))

if (( AGE > MAX_AGE_SECONDS )); then
  critical_exit "last successful rotation was ${AGE}s ago (>${MAX_AGE_SECONDS}s). Last line: $LAST_OK_LINE"
fi

# Healthy — stay quiet so cron MAILTO doesn't spam the operator.
exit 0
