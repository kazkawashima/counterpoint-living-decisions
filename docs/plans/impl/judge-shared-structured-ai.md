# Durable judge shared structured-AI billing implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` (recommended) or
> `superpowers:executing-plans` to implement this plan task by task. Every
> production change follows RED → GREEN → REFACTOR.

**Goal:** Put private disclosure, shared Decision synthesis, and assumption
invalidation behind one durable provider-start lifecycle and the shared
rolling-24-hour USD 25 ledger before any judge-funded OpenAI request.

**Architecture:** A repeat-safe 0011 companion table adds reservation leases,
durable provider-start state, and settled tombstones without rebuilding 0010.
A generic Worker lifecycle owns named reservation recovery and reconciliation.
Request-scoped Decision and invalidation decorators preserve existing
application replay and public/domain contracts.

**Tech stack:** TypeScript, Cloudflare Worker/D1/R2, OpenAI Responses structured
outputs, Zod, Vitest/Miniflare, Playwright.

**Design:** [`judge-shared-structured-ai-design.md`](./judge-shared-structured-ai-design.md)

---

## Fixed execution details

- Migration 0011 creates
  `judge_managed_ai_operation_lifecycle` as a companion to the unchanged 0010
  claim table. `CREATE TABLE/INDEX IF NOT EXISTS` plus
  `INSERT OR IGNORE ... SELECT` makes the migration repeat-safe. A second run
  never rewrites lifecycle rows.
- Existing 0010 rows are inserted once as `legacy_blocked`. New repository
  operations create the 0010 claim and 0011 lifecycle row in one
  `D1DatabaseSession.batch()` transaction. A failure between the two statements
  rolls both back.
- `abandonReserved()` generation-conditionally deletes the 0010 parent; the
  lifecycle row is removed by `ON DELETE CASCADE`. The legacy `release()` path
  may delete only an old parent row that has no lifecycle companion.
- Old `claim()/release()` APIs remain available until Task 6 migrates private
  disclosure, but Task 2 hardens both against lifecycle companions:
  `claim()` cannot replace one and `release()` uses `NOT EXISTS`. This keeps
  Tasks 1–5 compile-safe without allowing `legacy_blocked` reuse or cascade
  deletion.
- Named-reservation APIs are additive concrete D1 methods; the generic
  `UsageLimiter` port is unchanged.
- Full jitter is
  `floor(random * (min(1000, 100 * 2 ** (attempt - 1)) + 1))`. Production
  randomness comes from Web Crypto; tests inject `0.5`.
- Input validation precedes reconciliation and every D1 mutation. Private
  disclosure validates its existing 64 KiB source-text limit. Decision
  synthesis and invalidation validate their complete provider JSON at 65,536
  UTF-8 bytes.
- Reconciliation processes at most 20 rows ordered by stale timestamp then
  claim hash. Each row is independent; failures remain retryable and the
  result reports content-free attempted/settled/released/failed counts.
- Pricing versions include `judge-structured-input-v1`; changing only that
  version must change the request fingerprint.
- Cloudflare integration proves D1/ledger behavior. Node browser tests prove
  UI handling with route interception. Worker browser tests prove the real
  Wrangler disabled/pending/manual-continuity path without provider access.

## Task 1 — Repeat-safe lifecycle migration

**Files:**

- Create:
  `apps/worker/migrations/0011_judge_managed_ai_operation_lifecycle.sql`
- Modify: `apps/worker/src/index.ts`
- Test: `tests/contract/cloudflare-d1-migrations.test.ts`

- [ ] Add a contract test named
      `backfills legacy managed-AI claims once without rewriting lifecycle`.
      It applies 0001–0010, inserts one 0010 row, applies 0011 twice, mutates the
      lifecycle row between runs, and expects the mutation to survive.
- [ ] Add schema assertions for:

```sql
status IN ('legacy_blocked','reserved','provider_started','settled')
reservation_id UNIQUE
reserved requires reservation_id and lease_expires_at_epoch
provider_started requires provider_started_at_epoch
settled requires settled_at_epoch and reuse_after_epoch > settled_at_epoch
```

