# Production Realtime Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make judge server-funded Realtime and ordinary meeting-scoped BYOK Connect reliable on the production-equivalent Cloudflare Worker.

**Architecture:** Keep ordinary BYOK only in the existing meeting-keyed `MeetingCoordinator` Durable Object's memory and expose it through `MeetingApiKeyLeaseStore`. Keep the judge managed-call, sideband, ownership, and USD 25 cost-control path, but carry a small allowlisted provider failure reason across the adapter and Durable Object boundary so the exact workerd failure can be fixed before one production deployment.

**Tech Stack:** TypeScript 6, React 19, Cloudflare Workers/Durable Objects/D1/R2, Vitest Cloudflare pool, Playwright, OpenAI Realtime WebRTC.

---

### Task 1: Preserve the safe judge failure stage

**Files:**
- Modify: `packages/adapters-openai/src/realtime-calls.ts`
- Modify: `apps/worker/src/judge-realtime-call-controller.ts`
- Modify: `apps/worker/src/judge-managed-realtime-http.ts`
- Test: `tests/unit/adapters-openai/realtime-calls.test.ts`
- Test: `tests/cloudflare/judge-realtime-call-controller.test.ts`
- Test: `tests/unit/worker/judge-managed-realtime-http.test.ts`

- [ ] **Step 1: Write adapter RED tests**

Add table-driven tests for rejected offers, provider 401/400/429/503, invalid
`Location`, invalid SDP, and fetch rejection. Assert only safe fields survive:

```ts
expect(caught).toMatchObject({
  name: "OpenAiRealtimeCallError",
  reason: "PROVIDER_REJECTED",
  providerStatus: 401,
});
expect(JSON.stringify(caught)).not.toContain(apiKey);
```

- [ ] **Step 2: Verify RED**

Run `npx vitest run tests/unit/adapters-openai/realtime-calls.test.ts`.
Expected: FAIL because `reason` and `providerStatus` do not exist.

- [ ] **Step 3: Implement the closed error contract**

```ts
export type OpenAiManagedRealtimeFailureReason =
  | "OFFER_REJECTED"
  | "PROVIDER_REJECTED"
  | "PROVIDER_LOCATION_INVALID"
  | "PROVIDER_SDP_INVALID"
  | "PROVIDER_UNAVAILABLE";

export class OpenAiRealtimeCallError extends Error {
  constructor(
    readonly reason: OpenAiManagedRealtimeFailureReason,
    readonly providerStatus?: number,
  ) {
    super("OpenAI managed Realtime call failed");
    this.name = "OpenAiRealtimeCallError";
  }
}
```

Assign a reason at every throw site. Never retain provider bodies, headers,
SDP, IDs, keys, or arbitrary caught messages.

- [ ] **Step 4: Write and verify controller RED/GREEN**

First require an unaccepted error to return
`{kind:"unavailable", reason:"PROVIDER_REJECTED", providerStatus:401}` and
release usage. Run:

`npx vitest run tests/cloudflare/judge-realtime-call-controller.test.ts tests/unit/worker/judge-managed-realtime-http.test.ts`

Then carry only the allowlisted fields through the internal response and the
public redacted `REALTIME_UNAVAILABLE` details. Unknown errors map to
`PROVIDER_UNAVAILABLE`; accepted-call failures retain conservative settlement.

- [ ] **Step 5: Verify and commit Task 1**

Run all three targeted files, then commit:

```bash
git add packages/adapters-openai/src/realtime-calls.ts apps/worker/src/judge-realtime-call-controller.ts apps/worker/src/judge-managed-realtime-http.ts tests/unit/adapters-openai/realtime-calls.test.ts tests/cloudflare/judge-realtime-call-controller.test.ts tests/unit/worker/judge-managed-realtime-http.test.ts
git commit -m "fix: preserve safe realtime failure stages"
```

### Task 2: Add the meeting Durable Object BYOK lease

**Files:**
- Create: `apps/worker/src/meeting-api-key-leases.ts`
- Modify: `apps/worker/src/meeting-coordinator.ts`
- Modify: `tests/contract/meeting-coordinator-contract.ts`
- Test: `tests/cloudflare/meeting-coordinator.test.ts`
- Test: `tests/unit/worker/meeting-api-key-leases.test.ts`

- [ ] **Step 1: Write coordinator RED contract cases**

Cover configure replay, owner mismatch, find, heartbeat, clear, five-minute
expiry, wrong meeting, and session revocation. Internal synthetic example:

```ts
await expect(request("/byok/configure", lease)).resolves.toMatchObject({
  body: { kind: "configured" }, status: 201,
});
await expect(request("/byok/find", { meetingId: lease.meetingId }))
  .resolves.toMatchObject({ body: { kind: "found", lease }, status: 200 });
```

- [ ] **Step 2: Verify RED**

