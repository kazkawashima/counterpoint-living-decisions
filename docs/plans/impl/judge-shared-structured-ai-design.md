# Judge shared structured-AI billing design

Updated: 2026-07-20

## Purpose

Complete the local safety boundary for the two remaining judge-funded
structured-output paths:

- shared Decision synthesis
- assumption-invalidation evaluation

Both paths must claim one logical operation and reserve against the shared
rolling-24-hour USD 25 ledger before any OpenAI request. Node BYOK behavior,
deterministic Worker demo behavior, public HTTP schemas, and domain events
remain unchanged.

## Existing constraints

- Only a freshly authenticated, currently assigned, allowlisted judge may use
  the managed route.
- `JUDGE_STRUCTURED_AI_ROUTE_ENABLED`, `OPENAI_API_KEY_JUDGE`, an independent
  `JUDGE_IP_HMAC_SECRET`, and canonical `CF-Connecting-IP` are all required.
- Preview and production deployment configuration keeps the route and provider
  mode disabled.
- Manual Decision authoring and deterministic provider-free demo behavior must
  never claim or reserve usage.
- The browser supplies no user, participant, session, account, IP, claim,
  reservation, provider, pricing, or key-source identity.
- Claims and ledger rows contain no shared text, private text, prompts, model
  output, credentials, or provider request/response/call identifiers. Pinned
  model names remain allowed operation metadata.
- A completed application result replays before provider work. An in-flight or
  uncertain claim without a persisted result fails closed.
- Missing or malformed billing and any provider-started failure settle the full
  reserved envelope. Only complete per-attempt usage can lower settlement.

## Approaches considered

### 1. Duplicate the private-disclosure orchestrator

Create separate claim/reserve/finalize implementations for Decision synthesis
and invalidation evaluation.

This is initially quick but duplicates the most security-sensitive lifecycle.
Release ordering, uncertain reservation handling, and conservative settlement
would drift across three implementations.

### 2. Add a billing executor to application ports

Teach Decision and invalidation application use cases about claim metadata,
usage reservations, and settlement.

This places the replay hook close to application command identity, but it
widens runtime-independent application contracts with Cloudflare judge
infrastructure concerns. Node BYOK and deterministic tests would need no-op
executors.

### 3. Shared Worker lifecycle with operation-specific decorators

Keep application contracts unchanged. A generic Worker-only lifecycle owns
claim, reserve, provider-start, finalize, and release semantics. Request-scoped
Decision and invalidation decorators invoke it only when the application has
already passed authorization, validation, and completed-result replay.

This follows the proven private-disclosure boundary without leaking billing
into public or domain contracts. It is the selected approach.

## Architecture

### Adapter-only billing

The three concrete OpenAI adapters use one content-free billing type:

```ts
interface StructuredAiBilling {
  readonly attemptCount: number;
  readonly attempts: readonly {
    readonly inputTokens: number;
    readonly model: string;
    readonly outputTokens: number;
  }[];
  readonly inputTokens: number;
  readonly outputTokens: number;
}
```

`PrivateDisclosureBilling` remains an alias for compatibility. Shared Decision
and invalidation concrete result types gain an optional `billing` property.
Their application-facing structural interfaces do not gain that property.

An adapter returns billing only when every attempted provider response has a
nonempty response model and safe, internally consistent token usage. A
retryable invalid model output still records that attempt's model and usage. A
transport failure or any response with missing, negative, fractional, unsafe,
or inconsistent totals makes billing incomplete. Pricing is per attempt using
the actual response model. An unknown/versioned model or inconsistent
configuration settles the full reservation.

All three adapters use capped exponential backoff with injected jitter. Tests
inject a deterministic random source; production uses Web Crypto randomness.

### Operation envelopes

All managed structured-output paths use at most two Responses attempts and a
20-second timeout per attempt. A pre-provider reservation lease is 120 seconds.
Provider-started and settled claim retention follows the durable lifecycle
below rather than expiring on that lease.

| Operation | Input JSON cap | Reserved input | Reserved output | Generations | Cost |
|---|---:|---:|---:|---:|---:|
| private disclosure | 64 KiB source | 540,000 | 1,400 | 2 | USD 5.50 |
| shared Decision synthesis | 64 KiB | 540,000 | 2,800 | 2 | USD 5.75 |
| assumption invalidation | 64 KiB | 540,000 | 1,600 | 2 | USD 5.50 |

The token envelopes deliberately exceed the bounded serialized inputs. They
retain conservative room for prompt/schema overhead and pricing behavior. The
Decision envelope covers two maximum 1,400-token outputs.

The shared global generation limit remains eight. The token limit becomes
2,171,200, which covers four largest Decision envelopes. The USD 25 D1 trigger
remains authoritative and permits at most four reservations at these costs.
Realtime seconds and existing account/IP/meeting/concurrency limits remain
shared across operations.

Actual cost uses the existing integer micro-USD GPT-5.6 rate table and prices
each attempt independently from its response model. Cached input is charged at
the uncached rate. Unsupported model identity, incomplete billing, arithmetic
overflow, or usage outside the reservation settles the full envelope.

