# Plan 02 — Local flagship skeleton

## Goal

Deliver a production-like Docker Compose application in which three fixed users
can complete the deterministic text path from login through Decision
Commitment. AI, Realtime, and Living Decision reevaluation remain stubbed behind
ports.

## Inputs

- [Product specification](../specs/00-product-scope-and-experience.md)
- [Identity/security specification](../specs/02-identity-permissions-and-security.md)
- [UI specification](../specs/06-ui-ux-motion-and-evidence.md)
- Plan 01 exit gate

## Work packages

### L1 — Node persistence adapters

- [x] Implement SQLite migrations for users, meetings, assignments, events,
      projections, revisions, audit, and artifact metadata.
- [x] Implement event/projection repositories with meeting scope.
- [x] Implement local artifact storage with meeting/owner partitions.
- [x] Run reusable port contract suites.
- [x] Add safe first-start and restart migration tests.

### L2 — Authentication and meeting participation

- [x] Seed fixed synthetic users from environment-safe configuration.
- [x] Implement login/logout and tab-scoped Bearer session.
- [x] Enforce inactivity and absolute expiry with testable clock.
- [x] Implement meeting creation, 3–8 user assignment, list, and code join.
- [x] Add server-side capability checks to every implemented use case.

### L3 — Node API and realtime application hub

- [ ] Implement versioned HTTP capability surface.
- [x] Implement safe error mapping and correlation IDs.
- [ ] Implement scoped realtime projection subscriptions.
- [ ] Handle resume from last-seen meeting position.
- [x] Bind server to `0.0.0.0`.

### L4 — Web shell and role surfaces

- [x] Build login and meeting list.
- [x] Build participant-private workspace shell.
- [ ] Build facilitator dashboard shell.
- [ ] Build read-only shared display with revocable token.
- [ ] Build Decision history/audit shell.
- [x] Use stable visual grammar for scope, origin, and confirmation.
- [x] Add responsive navigation and keyboard support for implemented surfaces.

### L5 — Deterministic text disclosure

- [x] Allow owner-private text/source fixture registration at the application
      boundary.
- [x] Produce a deterministic owner-only disclosure candidate through a test
      adapter.
- [ ] Show exact outgoing preview and editable snippet.
- [x] Enforce preview hash and owner approval at the application boundary.
- [x] Publish only approved Evidence to shared state.

### L6 — Deterministic Decision commit

- [ ] Show shared evidence and draft outcome/premise/dissent/Action.
- [ ] Show fact/inference/confirmed labels.
- [ ] Implement facilitator confirmation/rejection of candidate premise.
- [ ] Implement ready validation and explicit commit.
- [ ] Show immutable revision marker and audit lineage.

### L7 — Compose path

- [ ] Add production build container and Compose configuration.
- [ ] Persist SQLite and artifacts with named volumes.
- [ ] Add health check and startup migration.
- [ ] Start without an OpenAI key.
- [ ] Print one Tailscale-reachable URL.

## Browser verification

Add committed E2E for:

- three users in separate browser contexts/tabs
- assignment list and code join
- private candidate absent from shared APIs/UI
- preview-hash approval and approved Evidence appearance
- facilitator-only commit
- shared-display revocation
- meeting/owner isolation
- session expiry
- desktop/mobile core layouts
- external-IP-style hostname access with no localhost/CORS drift

## Visual evidence

Capture and document:

- login/meeting selection
- participant private boundary
- disclosure candidate and preview
- shared evidence after approval
- facilitator Decision draft
- committed Decision and audit trail
- mobile participant view
- authorization/error state

## Exit gate

From a fresh `docker compose up`, one person can use three tabs to log in as
different users, join the flagship meeting, approve a private evidence snippet,
see it on the shared display, and commit a traceable Decision. Data survives
restart and Meeting B remains isolated.

## Suggested commit boundaries

1. Node persistence/auth/meeting APIs.
2. Role UI and deterministic disclosure.
3. Decision commit, Compose, E2E, and evidence.
