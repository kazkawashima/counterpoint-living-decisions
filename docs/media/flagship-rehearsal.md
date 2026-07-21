# Flagship reel rehearsal

This is a synthetic demo story. Every identity, meeting note, regulatory event,
Decision, Action, and review outcome shown in the reel is staged and contains
no real customer or workplace data.

## Target

Show the complete private-to-living-Decision value arc in no more than three
minutes. Reset the target demo meeting immediately before each take so event
positions, revision numbers, and visible cues are deterministic. The event is
the synthetic Flagship staged story; in the preview it is evaluated by the
provider-free `staged-demo-rule-v1`, not by a live production monitor.

| Time | Beat | Screen proof |
| --- | --- | --- |
| 0:00–0:20 | Facilitator opens the seeded Flagship | Product login, meeting reset, Context cue |
| 0:20–0:45 | Participant speaks into the private channel | Mic input or equivalent text command, durable private utterance |
| 0:45–1:05 | The private agent cue surfaces a hidden premise | `Hidden premise surfaced`, `Staged demo cue`, `nothing shared` |
| 1:05–1:40 | Evidence becomes a human commitment | Exact excerpt, permission, premise confirmation, explicit commit |
| 1:40–2:25 | Time changes the decision | Monitoring state, synthetic EU regulatory event, expected affected region |
| 2:25–2:45 | A staged rule advises; a human decides | `AT_RISK`, facilitator reason, `REVIEW_REQUIRED`, Action hold |
| 2:45–3:00 | The record remains inspectable | Reconsideration task, revision history, audit lineage, JSON export |

Total target: **3 minutes**, with the optional revision comparison omitted from
the first pass if time is tight.

## Verification log

- 2026-07-21: The external-host Preview Playwright path ran all three current
  browser cases in **43.8 seconds** against
  `counterpoint-living-decisions-preview.gs2safari.workers.dev`: provider-free
  staged review, same-origin SPA/manual fallback, and separate
  ordinary/judge/display contexts. This is an automated path-health result,
  not a substitute for timing a first-time human walkthrough.
- The human rehearsal remains targeted at three minutes and must still be performed
  from the checklist above before claiming the three-minute acceptance gate.

## Capture map

- `login-meeting/`: establish the five fixed synthetic identities and room.
- `permission-disclosure/`: private boundary, preview, and approval.
- `decision-commit/`: grounded synthesis through explicit commitment.
- `regulatory-event/`: staged event arrival and expected EU impact.
- `assumption-invalidation/`: AI advisory and `AT_RISK` pulse.
- `decision-review/`: human confirmation, Action hold, and task.
- `decision-resolution/`: before/after revision, history, and export.
- `guided-flagship/`: stage cues and meeting-scoped reset proof.

## Take checklist

1. Sign in as the Product facilitator; have the synthetic Legal participant use
   a second tab when available.
2. Reset only the staged flagship meeting and confirm the Context cue returns.
3. Use the fixed synthetic utterance and event; do not improvise real examples.
4. Show the private-agent cue and say aloud that it is staged/proposed and
   nothing has been shared.
5. Complete exact excerpt approval, human Decision commit, staged event, and
   facilitator review in that order.
6. Capture desktop motion plus mobile reduced-motion states.
7. End on revision history or JSON export, not on an unreviewed AI suggestion.
