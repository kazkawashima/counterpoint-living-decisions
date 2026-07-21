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
| AC-07 | Partial      | `tests/e2e/login-meeting.spec.ts`, `tests/e2e/shared-display.spec.ts`, disclosure application/security tests, and external Production `tests/e2e-cloudflare/worker-product-view.spec.ts` (2/2) cover the hosted Flagship, manual fallback, ordinary/display separation, and revocation                                            | Full hosted C5 rerun                                                            |
| AC-08 | Local proven | Decision/disclosure browser journeys, state-by-state full-workspace Axe/keyboard/reduced-motion audits, domain projection tests, and captures under `docs/media/screenshots/decision-commit/`, `decision-review/`, and `decision-resolution/`                                                                                     | Final visual review and the remaining review-refresh-loss Q3 capture            |
| AC-09 | Local proven | `tests/e2e/decision-commit.spec.ts` plus Decision state-machine tests                                                                                                                                                                                                                                                             | Hosted rerun                                                                    |
| AC-10 | Partial      | Decision invalidation/review/resolution E2E plus the production judge smoke prove `AT_RISK` → human-confirmed `REVIEW_REQUIRED`, held Action, task, history, and JSON export                                                                                                                                                      | Hosted C5 rerun and independent cost evidence                                   |
| AC-11 | Partial      | `tests/e2e/acceptance-isolation.spec.ts` plus external Production ordinary/display contexts prove the Flagship private-source and read-only projection boundary                                                                                                                                                                   | Hosted C5 rerun across all exposed routes                                       |
| AC-12 | Partial      | `npm run compose:smoke` proves local persistence; the credential-free Preview and production deployment records cover remote D1/DO/R2 bindings, migrations, and health/readiness/auth smoke                                                                                                                                       | Final tagged-commit rerun and hosted C5 evidence                                |
| AC-13 | Local proven | `tests/e2e/acceptance-isolation.spec.ts` proves Meeting B remains unchanged; `tests/e2e/guided-flagship.spec.ts` proves a fresh participant sees Context and no shared Evidence after the target flagship reset; disclosure unit tests prove pre-reset candidate/source/key reuse is rejected before publication or provider work | Hosted rerun                                                                    |
| AC-14 | Local proven | `tests/unit/adapters-node/api-key-leases.test.ts` uses a controlled clock at the five-minute boundary; application lease tests cover scope and clear                                                                                                                                                                              | Hosted eviction behavior remains operational monitoring                         |
| AC-15 | Local proven | `tests/e2e/decision-commit.spec.ts` and `tests/e2e/login-meeting.spec.ts` preserve manual Decision/disclosure, export, and audit paths during provider failure                                                                                                                                                                    | Hosted provider-failure rerun                                                   |
| AC-16 | Partial      | Full local flagship, the 2:30 rehearsal storyboard, and a 43.8-second three-case external-host Preview Playwright path are recorded in `docs/media/flagship-rehearsal.md`                                                                                                                                                         | Time a first-time human walkthrough and the final reel under the official limit |
| AC-17 | Partial      | Worker judge capability, disabled-provider continuity, and hosted smoke script are implemented; production judge identity, Secrets/routes, and the operator-confirmed Flagship path are recorded in `docs/deployments/production-2026-07-21.md`                                                                                   | Hosted C5 matrix and independent cost-limit evidence                            |
| AC-18 | Partial      | Worker/unit/Cloudflare tests plus the external Production E2E reject ordinary access with `403 JUDGE_MODE_FORBIDDEN` before managed work, keep the manual fallback available, and keep display controls absent                                                                                                                    | Hosted C5 response/log scan                                                     |
| AC-19 | Partial      | D1 limiter, managed-call lifecycle, structured-AI reservation tests, browser 429/limit UI, and the Production reconciliation dry-run (`attempted=0 settled=0 released=0 failed=0`) provide non-billable evidence                                                                                                                  | Independent hosted limit exhaustion proof without additional provider spend     |

Latest hosted boundary slice: Production commit `0d4f0e3` passed security
matrix `300/300`, Cloudflare pool `142/142`, health/readiness/auth and
Flagship smoke, plus the external browser boundary `2/2`. The reconciliation
dry-run was provider-free and mutation-free. These results strengthen the
hosted Flagship boundary but do not claim the full C5 matrix or independent
cost-limit exhaustion proof.

Current canonical-origin recheck: on 2026-07-21, the explicit Production
origin passed the read-only remote smoke (`health=200`, `ready=200`, SPA
`root=200`, unauthenticated API `401`) and
`tests/e2e-cloudflare/worker-product-view.spec.ts` passed `2/2` in `38.6s`.
The test used only synthetic Flagship state and reset it within that fixture.
This refreshes the manual-fallback and ordinary/judge/display browser-boundary
evidence; it still does not close hosted C5, independent cost-limit proof, or
the first-time timed human rehearsal.

Implementation boundary recheck: the focused managed-AI suite passed `80/80`
across three Cloudflare integration files and three Worker unit files. It
proves local/contract replay, conflict, concurrency, ownership, termination,
reservation, and pre-provider limit behavior. It is not evidence of hosted C5
coverage or independent real-provider cost exhaustion.

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

The current GitHub repository visibility is still private (`main`); the public
visibility switch remains an owner-controlled final release gate per UD-02.
