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
- [x] Keep standard key out of browser, DO storage, D1, R2, logs, and events.
- [x] Keep direct judge client-secret issuance fail-closed until the C4
      server-owned call path enforces its reservation.
- [x] Keep ordinary BYOK behavior unchanged.

The local C3 implementation uses an internal, server-derived
`judge:managed-ai` capability that is granted only by an exact user-ID
allowlist and is filtered from public role projections. Clients cannot request
judge mode or select a key source. Node retains the ordinary facilitator-BYOK
client-secret path. The Worker authenticates and resolves the allowlisted judge
but deliberately returns `REALTIME_UNAVAILABLE` from the direct client-secret
route, even when its Secret binding exists.

Cloudflare-native proof covers exact D1 authentication and meeting scope,
ordinary-user denial, configured-or-missing-Secret fail-closed behavior, and
the same denial after recreating the Worker handler. Assertions scan the
response, D1 rows, R2 listing, and meeting Durable Object health surface for
the synthetic standard key. The Worker still has no hosted BYOK
configure/heartbeat/clear route; ordinary Node BYOK behavior and its shared
HTTP contract remain unchanged, and the hosted transient-DO BYOK adapter stays
in A6 parity work.

The ordinary BYOK client-secret adapter explicitly requests a 30-second TTL
instead of the provider's longer default. Provider client secrets may create
multiple sessions until expiry, and attached session configuration can be
overridden by the client, so the ephemeral token and its channel label are
bootstrap data, not an application authorization boundary. Judge mode
therefore uses no direct token path; authentication, meeting scope,
private/shared publication rules, and C4 usage limits remain server-owned.

No remote Secret was registered in this local implementation boundary.
`OPENAI_API_KEY_JUDGE` and the exact judge identity must remain absent from
`wrangler.jsonc`, generated bindings, source control, logs, and captured media.
Their registration and shutdown are deployment operations, not build-time
defaults.

### C4 — Usage limits

- [x] Implement the durable D1 reservation ledger for
      account/IP/meeting/concurrency/time/token/generation/currency limits.
- [x] Enforce a fixed USD 25 rolling-24-hour ceiling in the D1 adapter and
      schema trigger.
- [x] Derive judge IP pseudonyms from canonical `CF-Connecting-IP` with a
      separate production HMAC Secret and no raw-IP persistence.
- [x] Persist one server-owned opaque call handle per reservation and require
      exact session/user/participant/meeting ownership on lookup/termination.
- [ ] Wire every judge billable path through a reservation before provider
      work.
- [ ] Enforce the USD 25 rolling-24-hour currency boundary before billable work.
- [x] Treat the USD 50 provider alert as secondary warning only.
- [ ] Derive secondary production limits from measured flagship usage.
- [ ] Check limits before billable work.
- [ ] Fail closed with `USAGE_LIMIT_REACHED`.
- [x] Keep manual degraded mode available.
- [ ] Add operator visibility without private content.

C4 foundation notes:

- Migration 0006 stores integer micro-USD reservations and content-free
  account, keyed-HMAC IP, meeting, operation, model, pricing-version, token,
  generation, Realtime-second, lifecycle, and expiry metadata. Raw IP addresses
  and reversible IP encodings are rejected.
- Reservation is one conditional D1 insert. Reserved or unknown work counts at
  its full estimate without aging out; finalized actual usage remains charged
  for 24 hours from settlement. Finalization cannot exceed any reserved
  dimension and may complete out of request order; release is valid only before
  finalization. Database triggers enforce both the fixed ceiling and append-time
  ordering, preventing out-of-order direct writes from creating an unchecked
  historical window. The ledger survives adapter and Worker recreation.
- The production IP helper accepts only canonical IPv4 or RFC 5952-style IPv6,
  uses Web Crypto HMAC-SHA-256 with a distinct `JUDGE_IP_HMAC_SECRET`, and
  emits only a lowercase keyed digest. The Worker gate requires at least 32
  secret bytes and an exact `CF-Connecting-IP`; missing, list, port, hostname,
  zone-ID, and noncanonical inputs fail closed. The raw address exists only in
  request-local reservation input.
- Migration 0007 maps one server-generated opaque handle to exactly one active
  reservation plus its authenticated user/session, current meeting assignment,
  participant, channel, and bounded lifetime. Unique constraints and
  conditional insert prevent two handles claiming one reservation. Lookup and
  idempotent termination require every owner dimension. A shared resolver
  re-authenticates the Bearer session, re-resolves active meeting assignment
  and judge capability, then resolves ownership without accepting participant,
  reservation, provider-call, or key-source identity from the browser.
