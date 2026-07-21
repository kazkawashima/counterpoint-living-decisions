# Cloudflare production deployment record

This is a credential-free record of the explicitly approved production
deployment. It omits Cloudflare account and resource IDs, Worker Secret values,
judge credentials, provider payloads, SDP, and private source content.

- Recorded: 2026-07-22 (Asia/Tokyo)
- Target: `production`
- Worker: `counterpoint-living-decisions-production`
- Origin: `https://counterpoint-living-decisions-production.gs2safari.workers.dev`
- Final deployed commit:
  `26161502952deb3f5203a22d54001a008b9b6016`
- Rendered configuration SHA-256:
  `ad7cd076af2b494b81caa9c80962790b0e1aa683616ef47ea527ef5a0ed1a996`
- Deployment status SHA-256:
  `5c2ab41e0f2b58e08ef82648b7fa41b8e746ad944c47ec39da50884f042d1ee9`
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
- Security matrix passed `335/335`.
- Cloudflare test pool passed `140/140`.
- Target configuration dry-run passed.
- Forward D1 migrations and strict Worker deployment passed.
- Remote root, health, and readiness returned `200`; an unauthenticated API
  probe returned the expected `401` boundary.
- The provider-free authenticated Flagship smoke passed disclosure, Decision
  commit, monitoring, and final reset against the canonical production origin.
- Before deployment, the complete Flagship browser surface passed `30/30`, the
  evidence capture passed `4/4`, unit/integration passed `901/901`, and the
  media manifest was current for all 18 new synthetic captures.

The guarded deploy does not spend provider budget merely to prove browser
Realtime. A fresh owner-observed private and shared judge `Connect → Connected
→ Disconnect` check after this deployment remains separate hosted evidence.
