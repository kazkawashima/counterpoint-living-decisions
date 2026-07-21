# Browser SDP Validation Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Accept an exact audio-only browser WebRTC SDP ending in CRLF at the managed Realtime controller boundary without weakening any other validation.

**Architecture:** Keep the public HTTP, authorization, reservation, Durable Object, and OpenAI connector boundaries unchanged. Export the existing internal start-input parser for direct boundary regression coverage, replace only its SDP use of the generic trimmed-string predicate with a nonblank-string check, and preserve the exact SDP bytes through the parser.

**Tech Stack:** TypeScript, Cloudflare Durable Objects, Zod protocol contracts, Vitest Cloudflare pool, Playwright, Wrangler.

---

## File map

- Modify `apps/worker/src/judge-realtime-call-controller.ts`: expose the
  internal start parser and make SDP validation accept protocol-significant
  trailing CRLF without normalization.
- Modify `tests/cloudflare/judge-realtime-call-controller.test.ts`: prove the
  real-browser-shaped SDP passes unchanged and whitespace-only SDP still
  fails.
- Update `docs/plans/impl/_status.md`, `goal.txt`, and the Production deployment
  record only after automated and hosted verification are complete.

### Task 1: Lock the real-browser SDP regression with a failing test

**Files:**

- Modify: `tests/cloudflare/judge-realtime-call-controller.test.ts`
- Test: `tests/cloudflare/judge-realtime-call-controller.test.ts`

- [ ] **Step 1: Import the wished-for parser boundary**

Add `parseJudgeRealtimeStartCallInput` to the existing import from
`judge-realtime-call-controller.js`:

```ts
import {
  JUDGE_REALTIME_MAX_DURATION_SECONDS,
  JUDGE_REALTIME_RESERVED_COST_USD,
  JUDGE_REALTIME_RESERVED_USAGE,
  JudgeRealtimeCallLifecycle,
  isExactJudgeRealtimeReservation,
  parseJudgeRealtimeStartCallInput,
  type JudgeRealtimeCallStorage,
} from "../../apps/worker/src/judge-realtime-call-controller.js";
```

- [ ] **Step 2: Add the exact regression and rejection cases**

Place this block before `describe("JudgeRealtimeCallLifecycle", ...)`:

```ts
describe("managed Realtime start input parsing", () => {
  it("accepts a browser audio SDP ending in CRLF without normalization", () => {
    const browserSdp = [
      "v=0",
      "o=- 123 456 IN IP4 0.0.0.0",
      "s=-",
      "m=audio 9 UDP/TLS/RTP/SAVPF 111",
      "a=mid:0",
      "",
    ].join("\r\n");

    expect(
      parseJudgeRealtimeStartCallInput({
        ...input,
        sdpOffer: browserSdp,
      }),
    ).toEqual({
      ...input,
      sdpOffer: browserSdp,
    });
  });

  it("rejects a whitespace-only SDP", () => {
    expect(
      parseJudgeRealtimeStartCallInput({
        ...input,
        sdpOffer: " \r\n\t",
      }),
    ).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run the focused test and verify RED**

Run:

```bash
npx vitest run --config vitest.cloudflare.config.ts \
  tests/cloudflare/judge-realtime-call-controller.test.ts
