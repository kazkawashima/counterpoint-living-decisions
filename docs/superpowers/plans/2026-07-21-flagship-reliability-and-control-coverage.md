# Flagship Reliability and Control Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every submission-critical Flagship control produce its documented state, repair the verified walkthrough defects, and replace synthetic-only confidence in Realtime Connect with boundary-specific diagnostics and Worker-backed tests.

**Architecture:** Extract small pure helpers for Cloudflare error normalization, projection retry policy, AI prose normalization, and revision comparison, then keep React responsible only for rendering and scheduling. Preserve deterministic synthetic WebRTC tests for browser UI, but add Worker-route coverage so the application API can no longer be replaced wholesale without a separate real-stack assertion.

**Tech Stack:** TypeScript 6, React 19, Zod 4, Vitest 4, Playwright 1.61, Cloudflare Workers/D1/Durable Objects, OpenAI Realtime WebRTC.

---

### Task 1: Make Realtime Connect failures identify their boundary

**Files:**

- Modify: `apps/web/src/realtime-openai.ts`
- Modify: `apps/web/src/realtime-panel.tsx`
- Modify: `tests/unit/web/realtime-openai.test.ts`
- Modify: `tests/e2e/realtime-channels.spec.ts`
- Modify: `tests/cloudflare/worker-managed-realtime-http.test.ts`

- [ ] **Step 1: Write failing unit tests for staged connection errors**

Add assertions that media/offer creation, managed-call creation, SDP answer
application, and peer transition errors retain one of these public stages:

```ts
type RealtimeFailureStage =
  "access" | "call_creation" | "media" | "peer_negotiation";

expect(failure).toMatchObject({
  code: "REALTIME_CONNECT_FAILED",
  stage: "peer_negotiation",
});
```

- [ ] **Step 2: Run the focused unit test and verify RED**

Run:

```bash
npx vitest run tests/unit/web/realtime-openai.test.ts
```

Expected: FAIL because the current generic
`OpenAiRealtimeConnectionError` has no stable stage or public code.

- [ ] **Step 3: Add the minimal staged error type and preserve it through the controller**

Implement a typed error whose message is safe for the browser:

```ts
export class RealtimeConnectionStageError extends Error {
  readonly code = "REALTIME_CONNECT_FAILED";
  readonly retryable: boolean;
  constructor(
    readonly stage: RealtimeFailureStage,
    message: string,
    retryable = true,
  ) {
    super(message);
    this.name = "RealtimeConnectionStageError";
    this.retryable = retryable;
  }
}
```

Wrap only the boundary where a failure occurs; do not include SDP, token, API
key, or provider response data in the message.

- [ ] **Step 4: Write failing browser assertions for actionable Connect failure**

Extend the Realtime browser scenario so a failed managed-call start shows:

```ts
await expect(privateCard.getByText("Text fallback")).toBeVisible();
await expect(page.getByRole("alert")).toContainText(
  "Realtime call creation failed",
);
await expect(manualTextControls(page).input).toBeEnabled();
await expect(
  privateCard.getByRole("button", { name: "Try again" }),
).toBeVisible();
```

Assert exactly one start request occurs after one click.

- [ ] **Step 5: Run the focused browser test and verify RED**

Run:

```bash
npx playwright test tests/e2e/realtime-channels.spec.ts --grep "server-owned access"
```

Expected: FAIL because the current banner collapses the failure to the provider
message without identifying the connection stage.

- [ ] **Step 6: Render staged errors and retain deliberate retry**

Map safe stages in `RealtimePanel`:

```ts
const connectionStageMessage = {
  access: "Realtime access check failed.",
  call_creation: "Realtime call creation failed.",
  media: "Microphone setup failed.",
  peer_negotiation: "Realtime peer negotiation failed.",
} as const;
```

Keep manual text available and use the existing `Try again` control. Do not
start a second attempt automatically for a non-retryable API error.

- [ ] **Step 7: Add Worker integration assertions for the unmocked application route**

In the Worker test, call the actual
`POST /api/v1/meetings/:id/realtime/calls` handler with injected controlled
connector dependencies. Assert a successful response has the real schema and a
connector failure has the stable application error envelope. This test must
not intercept or replace the application route.

- [ ] **Step 8: Run Realtime unit, browser, and Worker tests and verify GREEN**

Run:

```bash
npx vitest run tests/unit/web/realtime-openai.test.ts
npx playwright test tests/e2e/realtime-channels.spec.ts --grep "server-owned access"
npx vitest run --config vitest.cloudflare.config.ts tests/cloudflare/worker-managed-realtime-http.test.ts
```

Expected: all focused checks pass with zero failures.

### Task 2: Bound projection recovery and understand Cloudflare 1102

**Files:**

