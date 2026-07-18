# 12 — Counterpoint / Living Decisions (Provisional `talk11` Candidate)

Sources: `talk8.md`, `talk9.md`, and `talk11.md`.

> **Strength of conclusion:** Counterpoint appears in related talk8/talk9/talk11
> branches. The Living Decisions reframing appears only in talk11. The final
> choice against the other candidates is still open, so this is a candidate
> specification, not a final specification.

> **Integration status:** The talk6→talk7 Meeting State Model v0.2 and the
> talk11 Living Decision state machine are not merged. The MVP below is a
> cross-branch design proposal if they are combined.

## One-sentence definitions

**Counterpoint:** A protocol product that gives each participant a private
agent, connects only participant-selected Context to shared state, maintains a
room-level decision state in real time, and turns deliberation into an
**auditable Commitment and executable follow-through**.

**Living Decisions:** Treat a decision not as a static meeting packet but as a
**Decision Object that preserves dependent assumptions and moves itself into a
review state when reality changes**. This shifts the product center from
“meeting” to “decision.”

> Counterpoint alone produces decisions correctly. The Living Decisions version
> keeps decisions alive over time.

## Provisional package name

> **Counterpoint — Living Decisions for Agent-Native Teams**

| Layer | Content |
|---|---|
| Surface product | Constrained Concept C within the talk11 branch |
| Time-axis extension | Living Decision within the talk11 branch |
| Internal design language | Cross-branch reading of Concept B: Context → Commitment |
| Future vision | Talk11 proposal to keep Concept A brief |
| Category fit | Work & Productivity, unresolved |

## Core flow

```text
Private context
→ Selective disclosure / Permissioned evidence
→ Shared decision state
→ Explicit assumptions
→ Commitment
→ External event (monitor)
→ Assumption invalidated
→ Decision reopened (REVIEW REQUIRED)
→ Actions held / revisit task
```

### Prove / do not prove

| Prove | Do not prove |
|---|---|
| A decision has sources, assumptions, permissions, dissent, and execution/review conditions | That the final judgment is always correct |
| Reality changes can move the decision into review | A meeting-minutes or meeting-time-saving tool only |
| | A complete “operating system” |

## Differentiation language

| Contrast | Wording |
|---|---|
| vs Meeting AI | Meeting AI records the room. Counterpoint changes what the room can decide. |
| vs individual agents | When everyone has an agent, the room needs a protocol. |
| vs ChatGPT Work | Records, search, summaries, and tasks can be approximated; the core is a **Permission & Commitment Broker** for asymmetric private context |
| Living hook | Decisions should know when they are no longer true. |
| Tagline | Independent minds. Shared commitment. |

Category language: `commitment layer`, `Decision Runtime`, and `Living Decision
System`. Avoid `OS`; the MVP proves a transformation layer.

## Example state

```text
DRAFT → DECISION READY → COMMITTED → MONITORING
  → AT RISK → REVIEW REQUIRED → …
```

- Do not overwrite; keep version history (v1/v2/v3), evidence, and affected actions.
- The hackathon vertical slice is one decision moved into review by one later event.
- Do not build a platform.
- Conversation estimate: if Counterpoint alone is 100, the Living version is 140–160.

## ChatGPT Work boundary

| Work can approximate | Primitives that need to be owned here |
|---|---|
| Meeting records, search, summaries, and tasks | Permission broker for multiple independent owners |
| | Private existence lookup and confirmed-information separation |
| | Commitment with review conditions |

One architecture proposal is to connect personal Context to Work and concentrate
the custom implementation on the Broker. The exact boundary is unresolved.

## Evaluation position within talk11

Within the talk11 branch, Counterpoint + Living Decisions scored first (8.5) on
ideology, OpenAI narrative, and long-term value. Misconception diagnosis + AI
student may have stronger demo strength and completion probability; Executable
Falsifier remains the safer deadline option. The user leaned toward Living
Decisions, but the final commitment was not closed. Do not extend “overall first”
to every branch or evaluation axis.

## Open before implementation

1. Final submission candidate: Living / misconception diagnosis / Executable Falsifier.
2. Final three-minute video structure, including time jump and event injection.
3. Counterpoint trademark and domain check.
4. Final category: Work & Productivity, Education, or Developer Tools.
5. Monitor adapter type; MVP allows one.
6. Unified schema for State Model v0.2.0 and the Living Decision state machine.

## Related documents

- [State model](./11-state-model.md)
- [MVP scope](./13-mvp-scope.md)
- [Competition and naming](./04-competition-and-positioning.md)

