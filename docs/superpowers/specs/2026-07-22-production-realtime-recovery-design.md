# Production Realtime Recovery Design

Date: 2026-07-22  
Status: approved for planning  
Scope: submission-critical Connect reliability only

## Goal

Make every production Connect path truthful and usable: the allowlisted judge
connects without a browser API key, an ordinary facilitator can activate a
meeting-scoped BYOK lease and connect, and failures identify the actual
Realtime stage without exposing credentials or private meeting data.

This work preserves the canonical product requirements in
`docs/topics/14-implementation-requirements.md`: ordinary users use a
meeting-scoped, five-minute server lease; the judge uses the server-funded
Worker Secret behind the product-wide rolling USD 25 hard cap; and manual text
and durable meeting state remain available when voice fails.

## Confirmed failures and causes

### Ordinary facilitator BYOK

The web client calls `PUT /api/v1/meetings/:meetingId/byok` before retaining the
key in tab-scoped `sessionStorage`. The production Worker does not route the
BYOK configure, heartbeat, or clear endpoints and injects a hard-coded
`unavailableLeases` store into access and client-secret handlers. The request
falls through to a generic API-parity response that incorrectly reports
`ARTIFACT_STORAGE_UNAVAILABLE`. Configuration therefore never succeeds, no key
is retained, and the next access check correctly reports `API_KEY_REQUIRED`.

This is a Worker capability-parity defect, not an R2 outage.

### Judge managed Realtime

Production readiness confirms that the judge Secret binding is present and
well formed. The latest production D1 records show that failed starts are
released with zero actual cost and their call ownership is terminated in the
same second. The OpenAI acceptance callback was therefore not reached. Failure
is constrained to local offer validation, provider fetch/non-2xx response,
provider call-location validation, or an unavailable/timeout condition.

The exact branch is currently unknowable because the OpenAI adapter throws
message-only errors and the Durable Object catches them as one generic
`REALTIME_UNAVAILABLE`. The first judge task is therefore diagnostic: preserve
a content-free reason across this boundary and reproduce the real path under
local workerd before changing provider behavior.

`CLOUDFLARE_DEPLOY_URL` is not a runtime input. It selects the post-deploy smoke
target and must be supplied to the guarded deploy command, but an empty local
value cannot cause an already deployed Worker to fail Connect.

## Chosen architecture

### 1. Meeting-scoped BYOK in the existing coordinator

Extend `MeetingCoordinator`, the Durable Object already selected by
`meetingId`, with strict internal operations for configure, find, heartbeat,
clear, and session revocation.

The coordinator holds one `MeetingApiKeyLease` in object memory only. It does
not write the standard key to Durable Object storage, D1, R2, logs, responses,
or events. A lease is bound to the exact meeting, facilitator participant, and
Bearer session. Lazy expiry on every operation and a live-instance expiry
timer enforce the existing five-minute TTL. Durable Object eviction simply
loses the lease and causes a truthful request for re-entry, as permitted by the
canonical requirement.

A focused Worker adapter implements `MeetingApiKeyLeaseStore` by calling these
internal coordinator operations. Public BYOK HTTP routes continue to use the
existing protocol schemas, application authorization, and use cases. The same
adapter is injected into Realtime access and client-secret issuance so all
three routes observe one lease source of truth.

Logout/session revocation clears an owned lease in the same coordinator call
that revokes transient meeting coordination state. Clearing or expiry never
changes meeting events or projections.

### 2. Judge managed-call failure classification

Replace message-only OpenAI managed-call failures with a closed safe reason
set:

- `OFFER_REJECTED`
- `PROVIDER_REJECTED`, accompanied only by the numeric HTTP status
- `PROVIDER_LOCATION_INVALID`
- `PROVIDER_SDP_INVALID`
- `PROVIDER_UNAVAILABLE`

No response body, SDP, API key, provider call ID, reservation ID, account ID,
meeting content, or private text may enter the reason or logs. The Durable
Object carries the safe reason to its internal response. The outer Worker
records only correlation ID, operation, reason, and optional provider status,
then returns the stable public `REALTIME_UNAVAILABLE` envelope with the same
redacted details. The browser continues to preserve meeting state and exposes a
stage-specific recovery sentence.

The diagnostic result determines exactly one provider fix:

- `OFFER_REJECTED`: reconcile the managed browser offer with the media-only
  validator while retaining the no-data-channel boundary.
- `PROVIDER_REJECTED`: handle the observed status at its source; authentication,
  payload, provider quota, and transient provider errors remain distinct.
- `PROVIDER_LOCATION_INVALID`: accept only the official location shape observed
  in a successful live response, without widening to arbitrary origins or IDs.
- `PROVIDER_SDP_INVALID`: reconcile only the observed official content type or
  bounded SDP shape.
