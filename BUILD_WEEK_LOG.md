# Build Week provenance

## Work completed during Build Week

**Work completed during Build Week.** The Git history records application code,
tests, browser UI, Node/Compose runtime, Cloudflare Worker/D1/R2/Durable Object
adapters, OpenAI adapters, deployment controls, and submission-oriented
documentation added beginning 2026-07-17. Final eligibility review still
requires the product owner to confirm that no source was copied from a
pre-existing repository.

The Git history is the authoritative implementation record. Important
boundaries include:

| Commit    | Evidence boundary                                                  |
| --------- | ------------------------------------------------------------------ |
| `a1b9a9a` | Empty repository baseline with a one-line README                   |
| `da2e69a` | Imported and organized product/submission topic material           |
| `4bc99c1` | Normalized specifications and ordered implementation plans         |
| `b927e55` | First application workspace scaffold                               |
| `842f983` | Deterministic domain foundation                                    |
| `2eecbd7` | First local flagship UI/runtime slice                              |
| `a9d6209` | First grounded OpenAI disclosure adapter                           |
| `6938c2e` | First Cloudflare preview scaffold                                  |
| `9189fdf` | Cloudflare application adapter parity                              |
| `be0fdbc` | Durable judge structured-AI billing closeout and clean-checkout CI |

Later commits continue the same Build Week implementation history. The final
submission commit and tag are intentionally not recorded until the hosted demo,
reel, repository visibility, and Devpost surfaces are fixed together.

## Pre-existing material boundary

The ideas and discussion summarized under `docs/topics/` predate or originate
outside the application implementation history. Some topic documents describe
evolving an earlier “Meeting Runtime Kernel.” Those documents are requirements
and provenance references; they are not proof that an earlier codebase is part
of this repository.

The initial commit contains no application source. The repository history shows
the implementation beginning with the workspace scaffold above. Before final
submission, the project owner must explicitly confirm whether any source was
copied from another repository. If so, this record and the public submission
must identify that code and its license instead of describing it as new work.

## Tool roles

- Codex was the build-time development agent used to analyze the source
  material, design the architecture, implement and review slices, write tests,
  diagnose failures, and prepare deployment/submission controls.
- GPT-5.6 is a runtime product integration for grounded private disclosure,
  shared Decision synthesis, and assumption-invalidation suggestions.
- Humans remain responsible for product decisions, disclosure approval,
  Decision commitment, invalidation confirmation, release approval, and the
  final submission.

The primary Codex `/feedback` Session ID remains a final submission-time field;
it must be copied from the actual primary development thread and must not be
invented here.
