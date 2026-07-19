# Plan 03 — Private AI, Realtime, and artifacts

## Goal

Replace deterministic candidates with secure artifact-backed GPT-5.6
assistance, add explicit shared/private Realtime input, and preserve the full
text/manual degraded path.

## Inputs

- [Identity/security specification](../specs/02-identity-permissions-and-security.md)
- [AI/Realtime/artifact specification](../specs/03-ai-realtime-and-artifacts.md)
- [UI specification](../specs/06-ui-ux-motion-and-evidence.md)
- External rechecks ER-03 and ER-04
- Plan 02 exit gate

## Work packages

### A1 — Artifact ingestion

- [ ] Implement PDF, Markdown, plain-text, and selected supported-file
      validation.
- [ ] Enforce per-file, per-owner, and per-meeting limits.
- [ ] Store source and derived artifacts separately with hashes.
- [ ] Implement authorized upload/download.
- [ ] Add processing states and safe error UI.

### A2 — SSRF-safe URL adapter

- [ ] Implement scheme allowlist and destination classification.
- [ ] Resolve/re-check each redirect.
- [ ] Bound redirects, bytes, timeout, and content type.
- [ ] Add DNS/redirect/private-network attack fixtures.
- [ ] Treat fetched text as untrusted model data.

### A3 — OpenAI structured-output adapter

- [x] Resolve official GPT-5.6 model configuration from ER-03.
- [x] Implement prompt/schema versioning and structured-output validation.
- [x] Implement source-reference validation.
- [x] Record model, prompt version, usage, and latency without content/secrets.
- [x] Add capped retry and deterministic fake adapter.

### A4 — Private evidence assistance

- [x] Retrieve only owner-authorized private material plus allowed shared state.
- [x] Generate owner-only disclosure candidates with exact ranges.
- [x] Keep candidates out of shared model context, shared events/logs/screens,
      while retaining the owner-private candidate event needed for audit and
      replay.
- [x] Preserve existing server-side approval and preview-hash flow.
- [x] Add prompt-injection fixtures proving the model cannot publish.

### A5 — Shared Decision synthesis

- [x] Generate candidate propositions/premises/evidence links/dissent/Actions
      from shared context.
- [x] Require human confirmation/rejection for canonical material.
- [x] Show source references, confidence, reason, model, and origin.
- [x] Keep manual draft editing available.

### A6 — Realtime client-secret path

- [ ] Implement BYOK/judge-managed key-source abstraction.
- [ ] Issue channel-scoped short-lived secrets without exposing standard key.
- [ ] Build direct browser WebRTC connection.
- [ ] Implement lifecycle, idle close, capped reconnect, and status UI.
- [x] Validate session identity for app realtime traffic.

### A7 — Voice channel interaction

- [ ] Start microphone off.
- [ ] Implement explicit push-to-talk shared/private controls.
- [ ] Lock channel during utterance.
- [ ] Implement shared-floor lease and queue/busy state.
- [ ] Deduplicate utterances by ID.
- [ ] Make transcript command semantics identical to text.
- [ ] Add Realtime failure-to-text fallback.

### A8 — Degraded mode

- [ ] Simulate OpenAI and Realtime unavailability.
- [ ] Preserve state reads, manual text, manual candidate/Decision edit, export,
      and audit.
- [ ] Return `API_KEY_REQUIRED` after BYOK loss without losing meeting state.
- [ ] Provide bounded retry/recovery UI.

## Browser and security verification

- owner-only artifact and candidate visibility
- no private leakage in network payloads, logs, shared subscriptions, or
  screenshots
- prompt-injection source cannot publish
- shared/private voice channel separation
- shared-floor exclusion and duplicate handling
- key/client-secret payload inspection
- text fallback completing equivalent state changes
- external-host browser access for API, WebSocket, artifact, and secret routes

## Visual evidence

Capture:

- artifact upload/processing
- private agent suggestion with source range
- edited disclosure preview and approval transition
- shared state synthesis with AI/human labels
- shared/private push-to-talk states
- floor busy/reconnect/degraded text fallback
- reduced-motion form of the disclosure transition

## Exit gate

Real GPT-5.6 can propose owner-private evidence and shared Decision-state
candidates with valid references; only humans publish/confirm them. Shared and
private voice paths are explicit and isolated, and the same flagship through
Commitment still works when Realtime is disabled.

## Suggested commit boundaries

1. Artifact and URL security.
2. OpenAI structured outputs and private/shared candidate flows.
3. Realtime channels, degraded mode, E2E, and evidence.
