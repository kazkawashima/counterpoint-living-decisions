# Plan 04 — Commitment and Living Decision

## Goal

Complete the differentiating post-meeting arc from a committed Decision through
external change, AI risk suggestion, human review, Action hold, and revision
history.

## Inputs

- [Domain/state specification](../specs/01-domain-model-and-state-machine.md)
- [Contract specification](../specs/05-contracts-events-and-errors.md)
- [Operations specification](../specs/07-operations-observability-and-resilience.md)
- Plan 03 exit gate

## Work packages

### D1 — Commitment completeness

- [x] Validate Decision outcome, confirmed premises, evidence references,
      dissent, Actions, owners, and monitor condition.
- [x] Create immutable committed revision.
- [x] Register one regulatory-change monitor.
- [x] Transition `COMMITTED → MONITORING`.
- [x] Render source-to-Decision audit lineage.

### D2 — Signed webhook

- [x] Define regulatory-change schema and monitor registration.
- [x] Verify timestamped signature over raw body.
- [x] Reject replay, wrong schema, and wrong meeting registration.
- [x] Enforce durable receipt and idempotency.
- [x] Publish evaluation status separately from receipt.

### D3 — Demo event parity

- [x] Add facilitator-only demo event button.
- [x] Route it through the same normalized application use case.
- [x] Ensure it injects an event only; no automatic review confirmation.
- [x] Record actor/origin accurately.

### D4 — GPT-5.6 invalidation evaluation

- [x] Build structured input from active revision, confirmed premises, monitor
      condition, and external event.
- [x] Validate affected premise/Action references.
- [x] Append `AssumptionInvalidationSuggested`.
- [x] Move Decision to `AT_RISK`.
- [x] Record model, prompt version, confidence, reason, and input references.

### D5 — Human review

- [x] Show event, affected premise, evidence, Actions, and model reason.
- [x] Require facilitator confirm or reject plus optional/required reason as
      specified.
- [x] On reject, record reason and return to `MONITORING`.
- [x] On confirm, append `DecisionReviewRequired`, hold only affected Actions,
      and create reconsideration task.

### D6 — Revision workflow

- [x] Allow review to end in recommitted revision, superseded, or rejected.
- [x] Keep all historical revisions and event lineage.
- [x] Show before/after comparison.
- [x] Ensure export includes history and current state.

### D7 — Guided flagship

- [ ] Add concise stage cues from private evidence through review.
- [ ] Seed synthetic regulatory event and expected affected region.
- [ ] Make reset deterministic and meeting-scoped.
- [ ] Rehearse the value arc within the reel target.

## Verification

- unit tests for every lifecycle transition and Action selection
- webhook signature/replay/idempotency integration tests
- AI reference/schema failure tests
- browser E2E for demo injection and signed webhook variants
- E2E proving `AT_RISK` precedes and differs from `REVIEW_REQUIRED`
- E2E for rejection back to monitoring
- E2E for revision history and target-meeting reset
- restart persistence through the complete arc

## Visual evidence

Capture the reel's central sequence:

1. committed Decision/revision
2. time-jump visual
3. external regulatory event arrival
4. risk pulse and affected premise/Action
5. facilitator review
6. `REVIEW_REQUIRED`
7. held Action and generated task
8. revision history

Record both normal and reduced-motion transitions. Keep a narration/cut note for
each clip.

## Exit gate

Both the signed webhook and demo button cause the same durable external event
flow. GPT-5.6 can mark the Decision `AT_RISK`, but only facilitator confirmation
produces `REVIEW_REQUIRED`, Action hold, and reconsideration task. The previous
Decision remains auditable.

## Suggested commit boundaries

1. Webhook, monitor, and invalidation application flow.
2. Human review, revisions, guided UI, E2E, and evidence.
