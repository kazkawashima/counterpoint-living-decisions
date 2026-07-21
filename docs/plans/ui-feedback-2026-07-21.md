# UI feedback response plan — 2026-07-21

Source: `docs/思うところつらうら/意見追加.md` and the production Flagship
walkthrough. The source note remains an owner-provided review artifact; this
plan records the implementation response without rewriting that note.

## Decisions

### 1. Shared display projector canvas — implement now

The shared display was constrained by `max-width: 90rem`, which wastes the
outer area on a 4K monitor or projector. The display hero, evidence grid, and
footer now use the full available viewport width with responsive gutters. The
large type hierarchy remains intact, and the existing mobile single-column
fallback remains unchanged.

Evidence:

- `tests/e2e/shared-display.spec.ts` checks the 2560px layout and captures a
  projector-sized synthetic state.
- Private source text, owner identity, controls, and display-token revocation
  behavior remain covered by the existing shared-display assertions.

### 2. Dense upper workspace — defer a broad redesign

The top rail, realtime controls, private assistant, and shared-room controls
serve different boundaries and should not be collapsed into one generic
toolbar. The next safe change is a guided “start here” layer that highlights
only the current Flagship action; it must not hide the permission boundary or
make disabled controls look available.

### 3. Input versus read-only affordance — design next

The feedback correctly identifies that cards, textareas, and status panels have
similar rectangular geometry. The next UI slice should use a stronger input
surface, a read-only surface, and a required-action state with distinct border,
label, and focus treatment. It should be limited to the Flagship path first.

### 4. Contrast and 125–150% zoom — verify, then tune

Do not solve this by enlarging every label. Audit muted text and minimum target
size at 100%, 125%, 150%, desktop, mobile, and reduced-motion settings. Keep
the large `Product workspace` and `Commitment canvas` headings as anchors while
raising only low-contrast helper copy and action labels that affect task
discovery.

### 5. Model choice — operator-only, not a judge-facing selector

The production path currently uses the `gpt-5.6` alias, which routes to
`gpt-5.6-sol`. OpenAI also documents `gpt-5.6-terra` and `gpt-5.6-luna` for
lower-cost workloads. Exposing a model dropdown to judges would make cost,
quality, audit, and cap evidence ambiguous. Keep the judge route fixed for the
submission; if testing needs Luna, add a guarded operator configuration and
record the selected model in content-free usage metadata before using it.

## Priority order after submission-critical gates

1. Guided Flagship action layer and clear required-action highlighting.
2. Input/read-only visual grammar and muted-text contrast audit.
3. Operator-only model configuration with a fixed allowlist and cost profile.
4. General-room polish and broader responsive restructuring.

## Non-goals for this slice

- Do not expose provider keys or model selection in the browser.
- Do not make the shared display interactive or reveal private workspace state.
- Do not claim that the staged regulatory event is live monitoring.
- Do not redesign the entire dashboard before the submission path is secured.
