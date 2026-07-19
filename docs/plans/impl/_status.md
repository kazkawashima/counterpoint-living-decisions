# Implementation status

Updated: 2026-07-19

## Current phase

**Foundation, permissioned disclosure, private/shared AI assistance, Decision
commitment, production-like Compose, monitoring, external-event receipt, and
GPT-5.6 invalidation evaluation are complete; human review is next.**

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

## In progress

- Assemble the guided D7 flagship and verification copy.
- Complete the versioned capability surface and realtime resume path.

## Not started

- Realtime application hub and resume.
- Deployment and remaining submission assets.

## Next executable slice

Continue D7 in
[`04-commitment-and-living-decision.md`](../04-commitment-and-living-decision.md):
turn the implemented private-to-shared-to-living-Decision path into the
timed, deterministic flagship flow and capture the remaining guided copy.

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
