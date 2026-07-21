# Implementation status

Updated: 2026-07-21

## Current phase

**The complete local and hosted-preview guided flagship is implemented from
private evidence through permission, Commitment, external change, human review,
revision, export, deterministic meeting reset, and participant-scoped realtime
resume.
The revocable read-only shared display, A1 validated artifact ingestion, A2
SSRF-safe URL ingestion, A6 transient BYOK/client-secret path, A7 shared-floor
speech controls, and A8 durable degraded mode are also complete. OpenAI,
Realtime, and BYOK loss leave state reads, manual text, human-authored
Decisions, audit, and export usable through explicit bounded recovery UI. The
remaining implementation phase is hosted Cloudflare parity, judge mode,
security hardening, final license/credential decisions, production operations,
and submission packaging.**

The canonical implementation-facing artifacts are:

- [`docs/specs/README.md`](../../specs/README.md)
- [`docs/plans/README.md`](../README.md)
- [`docs/decisions/user-decisions.md`](../../decisions/user-decisions.md)
- [`docs/decisions/external-rechecks.md`](../../decisions/external-rechecks.md)

## 2026-07-21 hosted room creation repair

- Hosted preview commit `baa673f` now routes `POST /api/v1/meetings` to the
  existing application `createMeeting` use case.
- The Worker preserves facilitator authorization, deterministic idempotent
  replay, D1 race recovery, and the canonical create-meeting response.
- Verification passed: typecheck, lint, Worker boundary tests (22), targeted
  Cloudflare pool tests (13), security matrix (300), preview config dry-run,
  remote D1 migration check, health/readiness/SPA/auth smoke, flagship smoke,
  and hosted browser creation of a new synthetic room.
- Browser creation produced the facilitator workspace for
  `Hosted room creation verification`; browser console warnings were zero.
- The complete Cloudflare pool remains a known flaky gate in the existing
  managed-realtime suite: targeted execution passes 6/6, while full parallel
  runs reached 140/141 and 137/141 because shared local D1 usage cleanup can
  violate its reservation CHECK constraint. This was not hidden or changed as
  part of the room-creation repair.
- Production deployment and logged-out/incognito judge smoke remain pending.

## Completed

- Repository preparation and topic import.
- English topic translations.
- Cross-topic authority and conflict resolution.
- Product, domain, security, AI/Realtime, architecture, protocol, UI/evidence,
  operations, testing, and submission specs.
- Topic and topic-14 section coverage matrices.
- Ordered M0–M6 delivery plan.
- User-decision list separated from external fact rechecks.
- F1 npm workspace scaffold with pinned Node/npm versions.
- Root format, lint, typecheck, unit/contract/integration, build, development,
  and deployment-smoke command surface.
- Vite development and preview host binding to `0.0.0.0`.
- Secret-safe environment-example validation.
- Enforced domain/package dependency boundaries with deliberate failing
  fixtures.
- F2 protocol primitives, private/shared event envelopes, version/upcast policy,
  stable errors, and deep secret/private-data redaction.
- F3 flagship domain entities and construction invariants.
- F4 all 37 required event payloads, deterministic projections, replay,
  idempotency, optimistic concurrency, owner isolation, and scoped reset.
- F5 complete Decision transition matrix, human-confirmed review boundary,
  Action hold, revisions, and reconsideration task behavior.
- F6 all required ports, authorization/command/query boundaries, reusable
  EventStore/ProjectionStore/ArtifactStore/RealtimePublisher contracts, and
  test-only in-memory adapters.
- Deterministic M1 integration journey through `REVIEW_REQUIRED`, held Action,
  and reconsideration task with equivalent shared-only replay.
- L1 SQLite migrations, meeting-scoped event/projection adapters, partitioned
  local artifact storage, reusable adapter contracts, and restart coverage.
- L2 fixed-user password hashing, persisted Bearer sessions, inactivity and
  absolute expiry, meeting creation, 3–8 assignments, assigned list, and code
  join application boundaries.
- Strict v1 HTTP DTOs for the planned local flagship capability surface,
  including health/readiness contracts.
- Local Hono startup on `0.0.0.0`, fixed five-user and flagship-meeting seed,
  versioned identity/meeting routes, safe errors, correlation IDs, and
  secret-free health/readiness.
- React login, assigned-meeting list, code fallback, and responsive
  participant-private/shared workspace shell with tab-scoped session storage.
- Browser E2E for desktop, mobile, reduced motion, external-host-style access,
  safe authentication failure, explicit disclosure approval, and rejection,
  with nine screenshots and two reel clips.
- Deterministic disclosure application core through owner-private source,
  proposal, editable preview, hash revalidation, approval/rejection, and
  shared Evidence publication. Complete projections remain owner-partitioned.
- Versioned HTTP disclosure routes backed by SQLite events, partitioned local
  artifacts, server-resolved meeting authorization, optimistic positions, and
  strict request/response schemas.
- Participant-visible cursors exclude other owners' private events; global
  stream positions remain server-internal so private activity does not create a
  cross-owner timing/count hint.
- Persistent idempotent replay covers source registration and two-event
  approval, and the browser reuses operation keys to recover after a lost
  successful response.
- Participant disclosure UI with editable exact-excerpt selection, complete
  outgoing preview, explicit approve/keep-private actions, and animated shared
  Evidence arrival with reduced-motion behavior.
- Shared Evidence hydrates from persisted events after reload and appears for
  every assigned participant, while owner-private source material remains
  excluded.
- Integration proof that cross-owner source access and tampered preview hashes
  fail, no shared event exists before approval, and unapproved surrounding text
  never enters the shared event.
- Startup artifact-storage probe with readiness degradation and a stable 503
  error when the configured local path is unusable.
- ER-03 dated verification of the current GPT-5.6 Responses/Structured Outputs
  path, including a live synthetic `gpt-5.6-sol` exact-range smoke.
- A3 OpenAI private-disclosure adapter with pinned SDK, strict Zod output,
  prompt/schema versions, `store: false`, source-reference and exact-range
  enforcement, capped retry, deterministic fake, and content-free structured
  usage/latency logs.
- Architecture checks now constrain the OpenAI adapter to application/ports and
  its explicit provider/schema dependencies.
- Application proof that provider failure cannot append a disclosure event.
- A4 runtime wiring selects live, disabled, or test-only deterministic private
  assistance without reading secrets inside the adapter package.
- `ai_preferred` and explicit `manual` proposal modes preserve one HTTP
  boundary; AI-unavailable responses map to a redacted retryable 503 and the UI
  retains an explicit manual-excerpt path.
- AI proposals are replayed before any provider call for the same
  owner/meeting/source/idempotency key, preventing duplicate spend and
  nondeterministic retry conflicts.
- Browser proof covers AI-assisted owner-only origin, exact preview and
  approval, isolated dependency failure/manual recovery, mobile rejection, and
  reduced motion. Screenshots and reel clips are current.
- A5 shared-only Decision synthesis with strict structured output, source
  validation, model/reason/confidence provenance, capped retry, deterministic
  fixtures, and a successful live `gpt-5.6-sol` synthetic smoke.
- Facilitator-private candidate persistence and idempotent replay happen before
  provider invocation; shared event records never contain model metadata or
  rejected candidate material.
- Explicit candidate confirmation/rejection materializes canonical premises,
  dissent, and bounded Actions only after facilitator action. Manual authoring
  uses the same confirmation boundary and records truthful origin.
- L6 Decision lifecycle through DRAFT, derived five-condition readiness,
  facilitator-only `DECISION_READY`, explicit COMMITTED revision 2, immutable
  history, and participant-readable audit lineage.
- Shared Decision hydration survives reload and is visible to assigned
  participants without facilitator controls; participant-visible positions
  preserve idempotent historical receipts.
- Browser proof covers AI candidate provenance, premise editing, readiness,
  explicit commit, reload persistence, separate-participant visibility,
  responsive mobile layout, and reduced motion. Five current screenshots and
  one candidate-to-commit reel clip accompany the test.
- L7 production-like Docker Compose path builds one pinned Node image, serves
  built React and API from one origin on `0.0.0.0`, waits for readiness,
  persists SQLite and artifacts in a named volume, and starts without an
  OpenAI key.
- D1 monitor registration generates the typed registration ID server-side,
  appends a shared system-authored `MonitoringStarted` event, preserves the
  immutable committed revision, supports exact idempotent replay, and
  transitions the shared Decision from `COMMITTED` to `MONITORING`.
- D2/D3 regulatory receipt uses strict schema-v1 payloads, exact raw-body
  HMAC-SHA256 with a five-minute timestamp window, constant-time comparison,
  durable event-store idempotency, and meeting/registration matching. Signed
  webhook and facilitator-only staged demo transports converge on one
  normalized use case while retaining truthful system/participant provenance.
- External receipt and `evaluationStatus=pending` hydrate for all assigned
  participants while the Decision remains `MONITORING`; invalid signatures
  append nothing. Two new screenshots and the extended reel clip document the
  state.
- D4 builds a bounded model input only from the immutable active committed
  revision, confirmed shared premises/Evidence/Actions, monitor condition, and
  normalized external event. Both the OpenAI adapter and application layer
  reject invented or incoherent references.
- Successful evaluation atomically appends AI-authored
  `AssumptionInvalidationSuggested` and system-authored
  `DecisionMarkedAtRisk`; the suggestion causally follows receipt, preserves
  model/prompt/schema/input provenance, and leaves the committed revision
  unchanged. `REVIEW_REQUIRED`, Action hold, and task creation remain absent.
