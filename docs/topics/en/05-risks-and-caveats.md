# 05 — Risks, Caveats, and Failure Modes

Sources: `talk4.md`, `talk10.md`, `talk3.md`, `talk2.md`, and `talk9.md`.

> Do not mix time-dependent values, rule interpretations, and branch-level
> product decisions. Credits, registrant counts, category competition, and
> licensing must be updated from current official information or an explicit
> decision.

## Rules and submission failure modes

| Failure | Description |
|---|---|
| Evidence mismatch | README says “90% Codex” but the Session ID is a short consultation |
| Video as primary screening | “Try it and you’ll understand” is not enough |
| Demo availability expires | It works only on submission day; credits or free hosting stop |
| Imagined post-deadline edits | Changes are generally unavailable after the deadline |
| AI detects inconsistency | Explanation and code, or category and implementation, do not match |
| Thin existing-project extension | A polished appearance hides that little new work was made |
| Category misclassification | “It can also be used for education” is not enough for Education |
| Repackaged multiple submission | A duplicate project may be rejected |
| Overtrusting a plugin | Official Rules take priority |
| Conflict-of-interest project | Prior preferential support or ownership creates a risk |

## Technical and product failure modes

- GPT-5.6 reduced to CRUD plus a chat box, risking Stage 1 reasonable-use failure.
- Generic AI secretary, “chat with anything,” or giant platform positioning gets lost.
- JSON printed in a terminal alone is weak outside Developer Tools.
- A video shows ten features but has no single vertical flow.
- “Implicit knowledge discovery” cannot be judged by people outside the domain.
- Trying to prove the broad, high-risk exploration concept with scraping, causal
  claims, or rights problems before the deadline.
- Depending on Workspace Agents or other environment-specific behavior reduces reproducibility.
- Shrinking too far turns the product into a smart meeting plugin. (`talk8`)
- Promising a full “operating system” and submitting an unfinished one.

## Confidence-weighted interpretations

| Claim | Confidence | Type |
|---|---:|---|
| Codex + GPT-5.6 are both required | 98% | FAQ-like |
| Both should be substantively used | 95% | FAQ-like |
| GPT-5.6 should be a finished-product feature | 90% | **Inference** |
| Video is effectively the most important judging material | 90% | FAQ-like inference |
| Narrow complete product beats broad incomplete product | 85% | Strategy |
| A simple AI wrapper is unlikely to place highly | 90% | Strategy |
| Creating a repository before joining is not disqualifying | ~90% | Inference |
| Copying old code into a new repo is not new work | ~95% | Inference |

## Claims cut from the product concept

> Give up the form of the claim that cannot be externally verified—not the
> concept itself. (`talk3` / `talk11`)

Do not claim that the submission discovered implicit knowledge, understood an
organization’s true bottleneck, or benefited humanity in the abstract.

For Living Decisions, prove instead that a decision becomes a Commitment with
sources, assumptions, permissions, dissent, and execution/review conditions,
and that a later real-world change can move it into review.

## Short operational checklist

Save a Draft; submit only when complete. Keep core development in one primary
Codex session. Use self-created demo data. Check data rights and licenses. Keep
English materials aligned. Keep the demo available through August 5. Re-check
the Rules. Ask unclear questions in writing before the deadline.

## Related documents

- [Submission checklist](./02-submission-checklist.md)
- [IP and licensing](./03-ip-and-license.md)
- [Rejected and deferred ideas](./21-rejected-deferred.md)

