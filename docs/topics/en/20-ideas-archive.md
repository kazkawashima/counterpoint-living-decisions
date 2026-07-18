# 20 — Ideas Archive (Cross-Branch Exploration Log)

Sources: `talk1`–`talk11`.

Status labels: **KILL** = cut from submission; **DEFER** = retain as an idea;
**KEEP-VISION** = north star; **BRIDGE** = compressed into the next proposal.

This is a storehouse of discarded insight and unused candidates. [12](./12-counterpoint-living-decisions.md)
is a provisional talk11 candidate, not a confirmed final submission.

> Status is a judgment within the branch that stated it. Do not read a status
> across branches as a chronological promotion or demotion.

## 1. Challenge Discovery Pipeline

A multi-stage agent system observes public and distributed behavioral evidence,
forms a hypothesis about an actor’s target state transition, confirms a problem,
and generates and validates a solution.

- “Free exploration” fails; define observable evidence such as landing pages,
  CTAs, job listings, FAQs, and reviews. (`talk1`)
- Complete one vertical case instead of deploying three generic agents. (`talk4`)
- GPT proposes meaning hypotheses; code handles deduplication, scoring, and crawl
  control. Codex is for solution development rather than exploration. (`talk1`)

**Status: DEFER / narrow KEEP. Broad autonomous exploration is cut.**

## 2. 1000 → 20 Funnel

```text
5k–10k public pages
→ 1,000 state-transition hypotheses
→ 200 coarse-filtered
→ 50 further-observed
→ 20 late-stage matches
→ 5 human-confirmed
→ 3 discoveries
→ 1 completed solution
```

Unit: `actor × target × current state × target state`. The goal is not “1,000
good problems” but visibility into search-space bias and a 20-case downstream set.

**Status: KILL.** The talk3 branch explicitly removed 1,000-problem discovery
from the current core.

## 3. Externality / Just-in-Time SSoT

An organization is not one reality: local realities belonging to people,
departments, and tools collide at the moment of commitment, externalizing the
cost of alignment onto human memory and attention.

The product should not be a permanent SSoT. It should create canonical state
only immediately before a transaction is committed: a JIT-SSoT.

**Status: KEEP-VISION as theory / KILL as a generic SSoT product.**

## 4. Bottleneck migration and productivity heuristic

\[
\text{Productivity} \approx \frac{\text{Context} \times \text{LLM reasoning ability}}{\text{people}}
\]

This is a design heuristic, not a law.

> In the AI era, the bottleneck is not the number of workers but whether a team
> can preserve the right Context and complete decision and execution.

As generation gets cheaper, value moves from distributed Context to verifiable
Commitment.

**Status: KEEP-VISION. It is a design principle, not a product feature.**

## 5. Concept comparison (non-chronological)

| Concept | Core | Branch status |
|---|---|---|
| A: broad exploration | Public traces → problem discovery | Submission KILL in talk3 and the shared talk4/talk11 trunk; retain as vision |
| B: CommitLayer | Implicit protocol → Preflight | Strong in talk2, current submission KILL in talk3 and the shared trunk; branch order unknown |
| Promise Compiler | Explicit promise → acceptance test | Alternative candidate from talk3 |
| Meeting OS | Full meeting lifecycle | Independent talk6→talk7 design; universal implementation is narrowed elsewhere |
| Counterpoint | Private ↔ Shared ↔ Commit | Candidate in the related talk8/talk9/talk11 branches |
| Living Decisions | Decision object over time | Provisional talk11 candidate; final choice unresolved |

The retained core proposition is:

> As AI makes generation and implementation cheaper, the bottleneck moves to
> the place where distributed Context becomes verifiable Commitment.

## 6. Ethical and civilizational concern

Observation → intent inference → hidden problem discovery → solution generation
→ real-world change is a powerful civilizational capability, not automatically
 a good product. The issue is governance, not just model performance.

- “Do nothing” must remain a legitimate output.
- A three-minute hackathon video should translate civilizational language into
  concrete downstream costs.
- North star: AI should clarify what ought to move, what must not move, and who
  should participate in deciding—not merely move the world faster.

**Status: KEEP-VISION for the judgment core / KILL as the video’s civilizational pitch.**

## 7. Why people do not treat this as a problem

Memory, Slack search, predecessors, spreadsheets, meetings, and reconciliation
make the organization function “well enough,” so the issue does not become a
ticket. Sales and demos should connect to concrete losses: delayed adoption,
missed contract terms, duplicate billing, and similar outcomes—not just
“eliminating individual dependency.”

## 8. Repo-as-demo / Preflight format

A software repository is a vertical experiment environment for intent state,
distributed traces, hidden burden, intervention, and verification. There is not
enough time to build both a customer onboarding demo and a repo demo; fix one
format for submission.

**Status: DEFER. The verifiable vertical-demo pattern carries into Counterpoint
and Promise Compiler.**

## Build Week branch map

```text
A/B and exploration
├─ Concept A / 1000→20 ─── submission KILL; retain method and vision
├─ Concept B / CommitLayer ─ current submission KILL
└─ Promise Compiler ─────── alternative candidate from talk3

Meeting and decision
├─ Meeting State / Lifecycle OS
├─ Counterpoint ─────────── candidate in talk8/talk9/talk11 branches
└─ Living Decisions ─────── provisional talk11 candidate

Other talk11 candidates
├─ Misconception diagnosis + AI student
└─ Executable Falsifier
```

See [Rejected and deferred ideas](./21-rejected-deferred.md).

