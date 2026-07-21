# AI, Realtime, and artifact specification

## Responsibility split

| Component | Responsibility |
|---|---|
| GPT-5.6 | Decision-state synthesis, premise/evidence suggestions, external-event assumption-invalidation suggestions |
| OpenAI Realtime | Voice capture assistance for explicit shared/private input paths |
| Deterministic code | Identity, ACL, event ordering, state transitions, limits, persistence, disclosure, confirmation |
| Human | Evidence disclosure, inference confirmation/rejection, Decision commit, `REVIEW_REQUIRED` confirmation |
| Codex | Build-time development; not required at product runtime |

Removing GPT-5.6 must materially reduce the product's synthesis and
invalidation capabilities. It must not be a decorative chat box.

## GPT-5.6 use cases

### Decision-state synthesis

Inputs:

- shared utterances and shared evidence only
- existing options, criteria, constraints, and confirmed premises
- schema version and prompt version

Outputs:

- candidate propositions, premises, evidence links, dissent, Action drafts,
  and readiness gaps
- source references
- confidence and concise reason

All outputs are candidate events. Humans confirm or reject material that will
become canonical.

### Private evidence assistance

Inputs:

- owner's private material
- shared state the owner is authorized to read

Outputs:

- owner-only disclosure candidates with exact source and quote range

The model cannot publish. The candidate does not enter shared logs or context.

### Assumption invalidation

Inputs:

- normalized external event
- active Decision revision
- confirmed dependent premises and monitor condition

Outputs:

- invalidation suggestion
- affected premise IDs and Action IDs
- evidence references
- confidence and reason

The application records the suggestion, moves the Decision to `AT_RISK`, and
waits for facilitator review before `REVIEW_REQUIRED`.

## Structured-output envelope

Every AI result includes:

- `operation`
- `schemaVersion`
- `model`
- `promptVersion`
- `inputReferenceIds`
- `generatedAt`
- typed `candidates`
- `confidence`
- `reason`

Unknown fields are rejected or ignored according to protocol versioning rules.
Schema-invalid results do not append domain events and may be retried within a
strict cap.

## Realtime topology

Shared and private are logically and technically separate OpenAI Realtime
sessions.

```text
Browser
  ├─ asks app server for short-lived secret scoped to channel
  ├─ connects directly to OpenAI Realtime over WebRTC
  └─ sends finalized transcript/event to app server
```

The standard API key never reaches the browser. Another participant's private
context never enters a client secret or Realtime session.

Judge-managed Realtime uses a separate topology. The browser offers exactly one
audio media section and no provider data channel. The call-controller Durable
Object owns the standard key, provider call ID, fixed session configuration,
response creation, response cancellation, duration alarm, and conservative
settlement. Input transcription uses the fixed server-selected
`gpt-realtime-whisper` model and its separately billed duration usage is
included in the same reservation proof. Transcript text is relayed through one
app-owned turn binding in transient Durable Object memory only; it is never
written to Durable Object storage, status, usage entries, or logs. The managed
route remains unavailable until authenticated same-origin routing and
per-request call ownership are complete.

The product does not deliver human voice to other humans. It is a meeting-state
input system, not conferencing.

## Speech interaction rules

- Microphones start off.
- User selects `Speak to room` or `Speak privately` before push-to-talk.
- Channel cannot change mid-utterance.
- Shared speech requires a server-side floor lease; only one active speaker.
- Each event carries `participantId`, `utteranceId`, `channel`, and
  `capturedAt`.
- Server processing is idempotent.
- Private speech should use a headset.
- A one-person multi-tab demo activates a microphone in only one tab.
- Text input is always present and produces equivalent domain commands.
- Browser media failures expose only an allowlisted recovery category:
  permission blocked, input device missing, input device unavailable, or
  Realtime track attachment failed. Raw browser and device details remain
  private, and a failed microphone request does not disconnect an otherwise
  healthy channel so the user can correct the setting and retry.

Connections are established when needed and closed after inactivity. Shared
event reception does not automatically trigger generation in every private
agent. Reconnect uses capped exponential backoff.

## Artifact lifecycle

```text
register metadata
→ authorize owner and meeting
→ upload to scoped storage
→ validate size/type/hash
→ process as untrusted data
→ create derived text/index references
→ expose only through authorized retrieval
```

Supported MVP inputs:

- PDF
- Markdown
- plain text
- file formats directly supported by the chosen OpenAI API path
- public HTTP(S) URLs after SSRF-safe fetch

The source binary and derived artifact have separate storage records and hashes.
Derived text does not change the source artifact's ownership or visibility.

## Degraded behavior

When GPT-5.6 or Realtime is unavailable:

- existing state remains readable
- text input remains available
- users can manually create/edit candidate premises and Decision fields
- facilitator can continue deterministic commit/review operations
- JSON export and audit history remain available
- UI identifies the unavailable dependency and retryability

Loss of a facilitator BYOK returns `API_KEY_REQUIRED` without discarding meeting
state.

## AI and Realtime acceptance

Tests MUST prove:

- structured-output validation and source-reference enforcement
- no direct canonical write by AI
- owner-only private assistance
- separate short-lived secret issuance by channel
- no standard key or private source in client payloads/logs
- shared floor lease and duplicate transcript handling
- text equivalence for the flagship
- capped retry and fallback behavior
- external event → AI suggestion → `AT_RISK`, with no automatic
  `REVIEW_REQUIRED`
