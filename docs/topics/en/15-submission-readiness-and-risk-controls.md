# 15 — Submission Readiness and Product Stabilization

Created: 2026-07-19
Target: Descant — Living Decisions (historical working title: Counterpoint)
Prerequisite specification: [14 — Implementation Requirements](./14-implementation-requirements.md)

## 1. Purpose

This document fixes the Why / What / How for submission accidents and product
instability while protecting one working scenario. It is not a complete
implementation order; it is the decision rule when feature work competes with
stabilization.

> Always prioritize the flagship scenario completing successfully over extra
> features, generalization, auxiliary demos, or visual decoration.

## 2. Judge access and API cost

### Why

Recorded rules require free, unrestricted access through judging. A BYOK-only
demo risks asking judges to pay or imposing a usage restriction. Public judge
credentials could also be abused for API spend.

### What

- General use: BYOK.
- Judge use: server-funded judge mode.
- Judge standard key: Cloudflare Worker Secret.
- Judge credentials: never in the public README, video, repository, or public description.
- Judge mode: available only to the judge user.

### How

1. Register `OPENAI_API_KEY_JUDGE` as a Cloudflare Secret.
2. Never put the production key in ordinary vars, `.env`, `.dev.vars`, or CI logs.
3. After judge authentication, the Worker alone uses the Secret for OpenAI calls
   or short-lived Realtime secret issuance.
4. Do not copy the standard key into the browser, Durable Object state, D1, R2, or audit events.
5. Hard-limit account, IP, meeting, concurrent connection, Realtime minutes,
   tokens, and daily spend.
6. After entering credentials in Devpost Testing Instructions, verify the
   submission preview and logged-out view do not expose them.
7. If privacy cannot be confirmed, use an approved private repository or operator channel.
8. Assume credentials leak; usage limits alone must still bound cost.
9. Revoke the credential and rotate/delete the Secret after judging.

## 3. Prioritize one scenario

### Why

Judges evaluate a working, coherent, reproducible product rather than feature
count. Several incomplete scenarios damage both design and reproducibility.

### What

The only must-ship scenario is the flagship **Global AI Product Rollout**:

```text
Login
→ Meeting
→ Private context
→ Speak to room / Speak privately
→ Explicit evidence disclosure
→ Shared decision state
→ Commitment
→ External event
→ AT_RISK
→ REVIEW_REQUIRED
```

### How

- Do not implement Quickstart or Meta demo until this works in a fresh environment.
- Auxiliary scenarios may remain seed fixtures or future documents.
- Implement only entity types that the flagship displays or transitions through.
- If Docker Compose and Cloudflare differ, prioritize the Cloudflare submission path.
- Video, README, and test instructions must describe the same flagship.

## 4. Voice topology

### Why

The MVP does not deliver human-to-human audio, so remote participants cannot
hear one another through the app. Multiple microphones in one room or multiple
tabs can duplicate transcripts, confuse speaker identity, and create echo.

### What

- Require push-to-talk for shared speech.
- Allow only one active shared speaker at a time.
- Recommend headsets for private speech.
- Describe this as meeting-state input, not voice conferencing.
- Always provide text input that produces the same event when audio fails.

### How

1. Microphones start OFF.
2. Show explicit `Speak to room` and `Speak privately` labels, not color alone.
3. Fix the path when speech starts; do not switch automatically mid-utterance.
4. Use a server-side lease for the shared floor and queue a second speaker.
5. Include `participantId`, `utteranceId`, `channel`, and `capturedAt` in client events.
6. Make server processing idempotent and absorb delayed/duplicate events.
7. Enable a microphone in only one tab for a one-person demo.
8. Fix device, browser, headset, and microphone permissions before recording.

## 5. Realtime count, cost, and failure

### Why

Three to eight participants with shared and private sessions can produce up to
16 Realtime sessions. Limits, disconnects, browser constraints, and cost depend
on account tier and duration. Running every private agent on every shared speech
makes usage grow with participant count.

### What

- Keep shared/private logic separate.
- Establish connections only when needed; do not keep 16 sessions open constantly.
- Separate shared-event reception from private-agent inference.
- Limit concurrent time and generation count in judge mode.

### How

- Prepare the target session before push-to-talk and close idle sessions.
- Let private agents receive shared events as state, but generate only on user
  action or a clear trigger.
- Use exponential backoff with a retry cap.
- Fall back to text when Realtime fails.
- Record model, connection seconds, tokens, and error rate without secrets.
- Load-test the three-person flagship; treat eight people as an upper bound.

## 6. AI inference and human confirmation

### Why

If AI directly changes a Decision to `REVIEW_REQUIRED`, it turns an inference
into a human fact and conflicts with “AI does not make the final decision.”

### What

- GPT-5.6 output is an `AT_RISK` candidate.
- A facilitator confirms `REVIEW_REQUIRED`.
- Store AI output and human confirmation as separate events.

### How

