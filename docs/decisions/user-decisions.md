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

- **Status:** Decided on 2026-07-21; Apache-2.0 selected and release inventory
  recorded.
- **Decision:** Make the repository public for submission to reduce judging
  access failures.
- **Commercial intent:** Preserve the option to commercialize a substantially
  revised product later.
- **License gate:** Direct/transitive dependencies and bundled media were
  inventoried; redistribution, notice, and Apache-2.0 obligations are recorded
  in `docs/submission-license-audit.md`.
- **2026-07-20 preliminary inventory result:** Runtime package metadata uses
  only MIT or Apache-2.0 identifiers; reciprocal identifiers are confined to
  development tooling. This inventory does not replace review of authoritative
  package license/NOTICE files or the final distributable bundle.
  Current official submission guidance says a public repository should carry a
  relevant open-source license. The compatible public choices are therefore
  MIT or Apache-2.0; the rights-preserving alternative is to keep the
  repository private and share it with both official judging addresses.
- **Blocks:** Public visibility switch and the final pre-submit rules/access
  recheck, not the project-license choice.
- **Does not block:** Development.
- **Answer:** Public at submission with Apache-2.0. Keep the repository private
  until the final public-safety and official-rules recheck immediately before
  the visibility switch.

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

- **Status:** Decided on 2026-07-21.
- **Decision:** Use **Descant — Living Decisions** as the public-facing product
  name. Keep `counterpoint-living-decisions` and other internal identifiers
  unchanged; historical topic filenames and source-history references may retain
  the former working title.
- **Final gate:** Review the final logo/domain and submission copy before public
  visibility, without changing the product name back.
- **Blocks:** Final logo lockup, domain purchase, video title card, and Devpost
  title.
- **Does not block:** Product implementation.
- **Answer:** Descant — Living Decisions.

## UD-05 — Final submission message hierarchy

- **Status:** Decided on 2026-07-21; the owner confirmed the current Devpost
  message hierarchy.
- **Approved descriptor, tagline, and hook:**
  - Descriptor: “The commitment layer for agent-native teams.”
  - Tagline: “Independent minds. Shared commitment.”
  - Hook: “Decisions should know when they are no longer true.”
- **Blocks:** None for the current submission copy; preserve the same boundary
  across landing, README, reel, and Devpost.
- **Does not block:** UI layout using replaceable copy tokens.
- **Answer:** Use the approved descriptor, tagline, and hook above.

## UD-06 — Reel narrative treatment

- **Status:** Decided on 2026-07-19.
- **Decision:** Approve the visible “Later: regulation changed” transition,
  demo event injection, and clear human-review beat.
- **Required disclosure:** Narration or on-screen copy must explicitly identify
  the time jump and injected event as a staged demo story, not a claim of
  continuous real-world monitoring during the recording.
- **Answer:** Approved with explicit demo-story labeling.

## UD-07 — Judge credential delivery path

- **Status:** Decided on 2026-07-21; the owner confirmed the non-public
  submission handoff and its visibility boundary.
- **Preferred order:** Private Testing Instructions if verified non-public;
  otherwise the officially approved private repository or organizer channel.
- **Blocks:** None for the credential handoff; keep credentials out of every
  public artifact and recheck after any Devpost edit.
- **Does not block:** Authentication or judge-account implementation.
- **Answer:** Use the verified private Testing Instructions path; never put the
  judge credential in README, video, repository, screenshots, or public fields.

## How to answer

Edit each `Answer` line directly. A short value plus any constraint is enough.
Decisions can be closed independently.