- Live synthetic D4 smoke succeeded with `gpt-5.6-sol`, schema version 1,
  grounded premise/Action/external-source references, 667 total tokens, and no
  retry. Browser proof covers facilitator and participant `AT_RISK`, reload,
  mobile, reduced motion, three screenshots, and the extended reel clip.
- D5 adds a facilitator-only, reason-required review command over the exact
  recorded suggestion. Confirmation atomically records `FacilitatorReviewed`,
  transitions to `REVIEW_REQUIRED`, holds only the affected Action, and opens a
  reconsideration task. Rejection records its reason and returns to
  `MONITORING` without a hold or task.
- The shared invalidation read model now reconstructs review disposition,
  reason, held Action IDs, and reconsideration task after reload. Assigned
  participants receive the same read-only state; the mutation endpoint rejects
  participant authority.
- Browser proof covers the review workbench, required reason, confirmation,
  audit lineage, reload, participant view, mobile reduced motion, five new
  screenshots, and a dedicated review clip.
- D6 adds facilitator-only, discriminated resolution commands for a new
  committed revision, superseding replacement, or Decision rejection.
  Recommit derives revision 3 server-side, preserves all canonical references,
  validates append-only history, and records `DecisionRevisionCommitted`;
  supersede and reject leave the prior revision count unchanged.
- The UI shows revision 2 beside the proposed revision 3, then retains all
  three snapshots and the D5 review context after commitment. Assigned
  participants receive the new current state without resolution controls.
- Authorized Decision JSON export returns the current Decision, every revision,
  and filtered audit lineage. Browser proof covers resolution choices,
  before/after editing, recommit, export, reload, participant desktop, and
  mobile reduced motion with five screenshots and one clip.
- D7 adds a state-derived five-stage guide from Context through Review. The
  staged regulatory control names the expected synthetic EU premise/Action
  impact before injection, and the full lifecycle E2E verifies every cue.
- Facilitator-only demo reset atomically records deterministic request/completed
  lineage, clears private/shared projections for only the target meeting,
  preserves membership and the synthetic seed, supports exact idempotent
  replay, and rejects participant authority.
- Browser proof covers the two-step reset confirmation, restored Context,
  cleared shared Evidence, participant control absence, desktop, mobile, and
  reduced motion. The rehearsed reel map targets 2 minutes 30 seconds with
  explicit synthetic-story labeling.
- L3 now exposes a strict role-projection query and a real Node WebSocket hub
  authenticated by 30-second, one-time, digest-stored tickets. Tickets bind the
  session, user, meeting, participant, role, and participant-visible resume
  cursor without placing the Bearer token on the socket URL.
- Shared changes reach all active meeting members while owner-private changes
  reach only the matching participant. Realtime source entries contain
  metadata only; private bodies, storage references, raw event envelopes, and
  inactive assignments are excluded from the wire projection.
- Reconnect sends a catch-up projection before `connection.ready` and advances
  the cursor only after a successful personalized projection send. Session and
  meeting membership are passively revalidated without extending inactivity;
  logout closes active sockets and invalidates unused tickets.
- Durable event append no longer depends on transient socket delivery.
  Publication receives payload-free notices, runs after a successful append,
  and can fail without changing the committed command result. The durable
  participant-visible position remains the recovery source.
- Real HTTP/WebSocket integration proof covers the `101` upgrade on a
  `0.0.0.0` server, owner resume, cross-owner withholding followed by shared
  publication, single-use tickets, and logout revocation. The full suite is
  250 tests.
- The L3 versioned local flagship HTTP surface is complete. Capabilities that
  belong to URL/file ingestion, BYOK, voice, and hosted runtime plans remain
  explicitly in their later work packages rather than widening L3.
- L4 now includes a projector-style read-only shared display. A facilitator
  issues an eight-hour meeting-scoped credential whose raw value is returned
  only once; only its digest is recorded in the shared event stream.
- Issuing a new display credential rotates every active predecessor, explicit
  revocation and demo reset fail closed, and the display clears its prior
  projection on the next three-second authorization refresh.
- The display DTO excludes participant lists, private workspaces, source
  titles/bodies, and private-event timing. It renders only shared Evidence,
  premises, dissent, Actions, Decisions, meeting phase, and a shared-event
  cursor.
- Browser proof covers empty, approved-Evidence, mobile reduced-motion, and
  revoked states with four screenshots and a dedicated Evidence-to-revocation
  clip. Server integration proves facilitator-only issue/revoke, digest-only
  persistence, rotation, and private-text exclusion.
- A6 now has strict BYOK configure, heartbeat, clear, and channel-scoped
  Realtime client-secret HTTP contracts. Standard keys are accepted only from
  facilitator-authorized meeting requests and are never echoed by responses,
  errors, events, projections, or logs.
- Node keeps BYOK in a meeting-scoped process-memory lease owned by the
  facilitator session. Heartbeat renews the lease; explicit clear and logout
  remove it immediately, while an unreferenced timer physically removes an
  abandoned key at the five-minute boundary even if no later request arrives.
- Assigned participants can mint separate private or shared short-lived
  secrets. Private issuance binds to the caller participant; the OpenAI request
  body excludes meeting, participant, session, and private-content metadata and
  uses only channel isolation instructions plus a pseudonymous safety
  identifier.
- The current official `gpt-realtime-2.1` client-secret path was rechecked and
  exercised successfully with the local standard key. The live smoke reports
  only channel, model, expiry, and status; it does not print either credential.
- The browser now follows the direct OpenAI WebRTC SDP path with an
  `oai-events` data channel and ephemeral Bearer credential. A6 creates no
  microphone or audio track; both private and shared sessions visibly begin
  `Mic off` and remain separate controllers.
- Each channel exposes off, connecting, connected, reconnecting, and degraded
  states. Connections close after 60 idle seconds, activity renews the
  deadline, retries are capped at 250/500/1000 ms, and manual disconnect
  suppresses reconnect.
- Facilitator BYOK is stored only in meeting-scoped tab `sessionStorage`,
  renewed by a one-minute heartbeat, removed from browser/server on explicit
  clear or logout, and never rendered after entry. Participants receive no
  standard-key control.
- Browser proof covers BYOK-required, both-channel connected, private-only
  degraded while shared remains connected, and participant mobile
  reduced-motion states. Four screenshots and a nine-second synthetic
  connect-to-degraded clip accompany the E2E.
- A7 now exposes strict acquire/release shared-floor and capture-utterance HTTP
  contracts. The server grants a 15-second lease atomically, rejects concurrent
  speakers with `SHARED_FLOOR_BUSY`, expires stale ownership before the next
  grant, and binds shared capture to the acquiring participant and immutable
  `utteranceId`.
- Exact utterance retries replay without appending; reusing an utterance ID
  with changed channel, text, timestamp, or participant fails. Private
  utterances remain owner-private while shared utterances and active floor
  state enter participant role projections and realtime snapshots.
- The browser now creates a send/receive audio transceiver without acquiring a
  microphone. Push-down alone requests a track, disables VAD, clears the input
  buffer, and enables the mic; release commits the buffer, immediately detaches
  and stops the track, then records the completed transcript through the same
  capture command used by typed text.
- Channel choice is disabled for the active utterance. Shared speech and shared
  text atomically acquire the server floor, other participants see the live
  lease as busy, and private speech/text never enters their role projection.
  Voice holds auto-stop at eight seconds inside the 15-second lease; missing
  transcription leaves no utterance and directs the user to text.
- A7 visual proof covers owner-private text, shared text propagation,
  exaggerated live push-to-talk motion, cross-participant floor exclusion, and
  transcript capture. Three dedicated desktop screenshots, the updated mobile
  reduced-motion screenshot, and a synthetic two-participant clip accompany
  the browser test.
- A8 now gives the Realtime dock an explicit durable-continuity strip. It
  independently reports meeting-state reads, always-available manual text, and
  optional AI/voice status while documenting the three-attempt reconnect cap.
- A missing BYOK lease maps to a safe `API key required` recovery message.
  Clearing the lease disconnects both channels but does not clear the role
  projection or meeting events; server integration compares the complete
  projection before and after clear.
- Synthetic Realtime/SDP failure exhausts 250/500/1000 ms retries and still
  captures an immutable owner-private typed command. Synthetic OpenAI Decision
  failure retains approved Evidence and reaches a human-authored committed
  Decision through the same premise confirmation, draft, readiness, and commit
  boundaries.
- Every committed Decision now exposes its JSON export beside visible audit
  lineage, not only after review resolution. The degraded browser scenario
  validates the UI download plus strict audit/export APIs without provider
  recovery.
- A8 visual proof includes four screenshots and two clips spanning Realtime
  fallback, BYOK loss, manual Decision editing, audit, and export. All content,
  peers, credentials, and failures are synthetic.
- A1 accepts validated PDF, Markdown, plain text, and JSON uploads under strict
  filename, claimed-type, UTF-8/magic, parse, 20 MB file, 10-item owner, and
  100 MB meeting limits. Source and derived bytes have separate scoped storage
  records, IDs, hashes, sizes, and owner-authorized downloads.