- [ ] Run:

```bash
npm run contract -- --run tests/contract/cloudflare-d1-migrations.test.ts
```

Expected RED: 0011 is missing from migration order/schema.

- [ ] Add a companion table keyed by `claim_key_hash` with a foreign key to
      0010 using `ON DELETE CASCADE`. Use `INSERT OR IGNORE ... SELECT` to
      classify existing rows as `legacy_blocked`; do not rename, drop, or
      rebuild 0010.
- [ ] Append 0011 to `EXPECTED_D1_MIGRATIONS`.
- [ ] Re-run the exact contract command. Expected GREEN: all migration tests
      pass, including second application.
- [ ] Run `npm run typecheck`.
- [ ] Commit: `feat: add durable judge claim lifecycle`

## Task 2 — Conditional lifecycle repository

**Files:**

- Modify:
  `packages/adapters-cloudflare/src/d1-managed-ai-operation-claims.ts`
- Modify: `packages/adapters-cloudflare/src/index.ts`
- Test: `tests/cloudflare/d1-managed-ai-operation-claims.test.ts`

- [ ] Add RED tests named:
      `creates a reserved lifecycle with one opaque reservation`,
      `replays an active exact lease`,
      `conflicts a changed fingerprint`,
      `takes over an expired reserved generation conditionally`,
      `marks provider start once for the winning generation`,
      `never replaces provider-started work on lease expiry`,
      `marks finalized work settled for 25 hours`,
      `reuses settled work only after retention`, and
      `keeps legacy claims blocked`. Also fault-inject a failure between parent
      and lifecycle creation and prove neither row commits. Through the old
      API, prove an expired legacy-blocked parent cannot be replaced and no
      lifecycle companion can be cascade-deleted.
- [ ] Define the additive API in the test:

```ts
reserveClaim(input): Promise<
  | { kind: "reserved"; claim: ManagedAiOperationLifecycleClaim }
  | { kind: "replayed"; claim: ManagedAiOperationLifecycleClaim }
  | { kind: "conflict" }
>
takeOverReserved(input): Promise<"taken_over" | "unavailable">
markProviderStarted(input): Promise<"started" | "unavailable">
markSettled(input): Promise<"settled" | "unavailable">
abandonReserved(input): Promise<"abandoned" | "unavailable">
```

Every mutation input contains claim hash, fingerprint, reservation ID,
created-at generation, and expected status. New claim creation uses one
`D1DatabaseSession.batch()` call for the 0010 parent and lifecycle inserts.
`abandonReserved()` conditionally deletes the parent for the exact reserved
generation and relies on `ON DELETE CASCADE`; legacy `release()` may affect
only parent rows without a lifecycle companion.

- [ ] Run:

```bash
CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false npx vitest run \
  --config vitest.cloudflare.config.ts \
  tests/cloudflare/d1-managed-ai-operation-claims.test.ts
```

Expected RED: lifecycle methods are absent.

- [ ] Implement strict validation and single conditional D1 statements.
      Preserve the old signatures for private-disclosure compatibility, but
      add `NOT EXISTS` lifecycle guards to both the expired-parent upsert and
      release delete.
- [ ] Re-run the exact Cloudflare command. Expected GREEN.
- [ ] Run `npm run lint && npm run typecheck`.
- [ ] Commit: `feat: add judge claim state transitions`

## Task 3 — Caller-named D1 reservations

**Files:**

- Modify: `packages/adapters-cloudflare/src/d1-usage-limiter.ts`
- Test: `tests/cloudflare/d1-usage-limiter.test.ts`

- [ ] Add RED tests named:
      `inserts the caller reservation ID`,
      `recovers an exact durable insert after caller uncertainty`,
      `rejects a same-ID immutable-field collision`,
      `finds only content-free reservation state`, and
      `preserves trustworthy actuals when claim settlement was interrupted`.
