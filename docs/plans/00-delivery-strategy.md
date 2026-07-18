# Delivery strategy

## Objective

Ship one coherent, testable flagship:

```text
Login
→ private context
→ explicit disclosure
→ shared decision
→ Commitment
→ external event
→ AT_RISK
→ facilitator confirmation
→ REVIEW_REQUIRED
→ held Action + revisit task
```

The plan optimizes for a complete Cloudflare-hosted submission path, with a
reproducible Docker Compose path using the same domain and protocol.

## Critical path

```text
Foundation
→ deterministic local text flow
→ permissioned private evidence
→ GPT-5.6 candidate generation
→ Living Decision state transitions
→ Cloudflare parity and judge mode
→ hardening and submission evidence
```

Realtime voice is important but must not block the deterministic text path.
Visual polish follows working state transitions and accompanies each UI slice.

## Delivery principles

1. **Vertical before broad:** implement only entities and screens used by the
   flagship until it passes.
2. **Deterministic before AI:** first prove command/event/reducer behavior with
   manual or fixture candidates; then add GPT-5.6.
3. **Text before voice:** keep text as the always-available reference path; add
   Realtime without changing domain semantics.
4. **Local before hosted, hosted before optional:** establish adapter contracts
   locally, then prove Cloudflare parity before optional content.
5. **Privacy before convenience:** owner and meeting boundaries are designed
   into ports and DTOs, not added as UI filtering.
6. **Human confirmation is canonical:** AI suggestions never skip approval.
7. **Evidence travels with UI:** E2E, screenshots, clips, and reel notes are
   part of the feature completion gate.

## Milestones

| Milestone | Demonstrable outcome |
|---|---|
| M0 Planning | Specs, plans, user decisions, and coverage matrix committed |
| M1 Foundation | Domain lifecycle and protocol pass unit/contract tests |
| M2 Local skeleton | Three tabs can log in, join, share deterministic text evidence, and commit |
| M3 Private + AI + voice | Artifact disclosure, GPT-5.6 candidates, and explicit Realtime channels work with fallback |
| M4 Living Decision | Signed/demo event leads to `AT_RISK`, human review, `REVIEW_REQUIRED`, held Action, task |
| M5 Hosted judge path | Cloudflare parity, judge mode, spend limits, and security tests pass |
| M6 Submission release | Clean setup, complete E2E, reel, README, Devpost materials, tag, and availability runbook |

## Scope locks

Until M5 passes, do not implement:

- Quickstart or Meta demo UI
- a second monitor adapter
- runtime Codex
- OAuth, registration, billing
- generic plugin/agent platform
- full meeting ontology beyond flagship-used types
- human voice conferencing
- automatic private sharing

If a deferred concept is needed for future design, document it without adding
runtime surface.

## Stop-work rules

Stop feature work and repair the flagship if:

- private data crosses scope before approval
- AI can commit or confirm review without a human
- judge spend is unbounded
- a clean user cannot run the documented path
- app behavior diverges from reel/README
- Cloudflare and local domain semantics diverge
- a UI change lacks E2E or evidence capture

## Decision handling

Open user choices live in
[`docs/decisions/user-decisions.md`](../decisions/user-decisions.md). Work may
continue using documented defaults unless an item says it blocks the current
phase. Time-dependent facts are closed through
[`external-rechecks.md`](../decisions/external-rechecks.md), not guessed.

## Commit boundaries

Prefer one reviewable commit per coherent outcome:

1. foundation/tooling
2. domain/protocol
3. local auth/meeting shell
4. private disclosure
5. Decision commit
6. OpenAI synthesis
7. Realtime channels
8. Living Decision
9. Cloudflare adapters
10. judge mode/security
11. submission UX/evidence

Each commit includes its tests and related documentation/evidence. Do not stage
unrelated local tool artifacts.

## Definition of implementation complete

Implementation is complete only when all AC-01 through AC-19 in
[`08-testing-acceptance-and-submission.md`](../specs/08-testing-acceptance-and-submission.md)
have direct evidence, all release blockers are closed, and the exact tagged
commit is the one demonstrated in the reel and hosted judge environment.