Run `npx vitest run tests/cloudflare/meeting-coordinator.test.ts`.
Expected: FAIL with 404 for `/byok/*`.

- [ ] **Step 3: Implement coordinator lease operations**

Add one private `MeetingApiKeyLease` and timer. Strict parsers accept only the
port fields. Configure binds the object to the meeting; heartbeat renews only
the exact owner; find lazily expires; clear and `/sessions/revoke` remove an
owned session lease. Never persist the lease through Durable Object storage.

- [ ] **Step 4: Write adapter RED tests and implementation**

Test a bound adapter against a fake coordinator and require `configured`,
`owner_mismatch`, `applied`, and `missing`. Implement:

```ts
export class MeetingCoordinatorApiKeyLeaseStore
  implements MeetingApiKeyLeaseStore {
  constructor(
    private readonly meetingId: string,
    private readonly coordinator: DurableObjectStub<MeetingCoordinator>,
  ) {}
}
```

Each method calls a fixed internal URL, rejects cross-meeting input, validates
the response, and never logs bodies.

- [ ] **Step 5: Verify and commit Task 2**

```bash
npx vitest run tests/cloudflare/meeting-coordinator.test.ts tests/unit/worker/meeting-api-key-leases.test.ts
git add apps/worker/src/meeting-coordinator.ts apps/worker/src/meeting-api-key-leases.ts tests/contract/meeting-coordinator-contract.ts tests/cloudflare/meeting-coordinator.test.ts tests/unit/worker/meeting-api-key-leases.test.ts
git commit -m "feat: add worker meeting byok lease"
```

### Task 3: Wire Worker BYOK parity and truthful API fallback

**Files:**
- Create: `apps/worker/src/meeting-byok-http.ts`
- Modify: `apps/worker/src/index.ts`
- Modify: `apps/worker/src/worker-flagship-http.ts`
- Modify: `packages/protocol/src/errors.ts`
- Modify: `packages/http-api/src/common.ts`
- Modify: `apps/server/src/app.ts`
- Test: `tests/unit/worker/meeting-byok-http.test.ts`
- Test: `tests/cloudflare/worker-managed-realtime-http.test.ts`
- Test: `tests/contract/protocol-errors.test.ts`

- [ ] **Step 1: Write public HTTP RED tests**

Prove this sequence for an ordinary facilitator:

```text
GET access -> unavailable
PUT byok -> 201 configured
GET access -> facilitatorProvided
POST client-secrets -> 201 facilitatorProvided
POST byok/heartbeat -> 200 active
DELETE byok -> 200 cleared
GET access -> unavailable
```

Also require participant/judge configure denial, owner replacement denial, and
absence of the standard-key canary in every response.

- [ ] **Step 2: Verify RED**

Run the two Worker test files. Expected: BYOK calls reach the false artifact
fallback or access remains unavailable.

- [ ] **Step 3: Implement public BYOK routing**

`meeting-byok-http.ts` parses existing schemas, authenticates the Bearer token,
resolves fresh meeting authorization, invokes the three existing application
use cases, and returns existing response schemas. In `index.ts`, match the
three BYOK URLs first and inject one bound
`MeetingCoordinatorApiKeyLeaseStore` into BYOK, access, and client-secret
handlers. Delete `unavailableLeases`.

- [ ] **Step 4: Clear leases on logout**

Add an optional authenticated logout callback receiving `sessionId` and
`userId`. The Worker lists the user's active D1 meetings and calls each
coordinator `/sessions/revoke` after durable session revocation.

- [ ] **Step 5: Add truthful route-not-found behavior**

Add `ROUTE_NOT_FOUND` as a non-retryable 404 to the protocol registry and
exhaustive status maps. Use it for unmatched `/api/*`; only actual artifact
operations may emit `ARTIFACT_STORAGE_UNAVAILABLE`.

- [ ] **Step 6: Verify and commit Task 3**

```bash
npx vitest run tests/unit/worker/meeting-byok-http.test.ts tests/cloudflare/worker-managed-realtime-http.test.ts tests/contract/protocol-errors.test.ts
npm run typecheck
git add apps/worker/src/meeting-byok-http.ts apps/worker/src/index.ts apps/worker/src/worker-flagship-http.ts packages/protocol/src/errors.ts packages/http-api/src/common.ts apps/server/src/app.ts tests/unit/worker/meeting-byok-http.test.ts tests/cloudflare/worker-managed-realtime-http.test.ts tests/contract/protocol-errors.test.ts
git commit -m "fix: complete worker byok route parity"
```

### Task 4: Prove every visible Connect state

**Files:**
- Modify: `apps/web/src/realtime-panel.tsx`
- Modify: `tests/e2e/realtime-channels.spec.ts`
- Modify: `tests/e2e-cloudflare/flagship.spec.ts`
- Create: `docs/media/screenshots/realtime-recovery/2026-07-22-connect-recovery-notes.md`

