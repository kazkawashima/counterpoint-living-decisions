# Implementation status

Updated: 2026-07-19

## Current phase

**The complete local guided flagship is implemented from private evidence
through permission, Commitment, external change, human review, revision,
export, deterministic meeting reset, and participant-scoped realtime resume.
The revocable read-only shared display and A6 transient BYOK/client-secret
backend are also complete; direct browser WebRTC and hosted judge mode are
next.**

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

## In progress

- Connect the completed A6 client-secret boundary to direct browser WebRTC with
  idle close, capped reconnect, explicit status UI, and text-safe degradation.

## Not started

- Deployment and remaining submission assets.

## Next executable slice

Continue A6 in
[`03-private-ai-realtime-and-artifacts.md`](../03-private-ai-realtime-and-artifacts.md):
add facilitator tab-scoped BYOK controls and direct browser WebRTC lifecycle,
then capture status, reconnect, mobile, reduced-motion, and degraded evidence.
Keep the allowlisted judge-managed source and USD 25 product spend gate in Plan
05.

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
