# Cloudflare production deployment record

This is a credential-free record of the explicitly approved production
deployment. It omits Cloudflare account and resource IDs, Worker Secret values,
judge credentials, provider payloads, SDP, and private source content.

- Recorded: 2026-07-22 (Asia/Tokyo)
- Target: `production`
- Worker: `counterpoint-living-decisions-production`
- Origin: `https://counterpoint-living-decisions-production.gs2safari.workers.dev`
- Final deployed commit:
  `36e1a83d2732b9a9fa18471af7aca5a4f85f903e`
- 100%-served Worker version: `27`
  (`336797f2-eb71-42be-a6a4-a1b830568960`)
- Rendered configuration SHA-256:
  `3fd52990eb6ee0e392375a2715b8e9c96367c790ab8a47ff48654852ed78998e`
- Deployment status SHA-256:
  `e6315ece50f866906ecb6913dfc4823ecf6f992fe502346abe4afb3db7039ffc`
- D1: production binding with forward-only migrations applied
- R2: production artifact bucket binding
- Durable Objects: meeting coordination and judge Realtime call control

## Included reliability changes

- Realtime connection failures retain a safe public boundary stage and keep
  manual text available.
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
- Security matrix passed `337/337`.
- Cloudflare test pool passed `148/148`.
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
  evidence capture passed `4/4`, current unit/integration passed `913/913`, the
  real Wrangler release suite passed `4/4`, and typecheck, lint, format, build,
  and secret scan passed.

Ordinary BYOK Realtime is now verified on the canonical production Worker. A
fresh owner-observed private and shared server-funded judge
`Connect → Connected → Disconnect` check remains separate hosted evidence
because the private judge password is intentionally absent from local files.