- Uploaded document derivatives now feed the existing owner-private disclosure
  path without re-registering source text. Failed extraction stores only the
  private source and exposes a safe processing state without content-bearing
  errors; cross-owner existing and missing retrievals are indistinguishable.
- The A1 vault UI shows validating/processing/processed/failed states, explicit
  source/derived controls, and private activation before exact preview. Three
  synthetic screenshots and one clip record desktop processing/preview and a
  reduced-motion cross-owner empty state.
- A2 accepts only credential-free HTTP/HTTPS on default ports. It requires
  every DNS answer to be globally routable, pins the socket to a checked IP,
  re-resolves every redirect, and fails closed after three redirects, ten
  seconds, 20 MiB, unsupported content types, or any content encoding.
- URL locators are normalized and persisted only as hashes. Source bodies and
  prompt-injection text remain owner-private, enter the same separately hashed
  derivative/disclosure path as uploads, and never auto-publish. Fifty-five
  deterministic adapter fixtures cover IPv4/IPv6, metadata, mixed DNS,
  rebinding-resistant pinning, redirects, timeout, bytes, encoding, type, and
  safe filename handling.
- A2 visual proof adds two screenshots and one clip for the public-URL safety
  gate and private exact preview. The displayed locator and fetched body are
  synthetic; the browser substitution and real transport security suite are
  documented separately in the capture notes.
- Plan 05 C1 now provides the Worker-first `/api`, `/health`, and `/ready`
  boundary with React SPA assets, four ordered D1 migrations matching the
  Node SQLite tables and constraints, a meeting/visibility/owner-partitioned
  R2 artifact adapter, and one SQLite-backed Durable Object namespace selected
  with `idFromName(meetingId)`.
- Preview setup is reproducible without remote mutation: Wrangler bindings and
  generated types are contract-checked, the resource script defaults to a
  no-change plan and requires an explicit approval flag to create D1/R2
  resources, and deploy/secret/remote-migration actions remain deferred.
- Every committed Wrangler path binds development to `0.0.0.0` where
  applicable, disables `.env` fallback and telemetry, writes logs only under
  ignored `.wrangler/`, and keeps the judge secret absent. The local smoke
  reaches the Worker through `127.0.0.2`, verifies static HTML, health,
  migration-aware readiness, and protocol-safe API fail-closed behavior, then
  proves the port is released.
- The complete verification surface now passes 397 unit/contract/integration
  tests and all 15 browser E2E scenarios, in addition to Worker dry-run/local
  smoke, build, lint, typecheck, formatting, architecture, environment, and
  Compose checks.
- Plan 05 C2 now runs the same event, projection, and artifact contracts
  against D1/R2 and SQLite/local storage. D1 primary-session batches and SQLite
  `BEGIN IMMEDIATE` transactions atomically persist events, idempotency
  receipts, and owner-partitioned projections; replay, conflicts, and failed
  projection writes cannot rewrite or partially commit state.
- A fifth D1 migration rejects non-contiguous positions and incomplete
  idempotency ranges. The Cloudflare-native Vitest pool applies all migrations
  in isolated Workers storage and cannot inherit `.env`; its script builds the
  current workspace first so stale `dist` output cannot mask source changes.
- The meeting Durable Object now coordinates only 30-second ticket digests and
  payload-free publication metadata. Its shared contract proves monotonic
  ordering, semantic idempotency, participant-visible resume cursors, display
  ticket revocation, reset continuity, and D1 snapshot fallback after an
  unknown cursor without storing private content or a provider key.
- C2 verification passes 399 normal tests plus 9 Cloudflare-native D1/DO
  tests, full build/lint/typecheck/format/architecture/config/environment/
  Compose checks, local migration and external-IP-style Worker smoke, generated
  binding checks, and deployment dry-run. No UI changed, so no new browser
  capture was required.

## In progress

- Plan 05 C4 now has migration 0006 and a D1-backed durable usage reservation
  ledger. One conditional insert enforces account, hashed-IP, meeting,
  concurrency, Realtime-second, token, generation, and integer micro-USD
  dimensions across a rolling 24-hour window. A database trigger independently
  fixes the global product ceiling at USD 25.
- Reserved or outcome-unknown work remains charged at its full estimate
  without aging out; finalized actuals remain charged for 24 hours from
  settlement. Finalization is idempotent and cannot exceed any reserved field;
  release is idempotent only before finalization, and overlapping requests can
  settle out of order. Tests cover every dimension, exactly USD 25 plus one
  micro-USD, exact 24-hour expiry, unknown-outcome retention, concurrent
  requests, adapter recreation, lifecycle invariants, direct-write trigger
  defense, and keyed HMAC-only IP storage. A monotonic timestamp trigger also
  rejects out-of-order privileged inserts that would otherwise evade a
  historical rolling-window check.
- A server-owned unified WebRTC connector now captures the standard key, sends
  a bounded multipart SDP/session request with a pseudonymous safety
  identifier, validates response content type/size and the exact provider call
  location, fixes the key-bearing destination to the official HTTPS endpoint,
  and keeps both the key and call ID out of the browser protocol. Its
  acceptance hook exposes the call ID to the trusted call controller before SDP
  body validation, allowing accepted but malformed responses to remain
  terminable.
- A dedicated Durable Object now owns each judge Realtime reservation/call
  pair. It requires the exact active full-cap D1 reservation and stores a
  durable connecting claim before provider work, then stores the provider call
  ID before browser SDP is returned. Transactional state changes reject
  concurrent starts, terminate-before-claim, terminate-during-connect, late
  provider acceptance after cancellation, and stale telemetry writes after
  settlement. The controller reuses one lifecycle/socket owner across requests
  and alarms, schedules a 30-second alarm, invokes the official authenticated
  hangup endpoint, and retries settlement without duplicate hangups. Accepted
  calls with a later malformed SDP response are terminated immediately;
  unknown provider outcomes remain conservatively charged.
- The current OpenAI sideband, `response.done`, and `gpt-realtime-2.1` pricing
  contracts were rechecked on 2026-07-19. A new provider adapter extracts only
  event/response IDs and complete text/audio/image/cached token counts, prices
  them with exact deci-micro-USD arithmetic and conservative rounding, and
  stores no transcript, audio, output item, meeting, participant, or source
  content.
- The telemetry accumulator is idempotent for exact repeated events and
  permanently fails closed on malformed totals, reused/conflicting identities,
  separately billed transcription, unsafe integer growth, or any reserved
  cost/token/generation overflow. It now receives the provider sideband stream
  but is not used for lower settlement; missing telemetry still leaves the full
  USD 25 reservation charged.
- An outbound, API-key-authenticated sideband WebSocket is now attached to the
  accepted call ID before browser SDP can be returned. Its provider origin is
  fixed, frames are bounded ordered text JSON, and only the content-free
  accumulator projection is persisted in Durable Object storage. The status
  surface exposes trust and generation count without exposing the call ID or
  provider content.
- The sideband now owns the judge session and generation command boundary. It
  sends a fixed `session.update` with automatic VAD response creation and
  interruption disabled, requires the matching `session.updated`
  acknowledgement, and exposes no generic provider-event send method. Only
  fixed `response.create` and `response.cancel` commands are available.
- The call controller derives response creation from ordered server-observed
  speech stops, cancels on barge-in, serializes replacement generation after
  cancellation completion, and caps commands at three. Unsolicited or duplicate
  response creation, completion without creation, provider command errors, and
  a fourth command all terminate and conservatively settle the call.
- Managed SDP now requires exactly one audio media section and rejects data
  channels, video, SCTP attributes, and missing or multiple media sections. A
  separate browser transport offers only an audio transceiver and explicitly
  terminates the server-managed call on close; it does not alter the existing
  facilitator BYOK/data-channel path. A live Chromium smoke on 2026-07-19
  confirmed that the official unified Realtime endpoint accepts this
  media-only offer without exposing secrets or provider call IDs.
- Input transcription is fixed to `gpt-realtime-whisper` and its official
  duration usage is accounted separately from Realtime response tokens. The
  checked USD 0.017/minute rate makes the 30-second maximum USD 0.0085; duration
  cost and seconds now join the same content-free accumulator and reservation
  limits. Missing, token-based, malformed, conflicting, or over-limit
  transcription usage fails closed. The reservation pricing version now pins
  both the Realtime and transcription rate cards.
- Strict managed-call protocol contracts now expose only an opaque app handle,
  utterance-bound begin-turn, bounded transcript retrieval, and termination.
  Provider call IDs, item IDs, credentials, and metadata are rejected. The
  Durable Object binds a pending app utterance to the server VAD item, persists
  usage before making a completed transcript available, and retains transcript
  text in memory only. Storage, status, usage entries, errors, and logs remain
  content-free; mismatches, conflicting duplicates, transcription failure, and
  restart loss terminate rather than reconstructing private state.
- Sideband setup failure, attachment-time disconnect, provider disconnect,
  malformed/future billable telemetry, and observed reservation overflow all
  invoke authenticated hangup and settle the full reservation. Server-initiated
  close is distinguished from provider loss, invalid/error frames actively
  close the underlying socket, and termination is serialized so callbacks,
  requests, and alarms cannot duplicate hangup or settlement.
- Trustworthy measured usage does not yet reduce settlement; the full
  reservation remains the safe charge for every outcome.
