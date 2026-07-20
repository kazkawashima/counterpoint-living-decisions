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

- Rechecked against the official OpenAI Realtime WebRTC and API reference on
  2026-07-19 before implementing A6.
- The current Realtime model documented for this path is
  `gpt-realtime-2.1`.
- The server creates a short-lived client secret through
  `/v1/realtime/client_secrets`; the browser uses that ephemeral value to
  establish a WebRTC call through `/v1/realtime/calls`.
- The current API reference describes the client secret as expiring one minute
  after issuance. Counterpoint treats the provider's `expires_at` as
  authoritative instead of hard-coding that duration.
- The server includes a stable pseudonymous `OpenAI-Safety-Identifier` when
  minting the secret. The raw application user ID, meeting ID, participant ID,
  session ID, and private meeting content are not sent in the issuance body.
- The standard API key remains server-side. Shared and private channels still
  require separate app sessions and authorization checks.
- Structured Outputs are not supported by the Realtime model, so transcripts
  must enter deterministic application commands or a separate validated
  Responses operation.
- The WebRTC call `Location` header supplies a server-owned call ID. An
  application server can attach a sideband WebSocket to
  `/v1/realtime?call_id=...` to monitor and control that same session without
  exposing the standard key to the browser.
- Conversational billing is reported on each `response.done` event. The usage
  includes text/audio/image input details, cached-token details, and
  text/audio output details; input transcription, if enabled, is billed
  separately and therefore remains disabled in judge mode.
- The pinned `gpt-realtime-2.1` rate card checked on 2026-07-19 is, per one
  million tokens: text input USD 4, cached text input USD 0.40, text output
  USD 24, audio input USD 32, cached audio input USD 0.40, audio output USD 64,
  image input USD 5, and cached image input USD 0.50.

Sources:

- <https://developers.openai.com/api/docs/guides/realtime-webrtc>
- <https://developers.openai.com/api/docs/guides/realtime-conversations>
- <https://developers.openai.com/api/docs/guides/realtime-server-controls>
- <https://developers.openai.com/api/docs/guides/realtime-costs>
- <https://developers.openai.com/api/docs/models/gpt-realtime-2.1>

Before implementing A6, recheck account-specific client-secret lifetime,
session-duration limits, and rate limits in the target project. They are not
hard-coded from this recheck.

## ER-01, ER-02, and ER-08 — Submission, evidence, and repository access

Rechecked against the Official Rules, FAQ, and current submission update on
2026-07-20:

- The submission deadline is July 21, 2026 at 5:00 PM Pacific Time.
- The judging period runs through August 5, 2026 at 5:00 PM Pacific Time, so
  the working demo and testing access must remain available until then.
- The selected category remains **Work and Productivity**.
- The repository may be public with relevant licensing, or private and shared
  with both `testing@devpost.com` and `build-week-event@openai.com`.
- Current submission guidance is stronger than “publicly readable”: it says a
  public repository should have a relevant open-source license attached.
- The README must explain setup/sample data, Codex collaboration and
  acceleration, important human product/engineering/design decisions, and how
  Codex and GPT-5.6 contributed.
- The submission requires the `/feedback` Codex Session ID for the primary
  build thread.
- A pre-existing project must distinguish prior work from work added during the
  submission period using dated commit/session evidence.
- The public YouTube demo must be under three minutes, include audible
  explanation of Codex and GPT-5.6, and avoid unlicensed third-party marks,
  music, or other material.

Sources:

- <https://openai.devpost.com/rules>
- <https://openai.devpost.com/details/faqs>
- <https://openai.devpost.com/updates/45282-openai-build-week-submissions-are-open-plugin-launch>

ER-01, ER-02, and ER-08 are closed for the current implementation/submission
slice. ER-01 must still be rechecked immediately before final submission
because the Official Rules reserve the right to change.

## ER-11 — Dependency/media licensing and project-license boundary

Rechecked on 2026-07-20:

- The generated lockfile inventory currently contains 284 unique third-party
  package records.
- Application runtime dependencies use only MIT or Apache-2.0 identifiers.
- LGPL-3.0-or-later and MPL-2.0 identifiers occur only in development tooling
  (Sharp/libvips platform packages and Lightning CSS platform packages), not
  application runtime dependencies.
- `docs/media/ASSET_MANIFEST.json` inventories 60 PNG and 12 WebM first-party
  synthetic browser captures by path, byte count, SHA-256, creator, origin, and
  pending project rights status.
- The Official Rules require authorization for third-party SDK/API/data use and
  compliance with applicable open-source licenses. Current submission guidance
  says a public repository should have a relevant open-source license.
- Therefore MIT or Apache-2.0 is dependency-compatible for this repository, but
  either public grant is irrevocable for the released version. If preserving
  proprietary rights is more important, the compliant alternative is to keep
  the repository private and share it with the two official judging addresses.

Artifacts:

- [`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md)
- [`docs/media/ASSET_MANIFEST.json`](../media/ASSET_MANIFEST.json)
- [`BUILD_WEEK_LOG.md`](../../BUILD_WEEK_LOG.md)

Source:

- <https://openai.devpost.com/rules>
- <https://openai.devpost.com/details/faqs>
- <https://openai.devpost.com/updates/45282-openai-build-week-submissions-are-open-plugin-launch>

The machine-readable inventory and compatibility check are complete. ER-11
remains open only for the product owner's public-MIT/public-Apache/private
choice and the final copyright/NOTICE review. Do not make the repository public
while `license: "UNLICENSED"` remains.
