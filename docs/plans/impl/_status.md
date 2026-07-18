# Implementation status

Updated: 2026-07-19

## Current phase

**M1 Foundation, permissioned disclosure, and A3/A4 private AI assistance are
complete; shared Decision synthesis is next.**

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

## In progress

- Complete the facilitator, shared-display, history, and audit role surfaces.
- Assemble shared Decision inputs and the deterministic commit UI.

## Not started

- Realtime application hub and resume.
- Deployment and remaining submission assets.

## Next executable slice

Continue A5 in
[`03-private-ai-realtime-and-artifacts.md`](../03-private-ai-realtime-and-artifacts.md):
add shared-only Decision-state candidate synthesis, then connect it to the L6
deterministic draft/confirmation/commit slice. AI output must remain a
human-confirmed candidate and the manual draft path must remain available.

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
