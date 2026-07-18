# Operations, observability, and resilience specification

## Operational goals

- Preserve the flagship during dependency failure.
- Bound financial exposure from judge mode.
- Make failures diagnosable without exposing private data.
- Keep the hosted judge path available through the required judging period
  after that period is re-verified.
- Make demo reset and replay deterministic.

## Health model

The runtime exposes:

- liveness: process/Worker can serve
- readiness: required persistence and migration state are available
- dependency status: OpenAI, artifact storage, realtime hub, and database

Dependency degradation does not make liveness fail. User-facing status clearly
distinguishes app availability from AI/voice availability.

## Structured logging

Every server log includes where applicable:

- timestamp
- level
- service/runtime
- operation
- correlation ID
- meeting ID in a non-secret operational form
- event type or error code
- duration
- retry count
- model and prompt version for AI operations
- token/connection usage totals

Never log API keys, Bearer/display tokens, raw audio, private artifact bodies,
private utterance text, complete prompts, or judge credentials.

## Metrics

Minimum operational metrics:

- HTTP request count, latency, and failure rate
- OpenAI request count, latency, token usage, and failure rate
- Realtime connection count, seconds, reconnects, and errors
- active meetings and Durable Objects
- event append and projection latency
- artifact processing count, bytes, and failures
- judge-mode usage by configured limit dimension
- webhook accepted/rejected/duplicate counts
- reset success/failure count

Metrics must not create a private-content side channel.

## Judge-mode limit behavior

Limits are configuration, enforced before external AI work:

- allowlisted account
- IP/rate window
- active meeting count
- concurrent Realtime connections
- Realtime seconds
- generation count
- input/output tokens
- daily currency-equivalent ceiling

Limit counters are durable enough to survive runtime restarts. When a limit is
reached:

1. No new billable request begins.
2. Existing durable state remains available.
3. The app returns `USAGE_LIMIT_REACHED`.
4. Text/manual degraded flow remains available.
5. Logs record the dimension, not credentials or content.

## Retry and failure policy

- Retry only operations classified as retryable.
- Use capped exponential backoff with jitter.
- Mutating retries require idempotency.
- Do not retry invalid auth, invalid schema, denied scope, or hard limits.
- A failed AI operation does not append a confirmed domain event.
- A failed realtime publication can be recovered from event position.

## Demo reset

Reset is available only to the facilitator for a meeting created from a demo
template.

The reset operation:

- identifies one meeting explicitly
- revokes live display/session-scoped meeting connections as necessary
- clears only that meeting's runtime/projection/artifact data
- reinstalls the known synthetic seed
- preserves an operator-level reset audit record without carrying prior
  private content into the new seed
- is idempotent

Implementation must use a scoped repository operation, never a broad database
or storage deletion.

## Backup, export, and retention

- JSON export includes authorized meeting state, revisions, and audit records.
- Private exports are available only to their owner or an explicitly authorized
  facilitator policy if later approved; shared exports contain no private
  payloads.
- Persistence survives local volume and hosted runtime restart tests.
- Production secret and judge credential revocation after judging are an
  explicit runbook step.

Long-term data retention is not a hackathon feature. Demo fixtures contain only
synthetic data.

## Deployment operations

### CI

- Pull requests: format, lint, type check, unit, contract, integration, build,
  and relevant E2E.
- Main: same gates plus a manually approved hosted deployment.
- Deployment credentials use least privilege and never print values.

### Release

- Deploy migrations before incompatible application traffic.
- Run health and flagship smoke after deploy.
- Record deployed commit and model/prompt configuration.
- Keep a rollback path that does not destroy newer events.
- Fix the submission commit with a tag after all final gates.

## Incident priorities

1. Private information exposure or secret leakage.
2. Judge-mode uncontrolled spend.
3. Flagship unable to complete.
4. Data corruption or cross-meeting access.
5. Video/README behavior drift.
6. Realtime degradation when text fallback works.
7. Optional features and visual polish.

Any priority 1–5 incident stops feature work.

## Operational acceptance

- Secret scanners and log assertions pass.
- Usage limits fail closed before an external request.
- OpenAI and Realtime outages preserve manual flagship progression.
- Local and hosted restart tests preserve durable state.
- Reset affects only its target meeting.
- Release smoke succeeds from a fresh environment.
- Judge credential and production-secret shutdown steps are documented and
  tested without revealing values.