- [ ] **Step 1: Write browser RED cases**

Cover judge/no-key, judge/optional-BYOK, ordinary/no-key, ordinary/valid-key,
ordinary/invalid-key, both Connect buttons, Disconnect, failed start then
retry, cleared lease, participant view, and manual private/shared text. Assert
that every failure names access, call creation, peer negotiation, or microphone.

- [ ] **Step 2: Verify RED**

```bash
npx playwright test tests/e2e/realtime-channels.spec.ts
npx playwright test --config playwright.cloudflare.config.ts tests/e2e-cloudflare/flagship.spec.ts
```

- [ ] **Step 3: Implement safe recovery copy**

Map only allowlisted details, for example:

```ts
PROVIDER_REJECTED: "Realtime provider rejected the call. Check the configured key or provider account, then retry.",
OFFER_REJECTED: "This browser produced an unsupported audio offer. Text remains available.",
```

Unknown details retain the generic redacted message.

- [ ] **Step 4: Verify, capture, and commit**

Run both E2E commands and the targeted capture with `CAPTURE_EVIDENCE=1`.
Record synthetic identity, viewport, state, and commit; never show a real key.
Commit UI, tests, notes, and generated synthetic captures as
`test: cover production realtime recovery paths`.

### Task 5: Identify and fix the judge root under local workerd

**Files:**
- Create: `scripts/cloudflare-realtime-live-smoke.mjs`
- Modify: `package.json`
- Modify only the adapter/controller file identified by Task 1 diagnostics
- Test the matching Task 1 file

- [ ] **Step 1: Add a secret-safe live smoke**

Require `OPENAI_API_KEY`, generate a mode-0600 temporary Wrangler env file
outside the repository, allowlist local `product` as judge, enable managed
Realtime, generate a separate HMAC secret, start Wrangler on `0.0.0.0`, and
drive Chromium through private and shared
`Connect -> Connected -> Disconnect`. Delete the file in `finally` and print
only channel, model, safe reason, provider status, and pass/fail.

Add package script:

```json
"smoke:cloudflare:realtime-live": "node --env-file-if-exists=.env scripts/cloudflare-realtime-live-smoke.mjs"
```

- [ ] **Step 2: Run diagnostics before changing provider behavior**

```bash
npm run cloudflare:d1:migrate:local
npm run bundle --workspace @counterpoint/web
npm run smoke:cloudflare:realtime-live
```

Expected: PASS or exactly one safe reason. Arbitrary text, absent reason, secret
output, or competing reasons fails this gate.

- [ ] **Step 3: TDD the one observed root**

Write one RED regression using the official shape observed in Step 2. Apply
only the design decision for that reason; do not widen URL, identifier, SDP, or
credential validation. Run the matching tests until GREEN.

- [ ] **Step 4: Require two live passes and commit**

Run `npm run smoke:cloudflare:realtime-live` twice. Both channels must connect
and disconnect twice with no retained reservation or secret output. Commit the
script, package command, regression, and confirmed fix as
`fix: restore worker managed realtime connection`.

### Task 6: Full verification and one production deployment

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/incidents/2026-07-22-production-runtime-incidents.md`
- Modify: `docs/deployments/production-2026-07-21.md`
- Modify: `goal.txt`

- [ ] **Step 1: Record the prevention invariant**

Require ordinary-BYOK Worker parity and local workerd real-provider smoke before
production Connect releases. Secret-name listing and Node-only adapter smoke
are explicitly insufficient.

- [ ] **Step 2: Run complete verification**

```bash
npm run format:check
npm run typecheck
npm run lint
npm run build
npm test
npm run test:cloudflare
npm run security:verify
npm run cloudflare:e2e
npm run security:secrets
git diff --check
```

Expected: all pass from the exact commit. Do not waive deterministic failures.

- [ ] **Step 3: Commit documentation, push, and deploy once**

Commit the four documentation files as `docs: record realtime production
recovery`, push `HEAD:main`, load ignored production inputs including the
canonical URL and judge-mode flags, and run
`npm run cloudflare:deploy:production` once.

- [ ] **Step 4: Audit and smoke the 100%-served version**

Verify judge flags, exact `JUDGE_USER_ID`, both secret names, D1/R2, and both DO
bindings. Then prove judge/no-key private+shared Connect, ordinary/no-key
prompt, ordinary/valid-BYOK private+shared Connect, clear-to-required, and
manual text/state continuity.

- [ ] **Step 5: Update completion evidence**

Record commit, Worker version, config hash, test totals, safe smoke result, and
hosted observations without credentials. Mark only Connect complete; preserve
hosted C5, human rehearsal, public switch, tag, and submission as separate
gates.
