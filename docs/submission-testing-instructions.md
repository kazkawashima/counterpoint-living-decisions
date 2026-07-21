# Descant — Living Decisions: testing instructions

This page is safe to keep in the public repository. It intentionally contains
no password, bearer token, API key, Cloudflare credential, or provider Secret.
If a judge credential is required, provide it only through the private Testing
Instructions field of the submission after confirming that the field is not
visible in the logged-out submission/gallery view.

## Demo

- URL: <https://counterpoint-living-decisions-preview.gs2safari.workers.dev>
- Category: Work & Productivity
- Story: synthetic Flagship, `Work & Productivity — Global AI Product Rollout`
- Data: all meeting notes, identities, evidence, events, and decisions are
  fictional staged fixtures.
- Access: no BYOK or local setup should be required for a judge; use the
  private credential handoff supplied with the submission if the hosted login
  asks for one.

## One path through the product

1. On the logged-out landing screen choose `Product`.
2. Open the seeded `Work & Productivity — Global AI Product Rollout` meeting.
   No room creation or participant setup is needed.
3. Keep the owner-private note private, then choose `Prepare grounded sharing
preview`, inspect the exact excerpt, and approve it.
4. Select the manual fallback if the optional assistant is unavailable. Create
   the human-authored Decision, validate it, commit it, and start monitoring.
5. Choose `Inject staged regulatory event`. This is a synthetic time-jump/event
   story, not continuous monitoring of a real regulation.
6. Review the `AT_RISK` suggestion. Enter a facilitator reason and choose
   `Confirm impact and open review`.
7. Verify `REVIEW_REQUIRED`, the held Action, and the reconsideration task.
   Reload once to confirm the record, history, audit, and JSON export remain
   available.

## Three-minute guided rehearsal

Use two browser tabs when a second person is available: the facilitator is
`Product`, and the participant is the synthetic `Legal` role. This is a smooth
minimum path, not a claim that the preview is a live conferencing product.

1. **0:00–0:20 — open:** the facilitator signs in, opens the seeded Flagship,
   and resets it if a previous take left state behind.
2. **0:20–0:45 — speak privately:** the participant uses the microphone in the
   `Private` channel when configured. If Preview voice is unavailable, enter the
   equivalent text command; it writes to the same durable private utterance
   path. Say: “The launch depends on a documented approval gate; keep fallback
   ownership private until staffing review.”
3. **0:45–1:05 — surface the premise:** the private zone shows `Hidden premise
surfaced`, `Staged demo cue`, and `nothing shared`. This cue is a provider-free
   staged demo aid, not an AI inference and not a disclosure.
4. **1:05–1:40 — commit together:** the facilitator selects the exact excerpt,
   uses the manual fallback if needed, approves it, confirms the premise, saves,
   validates, and commits the Decision.
5. **1:40–2:25 — show change:** start monitoring, inject the clearly labeled
   staged regulatory event, then review `AT_RISK` and have the facilitator
   confirm impact. The event is a synthetic time jump, not continuous live
   monitoring.
6. **2:25–3:00 — prove the record:** show `REVIEW_REQUIRED`, Action hold, and
   reconsideration task, then open history, audit, or JSON export. Stop on the
   human-reviewed record.

## Expected safety boundaries

- `Private` material is not shared until its owner approves the exact excerpt.
- `Staged demo rule` is explicitly labeled and is not a claim of live AI
  monitoring in the preview.
- A human facilitator, not the model, confirms impact and holds the Action.
- Ordinary users cannot use judge-managed routes, and a read-only display
  receives only the shared projection.
- If managed AI is unavailable, the manual text and Decision path remains
  usable; no judge credential or provider key should be entered in the browser.
- The private-agent cue is deliberately marked `Proposed only`; it never moves
  private source text into Shared evidence.

## Operator checklist before submission

- [ ] Insert the judge credential only into the private submission field, if
      required.
- [ ] Log out and inspect the submission preview/gallery to confirm it is not
      publicly visible.
- [ ] Verify the hosted URL, credential, and manual Flagship path from a clean
      browser.
- [ ] Do not paste credentials into this file, README, video description,
      screenshots, issue, commit message, or public Devpost fields.
