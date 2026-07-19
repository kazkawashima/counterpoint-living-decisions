# AGENTS.md

## Project context

Counterpoint is being prepared for hackathon submission. The repository's
product and submission requirements live under [`docs/topics/`](docs/topics/),
with the Japanese documents as the source and [`docs/topics/en/`](docs/topics/en/)
as the English reference translation.

## Global development rules

### Network binding

This machine is accessed through Tailscale. Any development server must bind
to `0.0.0.0` so it can be reached from a mobile device over the network.

- Wrangler: use `--ip 0.0.0.0`
- Next.js: use `--hostname 0.0.0.0`
- Vite: use `--host 0.0.0.0`
- Other servers: use the equivalent option

When editing package scripts or server configuration, do not leave a
development server bound only to `127.0.0.1` or `localhost`.

### UI verification

Whenever the UI changes, add and run browser E2E coverage for the changed
behavior. Manual inspection alone is not sufficient. Include an external-IP
style access check where relevant, including CORS behavior and fetch URL host
resolution, not only `localhost` access.

### Visual evidence capture

The hackathon submission will eventually need an introduction reel, but reel
production is not part of the active product goal until the hosted product is
viewable and usable. Keep lightweight visual evidence as development hygiene so
later production does not require recreating important states:

- After every UI change, capture screenshots of the affected screen and the
  important states (initial, interaction, success, error, and responsive state
  when applicable).
- Save captures under `docs/media/screenshots/<feature>/` using a stable name
  such as `YYYY-MM-DD-<feature>-<state>.png`.
- Keep a short note with each capture describing the feature, state, viewport,
  and commit or change. Narration/cut-point notes are optional.
- Record other reel-worthy material when it appears: animation clips, loading
  transitions, decision/evidence state changes, before/after comparisons,
  interaction sequences, and notable mobile layouts. Store source material or
  capture instructions under `docs/media/` and keep generated exports separate
  from source captures.
- Do not include real secrets, private user data, API keys, or sensitive
  decision content in screenshots or recordings. Use clearly synthetic demo
  data.

### Motion and visual emphasis

For UI work, consider adding purposeful animated components and a small amount
of visually emphasized or exaggerated presentation where it improves the
storytelling of the product and the reel. Motion must remain understandable,
accessible, and subordinate to the decision-making flow; provide an appropriate
reduced-motion behavior.

## Change discipline

- Read the relevant canonical topic documents before changing product behavior.
- Keep secrets in local environment files or platform secrets; never commit
  `.env`, `.dev.vars`, API keys, credentials, or private user data.
- Update the relevant documentation and capture evidence alongside meaningful
  UI changes.
