# 2026-07-22 production runtime incidents

Status: Realtime remediation under verification  
Scope: canonical Production Worker and the seeded Flagship meeting  
Public data policy: this record contains no credentials, bearer tokens, SDP,
private meeting content, provider call IDs, or raw fingerprints.

## Summary

Three independent production defects affected Realtime:

1. projection polling repeatedly exceeded the Cloudflare Worker CPU limit and
   temporarily made login return 503;
2. a failed managed Realtime start was automatically retried with its original
   idempotency key, but the Worker retained the failed start claim and returned
   409 `CONFLICT` instead of retrying the provider operation;
3. the Cloudflare Worker did not expose the ordinary-user BYOK lease routes,
   and the managed path collapsed distinct provider failure stages into a
   generic 503, making UI recovery and root-cause diagnosis unreliable.

The React application did not execute on the Worker or directly consume its
CPU budget. It scheduled projection reads in the browser. Each read invoked an
unbounded server-side event replay, so the polling frequency amplified the
Worker defect.

## Incident 1 — projection replay exceeded Worker CPU

### Evidence

- Production tail showed one projection request per second followed by
  `Exceeded CPU Limit`; login then surfaced 503.
- D1 contained 486 historical meeting events. The latest demo reset was at
  position 486, so the active projection contained no later events, but every
  request still loaded and replayed the entire history.
- Production smoke and reset runs had accumulated history without reducing the
  cost of the next replay.

### Root cause

The role-projection path rebuilt state from all meeting events, including every
event before the latest completed demo reset. Browser polling made this
unbounded server-side work recur every second. React was only the request
scheduler; the CPU-heavy operation was TypeScript event replay in the Worker.

### Remediation

Commit `ac2c88e` selects only events after the latest completed reset and
rebases their positions into the contiguous one-based sequence expected by the
domain replay. After deployment, production tail changed from repeated CPU
errors to `Ok` for projection, login, and the provider-free smoke path.

### Prevention

- Keep reset-aware replay covered at the production query boundary, including
  position continuity.
- Treat polling rate and per-request replay size as separate budgets.
- Do not use provider-free reset smoke as an unlimited production history
  generator without checking replay cost.

## Incident 2 — Realtime failure was masked by a 409 retry conflict

### Evidence

- On each affected Connect action, the first request created a start claim, a
  usage reservation, and a managed-call ownership row. The call was then
  terminated and its reservation released in the same second.
- The browser retried about two seconds later with the same idempotency key.
  The retained claim converted that retry to 409
  `MANAGED_REALTIME_START_ALREADY_CLAIMED`.
- Recent production D1 rows were terminal and released, not active or charged.
  The visible 409 was therefore a secondary failure after a retryable provider
  start failure, not a concurrency limit or the USD 25 cap.
- A local live smoke using a real browser-generated media-only SDP, the local
  standard API key, and `gpt-realtime-2.1` succeeded. The canonical Production
  Worker contains an `OPENAI_API_KEY_JUDGE` secret name, but Cloudflare secrets
  are write-only and their value cannot be compared with the locally verified
  key.

### Root cause

The client and server implemented contradictory retry contracts:

- the browser deliberately reused one start key after a retryable connection
  failure to avoid duplicate provider work;
- the Worker retained the start claim after it had terminated the ownership and
  released the reservation;
- the Worker treated the matching retry as a conflict rather than a safe retry.

This hid the original provider failure behind a permanent-looking 409. The
remaining provider-start difference is production-only configuration or
runtime: the same adapter, model, and browser SDP succeed locally. The
production secret value must therefore be overwritten from the locally
verified key instead of inferred from the presence of its secret name.

### Remediation design

- Release a start claim only after the failed operation's ownership is no
  longer active. Match the claim key, request fingerprint, managed call ID, and
  creation time so cleanup cannot delete another attempt's claim.
- Preserve claims for successful or ambiguously active calls. Those replays
  must remain conflicts to prevent duplicate provider work and billing.
- Allow the same idempotency key to claim a new attempt after confirmed cleanup.
- Synchronize canonical Production `OPENAI_API_KEY_JUDGE` from the exact local
  key that passed the live Realtime smoke immediately before deployment.

### Why existing tests missed it

The browser-controller unit test expected retry keys to be reused, while the
Worker test separately expected a matching retained claim to return 409. The
tests proved both halves independently but never composed the failure-cleanup-
retry sequence through real D1 and a real Durable Object. Provider mocks also
defaulted to successful starts, so they did not exercise this contradiction.

## Mandatory verification before the next production deployment

1. RED/GREEN Cloudflare regression: provider start fails, ownership and
   reservation terminate, failed claim disappears, and the same key reaches a
   second provider attempt instead of 409.
