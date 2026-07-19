# Cloudflare preview resource runbook

This directory records the Cloudflare resource boundary without creating or
deploying remote resources during local development.

## Committed binding contract

| Binding     | Resource                                      | Scope                                                       |
| ----------- | --------------------------------------------- | ----------------------------------------------------------- |
| `ASSETS`    | built React assets                            | same-origin UI and SPA fallback                             |
| `DB`        | D1 `counterpoint-preview`                     | canonical meeting records and event ledger                  |
| `ARTIFACTS` | R2 `counterpoint-artifacts-preview`           | artifact binaries; authorization remains in the application |
| `MEETINGS`  | `MeetingCoordinator` Durable Object namespace | one instance selected with `idFromName(meetingId)`          |

`OPENAI_API_KEY_JUDGE` is intentionally absent. Plan 05 C3 must add it with
`wrangler secret put`, after an explicit deployment approval, and must never
store it in `vars`, `.env`, `.dev.vars`, D1, R2, Durable Object state, source,
logs, or captured media.

Every committed Wrangler command sets
`CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false`. This prevents Wrangler's
`.env` fallback from copying the local Node runtime variables—including a
developer-owned OpenAI key—into the Worker environment when `.dev.vars` is
absent.

## Local verification

```sh
npm run cloudflare:config:check
npm run cloudflare:types:check
npm run cloudflare:d1:migrate:local
npm run cloudflare:smoke:local
npm run dev:worker
```

`dev:worker` always binds Wrangler to `0.0.0.0`. The API, health, and readiness
paths run through the Worker before the SPA fallback. Until C2 adapter parity
is implemented, `/api/*` fails closed with a protocol-safe 503 instead of
falling through to the SPA.

The committed local smoke starts Wrangler on `0.0.0.0`, reaches it through
`127.0.0.2` as an external-host-style alias, and verifies static HTML,
protocol health/readiness, and API fail-closed behavior. Its child environment
is an allowlist and therefore cannot inherit local API keys or webhook secrets.

Run `npm run cloudflare:resources:plan` to inspect the remote resource plan
without changing anything. `scripts/cloudflare-preview-resources.sh --apply`
is deliberately guarded by `CLOUDFLARE_PREVIEW_MUTATION_APPROVED=yes`; do not
set that flag until a remote-mutation boundary is explicitly approved.

When that boundary is approved:

1. authenticate Wrangler to the intended non-production Cloudflare account;
2. run the guarded resource script once;
3. copy the exact D1 ID returned by Cloudflare into the preview environment
   configuration—never fabricate or derive it;
4. apply D1 migrations remotely only after reviewing the generated SQL;
5. defer secret registration, preview deployment, and production deployment to
   their later Plan 05 gates.

Local `.wrangler/` state is ignored. No remote IDs or credentials belong in
screenshots, reel clips, repository history, or logs.