- Production keyed IP input now uses Web Crypto HMAC-SHA-256 with a distinct
  `JUDGE_IP_HMAC_SECRET`. The Worker requires at least 32 secret bytes and a
  canonical `CF-Connecting-IP`, binds the resulting keyed digest to that exact
  request IP, and never persists or emits the raw address. Config, environment,
  deploy, and secret-scan contracts prevent this key from becoming an ordinary
  variable or reusing the OpenAI key.
- Forward-only D1 migration 0007 now persists one opaque managed-call handle
  per active usage reservation with exact user, session, meeting, participant,
  channel, and expiry ownership. Conditional insert and uniqueness close the
  double-claim race; lookup and idempotent termination require every owner
  dimension. The reusable Worker resolver re-authenticates and re-resolves the
  active meeting assignment and allowlisted judge capability before resolving
  the handle, including revocation, assignment removal, cross-meeting, IDOR,
  and storage-failure fail-closed paths.
- The Worker now contains a public managed-call adapter for start, turn,
  transcript, and terminate. It re-authenticates the meeting and opaque
  handle on every operation, creates the D1 reservation and ownership claim
  before addressing the Durable Object, derives the provider safety identifier
  server-side, and maps internal errors/pending transcripts to public DTOs
  without provider or reservation identifiers. The route is still explicitly
  disabled by the ordinary `JUDGE_MANAGED_REALTIME_ROUTE_ENABLED=disabled`
  preview variable until measured limits and hosted proof close; verified IP
  input remains mandatory even if a deployment enables the adapter.
- Remaining gates are authenticated hosted API parity, Worker success/limit
  integration against the public route, measured flagship limits, and
  settlement behavior that does not consume the entire daily allowance for
  every attempt.
- Direct Worker judge client-secret issuance is now intentionally fail-closed,
  configured Secret or not. This removes the multi-use ephemeral-token bypass
  while retaining ordinary Node BYOK behavior and all durable/manual flows.
  Remote Secret registration remains gated.
- Plan 05 C5 now has a reproducible `npm run security:verify` foundation. Its
  283-case matrix, including parser-normalized loopback notation, gives strong
  IDOR/meeting/owner, session/display expiry, DNS-pinned SSRF/redirect,
  disclosure preview/prompt-injection, artifact, webhook, API/Realtime, and
  content-free log regression coverage. Its repository scan includes tracked
  and non-ignored untracked files plus built workspace output, rejects
  secret-bearing filenames, and never prints matched values. D1-backed
  application authentication now proves exact inactivity and absolute expiry,
  durable revocation, logout, and post-revocation rejection.
- Node HTTP authentication remains active one millisecond before inactivity
  expiry, rejects and durably revokes at exact inactivity/absolute expiry, and
  applies the same exact TTL boundary to display tokens. Wrong-meeting display
  access returns the same content-free expired envelope.
- HTTP IDOR coverage now includes an account legitimately assigned to two
  meetings substituting an existing artifact ID across meeting paths; existing
  and missing IDs return the same forbidden envelope. Cross-owner disclosure
  preview, approval, and rejection likewise return the same forbidden result
  for existing and missing candidates with no event-stream mutation.
- HTTP multipart security now covers fake PDF, invalid JSON, and
  extension/MIME mismatch payloads. Malformed supported types remain
  owner-private failed sources with no derived/shared representation; mismatched
  types are rejected before persistence. Both an overstated `Content-Length`
  and an understated header with an actual file over 20 MiB are rejected
  without storage or event writes. A correctly signed webhook one second beyond
  its replay window is rejected without changing the event stream. Concurrent
  duplicate delivery produces one receipt and one replay; concurrent changed
  payloads sharing an event ID produce one receipt and one conflict, with
  exactly one stored event in both cases.
- All shared C5 rows now have executable coverage, including synthetic canaries
  across API provider failures, Realtime state/errors, structured logs,
  protocol envelopes, repository files, and generated output. The hosted
  Worker flagship now proves the authenticated source-to-Commitment-to-
  `AT_RISK`-to-`REVIEW_REQUIRED` path, facilitator-only reset, reset replay,
  and post-reset collection clearing. C5 remains open for rerunning the full
  security matrix against hosted Worker routes after the approved provider and
  deployment boundary is available.
- Plan 05 C6 now has no-mutation preview/production plan commands, a
  dispatch-only `main` workflow protected by target-specific GitHub
  Environments, and a fail-closed deployment driver. Generated remote configs
  and raw Wrangler output remain in ignored `0600` runner state; local `.env`
  loading and every OpenAI/Webhook secret are explicitly disabled or unset.
- C6 preflight validates the HTTPS origin, runs the complete security suite,
  renders exact D1/R2/Worker bindings, and performs a strict target-config dry
  run before any remote phase. Approved apply mode then orders forward-only D1
  migration, strict deployment, bounded health/readiness/SPA/authentication
  smoke, and credential-free commit/configuration hash recording.
- The current remote smoke verifies health, migration readiness, the SPA, and
  the unauthenticated authentication boundary; the authenticated flagship
  smoke is now available as `npm run cloudflare:smoke:flagship -- <origin>` and
  is wired into approved deployment. An approved remote migration/deployment
  and a real deployment record remain open. The rollback and judge-secret
  shutdown runbook forbids schema down migration and secret-value inspection.
  No remote resource, secret, migration, deployment, or repository visibility
  changed during this preparation.
- The minimum hosted flagship read path is now wired: migration 0008 seeds
  synthetic demo identities and the Work & Productivity flagship meeting;
  Cloudflare scrypt authentication, persisted Bearer sessions, assigned
  meetings, and role projection are served by the Worker. Two Cloudflare
  integration cases use external-host-style URLs, and the local Wrangler smoke
  performs a facilitator demo reset, then reaches login, meetings, projection,
  private text, and the four read collections through `0.0.0.0`.
- The hosted read model now also serves the web client's shared evidence,
  decisions, external-event receipts, and invalidation-evaluation list
  contracts through the same authenticated meeting boundary. The four
  collection routes are covered by the external-host-style Cloudflare
  flagship test and remain read-only.
- The first hosted mutation slice is now wired for private text sources,
  manual disclosure proposal/preview, approval, and rejection: the Worker
  validates the authenticated meeting boundary, writes the source to R2,
  appends D1 events, refreshes the projection, and returns protocol receipts
  without exposing storage credentials. The Cloudflare flagship test covers
  the source receipt, candidate transitions, shared evidence after approval,
  and visibility after projection reload.
- A facilitator can now save a manual hosted decision draft that references
  shared evidence; the Worker keeps application readiness and ownership checks
  authoritative, returns the revision receipt, and rehydrates the DRAFT
  decision in the shared projection. Ready/commit routes remain gated by those
  application-level reference and readiness checks.
- Hosted manual Decision candidates now materialize confirmed Premises and
  Actions, after which the same Worker path reaches `DRAFT` → `DECISION_READY`
  → `COMMITTED`. The external-host Cloudflare test covers this full
  source-to-Commitment journey without an OpenAI call.
- The hosted flagship reaches `MONITORING` through the authenticated Worker
  path. Provider-free integration dependencies exercise the staged regulatory
  event, `AT_RISK`, `REVIEW_REQUIRED`, Action hold, and reconsideration task
  without entering the production Worker bundle. Rendered preview and
  production configs keep provider access disabled until the separate judge
  gate is approved.
- Judge-funded private disclosure, shared Decision synthesis, and assumption
  invalidation now use the same request-scoped managed lifecycle only after the
  exact gate, allowlisted judge, current authorization, canonical request IP,
  and both required Worker Secrets are present. Manual paths remove provider
  dependencies, create no judge claim or ledger row, and preserve truthful
  `human_selected`/`ai_assisted` origin.
- Hosted demo reset is now wired through the same authorization, event, and
  projection boundaries. It clears private/shared read models without rewinding
  the event cursor, supports exact idempotent replay, and rejects participant
  authority. The external-host Cloudflare flagship test covers the full
  `MONITORING` → `AT_RISK` → `REVIEW_REQUIRED` → reset journey and verifies
  reset collections are empty afterward.
- A reusable authenticated Cloudflare flagship smoke now exercises the real HTTP
  lifecycle from login/reset through private text, disclosure
  preview/approval, manual candidate/disposition, DRAFT, READY, COMMITTED,
  MONITORING, staged invalidation/review, and reset replay. The approved
  deployment driver keeps remote provider access disabled by default; provider
  work and its successful lifecycle proof remain a separate approval gate.
- A Worker-specific Playwright browser project now runs against Wrangler's
  `0.0.0.0` server and passed the external-style Product journey: SPA load,
  login, assigned Work & Productivity meeting, workspace render, and same-host
  API request verification. It does not use the Node API webServer used by the
  general E2E project.
- Hosted C5 coverage now includes a separate participant session proving that a
  facilitator's private source is absent from the participant projection and
  that cross-owner disclosure proposal and demo regulatory mutation are denied.
- The enabled managed Realtime Worker route now has one Cloudflare integration
  proof covering judge authentication, cross-meeting isolation, turn and
  transcript forwarding, termination settlement, and the next-call
  `USAGE_LIMIT_REACHED` boundary. The test uses a synthetic controller stub, so
  no provider call or API spend occurs.
- Managed Realtime start now claims a required idempotency key before the
  USD 25 usage reservation. Migration 0009 persists only scoped SHA-256
  fingerprints, owner identifiers, an opaque app handle, and expiry; it stores
  no SDP, provider ID, credential, or private content. Exact concurrent/retry
  requests cannot create another reservation, changed payloads conflict, and
  an integration assertion proves one ledger row after replay.
