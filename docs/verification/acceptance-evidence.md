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

| AC    | Status       | Direct evidence                                                                                                                                                                                                                                                                                                                                             | Residual gate                                                                      |
| ----- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| AC-01 | Local proven | `scripts/compose-persistence-smoke.mjs`; `npm run compose:smoke` builds a fresh isolated Compose project and reaches its external-style origin                                                                                                                                                                                                              | Re-run from the final tagged commit                                                |
| AC-02 | Partial      | `tests/e2e/login-meeting.spec.ts` opens the flagship in three isolated browser contexts as Safety, Engineering, and Product; production judge login and the seeded Flagship were confirmed in a clean browser                                                                                                                                               | First-time timed human rehearsal                                                   |
| AC-03 | Local proven | `tests/e2e/meeting-creation.spec.ts` creates a 3-person room from the facilitator-only browser panel; integration and application tests enforce 3–8 unique users and one facilitator                                                                                                                                                                        | Hosted rerun                                                                       |
| AC-04 | Local proven | Assigned-list flow in `tests/e2e/login-meeting.spec.ts`; keyboard-operated code join in `tests/e2e/accessibility.spec.ts`                                                                                                                                                                                                                                   | Hosted rerun                                                                       |
| AC-05 | Local proven | `tests/integration/server-http.test.ts`, realtime E2E, payload/log secret assertions, and `npm run security:secrets`                                                                                                                                                                                                                                        | Final hosted log/response scan                                                     |
| AC-06 | Local proven | `tests/e2e/realtime-channels.spec.ts` and `tests/unit/web/realtime-openai.test.ts` cover immutable private/shared text and voice channels                                                                                                                                                                                                                   | Hosted Realtime provider proof remains separate                                    |
| AC-07 | Partial      | `tests/e2e/login-meeting.spec.ts`, `tests/e2e/shared-display.spec.ts`, disclosure application/security tests, and external Production `tests/e2e-cloudflare/worker-product-view.spec.ts` (2/2) cover the hosted Flagship, manual fallback, ordinary/display separation, and revocation                                                                      | Full hosted C5 rerun                                                               |
| AC-08 | Local proven | Decision/disclosure browser journeys, state-by-state full-workspace Axe/keyboard/reduced-motion audits, domain projection tests, and captures under `docs/media/screenshots/decision-commit/`, `decision-review/`, and `decision-resolution/`                                                                                                               | Final visual review and the remaining review-refresh-loss Q3 capture               |
| AC-09 | Local proven | `tests/e2e/decision-commit.spec.ts` plus Decision state-machine tests                                                                                                                                                                                                                                                                                       | Hosted rerun                                                                       |
| AC-10 | Partial      | Decision invalidation/review/resolution E2E plus the production judge smoke prove `AT_RISK` → human-confirmed `REVIEW_REQUIRED`, held Action, task, history, and JSON export. Cloudflare integration proves Worker review-resolution appends revision 3 locally; Production `f1d46ed` is deployed and its authenticated route probe reaches the new handler | Complete a private-judge hosted recommit, hosted C5, and independent cost evidence |
| AC-11 | Partial      | `tests/e2e/acceptance-isolation.spec.ts` plus external Production ordinary/display contexts prove the Flagship private-source and read-only projection boundary                                                                                                                                                                                             | Hosted C5 rerun across all exposed routes                                          |
| AC-12 | Partial      | `npm run compose:smoke` proves local persistence; the credential-free Preview and production deployment records cover remote D1/DO/R2 bindings, migrations, and health/readiness/auth smoke                                                                                                                                                                 | Final tagged-commit rerun and hosted C5 evidence                                   |
| AC-13 | Local proven | `tests/e2e/acceptance-isolation.spec.ts` proves Meeting B remains unchanged; `tests/e2e/guided-flagship.spec.ts` proves a fresh participant sees Context and no shared Evidence after the target flagship reset; disclosure unit tests prove pre-reset candidate/source/key reuse is rejected before publication or provider work                           | Hosted rerun                                                                       |
| AC-14 | Local proven | `tests/unit/adapters-node/api-key-leases.test.ts` uses a controlled clock at the five-minute boundary; application lease tests cover scope and clear                                                                                                                                                                                                        | Hosted eviction behavior remains operational monitoring                            |
| AC-15 | Local proven | `tests/e2e/decision-commit.spec.ts` and `tests/e2e/login-meeting.spec.ts` preserve manual Decision/disclosure, export, and audit paths during provider failure                                                                                                                                                                                              | Hosted provider-failure rerun                                                      |
| AC-16 | Partial      | Full local flagship, the 2:30 rehearsal storyboard, and a 43.8-second three-case external-host Preview Playwright path are recorded in `docs/media/flagship-rehearsal.md`                                                                                                                                                                                   | Time a first-time human walkthrough and the final reel under the official limit    |
| AC-17 | Partial      | Worker judge capability, disabled-provider continuity, and hosted smoke script are implemented; production judge identity, Secrets/routes, and the operator-confirmed Flagship path are recorded in `docs/deployments/production-2026-07-21.md`                                                                                                             | Hosted C5 matrix and independent cost-limit evidence                               |
| AC-18 | Partial      | Worker/unit/Cloudflare tests plus the external Production E2E reject ordinary access with `403 JUDGE_MODE_FORBIDDEN` before managed work, keep the manual fallback available, and keep display controls absent                                                                                                                                              | Hosted C5 response/log scan                                                        |
| AC-19 | Partial      | D1 limiter, managed-call lifecycle, structured-AI reservation tests, browser 429/limit UI, and the Production reconciliation dry-run (`attempted=0 settled=0 released=0 failed=0`) provide non-billable evidence                                                                                                                                            | Independent hosted limit exhaustion proof without additional provider spend        |

