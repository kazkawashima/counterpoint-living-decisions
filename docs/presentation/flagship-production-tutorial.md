# Descant Flagship production tutorial

This is the operator path used in the 2026-07-21 production walkthrough. It is
also a presentation script. It contains no password, API key, bearer token, or
private credential.

The reviewer-owned semantic check that continues through append-only revision
3, export, and reload persistence is documented separately in
[`production-reviewer-walkthrough.md`](../verification/production-reviewer-walkthrough.md).
This tutorial remains the three-minute presentation path.

## Start safely

- Production judge URL:
  <https://counterpoint-living-decisions-production.gs2safari.workers.dev>
- Do not use the legacy host
  <https://counterpoint-living-decisions.gs2safari.workers.dev>. It serves an
  older `Counterpoint` deployment and is not the judge-managed Production
  route.
- Preview/manual fallback URL:
  <https://counterpoint-living-decisions-preview.gs2safari.workers.dev>
- Use the private submission Testing Instructions for the judge credential.
  Never copy that credential into this document, README, video, screenshots,
  or public Devpost fields.
- The room is the synthetic `Global AI Product Rollout`
  Flagship. It is not a real meeting and contains no real personal data.

## Exact operator flow

1. Open the production URL.
2. Enter the private judge identity in the User ID field and sign in. The
   judge identity is not one of the public synthetic role buttons.
3. In the meeting list, choose **Open workspace** for the seeded Flagship.
   In the live-channel area, confirm that **Judge-managed access** and
   **Ready** are shown. If the page instead asks for **Facilitator BYOK**, the
   wrong identity or legacy host is being used; do not paste a key, return to
   the Production URL above and sign in as `judge`.
4. In the Private area, review **Staged private note**. Nothing is shared by
   viewing it.
5. Choose **Prepare grounded sharing preview**. The server-funded judge route
   proposes one grounded exact excerpt.
6. Read **Outgoing preview** and confirm that it says **AI suggestion · owner
   only**. Choose **Approve exact excerpt** only after checking the range.
7. In **Candidate workbench**, review the title, outcome, premise, retained
   dissent, bounded Action, and monitor condition. Choose **Confirm edited
   premise**.
8. Choose **Save Decision draft**, then **Validate and mark ready**.
9. Choose **Commit Decision**. Stop briefly on **Human committed** and the
   revision history.
10. Choose **Start Decision monitor**. The resulting **Monitoring active**
    state means the monitor registration exists; it is not a claim that time
    has passed in the real world.
11. Choose **Inject staged regulatory event**. The screen explicitly labels
    this as a synthetic demo story and describes the time jump.
12. When `AT_RISK · AI suggestion` appears, read the affected premise and
    Action. Enter a short facilitator reason, for example:
    `The staged regulatory event changes the approval-gate premise and requires human reconsideration.`
13. Choose **Confirm impact and open review**. This is the human authority
    boundary; AI does not move the Decision directly to the final review
    state.
14. Stop on `REVIEW_REQUIRED`, the held Action, and the reconsideration task.
15. Choose **Prepare Decision JSON export** to show that the durable history,
    audit entries, revisions, and current state remain exportable.

## Three-minute presentation version

| Time      | Screen beat                            | Narration cue                                                                                |
| --------- | -------------------------------------- | -------------------------------------------------------------------------------------------- |
| 0:00–0:20 | Login → seeded Flagship                | “Descant keeps each person’s context private until permission is explicit.”                  |
| 0:20–0:45 | Private note → grounded preview        | “The server-funded agent suggests an exact excerpt, but it cannot publish it.”               |
| 0:45–1:10 | Outgoing preview → Approve             | “Only this range crosses the boundary, after human approval.”                                |
| 1:10–1:45 | Candidate → confirm → ready → commit   | “GPT-5.6 proposes structure; the facilitator confirms the premise and commits the Decision.” |
| 1:45–2:10 | Monitoring active → staged event       | “Later, a clearly staged regulatory change tests whether the Decision is still true.”        |
| 2:10–2:40 | `AT_RISK` → reason → `REVIEW_REQUIRED` | “AI raises an advisory; only human review holds the Action and opens reconsideration.”       |
| 2:40–3:00 | History/audit → JSON export            | “The result is a durable, inspectable record—not a chat transcript.”                         |

## Boundary statements to say aloud

- “This is a synthetic staged demo story; the injected event is not continuous
  real-world monitoring.”
- “The model suggests and evaluates; the facilitator approves, commits, and
  confirms review.”
- “The judge uses server-funded AI; no BYOK key is entered into the browser.”
- “Private source text remains private except for the exact approved excerpt.”
- “If AI is unavailable, the manual excerpt and Decision path remain usable.”

## Recovery path

If `Private assistant is temporarily unavailable` appears, choose **Continue
with manual excerpt**, then continue with the exact excerpt, human Decision
draft, validation, commit, staged event, review, and export. In the production
ordinary-user boundary, the same guarded condition may instead read `This
action is unavailable in judge mode`; the manual excerpt button remains the
intended recovery and no judge credential is exposed. If a prior take left the
Flagship in a later state, use **Reset staged demo** from the facilitator
workspace and restart from step 4.

## Evidence and presentation hygiene

- Use synthetic data only.
- Capture screenshots only after removing browser profiles, secrets, and
  unrelated personal UI.
- For a projector, open the read-only shared display in a separate window and
  use the full-viewport layout; it is a projection surface, not a control
  surface.
- The current production walkthrough is recorded in
  `docs/deployments/production-2026-07-21.md`; the UI feedback response is in
  `docs/plans/ui-feedback-2026-07-21.md`.
