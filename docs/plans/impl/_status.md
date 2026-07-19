# Implementation status

Updated: 2026-07-19

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

## In progress

- Begin Plan 05 C2 Cloudflare adapter parity while preserving D1 as durable
  truth and avoiding duplicate Node/Worker HTTP semantics.

## Not started

- Deployment and remaining submission assets.

## Next executable slice

Continue with Plan 05 in
[`05-cloudflare-judge-mode-and-security.md`](../05-cloudflare-judge-mode-and-security.md)
at C2: implement D1 event/projection repositories, run the existing artifact
contract against R2, and define the Durable Object coordination contract for
ordering, resume, idempotency, revocation, and reset. Extract shared HTTP
transport semantics before wiring the full Worker API so Node and Cloudflare
cannot drift. Preserve the allowlisted judge-managed source and USD 25 rolling
24-hour product spend gate for C3/C4; do not deploy or create remote resources
without an explicit deployment boundary.

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
