# 02 — Submission Checklist

Sources: mainly `talk4.md`, `talk10.md`, and `talk11.md`.

Labels: `[FAQ]` recorded as a required item / `[strategy]` a recommendation /
`[candidate-dependent]` changes when the final product candidate is chosen.

> Re-check requirements, deadlines, and sharing destinations against the
> current Devpost source immediately before submission.

## Required submission items recorded in the conversation

| # | Item | What judges need to see |
|---|---|---|
| 1 | Working project | It starts and behaves coherently |
| 2 | English project description | Problem, value, and technology |
| 3 | **Public YouTube video under three minutes** | It works and its value is immediately clear |
| 4 | GitHub or equivalent repository | GPT-5.6 integration and implementation depth |
| 5 | README | Reproduction, role split, and existing-vs-new work |
| 6 | Codex/GPT-5.6 usage explanation | Evidence of substantive use |
| 7 | **`/feedback` Session ID for core development** | Most core functionality was built in the main thread |
| 8 | Runnable demo / test instructions | Free, unrestricted access |

The video, code, README, and Session ID must tell the same story. [strategy]

## Video

| Requirement | Content |
|---|---|
| Public YouTube | Required |
| Length | Rules recorded “under three minutes” and FAQ “three minutes or less”; target 2:40–2:50 |
| Required content | Working demo, **spoken narration**, what was built, how Codex was used, and how GPT-5.6 was used |
| Music only | Not acceptable; AI narration is allowed |

Suggested structure:

| Time | Content |
|---|---|
| 0:00–0:20 | Who has what problem |
| 0:20–1:30 | Strongest single vertical flow |
| 1:30–2:05 | GPT-5.6 internal processing |
| 2:05–2:35 | Core Codex contribution |
| 2:35–2:50 | Result and differentiation |

For Living Decisions, the candidate demo is:

```text
Private context
→ Permissioned evidence
→ Shared decision
→ Explicit assumptions
→ External event
→ Assumption invalidated
→ Decision reopened
```

## Recommended README structure

1. Problem and target users
2. What the product does
3. Architecture
4. GPT-5.6 call sites, inputs, outputs, and post-processing
5. Work done by Codex
6. **Important human design decisions**
7. Setup, tests, and sample data
8. Known limitations
9. Existing work vs work created during the event
10. “Work completed during Build Week”

“Codex built everything” alone is a poor explanation because it hides human
judgment.

## `/feedback` Session ID

- Use the project thread where the majority of core functionality was built.
- Codex CLI is acceptable. Avoid scattering the core work over many one-off
  `codex exec` sessions; consolidate the main work in one thread.
- The Devpost Hackathons Plugin is optional. Official Rules take priority.

## Repository and demo availability

| Item | Recorded guidance |
|---|---|
| Public | Allowed when relevant licensing is provided |
| Private | The conversation recorded `testing@devpost.com` and `build-week-event@openai.com` as sharing destinations; re-check officially |
| Availability | Keep free, unrestricted access through the end of judging, recorded as **August 5, 17:00 PT** |
| Failure examples | Invitation required, credit card required, API cap, expired password, stopped hosting, local-only access, or empty data |

Recommended development sequence:

```text
Join → new repository → git tag build-week-baseline → Draft → primary Codex thread
```

### Judge credentials and API keys

**Why:** The rules are recorded as requiring free, unrestricted test access
through judging. Judges should not have to bring an API key. Conversely, public
judge credentials could be abused for API spend.

**What:** General users use BYOK; a judge-only user uses server-funded judge
mode; production keys are Cloudflare Worker Secrets; credentials do not appear
in the public README, video, or description.

**How:** Put credentials in Devpost `Testing Instructions` only after verifying
the logged-out submission view does not expose them. If privacy cannot be
confirmed, use an approved private sharing channel. Assume leakage and enforce
hard limits on account, IP, meeting, Realtime time, tokens, and daily spend.
Do not use the server-funded key for ordinary users. After judging, revoke the
credential and rotate the Secret.

## English and final checks

Nearly all submission material should be in English or have an English version:
README, primary UI, fixtures, errors, installation, narration, and subtitles.

Before final submission:

- [ ] Public YouTube video is audible and under the limit.
- [ ] Repository access and demo URL work from the intended judge path.
- [ ] Test credentials remain valid through the availability period.
- [ ] Judge user can complete the flagship flow without BYOK.
- [ ] Logged-out Testing Instructions do not expose credentials.
- [ ] Judge-mode spend limits and ordinary-user rejection work.
- [ ] Production keys are Cloudflare Secrets and absent from repo, vars, and logs.
- [ ] Submission commit is pushed and fixed with a Git tag.
- [ ] Session ID is the core development thread.
- [ ] README commands reproduce in a clean environment.
- [ ] English, category, and implementation match.
- [ ] Rules and updates are rechecked two days before and immediately before submission.
- [ ] Video contains no unlicensed third-party trademarks or copyrighted music.

## Related documents

- [Rules](./01-hackathon-rules.md)
- [IP and licensing](./03-ip-and-license.md)
- [MVP scope](./13-mvp-scope.md)

