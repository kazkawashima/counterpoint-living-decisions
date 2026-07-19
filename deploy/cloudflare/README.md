# Cloudflare deployment runbook

This directory records the Cloudflare resource and C6 deployment boundary.
Preparing or verifying this runbook locally must not create, migrate, deploy,
roll back, or delete any remote resource. Every remote command below is an
operator procedure for an explicitly approved deployment or incident window.

## Committed binding contract

| Binding     | Resource                                      | Scope                                                       |
| ----------- | --------------------------------------------- | ----------------------------------------------------------- |
| `ASSETS`    | built React assets                            | same-origin UI and SPA fallback                             |
| `DB`        | D1 `counterpoint-preview`                     | canonical meeting records and event ledger                  |
| `ARTIFACTS` | R2 `counterpoint-artifacts-preview`           | artifact binaries; authorization remains in the application |
| `MEETINGS`  | `MeetingCoordinator` Durable Object namespace | one instance selected with `idFromName(meetingId)`          |

`OPENAI_API_KEY_JUDGE` and the independent `JUDGE_IP_HMAC_SECRET` are
intentionally absent from the deployment workflow. Register each directly as a
separate Cloudflare Worker Secret only at its separately approved gate. Never
reuse one for the other or store/pass either through GitHub Actions, GitHub
Environment secrets or vars, ordinary Worker vars, `.env`, `.dev.vars`, D1,
R2, Durable Object state, source, logs, or captured media.

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

## Resource planning

Run `npm run cloudflare:resources:plan` to inspect the preview resource plan
without changing anything. `scripts/cloudflare-preview-resources.sh --apply`
is deliberately guarded by `CLOUDFLARE_PREVIEW_MUTATION_APPROVED=yes`; do not
set that flag until a remote-mutation boundary is explicitly approved.

When that boundary is approved:

1. authenticate Wrangler to the intended non-production Cloudflare account;
2. run the guarded resource script once;
3. copy the exact D1 ID returned by Cloudflare into the preview environment
   configuration—never fabricate or derive it;
4. apply D1 migrations remotely only after reviewing the generated SQL;
5. keep judge-secret registration and deployment behind their own Plan 05
   approvals.

Local `.wrangler/` state is ignored. No remote IDs or credentials belong in
screenshots, reel clips, repository history, or logs.

## GitHub Environment setup

Create protected GitHub Environments named exactly `preview` and `production`.
The workflow maps its `target` input directly to the job environment, so
required-reviewer protection is the deployment approval boundary.

For both environments:

1. allow deployments only from the `main` branch;
2. configure required reviewers and prevent self-review;
3. prevent administrators from bypassing the protection when that control is
   available;
