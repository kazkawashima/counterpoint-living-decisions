# Product, scope, and experience specification

## Product contract

**Name:** Counterpoint — Living Decisions for Agent-Native Teams

**Category descriptor:** The commitment layer for agent-native teams.

**MVP submission category:** Work & Productivity. A later office/home/team-
resident agent may span categories, but that does not change this submission.

**One-sentence contract:**

> Counterpoint connects participant-owned private context to shared decision
> state only through explicit permission, turns deliberation into an auditable
> Commitment, and makes that Decision reviewable when a dependent assumption
> no longer holds.

The product proves traceability, permission, and responsiveness. It does not
claim that AI makes the final judgment correct.

## Primary user and problem

The primary user is a facilitator running a 3–8 person decision meeting where
the evidence needed for a responsible decision is split across participants and
cannot be shared wholesale.

The hackathon problem is not meeting transcription. It is the loss of
permission, provenance, assumptions, dissent, and review conditions between a
conversation and the actions that follow.

## Roles

| Role | Required capabilities |
|---|---|
| Facilitator | Create meeting, assign users, configure meeting AI access, review AI suggestions, commit Decisions, inject demo event, reset own demo |
| Participant | Add private material, speak/type privately or to the room, review and approve exact evidence disclosures |
| Shared display | Read only the meeting's shared projection using a revocable display token |
| Judge user | Complete the flagship without supplying an API key, within hard usage limits |

The facilitator may also be a participant. The shared display is a capability,
not a person.

## Required screen surfaces

1. Login.
2. Available meetings and meeting-code fallback.
3. Facilitator dashboard.
4. Participant private workspace.
5. Shared decision screen.
6. Decision history and audit view.
7. Guided flagship demo and meeting-scoped reset.

These may share layout and components, but each role must receive a
capability-appropriate view.

## Flagship scenario

The only must-ship scenario is **Global AI Product Rollout**.

Roles represented by synthetic users:

- Product / Facilitator
- Safety
- Legal
- Engineering
- Enterprise Sales

The minimum recorded demonstration may use three active users while seed data
represents all five perspectives.

Required journey:

```text
Login
→ assigned meeting
→ private context visible only to its owner
→ explicit Speak to room / Speak privately choice
→ private agent proposes a relevant counter-evidence snippet
→ owner previews, edits, and approves the exact disclosure
→ shared state shows source, origin, and confirmation status
→ facilitator commits a Decision with assumptions, dissent, and Actions
→ signed regulatory-change event arrives
→ GPT-5.6 suggests an assumption invalidation
→ Decision becomes AT_RISK
→ facilitator reviews the evidence
→ facilitator confirms REVIEW_REQUIRED
→ only affected regional Actions are held
→ reconsideration task and revision history are visible
```

The demo event button MUST call the same application path as the signed
webhook. It MUST NOT skip the human confirmation step.

## Experience invariants

1. The private/shared channel choice is explicit before capture and remains
   fixed for that utterance.
2. Private content never appears in shared APIs, events, models, screens, or
   another participant's agent before owner approval.
3. Every visible assertion identifies whether it is a recorded fact, AI
   inference, or human-confirmed information.
4. A Decision always exposes its evidence, assumptions, dissent, Actions,
   monitor condition, and revision.
5. AI proposes; authorized humans confirm and commit.
6. Reopening creates history. It never erases the earlier Decision.
7. Text input can complete the same business flow when audio or OpenAI
   Realtime is unavailable.

## MVP boundaries

### MUST

- One decision-meeting vertical slice across before, during, and after.
- Fixed demo users and meeting assignment.
- Private/Shared/Commitment separation.
- Text input and shared/private voice input.
- Owner-approved evidence disclosure.
- Fact/inference/confirmation distinction.
- Decision commit and append-only revision history.
- One signed webhook monitor plus demo injection.
- `AT_RISK` followed by human-confirmed `REVIEW_REQUIRED`.
- Held Action and reconsideration task.
- Docker Compose local path and Cloudflare hosted path.
- Judge mode with bounded server-funded AI access.
- English primary UI copy.

### SHOULD

- Three-user one-browser multi-tab demo.
- Real multi-device participation through the same APIs.
- Guided progress cues for the flagship.
- JSON export and complete audit view.
- Purposeful motion that clarifies state transitions.

### MAY, only after all MUST gates

- Quickstart Go/No-Go seed fixture.
- Meta-demo seed fixture using entirely fictional assets.
- Additional visual polish and optional presentation modes.

### OUT

- Human-to-human audio conferencing.
- OAuth, self-registration, password recovery, billing.
- Production multi-tenancy or high-availability SLA.
- AI final decisions, AI auto-speaking, autonomous negotiation.
- Sentiment analysis and fully automatic diarization.
- Automatic private disclosure.
- Multiple or continuous monitor adapters.
- Organization-wide SSoT or full Meeting Lifecycle OS.
- Runtime Codex as a requirement.
- Broad challenge discovery, scraping, or tacit-knowledge claims.

## Product language

Preferred:

- “Independent minds. Shared commitment.”
- “When everyone has an agent, the room needs a protocol.”
- “Meeting AI records the room. Counterpoint changes what the room can decide.”
- “Decisions should know when they are no longer true.”

Avoid presenting the MVP as an OS, a meeting recorder, an AI executive, or a
system that guarantees correct decisions.

## Product-level acceptance

The product contract passes only when a new judge can understand and complete
the complete flagship arc in roughly three minutes, the UI visibly preserves
the experience invariants, and the app behavior matches the video, README, and
test instructions.
