# 10 — Product-Evolution Branches

Sources: `talk1`–`talk11`, especially `talk2`, `talk3`, `talk7`, `talk8`, and
`talk11`. No content outside the conversations is added.

> **Chronology constraint:** This is not a real-time timeline. It separates
> logical development within each branch from conceptual relationships created
> by comparing branches later. Talk-number, branch depth, and export time do not
> establish order between branches.

## Structurally observable branch map

```text
Seven independent roots overall
├─ talk1: exploration funnel / Codex and GPT split
├─ talk2: Just-in-Time SSoT / CommitLayer reconstruction
├─ talk3 ─┬─ CommitLayer → cut current A/B form → Promise Compiler
│         └─ talk8: meeting MVP → Counterpoint
├─ talk4 ─┬─ category and Promise branch endpoint
│         └─ talk11: Concept C → Counterpoint → Living Decisions → comparison
├─ talk5: category competition and IP
├─ talk6 → talk7: meeting state model / Meeting Lifecycle OS v0.2
└─ talk10: Devpost application

talk9: a likely connection point in the talk4/talk11 route discussing the
       Counterpoint / ChatGPT Work boundary
```

`talk3` and `talk8` share their first utterance. `talk4` and `talk11` share 52
utterances. Other connections are, by default, cross-branch synthesis.

## File correspondence

| File | Product-design role | Structural position |
|---|---|---|
| talk1 | Early Concept A exploration pipeline | Independent root |
| talk2 | Reframing into Just-in-Time SSoT and commitment mechanism | Independent root; order relative to talk1 unknown |
| talk3 | CommitLayer productization, A/B comparison, Promise Compiler | Branch point with talk8 |
| talk4 | A/B detail, MVP, categories, Promise details | Shares 52 utterances with talk11 |
| talk5 | Category competition analysis | Independent root |
| talk6 | Voice-dialogue origin of the state-model idea | Parent route of talk7 |
| talk7 | State-model v0.1 and spec v0.2.0 | Connected at the end of talk6 |
| talk8 | Narrow meeting MVP and Counterpoint naming | Branches after one shared utterance with talk3 |
| talk9 | Counterpoint vs ChatGPT Work boundary | Probable connection to an intermediate utterance |
| talk10 | Devpost application | Independent root |
| talk11 | Concept C, Counterpoint, Living Decisions, candidate comparison | Sibling branch from the talk4 shared trunk |

## Concept A — Bottleneck Explorer

An agent layer that observes public behavioral traces to discover who is moving
what toward which state, what transition is blocked, and where cost is
externalized.

The unit is not a company but `actor × target × current state × target state`.
The current form was cut as a hackathon submission in the talk3 and shared
talk4/talk11 branches. A proposal to retain it as 5% of the vision belongs to
the talk11 branch and is not a cross-branch fact.

See [Ideas Archive](./20-ideas-archive.md).

## Just-in-Time SSoT / commitment mechanism

Instead of integrating an entire organization into a permanent SSoT, create
the canonical state needed for the relevant scope only at the moment a
transaction is committed. The product is a commitment mechanism immediately
before decision and execution, not a knowledge-management system.

Framing it as “AI that eliminates non-SSoT and individual dependency” is weak:
it confuses symptoms with causes.

## Concept B / CommitLayer

Discover conditions humans implicitly use from distributed work history,
present them as evidence-backed protocols, and convert them into a Preflight
after approval.

> The person responsible has become the software missing from the organization.

The current form was rejected as a submission in the talk3 and shared
talk4/talk11 branches because work history, formal facts, actor approval, and
effect measurement cannot all be established. Its remaining core appears in
both Promise Compiler and the meeting concept, but no temporal migration from
one to the other is proven.

## Promise Compiler

Extract explicit product promises from landing pages, READMEs, or specs;
convert them into executable checks against the real product; show mismatches;
and, after approval, let Codex fix and re-test them.

This is a Developer Tools-leaning alternative candidate from the talk3 branch.
The branch order relative to the meeting concept is unknown.

## Concept C — Meeting lifecycle / Decision State

Treat a meeting as a distributed process of thought, evaluation, and decision
making, connecting each participant’s private support to the shared discussion
state.

For the hackathon:

> Convert one decision-making meeting from conversation into an auditable
> Decision State.

The talk11 packaging proposal was C 75% / B 20% / A 5%; this is not a consensus
across all branches. The relationship Meeting Lifecycle OS / DecisionGraph →
Counterpoint → Living Decisions is an editorial cross-branch organization, not
a real-time history. The detailed state specification is the independent
talk6→talk7 branch.

See [Meeting State Model](./11-state-model.md).

## Counterpoint → Living Decisions

| | Counterpoint | Living Decisions |
|---|---|---|
| Center of gravity | Meeting → Commitment | **Decision object** |
| What is proved | Produce the decision correctly | Keep it alive over time |
| Category language | Commitment layer | Decision Runtime |

See [Counterpoint / Living Decisions](./12-counterpoint-living-decisions.md).

## Cross-branch concept map (non-chronological)

```text
Concept A (discover commitments; related talk1/2/3/4/11 discussions)
   └─ “What should transition?”
Concept B / CommitLayer (commitment conditions) ── Just-in-Time SSoT ──┐
   └─ “What makes the transition valid?”                              │
Promise Compiler ── explicit-promise version of B                     │
Concept C / Meeting State Model ── observable small world from another branch ┘
   └─ Counterpoint (private ↔ shared ↔ Commit protocol)
         └─ Living Decisions / Decision Runtime (talk11 branch only)
               └─ decision object detects invalidated assumptions and reopens
```

The map shows reuse and containment, not the order in which decisions were
made.

## Unresolved questions

- Final submission choice across all branches.
- The talk11 choice among Living Decisions, misconception diagnosis, and
  Executable Falsifier.
- A unified schema for Meeting State Model v0.2 and the Living Decision state machine.
- Final category: Work & Productivity, Education, or Developer Tools.

## Related documents

- [State model](./11-state-model.md)
- [Provisional product candidate](./12-counterpoint-living-decisions.md)
- [MVP](./13-mvp-scope.md)
- [Rejected and deferred ideas](./21-rejected-deferred.md)