- The D1 limiter now returns a content-free rolling-24-hour summary across
  account, keyed-IP, meeting, concurrency, cost, generation, Realtime seconds,
  and tokens. It counts reservations at full estimate, finalized rows at actual
  usage, excludes releases, and exposes only used/limit/remaining. This closes
  the storage/query foundation for operator visibility. The Worker now exposes
  it through a strict meeting-scoped GET boundary that re-authenticates the
  Bearer session, assignment, and judge capability, then uses canonical
  `CF-Connecting-IP` only to select the keyed-IP counter. The response contains
  no account, IP, meeting, reservation, provider, credential, or content
  fields and remains available while provider access and the managed-call
  route are disabled.
- All locally implemented judge billable paths now reserve before provider
  work and share the fixed USD 25 rolling-24-hour ceiling. Managed Realtime and
  all three structured-output operations have duplicate suppression, immutable
  identity checks, typed `USAGE_LIMIT_REACHED`, and fail-closed provider gates.
  The managed Realtime and structured-AI routes remain disabled by default.
  Measured secondary limits, the full hosted security-matrix rerun, and
  approved provider enablement remain later gates.
- The real Worker-to-Durable-Object binding now has a provider-free integration
  proof in addition to the synthetic-controller path. The request reaches the
  registered `JUDGE_REALTIME_CALLS` namespace, observes the DO's
  `not_configured` state, returns a redacted 503 before provider work,
  terminates ownership, releases the reservation, and persists no SDP or
  provider ID. The successful real-DO lifecycle still requires the approved
  provider boundary.
- A content-free Judge Realtime measurement harness now accepts strict JSONL
  rows containing only cost, generation, input-token, output-token, and
  Realtime-second counters and emits deterministic distribution summaries. Its
  collection protocol requires at least 20 approved-provider flagship
  sessions, trustworthy totals, 100% headroom above observed maxima, and
  worst-case rate-card validation before any production limit changes. No
  synthetic fixture is represented as measured production usage.
- A server-owned Realtime access descriptor now closes Plan 03 A6. Node
  ordinary sessions resolve an active transient BYOK lease; fully gated Worker
  judge sessions resolve managed access; every other state is unavailable.
  The response exposes only a correlation ID and mode after fresh
  authentication and assignment resolution. The browser cannot select or
  inherit key source, reservation, provider call, participant, or session
  identity. It now switches between direct ephemeral WebRTC and same-origin
  managed start/turn/transcript/terminate routes, preserves one idempotency key
  across ambiguous starts, and rotates it only after an established peer
  failure. Managed voice uses the immutable utterance ID and synchronizes the
  returned meeting position so later reset/mutations do not conflict.
- Browser proof now covers direct BYOK, credential-free judge-managed access,
  private/shared voice, participant key-control absence, external-style host
  resolution, and responsive mobile rendering. Two current synthetic
  screenshots record the managed connected/transcript state; no reel
  production was performed.
- Judge usage visibility is now product-facing without widening authorization.
  The strict Realtime descriptor carries only `usageSummary=available|hidden`:
  a freshly authorized Worker judge can inspect the content-free rolling
  24-hour summary even while managed provider work is disabled, while ordinary
  and Node sessions remain hidden. The browser fetches the authoritative
  same-origin route, renders the USD 25 budget and all eight dimensions, and
  exposes explicit available, exhausted, loading, and retryable unavailable
  states without polling or identifiers.
- Browser evidence covers explicit refresh, same-origin external-style host
  resolution, synthetic limit exhaustion, responsive mobile layout, reduced
  motion, and meter failure while durable text remains available. Four
  dedicated screenshots are recorded under
  `docs/media/screenshots/judge-usage/`; reel production remains outside the
  active product-visibility goal.
- Judge-funded private-disclosure structured output now uses a separate
  disabled-by-default Worker gate and one content-free D1 claim before the
  shared usage reservation. Exact replay never invokes the provider twice,
  changed source content conflicts, and a generation-bound release cannot
  remove a newer claim. Manual and ordinary-user paths remain provider- and
  ledger-free.
- Shared Decision synthesis and assumption invalidation use operation-specific
  decorators around the same lifecycle. Their request fingerprints bind model,
  pricing/canonicalization version, authorized scope, application identity,
  and canonical structured input. External-event receipt persistence remains
  durable before invalidation limit/provider outcomes, so 429 and 202 pending
  responses do not hide accepted text or remove manual recovery.
- The bounded OpenAI adapter reports content-free per-attempt token usage only
  to the Worker orchestrator. The path reserves USD 5.50 and at most two
  generations inside the fixed USD 25 rolling-24-hour limits before provider
  work; trustworthy usage settles actual calculated cost, while missing,
  malformed, or provider-started failure usage settles the full reservation.
  Preview and production render with the route and provider mode disabled and
  never render either judge Secret as an ordinary variable.
- Provider-free integration proves claim, reservation, settlement, replay,
  duplicate suppression, conflict, exhausted-budget, ordinary-user, manual,
  unsafe-configuration, and D1 privacy behavior. Independent spec and quality
  review found and closed all Critical/Important findings. No provider request,
  Secret registration, remote mutation, or UI change occurred in this slice.
- Migration 0011 adds the durable reserved/provider-started/settled lifecycle
  and bounded reconciliation. Migration 0012 keeps a request fingerprint unique
  only while its usage reservation is active, preserving concurrent duplicate
  suppression while allowing the same logical operation after the claim's
  25-hour retention boundary. Worker readiness now requires the exact 0012
  migration set.
- The operator reconciliation command now receives its shared statement
  builders explicitly. The production CLI imports the built adapter only after
  the documented workspace build, while contract tests inject the source
  builders and therefore pass in a clean checkout before any build artifacts
  exist.
- The current regular baseline is 805 Vitest tests, the contract project passes
  130 tests, and the Cloudflare pool passes 11 files and 141 tests. Formatting,
  ESLint, typecheck, build, architecture, secret scan, environment, generated
  Worker types, and Cloudflare configuration checks pass. The Worker-specific
  browser E2E passes both external-style Wrangler cases, and the complete Node
  browser suite passes all 18 cases in one run. Since no UI changed, no new
  visual capture was retained. Reel shooting and reel-material organization
  remain deferred from the active goal; product visibility stays the priority.

## 2026-07-20 local deployment-readiness closeout

- The facilitator meeting list now includes a browser-native fixed-identity
  creation path. It creates one facilitator plus two to four selected
  participants, enters the new workspace, and remains server-authorized.
  A lost successful response is retried with the same operation key, so reload
  proves only one room exists; separate Safety and Legal browser contexts prove
  the selected assignments.
- Dedicated browser acceptance proof now covers Meeting A/B isolation across
  projection, shared Evidence, Decisions, Realtime access, and private artifact
  retrieval, then resets only the flagship and proves Meeting B's purpose and
  owner-private source remain unchanged.
- Keyboard coverage includes visible focus, login, code join, disclosure
  preview/keep-private, and push-to-talk Enter down/up behavior. Axe reports no
  serious or critical WCAG 2 A/AA/2.1 AA violations in the exercised login,
  meeting-list, workspace, and mobile reduced-motion states. The horizontally
  scrollable mobile progress rail is now keyboard-focusable.
- Focused browser proof now holds the assigned-meeting GET long enough to
  observe `aria-busy=true` and the loading skeleton before normal completion.
  It also runs Axe's WCAG 2.2 `target-size` rule against the meeting list and
  checks computed reduced-motion animation, iteration, and transition values. A
  controlled durable-projection 503 renders explicit `Offline` and
  reconnection copy, then returns to `Live` after the route recovers. Together
  with the existing empty, success, error, degraded, and limit journeys, this
  closes the explicit async-state checklist.
- Q2 accessibility and polish coverage is materially expanded but the
  all-control audit remains open. Shared keyboard activation helpers cover
  disclosure, artifact, Decision, monitoring, review, reset, display-token,
  Realtime, and shared-display controls. Browser proof covers visible focus
  and focus handoff for generated previews, private rejection, approved
  Evidence, Decision transitions, reset confirmation, and display-token
  issue/revoke. Axe and computed-color checks currently cover login,
  meeting-list, representative workspace, and mobile reduced-motion states;
  state-by-state contrast, target-size, label, and live-region audits for the
  later Decision/risk/review surfaces remain residual.
- The flagship UI is explicitly isolated from ordinary rooms. Only
  `meeting-global-ai-rollout` receives the five-stage guide, synthetic source,
  staged regulatory injection, regulatory launch defaults, and deterministic
  demo reset. Newly created rooms start with no selected private source,
  neutral Decision fields, no staged progress rail, and no unsupported
  monitoring or demo-story claim.
- Shared Evidence HTTP contracts and both Node/Worker projections now expose
  the same visible grammar: `Shared`, `Source`, `Human confirmed`,
  `Approved exact excerpt`, and an expandable source reference with the
  complete artifact ID. Approval revalidates the actual readable derived bytes
  against the processed-content hash, so an uploaded document changed after
  preview fails with
  `DISCLOSURE_PREVIEW_MISMATCH` and publishes nothing.
