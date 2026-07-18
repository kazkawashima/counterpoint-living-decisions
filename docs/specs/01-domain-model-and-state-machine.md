# Domain model and state-machine specification

## Canonical state model

The domain uses the five-layer model:

\[
S_t = (L_t, K_t, P_t, O_t, V_t)
\]

| Layer | Responsibility |
|---|---|
| Ledger | Immutable ordered domain and audit events |
| Deliberation graph | Propositions, stances, premises, evidence, options, and relations |
| Process state | Meeting phase, readiness, active speaker lease, review workflow |
| Outcome state | Decisions, dissent, Actions, tasks, revisions |
| Views | Owner-private, shared participant, facilitator, and display projections |

The append-only event stream is canonical. Projections are disposable and
rebuildable from events.

## Core distinctions

The implementation MUST preserve:

```text
Utterance ≠ Proposition ≠ Stance ≠ Premise ≠ Evidence
```

An AI-inferred premise is not a participant utterance. Multiple participants
attach separate Stances to one Proposition. Support count is metadata, not an
evaluation score.

## Common record fields

Every domain record has:

- `id`
- `meetingId`
- `createdAt`
- `createdBy`
- `visibility`: `private | shared`
- `origin`: `human_utterance | human_input | source_artifact | ai_inference | system`
- `confirmationStatus`: `not_applicable | proposed | confirmed | rejected`
- `revision`

Private records additionally require `ownerParticipantId`. Shared records MUST
NOT retain inaccessible private text merely because their projection hides it.

## Entity set

| Entity | Required MVP fields |
|---|---|
| Meeting | purpose, phase, facilitator, participant assignments, display-token state |
| Participant | user, role, permissions, active state |
| SourceArtifact | owner/scope, type, storage reference, hash, size, processing state |
| Utterance | participant, channel, text, capture time, idempotency key |
| Proposition | normalized statement, source references |
| Stance | participant, proposition, position, origin |
| Question | prompt, resolution status |
| Claim | statement, source references |
| Premise | statement, dependency scope, confirmation status, monitor condition |
| Evidence | exact snippet, source and range, disclosure audit reference |
| Option | label, description, state |
| Criterion | name, description |
| Constraint | statement, source |
| Risk | statement, probability/impact only when explicitly supplied |
| Evaluation | option, criterion, assessment, origin |
| Decision | title, outcome, status, active revision, monitor condition |
| Dissent | participant, reason, retained status |
| Action | owner, scope, status, affected premise |
| Intervention | suggestion, audience, origin, disposition |
| ExternalEvent | type, payload hash, source, received time, signature result |
| DecisionRevision | decision, version, snapshot references, change reason |
| ReconsiderationTask | decision, trigger, owner, state |

The application may defer entities not displayed or transitioned by the
flagship, but the protocol MUST leave room for the full set without changing
existing meanings.

## Relations

The minimum relation vocabulary is:

- `supports`
- `contradicts`
- `assumes`
- `answers`
- `depends_on`
- `satisfies`
- `violates`
- `implements`
- `derived_from`
- `affects`

Relations are typed records with source and origin metadata. They are not raw
free-form graph edges.

## Decision lifecycle

```text
DRAFT
→ DECISION_READY
→ COMMITTED
→ MONITORING
→ AT_RISK
→ REVIEW_REQUIRED
→ COMMITTED | SUPERSEDED | REJECTED
```

| Transition | Required authority and condition |
|---|---|
| `DRAFT → DECISION_READY` | Facilitator; required outcome, premise, evidence, Action fields pass validation |
| `DECISION_READY → COMMITTED` | Facilitator explicit commit |
| `COMMITTED → MONITORING` | System after monitor registration succeeds |
| `MONITORING → AT_RISK` | System records a GPT-5.6 invalidation suggestion with references |
| `AT_RISK → REVIEW_REQUIRED` | Facilitator confirms after reviewing assumption, evidence, and affected Actions |
| `AT_RISK → MONITORING` | Facilitator rejects suggestion with reason |
| `REVIEW_REQUIRED → COMMITTED` | Facilitator commits a new revision |
| `REVIEW_REQUIRED → SUPERSEDED` | Facilitator replaces the Decision |
| `REVIEW_REQUIRED → REJECTED` | Facilitator closes without recommit |

GPT-5.6 MUST NOT directly produce `REVIEW_REQUIRED`.

## Required event families

### Meeting and identity

- `MeetingCreated`
- `ParticipantAssigned`
- `ParticipantJoined`
- `MeetingEnded`
- `DisplayTokenIssued`
- `DisplayTokenRevoked`

### Sources and speech

- `ArtifactRegistered`
- `ArtifactProcessed`
- `UtteranceCaptured`
- `SharedFloorAcquired`
- `SharedFloorReleased`

### Private disclosure

- `DisclosureProposed`
- `DisclosurePreviewed`
- `DisclosureApproved`
- `DisclosureRejected`
- `EvidenceShared`

### Deliberation and commitment

- `InferenceSuggested`
- `InferenceConfirmed`
- `InferenceRejected`
- `DecisionDrafted`
- `DecisionMarkedReady`
- `DecisionCommitted`
- `MonitoringStarted`

### Living Decision

- `ExternalEventReceived`
- `AssumptionInvalidationSuggested`
- `DecisionMarkedAtRisk`
- `FacilitatorReviewed`
- `DecisionReviewRequired`
- `ActionHeld`
- `ReconsiderationTaskCreated`
- `DecisionRevisionCommitted`
- `DecisionSuperseded`
- `DecisionRejected`

### Operations

- `DemoResetRequested`
- `DemoResetCompleted`
- `ApiKeyLeaseUpdated`
- `ApiKeyLeaseExpired`

Event names and payloads become protocol contracts. Renaming requires an
explicit migration.

## Event envelope

Every event contains:

- `eventId`
- `eventType`
- `schemaVersion`
- `meetingId`
- `actor`
- `occurredAt`
- `correlationId`
- `causationId`
- `idempotencyKey` when initiated externally
- `visibility`
- typed `payload`

Private payloads use a separate owner scope and MUST never be copied into a
shared event.

## Reducer invariants

1. Reducers are deterministic and perform no I/O.
2. Event order is explicit per meeting.
3. Replaying the same ordered stream yields the same projection.
4. Duplicate idempotency keys do not produce duplicate effects.
5. Invalid transitions fail before append.
6. Revisions append; they never mutate historical snapshots.
7. Reset is a meeting-scoped operation that restores a known seed through a
   controlled reset workflow, never through broad data deletion.
8. A shared projection is constructible without loading private payloads.

## Required projections

- Meeting list by user.
- Participant-private workspace by meeting and owner.
- Shared meeting state.
- Facilitator control state.
- Decision detail and history.
- Audit timeline.
- Usage/limit state for the current meeting.
- Guided-demo progress.

## Domain acceptance

Unit tests MUST prove all lifecycle transitions, invalid transition rejection,
event replay determinism, owner isolation, disclosure promotion, Action hold
selection, revision generation, and meeting-scoped reset behavior.