- The server-owned unified WebRTC connector captures the standard key, sends
  only SDP, channel isolation instructions, model, and a pseudonymous safety
  identifier to OpenAI, validates a bounded SDP response and exact call
  location, and keeps the provider call ID out of the browser contract. An
  acceptance hook lets the controller persist the call ID before SDP body
  validation; the key-bearing destination is fixed to the official HTTPS
  endpoint and cannot be overridden.
- A dedicated Durable Object now owns one reservation/call pair. It persists
  a connecting claim before provider I/O and the provider call ID before
  returning SDP, requires an exact active full-cap D1 reservation before
  provider work, schedules a 30-second alarm, invokes the official
  authenticated hangup endpoint, and retries settlement without issuing
  duplicate hangups. Transactional connecting/active transitions reject
  concurrent starts, late acceptance after cancellation, and stale telemetry
  writes after settlement. Accepted calls with a later malformed SDP response
  are terminated immediately; provider outcomes without a known call ID are
  charged conservatively.
- The current official sideband and cost contracts were rechecked on
  2026-07-19. A strict content-free accumulator validates complete
  `response.done` text/audio/image/cached token details, deduplicates exact
  response identities, and prices them against the pinned
  `gpt-realtime-2.1` rate card with conservative integer micro-USD rounding.
  Malformed totals, identity conflicts, separately billed transcription
  events, unsafe integer growth, and any reservation-dimension overflow make
  the accumulator permanently untrustworthy. They can never lower settlement.
- The Durable Object attaches an outbound, API-key-authenticated sideband
  WebSocket to the accepted provider call ID before browser SDP can be
  returned. The adapter fixes the destination to the official provider origin,
  accepts only bounded text JSON, preserves event order, and never persists raw
  provider frames. Only the content-free accumulator state is stored.
- Judge generation control is now server-owned. The sideband sends one fixed
  session configuration with automatic VAD response creation and interruption
  disabled, waits for an exact acknowledgement, and exposes only fixed
  `response.create` and `response.cancel` methods. The call controller derives
  those commands from ordered provider speech boundaries, serializes
  cancellation before replacement generation, rejects unsolicited or duplicate
  response creation and command errors, and terminates before a fourth response
  can exceed the three-generation reservation.
- The managed connector rejects SDP containing a provider data channel, video,
  no audio, multiple media sections, or SCTP attributes. A separate browser
  transport creates only a send/receive audio transceiver, never requests a
  provider data channel, and explicitly asks the app server to terminate the
  managed call when closed. A live 2026-07-19 smoke proved that the official
  unified Realtime endpoint accepts the resulting Chromium media-only offer;
  the smoke emits only model and pass/fail metadata.
- Judge input transcription is fixed to `gpt-realtime-whisper`. The separately
  billed completion event must carry exact duration usage; at the checked USD
  0.017/minute rate, the 30-second call ceiling contributes at most USD 0.0085.
  Duration cost and seconds join the same content-free accumulator, while
  token-based, malformed, missing, or over-30-second transcription usage
  terminates and conservatively settles the call. The combined
  `gpt-realtime-2.1` plus transcription pricing version is pinned in each
  reservation.
- Strict public contracts now define one opaque app-managed call handle,
  begin-turn binding, bounded transcript retrieval, and termination without
  exposing provider call IDs, credentials, item IDs, or metadata. Inside the
  Durable Object, a turn is registered before audio, bound to the
  server-observed VAD item ID, and completed only after usage is durably
  accounted. Transcript text remains in one transient in-memory slot and is
  excluded from Durable Object storage, status, usage entries, errors, and
  logs. Mismatch, conflict, transcription failure, or loss of transient
  ownership across restart triggers hangup rather than permissive recovery.
- Sideband setup failure, provider-side disconnect, malformed or future
  billable telemetry, and any observed reservation-dimension overflow
  immediately invoke authenticated hangup and conservatively finalize the full
  reservation. Attachment-time disconnects cannot race through a successful
  browser SDP response, and server-initiated close cannot duplicate settlement.
  Trustworthy measured telemetry is visible internally but is not yet used to
  lower the charged reservation.
- The controller is not publicly routed yet. Keyed IP input and opaque
  ownership foundations exist, but the remaining safe-route gates are
  authenticated hosted API parity, wiring those checks into every public
  operation before the Durable Object is addressed, measured production
  limits, and bounded settlement. Until those gates close, judge client-secret
  issuance and the public managed route remain fail-closed. No remote Secret
  registration occurs.

