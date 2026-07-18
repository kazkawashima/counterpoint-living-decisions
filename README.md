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
implemented. The local Node skeleton is the next delivery stage.

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

## Documentation

Read [`docs/topics/README.md`](docs/topics/README.md) for the Japanese reference
index, or [`docs/topics/en/README.md`](docs/topics/en/README.md) for the English
version.
For submission preparation, start with the hackathon rules, submission
checklist, IP guidance, and risk controls. The implementation requirements are
in [`docs/topics/14-implementation-requirements.md`](docs/topics/14-implementation-requirements.md).

Use [`docs/plans/impl/_status.md`](docs/plans/impl/_status.md) as the concise
current-state surface.
