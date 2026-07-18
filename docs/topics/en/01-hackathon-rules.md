# 01 — OpenAI Build Week Rules

Sources: mainly `talk4.md`, `talk11.md`, `talk5.md`, and `talk10.md`.

Labels: `[FAQ]` recorded as official in the conversation / `[conversation-time]`
an observation that may change / `[inference]` an interpretation / `[strategy]`
submission strategy / `[official re-check required]` must be checked against the
current source.

> Final decisions must always follow the Devpost Official Rules and FAQ. The
> relative timing of conversation branches is unknown; file number or branch
> depth must not be treated as chronology.

## Event overview

| Item | Recorded content | Type |
|---|---|---|
| Name | OpenAI Build Week | [FAQ] |
| Entry point | https://openai.devpost.com/ | [FAQ] |
| Core requirement | An app or developer tool built with **Codex + GPT-5.6** | [FAQ] |
| Total prizes | $100,000 across four categories | [FAQ] |
| Category prizes | $15,000 for first place / $10,000 for second place in each category | [FAQ] |
| First-place extras | Promotion, a Codex-team meeting, one year of Pro, and a DevDay-related pass; travel and lodging are self-funded | [FAQ] |
| Credits | Up to $100 in Codex credits was described as limited and approval-based. The recorded application deadline was July 18, 2026 04:00 JST, and `talk10` saw distribution marked closed | [FAQ] + [conversation-time] |

The recorded credit deadline has passed and availability must not be assumed.
Re-check the official page before budgeting.

### Recorded schedule

| Period | PT | JST conversion recorded in the conversation |
|---|---|---|
| Submission | 2026-07-13 09:00 – 07-21 17:00 | 07-14 01:00 – **07-22 09:00** |
| Submission deadline | 2026-07-21 17:00 PT | **Wednesday, 07-22 09:00** |
| Demo availability | Until 2026-08-05 17:00 PT | — |

## Four categories

| Category | Recorded definition |
|---|---|
| Apps for Your Life | Personal life, travel, health, finance, creativity, and similar uses |
| Work & Productivity | Business automation, sales, analysis, customer support, and team efficiency |
| Developer Tools | Testing, DevOps, security, and agent development |
| Education | Students, teachers, and educational institutions |

- One project belongs to one category; choose the closest category when several fit. [FAQ]
- Multiple genuinely different projects may be submitted. Repackaging the same project may be rejected. [FAQ]
- One project can win only one prize. [FAQ]

## Codex / GPT-5.6

| Requirement | Recorded interpretation | Type |
|---|---|---|
| Both required | “Build any project with Codex **and** GPT-5.6”; explain both in the README and video | [FAQ] |
| Existing project extension | `talk10` also recorded “Codex and/or GPT-5.6” in one passage. The safer interpretation is substantive use of both across the submitted project | [FAQ] + [inference] + [official re-check required] |
| No decorative use | Incidental or decorative use is insufficient | [FAQ] |
| Codex | Used during development; include the primary thread’s `/feedback` Session ID and explain its role | [FAQ] |
| Codex at runtime | Calling Codex from the finished product is not required | [FAQ] |
| GPT-5.6 | Integrate it into the project and explain its role in the video; development-only use is risky | [inference, about 90%] |

Weak uses include a Codex-only README or brainstorming session, a trivial
Codex edit, using GPT-5.6 only as an internal Codex model, or using it for naming
where removing it would not change the product’s value.

Recommended split:

```text
Codex        = build-time development agent
GPT-5.6      = runtime meaning judgment and integration feature
Normal code  = deterministic state, ACL, events, and confirmation
Human        = approval boundary
```

Runtime Codex is an optional upside, not the required line.

## Judging stages

1. Eligibility — submission, participation, IP, and tool requirements.
2. Stage 1 (pass/fail) — theme fit and reasonable use of the specified API/SDK.
3. Stage 2 — four equally weighted criteria:

| Criterion | What is evaluated |
|---|---|
| Technological Implementation | Depth and craft of Codex use, operation, and non-trivial implementation |
| Design | A complete, coherent product experience rather than a PoC |
| Potential Impact | A real problem, real audience, and a demo that solves it |
| Quality of the Idea | Creativity, novelty, and understanding of the problem space |

The recorded tie-break order is Tech → Design → Impact → Idea. The reading that
Tech explicitly asks about Codex depth, but has no independent GPT-5.6 score, is
an inference and requires official re-check. Judges are not required to run the
project themselves; text, images, and video may be the evidence. [FAQ]

## Existing projects

Existing projects may be used, but evaluation covers additions made after the
Submission Period began. Clearly distinguish old and new work using Codex logs,
commits, and the README. Copying old code into a new repository does not by
itself make a new project. [inference]

## Related documents

- [Submission checklist](./02-submission-checklist.md)
- [IP and licensing](./03-ip-and-license.md)
- [Competition and positioning](./04-competition-and-positioning.md)

