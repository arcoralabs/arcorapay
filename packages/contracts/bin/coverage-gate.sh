#!/usr/bin/env bash
# Coverage gate for forge lcov.info — Plan 7 Layer 2 #4.
#
# Computes percent line + branch coverage across `src/*.sol` (excludes
# script/, test/, testnet/MintableERC20.sol since those aren't audit scope).
# Exits 1 if either falls below threshold.
#
# Today's floor reflects current V10 coverage and prevents regression.
# Audit-ready target is LINE_TARGET=95 BRANCH_TARGET=90 — V10 is the
# current canonical deployment with per-invoice escrow custody.
#
# Override via env: COVERAGE_LINE_FLOOR / COVERAGE_BRANCH_FLOOR.

set -euo pipefail

# Force C locale so awk's printf uses '.' not ',' as decimal separator —
# any later numeric comparison would otherwise break in Turkish/German envs.
export LC_ALL=C
export LC_NUMERIC=C

LCOV="${1:-lcov.info}"
# Floors set to the audit-ready target after the V8 test backfill on
# 2026-05-03 took coverage to 100% lines / 100% branches. Floors below
# the audit-ready bar represent a regression and should fail CI.
LINE_FLOOR="${COVERAGE_LINE_FLOOR:-95}"
BRANCH_FLOOR="${COVERAGE_BRANCH_FLOOR:-90}"
LINE_TARGET=95
BRANCH_TARGET=90

if [[ ! -f "$LCOV" ]]; then
  echo "::error::coverage-gate: $LCOV not found" >&2
  exit 2
fi

# Sum LF/LH/BRF/BRH across audit-scope files only.
# Pattern of audit scope: src/ArcFXGatewayV8.sol (and any future src/*.sol
# the gate should care about). script/ and helpers are excluded.
awk '
  BEGIN { in_scope = 0 }
  /^SF:/ {
    # Audit scope: V10 (current canonical custody gateway). V8/V9 retired to legacy/.
    in_scope = ($0 ~ /^SF:src\/ArcFXGatewayV10\.sol$/) ? 1 : 0
  }
  in_scope && /^LF:/  { sub(/^LF:/,"");  lf  += $0 }
  in_scope && /^LH:/  { sub(/^LH:/,"");  lh  += $0 }
  in_scope && /^BRF:/ { sub(/^BRF:/,""); brf += $0 }
  in_scope && /^BRH:/ { sub(/^BRH:/,""); brh += $0 }
  END {
    line_pct   = (lf  > 0) ? (100.0 * lh  / lf)  : 100
    branch_pct = (brf > 0) ? (100.0 * brh / brf) : 100
    printf("%.2f %.2f %d %d %d %d\n", line_pct, branch_pct, lh, lf, brh, brf)
  }
' "$LCOV" | {
  read -r LINE_PCT BRANCH_PCT LH LF BRH BRF
  printf "Audit-scope coverage:\n"
  printf "  Lines    : %s%% (%s/%s)  [floor %s · target %s]\n" "$LINE_PCT"   "$LH"  "$LF"  "$LINE_FLOOR"   "$LINE_TARGET"
  printf "  Branches : %s%% (%s/%s)  [floor %s · target %s]\n" "$BRANCH_PCT" "$BRH" "$BRF" "$BRANCH_FLOOR" "$BRANCH_TARGET"

  fail=0
  awk -v p="$LINE_PCT"   -v f="$LINE_FLOOR"   'BEGIN { exit !(p+0 < f+0) }' && {
    echo "::error::lines below floor ($LINE_PCT < $LINE_FLOOR)" >&2; fail=1
  }
  awk -v p="$BRANCH_PCT" -v f="$BRANCH_FLOOR" 'BEGIN { exit !(p+0 < f+0) }' && {
    echo "::error::branches below floor ($BRANCH_PCT < $BRANCH_FLOOR)" >&2; fail=1
  }
  exit "$fail"
}