4. keep `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and
   `CLOUDFLARE_D1_DATABASE_ID` as Environment secrets;
5. keep `CLOUDFLARE_WORKER_NAME`, `CLOUDFLARE_R2_BUCKET_NAME`, and
   `CLOUDFLARE_DEPLOY_URL` as Environment vars;
6. use distinct credentials and resource metadata for preview and production;
7. set production's `CLOUDFLARE_PRODUCTION_CONFIRMATION` Environment var to
   exactly `counterpoint-production`, and leave it unset for preview;
8. do not add `OPENAI_API_KEY_JUDGE` or `JUDGE_IP_HMAC_SECRET` to GitHub.

The workflow derives `CLOUDFLARE_DEPLOYMENT_APPROVED` from the approved
`target`; it is not a stored credential or a manually reusable approval flag.

Account and D1 IDs are secret metadata for this repository. Do not echo them,
print the generated deployment configuration, upload it as an artifact, copy
it into an issue or pull request, or include it in screenshots, recordings,
repository files, or retained command logs. Generated deployment configuration
belongs only under ignored local `.wrangler/deploy/` state.

ER-09 is a hard external-recheck gate before enabling either Environment or
running the workflow. Re-check the current official GitHub Actions permission
model and Cloudflare API token permissions, record the date and official source
in the approved private operations record, and verify that:

- GitHub grants only `contents: read`;
- the token is scoped to the intended account and only the target Worker,
  D1 migration, R2 binding, deployment-version, and rollback operations;
- unrelated account-wide write permissions are absent;
- preview and production tokens can be rotated or revoked independently.

Do not infer current permission names from this runbook. If the least-privilege
set has not been externally re-checked and reviewed, deployment remains
blocked.

## Plan and preflight

The deploy scripts have two distinct modes:

```sh
bash scripts/cloudflare-deploy.sh --plan preview
bash scripts/cloudflare-deploy.sh --plan production
```

Plan mode and local preflight must not make a remote mutation. The deploy
driver uses `scripts/render-cloudflare-deploy-config.mjs` to create an
ephemeral strict config, and the post-deploy check uses
`scripts/cloudflare-remote-smoke.mjs`. Before requesting Environment approval:

1. confirm the selected ref is the exact intended `main` commit;
2. confirm the target is exactly `preview` or `production`;
3. complete ER-09 and review the Environment protection settings;
4. confirm all target-specific secrets and vars above are present without
   printing their values;
5. confirm the D1 database and R2 bucket already exist in the intended account;
6. review pending D1 and Durable Object migrations for forward compatibility;
7. run the repository's normal tests, build, Cloudflare config checks, and
   deploy plan locally;
8. verify the generated config and all output paths remain ignored and that no
   resource ID, credential, or private data will enter repository history,
   retained logs, artifacts, screenshots, or reel media.

The workflow is `workflow_dispatch` only. A dispatch from any ref other than
`main` is skipped. Selecting `target` attaches the protected Environment before
credentials are exposed, and approval is required before the job proceeds.

## Approved deployment sequence

After `npm ci`, the workflow invokes only:

```sh
bash scripts/cloudflare-deploy.sh --apply "$target"
```

The driver must fail closed on a missing or malformed credential, ID, URL,
target mismatch, uncommitted generated config, failed command, or unexpected
smoke response. It must suppress or redact remote command output so account,
database, deployment-version, and other resource IDs never enter GitHub
Actions logs. Its ordered remote phases are:

1. apply forward D1 migrations and validate pending Durable Object migration
   declarations;
2. perform a strict Worker deploy, including the declared Durable Object
   migrations, using the generated target configuration;
3. run health, readiness, SPA, and unauthenticated API parity checks through
   `scripts/cloudflare-remote-smoke.mjs`;
4. write the credential-free local record under ignored
   `.wrangler/deploy/records/`, then record the target, deployed commit,
   configuration hash, smoke result, approver, and timestamp in the approved
   private operations record.

Do not continue past a failed phase. A deployment version ID may be stored only
in the approved private operations record; it must not be copied into the
repository, GitHub Actions logs, issues, pull requests, artifacts, or media.

## Deployment inspection and rollback

Inspect the target's version history from a private operator terminal using the
same approved target credentials and ephemeral generated config:

```sh
npx wrangler deployments list --config "$config_path" --json
```

Do not redirect or paste its output into a repository file, CI log, issue,
pull request, artifact, screenshot, or recording. Select the previously
verified version from the private operations record, then roll back:

```sh
npx wrangler rollback <version-id> --config "$config_path" --yes
```

Immediately repeat health, readiness, SPA, authentication-parity, and the
separately approved synthetic flagship smoke against the target URL, then
record the outcome privately. Application rollback never runs a schema down
migration. D1 and Durable Object data stay at the newest applied schema; the
rollback candidate must be forward-compatible with it. If it is not, deploy a
forward-compatible fix or fail-closed version instead. Never delete or rewrite
newer events to make an old binary run.

## Judge-secret inspection and shutdown

List only secret names; Wrangler must never print secret values:

```sh
npx wrangler secret list --config "$config_path"
```

Delete the judge secret without reading, echoing, copying, or recording its
value:

```sh
npx wrangler secret delete OPENAI_API_KEY_JUDGE --config "$config_path"
npx wrangler secret delete JUDGE_IP_HMAC_SECRET --config "$config_path"
```

Run these commands only with the intended target's approved credentials and
ephemeral config. Verify the secret name is absent with `wrangler secret list`;
do not paste that output into retained logs or media.

For an emergency shutdown, use this order:

1. stop new public and judge-mode traffic using the reviewed fail-closed route
   or last known fail-closed deployment;
2. revoke the judge credential at the upstream provider;
3. delete `OPENAI_API_KEY_JUDGE` and `JUDGE_IP_HMAC_SECRET` from the affected
   Worker and verify only their names are absent;
4. revoke the affected Cloudflare deployment token and remove or rotate its
   GitHub Environment secrets;
5. verify traffic and funded provider calls have stopped, preserve D1/R2/DO
   data without a down migration, and create a credential-free private
   incident record.

If stopping traffic and revoking the provider credential can be done in
parallel by separate authorized operators, do both immediately; the remaining
steps retain the order above.
