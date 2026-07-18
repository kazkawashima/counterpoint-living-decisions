# Plan 05 — Cloudflare, judge mode, and security

## Goal

Run the same flagship on Cloudflare with bounded judge-funded access, adapter
parity, persistent data, and completed high-risk security gates.

## Inputs

- [Architecture specification](../specs/04-system-architecture-and-data.md)
- [Security specification](../specs/02-identity-permissions-and-security.md)
- [Operations specification](../specs/07-operations-observability-and-resilience.md)
- External rechecks ER-05, ER-06, and ER-09
- UD-03: USD 25 rolling-24-hour hard cap and USD 50 provider alert
- Plan 04 exit gate

## Work packages

### C1 — Cloudflare resource setup

- [ ] Configure Worker static assets and API routes.
- [ ] Add D1 schema/migrations aligned with SQLite semantics.
- [ ] Add R2 artifact adapter.
- [ ] Add one Durable Object per meeting.
- [ ] Add reproducible preview resource scripts.
- [ ] Keep all dev/preview servers reachable on `0.0.0.0` where applicable.

### C2 — Adapter parity

- [ ] Run shared event/projection repository contract suite against D1.
- [ ] Run artifact contract suite against R2.
- [ ] Run realtime/coordination contract suite against Durable Objects.
- [ ] Prove event ordering, resume position, idempotency, display revocation,
      and reset parity.
- [ ] Document unavoidable runtime differences without changing domain meaning.

### C3 — Judge-managed key path

- [ ] Register `OPENAI_API_KEY_JUDGE` via secret workflow without echoing value.
- [ ] Allow only the judge user capability.
- [ ] Keep standard key out of browser, DO state, D1, R2, logs, and events.
- [ ] Reissue short-lived Realtime secrets after DO eviction without exposing
      the standard key.
- [ ] Keep ordinary BYOK behavior unchanged.

### C4 — Usage limits

- [ ] Implement durable account/IP/meeting/concurrency/time/token/generation/
      currency limits.
- [ ] Enforce the USD 25 rolling-24-hour currency boundary before billable work.
- [ ] Treat the USD 50 provider alert as secondary warning only.
- [ ] Derive secondary production limits from measured flagship usage.
- [ ] Check limits before billable work.
- [ ] Fail closed with `USAGE_LIMIT_REACHED`.
- [ ] Keep manual degraded mode available.
- [ ] Add operator visibility without private content.

### C5 — Security hardening

- [ ] Run IDOR and cross-meeting/owner test matrix.
- [ ] Run SSRF redirect/DNS/metadata matrix.
- [ ] Run artifact content-type and size spoofing matrix.
- [ ] Run session/display-token expiry and revocation.
- [ ] Run webhook signature/replay/idempotency matrix.
- [ ] Scan API responses, realtime payloads, logs, and repository for secrets.
- [ ] Verify disclosure preview-hash and prompt-injection boundaries.

### C6 — Hosted deployment path

- [ ] Add preview and production deployment commands.
- [ ] Add manually approved main deployment workflow.
- [ ] Run D1/DO migrations safely.
- [ ] Add health/readiness and post-deploy flagship smoke.
- [ ] Record deployed commit/configuration.
- [ ] Write rollback and judge-secret shutdown runbooks.

## Browser verification

Run the complete flagship against Cloudflare preview and production with:

- judge account without BYOK
- ordinary account requiring BYOK
- separate browser contexts and real mobile/Tailscale-style access
- display token
- artifact upload
- shared/private input
- Commitment
- demo and signed external events
- `AT_RISK` and human-confirmed `REVIEW_REQUIRED`
- reset and persistence
- usage-limit exhaustion

## Visual evidence

Capture hosted production-like states only after removing all real credentials
and verifying synthetic data. Record browser/viewport and deployed commit in
notes.

## Exit gate

Cloudflare preview and production execute the same flagship semantics as local.
Judge mode completes without BYOK, ordinary users cannot access it, configured
limits prevent additional spend, and the full security suite passes.

## Suggested commit boundaries

1. Cloudflare adapters and preview parity.
2. Judge mode, limits, security, and deployment runbooks.