The exact bounded input is the UTF-8 byte length of `JSON.stringify()` applied
to the provider input object with `meetingId` removed, matching the concrete
adapter request. The request-scoped decorator measures it before claim,
reservation, or provider work. More than 65,536 bytes returns
`VALIDATION_FAILED`; tests prove zero claim, ledger, and provider calls.

### Durable operation state

Migration 0011 extends managed structured-AI claims with:

- `status`: `legacy_blocked`, `reserved`, `provider_started`, or `settled`
- one opaque server-generated `reservation_id`
- lease, provider-start, settlement, and reuse timestamps

The initial atomic claim stores status `reserved`, the reservation ID, and a
120-second lease before the usage row is inserted. The concrete D1 limiter
accepts that caller-generated reservation ID. Provider work can begin only
after:

1. the reservation insert returns granted; and
2. a generation-bound conditional update durably changes the claim from
   `reserved` to `provider_started`.

An original request must observe that exact update succeed. If another request
has taken over or the state differs, it must not call the provider.

An exact retry during an active `reserved` lease fails closed. After lease
expiry it checks the named ledger row:

- existing active reservation: require an exact immutable match for account,
  keyed IP, meeting, operation, model, pricing version, every reserved
  dimension, creation identity, and reservation ID; then atomically take over
  the lease and continue with that reservation
- no reservation: atomically replace the reserved generation and attempt one
  new reservation
- any mismatch or ID collision: fail closed
- finalized reservation: validate its exact ownership, mark the claim settled,
  and do not invoke provider

Inserting a caller-generated reservation ID is idempotent only when all
immutable fields match exactly. An uncertain insert retry returns the original
grant for an exact row and never creates a second row. Tests cover exact
recovery, a same-ID collision, a field mismatch, and an exception after the D1
insert became durable.

A `provider_started` claim is never replaced by lease expiry. An exact retry
first reads its named reservation. If already finalized with either trustworthy
actual usage or the full envelope, it validates ownership and marks the claim
settled without changing actuals. If still reserved, it finalizes the full
envelope and then marks settled. It returns unavailable without another
provider request.

Successful actual/full finalization marks the claim `settled` and sets
`reuse_after_epoch` to 25 hours after settlement. Application replay normally
bypasses the claim forever. If provider work succeeded but event append never
became durable, the same logical operation may run again only after the old
full charge has left the rolling-24-hour window.

The bounded reconciliation command scans stale `reserved` and
`provider_started` rows without content. It:

- releases an expired pre-provider reservation only after a conditional claim
  transition proves provider work never started
- full-finalizes stale provider-started reservations
- marks finalized rows settled
- never deletes or releases provider-started usage

The same reconciliation runs in bounded form before a new managed structured
operation. An operator runbook exposes the identical credential-free command
for recovery from prolonged D1 failure.

Migration 0011 copies every pre-existing 0010 row to `legacy_blocked`, with no
reservation ID and no automatic reuse. The old schema cannot prove whether
provider work started, so it is never inferred to be pre-provider. The
operator runbook may remove a legacy row only after verifying that the
corresponding environment never enabled the structured-AI route and that no
matching active usage reservation exists. Migration tests populate 0010 before
upgrade and prove the fail-closed classification. No remote deployment has yet
created such rows, but the migration does not rely on that fact.

### Generic lifecycle

`runJudgeManagedStructuredAiOperation()` receives:

- authenticated server authorization
- canonical request IP
- D1 claim repository and operation-specific usage limiter
- operation, model, pricing version, lease/retention values, and reserved usage
- content-free claim-key fields
- authorized request fingerprint input
- concrete provider callback
- actual-usage calculator

It performs:

```text
reconcile bounded stale content-free rows
→ validate exact UTF-8 provider input size
→ generate and persist reservation ID in atomic claim
→ insert or recover the named usage reservation
→ durably mark provider started
→ invoke concrete adapter
→ settle actual or full reservation
→ durably mark claim settled
```

It hashes request-local input in memory but never persists that input or model
output.

Canonicalization version `judge-structured-input-v1` sorts object keys and
sorts entity arrays by their stable IDs before JSON serialization. It preserves
the order of semantically ordered string arrays such as Action scope. Active
participant IDs are sorted. The canonicalization version is part of every
request fingerprint and pricing metadata, so a future algorithm change cannot
silently reinterpret an existing claim.

Claim replay without a persisted application result returns a redacted
`OPENAI_UNAVAILABLE`. Changed fingerprints return `IDEMPOTENCY_CONFLICT`.
Reservation denial abandons the exact pre-provider claim generation and returns
`USAGE_LIMIT_REACHED` with only the exhausted dimension. An uncertain reserve
exception retains the reserved claim for safe takeover/reconciliation. No
provider-started path releases usage or claim.

### Shared Decision decorator

The existing application use case retains its first completed-candidate replay.
For an `ai_preferred` request:

1. The Worker resolves the current facilitator and judge capability.
2. The application loads shared state and active participants.
3. The managed synthesizer decorator receives the exact authorized synthesis
   input immediately before provider work.
