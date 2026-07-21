# System architecture and data specification

## Architecture style

Descant uses **edge-native runtime adapters around a shared domain core**.
The same domain and application behavior runs through a local Node adapter and
a hosted Cloudflare adapter.

The source dependency direction is:

```text
apps / adapters
      ↓
application + protocol
      ↓
domain + ports
```

The domain package has no dependency on React, Node, Cloudflare, OpenAI, SQL,
HTTP, or WebSocket.

## Repository layout

```text
apps/
  web/                  React + Vite UI
  server/               Node local/runtime adapter
  worker/               Cloudflare Worker adapter
packages/
  domain/               entities, events, reducers, state machine, rules
  application/          commands, queries, ACL, disclosure, reevaluation
  protocol/             DTOs, event/error schemas, versioning
  ports/                persistence, storage, AI, realtime, clock, IDs
  adapters-node/        SQLite, local files, Node realtime hub
  adapters-cloudflare/  D1, R2, Durable Objects
  adapters-openai/      GPT-5.6 and Realtime client-secret gateway
tests/
  contract/
  integration/
  e2e/
```

Workspace tooling and package boundaries are implementation choices, but one
root command surface MUST drive formatting, type checking, tests, builds, local
startup, and deployment smoke tests.

## Runtime mapping

| Concern | Local | Cloudflare |
|---|---|---|
| Web assets and API | Node server, same origin | Worker static assets and routes |
| Meeting coordination | In-process meeting coordinator | One Durable Object per meeting |
| Canonical records | SQLite | D1 |
| Artifact binary | Named-volume local storage | R2 |
| Realtime app events | Node WebSocket hub | Durable Object connections |
| Meeting API-key lease | Process memory | Durable Object transient memory / Worker Secret path |
| AI | Shared OpenAI adapter | Shared OpenAI adapter |

Cloudflare Containers are OUT.

## Application command flow

```text
receive command
→ authenticate
→ authorize user/capability and meeting scope
→ load required state
→ domain validate
→ append event(s) transactionally
→ reduce projection
→ persist projection
→ publish visibility-scoped update
→ return protocol response
```

AI work may occur before a candidate event is appended, but AI output never
bypasses validation or writes directly to a projection.

## Port contracts

Required ports:

- `EventStore`
- `ProjectionStore`
- `IdentityRepository`
- `MeetingRepository`
- `ArtifactStore`
- `ArtifactTextExtractor`
- `RealtimePublisher`
- `AiGateway`
- `RealtimeSecretIssuer`
- `WebhookVerifier`
- `Clock`
- `IdGenerator`
- `UsageLimiter`
- `StructuredLogger`

Each port has contract tests against both local and hosted adapters where two
implementations exist.

## Persistence model

The logical data set includes:

- fixed users and password hashes
- meetings and participant assignments
- append-only event envelopes and payloads
- owner-private and shared projections
- Decision revisions
- audit history
- monitor registrations
- usage-limit counters
- artifact metadata and storage references

Transient-only data:

- facilitator BYOK
- OpenAI short-lived client secrets
- active shared-floor lease
- live application connections

The judge standard key exists only in a Cloudflare Secret and is not meeting
state.

## Transaction and ordering rules

- Event append and projection update are atomic from the application's point of
  view.
- Each meeting has a monotonic event position.
- Commands may include an expected position for optimistic concurrency.
- External and client-generated commands require idempotency keys.
- Realtime publication occurs after durable append.
- Consumers can resume from a last-seen position.
- A projection can be rebuilt from the event stream.

The Durable Object serializes meeting-local live coordination. D1 remains the
durable source of truth described by the confirmed requirements.

## Storage partitioning

Logical keys always include meeting scope. Private artifacts additionally
include owner scope:

```text
meetings/<meetingId>/shared/<artifactId>
meetings/<meetingId>/private/<ownerParticipantId>/<artifactId>
```

These are conceptual keys; adapters may encode them differently while
preserving the boundary.

## Local deployment

The standard path is:

```text
docker compose up
```

It MUST:

- build and serve one production-like origin
- bind to `0.0.0.0`
- apply migrations safely on first start
- expose a health check
- persist SQLite and artifacts in named volumes
- start without a configured OpenAI key
- print one reachable URL

A separate hot-reload profile MAY exist. Any Vite command uses
`--host 0.0.0.0`.

## Cloudflare deployment

The hosted path MUST include reproducible commands for:

- Worker build/deploy
- D1 creation and migrations
- R2 bucket binding
- Durable Object migration
- preview smoke
- production smoke
- secret registration instructions that never echo secret values

Initial hosting uses `workers.dev`; a custom domain is optional.

## Migration rules

- Migrations are ordered, versioned, and repeat-safe.
- Local and Cloudflare schema semantics remain aligned.
- No deployment silently deletes or rewrites the event ledger.
- A failed migration prevents serving incompatible application code.
- Seed/reset data is separate from schema migration.

## Architecture acceptance

Architecture is proven when:

1. Domain tests run without runtime-adapter dependencies.
2. Contract suites pass for SQLite/D1, local/R2 storage, and Node/DO realtime
   implementations.
3. Both runtimes execute the same flagship application commands and protocol.
4. A restart preserves meeting, history, and artifact data.
5. A fresh Compose environment and Cloudflare preview apply migrations and
   pass health/smoke checks.
