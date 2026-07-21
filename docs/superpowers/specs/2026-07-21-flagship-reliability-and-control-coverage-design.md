# Flagship reliability and control coverage design

## Objective

Make the hosted Flagship path dependable enough for hackathon judging by fixing
the verified walkthrough defects, diagnosing and repairing the Realtime
`Connect` path at its real Worker boundary, and adding browser coverage for
every interactive control reachable in the Flagship workspace.

The success criterion is not merely that a button accepts a click. Each tested
control must either reach its documented next state or present a specific,
recoverable error while preserving durable meeting state and manual text.

## Scope

This slice covers:

- Private and shared Realtime `Connect`, `Disconnect`, and retry behavior for
  the production judge route.
- Projection polling behavior during Cloudflare resource failures.
- The exact disclosure-to-Decision-to-review-to-revision-3 Flagship arc.
- AI candidate copy that remains semantically correct after human commitment.
- Revision 3 initialization and prevention of content-free revisions.
- The presentation and reviewer walkthrough instructions.
- Small verified presentation defects: commit-gate spacing, inaccurate time-jump
  wording, the unconditional `edited` label, and raw internal provenance noise.
- The walkthrough addendum showing that the projector's unimplemented Meeting
  phase remains `Preparing` while the independent Decision lifecycle advances.
- A maintained browser-test inventory for all controls reachable from the
  Flagship workspace, including alternate, cancellation, retry, and reset
  branches.

This slice does not attempt to inventory every control in meeting creation,
artifact administration, or other non-Flagship product areas. It also does not
introduce projection snapshots unless Worker invocation evidence shows that
event replay is the resource-limit cause.

## Design

### 1. Diagnose and repair Realtime Connect at the real boundary

The existing Playwright Realtime suite replaces `RTCPeerConnection`, microphone
access, Realtime API routes, and OpenAI SDP exchange with synthetic success
responses. It proves browser state transitions but cannot prove that the hosted
Worker and provider handshake succeeds.

The implementation will first capture the failing boundary without exposing
credentials:

1. Distinguish access lookup, managed-call creation, SDP negotiation, and peer
   connection failures in the browser error state.
2. Verify the Worker managed-call route with the real Worker stack and a
   controlled provider adapter rather than intercepting the application route
   in Playwright.
3. Retain the synthetic WebRTC browser test for deterministic UI coverage.
4. After deployment, run one explicitly authorized judge connection check at
   the canonical production origin and record only status codes, public error
   codes, and state transitions. No token, SDP, credential, or private source
   body may be recorded.

`Connect` passes only when the card reaches `Connected`, the corresponding
channel is correct, and disconnect releases the call. A failure must identify
the failed stage, keep manual text enabled, and offer one deliberate retry. It
must not silently degrade with only a generic text-fallback message.

### 2. Replace hot projection retry with bounded recovery

Projection reads remain immediate while healthy. On consecutive failures the
client schedules retries at 2, 4, 8, 16, and at most 30 seconds. A successful
read resets the delay. Only one projection request may be in flight.

The API layer will recognize Cloudflare problem responses, including error
1102, without requiring them to match the application's internal error
envelope. Error 1102 receives a stable, non-secret user message explaining that
the durable meeting state remains safe. A response explicitly marked
non-retryable stops rapid automatic retries and exposes a deliberate retry
control.

Server-side snapshotting is deferred until Cloudflare invocation logs or a
repeatable load test identifies replay/serialization as the CPU or memory
hotspot.

### 3. Keep AI provenance out of committed prose

AI provenance remains visible as a badge while a candidate is advisory. The
model instruction will explicitly prohibit status labels such as
`AI-Proposed` and `pending facilitator confirmation` inside title and outcome
fields. A narrow normalization step will remove those known status wrappers
from model output before it enters the editable form, while preserving the
substantive text.

Human confirmation changes authority state; it does not leave contradictory
"pending confirmation" prose inside a committed Decision. Internal model
aliases and raw UUID-first provenance are replaced in the primary UI with
human-readable provenance summaries. Durable exports retain exact identifiers.

### 4. Require a meaningful revision 3

The review-resolution form receives its initial values when the relevant
Decision and review state are available, rather than relying on a one-time
component-mount snapshot. The Flagship path may supply concise revised demo
copy, but a generic Decision starts from its current snapshot and requires a
human edit.

For recommit resolution, at least one of title, outcome, or monitor condition
must differ from the active revision after trimming whitespace. A changed
reason alone cannot create an otherwise identical revision. The UI explains
the requirement and focuses the comparison form instead of submitting.

