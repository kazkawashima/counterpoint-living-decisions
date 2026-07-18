# External recheck results

Checked on 2026-07-19 before implementing provider adapters. These notes are
dated implementation inputs, not permanent assumptions.

## ER-03 — OpenAI model and structured outputs

- The current model catalog identifies `gpt-5.6` as the recommended alias and
  documents Responses API and Structured Outputs support.
- The JavaScript Structured Outputs path uses `responses.parse`,
  `zodTextFormat`, and `response.output_parsed`.
- Counterpoint therefore pins the OpenAI JavaScript SDK and keeps
  `OPENAI_MODEL=gpt-5.6` configurable instead of embedding a dated snapshot.
- Private disclosure generation uses `store: false`, a strict Zod schema,
  prompt/schema versions, a maximum of two adapter attempts, and independent
  exact-range validation before the application can create a candidate.
- Model output remains advisory. It cannot approve or publish evidence.
- A live synthetic smoke on 2026-07-19 resolved the configured `gpt-5.6` alias
  to `gpt-5.6-sol`, returned a schema-valid exact source range on the first
  attempt, and reported 247 input plus 299 output tokens. No key or source body
  was printed by the smoke script.
- A second live synthetic smoke for shared Decision synthesis on 2026-07-19
  resolved the same alias to `gpt-5.6-sol`, grounded every premise reference in
  the supplied shared Evidence IDs, grounded the Action owner in the supplied
  participant IDs, and succeeded on the first attempt. It reported 315 input
  plus 310 output tokens. The smoke used synthetic shared data and printed
  neither the API key nor source text.

Sources:

- <https://developers.openai.com/api/docs/models>
- <https://developers.openai.com/api/docs/models/gpt-5.6-sol>
- <https://developers.openai.com/api/docs/guides/structured-outputs>

## ER-04 — Realtime browser topology

- The current Realtime model documented for this path is
  `gpt-realtime-2.1`.
- The server creates a short-lived client secret through
  `/v1/realtime/client_secrets`; the browser uses that ephemeral value to
  establish a WebRTC call through `/v1/realtime/calls`.
- The standard API key remains server-side. Shared and private channels still
  require separate app sessions and authorization checks.
- Structured Outputs are not supported by the Realtime model, so transcripts
  must enter deterministic application commands or a separate validated
  Responses operation.

Sources:

- <https://developers.openai.com/api/docs/guides/realtime-webrtc>
- <https://developers.openai.com/api/docs/guides/realtime-conversations>
- <https://developers.openai.com/api/docs/models/gpt-realtime-2.1>

Before implementing A6, recheck account-specific client-secret lifetime,
session-duration limits, and rate limits in the target project. They are not
hard-coded from this recheck.
