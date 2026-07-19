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

**Product decision on 2026-07-19:** Keep the repository private during
development, then make it public at submission to reduce judging-access
failures. Preserve the option to commercialize a substantially rebuilt product
later. Do not choose the project license yet. Before the visibility switch,
inventory direct and transitive dependencies and bundled media, identify
notice, redistribution, and source-disclosure obligations, then select either
a compatible project license or an All Rights Reserved distribution posture
that also satisfies the official submission requirements.

| Strategy | Recorded content | Type |
|---|---|---|
| During development | Start private with no license | Strategy |
| Public at submission | Switch to public to reduce judging-access failures; choose the license after the audit | Decision |
| Preserve commercialization | Keep private and share with judges by email; recorded interpretation, re-check required | FAQ interpretation + strategy |
| Hybrid | Keep the core proprietary; release an SDK, schema, or fixtures under Apache later | Strategy |
| Warning | Do not switch to public without an explicit license or rights-reservation posture | Strategy |
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
