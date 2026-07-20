# Descant — Living Decisions

OpenAI Build Week project in the **Work & Productivity** category.

Descant turns a meeting outcome into a living Decision with explicit
evidence, assumptions, dissent, Actions, and monitoring. Each participant can
work with private context; nothing crosses into shared state until its owner
approves the exact excerpt. A facilitator can then commit the Decision, receive
a staged external event, review a grounded invalidation suggestion, and decide
whether human review is required.

The local Node/Compose flagship and the Cloudflare Worker application path are
implemented. The public Cloudflare preview is available for verification;
provider-funded judge routes remain disabled by default until a separate
approved secret and deployment boundary. Product and submission source material is in
[`docs/topics/`](docs/topics/README.md), the normalized build contract is in
[`docs/specs/`](docs/specs/README.md), and current implementation status is in
[`docs/plans/impl/_status.md`](docs/plans/impl/_status.md).

The public product name is Descant — Living Decisions. The repository name,
package namespaces, and Cloudflare resource identifiers retain the historical
`counterpoint` prefix so existing deployments and persisted data are not
renamed during the submission hardening work.

## Architecture

- React + Vite web app
- Node runtime for local Docker Compose development
- Cloudflare Worker + Durable Objects + D1 + R2 for the hosted demo
- Shared domain core with runtime adapters

The flagship flow is private context → permissioned evidence → shared decision
→ commitment → external event → human-confirmed review.

## GPT-5.6 and human control

GPT-5.6 is used through server-side Structured Outputs. The browser never
selects provider identity, billing reservations, or judge capability.

| Product operation         | Grounded input                               | Structured output                                                 | Version                      |
| ------------------------- | -------------------------------------------- | ----------------------------------------------------------------- | ---------------------------- |
| Private disclosure        | One owner-private source                     | Exact-range disclosure candidate and reason                       | `private-evidence-v1`        |
| Shared Decision synthesis | Approved shared evidence and meeting state   | Bounded premise, dissent, Action, outcome, and monitor candidates | `shared-decision-v1`         |
| Assumption invalidation   | Committed assumptions and one external event | Referenced invalidation suggestion                                | `assumption-invalidation-v1` |

Outputs are schema-validated and reference-checked. AI may propose, but only the
source owner can disclose private material, and only the facilitator can confirm
candidate premises, commit a Decision, or move an `AT_RISK` Decision to
`REVIEW_REQUIRED`. Provider failure preserves manual text, manual Decision
editing, persisted state, audit history, and JSON export.

OpenAI Realtime is a separate optional voice-input transport using explicit
private/shared channels and short-lived client credentials. It is not
human-to-human conferencing, and text remains the durable fallback.

## Build Week and Codex

Codex was used as the build-time engineering agent for specification
normalization, architecture, implementation, tests, security review, debugging,
and deployment controls. It is not required at product runtime. The exact
baseline, milestone commits, pre-existing topic-material boundary, and final
Session ID placeholder are documented in
[`BUILD_WEEK_LOG.md`](BUILD_WEEK_LOG.md).

## Local environment

Requires Node `24.15.0` and npm `11.12.1` (also pinned by `.nvmrc`,
`package.json`, and the Docker image). Install exactly from the lockfile, then
copy the example environment:

```bash
npm ci
cp .env.example .env
```

Local development servers must bind to `0.0.0.0` so they remain reachable over
Tailscale. Do not place production credentials in `.env`, `.dev.vars`, the
repository, or logs. The judge-funded key belongs in the Cloudflare Worker
Secret `OPENAI_API_KEY_JUDGE` only. Judge IP pseudonymization uses a distinct
Worker Secret, `JUDGE_IP_HMAC_SECRET`; the two secrets must never be reused.

Start the API and web app in separate terminals:

```bash
npm run dev:server
```

```bash
npm run dev:web
```

Open `http://<this-machine-ip>:5173`. The default synthetic identities use the
following public demo-only passwords:

| User ID       | Role        | Password                   |
| ------------- | ----------- | -------------------------- |
| `product`     | Facilitator | `counterpoint-product`     |
| `safety`      | Participant | `counterpoint-safety`      |
| `legal`       | Participant | `counterpoint-legal`       |
| `engineering` | Participant | `counterpoint-engineering` |
| `sales`       | Participant | `counterpoint-sales`       |

The listed identities are synthetic local fixtures, not hosted judge
credentials.

## Verification

Run the local code and policy gates:

```bash
npm run env:check
npm run licenses:check
npm run media:manifest:check
npm run format:check
npm run test:architecture
npm run lint
npm run typecheck
npm test
npm run build
npm run security:verify
npm run e2e
npm run cloudflare:e2e
```

