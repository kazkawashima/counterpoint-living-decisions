# Submission license audit

Updated: 2026-07-21

This is an engineering inventory, not legal advice. The owner selected
Apache-2.0 for the submitted project on 2026-07-21.

The current [OpenAI Build Week Official Rules](https://openai.devpost.com/rules)
require a public repository to have relevant licensing, or a private repository
to be shared with `testing@devpost.com` and `build-week-event@openai.com`.
Re-check the live Devpost page immediately before changing visibility.

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
tracked separately in `docs/media/ASSET_MANIFEST.json`. They are marked
`Apache-2.0` after the owner selected the project release policy.

## Release decision

The owner selected **Apache-2.0** for the submitted source and first-party
synthetic media. `LICENSE` and root package metadata now match, and the media
manifest marks first-party captures as `Apache-2.0`. Apache-2.0's NOTICE,
copyright-retention, modification-notice, and trademark limitations apply.

The 286-entry dependency inventory remains authoritative for third-party
notices: development-only MPL/LGPL-identified tooling is not redistributed as
runtime application code, and `THIRD_PARTY_NOTICES.md` remains checked in for
package attribution. Re-run `npm run licenses:check`, `npm run security:secrets`,
and the submission access check immediately before public visibility.