- Node Evidence hydration now reads the reset-aware role projection instead of
  enumerating every historical `EvidenceShared` event. A fresh participant
  browser after a second flagship reset sees Context, no shared Evidence, and
  no facilitator reset controls; the earlier Evidence remains only in the
  append-only audit history.
- Shared Evidence/Decision list queries now build their reset-aware projection
  without loading or decoding owner-private source bodies. The full owner
  workspace projection still loads its own active private sources, while
  Realtime and shared-list paths retain only the metadata and shared state they
  need.
- Demo reset now establishes an application-level generation boundary for
  disclosure mutations as well as projections. A pre-reset candidate, source,
  processed derivative, or AI proposal replay cannot be reused afterward; old
  idempotency keys are rejected before provider work, while all historical
  events remain available for append-only audit replay. Published Evidence is
  also domain-constrained to shared, human-confirmed source artifacts so the UI
  grammar cannot silently mislabel a future producer.
- Normal E2E writes screenshots and clips under `test-results/evidence/`.
  `npm run e2e:capture` is the explicit path for intentional updates under
  `docs/media/`, preventing CI and verification reruns from silently replacing
  committed evidence. The generated media manifest preserves reviewed
  provenance and fails closed when a new PNG/WebM has no explicit review.
- The Q2 closeout capture reran 20 browser scenarios with synthetic data,
  refreshed the affected Evidence/Decision/reset/shared-display assets, and
  added the generic-room empty state under
  `docs/media/screenshots/meeting-creation/`. The reviewed first-party
  provenance manifest is current. This remains development evidence hygiene;
  Q3 asset completion and Q5 reel production have not started.
- A deterministic direct/transitive lockfile inventory now fails closed on
  missing package-license metadata. It records review-required identifiers but
  does not claim to replace authoritative package license/NOTICE or final
  bundle review. Project metadata remains `UNLICENSED` until the product owner
  makes the final public-license decision.
- The fresh Compose smoke uses only an isolated `counterpoint-smoke-*` project,
  clears inherited provider credentials, reaches an external-style host, and
  creates a new three-user meeting. It uploads and processes a Markdown
  artifact, records a separately authenticated owner-private source, approves
  exact shared Evidence, and human-confirms a Decision through DRAFT revision
  1 and COMMITTED revision 2. After force-recreating only the app container,
  the same Bearer session verifies the created meeting projection, private
  source identity, artifact metadata, both Decision revisions, JSON export/audit
  lineage, and byte-accurate source plus normalized derived downloads. A fresh
  headless Playwright session then logs in through the served UI, opens the newly
  persisted meeting, and observes its processed artifact, shared Evidence,
  Decision title, and `Revision 2 · COMMITTED` marker before the harness removes
  only the exact temporary project and volume.
- Cloudflare preview resource creation now requires an exact 32-character
  account ID and an account-bound confirmation value. It lists D1/R2 first and
  skips exact-name existing resources, allowing a partial create to resume
  without mutating existing state. No remote resource, migration, Secret, or
  deployment was created in this closeout.
- Fresh verification passes 73 Vitest files and 826 tests, the focused security
  matrix's 300 tests, the Cloudflare pool's 11 files and 141 tests, all 27 Node
  browser E2E cases, and both real-Wrangler browser cases. Environment,
  generated notices/media, formatting, architecture, ESLint, typecheck, build,
  secret scan, Worker bindings, Cloudflare configuration, shell syntax,
  deployment plans, and Worker dry-run also pass.
- Fresh specification and code-quality reviews report no remaining Critical,
  Important, or Minor findings for the local deployment-readiness closeout.
- AC-03, AC-11, and AC-13 have direct browser proof. AC-12 is now locally
  proven by one restart journey covering the newly created meeting,
  authenticated private source, uploaded source/derived artifact, committed
  Decision revisions/history, audit export, downloads, and a post-restart
  browser rendering of those durable records. Hosted D1/DO migration and
  deployment proof remains the remote residual.

## 2026-07-20 Decision-state accessibility closeout

- Q2 keyboard/focus and accessibility audits now cover the full flagship
  workspace at DRAFT, READY, COMMITTED, MONITORING, `AT_RISK`,
  `REVIEW_REQUIRED`, recommitted, review-rejected, Decision-rejected, and
  superseded states, plus participant desktop and mobile reduced-motion
  rendering. Axe runs WCAG 2 A/AA, 2.1 AA, 2.2 AA, explicit target-size
  execution, and accessible-name checks across every visible interactive
  element in the workspace.
- State transitions move focus to the next actionable boundary: the Decision
  forge for general lifecycle changes, facilitator reason for `AT_RISK`, the
  selected resolution radio for `REVIEW_REQUIRED`, and the exact invalid field
  after review/resolution validation. Persisted `AT_RISK` and
  `REVIEW_REQUIRED` entry uses the same focus contract. Sequential Tab,
  Shift+Tab, radio-arrow, and keyboard activation proof covers the resolution
  surface and alternate human outcomes.
- DRAFT and READY have concise status regions. Later states announce only the
  lifecycle label instead of the complete Decision card. Participant external
  receipts are status regions. The required review and resolution fields carry
  `aria-invalid`, alert association, protocol-aligned length/ID checks, and a
  visible invalid border.
- Commit, risk arrival, and review transitions execute while reduced motion is
  active; computed animation/transition duration and iteration assertions also
  cover participant mobile state. Critical export and resolution targets are
  at least 44 px high.
- Review and resolution mutations are separated from follow-up read-model
  refresh. A successful human review or terminal Decision mutation is never
  rolled back in the browser merely because history, audit, export, or shared
  projection refresh fails. Stale history/audit/export values are cleared
  before terminal refresh, while transport failures remain service errors
  rather than being mislabeled as invalid replacement IDs.
- `tests/e2e/decision-commit.spec.ts` now contains seven Decision browser
  journeys, including provider degradation, the full recommit arc, successful
  review rejection, successful Decision rejection, superseded UI contract,
  review-refresh degradation, and terminal-refresh degradation. The complete
  file passes locally; focused transport and post-mutation failure reruns pass.
- Eight new synthetic screenshots cover review rejection, three field-level
  validation states, Decision rejection, supersede, supersede transport loss,
  and terminal refresh loss. They are reviewed first-party assets in
  `docs/media/ASSET_MANIFEST.json`. The otherwise equivalent
  review-refresh-loss screenshot remains a Q3 capture residual because the
  final capture process was refused by the execution approval usage limit; its
  browser behavior is automated and passing.

## Not started

- Production deployment and remaining submission assets.

## 2026-07-21 hosted preview deployment

- The automatic repository integration was disabled after it deployed an
  uncontrolled template Worker. The preview deployment boundary is now the
  explicit `bash scripts/cloudflare-deploy.sh --apply preview` command.
- Commit `bce809c` was deployed manually to the existing Worker
  `counterpoint-living-decisions` using the preview D1/R2 resources. The
  deployment ran the 300-test security matrix, 141 Cloudflare tests, target
  config dry-run, forward D1 migrations, strict Worker deploy, health/readiness
  and SPA/auth smoke, and the full Cloudflare flagship smoke successfully.
- Hosted browser verification succeeded at
  `https://counterpoint-living-decisions.gs2safari.workers.dev`: login,
  assigned meeting list, Work & Productivity flagship, five-stage guide, and
  facilitator Private/Shared workspace rendered from the deployed Worker.
- The hosted preview keeps provider-funded AI routes disabled. Judge-secret
  registration and measured spend-limit enablement remain separate gates.

## 2026-07-21 public name alignment

- The public product name is now **Descant — Living Decisions**. README, package
  description, HTML title/meta, Web Brand/ARIA labels, user-facing transport
  error, JSON export filenames, current submission-facing topic summaries, and
  media provenance labels use Descant.
- Repository/package namespaces, `@counterpoint/*` imports, fixed synthetic demo
  credential fixtures, session keys, Cloudflare resource names, and historical
  topic filenames remain unchanged as internal or historical identifiers.
- The focused external-host browser suite passed all six login/Flagship cases
  after the rename, including mobile/reduced-motion and degraded manual fallback.
  Updated synthetic screenshots/clips were captured and the media manifest was
  regenerated and checked.

## 2026-07-21 Flagship start guidance

- The logged-out login surface now identifies the route as a staged synthetic
  demo and gives the first action explicitly: `Product → Work & Productivity →
  Open workspace`. It also states that AI is optional and the manual draft path
  remains available.
- The assigned-meeting surface labels the seeded Flagship as the first route,
  with no room setup required. The existing create/join controls remain as
  secondary capability paths.
- The external-host login/Flagship browser suite passes all six cases after the
  guidance change, and the affected synthetic screenshots/clips plus manifest
  were refreshed. Full value-arc rehearsal and hosted safety gates remain open.

## 2026-07-21 public-safety verification baseline

- `npm run security:verify` passes with the required external-bind permission:
  repository/generated-output secret scan, 300 security-matrix tests, and 141
  Cloudflare pool tests all pass.
- `npm run cloudflare:config:check` passes. Preview configuration keeps
  `OPENAI_MODE`, managed Realtime, and structured judge routes disabled; the
  Worker requires judge identity, provider Secret, and distinct IP-HMAC Secret
  before managed routes can be enabled.
- This is local/contract evidence only. Hosted C5 rerun, logged-out/incognito
  production-like judge/ordinary/display smoke, measured derived limits, and
  production Secret registration remain open.

## 2026-07-21 Descant preview deployment

