# Testing, acceptance, and submission specification

## Test layers

| Layer | Required scope |
|---|---|
| Unit | Reducers, state machine, ACL, disclosure, invalidation, revisions, projections, limits |
| Contract | SQLite/D1, local/R2, Node/DO realtime, OpenAI structured output |
| Integration | Auth/expiry, append/projection, artifacts, Webhook, Realtime secret, Decision reevaluation |
| Browser E2E | Complete role flows, multiple tabs/devices, shared/private, Commitment, Living Decision, reset |
| Security | IDOR, isolation, leakage, SSRF, upload spoofing, expiry, webhook replay, log secrets |
| Deployment smoke | Fresh Compose, persistent restart, Cloudflare preview/production, migrations |

Tests use deterministic clocks/IDs where useful and synthetic fixtures only.

## Required E2E journeys

### E2E-01 — Text flagship

Three users in separate browser contexts/tabs:

1. Log in and join assigned meeting.
2. Participant adds/opens private source.
3. Private input produces an owner-only disclosure candidate.
4. Shared views contain no candidate or private hint.
5. Owner edits and approves the exact snippet.
6. Shared screen receives the approved Evidence.
7. Facilitator confirms inference and commits Decision.
8. Demo event is injected.
9. Decision becomes `AT_RISK`.
10. Facilitator confirms review.
11. Decision becomes `REVIEW_REQUIRED`, affected Action is held, and task/history appear.

### E2E-02 — Voice channel separation

- Microphone begins off.
- Shared/private labels are keyboard operable.
- Channel is fixed during push-to-talk.
- Shared floor prevents simultaneous speaker.
- Private transcript stays owner-only.
- Text fallback remains available after simulated Realtime failure.

### E2E-03 — Meeting isolation

- Meeting A identity cannot read or mutate Meeting B.
- Owner A cannot retrieve Owner B private records.
- Shared display sees only shared projection.
- Revocation closes display access.

### E2E-04 — Session/key lifecycle

- Separate tabs keep separate users.
- Inactivity/absolute expiry paths are represented with a controllable test clock.
- BYOK loss keeps state and requests re-entry.
- Judge user works without BYOK.
- Ordinary user cannot use judge mode.
- Limit exhaustion fails before additional AI usage.

### E2E-05 — Persistence and reset

- Meeting, revisions, history, and artifacts survive runtime restart.
- Reset restores only the target demo meeting.
- Another meeting remains unchanged.

### E2E-06 — External access and responsive UI

- Dev/runtime binds to `0.0.0.0`.
- Browser reaches the app via an external-IP-style hostname.
- API, WebSocket, Realtime-secret, and artifact URLs resolve from that host.
- No CORS or hard-coded localhost failure.
- Flagship core works on desktop and mobile viewports.

### E2E-07 — Degraded mode

- Simulated OpenAI outage leaves existing state, manual input, manual Decision
  editing, JSON export, and audit history available.
- Dependency recovery is visible and retryable.

Every UI implementation slice adds or updates the relevant committed E2E case
and reel evidence.

## Acceptance matrix

| ID | Acceptance gate | Primary proof |
|---|---|---|
| AC-01 | `docker compose up` starts one reachable local URL | Fresh-environment smoke |
| AC-02 | Three fixed users work in separate tabs | E2E-01 |
| AC-03 | Facilitator creates meeting and assigns 3–8 users | Integration + E2E |
| AC-04 | Assigned list and code join both work | E2E |
| AC-05 | Meeting-scoped BYOK never reaches participants | Security + payload/log assertions |
| AC-06 | Shared/private voice and text are separate | E2E-02 |
| AC-07 | Private material does not leak before approval | E2E-01 + security |
| AC-08 | Fact, AI inference, and confirmed data differ in UI/storage | Unit + E2E + screenshot |
| AC-09 | Facilitator can commit a Decision | State-machine test + E2E |
| AC-10 | One event leads through `AT_RISK` and human-confirmed `REVIEW_REQUIRED`, Action hold, task | Unit + integration + E2E-01 |
| AC-11 | Meeting A cannot access Meeting B | E2E-03 + security |
| AC-12 | Durable data survives restart | E2E-05 + deployment smoke |
| AC-13 | Reset affects one meeting only | E2E-05 |
| AC-14 | Server BYOK is gone within five minutes of lease loss | Integration with test clock |
| AC-15 | OpenAI outage retains manual/degraded features | E2E-07 |
| AC-16 | Flagship is explainable in about three minutes | Timed rehearsal and final reel |
| AC-17 | Judge user completes without BYOK | Hosted E2E/smoke |
| AC-18 | Ordinary user cannot use judge key | Security/E2E |
| AC-19 | Judge cap prevents further spend and returns explicit error | Limit integration/E2E |

## Submission proof set

The following must describe the same flagship:

- public YouTube reel under the official time limit with narration
- English Devpost description
- English README
- repository and reproducible setup/test commands
- hosted judge path and non-public credential instructions
- GPT-5.6 runtime integration explanation
- Codex build-time contribution explanation and primary `/feedback` Session ID
- commit history and final submission tag
- screenshots and clips under `docs/media/`
- statement separating pre-existing topic references from new Build Week code
- known limitations and product-claim boundary

## Reel evidence minimum

Capture at least:

- private workspace boundary
- owner-only disclosure candidate
- approved snippet crossing into shared state
- Decision before and after commit
- external event arrival
- `AT_RISK` evidence review
- human-confirmed `REVIEW_REQUIRED`
- held Action and reconsideration task
- revision history
- mobile layout
- degraded text path

No real credentials, keys, personal data, or unlicensed third-party assets.

## Submission stop conditions

Stop optional work immediately if:

- a fresh browser cannot log in
- judge mode cannot finish the flagship without BYOK
- private content appears before approval
- users cannot distinguish shared/private or inference/confirmation
- Decision provenance is not traceable
- the flow cannot reach `AT_RISK` and human-confirmed `REVIEW_REQUIRED`
- app, video, README, and test instructions diverge
- clean setup instructions fail
- credentials or production secrets appear publicly

## Final release gates

1. Close or explicitly defer every item in
   [`user-decisions.md`](../decisions/user-decisions.md) that blocks submission.
2. Complete all external rechecks required by the current phase.
3. Pass the full automated suite and both deployment smokes.
4. Rehearse the flagship from a clean judge account within the reel duration.
5. Verify repository/demo access from a logged-out browser.
6. Verify credential privacy without placing a real credential in evidence.
7. Scan repository, logs, screenshots, and video frames for secrets/private data.
8. Push and tag the exact submission commit.
9. Keep the demo and credential operational through the verified judging end.
10. Revoke judge credential and rotate/delete its Secret after judging.
