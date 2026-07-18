# Plan 01 — Foundation, domain, and contracts

## Goal

Create a buildable greenfield monorepo whose domain rules and protocol are
independent of Node, Cloudflare, React, and OpenAI.

## Inputs

- [Domain specification](../specs/01-domain-model-and-state-machine.md)
- [Architecture specification](../specs/04-system-architecture-and-data.md)
- [Contract specification](../specs/05-contracts-events-and-errors.md)
- Repository/network rules in [`AGENTS.md`](../../AGENTS.md)

## Work packages

### F1 — Workspace and command surface

- [x] Select and pin the Node/package-manager versions.
- [x] Create workspace packages and application directories from the specified
      layout.
- [x] Add root scripts for format, lint, typecheck, unit, contract, integration,
      E2E, build, dev, and deployment smoke.
- [x] Configure Vite dev with `--host 0.0.0.0`.
- [x] Add CI-safe environment validation with no production secret values.
- [x] Add architecture-boundary checks preventing domain runtime dependencies.

Proof:

- clean install
- root typecheck/test/build command starts
- forbidden dependency test fails on a deliberate fixture and passes normally

Implemented in the foundation tooling slice. Verified with `npm install`,
`npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`,
`npm run build`, `npm run env:check`, and `npm run test:architecture`.

### F2 — Protocol primitives

- [ ] Define opaque ID types, timestamps, visibility, origin, confirmation
      status, actor, correlation, causation, and idempotency primitives.
- [ ] Define event envelope and error envelope.
- [ ] Define protocol/event schema version policy and parsing.
- [ ] Define safe error-code registry.
- [ ] Add tests for invalid/unknown versions and error redaction.

### F3 — Domain entities and values

- [ ] Implement only flagship-required entity fields first.
- [ ] Model Proposition/Stance/Premise/Evidence as distinct types.
- [ ] Model private ownership and meeting scope as required values.
- [ ] Model Decision revision snapshot, Dissent, Action, and
      ReconsiderationTask.
- [ ] Add construction invariants and serialization tests.

### F4 — Event stream and reducers

- [ ] Define required event payload schemas.
- [ ] Implement deterministic reducer and projection types.
- [ ] Add monotonic meeting position and optimistic concurrency contract.
- [ ] Add idempotency behavior.
- [ ] Add replay and projection rebuild tests.
- [ ] Prove a shared projection can be created without private payload reads.

### F5 — Decision state machine

- [ ] Implement all specified transitions and authority/condition checks.
- [ ] Enforce GPT suggestion → `AT_RISK` and facilitator review →
      `REVIEW_REQUIRED`.
- [ ] Implement Action selection/hold and revision append.
- [ ] Add table-driven tests for every valid and invalid transition.

### F6 — Ports and contract harness

- [ ] Define persistence, artifact, realtime, AI, key, clock, ID, limiter, and
      logger ports.
- [ ] Create reusable contract-test suites.
- [ ] Add in-memory test adapters used only by unit/application tests.
- [ ] Define application command/query boundaries and authorization context.

## Non-goals

- No production UI.
- No real OpenAI calls.
- No SQLite/D1/R2/DO implementation.
- No broad entity features unused by the flagship.

## Verification

- formatter/linter/typechecker green
- unit tests for reducers, lifecycle, ACL primitives, revisions, and replay
- protocol tests for parse/version/redaction/idempotency
- architecture dependency tests
- `git diff --check`

No browser E2E is required until a UI is introduced.

## Exit gate

Given a synthetic sequence of commands and candidate events, the domain can
produce the complete flagship state through `REVIEW_REQUIRED` deterministically,
reject forbidden transitions, and rebuild the same projections from replay.

## Suggested commit boundary

One foundation commit is acceptable if the protocol/domain review remains
coherent; otherwise split workspace setup from domain/protocol implementation.
