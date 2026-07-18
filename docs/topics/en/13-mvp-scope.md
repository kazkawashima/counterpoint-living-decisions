# 13 — Hackathon MVP Scope

Sources: `talk8.md` and `talk11.md`; the alternative reduction branch is in
`talk3` / `talk4`.

> **Status: unresolved candidate.** This is the `talk11`-branch MVP if Living
> Decisions is selected. Misconception diagnosis, Executable Falsifier, and
> Promise Compiler have not been eliminated across all branches.

## Provisional vertical slice

### Before the meeting

- Three participants
- One private document per participant
- One question
- Three options

### During the meeting

- One explicit claim
- One inferred assumption with a confirmation flow
- Explicit approval to share private counter-evidence
- One Commit

### After the meeting (Living)

- One external event
- Invalidated assumption
- State → `REVIEW REQUIRED`
- Action held
- Reconsideration task generated

### Experience arc that must not be cut

```text
Preparation → private support → sharing → decision → execution/monitoring → reopen
```

## Reduction principle

> Narrow the meeting types and inference targets, not the before / during / after
> experience arc.

| Narrow | Keep long |
|---|---|
| Ontology, meeting types, and inference targets | The full before / during / after arc |
| Number of participants, options, and interventions | Private → Shared → Commit permission flow |

## Build / do not build

Build:

- One decision-meeting vertical slice
- Private / Shared / Commitment separation
- Separation of factual utterance and AI inference
- Decision Object with explicit assumptions
- One monitor adapter
- Build-time Codex + runtime GPT-5.6
- A three-minute demo whose outcome is visible on screen

Do not build for MVP:

- AI auto-speaking or AI final decisions
- Sentiment analysis or fully automatic diarization
- Every meeting type
- Autonomous negotiation
- Organization-wide SSoT
- Broad challenge discovery / 1,000-item collection
- Automatic discovery of implicit knowledge without an actor
- Production-grade platform or multi-tenancy
- Runtime Codex as a requirement

## Other branch candidates

### CommitLayer MVP

Past case fragments → infer implicit rules → predict failure on an unseen case →
Preflight → counterfactual demo. This was rejected as the current form in the
relevant branches.

### Promise Compiler MVP

Embed three promises in a demo app → generate checks → fail → Codex fixes →
re-test. It proves natural-language promise → executable test → mismatch →
verified fix and leans toward Developer Tools.

### Over-reduced proposal

Only connecting unconfirmed assumptions to documents was rejected because it
would become a clever meeting plugin.

## One Living Decisions demo

```text
Private context
→ Permissioned evidence
→ Shared decision
→ Explicit assumptions
→ External event
→ Assumption invalidated
→ Decision reopened
```

See the video framing in [Submission checklist](./02-submission-checklist.md).

## Related documents

- [Product definition](./12-counterpoint-living-decisions.md)
- [State model](./11-state-model.md)
- [Rejected and deferred ideas](./21-rejected-deferred.md)

