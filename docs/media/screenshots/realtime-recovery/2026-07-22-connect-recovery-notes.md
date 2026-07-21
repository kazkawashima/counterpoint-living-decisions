# Connect recovery evidence — 2026-07-22

All captures use synthetic identities, synthetic SDP, and nonfunctional test
credentials. No production API key or private user content is present.

## `2026-07-22-judge-ephemeral-private-connected.png`

- Change: server-funded judge Realtime recovery through the short-lived
  client-secret and direct browser WebRTC path
- State: allowlisted judge has no personal key in the tab; the Worker-issued
  ephemeral credential connected the Private agent while Shared remains off
- Viewport: 1440 × 900 desktop, reduced motion
- Source: `tests/e2e/realtime-channels.spec.ts`, synthetic Node browser fixture
- Branch/change: `codex/flagship-reliability`, judge ephemeral Realtime recovery

## `2026-07-22-judge-provider-rejected-recovery.png`

- Change: safe stage-specific recovery copy for a server-managed Realtime call
- State: judge-managed Private agent exhausted its bounded retries after the
  provider returned the allowlisted `PROVIDER_REJECTED` reason; shared remains
  off and durable text remains available
- Viewport: 1440 × 900 desktop, reduced motion
- Source: `tests/e2e/realtime-channels.spec.ts`, synthetic Node browser fixture
- Branch/change: `codex/flagship-reliability`, Task 4 production Realtime
  recovery UI

## `2026-07-22-worker-byok-both-connected.png`

- Change: Cloudflare Worker BYOK route parity and two-channel Connect proof
- State: ordinary Product facilitator configured a transient meeting lease;
  Private agent and Shared room agent are both connected before explicit
  disconnect and lease removal
- Viewport: Playwright Desktop Chrome default (1280 × 720)
- Source: `tests/e2e-cloudflare/worker-product-view.spec.ts`, local Wrangler
  Worker with synthetic browser credentials and SDP
- Branch/change: `codex/flagship-reliability`, Task 3/4 Worker BYOK and browser
  recovery integration
