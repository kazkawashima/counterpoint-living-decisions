# Source coverage matrix

This matrix proves that every topic document has an implementation-facing home.
English files mirror the same rows and are used as translation references.

| Topic source | Normalized specification | Delivery plan | Treatment |
|---|---|---|---|
| `01-hackathon-rules` | [08](./08-testing-acceptance-and-submission.md), [external rechecks](../decisions/external-rechecks.md) | [06](../plans/06-quality-deployment-and-submission.md) | Current facts rechecked; Codex/GPT evidence and category gate retained |
| `02-submission-checklist` | [08](./08-testing-acceptance-and-submission.md), [06](./06-ui-ux-motion-and-evidence.md) | [06](../plans/06-quality-deployment-and-submission.md) | Reel, README, Session ID, demo availability, English, credentials |
| `03-ip-and-license` | [02](./02-identity-permissions-and-security.md), [user decisions](../decisions/user-decisions.md) | [06](../plans/06-quality-deployment-and-submission.md) | Private/All Rights Reserved default; final publication/license stays user-owned |
| `04-competition-and-positioning` | [00](./00-product-scope-and-experience.md), [user decisions](../decisions/user-decisions.md) | [06](../plans/06-quality-deployment-and-submission.md) | Message hierarchy retained; category estimates not treated as facts |
| `05-risks-and-caveats` | [00](./00-product-scope-and-experience.md), [07](./07-operations-observability-and-resilience.md), [08](./08-testing-acceptance-and-submission.md) | All plans, especially [06](../plans/06-quality-deployment-and-submission.md) | Failure modes converted to scope and stop gates |
| `10-product-evolution` | [00](./00-product-scope-and-experience.md) | [00](../plans/00-delivery-strategy.md) | Historical alternatives retained as rationale, not implementation scope |
| `11-state-model` | [01](./01-domain-model-and-state-machine.md) | [01](../plans/01-foundation-domain-and-contracts.md) | Five layers, distinctions, entities, graph relations normalized |
| `12-counterpoint-living-decisions` | [00](./00-product-scope-and-experience.md), [01](./01-domain-model-and-state-machine.md) | [03](../plans/03-private-ai-realtime-and-artifacts.md), [04](../plans/04-commitment-and-living-decision.md) | Candidate language superseded by topic 14 product confirmation |
| `13-mvp-scope` | [00](./00-product-scope-and-experience.md), [08](./08-testing-acceptance-and-submission.md) | [00](../plans/00-delivery-strategy.md), [02](../plans/02-local-flagship-skeleton.md) | Full lifecycle kept; ontology and scenario count narrowed |
| `14-implementation-requirements` | [00](./00-product-scope-and-experience.md) through [08](./08-testing-acceptance-and-submission.md) | [01](../plans/01-foundation-domain-and-contracts.md) through [06](../plans/06-quality-deployment-and-submission.md) | Highest internal implementation authority; all 22 sections distributed |
| `15-submission-readiness-and-risk-controls` | [02](./02-identity-permissions-and-security.md), [03](./03-ai-realtime-and-artifacts.md), [07](./07-operations-observability-and-resilience.md), [08](./08-testing-acceptance-and-submission.md) | [03](../plans/03-private-ai-realtime-and-artifacts.md) through [06](../plans/06-quality-deployment-and-submission.md) | Human confirmation and flagship-first safety boundary enforced |
| `20-ideas-archive` | [00](./00-product-scope-and-experience.md) | [00](../plans/00-delivery-strategy.md) | Vision informs language only; no deferred system enters MVP |
| `21-rejected-deferred` | [00](./00-product-scope-and-experience.md) | [00](../plans/00-delivery-strategy.md) | OUT/MAY boundaries prevent scope regression |

## Topic 14 section coverage

| Topic 14 section | Spec |
|---|---|
| 1–3 Position, product, success | [00](./00-product-scope-and-experience.md) |
| 4 Users and screens | [00](./00-product-scope-and-experience.md), [06](./06-ui-ux-motion-and-evidence.md) |
| 5 Auth and participation | [02](./02-identity-permissions-and-security.md), [05](./05-contracts-events-and-errors.md) |
| 6 API keys | [02](./02-identity-permissions-and-security.md), [07](./07-operations-observability-and-resilience.md) |
| 7 Voice/text | [03](./03-ai-realtime-and-artifacts.md), [06](./06-ui-ux-motion-and-evidence.md) |
| 8 Materials/disclosure | [02](./02-identity-permissions-and-security.md), [03](./03-ai-realtime-and-artifacts.md) |
| 9 State/Living Decision | [01](./01-domain-model-and-state-machine.md) |
| 10 Architecture | [04](./04-system-architecture-and-data.md) |
| 11 Data isolation | [02](./02-identity-permissions-and-security.md), [04](./04-system-architecture-and-data.md) |
| 12–13 Demo and reset | [00](./00-product-scope-and-experience.md), [07](./07-operations-observability-and-resilience.md) |
| 14 Errors/observability | [05](./05-contracts-events-and-errors.md), [07](./07-operations-observability-and-resilience.md) |
| 15 Deployment | [04](./04-system-architecture-and-data.md), [07](./07-operations-observability-and-resilience.md) |
| 16–17 Tests/acceptance | [08](./08-testing-acceptance-and-submission.md) |
| 18 MVP outside | [00](./00-product-scope-and-experience.md) |
| 19 Publication | [user decisions](../decisions/user-decisions.md), [08](./08-testing-acceptance-and-submission.md) |
| 20 Confirmed decisions | All specs; summarized in [README](./README.md) |
| 21 External conditions | [external rechecks](../decisions/external-rechecks.md) |
| 22 References | Retained in topic source; revalidated at implementation gate |