2. Existing successful-start replay remains deduplicated and does not reserve
   or bill twice.
3. Managed Realtime unit tests, full Cloudflare pool, browser Realtime E2E,
   typecheck, lint, build, and security verification pass locally.
4. Live local media-only Realtime smoke succeeds with the key that will be
   written to the production secret.
5. Only then: write the secret, deploy once, and verify in a clean judge browser
   that Connect reaches `Connected`, Disconnect terminates, and a second Connect
   also reaches `Connected` without 409.

Until step 5 is observed, hosted judge Realtime remains unverified even if all
local gates are green. Manual text and durable meeting state remain the safe
fallback.

## Deployment follow-up — judge routes silently disabled

The first deployment of `ff46f37` preserved the two Worker secret names but was
rendered without `CLOUDFLARE_ENABLE_JUDGE_MODE=production` and
`CLOUDFLARE_JUDGE_USER_ID=judge`. Inspection of the 100%-served version showed
both judge routes set to `disabled` and no `JUDGE_USER_ID` binding. The browser
therefore reported `API key required` even though `OPENAI_API_KEY_JUDGE` still
existed. Secret presence was incorrectly treated as sufficient verification.

The production approval guard now rejects this configuration before any remote
phase. `AGENTS.md` also requires inspection of the rendered config and the
active version bindings after every production deploy. A secret-name listing
alone is no longer an acceptable agent-availability check.

## Incident 3 — Worker route parity and failure-stage loss

### Evidence

- The Node server exposed meeting-scoped BYOK configure, heartbeat, and clear,
  while the production Worker did not route those URLs. An ordinary user could
  submit a key in the UI but subsequent access checks still returned
  `API key required`; unmatched API requests could also be mislabeled as
  artifact-storage failures.
- The judge managed-call boundary reduced rejected provider requests, invalid
  response metadata, invalid SDP, and transport failures to the same generic 503. The browser therefore could not distinguish a credential/account
  rejection from a transient provider transport failure without exposing raw
  provider text.
- The current multipart WebRTC request shape and `gpt-realtime-2.1` succeeded
  against the real provider from Node with the local key. The equivalent local
  workerd smoke reached the judge route but returned the allowlisted
  `PROVIDER_UNAVAILABLE` before any provider status existed. This PC requires an
  outbound proxy; Wrangler applies that proxy to its own Cloudflare API client,
  but it does not establish that the child workerd runtime can proxy Worker
  `fetch()` traffic.

`CLOUDFLARE_DEPLOY_URL` is not part of Realtime credential resolution. It is an
operator input for guarded deployment and remote smoke targeting, so an empty
value can block deployment but cannot make an already running Worker forget a
provider key.

### Root cause

The two runtime implementations had drifted. Shared application use cases for
BYOK existed, but the Worker entrypoint still used an unavailable lease store
and had no public BYOK handlers. Separately, the managed-call adapter did not
carry a closed, allowlisted failure classification through its Durable Object
and public HTTP boundaries. Deployment checks emphasized secret presence and
route flags instead of composing the browser, Worker, Durable Object, and
provider path.

### Remediation

- Store ordinary BYOK only as a short-lived, meeting-bound in-memory lease in
  `MeetingCoordinator`; expose configure, heartbeat, and clear through the
  Worker and remove the lease on logout/session revocation.
- Return `ROUTE_NOT_FOUND` for unmatched APIs so only real artifact operations
  can report artifact-storage unavailability.
- Carry only the closed safe reasons `OFFER_REJECTED`, `PROVIDER_REJECTED`,
  `PROVIDER_LOCATION_INVALID`, `PROVIDER_SDP_INVALID`, and
  `PROVIDER_UNAVAILABLE`, plus an integer provider status when one exists.
  Never retain or return provider bodies, headers, SDP, call IDs, or keys.
- Give each safe reason an actionable browser recovery message while preserving
  manual private/shared text and retrying from a clean failed state.
- Add browser coverage for safe failure then retry, and a real local Wrangler
  test for ordinary BYOK connecting both agents. Add a secret-safe live workerd
  smoke that attempts two private/shared cycles and prints only allowlisted
  diagnostics.

### Release gate

The real Node media-only smoke proves the provider key and request shape, but
not Worker composition. On this proxied development machine the local workerd
provider attempt is expected to remain a diagnostic `PROVIDER_UNAVAILABLE`.
Production completion therefore requires one guarded deployment followed by a
clean-browser judge-managed private/shared Connect/Disconnect/reconnect check
and an ordinary-user BYOK configure/private/shared/clear check on the 100%-served
version. Until those hosted observations pass, this incident remains under
verification and manual text remains the supported fallback.
