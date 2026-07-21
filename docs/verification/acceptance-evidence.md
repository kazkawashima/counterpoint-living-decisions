# Acceptance evidence

This is the direct-proof map for AC-01 through AC-19 in
[`08-testing-acceptance-and-submission.md`](../specs/08-testing-acceptance-and-submission.md).
It distinguishes local proof from hosted, reel, and user-decision gates. A
green unit suite alone is not used to claim a hosted or browser requirement.

Status meanings:

- **Local proven** — committed automated proof exercises the required local
  behavior.
- **Partial** — relevant proof exists, but the primary proof named by the
  acceptance contract is incomplete.
- **Hosted gate** — local fail-closed proof exists; the required remote target
  has not been deployed or exercised.
- **Reel gate** — product behavior exists, but the timed narrative proof is
  intentionally deferred.

| AC    | Status       | Direct evidence                                                                                                                                                                                                                                                                                                                   | Residual gate                                                                   |
| ----- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| AC-01 | Local proven | `scripts/compose-persistence-smoke.mjs`; `npm run compose:smoke` builds a fresh isolated Compose project and reaches its external-style origin                                                                                                                                                                                    | Re-run from the final tagged commit                                             |
| AC-02 | Partial      | `tests/e2e/login-meeting.spec.ts` opens the flagship in three isolated browser contexts as Safety, Engineering, and Product; production judge login and the seeded Flagship were confirmed in a clean browser                                                                                                                     | First-time timed human rehearsal                                                |
| AC-03 | Local proven | `tests/e2e/meeting-creation.spec.ts` creates a 3-person room from the facilitator-only browser panel; integration and application tests enforce 3–8 unique users and one facilitator                                                                                                                                              | Hosted rerun                                                                    |
| AC-04 | Local proven | Assigned-list flow in `tests/e2e/login-meeting.spec.ts`; keyboard-operated code join in `tests/e2e/accessibility.spec.ts`                                                                                                                                                                                                         | Hosted rerun                                                                    |
| AC-05 | Local proven | `tests/integration/server-http.test.ts`, realtime E2E, payload/log secret assertions, and `npm run security:secrets`                                                                                                                                                                                                              | Final hosted log/response scan                                                  |
| AC-06 | Local proven | `tests/e2e/realtime-channels.spec.ts` and `tests/unit/web/realtime-openai.test.ts` cover immutable private/shared text and voice channels                                                                                                                                                                                         | Hosted Realtime provider proof remains separate                                 |
| AC-07 | Local proven | `tests/e2e/login-meeting.spec.ts`, `tests/e2e/shared-display.spec.ts`, disclosure application/security tests                                                                                                                                                                                                                      | Hosted C5 rerun                                                                 |
| AC-08 | Local proven | Decision/disclosure browser journeys, state-by-state full-workspace Axe/keyboard/reduced-motion audits, domain projection tests, and captures under `docs/media/screenshots/decision-commit/`, `decision-review/`, and `decision-resolution/`                                                                                     | Final visual review and the remaining review-refresh-loss Q3 capture            |
| AC-09 | Local proven | `tests/e2e/decision-commit.spec.ts` plus Decision state-machine tests                                                                                                                                                                                                                                                             | Hosted rerun                                                                    |
| AC-10 | Partial      | Decision invalidation/review/resolution E2E plus the production judge smoke prove `AT_RISK` → human-confirmed `REVIEW_REQUIRED`, held Action, task, history, and JSON export                                                                                                                                                      | Hosted C5 rerun and independent cost evidence                                   |
| AC-11 | Local proven | `tests/e2e/acceptance-isolation.spec.ts` creates Meeting B in isolated contexts and proves an unassigned Meeting A user receives 403 without private-source leakage                                                                                                                                                               | Hosted rerun                                                                    |
| AC-12 | Partial      | `npm run compose:smoke` proves local persistence; the credential-free Preview and production deployment records cover remote D1/DO/R2 bindings, migrations, and health/readiness/auth smoke                                                                                                                                       | Final tagged-commit rerun and hosted C5 evidence                                |
| AC-13 | Local proven | `tests/e2e/acceptance-isolation.spec.ts` proves Meeting B remains unchanged; `tests/e2e/guided-flagship.spec.ts` proves a fresh participant sees Context and no shared Evidence after the target flagship reset; disclosure unit tests prove pre-reset candidate/source/key reuse is rejected before publication or provider work | Hosted rerun                                                                    |
| AC-14 | Local proven | `tests/unit/adapters-node/api-key-leases.test.ts` uses a controlled clock at the five-minute boundary; application lease tests cover scope and clear                                                                                                                                                                              | Hosted eviction behavior remains operational monitoring                         |
| AC-15 | Local proven | `tests/e2e/decision-commit.spec.ts` and `tests/e2e/login-meeting.spec.ts` preserve manual Decision/disclosure, export, and audit paths during provider failure                                                                                                                                                                    | Hosted provider-failure rerun                                                   |
| AC-16 | Partial      | Full local flagship, the 2:30 rehearsal storyboard, and a 43.8-second three-case external-host Preview Playwright path are recorded in `docs/media/flagship-rehearsal.md`                                                                                                                                                         | Time a first-time human walkthrough and the final reel under the official limit |
| AC-17 | Partial      | Worker judge capability, disabled-provider continuity, and hosted smoke script are implemented; production judge identity, Secrets/routes, and the operator-confirmed Flagship path are recorded in `docs/deployments/production-2026-07-21.md`                                                                                   | Hosted C5 matrix and independent cost-limit evidence                            |
| AC-18 | Partial      | Worker/unit/Cloudflare tests reject ordinary users before managed work and browser controls remain absent                                                                                                                                                                                                                         | Hosted ordinary-user denial rerun                                               |
| AC-19 | Local proven | D1 limiter, managed-call lifecycle, structured-AI reservation tests, and browser 429/limit UI enforce the USD 25 rolling-24-hour cap                                                                                                                                                                                              | Hosted limit exhaustion proof without additional provider spend                 |

## Current non-acceptance release gates

- Hosted C5 matrix, independent cost-limit evidence, and the first-time timed
  human rehearsal. Production deployment/migrations, private judge identity,
  separate Worker Secret registration, and operator-confirmed judge/provider
  access are recorded in the production deployment record.
- Final project license, repository public visibility, final name/message
  hierarchy, Devpost preview, reel, submission tag, and judging-period
  operations.
- Final visual/OCR/frame scan of the exact public screenshots and video.

The full local command baseline is recorded in
[`docs/plans/impl/_status.md`](../plans/impl/_status.md) after each verified
slice. CI must keep the generated dependency and media manifests current.
