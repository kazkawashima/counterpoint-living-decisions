# Cloudflare production deployment record

This is a credential-free record of the explicitly approved production
deployment. It omits the Cloudflare account ID, D1/R2 credentials, deployment
response bodies, Worker Secret values, judge password, and provider payloads.

- Recorded: 2026-07-21
- Target: `production`
- Worker: `counterpoint-living-decisions-production`
- Origin: `https://counterpoint-living-decisions-production.gs2safari.workers.dev`
- Deployed implementation commit:
  `e496f8fcbee67616915bef3b58eb783d711fa44f`
- Rendered configuration SHA-256:
  `e19f78daa9c27f240b0e4ee154ccc9954fd7689fb3746ee7ffce6474186c7ecb`
- Deployment status SHA-256:
  `9c1bf49a27cb54d9a7dbf185540630b056d38d0aed74aebdc110ebaf1e123e23`
- D1 binding: production database with forward-only migrations applied
- R2 binding: `counterpoint-artifacts-production`
- Durable Object bindings: `MEETINGS` (`MeetingCoordinator`) and
  `JUDGE_REALTIME_CALLS` (`JudgeRealtimeCallController`)
- Production safety flags: judge structured and managed Realtime routes
  enabled only for the exact `judge` allowlist; `OPENAI_MODE=disabled` and
  `DEMO_STORY_MODE=disabled`. New judge work is blocked only by the rolling
  24-hour `$25` server-funded cost ceiling. Account, IP, meeting, concurrency,
  Realtime-second, generation, and token dimensions remain as unbounded
  protocol/telemetry fields and do not independently reject judge work.
- The exact allowlisted judge may optionally enter a personal OpenAI API key
  in the browser tab. It is sent over the authenticated HTTPS client-secret
  request only, is not persisted, logged, returned, or placed in D1/R2/DO
  state, and is never accepted for ordinary accounts. Removing it returns to
  server-funded judge-managed access.
- Worker Secrets: `OPENAI_API_KEY_JUDGE` and `JUDGE_IP_HMAC_SECRET` are
  registered as separate Cloudflare Worker Secrets. Values are not recorded.
- Judge account: dedicated synthetic `judge` identity provisioned in
  production D1 with a facilitator assignment for the seeded Flagship. Only a
  password hash is stored.

## Verification

- Build, secret scan, security matrix `302/302`, and Cloudflare pool `140/140`
  passed at the deployment boundary.
- Target dry-run, forward D1 migration, strict Worker deploy,
  health/readiness/SPA/auth smoke, and Flagship smoke passed.
- D1 migration `0013_rename_flagship_meeting.sql` changed the seeded room title
  to `Global AI Product Rollout`. The final Flagship smoke asserted that exact
  title and passed the authenticated disclosure, Decision commit, monitoring,
  and final-reset path.
- Managed Realtime reserves USD 12 per new server-funded call, so private and
  shared channels can coexist under the USD 25 ceiling. The Worker integration
  passed two simultaneous starts and rejects only a further start whose cost
  reservation would cross the rolling ceiling.
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
- After the canonical Production D1 binding was restored, the owner again
  confirmed the private `judge` login from a clean browser. The credential
  itself remains outside the repository and this record.
- The first post-deploy smoke was retried after Worker propagation; the
  follow-up full Flagship smoke passed through monitoring, staged event,
  invalidation review, and reset. The transient first attempt was not used as
  completion evidence.
- The provider route was exercised only through the guarded judge path; no
  BYOK credential was entered or exposed in the browser flow.

- The `1f0a852` deployment was rechecked at the canonical origin: `/health`
  returned `status=ok`, `/ready` returned `status=ready` with database,
  artifact storage, Realtime, and OpenAI dependencies available. Contract
  coverage passed `51/51`, focused Worker/unit coverage passed `18/18`, and
  the browser BYOK transition passed `1/1` with a synthetic non-secret key.
- A separate production browser context logged in as the synthetic `safety`
  participant and received `403 JUDGE_MODE_FORBIDDEN` from the judge usage
  route. Ordinary participant access therefore does not inherit the judge
  capability.
- The `f1d46ed` deployment adds Worker parity for the append-only
  `POST /api/v1/decisions/review-resolution` path and preserves permanent
  Realtime usage-limit errors without automatic retry. An authenticated
  intentionally incomplete Production request returned `400 VALIDATION_FAILED`,
  proving the canonical Worker reaches the new handler rather than a missing
  route. A private-judge revision 3 recommit remains a separate semantic check.
- The canonical-origin recheck also passed the read-only remote smoke and the
  external browser boundary `2/2` (`worker-product-view.spec.ts`, `16.3s`). A
  follow-up provider-free Flagship smoke reset the synthetic meeting and
  passed. This does not replace the full hosted C5 or independent cost-limit
  evidence.

The hosted C5 security-matrix rerun, independent cost-limit evidence, timed
three-minute human rehearsal, and final repository visibility switch remain
separate gates. No repository visibility change is recorded here.