- [ ] Fault-inject the uncertainty case after the D1 insert commits but before
      the first call resolves. Advance the test clock before retrying with the
      same identity and assert one ledger row, the original stored
      creation/expiry timestamps and grant, and no second request count.
- [ ] Define the concrete additive API:

```ts
reserveWithId(
  identity: {
    reservationId: string;
    requestFingerprint: string;
  },
  subject: UsageSubject,
  request: UsageRequest,
): Promise<D1NamedUsageDecision>;
findReservation(
  reservationId: string,
): Promise<ManagedUsageReservation | undefined>;
```

`D1NamedUsageDecision` keeps the existing denied branch and adds
`reservedAtEpoch` and `activeUntilEpoch` to its allowed branch.
`ManagedUsageReservation` exposes those same timestamps, identifiers needed
for exact ownership, status, and estimated/actual counters; it contains no raw
IP or content.

- [ ] Run:

```bash
CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false npx vitest run \
  --config vitest.cloudflare.config.ts \
  tests/cloudflare/d1-usage-limiter.test.ts
```

Expected RED: named APIs are absent.

- [ ] Refactor `reserve()` to generate an ID and delegate to
      `reserveWithId()`. Exact same-ID recovery requires equality of account,
      keyed IP, meeting, operation, model, pricing version, every estimate, and
      caller-supplied request fingerprint. Stored timestamps are authoritative;
      a retry never derives new creation or expiry timestamps. Mismatch throws
      without inserting.
- [ ] Re-run the exact Cloudflare command. Expected GREEN.
- [ ] Run `npm run lint && npm run typecheck`.
- [ ] Commit: `feat: recover named judge reservations`

## Task 4 — Shared billing accumulator and response-model attempts

**Files:**

- Create: `packages/adapters-openai/src/structured-ai-billing.ts`
- Modify: `packages/adapters-openai/src/private-disclosure.ts`
- Modify: `packages/adapters-openai/src/decision-synthesis.ts`
- Modify: `packages/adapters-openai/src/invalidation-evaluation.ts`
- Modify: `packages/adapters-openai/src/index.ts`
- Test: `tests/unit/adapters-openai/private-disclosure.test.ts`
- Test: `tests/unit/adapters-openai/decision-synthesis.test.ts`
- Test: `tests/unit/adapters-openai/invalidation-evaluation.test.ts`

- [ ] Add RED assertions to each successful adapter test:

```ts
expect(result.billing).toEqual({
  attemptCount: 1,
  attempts: [{ model: responseModel, inputTokens, outputTokens }],
  inputTokens,
  outputTokens,
});
```

- [ ] Add one retry test per Decision/invalidation adapter where the first
      response has trustworthy usage but invalid output. Expect two attempt
      rows and summed totals.
- [ ] Add table tests for missing model, missing usage, negative/fractional/
      unsafe/inconsistent totals, and one unmetered retry. Expect `billing` to
      be omitted.
- [ ] Run:

```bash
npx vitest run \
  tests/unit/adapters-openai/private-disclosure.test.ts \
  tests/unit/adapters-openai/decision-synthesis.test.ts \
  tests/unit/adapters-openai/invalidation-evaluation.test.ts
```

Expected RED: Decision/invalidation billing and per-attempt models are absent.

- [ ] Implement `StructuredAiBilling` and a reusable accumulator with
      `record(responseModel, usage)`, `invalidate()`, and
      `complete(attemptCount)`. Keep `PrivateDisclosureBilling` as an alias.
- [ ] Add optional billing only to concrete adapter result types. Do not change
      application interfaces, protocol schemas, or events.
- [ ] Re-run the exact Vitest command. Expected GREEN.
- [ ] Run `npm run lint && npm run typecheck`.
- [ ] Commit: `feat: meter all structured AI responses`

## Task 5 — Jitter, descriptors, pricing, and canonicalization

**Files:**

