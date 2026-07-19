# Counterpoint — Living Decisions

Greenfield repository for the OpenAI Build Week project **Counterpoint — Living
Decisions**.

## Repository status

The repository is in active implementation. Product and submission source
material is in [`docs/topics/`](docs/topics/README.md). The normalized build
contract is in [`docs/specs/`](docs/specs/README.md), and the ordered
implementation plan is in [`docs/plans/`](docs/plans/README.md). The M1
foundation is complete: workspace tooling, protocol contracts, deterministic
domain/replay, Decision lifecycle, ports, and contract harnesses are
implemented. The local Node persistence/authentication API, seeded flagship,
login/meeting UI, participant-private workspace, and exact
preview/approve/reject disclosure path are now implemented.

The intended architecture is:

- React + Vite web app
- Node runtime for local Docker Compose development
- Cloudflare Worker + Durable Objects + D1 + R2 for the hosted demo
- Shared domain core with runtime adapters

The flagship flow is private context → permissioned evidence → shared decision
→ commitment → external event → human-confirmed review.

## Local environment

Copy the example environment file before local development:

```bash
cp .env.example .env
```

Local development servers must bind to `0.0.0.0` so they remain reachable over
Tailscale. Do not place production credentials in `.env`, `.dev.vars`, the
repository, or logs. The judge-funded key belongs in the Cloudflare Worker
Secret `OPENAI_API_KEY_JUDGE` only.

Install and start the API and web app in separate terminals:

```bash
npm install
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

Run `npm test` for unit/contract/integration coverage and `npm run e2e` for the
committed browser journey and reel-evidence capture.

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

## Documentation

Read [`docs/topics/README.md`](docs/topics/README.md) for the Japanese reference
index, or [`docs/topics/en/README.md`](docs/topics/en/README.md) for the English
version.
For submission preparation, start with the hackathon rules, submission
checklist, IP guidance, and risk controls. The implementation requirements are
in [`docs/topics/14-implementation-requirements.md`](docs/topics/14-implementation-requirements.md).

Use [`docs/plans/impl/_status.md`](docs/plans/impl/_status.md) as the concise
current-state surface.