```

Expected: FAIL because `parseJudgeRealtimeStartCallInput` is not exported.
This proves the new regression surface is absent before implementation.

### Task 2: Implement the SDP-specific parser rule

**Files:**

- Modify: `apps/worker/src/judge-realtime-call-controller.ts`
- Test: `tests/cloudflare/judge-realtime-call-controller.test.ts`

- [ ] **Step 1: Rename and export the existing parser**

Change the existing declaration and its one call site:

```ts
export function parseJudgeRealtimeStartCallInput(
  value: unknown,
): StartCallInput | undefined {
```

```ts
const parsed = parseJudgeRealtimeStartCallInput(body);
```

- [ ] **Step 2: Replace only the SDP trimmed-string predicate**

Keep every existing field and byte-limit check, but replace
`!nonEmptyString(value.sdpOffer)` with:

```ts
typeof value.sdpOffer !== "string" || value.sdpOffer.trim().length === 0;
```

Return `value.sdpOffer` unchanged. Do not call `.trim()` on the returned value.

- [ ] **Step 3: Run the focused test and verify GREEN**

Run:

```bash
npx vitest run --config vitest.cloudflare.config.ts \
  tests/cloudflare/judge-realtime-call-controller.test.ts
```

Expected: the controller test file passes, including exact CRLF preservation
and whitespace-only rejection.

- [ ] **Step 4: Commit the regression fix**

```bash
git add apps/worker/src/judge-realtime-call-controller.ts \
  tests/cloudflare/judge-realtime-call-controller.test.ts
git commit -m "fix: accept browser realtime SDP framing"
```

### Task 3: Verify adjacent managed Realtime boundaries

**Files:**

- Verify: `packages/adapters-openai/src/realtime-calls.ts`
- Verify: `apps/worker/src/judge-managed-realtime-http.ts`
- Verify: `apps/web/src/realtime-openai.ts`

- [ ] **Step 1: Run focused unit and Cloudflare tests**

```bash
npx vitest run \
  tests/unit/adapters-openai/realtime-calls.test.ts \
  tests/unit/worker/judge-managed-realtime-http.test.ts \
  tests/unit/web/realtime-openai.test.ts
npx vitest run --config vitest.cloudflare.config.ts \
  tests/cloudflare/judge-realtime-call-controller.test.ts \
  tests/cloudflare/worker-managed-realtime-http.test.ts
```

Expected: all selected tests pass with no Secret or SDP content printed.

- [ ] **Step 2: Run static and release gates**

```bash
npm run typecheck
npm run lint
npm run build
npm run security:verify
```

Expected: typecheck, lint, production build, secret scan, security matrix, and
Cloudflare pool all pass. The existing Vite large-chunk notice is a warning,
not a failure.

- [ ] **Step 3: Verify the committed diff**

```bash
git status --short
git diff --check HEAD~1..HEAD
git show --stat --oneline HEAD
```

Expected: only the parser and its regression test are in the fix commit; the
working tree contains no agent-created uncommitted files.

### Task 4: Deploy and close the hosted owner check

**Files:**

- Update after acceptance: `docs/plans/impl/_status.md`
- Update after acceptance: `goal.txt`
- Update after acceptance: `docs/deployments/production-2026-07-21.md`

- [ ] **Step 1: Deploy the verified commit with explicit judge flags**

From the isolated worktree, load the ignored Cloudflare credentials and run:

```bash
set -a
source ../../.env
set +a
CLOUDFLARE_DEPLOY_URL=https://counterpoint-living-decisions-production.gs2safari.workers.dev \
CLOUDFLARE_ENABLE_JUDGE_MODE=production \
CLOUDFLARE_JUDGE_USER_ID=judge \
CLOUDFLARE_DEPLOYMENT_APPROVED=production \
CLOUDFLARE_PRODUCTION_CONFIRMATION=counterpoint-production \
npm run cloudflare:deploy:production
```

Expected: guarded tests, migrations, strict Worker deployment, root/health/
readiness/auth smoke, and provider-free Flagship smoke pass.

- [ ] **Step 2: Perform the owner-hosted acceptance**

Use a fresh judge login at the canonical Production origin. For Private agent,
then Shared room, perform:

```text
Connect -> Connected -> Disconnect
```

Expected: neither path reports `API_KEY_REQUIRED`, `VALIDATION_FAILED`, nor a
call-creation error. The durable meeting state remains available after each
disconnect.

- [ ] **Step 3: Record credential-free evidence**

Append only the deployment commit/config hash, automated gate counts, and the
owner-observed private/shared state transitions to the three documentation
files. Do not record passwords, tokens, Secret values, SDP, provider call IDs,
or private content.

- [ ] **Step 4: Commit and push the closeout**

```bash
git add docs/plans/impl/_status.md goal.txt \
  docs/deployments/production-2026-07-21.md
git commit -m "docs: record browser SDP production acceptance"
git push origin codex/flagship-reliability:main
```

Expected: the remote `main` contains the verified fix and credential-free
acceptance record; unrelated user files remain untouched.
