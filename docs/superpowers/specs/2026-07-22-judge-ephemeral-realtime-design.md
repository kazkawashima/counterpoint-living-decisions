# Judge ephemeral Realtime recovery design

Date: 2026-07-22  
Status: approved for submission-critical implementation

## Objective

Make server-funded judge Realtime use the already proven client-secret flow so
an allowlisted judge can connect private and shared agents without supplying a
personal API key. Submission reliability takes priority over retaining the
current server-side Realtime control plane.

## Selected architecture

The Worker keeps `OPENAI_API_KEY_JUDGE` as a write-only Cloudflare Secret. After
normal session, meeting, assignment, and judge-capability authorization, the
existing client-secret endpoint uses that standard key to request a short-lived
OpenAI Realtime client secret. Only the short-lived client secret is returned
to the browser. The browser then uses the same direct WebRTC connector already
proven for ordinary and judge-provided BYOK.

The public access mode remains `judgeManaged` so no judge identity or provider
configuration is exposed. In that mode:

- a tab-local judge-provided key, when present, continues to select the
  judge-provided client-secret issuer;
- otherwise the Worker selects the server-funded client-secret issuer;
- the browser no longer calls the managed `/realtime/calls` route for the
  submission path;
- the managed-call and sideband implementation remains in source for rollback
  and later repair, but is not used by the judge UI.

## Security and cost boundary

The standard OpenAI key must never enter a response, browser state, D1, R2,
Durable Object storage, logs, screenshots, or committed files. Client secrets
remain channel-scoped and short-lived, and are issued only after fresh
authorization for the requested meeting.

This recovery deliberately removes server-side Realtime telemetry, forced
termination, response-count control, and exact D1 settlement from the active
judge path. Therefore the application cannot truthfully claim that direct
judge Realtime is held by the existing rolling USD 25 hard cap. The judge usage
summary must be hidden for this path rather than presenting a misleading total.
The OpenAI account alert remains an external warning, not an application hard
cap. Structured judge AI operations retain their existing reservation path.

## Failure behavior

Failure to authorize or issue the short-lived secret remains fail-closed and
returns the existing safe API error. The meeting, manual private/shared text,
Decision flow, audit, and export remain available. Provider bodies, standard
keys, SDP, and private content are never copied into public errors.

## Verification

Implementation is complete only when all of the following pass:

1. A Worker test proves an allowlisted judge without BYOK receives a
   `judgeManaged` short-lived secret from the server-funded issuer.
2. A browser test proves judge Connect uses `/realtime/client-secrets` and does
   not call `/realtime/calls` when no tab-local key exists.
3. Existing ordinary BYOK and optional judge BYOK behavior remains green.
4. Unit/integration, security matrix, full Cloudflare pool, typecheck, lint,
   format, build, secret scan, and relevant browser E2E pass.
5. On the canonical Production Worker, a clean judge session completes private
   `Connect → Connected → Disconnect` and shared
   `Connect → Connected → Disconnect` without entering a personal key.

## Deferred restoration

After submission, repair and independently verify the Durable Object sideband
path before restoring server-owned usage settlement or making a USD 25
Realtime hard-cap claim. Do not treat client-secret expiry or browser-side
disconnect as equivalent to a server-enforced spend limit.
