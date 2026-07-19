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

- [x] Implement PDF, Markdown, plain-text, and selected supported-file
      validation.
- [x] Enforce per-file, per-owner, and per-meeting limits.
- [x] Store source and derived artifacts separately with hashes.
- [x] Implement authorized upload/download.
- [x] Add processing states and safe error UI.

### A2 — SSRF-safe URL adapter

- [x] Implement scheme allowlist and destination classification.
- [x] Resolve/re-check each redirect.
- [x] Bound redirects, bytes, timeout, and content type.
- [x] Add DNS/redirect/private-network attack fixtures.
- [x] Treat fetched text as untrusted model data.

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

- [x] Implement BYOK/judge-managed key-source abstraction. A strict
      server-owned access descriptor now selects transient Node BYOK or
      allowlisted Worker managed calls without accepting a browser-selected
      mode. Hosted transient-DO BYOK configure, heartbeat, and clear parity plus
      the remaining spend gates stay in Plan 05.
- [x] Issue channel-scoped short-lived secrets without exposing standard key.
- [x] Build direct browser WebRTC connection.
- [x] Implement lifecycle, idle close, capped reconnect, and status UI.
- [x] Validate session identity for app realtime traffic.

### A7 — Voice channel interaction

- [x] Start microphone off.
- [x] Implement explicit push-to-talk shared/private controls.
- [x] Lock channel during utterance at the application boundary.
- [x] Implement the server shared-floor lease and atomic busy state.
- [x] Surface shared-floor owner/lease and queue/busy state in voice controls.
- [x] Deduplicate utterances by ID.
- [x] Make transcript command semantics identical to text.
- [x] Add Realtime failure-to-text fallback.

### A8 — Degraded mode

- [x] Simulate OpenAI and Realtime unavailability.
- [x] Preserve state reads, manual text, manual candidate/Decision edit, export,
      and audit.
- [x] Return `API_KEY_REQUIRED` after BYOK loss without losing meeting state.
- [x] Provide bounded retry/recovery UI.

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