Latest hosted boundary slice: Production commit `f1d46ed` passed security
matrix `302/302`, Cloudflare pool `142/142`, target dry-run, migrations,
health/readiness/auth and Flagship smoke, plus the external browser boundary
`2/2` in `16.3s`. The reconciliation
dry-run was provider-free and mutation-free. These results strengthen the
hosted Flagship boundary but do not claim the full C5 matrix or independent
cost-limit exhaustion proof.

Current canonical-origin recheck: on 2026-07-21, the explicit Production
origin passed the read-only remote smoke (`health=200`, `ready=200`, SPA
`root=200`, unauthenticated API `401`) and
`tests/e2e-cloudflare/worker-product-view.spec.ts` passed `2/2` in `16.3s`.
The test used only synthetic Flagship state, and a follow-up Flagship smoke
reset the meeting to its initial state.
This refreshes the manual-fallback and ordinary/judge/display browser-boundary
evidence; it still does not close hosted C5, independent cost-limit proof, or
the first-time timed human rehearsal.

Implementation boundary recheck: the focused managed-AI suite passed `80/80`
across three Cloudflare integration files and three Worker unit files. It
proves local/contract replay, conflict, concurrency, ownership, termination,
reservation, and pre-provider limit behavior. It is not evidence of hosted C5
coverage or independent real-provider cost exhaustion.

Judge access recheck: the current judge UI keeps server-funded managed access as
the default, exposes only the rolling USD 25 cost meter, and offers an optional
tab-only personal key to the allowlisted judge. The HTTP contract suite passed
`51/51`, focused Cloudflare/unit coverage passed `18/18`, and the browser E2E
passed `1/1` for managed access, cost-only exhaustion fallback, and the
request-scoped `judgeProvided` client-secret path. The raw key was synthetic
and did not appear in the response or capture. This remains local/contract
evidence; it is not hosted C5 or independent provider-cost exhaustion proof.

Submission-critical P0 recheck: the Worker flagship integration now reaches
`REVIEW_REQUIRED` and successfully posts `review-resolution`, appending a
committed revision 3 (`14/14`). The full Decision browser E2E proves the stage
remains 5 until resolution and reports completion only after recommit (`1/1`).
The Realtime controller preserves non-retryable managed-call denials and makes
no automatic retry (`14/14` unit), while its browser E2E exposes the generation
limit and three-generation reservation with one start request (`1/1`). These
are local/contract/browser proofs. Canonical Production now runs `f1d46ed`,
and an authenticated incomplete-body probe returns `400 VALIDATION_FAILED`
from the new resolution handler. A private-judge revision 3 recommit remains
the final hosted semantic proof.
The post-change release baseline also passed build, secret scan, security
matrix `302/302`, and Cloudflare pool `142/142`.

## Current non-acceptance release gates

- Hosted C5 matrix, independent cost-limit evidence, and the first-time timed
  human rehearsal remain intentionally deferred by the owner. Production
  deployment/migrations, private judge identity, separate Worker Secret
  registration, and operator-confirmed judge/provider access are recorded in
  the production deployment record.
- The hosted revision-3 semantic walkthrough is delegated to the reviewer with
  exact actions and expected outcomes in
  [`production-reviewer-walkthrough.md`](./production-reviewer-walkthrough.md).
- Apache-2.0, the final name/message hierarchy, and the private Devpost judge
  credential handoff are closed. Repository public visibility, the submission
  tag, reel, and judging-period operations remain owner-controlled gates.
- Final visual/OCR/frame scan of the exact public screenshots and video.

The full local command baseline is recorded in
[`docs/plans/impl/_status.md`](../plans/impl/_status.md) after each verified
slice. CI must keep the generated dependency and media manifests current.

The current GitHub repository visibility is still private (`main`); the public
visibility switch remains an owner-controlled final release gate per UD-02.
