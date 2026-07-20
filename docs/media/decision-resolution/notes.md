# Decision review resolution reel notes

All captures use the explicitly labeled synthetic flagship story
`Work & Productivity — Global AI Product Rollout`. The Decision, regulation,
revision text, participant identities, audit trail, and export are fixtures.
No real customer data, credential, webhook, or regulation appears in the
material.

| State | Viewport | Suggested reel use |
|---|---|---|
| Resolution options | Desktop, 1440×900 | Show the three facilitator-only exits from `REVIEW_REQUIRED`: commit a revised Decision, replace it, or close it without replacement. |
| Before/after comparison | Desktop, 1440×900 | Hold on immutable revision 2 beside proposed revision 3 while title, outcome, monitor condition, and change reason remain editable. |
| Recommit success and history | Desktop, 1440×900 | Hero frame: revision 3 becomes active, revisions 1–3 remain visible, `DecisionRevisionCommitted` joins the audit trail, and JSON export reports three revisions. |
| Participant recommitted state | Desktop, 1440×900 | Prove that an assigned participant sees the new current state and originating review context without resolution controls. |
| Participant terminal state | Mobile, 390×844, reduced motion | Responsive and accessibility proof for the same shared state without motion dependence. |

The clip under `docs/media/clips/decision-resolution/` records the transition
from human-confirmed `REVIEW_REQUIRED` through the field-level comparison to a
new explicit committed revision and persisted reload.

Useful narration:

> Review never rewrites the old Decision. The facilitator compares the active
> committed revision with a bounded proposal, records why it changed, and
> explicitly commits revision three. The ledger keeps every revision and audit
> event, and an authorized JSON export carries both the current state and its
> history.

Supersede and Decision rejection are implemented as separate facilitator-only
terminal commands and covered by application contract tests. The current
domain has no release/completion event for the D5 Action hold or
reconsideration task, so D6 truthfully preserves them instead of implying they
were automatically closed.

Original capture date: 2026-07-19; refreshed 2026-07-20. Feature slice: D6 Decision review resolution.
