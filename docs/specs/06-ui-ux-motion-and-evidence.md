# UI, UX, motion, and reel-evidence specification

## Experience direction

The interface should feel like a live decision instrument, not a dashboard with
a chat sidebar. The visual hierarchy centers the transformation:

```text
private signal → permission → shared evidence → commitment → risk → review
```

English is the primary submission UI language. Copy should stay short enough to
remain legible in a three-minute reel.

## Global UI grammar

Every relevant item visibly identifies:

- scope: `Private` or `Shared`
- origin: `Human`, `Source`, `AI inferred`, or `System`
- confirmation: `Proposed`, `Human confirmed`, or `Rejected`
- lifecycle state when applicable
- source/provenance affordance

Color may reinforce these states but never be the only signal. Icons, text, and
shape provide redundant distinction.

## Screen contracts

### Login and meeting list

- Fixed synthetic identities.
- Clear judge/general mode behavior without exposing credentials or key source.
- Assigned meetings appear immediately after login.
- Meeting-code path remains secondary.
- Session expiry and re-login preserve durable meeting state.

### Participant private workspace

- Owner identity and `Private` boundary remain persistent.
- Private sources and shared meeting state are visually separated.
- `Speak privately` and `Speak to room` are explicit controls.
- Text fallback is always visible.
- Disclosure candidate shows source, exact snippet, editable range, full
  outgoing preview, and approve/reject controls.
- Nothing implies that viewing a suggestion has shared it.

### Facilitator dashboard

- Participant/presence and shared-floor state.
- Decision-readiness gaps and AI suggestions with origin labels.
- Draft fields for outcome, premises, dissent, Actions, and monitor condition.
- Explicit commit confirmation.
- External demo event control labeled as event injection, not automatic truth.
- At-risk review surface with evidence, affected Actions, confirm/reject, and
  reason capture.
- Meeting-scoped reset with clear target confirmation.

### Shared decision screen

- Read-only.
- Current question, options, shared evidence, premises, dissent, Decision, and
  Actions.
- No private-existence hints or owner-private metadata.
- Large-screen legibility and a responsive mobile view.
- Revoked/expired token state does not leak previous content after refresh.

### Decision history and audit

- Timeline from source/utterance through inference/confirmation and commitment.
- Revision comparison without erasing earlier states.
- Event origin and actor.
- `AT_RISK` and `REVIEW_REQUIRED` shown as separate moments.
- JSON export access for authorized users.

### Guided demo

- One flagship template.
- A concise stage indicator that does not allow forbidden transitions.
- Synthetic role cards and source materials.
- Reset returns only that meeting to the initial seed.

## Key visual moments

These moments SHOULD receive purposeful emphasis because they communicate the
product in the reel:

1. A private evidence card approaches but does not cross the permission
   boundary.
2. Owner approval transforms only the selected snippet into a shared evidence
   card.
3. A Decision assembles from evidence, premise, dissent, and Action.
4. Commit creates a stable revision marker.
5. A later external event creates a visible risk pulse.
6. Affected premise and Actions connect visually.
7. Human confirmation moves the Decision from `AT_RISK` to
   `REVIEW_REQUIRED`.
8. Revision history opens rather than overwriting the old Decision.

The reel MUST label the time jump and injected regulatory event as a staged
demo story. The visual must not imply that continuous live monitoring elapsed
during the recording.

Motion is explanatory. It must not imply that private content crossed the
boundary before approval or that AI made the human decision.

## Motion and accessibility

- Prefer transform/opacity motion with bounded duration.
- Avoid continuous decorative animation around sensitive states.
- Focus order, keyboard operation, labels, and live-region announcements are
  required for core controls.
- Minimum contrast and target-size standards apply.
- `prefers-reduced-motion` replaces movement with immediate state change or
  simple fades.
- Risk animation never relies on flashing.
- Loading, empty, success, error, offline, and limit-reached states are designed
  explicitly.

## Responsive and external access

- Core participant and facilitator flows work on current desktop and mobile
  viewport sizes.
- Shared display prioritizes desktop/projector but retains a readable mobile
  fallback.
- No client API URL is hard-coded to `localhost`.
- Development servers bind to `0.0.0.0`.
- Browser E2E includes an external-IP-style hostname path and checks CORS/fetch
  host behavior.

## Evidence capture contract

Every UI change includes:

1. Browser E2E for changed behavior.
2. Screenshots of affected important states.
3. Reel notes with feature, state, viewport, commit/change, and narration or cut
   suggestion.
4. A short clip when motion or state transition is materially better shown in
   time.

Storage:

```text
docs/media/
  screenshots/<feature>/YYYY-MM-DD-<feature>-<state>.png
  clips/<feature>/YYYY-MM-DD-<feature>-<transition>.*
  <feature>/notes.md
```

Minimum capture matrix for a UI feature:

- initial/empty
- primary interaction
- success
- relevant error or degraded state
- desktop
- mobile when the layout changes
- reduced-motion state for motion-heavy features

All captures use synthetic data. Secrets, credentials, private real-world
content, browser extensions, and unrelated personal UI are excluded.

## UI acceptance

The UI passes when a first-time viewer can distinguish private/shared,
fact/inference/confirmation, and `AT_RISK`/`REVIEW_REQUIRED` without narration;
all flagship controls work by keyboard; reduced motion preserves meaning; and
the committed E2E and evidence set covers every implemented state.