Browser tests use a non-`localhost` loopback alias and committed synthetic
fixtures. Normal E2E writes temporary captures under `test-results/evidence/`;
use `npm run e2e:capture` only for an intentional evidence refresh under
`docs/media/`, then review every new asset's provenance and regenerate
[`docs/media/ASSET_MANIFEST.json`](docs/media/ASSET_MANIFEST.json).

## Production-like local runtime

The standard persistent path serves one origin and starts without an OpenAI
key:

```bash
docker compose up --build
```

Open `http://<this-machine-ip>:8080`. Set `PUBLIC_HOST` to that IP so the
startup log prints the reachable URL, and set `COMPOSE_PORT` to change the
published port. One Node container serves the built React app and same-origin
`/api`, `/health`, and `/ready` routes. SQLite and partitioned artifacts
persist in the `counterpoint-data` named volume across container replacement.

To enable live AI locally, export `OPENAI_API_KEY` only in the invoking shell or
place it in an untracked `.env`. Do not add it to `compose.yaml`, an image, or
the repository. Set `REGULATORY_WEBHOOK_SECRET` to enable the signed regulatory
webhook; leave it empty to keep that unauthenticated external route disabled.
`REGULATORY_WEBHOOK_MAX_AGE_SECONDS` defaults to `300`. The signature is
`v1=<hex HMAC-SHA256>` over `<unix-seconds>.<exact raw request bytes>`, supplied
with `x-counterpoint-webhook-timestamp` and
`x-counterpoint-webhook-signature`.

Stop the stack without deleting persisted data:

```bash
docker compose down
```

## Cloudflare local resource scaffold

Plan 05 C1 provides a local-only Worker shell with React static assets, D1
migrations, an R2 artifact adapter, and one Durable Object namespace whose
instances are selected by meeting ID. It does not create Cloudflare resources
or deploy anything remotely.

```bash
npm run cloudflare:config:check
npm run cloudflare:types:check
npm run cloudflare:smoke:local
```

The smoke applies D1 migrations to ignored `.wrangler/` state, starts Wrangler
on `0.0.0.0`, and verifies the app through an external-host-style loopback
alias. All committed Wrangler commands disable `.env` fallback, so the local
Node OpenAI key cannot be copied into the Worker environment. See
[`deploy/cloudflare/README.md`](deploy/cloudflare/README.md) for the guarded
preview resource plan and remote-mutation boundary.

## Known limitations and release boundary

- The hosted preview and logged-out/incognito product boundary are available
  through the explicit Cloudflare deployment. The hosted full security matrix
  and provider-funded judge verification remain pending as separate release
  gates.
- Judge-funded OpenAI routes are disabled by default. Their separate Worker
  Secrets and USD 25 rolling-24-hour cap must be verified on the hosted target
  before a judge credential is issued.
- Demo identities and meeting content are synthetic and fixed for the
  hackathon flow; this is not a production identity-management system.
- Realtime supports voice input into explicit private/shared channels, not
  human-to-human audio conferencing.
- The product is presented publicly as Descant — Living Decisions. The final
  message hierarchy remains provisional until the submission review.
- Reel production is intentionally deferred until the hosted product is
  viewable.

## Licensing

No license for the Descant project source has been granted yet. Repository
visibility and the final project license are separate decisions; public
visibility for submission must not be described as an open-source grant unless
a project license is deliberately added. Current Build Week guidance says a
public repository should carry a relevant open-source license, so the remaining
owner decision is public MIT, public Apache-2.0, or the officially supported
private-repository judging path. The package metadata remains `UNLICENSED`
until that decision is made.

Pinned direct/transitive package metadata is generated in
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md). Development-only
LGPL/MPL-identified tooling and authoritative package license/NOTICE files
remain flagged for final release review. This metadata inventory is not a
substitute for that review. Media hashes and explicitly reviewed provenance,
creator, synthetic-fixture status, and pending rights status are recorded in
[`docs/media/ASSET_MANIFEST.json`](docs/media/ASSET_MANIFEST.json).
The engineering inventory and remaining owner decision are recorded in
[`docs/submission-license-audit.md`](docs/submission-license-audit.md).

## Documentation

Read [`docs/topics/README.md`](docs/topics/README.md) for the Japanese reference
index, or [`docs/topics/en/README.md`](docs/topics/en/README.md) for the English
version.
For submission preparation, start with the hackathon rules, submission
checklist, IP guidance, and risk controls. The implementation requirements are
in [`docs/topics/14-implementation-requirements.md`](docs/topics/14-implementation-requirements.md).

Use [`docs/plans/impl/_status.md`](docs/plans/impl/_status.md) as the concise
current-state surface.

Public-safe judge testing steps are in
[`docs/submission-testing-instructions.md`](docs/submission-testing-instructions.md).
Credentials, if required, are intentionally omitted and must be supplied only
through a verified private submission field.
