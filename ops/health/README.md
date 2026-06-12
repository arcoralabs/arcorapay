# Arcora stack health cron

`arcora-health.sh` is the single liveness check for the testnet stack on the
ops VPS (host details live in the private operator notes, not in this repo).
It runs every 10 minutes from cron; like
`ops/vault/vault-rotation-health.sh`, it is **silent when healthy** and prints
\+ exits non-zero on failure so the cron `MAILTO` mails the operator only when
something is actually wrong.

## What it checks

| # | Check | FAIL condition |
|---|---|---|
| 1 | `systemctl is-active` for `arcora-indexer`, `arcora-relayer`, `arcora-webhooks`, `vault` | any unit not `active` |
| 2 | Relayer queue age — oldest `relayer_queue` row in a non-terminal status (`pending`/`processing`), measured from `created_at` | older than `ARCORA_QUEUE_MAX_AGE_SECONDS` (default 900 s = 15 min), or the query itself fails |
| 3 | `GET https://arcorapay.xyz/api/health` (10 s timeout) | non-200/404 response, timeout, or connection failure. **404 is currently WARN-only** (see below) |

Check 2 reuses the relayer daemon's own DB config: it reads
`POSTGRES_URL_NON_POOLING` from `/opt/arcora-ops/relayer/.env` (the unit's
`EnvironmentFile`) and connects with `sslmode=verify-full` against the pinned
Supabase CA extracted from `/opt/arcora-ops/relayer/supabase-ca.ts` — same
AFG-011 trust anchor the daemons use. `crosschain_payments` is deliberately
not age-checked: its attestation-poll states are legitimately long-lived
(up to 2 h by `CROSSCHAIN_ATTESTATION_DEADLINE_MS`).

If the CA can't be extracted, the queue check degrades to `sslmode=require`
(encrypted but unverified) rather than going blind — a WARN, not a FAIL. To
avoid mailing that WARN every 10 minutes, the script instead touches the
marker file **`/run/arcora-health-tls-degraded`**. Its presence means the most
recent run could not pin the Supabase CA; the file is removed automatically on
the next run that successfully extracts it. Check for it with
`ls -l /run/arcora-health-tls-degraded`; if present, verify
`/opt/arcora-ops/relayer/supabase-ca.ts` still contains the PEM.

## TODO — flip the app-endpoint 404 to FAIL after Task 10

`/api/health` exists in the app code but is **not deployed to production
yet** (the deploy is Task 10 of the public-beta launch plan). Until then a
404 is the expected steady state, so the script treats it as WARN and stays
quiet about it (no mail every 10 minutes). Anything else that isn't a 200 —
5xx, timeout, TLS failure — is already a FAIL today.

**After the Task 10 deploy lands**, flip 404 to a hard failure by adding
`ARCORA_APP_404=fail` to the cron file (or change the script default):

```
*/10 * * * * root ARCORA_APP_404=fail flock -n /run/arcora-health.lock /root/arcora-ops/health/arcora-health.sh
```

## Install on the VPS

Same conventions as the vault rotation health check (script under
`/root/arcora-ops/`, cron file under `/etc/cron.d/` with `MAILTO=root`):

```bash
mkdir -p /root/arcora-ops/health
cp ops/health/arcora-health.sh /root/arcora-ops/health/
chmod +x /root/arcora-ops/health/arcora-health.sh

cat > /etc/cron.d/arcora-health <<EOF
SHELL=/bin/bash
MAILTO=root
*/10 * * * * root flock -n /run/arcora-health.lock /root/arcora-ops/health/arcora-health.sh
EOF
```

The `flock -n /run/arcora-health.lock` wrapper makes the cron run a no-op if a
previous run is still in flight (e.g. a slow DB), so overlapping invocations
can never pile up. It pairs with the in-script `timeout 30` around `psql`.

Using a dedicated `/etc/cron.d/arcora-health` file (rather than editing the
root crontab) means existing cron entries are never touched.

## Push alerts via ntfy.sh (no MTA on the box)