- `PROVIDER_UNAVAILABLE`: correct the confirmed workerd fetch/timeout behavior
  without adding blind retries that could duplicate billable calls.

Accepted provider calls retain the existing sideband ownership, 30-second
termination, conservative settlement, and USD 25 rolling-cost lock. Unaccepted
calls continue to release their reservation, and retry reuses the established
idempotency rules.

### 3. Truthful HTTP and UI behavior

The Worker will route all supported BYOK endpoints before its API fallback.
Unknown API routes receive a dedicated non-retryable 404 protocol code; they
must never be labeled as artifact-storage failures. Actual R2 failures retain
`ARTIFACT_STORAGE_UNAVAILABLE` only at artifact operations.

Expected user behavior is:

- judge, no BYOK: access is `judgeManaged`; Connect uses the server-funded
  managed-call path.
- judge, optional BYOK: the tab key is sent only in the authenticated
  client-secret request and uses direct WebRTC; it is never leased server-side.
- ordinary facilitator, no BYOK: access is `unavailable`; UI asks for a key.
- ordinary facilitator, valid BYOK: configure succeeds, the tab retains the
  key, access becomes `facilitatorProvided`, and participants can mint only
  short-lived channel credentials.
- ordinary participant: no key-entry control; it observes the facilitator's
  active meeting lease.
- expired, cleared, or evicted lease: both channels disconnect or fail closed,
  the key state returns to required, and durable text/state remain intact.

## Security boundaries

- Standard keys are accepted only after fresh Bearer authentication, active
  meeting assignment, and facilitator authorization.
- Internal coordinator routes are reachable only through the Worker binding;
  no public URL forwards arbitrary internal operations.
- No API response echoes a standard key. Tests place secret canaries in keys,
  errors, logs, projections, and response bodies and require their absence.
- A lease owner mismatch fails closed and cannot replace, renew, read, or clear
  another facilitator session's lease.
- Judge and ordinary capabilities remain disjoint. Ordinary users cannot send
  request-scoped keys to the judge-only issuer and cannot access the Worker
  Secret.
- Provider failure diagnostics are allowlisted values, not redacted copies of
  arbitrary exception messages.

## Verification design

Development follows independent red-green cycles.

1. Coordinator contract and Cloudflare tests prove configure, find, heartbeat,
   expiry, clear, owner mismatch, meeting isolation, eviction-equivalent
   missing state, and session revocation.
2. Worker HTTP tests prove ordinary BYOK configuration, access transition,
   client-secret issuance, heartbeat, clear, and absence of artifact-error
   fallback.
3. OpenAI adapter and Durable Object tests prove every safe failure reason,
   release-before-acceptance, conservative finalize-after-acceptance, and no
   secret/private-data leakage.
4. Browser E2E exercises every visible Connect button and state for judge,
   ordinary facilitator, ordinary participant, private channel, shared channel,
   valid key, missing key, invalid key, retry, disconnect, and text fallback.
5. External-host-style E2E uses a non-`localhost` base URL and checks same-origin
   API resolution and CORS behavior.
6. A local workerd run with the real standard key must complete
   `Connect -> Connected -> Disconnect` for both channels before deployment.
   The live test emits only pass/fail, safe reason, model, and provider status.
7. Typecheck, lint, build, unit/integration/Cloudflare pools, security scan, and
   the guarded deployment dry run must pass from a clean commit.
8. After one production deployment, inspect active bindings, run readiness and
   authenticated access probes, then perform judge and ordinary-BYOK hosted
   Connect smokes. Failure stops the release; it does not trigger another blind
   patch.

UI changes receive committed Playwright coverage and synthetic screenshots as
required by `AGENTS.md`. No screenshot may contain a real key or credential.

## Out of scope

- Replacing managed judge calls with direct browser client secrets
- Removing the judge cost ledger, ownership checks, or sideband settlement
- Extending Realtime beyond the Flagship meeting experience
- Redesigning unrelated meeting, Decision, artifact, or monitoring UI
- Hosted C5 completion, three-minute human rehearsal, repository publication,
  tagging, or Devpost submission

## Completion criteria

This repair is complete only when all of the following are true:

- production-equivalent Worker tests no longer inject `unavailableLeases` into
  ordinary BYOK access or issuance;
- ordinary facilitator BYOK reaches `facilitatorProvided` and both channel
  Connect buttons establish and close independent sessions;
- judge without BYOK establishes and closes both managed channels;
- every failed judge start has a safe, actionable reason and zero-cost release
  or conservative accepted-call settlement according to its boundary;
- no supported route can fall through to a false artifact-storage error;
- local workerd real-provider smoke passes before the guarded production
  deployment; and
- hosted judge and ordinary-BYOK smoke pass on the exact 100%-served version.
