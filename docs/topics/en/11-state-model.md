# 11 — Meeting State Model

Sources: mainly `talk6.md` and `talk7.md` (v0.1 / v0.2.0), with reinforcement
from `talk8.md`. The detailed specification and JSON Schema fragments in
`talk7` are the source for this compressed implementation reference.

> **Structurally confirmed:** talk6→talk7 is one connected branch in which the
> state model becomes concrete. **Cross-branch synthesis:** Counterpoint and
> Living Decisions come from other branches and are not proven to be a later
> historical development of the talk7 specification.

## Why this is the kernel

The core is not voice, agents, or UI. It is:

> Who makes what claim about what, with which assumptions and evidence, where
> others agree or disagree, what remains unresolved, what is decided, and who
> does what next.

## Five-layer model

\[
S_t = (L_t, K_t, P_t, O_t, V_t)
\]

| Layer | Name | Role |
|---|---|---|
| L | Ledger | Append-only evidence ledger |
| K | Deliberation Graph | Meaning and argument graph |
| P | Process State | Phase and decision-readiness state |
| O | Outcome State | Decisions, dissent, and actions |
| V | Views | Shared / participant-private / moderator views |

Initial implementation does not need a graph database. Events + nodes + edges +
a reducer are sufficient.

## Five principles

1. Separate factual utterances from AI inference (`origin`, `confirmation_status`, etc.).
2. Separate shared and private information.
3. Separate supporter count from option quality.
4. Do not optimize for agreement volume.
5. Preserve traceability through the decision.

## Core distinctions

```text
Utterance ≠ Proposition ≠ Stance ≠ Premise ≠ Evidence
```

Do not turn an inference into a person’s fact. Connect multiple stances to the
same proposition instead of duplicating the proposition.

## Main entities

MeetingContract, Participant, SourceArtifact, Utterance, Proposition, Question,
Claim, Premise, Definition, Evidence, Option, Criterion, Constraint, Risk,
Evaluation, Decision, Dissent, Action, and Intervention.

Example relations include `supports`, `contradicts`, `assumes`, `answers`,
`depends_on`, `satisfies`, `violates`, and `implements`.

## Progress conditions

Progress is not speaking volume; it is structural, epistemic, choice, and
execution progress. The talk6 assignment asked for three conditions under which
an updated state means the meeting advanced. Talk7 provides a proxy definition,
but the export does not confirm a user-final answer.

## Meeting lifecycle

| Phase | Content |
|---|---|
| Before | Meeting contract and private preparation |
| During | Extraction, shared updates, and intervention candidates |
| After | Decision, actions, follow-up inheritance, and execution feedback |

The reduction principle from `talk8` is to narrow meeting types and inference
targets, not to remove the before / during / after lifecycle.

Minimum target: decision meetings of 3–8 people, 30–60 minutes, one shared
screen, and one client per participant. Initially exclude AI auto-speaking,
AI final decisions, sentiment analysis, fully automatic diarization, every
meeting type, and autonomous negotiation.

## Living Decisions extension

The meeting-graph specification and the Decision lifecycle
`DRAFT → … → MONITORING → AT RISK → REVIEW REQUIRED` are not yet one canonical
merged schema in the conversation. When implementing:

1. Use the talk7 entities as the base.
2. Add dependency assumptions, monitor adapters, and version history to the Decision Object.
3. Add Counterpoint’s Private / Shared / Commitment as view-layer states.

## Model split

| Role | Component |
|---|---|
| Realtime | Private live support |
| GPT-5.6 | Deep state synthesis |
| Diarization | Supporting aid |
| Normal code | Canonical state, ACL, events, and confirmation |

Use participant client IDs as the primary speaker identity rather than relying
on a model. Keep AI interventions as screen suggestions or moderator suggestions
at first; do not make the AI speak automatically.

## Related documents

- [Product evolution](./10-product-evolution.md)
- [Counterpoint / Living Decisions](./12-counterpoint-living-decisions.md)