The ops VPS has **no mail transfer agent**, so cron's `MAILTO=root` is silently
discarded — a FAIL would never reach anyone by mail. To get the alert off the
box we use [ntfy.sh](https://ntfy.sh): a free, no-account pub/sub push service
(egress from the box to ntfy.sh is known-good).

Set the optional `ARCORA_NTFY_TOPIC` knob and, on any FAIL (the CRITICAL
verdict path **and** the unexpected-abort `ERR` trap), the script POSTs the
exact same body it sends to stdout/stderr to `https://ntfy.sh/<topic>`. It is
best-effort (`curl --max-time 10 … || true`): a slow or unreachable ntfy never
fails the health check, and an empty knob is a no-op. Mail behaviour is
unchanged (still harmless if an MTA is ever installed). The body is already
DSN-redacted by the queue check — no secrets are ever pushed.

Wire it in via the cron file (it lives only on the box, so the secret topic
stays out of git):

```
SHELL=/bin/bash
MAILTO=root
ARCORA_NTFY_TOPIC=arcora-ops-xxxxxxxxxxxx
*/10 * * * * root flock -n /run/arcora-health.lock /root/arcora-ops/health/arcora-health.sh
```

The same `ARCORA_NTFY_TOPIC` knob is honoured by
`ops/vault/vault-rotation-health.sh`; both crons can share one topic.

> **The topic name is a SECRET.** ntfy.sh has no auth — anyone who knows the
> topic can read every alert (and publish noise to it). Keep it **only** in
> `/etc/cron.d/` on the box; **never commit it** to this repo. To rotate, pick
> a new `arcora-ops-$(openssl rand -hex 6)`, update both cron files, and
> re-subscribe.

### Subscribing to the alerts

- **ntfy mobile app** (iOS / Android): tap *＋*, enter the topic name exactly
  (server `ntfy.sh`), subscribe. Pushes arrive as notifications.
- **CLI / scripting** — stream live:

  ```bash
  curl -s ntfy.sh/<topic>/json
  ```

- **Poll the recent backlog** (useful for testing — last 5 min, no long-poll):

  ```bash
  curl -s "https://ntfy.sh/<topic>/json?poll=1&since=5m"
  ```

## Manual runs / testing

```bash
# verbose pass (prints every check line):
ARCORA_HEALTH_VERBOSE=1 /root/arcora-ops/health/arcora-health.sh

# prove the failure path without touching live units:
ARCORA_UNITS="arcora-bogus" /root/arcora-ops/health/arcora-health.sh; echo "exit=$?"
```

Knobs (all env, all optional): `ARCORA_UNITS`, `ARCORA_RELAYER_DIR`,
`ARCORA_RELAYER_ENV_FILE`, `ARCORA_QUEUE_MAX_AGE_SECONDS`,
`ARCORA_APP_HEALTH_URL`, `ARCORA_APP_404` (`warn`|`fail`),
`ARCORA_HEALTH_VERBOSE`.

## When you get an alert

The mail body is the full set of check lines plus a `[health] CRITICAL: …`
footer. Match the failing line to the row below.

| FAIL | First look | Then |
|---|---|---|
| `unit <name> is '…'` | `journalctl -u <unit> -n 100` | `systemctl restart <unit>` once you understand why it died |
| `queue: … row is …s old …` (relayer not draining) | Inspect stuck rows: `psql "$DSN" -c "select id, status, attempts, last_error, created_at from relayer_queue where status in ('pending','processing') order by created_at limit 5;"` | Check the relayer journal: `journalctl -u arcora-relayer -n 100` (look for a crash/retry loop or a stalled attestation poll) |
| `queue: relayer_queue query failed …` | Same stuck-rows SQL above to confirm DB reachability | If it's a TLS pin failure, check `ls -l /run/arcora-health-tls-degraded` and `/opt/arcora-ops/relayer/supabase-ca.ts` |
| `app: … → <code>` | Check the Vercel deploy/status dashboard | `curl -i https://arcorapay.xyz/api/health` to see the live response/headers |
| `CRITICAL: script aborted unexpectedly` | Re-run manually with `ARCORA_HEALTH_VERBOSE=1 bash -x /root/arcora-ops/health/arcora-health.sh` | The accumulated check lines are mailed above the CRITICAL line — start there |

For the queue SQL, `$DSN` is the relayer's `POSTGRES_URL_NON_POOLING`
(`grep POSTGRES_URL_NON_POOLING /opt/arcora-ops/relayer/.env`). A bare 404 on
the app endpoint is still WARN-only pre-Task-10 (see above) and won't mail.
