# Cloudflare production deployment record

This is a credential-free record of the explicitly approved production
deployment. It omits the Cloudflare account ID, D1/R2 credentials, deployment
response bodies, Worker Secret values, judge password, and provider payloads.

- Recorded: 2026-07-21
- Target: `production`
- Worker: `counterpoint-living-decisions-production`
- Origin: `https://counterpoint-living-decisions-production.gs2safari.workers.dev`
- Deployed implementation commit:
  `fd3a62f0a200342dcd521ed136c220e988730709`
- Rendered configuration SHA-256:
  `e19f78daa9c27f240b0e4ee154ccc9954fd7689fb3746ee7ffce6474186c7ecb`
- D1 binding: production database with forward-only migrations applied
- R2 binding: `counterpoint-artifacts-production`
- Durable Object bindings: `MEETINGS` (`MeetingCoordinator`) and
  `JUDGE_REALTIME_CALLS` (`JudgeRealtimeCallController`)
- Production safety flags: judge structured and managed Realtime routes
  enabled only for the exact `judge` allowlist; `OPENAI_MODE=disabled` and
  `DEMO_STORY_MODE=disabled`.
- Worker Secrets: `OPENAI_API_KEY_JUDGE` and `JUDGE_IP_HMAC_SECRET` are
  registered as separate Cloudflare Worker Secrets. Values are not recorded.
- Judge account: dedicated synthetic `judge` identity provisioned in
  production D1 with a facilitator assignment for the seeded Flagship. Only a
  password hash is stored.

## Verification

- Build, secret scan, security matrix `300/300`, and Cloudflare pool `142/142`
  passed at the deployment boundary.
- Target dry-run, forward D1 migration, strict Worker deploy,
  health/readiness/SPA/auth smoke, and Flagship smoke passed.
- A clean production browser confirmed judge login and server-funded
  structured-AI behavior: private excerpt suggestion, Decision candidate,
  assumption invalidation evaluation, human premise confirmation, Decision
  commit, staged event, `AT_RISK`, human review, `REVIEW_REQUIRED`, and JSON
  export.
- The provider route was exercised only through the guarded judge path; no
  BYOK credential was entered or exposed in the browser flow.

The hosted C5 security-matrix rerun, independent cost-limit evidence, timed
three-minute human rehearsal, and final repository visibility switch remain
separate gates. No repository visibility change is recorded here.