- Modify: the three adapter files from Task 4
- Modify: `apps/worker/src/judge-structured-ai.ts`
- Test: the three adapter tests from Task 4
- Test: `tests/unit/worker/judge-structured-ai.test.ts`

- [ ] Add RED jitter tests with injected random `0.5`. First retry expects
      50 ms from the 0–100 ms inclusive window; later retries remain bounded by
      1,000 ms. Auth/permission errors expect zero delay.
- [ ] Add RED descriptor tests for exact Decision/invalidation caps, envelopes,
      costs, two attempts, 120-second lease, 25-hour retention, eight
      generations, and 2,171,200 tokens.
- [ ] Add RED pricing tests for each supported GPT-5.6 model, mixed response
      models, per-attempt long context, unknown/versioned model, unsafe
      arithmetic, and usage outside each envelope.
- [ ] Add RED `judge-structured-input-v1` tests. Equal entity sets in different
      order hash equally; changed content or canonicalization version hashes
      differently; Action scope order remains significant.
- [ ] Run:

```bash
npx vitest run \
  tests/unit/adapters-openai/private-disclosure.test.ts \
  tests/unit/adapters-openai/decision-synthesis.test.ts \
  tests/unit/adapters-openai/invalidation-evaluation.test.ts \
  tests/unit/worker/judge-structured-ai.test.ts
```

Expected RED: jitter injection and shared descriptors/helpers are absent.

- [ ] Implement the fixed full-jitter formula, descriptor constants, generic
      actual-pricing function, UTF-8 provider-JSON measurement, canonical
      serializer, and SHA-256 fingerprint helper. Keep private-disclosure
      pricing exports as wrappers.
- [ ] Include `judge-structured-input-v1` in every structured pricing version.
- [ ] Re-run the exact Vitest command. Expected GREEN.
- [ ] Run `npm run lint && npm run typecheck`.
- [ ] Commit: `feat: bound shared judge AI operations`

## Task 6 — Generic lifecycle and private-disclosure migration

**Files:**

- Create: `apps/worker/src/judge-managed-structured-ai.ts`
- Modify: `apps/worker/src/judge-private-disclosure.ts`
- Test: `tests/unit/worker/judge-managed-structured-ai.test.ts`
- Test: `tests/unit/worker/judge-private-disclosure.test.ts`

- [ ] Add a RED test named
      `validates before reconciliation or any D1 mutation`. Pass 65,537 UTF-8
      provider-input bytes and assert zero reconcile, claim, reserve, and
      provider calls.
- [ ] Add RED lifecycle tests for:
      validate → reconcile → reserved claim → named reserve → durable
      provider-start → provider → finalize → settled; active lease replay;
      expired exact takeover; missing reservation replacement; immutable
      mismatch; losing provider-start CAS; and settled retention.
- [ ] Add RED recovery tests for:
      provider-started/still-reserved → full finalize;
      provider-started/already-actual-finalized → mark settled without changing
      actuals; finalization failure retry; and legacy-blocked.
- [ ] Add RED sink-privacy tests. Raw content is allowed in transient
      fingerprint/provider arguments, but must be absent from claim/ledger
      rows, structured logs, errors, and public results.
- [ ] Run:

```bash
npx vitest run \
  tests/unit/worker/judge-managed-structured-ai.test.ts \
  tests/unit/worker/judge-private-disclosure.test.ts
```

Expected RED: generic module is missing.

- [ ] Implement `JudgeManagedStructuredAiError` and the generic lifecycle.
      Provider invocation must follow a successful generation-bound
      `markProviderStarted()` result.
- [ ] Refactor private disclosure to use the generic lifecycle. Remove use of
      the old claim/release path only after equivalent unit tests are green.
- [ ] Re-run the exact Vitest command. Expected GREEN.
- [ ] Run the Task 2 and Task 3 Cloudflare tests to confirm lifecycle/named
      reservation compatibility.
- [ ] Run `npm run lint && npm run typecheck`.
- [ ] Request spec review, then quality review; resolve all
      Critical/Important findings.
