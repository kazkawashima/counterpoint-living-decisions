# 03 — IP, Copyright, and Licensing Strategy

Sources: `talk5.md`, `talk10.md`, `talk11.md`, and `talk4.md`.

> **Official re-check required:** This is not legal advice or the official
> rules. Verify ownership, license scope, publicity permissions, and private
> sharing destinations against the rules at submission time.

## Ownership

The conversation records that there is no copyright assignment to OpenAI, that
IP remains with the individual/team/organization that developed it, and that
OpenAI receives a non-exclusive license for judging rather than ownership.
These are recorded FAQ interpretations and require official re-check.

The practical risk is less “our rights are taken” than “we cannot guarantee
that we exclusively own everything we submit.”

## Do not bring

Unlicensed datasets, prohibited scraping, customer data, internal code, another
person’s previous project, templates with unclear licenses, copyrighted music,
unlicensed logos or trademarks, faces, voices, personal information, employer-
owned inventions, unresolved jointly developed work, or outsourced code whose
copyright was not assigned.

## Public vs private / license choice

| Strategy | Recorded content | Type |
|---|---|---|
| During development | Start private with no license | Strategy |
| Public at submission | May reduce judge-access friction; Apache-2.0 was proposed because of its explicit patent terms | Strategy, not a rule |
| Preserve commercialization | Keep private and share with judges by email; recorded interpretation, re-check required | FAQ interpretation + strategy |
| Hybrid | Keep the core proprietary; release an SDK, schema, or fixtures under Apache later | Strategy |
| Warning | Avoid a public repository with no license | Strategy |
| After Apache | A license already granted cannot simply be taken back into exclusivity | General principle |

The implementation requirements currently say to remain private and All Rights
Reserved for now; a final license decision is separate from this preparation
step.

## Baseline evidence

```bash
git tag build-week-baseline
git push origin build-week-baseline
```

Combine the tag with the GitHub creation date, commit history, Codex session,
and a `BUILD_WEEK_LOG.md` that identifies pre-existing material. A tag alone is
not complete proof. Fix the final submission commit with a tag as well.

## Ideas vs expression

Copyright primarily covers expressive works such as code, writing, and images.
Ideas, functional concepts, and business models are generally different from
that protected expression. Imitation risk after a public demo is separate from
assignment terms. Consider patent questions before public disclosure.

## Demo data

Respect the terms of third-party SDKs, APIs, and data. Avoid filling the demo
with real companies’ pages or marks. Prefer fictional landing pages, your own
site, permissioned sites, or anonymized samples; do not design around indiscriminate
crawling.

## Related documents

- [Submission checklist](./02-submission-checklist.md)
- [Risks and caveats](./05-risks-and-caveats.md)

