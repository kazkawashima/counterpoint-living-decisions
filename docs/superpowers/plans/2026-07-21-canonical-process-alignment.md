# Canonical Process Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore native superpowers discovery and align the implementation-facing specifications and release plan with the verified production state.

**Architecture:** Keep historical topic documents and internal identifiers unchanged. Repair only the global skill-discovery symlink, current canonical specifications, current release checklist, and current implementation status; no runtime or hosted configuration changes are included.

**Tech Stack:** Markdown, POSIX symbolic links, Git, repository verification scripts.

---

### Task 1: Record the pre-change drift

**Files:**

- Read: `AGENTS.md`
- Read: `docs/specs/README.md`
- Read: `docs/specs/00-product-scope-and-experience.md`
- Read: `docs/specs/02-identity-permissions-and-security.md`
- Read: `docs/specs/04-system-architecture-and-data.md`
- Read: `docs/plans/06-quality-deployment-and-submission.md`
- Read: `docs/plans/impl/_status.md`

- [x] **Step 1: Confirm the stale discovery target**

Run:

```bash
readlink /home/lion/.agents/skills/superpowers
```

Expected: the link points to the absent `2611465e` cache while the installed
`d6169bef/skills` directory exists.

- [x] **Step 2: Confirm current-document drift**

Run:

```bash
rg -n "Counterpoint|one active managed call|Close UD-05|Ensure the demonstrated commit is pushed" docs/specs docs/plans/06-quality-deployment-and-submission.md
```

Expected: current canonical and checklist text still contains the superseded
name, concurrency guard, and incomplete decisions.

### Task 2: Restore superpowers discovery

**Files:**

- Modify: `/home/lion/.agents/skills/superpowers` symbolic link

- [x] **Step 1: Point discovery at the installed skill package**

Run:

```bash
ln -sfn /home/lion/.codex/plugins/cache/openai-curated/superpowers/d6169bef/skills /home/lion/.agents/skills/superpowers
```

- [x] **Step 2: Verify the resolved target and required skills**

Run:

```bash
test -f /home/lion/.agents/skills/superpowers/using-superpowers/SKILL.md
test -f /home/lion/.agents/skills/superpowers/verification-before-completion/SKILL.md
```

Expected: both checks exit successfully.

### Task 3: Align canonical and release documents

**Files:**

- Modify: `docs/specs/README.md`
- Modify: `docs/specs/00-product-scope-and-experience.md`
- Modify: `docs/specs/02-identity-permissions-and-security.md`
- Modify: `docs/specs/04-system-architecture-and-data.md`
- Modify: `goal.txt`
- Modify: `docs/plans/05-cloudflare-judge-mode-and-security.md`
- Modify: `docs/plans/06-quality-deployment-and-submission.md`
- Modify: `docs/plans/impl/_status.md`

- [x] **Step 1: Apply the current public product name**

Set the current implementation-facing product name and prose to
`Descant — Living Decisions`; retain `Counterpoint` only where the text
explicitly describes the historical working name or internal identifiers.

- [x] **Step 2: Apply the cost-only judge admission contract**

Distinguish the cost-only D1 start-admission policy from the live controller's
remaining 30-second and three-response envelope. Keep authentication,
ownership, idempotency, settlement, and lifecycle cleanup as integrity
controls, and record cost-metered in-call termination as the next implementation
requirement instead of claiming complete cost-only runtime behavior.

- [x] **Step 3: Update only factually closed release-plan items**

Mark UD-05/UD-06 closure and the pushed demonstrated implementation as done.
Keep the three-minute rehearsal, hosted C5, repository visibility, release tag,
video, and final submission items open.

- [x] **Step 4: Record the process-alignment slice in current status**

Append the exact repaired discovery target, canonical changes, verification,
and remaining product gates to `docs/plans/impl/_status.md`.

The verification pass found a material implementation distinction: D1 start
admission is cost-only, but the live call controller still enforces a fixed
30-second and three-response envelope. This plan records that open runtime gap
instead of converting an inaccurate completion claim into canonical text.

### Task 4: Verify and publish the slice

**Files:**

- Verify: all modified Markdown files
- Verify: repository generated-output and secret boundary

- [x] **Step 1: Verify current assertions**

Run exact-name, admission-policy, controller-envelope, symlink-target, and
release-checklist searches. The current canonical surfaces must use Descant,
must not retain a one-active-call admission guard, and must keep the fixed
in-call envelope visibly open rather than reporting full cost-only completion.

- [x] **Step 2: Verify formatting and secrets**

Run:

```bash
npx prettier --check goal.txt docs/specs/README.md docs/specs/00-product-scope-and-experience.md docs/specs/02-identity-permissions-and-security.md docs/specs/04-system-architecture-and-data.md docs/plans/05-cloudflare-judge-mode-and-security.md docs/plans/06-quality-deployment-and-submission.md docs/plans/impl/_status.md docs/superpowers/plans/2026-07-21-canonical-process-alignment.md
npm run security:secrets
git diff --check
```

Expected: every command exits successfully without printing a secret.

- [x] **Step 3: Commit and push**

Commit only the plan and aligned repository documents. Preserve the untracked
owner files under `.vscode/` and `docs/reviews/`, then push `main` to `origin`.