The primary confirmation button reads `Confirm premise` unless the user has
actually changed the premise, in which case it reads `Confirm edited premise`.

### 5. Align tutorial and completion semantics

Both walkthrough documents add the missing `Generate Decision candidate`
operation. The three-minute tutorial explicitly states that `REVIEW_REQUIRED`
plus export is its presentation endpoint and that revision 3 is covered by the
longer reviewer path. It no longer claims that the event card explains a time
jump; it states only what the UI actually shows: a staged synthetic event and
its effective date.

The longer reviewer path continues through a materially changed revision 3,
export, and reload persistence.

### 6. Flagship control inventory and browser coverage

A single test-owned control inventory lists every button reachable in the
Flagship workspace by state. Tests assert that each expected control is
visible, enabled or intentionally disabled, and has an accessible name. Every
enabled control is exercised in at least one browser scenario with a resulting
state assertion.

Coverage includes the main arc and these branches:

- Keep private and approve exact excerpt.
- Retry and manual fallback for private suggestion and Decision synthesis.
- Reject and confirm premise.
- Cancel and confirm reset.
- Decision draft, ready, commit, monitor, staged event, review confirmation,
  all resolution choices, export, download, and reload persistence.
- Private/shared Connect, Disconnect, retry, channel selection, manual text,
  push-to-talk, BYOK set/remove, and usage refresh/retry.
- Workspace navigation and shared-display preparation where those controls are
  visible to the Flagship facilitator.

The inventory is limited to the Flagship workspace so it remains maintainable
under the submission deadline. A separate later audit can extend the same
pattern to all product screens.

### 7. Project the implemented Decision lifecycle, not a false Meeting phase

Meeting phase and Decision lifecycle are separate canonical concepts. The
current event model does not implement intermediate Meeting phase transitions,
so deriving `deliberating` or `deciding` from Decision events would invent
unsupported semantics and make post-meeting monitoring mutate meeting history.

The shared projector therefore removes the prominent `Meeting phase` tile and
shows the latest shared `Decision lifecycle` status instead. Before a Decision
exists, it uses the truthful presentation state `Building shared context`.
The existing Meeting phase remains in protocol data for compatibility and a
future independently designed Meeting lifecycle; this slice does not fake or
backfill it.

The projector also removes raw `POSITION N`. That value is a visibility-scoped
event/synchronization cursor, not meeting progress or Decision state. It remains
in the DTO for synchronization and diagnostics but is not audience-facing.

## Error and safety boundaries

- Projection and Realtime failures never erase or reset meeting state.
- Manual text remains enabled whenever Realtime is degraded.
- Automatic retries are bounded and never create parallel provider work.
- Idempotency keys and ownership checks remain intact.
- Browser messages contain no provider credential, SDP, private source body,
  raw provider response, or account/IP pseudonym.
- Production verification performs at most the explicitly approved paid calls
  and remains under the rolling USD 25 application ceiling.

## Verification

The implementation follows RED-GREEN-REFACTOR for each behavior. Required
evidence is:

- Unit tests for Cloudflare problem parsing, retry scheduling, AI text
  normalization, and revision comparison.
- Worker integration coverage for the managed Realtime call boundary and
  Cloudflare problem response shape.
- Playwright coverage for the Flagship control inventory and all changed UI
  states, using `0.0.0.0` binding.
- Desktop, mobile, and reduced-motion screenshots of changed visible states.
- Typecheck, lint, build, focused tests, the complete relevant browser suite,
  and secret/media scans.
- A final canonical-production Connect and Flagship walkthrough after an
  explicitly approved deployment.

## Acceptance criteria

- Private and shared judge `Connect` each reach `Connected` in the canonical
  production workspace and can disconnect cleanly.
- A connection failure names its stage, preserves manual text, and does not
  spin indefinitely.
- Projection failure does not issue one request per second indefinitely.
- Human-committed title and outcome do not claim to be pending AI proposals.
- An unchanged revision 3 cannot be committed.
- Both walkthroughs contain every required operation and describe their chosen
  endpoint accurately.
- The commit gate is visually separated and all changed controls have accurate
  accessible names.
- The shared projector follows the actual Decision status through monitoring,
  risk, and review, never presents a permanently stale Meeting phase, and does
  not expose the raw event cursor as presentation content.
- Every enabled Flagship workspace button is exercised by at least one browser
  scenario with a post-click assertion.
