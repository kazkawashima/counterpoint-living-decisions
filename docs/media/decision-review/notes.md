# Human invalidation review reel notes

All captures use the explicitly labeled synthetic flagship story
`Work & Productivity — Global AI Product Rollout`. The regulation, Decision,
premise, Evidence, Action, facilitator reason, and reconsideration task are
fixtures. No real customer data, production credential, webhook, or regulation
appears in the material.

| State | Viewport | Suggested reel use |
|---|---|---|
| Facilitator review workbench | Desktop, 1440×900 | Establish the authority boundary: external event, affected premise, reviewed Evidence, affected Action, model, confidence, and reason appear together before any human disposition. |
| Required reason validation | Desktop, 1440×900 | Brief proof that neither confirmation nor rejection can be recorded without an explicit facilitator reason. |
| Human-confirmed `REVIEW_REQUIRED` | Desktop, 1440×900 | Hero frame. The red advisory settles into a human-confirmed review state, the affected Action is held, an open reconsideration task appears, and revision 2 remains immutable. |
| Human-rejected AI suggestion | Desktop, 1440×900 | Show the alternate human disposition: the reason is retained, no Action is held, no task is created, and the Decision returns to `MONITORING`. |
| Participant read-only review | Desktop, 1440×900 | Show that an assigned participant receives the same shared disposition, reason, hold, and task without facilitator controls. |
| Participant read-only review | Mobile, 390×844, reduced motion | Responsive and accessibility proof; status, text, borders, and hierarchy carry the meaning without motion. |
| Ordinary production manual fallback | External hosted desktop | Production judge mode rejects ordinary AI access with `JUDGE_MODE_FORBIDDEN`, while the exact private excerpt remains available through the manual path. |

The clip under `docs/media/clips/decision-review/` records the complete
facilitator path from `AT_RISK` through reason entry to
human-confirmed `REVIEW_REQUIRED`, including persistence after reload.

Useful narration:

> GPT-5.6 can identify a potentially invalid premise, but it cannot confirm the
> impact. The facilitator reviews the exact event and linked records, records a
> reason, and opens revision work. Only then does deterministic code hold the
> affected Action and create a reconsideration task. The committed revision is
> never rewritten.

The rejection path is also implemented and covered by application tests: it
records the facilitator reason, holds no Action, creates no task, and returns
the Decision to `MONITORING`.

The 2026-07-21 captures additionally show the preview-only staged demo rule
entering `AT_RISK` while managed provider access is disabled, followed by the
same human-confirmed `REVIEW_REQUIRED` path. The rule is synthetic, carries no
provider credential or usage reservation, and is disabled by the production
deploy configuration.

Original capture date: 2026-07-19; refreshed 2026-07-21. Feature slice:
D5 human invalidation review and Q2 accessible review-state completion.
