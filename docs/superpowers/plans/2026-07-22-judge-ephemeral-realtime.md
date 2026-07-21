# Judge Ephemeral Realtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make an allowlisted production judge connect both Realtime channels without entering a personal API key by using a server-funded short-lived client secret.

**Architecture:** Keep the standard judge key only in the Worker Secret, use it at the existing authorized client-secret endpoint, and return only OpenAI's short-lived channel-scoped credential. Route both server-funded judge and judge BYOK sessions through the browser WebRTC connector that already works; keep the sideband managed-call code dormant and hide its now-inapplicable usage meter.

**Tech Stack:** TypeScript, React 19, Cloudflare Workers/D1/Durable Objects, Vitest, Playwright, OpenAI Realtime WebRTC.

---

### Task 1: Prove the Worker issues server-funded judge credentials

**Files:**

- Modify: `tests/cloudflare/worker-realtime-client-secrets.test.ts`
- Modify: `apps/worker/src/index.ts`

- [x] **Step 1: Replace the old fail-closed assertion with a server-funded issuance assertion**

Configure a provider-fetch stub for `OpenAiManagedRealtimeClientSecretIssuer`, call `POST /realtime/client-secrets` as the allowlisted judge without `apiKey`, and assert `201`, `keySource: "judgeManaged"`, a short-lived secret, private-channel instructions, and no standard key in the response or storage.

- [x] **Step 2: Run the focused Worker test and verify RED**

Run: `npx vitest run --config vitest.cloudflare.config.ts tests/cloudflare/worker-realtime-client-secrets.test.ts`

Expected: FAIL because the Worker does not provide `judgeManagedIssuerFactory` and returns `503 REALTIME_UNAVAILABLE`.

- [x] **Step 3: Wire the standard-key issuer into the existing authorized endpoint**

In `apps/worker/src/index.ts`, add:

```ts
judgeManagedIssuerFactory: () =>
  nonEmptyTrimmed(env.OPENAI_API_KEY_JUDGE)
    ? new OpenAiManagedRealtimeClientSecretIssuer({
        apiKey: env.OPENAI_API_KEY_JUDGE,
      })
    : undefined,
```

Keep `judgeByokIssuerFactory` unchanged so request-scoped judge BYOK still takes precedence.

- [x] **Step 4: Hide the managed usage summary for direct judge Realtime**

Set `judgeUsageSummaryAvailable: false` in the Worker's Realtime access dependencies. Keep structured-AI accounting unchanged.

- [x] **Step 5: Run the focused Worker test and verify GREEN**

Run: `npx vitest run --config vitest.cloudflare.config.ts tests/cloudflare/worker-realtime-client-secrets.test.ts`

Expected: all tests pass and no standard key is returned or persisted.

### Task 2: Route judge Connect through the proven browser WebRTC path

**Files:**

- Modify: `tests/e2e/realtime-channels.spec.ts`
- Modify: `apps/web/src/realtime-panel.tsx`

- [x] **Step 1: Rewrite the judge browser scenario for the selected architecture**

Assert that `judgeManaged` access reports `usageSummary: "hidden"`, a no-key Connect requests `/realtime/client-secrets` without `apiKey`, directly exchanges SDP at OpenAI, never calls `/realtime/calls`, and connects/disconnects both private and shared cards. Preserve an assertion that optional judge BYOK sends only the tab-local key to the client-secret endpoint.

- [x] **Step 2: Run the focused browser test and verify RED**

Run: `npx playwright test tests/e2e/realtime-channels.spec.ts --grep "server-funded judge access"`

Expected: FAIL because the current UI calls the managed `/realtime/calls` connector.

- [x] **Step 3: Replace the judge managed-call branch with client-secret issuance**

For `access.mode === "judgeManaged"`, call:

```ts
const issued = await issueRealtimeClientSecret(
  session,
  meetingId,
  selectedChannel,
  loadStoredMeetingByok(meetingId),
);
return connectOpenAiRealtime({
  clientSecret: issued.clientSecret,
  onTranscript: (transcript) =>
    transcriptHandlers.current[selectedChannel]?.(transcript),
});
```

Remove managed-call imports from the active panel. Do not delete rollback source modules.

- [x] **Step 4: Correct the UI copy**

Describe server-funded judge access as a short-lived browser credential and remove the claim that it is a server-bounded call. Do not render the judge USD meter when `usageSummary` is hidden.

- [x] **Step 5: Run the focused browser test and verify GREEN**

Run: `npx playwright test tests/e2e/realtime-channels.spec.ts --grep "server-funded judge access"`

Expected: one passing scenario proving private/shared direct Connect and no managed-call requests.

### Task 3: Verify and release once

**Files:**

- Modify: `docs/plans/impl/_status.md`
- Modify: `docs/deployments/production-2026-07-22.md`

- [ ] **Step 1: Run relevant and full verification**

Run, in order:

```bash
npm run typecheck
npm run lint
npm run format:check
npm run build
npm run security:secrets
npm run security:matrix
npm run test:cloudflare
npx playwright test tests/e2e/realtime-channels.spec.ts --grep "server-funded judge access"
```

Expected: every command exits 0.

- [ ] **Step 2: Record the exact recovery boundary**

Update status/deployment docs to state that active judge Realtime uses ephemeral browser WebRTC, the managed sideband and exact USD hard cap are deferred, and structured AI accounting remains unchanged.

- [ ] **Step 3: Commit and push the verified implementation**

```bash
git add apps/worker/src/index.ts apps/web/src/realtime-panel.tsx tests/cloudflare/worker-realtime-client-secrets.test.ts tests/e2e/realtime-channels.spec.ts docs/
git commit -m "fix judge realtime via ephemeral client secret"
git push origin HEAD:main
```

- [ ] **Step 4: Run the guarded production deploy**

Load the existing local deployment inputs without printing secrets, render and inspect the production plan, then run `npm run cloudflare:deploy:production`. Stop if judge identity, structured AI, standard judge Secret, or canonical production Worker target is absent.

- [ ] **Step 5: Verify the served deployment**

Inspect the 100%-served Worker version and bindings, run health/auth/access probes, and have a clean judge browser complete private and shared `Connect → Connected → Disconnect` without personal BYOK before claiming hosted success.
