# Submission license audit

Updated: 2026-07-21

This is an engineering inventory, not legal advice. The project license remains
unselected until the owner confirms the public-release policy.

## Current evidence

`npm run licenses:check` passes and `THIRD_PARTY_NOTICES.md` is generated from
the pinned `package-lock.json`. The current inventory contains 286 package
entries:

- Runtime direct: 7 MIT, 2 Apache-2.0, and 2 dual MIT OR Apache-2.0 entries.
- Runtime transitive: 1 MIT entry.
- Development-only: MPL-2.0, LGPL-3.0-or-later, and combined
  Apache-2.0/LGPL/MIT entries are present, along with permissive licenses.

No copyleft-identified package is currently classified as a runtime dependency
by the repository's inventory script. This is a classification signal, not a
substitute for reviewing each package's authoritative LICENSE and NOTICE file.

Bundled screenshots and clips are first-party synthetic captures and are
tracked separately in `docs/media/ASSET_MANIFEST.json`. They currently retain
`LicenseRef-Descant-Pending` until the project release policy is chosen.

## Release decision still required

The recorded product intent is commercial reuse after a possible future
rewrite, while the hackathon repository is intended to become public at
submission. The practical candidates are:

1. MIT for the submitted source: simplest commercial-compatible permission,
   with copyright and license notice retention.
2. Apache-2.0 for the submitted source: commercial-compatible permission with
   an express patent grant and additional notice/marking obligations.
3. All Rights Reserved / another owner-approved distribution posture only if
   the official submission rules explicitly permit a public repository without
   an OSS license.

Before switching repository visibility, confirm one choice, add the matching
`LICENSE`, update the root package metadata, resolve media rights, and rerun
`npm run licenses:check`, `npm run security:secrets`, and the submission access
check. Do not infer that dependency permissiveness chooses the project's own
license.