```text
ExternalEventReceived
→ AssumptionInvalidationSuggested
→ DecisionMarkedAtRisk
→ FacilitatorReviewed
→ DecisionReviewRequired
```

Record model, prompt version, input references, confidence, and reason on the AI
event. Show the affected assumption, evidence, and Action to the facilitator.
Record a rejection reason. The demo button injects the external event only; it
does not automate human confirmation.

## 7. Product-claim boundary

### Why

A staged demo cannot prove that decisions became correct or that the system has
superior general decision-making ability. Overclaiming harms impact and idea
quality credibility.

### What to prove

- Private information is shared under permission.
- Utterance, inference, and confirmed information remain distinct.
- A Decision carries evidence, assumptions, dissent, and Actions.
- Reality changes can make a Decision reviewable.

### What not to prove

- The final judgment is always correct.
- The system completely discovers organizational tacit knowledge.
- AI makes better executive decisions than humans.

Use traceability, permission, and responsiveness—not accuracy—as the outcome
language. In the UI, always distinguish “AI inferred” from “human confirmed.”

## 8. Private context and prompt injection

### Why

Private files or URLs may contain instructions telling the model to disclose
information. If a private agent can write to shared state, it can bypass owner
approval.

### What

- Give private agents no direct write access to shared state.
- Allow sharing only through an explicit server-side approval command.
- Preview the complete payload that will actually be shared.

### How

1. Treat external material as untrusted data, not instructions.
2. Do not automatically insert private search results into shared model context.
3. Include quote, source, filename, and metadata in every sharing candidate.
4. Re-validate owner, meeting, artifact, and quote range on approval.
5. Match the preview hash to the final shared-payload hash.
6. Give agents `proposeDisclosure`, not `publishDisclosure`.

## 9. API-key loss and recovery

### Why

Keeping BYOK only in Durable Object memory makes it safely disappear on eviction
but can interrupt a meeting. Asking a judge to re-enter a key damages the demo.

### What

- General BYOK: request re-entry after loss.
- Judge mode: issue a short-lived secret from the Worker Secret.
- Never persist the standard key in meeting state.

### How

Distinguish `facilitatorProvided` and `judgeManaged` as key sources. Do not pass
the standard key to a Durable Object in `judgeManaged` mode. On BYOK loss, keep
the meeting state and return `API_KEY_REQUIRED`; allow the user to retry the
failed command after setting the key again.

## 10. Meta-demo rights

Use fictional applications, fictional logos, self-created video, and self-created
evaluation material. Do not put real companies, applicants, or judges and their
logos in fixtures. Record creators and licenses for every video, audio, image,
and document in a manifest. Do not implement Meta demo before the flagship is complete.

## 11. GPT-5.6 and Codex evidence

The project’s concept work is largely based on GPT-5.6 conversation assets, and
implementation is intended to be greenfield and Codex-led. The README, actual
runtime integration, primary Codex `/feedback` Session ID, and commit history
must tell one consistent story.

- Do not copy the old kernel into the new repository as the product.
- Substantively integrate GPT-5.6 into Decision-state synthesis and assumption invalidation.
- Keep core implementation in the primary Codex thread.
- Distinguish existing reference material from new code.
- Document GPT-5.6 inputs, outputs, post-processing, and human confirmation boundary.
- Log model ID and prompt version without secrets.
- Separate Codex acceleration from human product and design decisions.
- Fix the final submission commit with a tag.

## 12. Documents to move into the new repository

Include the organized `topics` documents: rules, submission, IP, competition,
risk, product evolution, state model, Living Decisions, MVP, implementation
requirements, readiness, ideas archive, deferred ideas, and `topics/README.md`.

Do not include raw `talk1.md`–`talk11.md`, `utterance-tree.json`, conversation-
reconstruction scripts, old Meeting Runtime Kernel code, credentials, API keys,
`.env`, or `.dev.vars`.

The reason is that raw logs contain unresolved branches, duplication, and
internal material; the new repository is greenfield; organized topics preserve
the decision rationale and confirmed requirements without importing secrets.

## 13. Stop conditions before submission

Stop adding features and repair the flagship if any condition fails:

- A fresh browser cannot log in.
- A judge user cannot run without BYOK.
- Private information appears in shared view before approval.
- Users cannot tell shared from private paths.
- Decision sources and assumptions are not traceable.
- The flow cannot reach `AT_RISK` and human-confirmed `REVIEW_REQUIRED`.
- The video and app behavior diverge.
- README instructions do not reproduce elsewhere.
- Judge credentials or production secrets are exposed publicly.

## 14. References

- OpenAI Build Week Official Rules: <https://openai.devpost.com/rules>
- Devpost Testing Guide: <https://help.devpost.com/article/190-testing-guide>
- Cloudflare Workers secrets: <https://developers.cloudflare.com/workers/configuration/secrets/>
- OpenAI Realtime WebRTC: <https://developers.openai.com/api/docs/guides/realtime-webrtc>
