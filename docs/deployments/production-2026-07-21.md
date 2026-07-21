# Cloudflare production deployment record

This is a credential-free record of the explicitly approved production
deployment. It omits the Cloudflare account ID, D1/R2 credentials, deployment
response bodies, Worker Secret values, judge password, and provider payloads.

- Recorded: 2026-07-21
- Target: `production`
- Worker: `counterpoint-living-decisions-production`
- Origin: `https://counterpoint-living-decisions-production.gs2safari.workers.dev`
- Deployed implementation commit:
  `0d4f0e38c6a59d546c44ebb5db50f4ab6b004a71`
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
- The latest deployment also includes the projector-oriented shared-display
  layout and presentation tutorial. Preview and production both passed the
  remote health/readiness/root/auth smoke and the Flagship smoke at commit
  `0d4f0e38c6a59d546c44ebb5db50f4ab6b004a71`.
- The canonical Production D1 binding was restored before this deployment;
  the local deployment environment now matches the named
  `counterpoint-production` resource that contains the active `judge` account.
- After the production judge configuration was explicitly rendered with
  `JUDGE_USER_ID=judge`, the external browser boundary passed: ordinary
  access receives the guarded judge response and still reaches the manual
  excerpt fallback; display projection remains read-only and revoked tokens
  remain unusable. No provider call was required for this check.
- A production judge reconciliation dry-run returned
  `attempted=0 settled=0 released=0 failed=0`; it performed only a
  content-free stale-row SELECT and made no provider call or D1 mutation.
- A clean production browser confirmed judge login and server-funded
  structured-AI behavior: private excerpt suggestion, Decision candidate,
  assumption invalidation evaluation, human premise confirmation, Decision
  commit, staged event, `AT_RISK`, human review, `REVIEW_REQUIRED`, and JSON
  export.
- The first post-deploy smoke was retried after Worker propagation; the
  follow-up full Flagship smoke passed through monitoring, staged event,
  invalidation review, and reset. The transient first attempt was not used as
  completion evidence.
- The provider route was exercised only through the guarded judge path; no
  BYOK credential was entered or exposed in the browser flow.
- A separate production browser context logged in as the synthetic `safety`
  participant and received `403 JUDGE_MODE_FORBIDDEN` from the judge usage
  route. Ordinary participant access therefore does not inherit the judge
  capability.

The hosted C5 security-matrix rerun, independent cost-limit evidence, timed
three-minute human rehearsal, and final repository visibility switch remain
separate gates. No repository visibility change is recorded here.
