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

- [x] Configure Worker static assets and API routes.
- [x] Add D1 schema/migrations aligned with SQLite semantics.
- [x] Add R2 artifact adapter.
- [x] Add one Durable Object per meeting.
- [x] Add reproducible preview resource scripts.
- [x] Keep all dev/preview servers reachable on `0.0.0.0` where applicable.

### C2 — Adapter parity

- [x] Run shared event/projection repository contract suite against D1.
- [x] Run artifact contract suite against R2.
- [x] Run realtime/coordination contract suite against Durable Objects.
- [x] Prove event ordering, resume position, idempotency, display revocation,
      and reset parity.
- [x] Document unavoidable runtime differences without changing domain meaning.

C2 runtime notes:

- D1 uses primary sessions and one transactional batch for events, the
  idempotency receipt, and owner-partitioned projections. SQLite uses one
  `BEGIN IMMEDIATE` transaction behind the same shared contract.
- The meeting Durable Object coordinates only short-lived ticket digests and
  payload-free publication metadata. D1 remains durable truth. An eviction
  intentionally loses unused tickets and publication hints; a reconnect with
  an unknown visible cursor must fetch a fresh role-authorized D1 projection.
- Private publications are renumbered into participant-visible cursors, so a
  display or another participant cannot infer private activity from gaps.
  Session revocation discards matching participant or display tickets, while a
  reset remains a normal shared publication and does not rewind the cursor.
- The local Node hub can call an in-process projection callback. The hosted
  path must fetch the same personalized snapshot through the authenticated
  Worker route when the shared HTTP runtime is wired. C2 does not expose the
  coordinator's internal routes or a public WebSocket endpoint.

### C3 — Judge-managed key path

- [ ] Register `OPENAI_API_KEY_JUDGE` via secret workflow without echoing value.
- [x] Allow only the judge user capability.
- [x] Keep standard key out of browser, DO state, D1, R2, logs, and events.
- [x] Reissue short-lived Realtime secrets after DO eviction without exposing
      the standard key.
- [x] Keep ordinary BYOK behavior unchanged.

The local C3 implementation uses an internal, server-derived
`judge:managed-ai` capability that is granted only by an exact user-ID
allowlist and is filtered from public role projections. Clients cannot request
judge mode or select a key source. Node and Worker delegate Realtime
client-secret issuance to the same Web-standard HTTP handler, while the Worker
constructs the managed OpenAI adapter directly from its request-local Secret
binding. The adapter never accepts the standard key as application input.

Cloudflare-native proof covers exact D1 authentication and meeting scope,
ordinary-user denial, missing-Secret fail-closed behavior, and fresh
short-lived-secret issuance after recreating the Worker handler. Assertions
scan the response, D1 rows, R2 listing, and meeting Durable Object health
surface for the synthetic standard key. The Worker still has no hosted BYOK
configure/heartbeat/clear route; ordinary Node BYOK behavior and its shared
HTTP contract remain unchanged, and the hosted transient-DO BYOK adapter stays
in A6 parity work.

Realtime client-secret creation explicitly requests a 30-second TTL instead of
the provider's longer default. Provider client secrets may create multiple
sessions until expiry, and attached session configuration can be overridden by
the client, so the ephemeral token and its channel label are bootstrap data,
not an application authorization boundary. Authentication, meeting scope,
private/shared publication rules, and C4 usage limits remain server-owned.

No remote Secret was registered in this local implementation boundary.
`OPENAI_API_KEY_JUDGE` and the exact judge identity must remain absent from
`wrangler.jsonc`, generated bindings, source control, logs, and captured media.
Their registration and shutdown are deployment operations, not build-time
defaults.

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
