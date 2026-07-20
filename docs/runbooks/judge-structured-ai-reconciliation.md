# Judge structured-AI reconciliation

Updated: 2026-07-20

This command repairs stale, content-free judge-funded structured-AI lifecycle
rows. It does not call OpenAI and does not require or read
`OPENAI_API_KEY_JUDGE` or `JUDGE_IP_HMAC_SECRET`.

## Safe inspection

Build the current Cloudflare adapter and list at most 20 eligible rows:

```bash
npm run judge:reconcile -- preview --dry-run
```

Dry-run is the default when the mode is omitted. It executes only the shared
stale-row `SELECT` and prints counts, never claim hashes, reservation IDs,
request fingerprints, prompts, provider output, IP values, or Secrets.

Rows are ordered by stale timestamp and claim hash. Only expired `reserved` and
`provider_started` rows are eligible. Each row is handled independently, so a
failed row remains visible to a later run.

## Approved apply

Apply is a remote D1 mutation and uses the same target, production,
clean-worktree, and optional `GITHUB_SHA` checks as deployment:

```bash
CLOUDFLARE_DEPLOYMENT_APPROVED=preview \
  npm run judge:reconcile -- preview --apply
```

Production additionally requires:

```bash
CLOUDFLARE_PRODUCTION_CONFIRMATION=counterpoint-production
```

The standard `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and exact
`CLOUDFLARE_D1_DATABASE_ID` are required. Never provide provider or HMAC
credentials to this command.

## State handling

- Expired pre-provider `reserved` work is generation-conditionally abandoned
  and its still-reserved usage is released. The conditional claim transition
  proves provider work never started.
- `provider_started` work with a reserved ledger row is finalized at the full
  reserved envelope and then marked settled.
- An already-finalized exact ledger row is marked settled without changing its
  actual usage.
- Settled claims retain a 25-hour reuse boundary, one hour beyond the rolling
  24-hour budget window.
- Provider-started usage must never be released or deleted. If its ledger row
  is missing, released, or has mismatched immutable metadata, leave it
  unchanged and escalate.

## Legacy rows

Migration 0011 classifies pre-existing 0010 claims as `legacy_blocked`.
Automated reconciliation never changes them. A legacy parent may be removed
only after both of these facts have been established for that exact target:

1. the structured-AI route was never enabled while the row could have existed;
2. no matching active usage reservation exists.

Record that evidence outside command output before a manual database change.
If either fact is uncertain, retain the row and escalate.

## Failure and escalation

A nonzero `failed` count means at least one row was not changed. Re-run dry-run,
confirm the target and current commit, then retry apply. Do not hand-edit a
provider-started row, lower its reserved usage, release its reservation, or
shorten the 25-hour retention period. Escalate repeated failures with only the
target, commit, timestamp, and content-free counts; do not copy raw Wrangler
output into tickets or submission material.
