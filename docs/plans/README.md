# Implementation plan index

These plans turn [`docs/specs/`](../specs/README.md) into an ordered delivery
sequence. They do not authorize implementation yet.

## Plan order

| Order | Plan | Exit outcome |
|---:|---|---|
| 0 | [00-delivery-strategy.md](./00-delivery-strategy.md) | Critical path and stop rules understood |
| 1 | [01-foundation-domain-and-contracts.md](./01-foundation-domain-and-contracts.md) | Buildable monorepo, domain/state machine, protocol contracts |
| 2 | [02-local-flagship-skeleton.md](./02-local-flagship-skeleton.md) | Deterministic local text-only flagship shell through Commitment |
| 3 | [03-private-ai-realtime-and-artifacts.md](./03-private-ai-realtime-and-artifacts.md) | Permissioned evidence, GPT-5.6, Realtime, degraded text path |
| 4 | [04-commitment-and-living-decision.md](./04-commitment-and-living-decision.md) | Full event → `AT_RISK` → human-confirmed `REVIEW_REQUIRED` flow |
| 5 | [05-cloudflare-judge-mode-and-security.md](./05-cloudflare-judge-mode-and-security.md) | Hosted parity, judge access, limits, security gates |
| 6 | [06-quality-deployment-and-submission.md](./06-quality-deployment-and-submission.md) | Full verification, reel/README/Devpost evidence, tagged release |

Implementation status is tracked in
[`impl/_status.md`](./impl/_status.md). Task checkboxes belong in these plan
files; `_status.md` stays a short current-state surface.

## Execution rule

Complete the smallest end-to-end flagship path first. A phase may overlap
another only when it does not weaken its exit gate. Quickstart, Meta demo,
additional monitor adapters, broad ontology, and platform work remain deferred.

Each UI task includes browser E2E, external-host-style verification where
relevant, screenshots, and reel notes in the same change.
