# Implementation status

Updated: 2026-07-20

## Current phase

**The complete local guided flagship is implemented from private evidence
through permission, Commitment, external change, human review, revision,
export, deterministic meeting reset, and participant-scoped realtime resume.
The revocable read-only shared display, A1 validated artifact ingestion, A2
SSRF-safe URL ingestion, A6 transient BYOK/client-secret path, A7 shared-floor
speech controls, and A8 durable degraded mode are also complete. OpenAI,
Realtime, and BYOK loss leave state reads, manual text, human-authored
Decisions, audit, and export usable through explicit bounded recovery UI. The
remaining implementation phase is hosted Cloudflare parity, judge mode,
security hardening, and submission packaging.**

The canonical implementation-facing artifacts are:

- [`docs/specs/README.md`](../../specs/README.md)
- [`docs/plans/README.md`](../README.md)
- [`docs/decisions/user-decisions.md`](../../decisions/user-decisions.md)
- [`docs/decisions/external-rechecks.md`](../../decisions/external-rechecks.md)

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
- The hosted flagship now also reaches `MONITORING` through the authenticated
  Worker path. The local preview Worker uses an explicit deterministic
  evaluator without a provider key, so a facilitator-only demo regulatory
  change reaches `AT_RISK`; the same facilitator-only review route reaches
  `REVIEW_REQUIRED`, holds the affected Action, and creates a reconsideration
  task. The live provider evaluator remains a separate, explicitly gated
  deployment concern, while rendered remote deployment configs remain
  provider-disabled until the judge gate is approved.
- Worker deterministic mode now wires both AI-preferred private disclosure and
  shared Decision synthesis in addition to invalidation evaluation. Manual
  disclosure requests explicitly remove the proposer dependency, preserving
  the manual fallback and truthful `human_selected`/`ai_assisted` origin.
- Hosted demo reset is now wired through the same authorization, event, and
  projection boundaries. It clears private/shared read models without rewinding
  the event cursor, supports exact idempotent replay, and rejects participant
  authority. The external-host Cloudflare flagship test covers the full
  `MONITORING` → `AT_RISK` → `REVIEW_REQUIRED` → reset journey and verifies
  reset collections are empty afterward.
- A reusable authenticated Cloudflare flagship smoke now exercises the real HTTP
  lifecycle from login/reset through private text, disclosure
  preview/approval, manual candidate/disposition, DRAFT, READY, COMMITTED,
  MONITORING, demo invalidation/review, and reset replay. Local Wrangler smoke
  runs it with deterministic invalidation enabled; the approved deployment
  driver runs the same product lifecycle with invalidation opt-in only, keeping
  remote provider access disabled by default.
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
- C4 is not complete: broader judge billable-path coverage, measured flagship
  limits, the web managed-call switch, and structured judge AI routes remain.
  The managed realtime route adapter now includes explicit duplicate-start and
  changed-payload unit coverage, a four-case Worker gate suite, and Cloudflare
  integration coverage; it remains disabled by default.
  Full hosted security-matrix rerun, approved provider enablement, and
  structured judge AI remain later slices.
- The real Worker-to-Durable-Object binding now has a provider-free integration
  proof in addition to the synthetic-controller path. The request reaches the
  registered `JUDGE_REALTIME_CALLS` namespace, observes the DO's
  `not_configured` state, returns a redacted 503 before provider work,
  terminates ownership, releases the reservation, and persists no SDP or
  provider ID. The successful real-DO lifecycle still requires the approved
  provider boundary.
- The current regular baseline is 634 Vitest tests and the contract project
  passes 116 tests, with typecheck, formatting,
  architecture, secret scan, generated Worker types, environment, and
  Cloudflare configuration checks passing. The changed files pass targeted
  ESLint; repository-wide lint still reports 23 pre-existing errors in the
  managed-realtime unit fixture and is not claimed as green here. Six new
  Cloudflare-native D1
  persistence/IDOR/race/termination cases passed before two additional
  reauthorization cases were added; rerunning those two was blocked by the
  execution environment's escalated usage limit. The focused security rerun
  passed 279 cases; its four WebSocket cases were blocked only because the
  sandbox denied their required `0.0.0.0` listen. The hosted flagship Worker
  target now passes four integration cases, and the Worker-specific browser
  E2E passes the SPA/login/workspace/AI-preview journey against Wrangler.
  The full Cloudflare pool now passes 10 files and 91 tests after giving its
  migration hooks and integration cases explicit cold-start timeouts. No
  visible UI changed, so no new screenshot was required. Reel
  shooting and reel-material organization are deferred from the active goal;
  product visibility remains
  the priority, while the AGENTS.md capture rule stays available for later UI
  changes.

## Not started

- Approved hosted deployment, hosted flagship smoke, and remaining submission
  assets.

## Next executable slice

Continue Plan 05 by extending Worker proof to real Durable Object lifecycle
behavior, then measure the flagship to replace full-cap-per-attempt settlement
with safe derived limits. The hosted C5 security-matrix rerun and
provider/deployment proof remain behind the approved remote boundary.
Never accept reservation, provider call, participant, session, or key-source
identity from the browser. Keep remote Secret registration and deployment
mutation behind an explicit deployment boundary. Reel production is
intentionally outside this active slice until the hosted product path is
demonstrably viewable.

## Open gates

- Closed: UD-01 Work & Productivity, UD-03 USD 25/day judge cap, and UD-06
  explicitly labeled demo-story treatment.
- Partially closed: UD-02 public at submission; final project license awaits
  dependency/submission audit.
- Provisional: UD-04 continues Counterpoint pending name clearance.
- Open: UD-05 final message hierarchy and UD-07 credential path.
- ER-07 preview inspection is scheduled for 2026-07-20.
- External rechecks are performed at their named implementation/submission
  gates.
