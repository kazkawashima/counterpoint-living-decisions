# Judge private-disclosure implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` to implement this plan
> task-by-task. Each production change follows RED → GREEN → REFACTOR.

**Goal:** Route judge-funded `ai_preferred` private-disclosure proposals
through one atomic idempotency claim and the shared rolling-24-hour USD 25
usage ledger before any OpenAI request, without changing manual or ordinary
user behavior.

**Architecture:** The public disclosure contract remains unchanged. A
Worker-only request-scoped orchestrator decorates the existing
`DisclosureCandidateProposer` after fresh session/meeting/judge
authorization. It claims a content-free operation key, reserves a conservative
operation envelope, invokes the existing application use case, and settles
actual metered usage when trustworthy or the full reservation after an
uncertain provider outcome. Existing event replay remains the canonical
product-result replay.

**Tech stack:** TypeScript, Hono-compatible Worker HTTP, Cloudflare D1, R2,
OpenAI Responses structured outputs, Zod, Vitest, Miniflare, Playwright.

---

## Fixed design decisions

- A separate ordinary Worker var,
  `JUDGE_STRUCTURED_AI_ROUTE_ENABLED=disabled`, is the default. Live structured
  work requires the exact value `enabled`, an allowlisted `JUDGE_USER_ID`, the
  `OPENAI_API_KEY_JUDGE` Secret, and the independent
  `JUDGE_IP_HMAC_SECRET`.
- The browser never sends account, IP, participant, session, provider,
  reservation, key-source, pricing, or claim identity.
- `manual` always strips every proposer and never claims or reserves.
- `ai_preferred` with no deterministic test proposer and no fully configured
  judge route returns redacted `OPENAI_UNAVAILABLE`; it must not reinterpret
  caller placeholder text as an AI result.
- The generic usage ledger remains product-wide. All limiter factories use the
  same global account/IP/meeting/concurrency/cost/generation/token/Realtime
  limits; operation, model, pricing version, TTL, and reservation envelope vary
  per billable path.
- The first private-disclosure envelope allows at most two Responses attempts,
  540,000 estimated input tokens, 1,400 estimated output tokens, two
  generations, zero Realtime seconds, and USD 5.50. The amount is deliberately
  conservative for the existing 64 KiB judge source cap plus prompt/schema
  overhead and the highest current GPT-5.6 Sol standard token rates, including
  headroom for cache-write or long-context pricing. This is a pre-production
  safety bound, not a claim of measured flagship usage.
- A judge source longer than 64 KiB fails before claim/reservation/provider
  work and retains the manual path.
- Provider-returned token usage is accumulated across retries. Successful,
  trustworthy usage settles calculated token cost; missing/malformed usage or
  any provider-started failure settles the full reserved envelope.
- Claims contain only lowercase SHA-256 hashes, operation/model/version
  metadata, opaque scope identifiers, and timestamps. They never contain
  source text, snippets, prompts, model output, credentials, or provider IDs.
- An exact repeated claim runs the use case with a replay-only proposer:
  persisted product results replay, while a missing result fails closed
  without another provider request. A changed request fingerprint returns
  `IDEMPOTENCY_CONFLICT`.

## Task 1 — Generic managed-AI operation claims

**Files:**

- Create:
  `apps/worker/migrations/0010_judge_managed_ai_operation_claims.sql`
- Create:
  `packages/adapters-cloudflare/src/d1-managed-ai-operation-claims.ts`
- Modify: `packages/adapters-cloudflare/src/index.ts`
- Modify: `apps/worker/src/index.ts`
- Test: `tests/cloudflare/d1-managed-ai-operation-claims.test.ts`
- Test: `tests/contract/cloudflare-d1-migrations.test.ts`

- [x] Write a failing Cloudflare test for a content-free claim repository with
      `claimed`, exact `replayed`, changed-fingerprint `conflict`, atomic
      concurrent winner, scoped release before provider work, and expiry reuse.
- [x] Run:
      `npx vitest run --config vitest.cloudflare.config.ts tests/cloudflare/d1-managed-ai-operation-claims.test.ts`
      and verify the repository/import is missing.
- [x] Add strict migration `0010` and a
      `D1ManagedAiOperationClaimRepository` whose `claim()` is one conditional
      D1 insert and whose `release()` deletes only an exact
      claim-key/request-fingerprint/generation tuple.
- [x] Add migration-order/schema assertions and append `0010` to
      `EXPECTED_D1_MIGRATIONS`.
- [x] Re-run the targeted Cloudflare and contract migration tests to GREEN.

## Task 2 — Metered private-disclosure adapter and pricing

**Files:**

- Modify:
  `packages/adapters-openai/src/private-disclosure.ts`
- Modify: `packages/adapters-openai/src/index.ts`
- Create: `apps/worker/src/judge-structured-ai.ts`
- Test:
  `tests/unit/adapters-openai/private-disclosure.test.ts`
- Test: `tests/unit/worker/judge-structured-ai.test.ts`

- [x] Write a failing adapter test proving a successful proposal returns
      accumulated input/output usage and attempt count without adding usage to
      the public disclosure DTO or domain event.