4. The request-scoped decorator is constructed only after current assignment
   and `judge:managed-ai` capability resolution.
5. The claim key hashes operation, meeting, and request idempotency key.
6. The request fingerprint hashes server user/participant scope, model and
   versions, idempotency key, and a canonicalized complete synthesis input.
7. The generic lifecycle reserves, invokes, and settles.
8. The application validates references and appends the facilitator-private
   candidate bundle.

Concurrent exact requests produce one provider call. A claim replay with no
persisted candidate fails closed; a later retry after the winning application
append replays from events without touching claim or usage.

Manual requests strip the synthesizer. Deterministic Worker mode remains
provider-free and does not use the managed lifecycle.

### Invalidation decorator

The external-event receipt remains durable before evaluation. The existing
application use case retains its completed-evaluation replay and constructs the
exact active revision context before calling the evaluator.

After the route resolves the current session, assignment, facilitator role, and
judge capability, it constructs one request-scoped evaluator decorator carrying
only that server authorization and canonical IP scope. Only that decorated
dependency is passed to this evaluation invocation.

The managed evaluator decorator derives:

- claim key: operation, meeting, external event ID, active revision ID
- request fingerprint: server user/participant scope, model and versions, and
  the canonicalized complete evaluator input

This includes the normalized event, immutable revision, premises, Actions, and
evidence in the in-memory digest but persists only the resulting hash.

The typed lifecycle error escapes only the request-scoped evaluator. The Worker
helper catches it separately from application/provider failures. If its code is
`USAGE_LIMIT_REACHED`, the already accepted event receipt remains durable and
the route returns the existing 429 error envelope with only `limit`. Other
lifecycle/provider failures retain the existing `202 pending` receipt behavior.
Node BYOK continues to use the original evaluator and fire-and-forget behavior.
Completed evaluation replay bypasses claim, reservation, and provider work.

The local Node signed-webhook route is a facilitator-BYOK runtime, not a
judge-funded Cloudflare path, and remains unchanged.

## Error and cleanup semantics

| Point of failure | Result |
|---|---|
| authorization or input validation | no claim or reservation |
| claim conflict | 409, no reservation or provider |
| exact claim without persisted result | redacted unavailable, no new work |
| reservation denied | abandon exact pre-provider claim, 429, no provider |
| reservation outcome uncertain | retain reserved claim for takeover, unavailable |
| provider-started failure | finalize full reservation, retain claim |
| complete trustworthy success billing | finalize calculated actual usage |
| missing/malformed/out-of-envelope billing | finalize full reservation |
| finalization failure | retain provider-started claim; retry/reconcile full settlement |
| provider success then domain append failure | keep charged usage and claim |

Pre-provider abandonment always commits the generation-bound claim transition
before releasing a known reservation, so a concurrent provider-start update
cannot race with release. Failure of either step fails closed and is recoverable
by reconciliation.

Provider work followed by an ordinary optimistic event-append conflict remains
charged and settled. No automatic regeneration occurs. Application replay
returns a persisted winner when one exists. Without a persisted winner,
Decision recovery may use a new idempotency key, while invalidation retries the
original durable external event and active revision after the settled claim's
25-hour retention. It does not append a duplicate external-event receipt. If
the original revision is no longer the active monitored target, normal
application state validation rejects the retry rather than synthesizing a
second suggestion. The operator runbook makes this terminal recovery explicit.

## Privacy and observability

- The billing subsystem adds no new content persistence. Shared product content
  remains in its existing authorized events/projections and exists transiently
  in the provider request.
- D1 stores only operation metadata, opaque server scopes, lowercase SHA-256
  values, usage counters, and timestamps.
- Logs remain content-free and report operation, model, retries, latency, and
  token totals only.
- Public responses and events do not expose billing, provider IDs, key source,
  claim state, or reservation state.

## Verification

Tests must prove:

- complete per-attempt billing and retry aggregation in both adapters
- billing omission on missing or malformed usage
- per-attempt response-model validation and jittered capped retry
- pricing and reservation bounds for all three operations
- exact UTF-8 input cap before claim/reservation/provider
- claim → reserve → provider → finalize ordering
- active-lease suppression, safe expired-lease takeover, durable
  provider-start, settled retention, and bounded reconciliation
- exact caller-generated reservation recovery/collision checks and the crash
  boundary between usage finalization and claim settlement
- populated-0010 migration into fail-closed `legacy_blocked` rows
- exact replay, conflict, concurrent suppression, and generation-safe
  pre-provider abandonment
- full settlement after any provider-started uncertainty
- actual settlement only from complete trustworthy usage
- ordinary-user denial and manual/deterministic zero-ledger behavior
- 429 before provider when any shared limit is exhausted
- claim and usage rows contain no source/shared text, output, secret, or
  provider identifier
- disabled/unsafe deployment configuration never constructs live work
- browser E2E for invalidation 429, ordinary pending behavior, and durable
  manual/text continuation
- full unit, contract, Cloudflare, architecture, secret, build, and browser
  regression suites remain green

No UI behavior changes in this slice, so no new screenshot is required.
