# Descant specification index

This directory is the implementation-facing specification derived from every
document under [`docs/topics/`](../topics/README.md). The Japanese topic files
remain the source material; this directory is the normalized build contract.

## Authority and conflict resolution

Use the following precedence when source documents differ:

1. Current official hackathon and platform requirements, once re-verified.
2. Explicitly confirmed requirements in
   [`14-implementation-requirements.md`](../topics/14-implementation-requirements.md).
3. Safety and stabilization boundaries in
   [`15-submission-readiness-and-risk-controls.md`](../topics/15-submission-readiness-and-risk-controls.md).
4. Product and state-model material in topics `10`–`13`.
5. Strategy, archive, and branch-local material in topics `01`–`05`, `20`,
   and `21`.

This resolves the largest apparent conflict in the source set: the current
public product is Descant — Living Decisions, renamed from the historical
Counterpoint working title confirmed by topic `14`. Earlier branch documents
and internal identifiers may retain Counterpoint as history rather than as the
current public name.

## Specification set

| File | Scope |
|---|---|
| [00-product-scope-and-experience.md](./00-product-scope-and-experience.md) | Product contract, users, claims, flagship experience, MVP boundaries |
| [01-domain-model-and-state-machine.md](./01-domain-model-and-state-machine.md) | Five-layer model, entities, events, reducers, Decision lifecycle |
| [02-identity-permissions-and-security.md](./02-identity-permissions-and-security.md) | Authentication, authorization, isolation, API keys, disclosure security |
| [03-ai-realtime-and-artifacts.md](./03-ai-realtime-and-artifacts.md) | GPT-5.6, Realtime, voice topology, document and URL handling |
| [04-system-architecture-and-data.md](./04-system-architecture-and-data.md) | Monorepo, ports/adapters, persistence, Node and Cloudflare runtimes |
| [05-contracts-events-and-errors.md](./05-contracts-events-and-errors.md) | HTTP, realtime event, webhook, idempotency, and error contracts |
| [06-ui-ux-motion-and-evidence.md](./06-ui-ux-motion-and-evidence.md) | Screen behavior, visual language, accessibility, motion, reel capture |
| [07-operations-observability-and-resilience.md](./07-operations-observability-and-resilience.md) | Limits, degraded mode, reset, logs, metrics, deployment operations |
| [08-testing-acceptance-and-submission.md](./08-testing-acceptance-and-submission.md) | Test strategy, acceptance gates, submission proof |
| [coverage-matrix.md](./coverage-matrix.md) | Topic-by-topic traceability into specs and plans |

User decisions are intentionally not hidden inside these specs. They are
collected in
[`docs/decisions/user-decisions.md`](../decisions/user-decisions.md). External
facts that must be re-verified are separated into
[`docs/decisions/external-rechecks.md`](../decisions/external-rechecks.md).

## Status language

- **MUST**: required for the flagship or submission gate.
- **SHOULD**: expected unless it threatens the flagship deadline.
- **MAY**: optional after all MUST gates pass.
- **OUT**: explicitly outside the hackathon MVP.

Implementation progress and release gates are tracked under
[`docs/plans/`](../plans/README.md), with the current verified position in
[`docs/plans/impl/_status.md`](../plans/impl/_status.md).