- [ ] Commit: `refactor: unify judge structured AI lifecycle`

## Task 7 — Bounded reconciliation and callable operator command

**Files:**

- Modify: `apps/worker/src/judge-managed-structured-ai.ts`
- Create:
  `packages/adapters-cloudflare/src/judge-structured-ai-reconciliation.ts`
- Modify:
  `packages/adapters-cloudflare/src/d1-managed-ai-operation-claims.ts`
- Modify: `packages/adapters-cloudflare/src/index.ts`
- Create: `scripts/cloudflare-remote-approval.sh`
- Modify: `scripts/cloudflare-deploy.sh`
- Create: `scripts/reconcile-judge-structured-ai.sh`
- Create: `scripts/reconcile-judge-structured-ai.mjs`
- Modify: `package.json`
- Create: `docs/runbooks/judge-structured-ai-reconciliation.md`
- Test: `tests/unit/worker/judge-managed-structured-ai.test.ts`
- Test: `tests/cloudflare/d1-managed-ai-operation-claims.test.ts`
- Test: `tests/contract/judge-structured-ai-reconciliation.test.ts`

- [ ] Add RED D1 repository tests for
      `listStale({ limit: 20, nowEpoch })`: only stale `reserved` and
      `provider_started` rows are returned, ordered by stale timestamp then
      claim hash, capped at 20, and containing no raw content.
- [ ] Add RED unit tests for a 20-row batch ordered by stale timestamp/hash.
      Cover expired pre-provider abandonment/release, provider-started full
      finalization, already-finalized settlement, per-row partial failure, and
      no provider-started release.
- [ ] Add RED command contract tests. The command accepts only target and
      `--dry-run|--apply`, prints content-free counts, defaults to dry-run,
      and never reads or prints OpenAI/HMAC Secrets. Apply must reuse extracted
      deployment checks: `CLOUDFLARE_DEPLOYMENT_APPROVED=<target>`, exact
      production confirmation, clean worktree, and optional `GITHUB_SHA`
      equality.
- [ ] Run:

```bash
npx vitest run tests/unit/worker/judge-managed-structured-ai.test.ts
npm run build --workspace @counterpoint/adapters-cloudflare
npm run contract -- --run \
  tests/contract/judge-structured-ai-reconciliation.test.ts
```

Expected RED: reconciliation batch and command are absent.

- [ ] Implement bounded automatic reconciliation before managed operations.
      Each row commits independently; failed rows remain eligible for retry.
      Put the content-free stale selection and every generation/status-
      conditional transition statement in
      `judge-structured-ai-reconciliation.ts`. Both the D1 repository used by
      the Worker and the operator executor import these same builders.
- [ ] Implement `npm run judge:reconcile -- <target> --dry-run|--apply`.
      The package script first runs
      `npm run build --workspace @counterpoint/adapters-cloudflare`, so its
      Node executor always imports the current shared statements from `dist`.
      The shell driver and deployment driver source
      `cloudflare-remote-approval.sh`; apply therefore uses the exact existing
      target, production, clean-tree, and optional commit checks. The Node
      executor imports the built shared statement module, renders the
      repository's ignored target config, and invokes
      `wrangler d1 execute DB --remote --config <rendered-config>`. Dry-run
      executes only the shared content-free stale-row `SELECT`; apply executes
      only shared generation/status-conditional statements. It never receives
      provider or HMAC credentials.
- [ ] Write the exact runbook for legacy verification, full-finalization,
      25-hour retention, partial failure, and escalation. It forbids releasing
      provider-started usage.
- [ ] Re-run the exact unit/contract commands. Expected GREEN.
- [ ] Run:

```bash
CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false npx vitest run \
  --config vitest.cloudflare.config.ts \
  tests/cloudflare/d1-managed-ai-operation-claims.test.ts
```

      Expected GREEN for the real D1 `listStale()` implementation.
- [ ] Run `npm run security:secrets && npm run lint && npm run typecheck`.
- [ ] Commit: `feat: reconcile durable judge AI work`

