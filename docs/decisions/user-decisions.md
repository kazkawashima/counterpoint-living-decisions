# User decisions to review

This file contains only choices that require product-owner judgment. Missing
external facts are kept in
[`external-rechecks.md`](./external-rechecks.md), and implementation details
that can be decided safely by the development agent are not listed here.

Implementation may proceed around these items, but the named gate must not be
crossed without a decision.

## UD-01 — Submission category

- **Status:** Decided on 2026-07-19.
- **Decision:** Submit the MVP to **Work & Productivity**.
- **Why:** The confirmed product serves team decision work; Education and
  Developer Tools correspond to alternative products that are no longer the
  implementation target. A future office/home/team-resident agent may span
  categories, but that broader evolution does not change the MVP category.
- **Answer:** Work & Productivity.

## UD-02 — Repository visibility and final license

- **Status:** Visibility decided; dependency/media inventory complete; final
  rights/notice review and project license pending.
- **Decision:** Make the repository public for submission to reduce judging
  access failures.
- **Commercial intent:** Preserve the option to commercialize a substantially
  revised product later.
- **License gate:** Before switching the repository to public, inventory direct
  and transitive dependencies plus bundled media, record their licenses and
  notices, identify redistribution/source-disclosure obligations, and then
  choose the project license or an All Rights Reserved distribution posture
  compatible with the official submission rules.
- **2026-07-20 preliminary inventory result:** Runtime package metadata uses
  only MIT or Apache-2.0 identifiers; reciprocal identifiers are confined to
  development tooling. This inventory does not replace review of authoritative
  package license/NOTICE files or the final distributable bundle.
  Current official submission guidance says a public repository should carry a
  relevant open-source license. The compatible public choices are therefore
  MIT or Apache-2.0; the rights-preserving alternative is to keep the
  repository private and share it with both official judging addresses.
- **Blocks:** Public visibility switch and final project-license declaration.
- **Does not block:** Development.
- **Answer:** Public at submission. Product owner must complete the final
  rights/notice review and choose MIT or Apache-2.0 before the visibility
  switch; until then the manifest remains `license: "UNLICENSED"`.

## UD-03 — Judge-mode spend envelope

- **Status:** Decided on 2026-07-19.
- **Decision:** Enforce an application-side hard cap of **USD 25 per rolling
  24-hour period** for judge mode.
- **Provider backstop:** The API-provider budget alert is currently **USD 50**.
  It is an alert, not the product's enforcement boundary.
- **Derived limits:** Set meeting, concurrent Realtime, Realtime-minute,
  generation, and token limits conservatively from measured flagship usage so
  their combined worst case cannot exceed the USD 25 application cap.
- **Why:** These limits determine the maximum financial exposure of leaked
  judge credentials.
- **Blocks:** Production judge-mode enablement until the hard cap and derived
  limits are implemented and tested.
- **Answer:** USD 25 per rolling 24 hours; USD 50 provider alert as secondary
  warning.

## UD-04 — Public-facing name clearance

- **Status:** Provisional decision.
- **Decision:** Continue using **Counterpoint** as the working name.
- **Final gate:** Lock the public name only after trademark/domain review.
- **Blocks:** Final logo lockup, domain purchase, video title card, and Devpost
  title.
- **Does not block:** Product implementation.
- **Answer:** Continue provisionally.

## UD-05 — Final submission message hierarchy

- **Status:** Open; current language is an unapproved placeholder.
- **Decision needed:** Approve or revise the descriptor and primary tagline.
- **Current working placeholders only:**
  - Descriptor: “The commitment layer for agent-native teams.”
  - Tagline: “Independent minds. Shared commitment.”
  - Hook: “Decisions should know when they are no longer true.”
- **Blocks:** Final landing copy, reel narration, README hero, and Devpost copy.
- **Does not block:** UI layout using replaceable copy tokens.
- **Answer:** Revise later; do not treat the current hierarchy as approved.

## UD-06 — Reel narrative treatment

- **Status:** Decided on 2026-07-19.
- **Decision:** Approve the visible “Later: regulation changed” transition,
  demo event injection, and clear human-review beat.
- **Required disclosure:** Narration or on-screen copy must explicitly identify
  the time jump and injected event as a staged demo story, not a claim of
  continuous real-world monitoring during the recording.
- **Answer:** Approved with explicit demo-story labeling.

## UD-07 — Judge credential delivery path

- **Status:** Pending preview inspection scheduled for 2026-07-20.
- **Decision needed:** Choose the non-public credential handoff after the actual
  Devpost submission preview is inspected.
- **Preferred order:** Private Testing Instructions if verified non-public;
  otherwise the officially approved private repository or organizer channel.
- **Blocks:** Final credential handoff.
- **Does not block:** Authentication or judge-account implementation.
- **Answer:** Expect Testing Instructions to work; product owner will verify the
  preview and logged-out view on 2026-07-20.

## How to answer

Edit each `Answer` line directly. A short value plus any constraint is enough.
Decisions can be closed independently.
