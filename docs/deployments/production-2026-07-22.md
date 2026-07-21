# Cloudflare production deployment record

This is a credential-free record of the explicitly approved production
deployment. It omits Cloudflare account and resource IDs, Worker Secret values,
judge credentials, provider payloads, SDP, and private source content.

- Recorded: 2026-07-22 (Asia/Tokyo)
- Target: `production`
- Worker: `counterpoint-living-decisions-production`
- Origin: `https://counterpoint-living-decisions-production.gs2safari.workers.dev`
- Deployed implementation commit:
  `fd0534a47d5a28a55c9f01ba1df8f8b8cf9529fb`
- Rendered configuration SHA-256:
  `ad7cd076af2b494b81caa9c80962790b0e1aa683616ef47ea527ef5a0ed1a996`
- Deployment status SHA-256:
  `06445298b47151c9edc02b8cad913ed8567e710aa3eb1e89201203e5243ab8b2`
- D1: production binding with forward-only migrations applied
- R2: production artifact bucket binding
- Durable Objects: meeting coordination and judge Realtime call control

## Included reliability changes

- Realtime connection failures retain a safe public boundary stage and keep
  manual text available.
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

## Deployment-boundary verification

- Production build passed. Vite reported only its non-blocking large-chunk
  warning.
- Repository and generated-output secret scan passed without printing secret
  values.
- Security matrix passed `335/335`.
- Cloudflare test pool passed `140/140`.
- Target configuration dry-run passed.
- Forward D1 migrations and strict Worker deployment passed.
- Remote root, health, and readiness returned `200`; an unauthenticated API
  probe returned the expected `401` boundary.
- The provider-free authenticated Flagship smoke passed disclosure, Decision
  commit, monitoring, and final reset against the canonical production origin.

The guarded deploy does not spend provider budget merely to prove browser
Realtime. A fresh owner-observed private and shared judge `Connect → Connected
→ Disconnect` check after this deployment remains separate hosted evidence.
The later test-only lease-isolation commit is not a runtime change and was not
included in this deployment.
