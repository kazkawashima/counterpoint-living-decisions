# Judge credential operations

This runbook is for the operator who enables server-funded judge access. It is
not a place to store a password, API key, HMAC value, or bearer token.

## Current state

The public preview is intentionally degraded-safe:

- `OPENAI_MODE=disabled`
- `JUDGE_STRUCTURED_AI_ROUTE_ENABLED=disabled`
- `JUDGE_MANAGED_REALTIME_ROUTE_ENABLED=disabled`
- `DEMO_STORY_MODE=enabled` only for the synthetic Flagship preview story
- production rendering forces `DEMO_STORY_MODE=disabled`

The `product` / `counterpoint-product` identity documented in `README.md` is a
synthetic local/demo fixture, not a production judge credential. Never reuse it
as the production judge password.

## Before issuing access

1. Confirm the exact judge user allowlist (`JUDGE_USER_ID`) and the dedicated
   synthetic judge account. Do not use an ordinary participant account.
2. Confirm the production Worker config has all feature gates explicitly
   enabled only in the approved production target, while preview remains
   disabled. The repository deploy renderer requires
   `CLOUDFLARE_ENABLE_JUDGE_MODE=production` and a private
   `CLOUDFLARE_JUDGE_USER_ID`; ordinary public demo users must not be used for
   the production allowlist.
3. Register `OPENAI_API_KEY_JUDGE` and `JUDGE_IP_HMAC_SECRET` as separate
   Cloudflare Worker Secrets. Do not put either value in `vars`, `.env`,
   `.dev.vars`, GitHub files, D1, R2, Durable Object state, browser payloads,
   or logs.
4. Verify the USD 25 rolling-24-hour application hard cap and all account,
   IP, meeting, concurrency, generation, token, and Realtime-second limits
   before allowing a provider request.
5. Test judge login and the Flagship from a clean browser context without
   BYOK; test an ordinary user in another context and confirm judge routes are
   denied.
6. Put the credential only in the submission form's private Testing
   Instructions after logging out and confirming the field is not public.

## Registering production Worker Secrets

These are Cloudflare Worker Secrets, not `.env` values, `vars`, D1/R2 data, or
browser settings. Register them only after the approved production Worker and
its bindings exist. The command prompts for each value interactively; do not
put a value in shell history, a command argument, or a log.

```bash
CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false \
  npx wrangler secret put OPENAI_API_KEY_JUDGE \
  --name counterpoint-living-decisions-production

CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false \
  npx wrangler secret put JUDGE_IP_HMAC_SECRET \
  --name counterpoint-living-decisions-production
```

Alternatively use Cloudflare Dashboard → Workers & Pages → the approved
production Worker → Settings → Variables and Secrets → Add secret. Confirm the
target Worker name before saving. Secret registration alone does not enable
judge routes; the exact `JUDGE_USER_ID`, feature flags, cost limits, and
production deployment gate still have to pass.

## Provisioning the private judge login

Do not put the judge password in `.env` or send it through chat. Run the local
provisioning command with the Cloudflare credentials exported from the ignored
`.env`; it prompts without echoing, stores only a scrypt hash in production D1,
and creates a facilitator assignment for the seeded Flagship:

```bash
set -a
source /home/lion/projects/counterpoint-living-decisions/.env
set +a
npm run cloudflare:provision:judge
```

The default internal ID is `judge`. Give the resulting login credential only
through the private submission Testing Instructions field. The public `product`
demo password must not be used for the server-funded allowlist.

## Shutdown and rotation

After the judging window:

1. Disable the managed Realtime and structured-AI gates and deploy the approved
   shutdown commit, or revoke the judge credential first if immediate shutdown
   is required.
2. Revoke/disable the judge account and verify a fresh login fails.
3. Delete or rotate both Worker Secrets without printing their values.
4. Verify ordinary users still receive the unavailable/denied response and
   that no provider credential or provider call ID appears in browser responses
   or logs.
5. Record only target, commit, timestamp, status, and content-free counts in
   the deployment record.

Remote secret mutation is deliberately not performed by this runbook or by the
preview deployment command. Use the guarded production approval workflow only
after the license, cost, and submission gates are closed.