- [x] Run the adapter test and verify the metering result is absent.
- [x] Extend the concrete adapter-only `PrivateDisclosureProposal` with a
      content-free billing record. Do not widen
      `DisclosureCandidateProposer` or public protocol schemas.
- [x] Write failing pricing/envelope tests for supported GPT-5.6 model IDs,
      safe integer micro-USD rounding, reserved upper bounds, source length,
      and actual usage never exceeding the reservation.
- [x] Add shared global judge limits, the private-disclosure reserved envelope,
      pricing-version constants, and actual-usage calculation in
      `judge-structured-ai.ts`.
- [x] Re-run both targeted test files to GREEN.

## Task 3 — Request-scoped judge disclosure orchestration

**Files:**

- Create:
  `apps/worker/src/judge-private-disclosure.ts`
- Modify:
  `apps/worker/src/worker-flagship-http.ts`
- Test:
  `tests/unit/worker/judge-private-disclosure.test.ts`
- Test:
  `tests/unit/worker/worker-flagship-http.test.ts` if a focused Worker HTTP
  test file is needed; otherwise use the new orchestrator test.

- [x] Write failing tests proving:
      claim → reserve → proposer → finalize order; 429 before proposer on
      denial; exact replay invokes only a replay-only proposer; changed
      fingerprint conflicts; pre-provider failure releases claim/reservation;
      provider-started failure finalizes the full envelope; and claim/ledger
      inputs contain no private text.
- [x] Run the new unit test and verify the orchestrator is missing.
- [x] Implement a request-scoped proposer decorator. It receives only
      server-resolved user/session/participant/meeting/IP scope, the parsed
      request, claim repository, usage limiter, and concrete metered proposer.
- [x] Integrate it into the Worker `propose-disclosure` branch after fresh
      meeting authorization. Catch provider errors and return
      `OPENAI_UNAVAILABLE`; return `USAGE_LIMIT_REACHED` with only the exhausted
      dimension.
- [x] Make disabled/unconfigured `ai_preferred` fail closed instead of using
      caller manual fields while reporting `ai_assisted`.
- [x] Re-run targeted unit/application tests to GREEN.

## Task 4 — Worker feature gate and provider-free integration proof

**Files:**

- Modify: `apps/worker/src/index.ts`
- Modify: `apps/worker/src/worker-flagship-http.ts`
- Modify: `wrangler.jsonc`
- Modify: `scripts/render-cloudflare-deploy-config.mjs`
- Modify: `scripts/check-cloudflare-config.mjs`
- Modify: `apps/worker/src/worker-configuration.d.ts` through the checked
  Wrangler type command
- Test: `tests/cloudflare/worker-flagship-http.test.ts`
- Test: `tests/contract/cloudflare-config.test.ts`
- Test: `tests/contract/cloudflare-deploy-config.test.ts`

- [x] Write failing Worker integration cases using an injected metered fake:
      judge success and ledger settlement; concurrent duplicate suppression;
      changed payload conflict; exhausted limit with zero proposer calls;
      ordinary-user denial; manual zero-ledger behavior; disabled/unconfigured
      fail-closed behavior; and no private content in claim/usage rows.
- [x] Run the focused Cloudflare test and verify the live judge dependency is
      not wired.
- [x] Add the disabled-by-default ordinary gate and construct live dependencies
      only when the gate, allowlist, key Secret, IP HMAC Secret, and canonical
      `CF-Connecting-IP` are all valid.
- [x] Keep local `OPENAI_MODE=deterministic` behavior available for
      provider-free flagship testing, but never treat it as metered production
      evidence.
- [x] Render preview/production deployment configs with both judge route gates
      disabled. Extend config tests so judge Secrets can never become ordinary
      vars.
- [x] Run Wrangler type generation/check and focused Cloudflare/config tests to
      GREEN. Do not register a remote Secret or enable a route.

## Task 5 — Verification and canonical status

**Files:**

- Modify: `docs/plans/05-cloudflare-judge-mode-and-security.md`
- Modify: `docs/plans/impl/_status.md`

- [x] Run targeted tests, then:
      `npm run format:check`, `npm run lint`, `npm run typecheck`,
      `npm test`, `npm run contract`, `npm run test:cloudflare`,
      `npm run build`, `npm run test:architecture`,
      `npm run security:secrets`, `npm run env:check`, and
      `npm run cloudflare:config:check`.
- [x] Run the Worker browser E2E because Worker wiring changed. UI files do not
      change in this slice, so no new screenshot is required.
- [x] Record what is proven and keep these gates open: measured production
      limits, shared-decision/invalidation judge billing, successful approved
      provider lifecycle, hosted security rerun, remote deployment, and route
      enablement.
- [x] Request independent spec-compliance review, then code-quality review.
      Resolve every Critical/Important finding and re-run affected tests.
- [x] Commit only the reviewed, verified files.

## Completion record

Tasks 1–5 are complete for the local, provider-free implementation boundary.
The route remains disabled in base, preview, and production configuration. No
remote Secret was registered, no provider request was made, and no deployment
or repository-visibility mutation occurred. The open gates listed in Task 5
remain deployment or later billable-path work rather than incomplete work in
this slice.
