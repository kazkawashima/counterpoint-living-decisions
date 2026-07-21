# AGENTS.md

## Project context

Counterpoint is being prepared for hackathon submission. The repository's
product and submission requirements live under [`docs/topics/`](docs/topics/),
with the Japanese documents as the source and [`docs/topics/en/`](docs/topics/en/)
as the English reference translation.

## Global development rules

### Network binding

This machine is accessed through Tailscale. Any development server must bind
to `0.0.0.0` so it can be reached from a mobile device over the network.

- Wrangler: use `--ip 0.0.0.0`
- Next.js: use `--hostname 0.0.0.0`
- Vite: use `--host 0.0.0.0`
- Other servers: use the equivalent option

When editing package scripts or server configuration, do not leave a
development server bound only to `127.0.0.1` or `localhost`.

### UI verification

Whenever the UI changes, add and run browser E2E coverage for the changed
behavior. Manual inspection alone is not sufficient. Include an external-IP
style access check where relevant, including CORS behavior and fetch URL host
resolution, not only `localhost` access.

### Visual evidence capture

The hackathon submission will eventually need an introduction reel, but reel
production is not part of the active product goal until the hosted product is
viewable and usable. Keep lightweight visual evidence as development hygiene so
later production does not require recreating important states:

- After every UI change, capture screenshots of the affected screen and the
  important states (initial, interaction, success, error, and responsive state
  when applicable).
- Save captures under `docs/media/screenshots/<feature>/` using a stable name
  such as `YYYY-MM-DD-<feature>-<state>.png`.
- Keep a short note with each capture describing the feature, state, viewport,
  and commit or change. Narration/cut-point notes are optional.
- Record other reel-worthy material when it appears: animation clips, loading
  transitions, decision/evidence state changes, before/after comparisons,
  interaction sequences, and notable mobile layouts. Store source material or
  capture instructions under `docs/media/` and keep generated exports separate
  from source captures.
- Do not include real secrets, private user data, API keys, or sensitive
  decision content in screenshots or recordings. Use clearly synthetic demo
  data.

### Motion and visual emphasis

For UI work, consider adding purposeful animated components and a small amount
of visually emphasized or exaggerated presentation where it improves the
storytelling of the product and the reel. Motion must remain understandable,
accessible, and subordinate to the decision-making flow; provide an appropriate
reduced-motion behavior.

## Change discipline

- Read the relevant canonical topic documents before changing product behavior.
- Keep secrets in local environment files or platform secrets; never commit
  `.env`, `.dev.vars`, API keys, credentials, or private user data.
- Update the relevant documentation and capture evidence alongside meaningful
  UI changes.

## Production deployment invariants

The canonical hackathon deployment requires the server-funded judge agent. A
production deploy must never silently fall back to an ordinary, judge-disabled
configuration.

- Every production deployment command must set
  `CLOUDFLARE_ENABLE_JUDGE_MODE=production` and the exact nonempty
  `CLOUDFLARE_JUDGE_USER_ID` in addition to the normal production approval
  variables. Do not rely on shell history or an earlier rendered config.
- Before deploying, inspect the newly rendered production config and require
  `JUDGE_MANAGED_REALTIME_ROUTE_ENABLED=enabled`,
  `JUDGE_STRUCTURED_AI_ROUTE_ENABLED=enabled`, and the intended
  `JUDGE_USER_ID`. Stop if any are missing or disabled.
- `wrangler secret list` proves only that secret names exist at the Worker. It
  does not prove that the active version has enabled judge routes. After every
  deploy, inspect the 100%-served version bindings and verify both route flags,
  `JUDGE_USER_ID`, `OPENAI_API_KEY_JUDGE`, and `JUDGE_IP_HMAC_SECRET` before
  asking a user to test Connect.
- Registering `OPENAI_API_KEY_JUDGE` before a later deploy is insufficient on
  its own. The post-deploy binding audit and an authenticated
  `realtime/access` check are mandatory release gates.
- Realtime releases must preserve route parity between the Node server and the
  Cloudflare Worker. In particular, verify ordinary-user BYOK configure,
  heartbeat, access, client-secret creation, clear, and logout cleanup through
  the Worker; a Node-server test is not evidence that those Worker routes
  exist.
- Before a production Connect release, run the secret-safe browser Realtime
  smoke through local workerd when workerd has direct provider egress. On a
  machine where an outbound proxy is required, Wrangler's proxy support does
  not prove that workerd `fetch()` can reach the provider: use the direct
  media-only adapter smoke only as a preliminary credential/request-shape
  check, then require the same private and shared Connect/Disconnect cycles on
  the deployed Worker before declaring Realtime verified.
- A secret-name listing, a successful `realtime/access` response, and a
  Node-only provider smoke are each insufficient by themselves. The release
  gate is the composed browser path through the active Worker version, for both
  judge-managed access and ordinary meeting-scoped BYOK, with safe stage and
  retry behavior verified for failures.
- Adapters shared by Node and Cloudflare Workers must not capture Worker Web API
  methods such as `globalThis.fetch` and later invoke them as an object field.
  Call them through a wrapper that preserves the runtime global receiver, and
  keep a receiver-sensitive default-path unit test. Injected-fetch tests alone
  do not exercise this production runtime boundary.
- OpenAI `safety_identifier` values must be at most 64 characters. Use the raw
  64-character lowercase SHA-256 hex digest for provider-facing identifiers;
  do not prepend `sha256:` to that hex value. Prefixed digests may remain in
  internal D1 idempotency/fingerprint fields, which are a different contract.
  Keep RED/GREEN coverage at the Worker-to-Durable-Object boundary and in the
  OpenAI adapter so an overlength identifier is rejected before provider work.
- This invariant exists because production commit `ff46f37` was first deployed
  without the two judge-mode render inputs. That deployment preserved the
  secret names but rendered both judge routes disabled and omitted
  `JUDGE_USER_ID`, causing the UI to report `API key required`.