- Commit `9e2184a9cd60e7240363f2e007f25bdb4034b84b` was deployed manually to
  Worker `counterpoint-living-decisions-preview` at
  `https://counterpoint-living-decisions-preview.gs2safari.workers.dev`.
- The deploy gate passed security 300/300, Cloudflare 141/141 on the retry,
  target dry-run, forward D1 migration check, strict Worker deploy, health /
  readiness / unauthenticated auth smoke, and the full Cloudflare Flagship
  smoke. One managed-Realtime pool attempt had a transient 503/201 mismatch;
  its isolated six-test rerun passed before the successful deploy attempt.
- Real browser verification on the target preview confirmed title `Descant —
  Living Decisions`, the `Product → Work & Productivity → Open workspace`
  start guidance, seeded Flagship opening, and workspace rendering. The older
  `counterpoint-living-decisions.gs2safari.workers.dev` host is a separate stale
  Worker and still serves the former title; it is not the target preview URL.

## 2026-07-21 hosted display boundary repair

- The preview Worker previously routed display-token issue/revoke/projection
  requests into the generic `ARTIFACT_STORAGE_UNAVAILABLE` parity fallback.
  The Worker now exposes the existing application display-token protocol with
  facilitator authorization, meeting-visible position checks, token rotation,
  revocation, and a shared-only projection that excludes private workspaces,
  participant lists, and private source text.
- Commit `78507d2912afdbead22d4f58fb93b7c67e3c2442` was explicitly deployed to
  `counterpoint-living-decisions-preview` with config hash
  `db660c6fae9c71f6abb7e07c69f7ec219ce93a45723cfd0f2b5731ced27498a2`.
  The deploy gate passed security 300/300 and Cloudflare pool 142/142, then
  health/readiness/auth smoke and the complete manual Flagship reset/replay.
- Hosted API boundary probe passed without printing tokens or response bodies:
  logged-out root/health/ready returned 200, unauthenticated meetings returned
  401, ordinary and product users could not access judge usage while routes are
   disabled (`REALTIME_UNAVAILABLE`), display issue returned 201, shared display
  returned 200 without private text, and the revoked display token returned 401
  (`DISPLAY_TOKEN_EXPIRED`). This is API evidence, not yet the required
  separate-browser hosted E2E for ordinary/judge/display roles.
- The Worker display contract is covered by 14 Cloudflare-native tests. The
  hosted Flagship still reports `invalidationEvaluations: 0` because preview AI
  routes remain disabled; the hosted `AT_RISK → REVIEW_REQUIRED` proof and
  production judge/provider proof remain intentionally open.

## 2026-07-21 preview demo review path and public boundary

- Commit `221b6d5b39230fdc80a020eb3f72cc90d5ce3f03` was explicitly deployed to
  `counterpoint-living-decisions-preview` at
  `https://counterpoint-living-decisions-preview.gs2safari.workers.dev` with
  config hash
  `ea81c4112dec378a375cd046dc806e8057bcc73d553e06775530d579a2af1d32`.
  The deploy gate passed security 300/300, Cloudflare pool 142/142, target
  dry-run, forward D1 migration check, strict Worker deploy, health/readiness/
  unauthenticated auth smoke, and the Flagship smoke.
- Preview now has an explicit, Flagship-only `DEMO_STORY_MODE=enabled` rule
  evaluator named `staged-demo-rule-v1`. It is provider-free, uses no Secret,
  makes no billable request, and creates no usage reservation. The deploy
  config renderer forces `DEMO_STORY_MODE=disabled` for production.
- Real preview Playwright verification passed three cases: logged-out SPA and
  same-origin auth/manual fallback, the provider-free staged event through
  `AT_RISK`, facilitator reason entry, human-confirmed `REVIEW_REQUIRED`,
  Action hold/reconsideration task, and reload persistence; plus separate
  ordinary/judge/display browser contexts with revoked display token behavior.
  The UI labels the preview rule as `Staged demo rule`, not `AI inferred`.
- Two new synthetic screenshots record the preview `AT_RISK` and
  human-confirmed `REVIEW_REQUIRED` states under
  `docs/media/screenshots/decision-review/`; the media manifest is current.
  Reel production remains outside this goal.

## 2026-07-21 submission audit and durable record proof

- The repository license audit is now explicit in
  `docs/submission-license-audit.md`. `npm run licenses:check` passes against
  286 pinned package entries; runtime dependencies are permissive MIT and
  Apache-2.0 metadata, while LGPL/MPL identifiers are development-only in the
  current inventory. The project's own MIT/Apache-2.0/rights-reservation choice
  remains an owner decision and no `LICENSE` was added implicitly.
- Judge credential handling is documented in
  `docs/runbooks/judge-credential-operations.md`. The README's fixed passwords
  are explicitly synthetic local/demo fixtures and are not production judge
  credentials. No production Secret or credential was registered in this
  slice.
- The real preview browser scenario now also fetches the committed Decision's
  history, audit, and JSON export after the staged review; all three returned
  200 and the export retained `REVIEW_REQUIRED`. This closes the hosted
  durable-record check without weakening the separate provider/cost gates.
- The real preview role-boundary scenario now creates a synthetic product-owned
  private source, verifies that the legal participant projection contains no
  source text, rejects a cross-owner disclosure proposal with 403, keeps the
  ordinary judge-usage route unavailable, and keeps private text out of the
  read-only display projection. This is direct hosted owner-isolation evidence;
  the full hosted C5 matrix (including SSRF, upload spoofing, and webhook
  replay) remains a separate open gate.
- The current Devpost rules were rechecked at
  `https://openai.devpost.com/rules`: public repositories need relevant
  licensing, while private repositories must be shared with the two specified
  testing addresses. Public visibility and the project license remain
  intentionally uncommitted pending the owner choice.
- Latest verification on commit `438eef5` passed `npm run security:verify`:
  repository/generated-output secret scan, security matrix 300/300, and
  Cloudflare pool 142/142. The same tree also passes format, license/NOTICE,
  environment-example, Cloudflare-config, and architecture checks. GitHub
  confirms the repository is still private; no visibility mutation was made.
- A public-safe testing guide now lives at
  `docs/submission-testing-instructions.md` and is linked from the README. It
  contains the preview URL, one Flagship path, synthetic-story boundary, and
  degraded/manual fallback, but no credential or Secret. The private Devpost
  field visibility check and actual credential handoff remain owner-owned.
- The explicit Preview deployment is also recorded in
  `docs/deployments/preview-2026-07-21.md` with the deployed implementation
  commit, rendered config hash, migration boundary, named bindings, safety
  flags, and credential-free verification summary. Production remains
  intentionally undeployed and provider-disabled.
- The current external-host Preview Playwright run passed all three browser
  cases in 43.8 seconds: provider-free staged review/manual fallback, SPA and
  same-origin API access, and separate ordinary/judge/display contexts. This
  confirms path health but does not replace the pending first-time human
  rehearsal for the three-minute acceptance gate.
- The generic-room empty state now explains why `Prepare grounded sharing
  preview` is disabled and how to add a private source. The hint is exposed
  through both visible text and `aria-describedby`/native tooltip, with updated
  synthetic evidence and a passing meeting-creation browser test. The
  Flagship path remains unchanged.

## 2026-07-21 owner decisions, staged cue, and rehearsal path

- The owner selected Apache-2.0 for the submitted source and first-party
  synthetic media. `LICENSE`, root package metadata, media manifest rights, and
  the release audit are synchronized. UD-05 is closed with the approved
  descriptor/tagline/hook; UD-07 is closed with the private Testing
  Instructions handoff and no public credential.
- The flagship private input now shows a provider-free `Private agent cue`
  after durable text or voice capture. It is explicitly labeled `Staged demo
  cue`, `Proposed only`, and `nothing shared`; it is not presented as AI
  inference and cannot disclose private source text. A local browser E2E and
  synthetic screenshot are required evidence for this UI slice.
- `docs/submission-testing-instructions.md` and
  `docs/media/flagship-rehearsal.md` now define a three-minute two-role path:
  facilitator plus synthetic participant, mic-or-text fallback, hidden-premise
  cue, exact excerpt approval, human commit, staged event, human review, and
  durable-record inspection. The human timed rehearsal remains open.
- Production Worker Secret registration remains open and unperformed. The
  guarded runbook identifies `OPENAI_API_KEY_JUDGE` and
  `JUDGE_IP_HMAC_SECRET` as separate Cloudflare Worker Secrets; adding them
  alone does not enable judge routes. Hosted C5, derived cost-limit proof,
  production deployment, and final visibility switch remain separate gates.

## 2026-07-21 latest Preview deployment

- The verified commit `9a3c47fc687cc17187520fe9c56916ffcb072678` was explicitly
  deployed to `counterpoint-living-decisions-preview` at
  `https://counterpoint-living-decisions-preview.gs2safari.workers.dev`.
- The rendered Preview config hash is
  `ad45501da2047c8026513d9fe2e3cf11a8c806bd3c5eb8c186d21d3563d1bfa3`.
  Security matrix `300/300`, Cloudflare pool `142/142`, target dry-run,
  forward D1 migration, strict Worker deploy, health/readiness/auth smoke, and
  provider-free Flagship smoke all passed. The smoke reported one synthetic
  invalidation evaluation and reset the Flagship afterward.
- Preview remains AI/provider-disabled by design. No production Worker,
  production Secret, or production judge route was touched.

