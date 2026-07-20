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

## Expected safety boundaries

- `Private` material is not shared until its owner approves the exact excerpt.
- `Staged demo rule` is explicitly labeled and is not a claim of live AI
  monitoring in the preview.
- A human facilitator, not the model, confirms impact and holds the Action.
- Ordinary users cannot use judge-managed routes, and a read-only display
  receives only the shared projection.
- If managed AI is unavailable, the manual text and Decision path remains
  usable; no judge credential or provider key should be entered in the browser.

## Operator checklist before submission

- [ ] Insert the judge credential only into the private submission field, if
      required.
- [ ] Log out and inspect the submission preview/gallery to confirm it is not
      publicly visible.
- [ ] Verify the hosted URL, credential, and manual Flagship path from a clean
      browser.
- [ ] Do not paste credentials into this file, README, video description,
      screenshots, issue, commit message, or public Devpost fields.
