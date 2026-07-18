# User decisions to review

This file contains only choices that require product-owner judgment. Missing
external facts are kept in
[`external-rechecks.md`](./external-rechecks.md), and implementation details
that can be decided safely by the development agent are not listed here.

Implementation may proceed around these items, but the named gate must not be
crossed without a decision.

## UD-01 — Submission category

- **Decision needed:** Submit Counterpoint to **Work & Productivity**, or choose
  another category.
- **Current recommendation:** Work & Productivity.
- **Why:** The confirmed product serves team decision work; Education and
  Developer Tools correspond to alternative products that are no longer the
  implementation target.
- **Blocks:** Devpost final submission copy and category-specific positioning.
- **Does not block:** Product implementation.
- **Answer:** Pending.

## UD-02 — Repository visibility and final license

- **Decision needed:** Keep the repository private for judging, or make the
  submission commit public; if public, choose a license.
- **Current default:** Private, All Rights Reserved, as confirmed in topic `14`.
- **Trade-off:** Private protects commercialization but requires verified judge
  access. Public reduces repository-access friction but makes the submitted
  expression available under the selected terms.
- **Blocks:** Final repository sharing and submission tag procedure.
- **Does not block:** Development.
- **Answer:** Pending.

## UD-03 — Judge-mode spend envelope

- **Decision needed:** Maximum daily spend and the derived limits for meetings,
  concurrent Realtime sessions, Realtime minutes, generations, and tokens.
- **Current recommendation:** Set the currency cap first; derive all technical
  limits conservatively from measured flagship usage.
- **Why:** These limits determine the maximum financial exposure of leaked
  judge credentials.
- **Blocks:** Production judge-mode enablement.
- **Does not block:** Limit framework implementation with placeholder config.
- **Answer:** Pending.

## UD-04 — Public-facing name clearance

- **Decision needed:** Keep **Counterpoint** after trademark/domain review, or
  select a replacement public name.
- **Current default:** Continue using Counterpoint internally and in working
  assets.
- **Blocks:** Final logo lockup, domain purchase, video title card, and Devpost
  title.
- **Does not block:** Product implementation.
- **Answer:** Pending.

## UD-05 — Final submission message hierarchy

- **Decision needed:** Approve or revise the descriptor and primary tagline.
- **Current recommendation:**
  - Descriptor: “The commitment layer for agent-native teams.”
  - Tagline: “Independent minds. Shared commitment.”
  - Hook: “Decisions should know when they are no longer true.”
- **Blocks:** Final landing copy, reel narration, README hero, and Devpost copy.
- **Does not block:** UI layout using replaceable copy tokens.
- **Answer:** Pending.

## UD-06 — Reel narrative treatment

- **Decision needed:** Approve the final treatment for the time jump between
  Commitment and the regulatory-change event.
- **Current recommendation:** A visible “Later: regulation changed” transition,
  then the demo event injection, followed by a clear human-review beat.
- **Blocks:** Final storyboard and recording.
- **Does not block:** Capture of development screenshots and clips.
- **Answer:** Pending.

## UD-07 — Judge credential delivery path

- **Decision needed:** Choose the non-public credential handoff after the actual
  Devpost submission preview is inspected.
- **Preferred order:** Private Testing Instructions if verified non-public;
  otherwise the officially approved private repository or organizer channel.
- **Blocks:** Final credential handoff.
- **Does not block:** Authentication or judge-account implementation.
- **Answer:** Pending until external verification.

## How to answer

Edit each `Answer` line directly. A short value plus any constraint is enough.
Decisions can be closed independently.