## 2026-07-21 current-tree security verification

- On implementation commit `16701db`, `npm run security:verify` passed the
  build, repository/generated-output secret scan, security matrix `300/300`,
  and Cloudflare pool `142/142`. The initial sandbox attempt could not bind
  the WebSocket test server to `0.0.0.0`; the same command passed in the
  approved external execution boundary. No remote Secret, provider route, or
  repository visibility was changed.
- The production operations boundary was rechecked without remote mutation:
  `bash -n` passes for the deployment/approval/resource scripts, and the
  Cloudflare deployment/config contract set passes 13/13. The rollback,
  judge shutdown, and credential rotation/delete procedures remain documented
  for an explicitly approved production window; no production Secret was
  registered.

## 2026-07-21 deployment-plan safety recheck

- Both `npm run cloudflare:deploy:plan:preview` and
  `npm run cloudflare:deploy:plan:production` completed with their explicit
  `no remote changes` plans. Neither command performs a migration, deploy, or
  Secret registration.
- The deploy-config, base-config, workflow, and deployment-record contract
  tests passed `22/22`. The renderer still forces production
  `DEMO_STORY_MODE=disabled`, `OPENAI_MODE=disabled`, and both judge routes
  disabled, while removing judge secrets from ordinary Worker vars.
- This closes no owner or hosted-production gate: production deployment,
  production Secret registration, hosted C5, license selection, and the
  private judge Testing Instructions handoff remain open.

## 2026-07-21 external Preview browser recheck

- The deployed Preview URL was exercised with `E2E_BASE_URL` from a clean
  Chromium run. All three current cases passed in `43.8s`: provider-free
  staged review/manual fallback, SPA plus same-origin API access, and separate
  ordinary/judge/display browser contexts with display-token revocation.
- This is direct hosted Preview path evidence. It does not claim the full C5
  matrix, production judge/provider behavior, or the required first-time human
  three-minute rehearsal.

## 2026-07-21 current-tree security recheck

- `npm run security:verify` passed on the current tree: production web build,
  repository/generated-output secret scan, security matrix `300/300`, and
  Cloudflare Worker pool `142/142`.
- This refreshes local and Worker-contract evidence only. It does not close
  the separate hosted C5 requirement, production judge/provider proof, or any
  owner-controlled submission gate.

## 2026-07-21 submission-claim parity audit

- The repository-side submission surfaces checked together were `README.md`,
  `docs/submission-testing-instructions.md`, `docs/topics/README.md`, and the
  external Preview browser assertions. They consistently present `Descant —
  Living Decisions`, the `Work & Productivity` category, synthetic staged
  fixtures, the manual fallback, and the distinction between staged demo rules
  and live/provider-funded AI.
- Historical `Counterpoint` references remain confined to source-history,
  internal namespace, or migration-context documentation. They are not being
  treated as the current public product name.
- The actual Devpost title/description and public/private field visibility are
  external owner-controlled surfaces; this repository audit cannot close the
  final logged-out visibility check.

## 2026-07-21 Preview reconciliation dry-run

- `npm run judge:reconcile -- preview --dry-run` completed after rebuilding the
  Cloudflare adapter and returned `attempted=0 settled=0 released=0 failed=0`.
- The command executed the content-free stale-row SELECT path only; it did not
  call a provider, read judge/HMAC Secrets, or mutate Preview D1. This is an
  operational safety proof for the pre-billable reconciliation path, not proof
  of production judge enablement or the measured derived-limit gate.

## Next executable slice

The product is now viewable through the explicit Cloudflare preview command and
the credential-free judge browser path is implemented. The next gate is the
public-safety audit: logged-out/incognito and authenticated judge/ordinary/display
smoke, hosted C5 security rerun, and final secret/cost boundary evidence.
Before enabling provider work, measure the flagship to replace full-cap-
per-attempt settlement with safe derived limits. The hosted C5 security-matrix
rerun and judge-secret/provider proof remain behind the approved remote
boundary.
Never accept reservation, provider call, participant, session, or key-source
identity from the browser. Keep remote Secret registration and deployment
mutation behind an explicit deployment boundary. Reel production is
intentionally outside this active slice until the hosted product path is
demonstrably viewable.

## Open gates

- Closed: UD-01 Work & Productivity, UD-03 USD 25/day judge cap, and UD-06
  explicitly labeled demo-story treatment.
- Partially closed: UD-02 public at submission; the final visibility switch
  still awaits the submission-safety recheck.
- Closed: UD-04 public-facing name is Descant — Living Decisions; historical and
  internal Counterpoint identifiers remain intentionally unchanged.
- Closed: UD-05 final message hierarchy and UD-07 private credential path.
- ER-07 repository-side preview and logged-out/browser checks are closed for
  this slice; actual Devpost submission-preview visibility and credential
  handoff remain product-owner gates.
- External rechecks are performed at their named implementation/submission
  gates.

## 2026-07-21 production judge path and flagship smoke

- The explicitly approved production Worker is deployed at
  `https://counterpoint-living-decisions-production.gs2safari.workers.dev`.
  The deployment uses commit `fd3a62f0a200342dcd521ed136c220e988730709` and
  rendered config hash
  `e19f78daa9c27f240b0e4ee154ccc9954fd7689fb3746ee7ffce6474186c7ecb`.
- Production D1/R2/DO bindings, both separate judge Worker Secrets, and the
  dedicated `judge` identity were provisioned. Preview remains provider-free
  and judge-disabled.
- Operator-confirmed production browser smoke passed the full flagship arc:
  private server-funded excerpt suggestion, structured Decision candidate,
  human premise confirmation, draft/ready/commit, monitor registration,
  staged synthetic regulatory event, AI `AT_RISK` evaluation, human review,
  `REVIEW_REQUIRED`, and Decision JSON export. No BYOK credential was used.
- A separate production browser context logged in as synthetic `safety` and
  received `403 JUDGE_MODE_FORBIDDEN` from the judge usage route, confirming
  that ordinary participant access does not inherit the managed capability.
- This closes the production judge enablement and deployment-record slice, but
  does not close hosted C5, independent cost-limit evidence, the timed human
  rehearsal, or the owner-controlled public visibility switch.

### Next executable slice

Run the hosted C5 security matrix and cost-boundary evidence against the
production Worker, then update the submission testing instructions with the
private judge handoff. Keep repository visibility private until the owner
performs the final logged-out/public safety check.

## 2026-07-21 projector display and presentation tutorial

- The owner feedback identified the shared display's `90rem` max-width as too
  narrow for a 4K monitor or projector. The display hero, grid, and footer now
  use the full available viewport with responsive gutters; the mobile
  single-column fallback remains intact.
- `tests/e2e/shared-display.spec.ts` passed `1/1` and now checks a 2560×1440
  display layout plus a synthetic projector screenshot. The media manifest was
  regenerated and checked. Typecheck, lint, and format checks pass.
- The response decision table is in
  `docs/plans/ui-feedback-2026-07-21.md`. It defers the broad workspace density
  redesign until after submission-critical gates, keeps model choice
  operator-only, and preserves the private/shared projection boundary.
- The exact production walkthrough and the compressed presentation narration
  are in `docs/presentation/flagship-production-tutorial.md`. It contains no
  credential and explicitly labels the event injection as a staged demo story.

The projector deployment was first aligned at commit
`84a4230c8ec48f70e05437886728a61d49caf309`; the current production record and
judge-enabled follow-up are recorded in the section below.

## 2026-07-21 production manual fallback boundary

- Production commit `0d4f0e38c6a59d546c44ebb5db50f4ab6b004a71` is deployed with
  the explicitly rendered judge configuration (`JUDGE_USER_ID=judge`). The
  production deployment reran security matrix `300/300`, Cloudflare pool
  `142/142`, health/readiness/auth smoke, and Flagship smoke successfully.
- The UI now treats `JUDGE_MODE_FORBIDDEN` the same as an unavailable AI
  suggestion for recovery purposes. Ordinary users can continue with the
  exact manual excerpt and manual Decision path; the browser never receives a
  judge credential. The external Production E2E passed `2/2` for this path and
  for the ordinary/judge/display projection boundary.
- The production manual-fallback screenshot and provenance are recorded in
  `docs/media/screenshots/decision-review/` and `docs/media/ASSET_MANIFEST.json`.
- Production judge reconciliation dry-run completed with
  `attempted=0 settled=0 released=0 failed=0`. It performed only the
  content-free stale-row SELECT path and did not read judge/HMAC Secrets,
  call a provider, or mutate Production D1.
- The owner confirmed the private `judge` login again from a clean browser
  after the canonical Production D1 correction. No credential value was
  recorded.
- A live browser comparison found that the previously shared bare Workers
  host, `counterpoint-living-decisions.gs2safari.workers.dev`, still serves an
  older `Counterpoint` deployment. The canonical judge URL is the explicit
  `counterpoint-living-decisions-production.gs2safari.workers.dev` origin;
  its judge session must show `Judge-managed access` / `Ready`. A public
  `Product` session intentionally shows `Facilitator BYOK`, so that button
  state is not evidence of a broken judge route and no provider key should be
  entered for the judge walkthrough.
- This closes the ordinary-user manual continuity repair, but does not close
  the full hosted C5 matrix, independent cost-limit proof, timed human
  rehearsal, or owner-controlled public visibility switch.
