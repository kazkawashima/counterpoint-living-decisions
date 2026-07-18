# Contracts, events, and errors specification

This document defines the minimum protocol surface. Exact URL spelling may be
refined during implementation, but capabilities, scopes, and semantics are
fixed.

## Protocol rules

- JSON HTTP APIs use an explicit version prefix.
- Request and response DTOs live in `packages/protocol`.
- Dates are UTC ISO 8601 strings.
- IDs are opaque strings.
- Commands accept or derive a correlation ID.
- Mutation requests support idempotency where retries are plausible.
- The server derives user and capability from the session, never from
  client-supplied actor fields.

## HTTP capability surface

### Identity and meetings

| Method/capability | Purpose |
|---|---|
| Login | Exchange fixed credential for Bearer session |
| Logout | Revoke current session and release associated key lease |
| List available meetings | Return only assigned/active meetings |
| Join by meeting code | Resolve fallback participation path |
| Create meeting | Facilitator creates a meeting from a synthetic template |
| Assign participants | Facilitator assigns fixed users |
| Get role projection | Return private/shared/facilitator-appropriate state |

### Artifacts and disclosure

| Capability | Purpose |
|---|---|
| Register/upload artifact | Create owner-private or shared source artifact |
| Register URL | Fetch through SSRF-safe adapter |
| Get authorized artifact | Stream or issue short-lived authorized download |
| Propose disclosure | Create owner-only candidate |
| Preview disclosure | Return complete outgoing payload and hash |
| Approve/reject disclosure | Owner makes explicit decision |

### Deliberation and Decision

| Capability | Purpose |
|---|---|
| Submit utterance/text | Append shared or private input according to fixed channel |
| Synthesize state | Ask GPT-5.6 for candidate structured state updates |
| Confirm/reject inference | Authorized human disposition |
| Save Decision draft | Deterministic draft edit |
| Mark ready / commit | Facilitator-only lifecycle commands |
| Get Decision/history/audit | Read current revision and append-only lineage |

### Living Decision

| Capability | Purpose |
|---|---|
| Receive signed webhook | Normalize and process external event |
| Inject demo event | Facilitator command into the same use case |
| Review at-risk Decision | Read suggestion, references, and affected Actions |
| Confirm/reject review | Facilitator disposition |
| Commit revision / supersede / reject | Close review workflow |

### Operations

| Capability | Purpose |
|---|---|
| Configure/clear BYOK | Facilitator meeting-scoped transient key |
| Issue Realtime client secret | Channel-scoped short-lived secret |
| Heartbeat | Session/key lease and presence |
| Issue/revoke display token | Facilitator display management |
| Reset demo | Restore only facilitator-owned target meeting |
| Export JSON | Export authorized state and audit data |
| Health/readiness | Runtime and dependency status without secrets |

## Realtime application events

The app server publishes projection updates, not raw private event streams.
Each message includes:

- `type`
- `schemaVersion`
- `meetingId`
- `position`
- `correlationId`
- typed `payload`

Required message families:

- meeting/participant presence
- shared floor lease state
- shared-state projection update
- owner-private workspace update
- Decision lifecycle update
- Action/task update
- guided-demo progress
- dependency degradation/recovery
- token/session expiry warning

Subscriptions are authorized at connection time and rechecked when membership,
session, or display-token state changes.

## Error envelope

```json
{
  "code": "STABLE_MACHINE_CODE",
  "message": "Safe user-facing explanation",
  "correlationId": "opaque-id",
  "retryable": false,
  "details": {}
}
```

Rules:

- `code` is stable and documented.
- `message` is safe for the current user.
- `details` never includes stack traces, secrets, Bearer tokens, private source
  text, raw model prompts, or another meeting's identifiers.
- HTTP and realtime errors share the same logical envelope.
- Retriable dependency failures and non-retriable domain failures are distinct.

Minimum codes:

- `AUTHENTICATION_REQUIRED`
- `SESSION_EXPIRED`
- `FORBIDDEN`
- `MEETING_NOT_FOUND`
- `VALIDATION_FAILED`
- `CONFLICT`
- `IDEMPOTENCY_CONFLICT`
- `DISPLAY_TOKEN_EXPIRED`
- `API_KEY_REQUIRED`
- `JUDGE_MODE_FORBIDDEN`
- `USAGE_LIMIT_REACHED`
- `SHARED_FLOOR_BUSY`
- `ARTIFACT_TOO_LARGE`
- `ARTIFACT_TYPE_UNSUPPORTED`
- `URL_BLOCKED`
- `DISCLOSURE_PREVIEW_MISMATCH`
- `OPENAI_UNAVAILABLE`
- `REALTIME_UNAVAILABLE`
- `WEBHOOK_SIGNATURE_INVALID`
- `INVALID_STATE_TRANSITION`

## Idempotency

- Utterances use `utteranceId`.
- Webhooks use provider/event ID plus payload hash.
- Disclosure approval uses candidate ID plus preview hash.
- Commit/review mutations use an idempotency key.
- Reset uses a reset request ID.

Reusing a key with a different payload returns `IDEMPOTENCY_CONFLICT`. Reusing
it with the same payload returns the original result.

## Webhook contract

The MVP external event represents a regulatory change affecting a rollout
region. The normalized event includes:

- event ID and schema version
- meeting/monitor registration reference
- event type
- jurisdiction/region
- effective date
- source reference and concise description
- received timestamp

The webhook response acknowledges durable receipt, not successful AI
evaluation. Evaluation status appears through the audit/realtime surfaces.

## Versioning

- Protocol and event schema versions are independent.
- Additive optional fields are allowed within a version.
- Meaning changes require a new version and migration.
- Stored event versions remain readable indefinitely by migration/upcaster
  code.
- UI and server reject unsupported major protocol versions explicitly.

## Contract acceptance

Contract tests MUST verify DTO parsing, authorization context, error redaction,
idempotency, webhook signatures, event versioning/upcasting, and visibility-
scoped realtime publication across both runtime adapters.