- Create: `apps/web/src/projection-recovery.ts`
- Create: `tests/unit/web/projection-recovery.test.ts`
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/realtime-panel.tsx`
- Modify: `tests/unit/web/api.test.ts`
- Modify: `tests/e2e/realtime-channels.spec.ts`

- [ ] **Step 1: Write failing tests for Cloudflare problem normalization**

Add an API test using the review's 1102 body:

```ts
const body = {
  detail:
    "A Worker script configured by the website owner exceeded its resource limits.",
  error_code: 1102,
  owner_action_required: true,
  retryable: false,
  status: 503,
  title: "Error 1102: Worker exceeded resource limits",
};
```

Expect `getRoleProjection()` to reject with code
`CLOUDFLARE_WORKER_RESOURCE_LIMIT`, `retryable:false`, and a safe durable-state
message rather than `INVALID_RESPONSE` or `REQUEST_FAILED`.

- [ ] **Step 2: Run the API test and verify RED**

Run:

```bash
npx vitest run tests/unit/web/api.test.ts
```

Expected: FAIL because only the internal `ErrorEnvelopeSchema` is recognized.

- [ ] **Step 3: Normalize Cloudflare problem responses**

Add a narrow Zod schema and translate only error 1102:

```ts
const CloudflareProblemSchema = z.object({
  error_code: z.number().int(),
  retryable: z.boolean().optional(),
  status: z.number().int(),
  title: z.string(),
});
```

The returned browser message is
`Server capacity was exceeded. Your meeting state is safe; retry when ready.`
Do not surface `detail` verbatim.

- [ ] **Step 4: Write failing pure retry-policy tests**

Define the wished-for API:

```ts
expect(nextProjectionDelay(0, true)).toBe(2_000);
expect(nextProjectionDelay(1, true)).toBe(4_000);
expect(nextProjectionDelay(4, true)).toBe(30_000);
expect(nextProjectionDelay(0, false)).toBeUndefined();
```

- [ ] **Step 5: Run the retry-policy test and verify RED**

Run:

```bash
npx vitest run tests/unit/web/projection-recovery.test.ts
```

Expected: FAIL because the helper does not exist.

- [ ] **Step 6: Implement bounded retry scheduling**

Export a pure helper with delays `2s, 4s, 8s, 16s, 30s`. Replace the fixed
`setInterval(1_000)` with one completion-scheduled `setTimeout`, reset the
failure count on success, and stop automatic retries when the error explicitly
has `retryable:false`. Render one `Retry meeting state` control that starts a
new immediate read.

- [ ] **Step 7: Write and run browser coverage for no hot loop**

Use Playwright's clock or request counting to return one 1102 response and
assert no second request occurs within one second, the durable-state message is
visible, and a deliberate retry makes exactly one additional request.

Run:

```bash
npx playwright test tests/e2e/realtime-channels.spec.ts --grep "resource limit"
```

Expected after implementation: PASS.

### Task 3: Remove AI status wrappers from substantive Decision copy

**Files:**

- Create: `packages/adapters-openai/src/decision-copy.ts`
- Create: `tests/unit/adapters-openai/decision-copy.test.ts`
- Modify: `packages/adapters-openai/src/decision-synthesis.ts`
- Modify: `packages/adapters-openai/src/index.ts`
- Modify: `apps/web/src/app.tsx`
- Modify: `tests/e2e/decision-commit.spec.ts`

- [ ] **Step 1: Write failing normalization tests**

Cover the observed text exactly:

```ts
expect(
  normalizeDecisionCandidateCopy({
    title: "AI-Proposed: Establish Regional Launch Approval Gate",
    outcome:
      "AI-proposed outcome pending facilitator confirmation: regional launch proceeds only through a documented approval gate.",
  }),
).toEqual({
  title: "Establish Regional Launch Approval Gate",
  outcome: "Regional launch proceeds only through a documented approval gate.",
});
```

Also assert ordinary prose containing the letters `AI` is unchanged.

- [ ] **Step 2: Run the new unit test and verify RED**

Run:

```bash
npx vitest run tests/unit/adapters-openai/decision-copy.test.ts
```

Expected: FAIL because the normalizer does not exist.

- [ ] **Step 3: Add minimal normalization and tighten the model instruction**

Strip only known leading status wrappers, restore sentence capitalization, and
fall back to the original field if stripping would make it empty. Add this
instruction:

```ts
"Do not put provenance or workflow status phrases such as AI-Proposed or pending facilitator confirmation inside title or outcome; the UI labels provenance separately.";
```

Normalize the parsed model output before returning it to the browser.

- [ ] **Step 4: Add a failing browser assertion for committed prose**

Feed the observed model output through the existing Decision E2E and assert the
candidate retains an `AI proposed` badge while the committed title/outcome do
not match `/AI[- ]proposed|pending facilitator confirmation/iu`.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```bash
npx vitest run tests/unit/adapters-openai/decision-copy.test.ts tests/unit/adapters-openai/decision-synthesis.test.ts
npx playwright test tests/e2e/decision-commit.spec.ts --grep "committed prose"
```

Expected: all pass.

### Task 4: Prevent a content-free revision 3

**Files:**

- Create: `apps/web/src/decision-resolution.ts`
- Create: `tests/unit/web/decision-resolution.test.ts`
- Modify: `apps/web/src/app.tsx`
- Modify: `tests/e2e/decision-commit.spec.ts`

- [ ] **Step 1: Write failing tests for resolution initialization and comparison**

Define and test pure helpers:

```ts
expect(hasMaterialRevisionChange(current, current)).toBe(false);
expect(
  hasMaterialRevisionChange(current, {
    ...current,
    outcome: "Pause regional launch pending the revised approval gate.",
  }),
).toBe(true);
```

Assert Flagship defaults are materially different from the active revision even
when the page is opened after a reload.

- [ ] **Step 2: Run the unit test and verify RED**

Run:

```bash
npx vitest run tests/unit/web/decision-resolution.test.ts
```

Expected: FAIL because the helpers do not exist.

- [ ] **Step 3: Implement pure draft construction and no-op validation**

Move resolution draft construction out of the one-time `useState` initializer.
Track whether the user has edited resolution fields. When the reviewed Decision
arrives and the form is pristine, initialize the Flagship to the revised demo
copy; initialize ordinary Decisions from their active snapshot.

Before `resolveDecisionReview`, require a trimmed difference in title, outcome,
or monitor condition. Show
`Change the title, outcome, or monitor condition before committing a new revision.`
and do not issue a request for a no-op.

- [ ] **Step 4: Add reload and no-op browser regressions**

In a real server-backed Decision E2E:

1. Reach `REVIEW_REQUIRED`.
2. Reload.
3. Assert proposed revision 3 differs from revision 2.
4. Replace all three fields with revision 2 values.
5. Click `Commit revision 3` and assert no request is issued and the validation
   message appears.
6. Change the outcome and assert revision 3 commits and persists after reload.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```bash
npx vitest run tests/unit/web/decision-resolution.test.ts
npx playwright test tests/e2e/decision-commit.spec.ts --grep "revision 3"
```

Expected: all pass.

### Task 5: Correct presentation labels and walkthrough semantics

**Files:**

- Modify: `apps/web/src/app.tsx`
- Modify: `apps/web/src/styles.css`
- Modify: `docs/presentation/flagship-production-tutorial.md`
- Modify: `docs/verification/production-reviewer-walkthrough.md`
- Modify: `tests/e2e/decision-commit.spec.ts`

- [ ] **Step 1: Add failing browser assertions for the reviewed UI defects**

Assert:

```ts
await expect(
  decisionForge.getByRole("button", { name: "Confirm premise" }),
).toBeVisible();
await expect(commitGate.locator("span")).not.toHaveCSS("display", "inline");
await expect(
  decisionForge.getByText(/gpt-5\.6-sol|premise-[0-9a-f-]{8}/iu),
).toHaveCount(0);
```

After editing the premise, assert the accessible name changes to
`Confirm edited premise`.

- [ ] **Step 2: Run the focused browser test and verify RED**

Run:

```bash
npx playwright test tests/e2e/decision-commit.spec.ts --grep "presentation labels"
```

Expected: FAIL on the current unconditional label and inline commit-gate text.

- [ ] **Step 3: Implement accurate labels and layout**

Track whether the premise statement differs from the original candidate.
Render raw model and reference identifiers only in an optional provenance
detail, while the primary row says `OpenAI suggestion · grounded in shared Evidence`.
Add a `.commit-gate-copy` class using column flex layout and a visible gap.

- [ ] **Step 4: Correct both walkthroughs**

Insert `Generate Decision candidate` after excerpt approval in both documents.
Change the time-jump claim to `shows a staged synthetic event and its effective date`.
State that the three-minute path intentionally stops at `REVIEW_REQUIRED` plus
export, while the reviewer path continues through a materially edited revision
3 and reload.

- [ ] **Step 5: Run formatting and browser checks**

Run:

```bash
npx prettier --check apps/web/src/app.tsx apps/web/src/styles.css docs/presentation/flagship-production-tutorial.md docs/verification/production-reviewer-walkthrough.md
npx playwright test tests/e2e/decision-commit.spec.ts --grep "presentation labels"
```

Expected: all pass.

### Task 6: Add the Flagship control inventory

**Files:**

- Create: `tests/helpers/flagship-controls.ts`
- Create: `tests/e2e/flagship-control-inventory.spec.ts`
- Modify: `tests/e2e/decision-commit.spec.ts`
- Modify: `tests/e2e/realtime-channels.spec.ts`

- [ ] **Step 1: Define the expected state-owned controls**

Export a typed inventory whose entries have a state, accessible name, and test
owner:

```ts
export const flagshipControls = [
  { state: "context", name: "Prepare grounded sharing preview", owner: "main" },
  { state: "permission-preview", name: "Keep private", owner: "branch" },
  { state: "permission-preview", name: "Approve exact excerpt", owner: "main" },
  {
    state: "commitment-idle",
    name: "Generate Decision candidate",
    owner: "main",
  },
] as const;
```

Include every button rendered in the Flagship workspace, grouped by reachable
state. Controls intentionally disabled in a state remain in the inventory with
`enabled:false`.

- [ ] **Step 2: Write a failing inventory/meta-test**

Render or traverse each seeded state and compare the visible accessible button
names with the inventory for that state. Fail with the unregistered button
names. Also fail when an inventory entry has no scenario owner.

- [ ] **Step 3: Run the inventory test and verify RED**

Run:

```bash
npx playwright test tests/e2e/flagship-control-inventory.spec.ts
```

Expected: FAIL listing current controls that have not yet been registered.

- [ ] **Step 4: Complete the inventory and exercise alternate branches**

Register all discovered controls and add post-click assertions for Keep private,
Reject premise, retry/manual paths, cancel/confirm reset, all three review
resolutions, export/download, shared-display preparation, Connect/Disconnect,
channel selection, manual text, push-to-talk, BYOK set/remove, and usage
refresh/retry.

- [ ] **Step 5: Run the complete Flagship browser surface and verify GREEN**

Run:

```bash
npx playwright test tests/e2e/flagship-control-inventory.spec.ts tests/e2e/decision-commit.spec.ts tests/e2e/realtime-channels.spec.ts tests/e2e/guided-flagship.spec.ts
```

Expected: all tests pass, with every enabled inventory entry owned by at least
one scenario and followed by a state assertion.

### Task 7: Capture evidence and run the completion audit

**Files:**

- Create or update: `docs/media/screenshots/flagship-reliability/*`
- Create: `docs/media/screenshots/flagship-reliability/README.md`
- Modify: `docs/plans/impl/_status.md`
- Modify: `goal.txt`

- [ ] **Step 1: Capture changed UI states**

Run the changed Playwright scenarios with `CAPTURE_EVIDENCE=1` and save
synthetic desktop, mobile, and reduced-motion images for Connect success,
Connect staged failure, projection resource failure, cleaned candidate,
revision no-op validation, and corrected commit gate.

- [ ] **Step 2: Record only verified status**

Document test counts, commit, and remaining hosted verification. Do not mark
canonical Production Connect complete until it has been tested after deployment
with the private judge credential.

- [ ] **Step 3: Run focused verification**

Run:

```bash
npx vitest run tests/unit/web/api.test.ts tests/unit/web/projection-recovery.test.ts tests/unit/web/decision-resolution.test.ts tests/unit/web/realtime-openai.test.ts tests/unit/adapters-openai/decision-copy.test.ts tests/unit/adapters-openai/decision-synthesis.test.ts
npx playwright test tests/e2e/flagship-control-inventory.spec.ts tests/e2e/decision-commit.spec.ts tests/e2e/realtime-channels.spec.ts tests/e2e/guided-flagship.spec.ts
```

Expected: zero failures.

- [ ] **Step 4: Run repository gates**

Run:

```bash
npm run typecheck
npm run lint
npm run build
npm test
npm run test:cloudflare
npm run security:secrets
npm run media:manifest:check
npm run format:check
git diff --check
```

Expected: every command exits zero.

- [ ] **Step 5: Audit every design acceptance criterion**

Re-read
`docs/superpowers/specs/2026-07-21-flagship-reliability-and-control-coverage-design.md`
and identify direct code, test, screenshot, or hosted evidence for each criterion.
Any criterion without direct evidence remains open.

- [ ] **Step 6: Commit the verified implementation**

Stage only files owned by this plan. Preserve `.vscode/` and the user-provided
review files as untracked unless the user separately requests them committed.
Use an intentional implementation commit message such as:

```bash
git commit -m "fix: harden flagship judging flow"
```

- [ ] **Step 7: Request deployment authority if hosted proof remains**

Deployment and paid provider verification are external mutations. If not
already explicitly authorized for this implementation commit, stop after local
verification and ask for production deployment approval. After approval, deploy
with the guarded production workflow and have the owner perform one private and
one shared Connect check while credential values remain outside the repository.
