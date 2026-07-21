# Cloudflare production deployment record

This is a credential-free record of the explicitly approved production
deployment. It omits Cloudflare account and resource IDs, Worker Secret values,
judge credentials, provider payloads, SDP, and private source content.

- Recorded: 2026-07-22 (Asia/Tokyo)
- Target: `production`
- Worker: `counterpoint-living-decisions-production`
- Origin: `https://counterpoint-living-decisions-production.gs2safari.workers.dev`
- Final deployed commit:
  `8056d69b55d3ac5ad6664a115e83fc9ce7a13604`
- 100%-served Worker version: `30`
  (`4cc5414d-53be-4319-a0fc-b5b42d8d8315`)
- Rendered configuration SHA-256:
  `3fd52990eb6ee0e392375a2715b8e9c96367c790ab8a47ff48654852ed78998e`
- Deployment status SHA-256:
  `fa8549940d408d1e53c2c2edc3e587ed6c630ee5ba03bd0c26f8fff2d70ce777`
- D1: production binding with forward-only migrations applied
- R2: production artifact bucket binding
- Durable Objects: meeting coordination and judge Realtime call control

## Included reliability changes

- Allowlisted judge Realtime now uses the authorized client-secret endpoint
  with `OPENAI_API_KEY_JUDGE` inside the Worker and returns only a 30-second,
  channel-scoped credential. Private and shared Connect use the browser direct
  WebRTC path already proven by BYOK; the managed sideband path remains dormant
  rollback code and is not called by the active judge UI.
- The judge usage summary is hidden for direct Realtime. This deployment does
  not claim that browser-direct judge calls are enforced by the D1 USD 25 hard
  cap; server-side call telemetry, forced termination, and exact settlement are
  deferred. Structured judge AI keeps its existing reservation path.
- Realtime connection failures retain a safe public boundary stage and keep
  manual text available.
- Browser microphone failures now retain only an allowlisted recovery category
  for permission blocked, input missing, input unavailable, or track attachment
  failure. The UI provides the matching correction while the healthy Realtime
  channel remains connected; raw DOMException and device details stay private.
- Managed Realtime failures carry only five allowlisted safe reasons and an
  optional integer provider status; provider bodies, headers, IDs, SDP, and
  credentials remain outside public responses.
- The Worker now exposes ordinary facilitator BYOK configure, heartbeat,
  client-secret, clear, and logout cleanup through a meeting-scoped,
  memory-only Durable Object lease. Unknown APIs return `ROUTE_NOT_FOUND`
  instead of an artifact-storage error.
- Client-secret issuance, managed call creation/hangup, and sideband upgrade
  invoke the runtime native fetch through a global-receiver-preserving wrapper.
  A receiver-sensitive RED/GREEN test reproduces and prevents the production
  `Illegal invocation` failure hidden by Node and injected-fetch tests.
- Judge-managed Realtime now sends the provider a raw 64-character lowercase
  SHA-256 digest as its pseudonymous safety identifier. The former `sha256:`
  prefix produced 71 characters and was rejected by OpenAI with status 400.
  The Worker/DO boundary and adapter now reject identifiers over the provider's
  64-character maximum before provider work.
- Projection reads are single-flight, use bounded backoff, stop on Cloudflare
  1102 until an explicit retry, and preserve the latest durable projection.
- AI provenance remains visible without becoming substantive committed
  Decision copy.
- Revision 3 requires a material title, outcome, or monitor-condition change
  and survives reload.
- The shared display projects the implemented Decision lifecycle rather than a
  permanently stale Meeting phase, and no longer exposes the raw position
  cursor to the audience.
- The production and reviewer walkthroughs include the complete operation order
  and distinguish the three-minute `REVIEW_REQUIRED` endpoint from the longer
  revision-3 reviewer path.
- The final audit adds state-owned coverage for the Flagship control surface,
  deterministic pending-call cancellation and channel-isolation checks, and
  desktop/mobile/reduced-motion evidence for the six changed visible states.
- The Cloudflare 1102 recovery action now uses an explicit high-contrast style;
  browser evidence verifies its foreground/background contrast before capture.

## Deployment-boundary verification

- Production build passed. Vite reported only its non-blocking large-chunk
  warning.
- Repository and generated-output secret scan passed without printing secret
  values.
- Security matrix passed `343/343`.
- Cloudflare test pool passed `149/149`.
- The focused browser RED/GREEN scenario passed `1/1`, proving no-key private
  and shared `Connect → Connected → Disconnect`, optional tab-local judge BYOK,
  and zero managed `/realtime/calls` requests. Its visually reviewed synthetic
  capture is recorded under `docs/media/screenshots/realtime-recovery/`.
- Target configuration dry-run passed.
- Forward D1 migrations and strict Worker deployment passed.
- Remote root, health, and readiness returned `200`; an unauthenticated API
  probe returned the expected `401` boundary.
- The provider-free authenticated Flagship smoke passed disclosure, Decision
  commit, monitoring, and final reset against the canonical production origin.
- The production OpenAI judge Secret was synchronized from the exact local key
  that passed both the media-only managed-call and client-secret live smokes;
  no key value was printed or stored in the repository.
- The 100%-served version audit confirmed both judge routes enabled,
  `JUDGE_USER_ID=judge`, both expected Secret names, production D1/R2, and the
  meeting and managed-call Durable Object bindings.
- A production ordinary-user BYOK browser smoke passed configure `201`, access
  `200`, private and shared client-secret issuance `201`, both direct OpenAI
  WebRTC calls `201`, Disconnect, and key clear `200`.
- Before deployment, the complete Flagship browser surface passed `30/30`, the
  evidence capture passed `4/4`, current unit/integration passed `919/919`, and
  the focused Realtime browser regression set passed `4/4`; typecheck, lint,
  format, build, secret scan, and media-manifest verification also passed.

Version 30 is the 100%-served canonical production Worker. Root, health,
readiness, authentication boundary, provider-free Flagship smoke, active route
flags, judge identity, and Secret-name bindings are verified. On version 29 the
owner confirmed from the canonical Production UI that the allowlisted judge,
without personal BYOK, connected both Private agent and Shared room agent
successfully. Version 30 changes only browser media-failure classification and
recovery copy; a real-browser microphone retry remains the owner-hosted
acceptance without placing the private judge password in local files or the
repository.