## Task 8 — Request-scoped shared Decision decorator

**Files:**

- Create: `apps/worker/src/judge-shared-decision.ts`
- Modify: `apps/worker/src/worker-flagship-http.ts`
- Test: `tests/unit/worker/judge-shared-decision.test.ts`
- Test: `tests/unit/worker/worker-flagship-http.test.ts`

- [ ] Add RED decorator tests for completed application replay before claim,
      current facilitator/judge authorization, exact idempotency claim,
      canonical full snapshot fingerprint, concurrent suppression, changed
      snapshot conflict, and actual/full settlement.
- [ ] Assert stored pricing version and request fingerprint both change when
      only `judge-structured-input-v1` changes.
- [ ] Add RED HTTP tests for judge `ai_preferred`, ordinary denial, manual zero
      lifecycle, deterministic zero lifecycle, disabled/unconfigured failure,
      and oversize validation before mutation.
- [ ] Run:

```bash
npx vitest run \
  tests/unit/worker/judge-shared-decision.test.ts \
  tests/unit/worker/worker-flagship-http.test.ts
```

Expected RED: managed Decision runtime/decorator is absent.

- [ ] Implement the decorator only after current session, assignment,
      facilitator role, and judge capability resolve. Wrap only the concrete
      synthesizer call so existing persisted replay remains first.
- [ ] Keep manual dependencies synthesizer-free and deterministic dependencies
      outside the managed lifecycle.
- [ ] Re-run the exact Vitest command plus
      `tests/unit/application/decision-candidates.test.ts`. Expected GREEN.
- [ ] Run `npm run lint && npm run typecheck`.
- [ ] Request spec review, then quality review; resolve all findings.
- [ ] Commit: `feat: meter judge Decision synthesis`

## Task 9 — Request-scoped invalidation decorator and typed 429

**Files:**

- Create: `apps/worker/src/judge-assumption-invalidation.ts`
- Modify: `apps/worker/src/worker-flagship-http.ts`
- Test: `tests/unit/worker/judge-assumption-invalidation.test.ts`
- Test: `tests/unit/worker/worker-flagship-http.test.ts`
- Test: `tests/unit/application/invalidation-evaluations.test.ts`

- [ ] Add RED decorator tests for original event/revision claim identity,
      canonical complete evaluator fingerprint, completed replay first,
      concurrent suppression, changed revision conflict, and settlement.
- [ ] Assert the canonicalization version is present in pricing metadata and
      changes the fingerprint.
- [ ] Add RED HTTP tests where the external receipt is durable before:
      429 `USAGE_LIMIT_REACHED {limit}`; provider failure returning 202 pending;
      and exact retry after retention using the original receipt/revision.
- [ ] Assert ordinary/deterministic paths create no judge claim/ledger and
      Node application contracts remain unchanged.
- [ ] Run:

```bash
npx vitest run \
  tests/unit/worker/judge-assumption-invalidation.test.ts \
  tests/unit/worker/worker-flagship-http.test.ts \
  tests/unit/application/invalidation-evaluations.test.ts
```

Expected RED: managed invalidation decorator and typed attempt result are
absent.

- [ ] Construct the evaluator decorator only after current authorization.
      Return a typed Worker attempt result; map only managed usage denial to
      429. Preserve 202 pending for every other evaluation failure.
- [ ] Re-run the exact Vitest command. Expected GREEN.
- [ ] Run `npm run lint && npm run typecheck`.
- [ ] Request spec review, then quality review; resolve all findings.
- [ ] Commit: `feat: meter judge invalidation evaluation`

## Task 10 — Live Worker wiring and provider-free D1 proof

**Files:**

- Modify: `apps/worker/src/index.ts`
- Generate: `apps/worker/src/worker-configuration.d.ts`
- Modify: `tests/cloudflare/worker-flagship-http.test.ts`
- Modify: `tests/contract/cloudflare-config.test.ts`
- Modify: `tests/contract/cloudflare-deploy-config.test.ts`

