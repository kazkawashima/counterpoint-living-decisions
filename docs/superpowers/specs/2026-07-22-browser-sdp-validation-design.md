# Browser SDP validation repair

Date: 2026-07-22  
Status: Approved design, pending written-spec review

## Context

The canonical Production judge route reaches the managed Realtime call
controller, but a real browser `Connect` attempt returns
`VALIDATION_FAILED` before the Worker contacts OpenAI. The server-funded
Secret and judge authorization are available, and the configured
`gpt-realtime-2.1` model and `/v1/realtime/calls` endpoint match the current
OpenAI Realtime WebRTC interface.

A Chromium `RTCPeerConnection` reproduction generated a valid audio-only SDP
offer whose final bytes are `\r\n`. The controller's internal start parser
currently applies the generic `nonEmptyString` predicate to `sdpOffer`. That
predicate requires `value.trim() === value`, so it rejects the browser's
standards-shaped trailing CRLF and returns `INVALID_REQUEST`. Synthetic E2E
offers did not retain this browser characteristic.

## Decision

Change only the internal SDP predicate:

- accept a string when `sdpOffer.trim().length > 0`;
- retain the existing UTF-8 byte limit;
- preserve and forward the exact SDP bytes, including the trailing CRLF;
- keep the existing media-only validation in the OpenAI connector;
- continue rejecting empty, whitespace-only, oversized, data-channel, and
  non-audio offers.

Do not trim the SDP before hashing, reservation ownership, or forwarding.
Changing the bytes would make the server operate on a value different from
the browser offer and its request fingerprint. Do not relax the generic
opaque-ID or safety-identifier predicates.

## Alternatives rejected

1. Trim the SDP before forwarding. This mutates a browser-generated protocol
   document and changes its fingerprint, so it is unnecessary and riskier.
2. Relax `nonEmptyString` globally. That would weaken validation for opaque
   identifiers and safety identifiers unrelated to the failure.

## Data and error boundaries

The public API request and authorization flow remain unchanged. A valid
browser SDP passes from the authenticated judge request to the Durable Object,
then to the existing media-only connector and OpenAI. Provider keys, provider
error bodies, SDP content, participant-private content, and raw credentials
remain absent from logs and browser error responses.

If SDP is empty, whitespace-only, oversized, or not audio-only, the request
continues to fail before provider work. Existing cleanup continues to release
the cost reservation after a rejected start.

## Verification

Use TDD:

1. Add a controller-boundary regression test with an audio-only SDP ending in
   `\r\n`. Assert that the controller accepts the internal request and passes
   the exact unmodified SDP to the connector. Observe the test fail with
   `INVALID_REQUEST` before implementation.
2. Add or retain a whitespace-only SDP rejection assertion.
3. Apply the SDP-specific predicate change and observe the regression test
   pass.
4. Run the focused controller, managed-Realtime HTTP, adapter, protocol, and
   browser Realtime suites, followed by the repository release verification.
5. Deploy through the guarded Production workflow with the explicit judge
   flags, create a fresh judge session, and confirm both private and shared
   `Connect -> Connected -> Disconnect` paths.

## Completion criteria

- Real-browser-shaped SDP is accepted without normalization.
- Invalid and non-media-only SDP remains rejected before provider work.
- Existing authorization, idempotency, ownership, cost-cap, and Secret
  boundaries remain unchanged.
- Automated verification passes and the canonical Production owner check
  confirms private and shared managed Realtime connections.
