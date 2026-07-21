# Plan 06 — Quality, deployment, and submission

## Goal

Turn the working hosted flagship into a reproducible hackathon submission whose
app, repository, README, reel, Codex evidence, and Devpost copy agree.

## Inputs

- [Testing/submission specification](../specs/08-testing-acceptance-and-submission.md)
- [UI/evidence specification](../specs/06-ui-ux-motion-and-evidence.md)
- [User decisions](../decisions/user-decisions.md)
- [External rechecks](../decisions/external-rechecks.md)
- Plan 05 exit gate

## Execution order

Product visibility is the current prerequisite. Do not begin Q3 reel-asset
completion or Q5 reel production until the hosted flagship is demonstrably
viewable and usable through the judge path. UI-change screenshots remain
lightweight verification evidence in the meantime.

## Work packages

### Q1 — Full verification

- [x] Run format, lint, typecheck, unit, contract, integration, security, and
      complete E2E suites.
- [x] Run fresh Compose start and persistent restart.
- [x] Run Cloudflare preview smoke and the explicitly approved production
      judge/Flagship smoke.
- [x] Run desktop, mobile, reduced-motion, and external-host browser matrix.
- [x] Map direct proof to AC-01 through AC-19.
- [x] Record known limitations; do not disguise failing gates.

### Q2 — Accessibility and product polish

- [x] Keyboard and focus audit of all flagship controls.
- [x] Contrast, labels, target size, live-region, and reduced-motion audit.
- [x] Empty/loading/success/error/offline/degraded/limit states.
- [x] Remove placeholder copy and any unsupported product claims.
- [x] Confirm English primary UI and synthetic data consistency.

### Q3 — Reel asset completion

- [ ] Audit `docs/media/` against the required capture matrix.
- [ ] Capture missing initial/interaction/success/error/mobile/reduced-motion
      states.
- [ ] Record concise clips for disclosure, commit, risk, review, and history.
- [x] Create asset manifest with creator/license for any non-code media.
- [ ] Scan frames for credentials, secrets, private data, third-party marks, and
      unrelated personal UI.

### Q4 — README and Build Week evidence

- [x] Explain problem, user, product, flagship, and architecture.
- [x] Document GPT-5.6 call sites, inputs, outputs, post-processing, prompt/model
      versions, and human confirmation.
- [x] Explain Codex contribution and important human design decisions.
- [x] Provide clean setup, tests, sample users without public judge credential,
      known limitations, and degraded mode.
- [x] Generate direct/transitive dependency license inventory and
      third-party notices, including bundled media and generated assets.
- [x] Resolve copyleft, source-disclosure, attribution, and redistribution
      obligations before recommending the project license; Apache-2.0 is now
      selected and recorded in `LICENSE` and the release audit.
- [ ] Distinguish pre-existing topic references from greenfield Build Week code.
- [x] Add “Work completed during Build Week.”
- [ ] Identify the primary `/feedback` Session ID at final submission time.

### Q5 — Reel production

- [ ] Close UD-05; apply the approved UD-06 demo-story treatment.
- [ ] Lock a sub-three-minute storyboard after ER-01 verifies the exact limit.
- [ ] Use one flagship: problem → disclosure → commitment → time jump/event →
      review → implementation evidence.
- [ ] Explicitly label the time jump and injected event as a staged demo story.
- [ ] Include spoken English narration and optional subtitles.
- [ ] Explain substantive GPT-5.6 and Codex roles.
- [ ] Export and watch the exact public upload end to end.
- [ ] Verify video visibility, audio, captions, duration, and rights.

### Q6 — Devpost submission

- [ ] Use the decided Work & Productivity category from UD-01.
- [x] Complete the remaining license portion of UD-02 after ER-11; Apache-2.0
      is selected. Make the repository public only at the separate final gate.
- [ ] Finalize UD-04 after ER-10 and UD-07 after ER-07.
- [ ] Complete ER-01, ER-02, ER-07, ER-08, ER-10, and ER-11.
- [ ] Prepare English title, description, category, repository, demo URL,
      testing instructions, video, and Session ID.
- [ ] Verify repository and hosted access from logged-out/incognito paths.
- [ ] Verify Testing Instructions visibility before placing any credential.
- [ ] Confirm judge credential works and is financially bounded.
- [ ] Save Draft, review preview, then final submit.

### Q7 — Release fixation and judging operations

- [ ] Ensure the demonstrated commit is pushed.
- [ ] Create and push the submission tag.
- [ ] Record tag, deployment version, video URL, and submission timestamp.
- [ ] Keep health/usage checks and credential valid through the verified judging
      end.
- [ ] Avoid behavior-changing deploys after final submission unless rules allow
      and a critical repair is necessary.
- [ ] Revoke judge credential and rotate/delete Secret after judging.

## Final stop conditions

Do not submit while any of the following is true:

- any AC gate lacks direct proof
- clean README setup fails
- app/reel/README show different behavior
- private data or a secret appears in any public artifact
- judge user needs BYOK
- ordinary user can use judge mode
- spend cap has not been chosen and enforced
- `AT_RISK` and `REVIEW_REQUIRED` are conflated
- repository/demo/video access is not verified
- required user decision or official recheck remains open

## Exit gate

The exact tagged commit passes all tests and deployment smokes; a fresh judge
can complete the flagship within the reel narrative; every public and private
submission surface is verified; and post-submission availability and secret
shutdown runbooks are active.

## Suggested commit boundaries

1. Quality/accessibility/evidence closeout.
2. README and submission documentation.
3. Final submission fix only if needed before the release tag.