- [ ] Add RED Cloudflare cases with injected concrete fakes for all three
      operations: shared USD ledger, exact replay, concurrent suppression,
      changed fingerprint, actual/full settlement, exhausted
      cost/token/generation, ordinary isolation, manual/deterministic zero
      ledger, and content-free rows.
- [ ] Add RED gate/config cases requiring exact gate, allowlisted judge, judge
      Secret, distinct HMAC Secret, canonical IP, and disabled provider mode in
      base and every rendered environment.
- [ ] Run:

```bash
CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false npx vitest run \
  --config vitest.cloudflare.config.ts \
  tests/cloudflare/worker-flagship-http.test.ts
npm run contract -- --run \
  tests/contract/cloudflare-config.test.ts \
  tests/contract/cloudflare-deploy-config.test.ts
```

Expected RED: Decision/invalidation live dependencies are not wired.

- [ ] Construct operation-specific concrete adapters only in the configured
      request-scoped runtime. Default deployed code contains no fake.
- [ ] Run `npm run cloudflare:types` to generate bindings; do not hand-edit the
      generated file.
- [ ] Re-run the exact Cloudflare/contract commands. Expected GREEN.
- [ ] Run:
      `npm run cloudflare:types:check && npm run cloudflare:config:check &&
      npm run lint && npm run typecheck`.
- [ ] Request spec review, then quality review; resolve all findings.
- [ ] Commit: `feat: gate all judge structured AI work`

## Task 11 — Browser behavior at the correct runtimes

**Files:**

- Create: `tests/e2e/judge-structured-ai.spec.ts`
- Create: `tests/e2e-cloudflare/judge-structured-ai.spec.ts`

- [ ] Add a Node browser UI-contract test using route interception for
      invalidation 429 and 202 pending. Assert the error/pending state does not
      clear durable meeting text or manual controls.
- [ ] Add a Worker browser test against real Wrangler with managed provider
      disabled. Assert login, original external receipt/pending state, and
      manual/text continuation. It must not inject a provider fake or key.
- [ ] Run the focused Node spec:

```bash
npx playwright test tests/e2e/judge-structured-ai.spec.ts --project=chromium
```

Expected RED before assertions/handling are added, then GREEN.

- [ ] Run:

```bash
npx playwright test \
  --config playwright.cloudflare.config.ts \
  tests/e2e-cloudflare/judge-structured-ai.spec.ts
```

Expected GREEN against `0.0.0.0` Wrangler. Cloudflare integration from Task 10,
not browser interception, remains the D1 429/ledger proof.

- [ ] If no UI file changes, retain no regenerated screenshots/clips. If a UI
      file changes, add E2E capture and synthetic screenshots per `AGENTS.md`.
- [ ] Commit: `test: cover bounded judge AI degradation`

## Task 12 — Full verification and canonical closeout

**Files:**

- Modify: `docs/plans/05-cloudflare-judge-mode-and-security.md`
- Modify: `docs/plans/impl/_status.md`
- Modify: this plan

- [ ] Run:

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run contract
npm run test:cloudflare
npm run build
npm run test:architecture
npm run security:secrets
npm run env:check
npm run cloudflare:types:check
npm run cloudflare:config:check
npm run cloudflare:e2e
npm run e2e
```

Expected: every command exits zero. Record exact file/test counts.

- [ ] Request final whole-range spec review, then quality review. Resolve every
      Critical/Important finding and rerun affected commands.
- [ ] Update Plan 05 and `_status.md`. Close only local claim/reservation/check/
      fail-closed rows. Keep measured production limits, approved provider
      lifecycle, remote Secret, hosted C5 rerun, deployment, repository
      visibility, and reel work open.
- [ ] Mark only proven plan checkboxes complete.
- [ ] Run `git diff --check` and verify the worktree contains only reviewed
      files.
- [ ] Commit: `docs: close durable judge structured AI billing`