### C5 — Security hardening

- [x] Run IDOR and cross-meeting/owner test matrix.
- [x] Run SSRF redirect/DNS/metadata matrix.
- [x] Run artifact content-type and size spoofing matrix.
- [x] Run session/display-token expiry and revocation.
- [x] Run webhook signature/replay/idempotency matrix.
- [x] Scan API responses, realtime payloads, logs, and repository for secrets.
- [x] Verify disclosure preview-hash and prompt-injection boundaries.
- [ ] Re-run the C5 matrix against hosted Worker routes after API parity.

The C5 foundation is reproducible through `npm run security:verify`. The
current matrix exercises 283 authorization, owner isolation, session/display
expiry, SSRF/DNS pinning, redirect, artifact parser/size, webhook, disclosure,
Realtime payload, API response, and structured-log cases. Parser-normalized
decimal, hexadecimal, octal, short dotted, trailing-dot, and IPv4-embedded
IPv6 loopback forms have an additional fail-closed matrix. The D1-backed
application lifecycle also proves exact inactivity expiry, absolute expiry,
durable revocation, logout, and no post-revocation authentication. The
Node HTTP boundary proves active access one millisecond before inactivity
expiry, rejection and durable revocation at exact inactivity and absolute
expiry, and display-token access one millisecond before but not at exact TTL.
Wrong-meeting display access returns the same content-free expired envelope.
An account assigned to two meetings cannot substitute an existing artifact ID
from one meeting into the other, and receives the same response as for a
missing ID. Another owner cannot preview, approve, or reject either an existing
or missing disclosure candidate, and all six attempts leave the event stream
unchanged.
The HTTP multipart matrix proves that fake PDF and invalid JSON payloads remain
owner-private failed sources, while an extension/MIME mismatch is rejected
before persistence; none becomes shared or visible to another owner.
Overstated `Content-Length` is rejected before body parsing, while an
understated header cannot bypass the actual 20 MiB file-size check; neither
path writes storage or events. A correctly signed webhook one second outside
the allowed window is also rejected without appending an event. Concurrent
identical webhook deliveries return one durable receipt plus one replay, while
concurrent conflicting payloads with the same event ID produce one receipt and
one conflict with exactly one event. The repository scan checks tracked and
non-ignored untracked files plus
`apps/*/dist` and `packages/*/dist`, rejects tracked secret-bearing filenames,
recognizes common provider credentials and private keys, skips ignored local
secret files, and reports only the path and rule name rather than the detected
value. API provider failures, Realtime state/errors, structured logs, and
protocol envelopes each carry synthetic secret/private canaries that are
asserted absent. C5 remains open only for rerunning these shared contracts
against hosted Worker routes after API parity.

### C6 — Hosted deployment path

- [x] Add preview and production deployment commands.
- [x] Add manually approved main deployment workflow.
- [ ] Run D1/DO migrations safely.
- [ ] Add health/readiness and post-deploy flagship smoke.
- [ ] Record deployed commit/configuration.
- [x] Write rollback and judge-secret shutdown runbooks.

C6 preparation notes:

- Preview and production use separate, protected GitHub Environments. The
  dispatch-only workflow skips non-`main` refs and exposes only target-scoped
  Cloudflare credentials after Environment approval.
- The local plan commands perform no remote operation. The apply driver refuses
  a dirty or mismatched commit, requires an exact target approval, renders the
  remote D1 ID only into an ignored `0600` config, disables Wrangler `.env`
  loading, and keeps raw Wrangler output in ignored runner state.
- The driver runs the full security verification before forward-only D1
  migration and strict Worker deployment. It does not register or receive
  `OPENAI_API_KEY_JUDGE`; that remains a separate C3/C4 production gate.
- A bounded remote smoke now verifies health, migration readiness, the SPA, and
  unauthenticated API parity. It intentionally blocks the current
  parity-pending Worker. A complete authenticated flagship smoke still must be
  added and run before this row can close.
- Credential-free deployment records contain the commit, target, Worker name,
  origin host, and hashes of the generated config and private deployment
  status. No real deployment record exists until an approved deployment runs.
- Rollback is binary-only and forward-schema-compatible; no D1 or Durable
  Object down migration is permitted. Judge shutdown revokes provider access
  and deletes the Worker Secret without reading or logging its value.
- No remote resource, migration, deployment, secret, or repository visibility
  was changed while preparing C6.

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
