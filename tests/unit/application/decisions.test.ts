import { describe, expect, it } from "vitest";

import {
  commitDecision,
  markDecisionReady,
  saveDecisionDraft,
  startDecisionMonitoring,
  type DecisionDependencies,
  type DecisionDraftFields,
} from "../../../packages/application/src/index.js";
import { userAuthorizationContext } from "../../../packages/application/src/sessions.js";
import {
  actionId,
  artifactId,
  auditReferenceId,
  correlationId,
  createAction,
  createDissent,
  createEvidence,
  createPremise,
  dissentId,
  eventId,
  evidenceId,
  meetingId,
  meetingPosition,
  nonEmptyText,
  participantId,
  premiseId,
  revisionNumber,
  schemaVersion,
  suggestionId,
  textRange,
  timestamp,
  type DomainEvent,
  type DomainEventPayloads,
  type MeetingProjection,
  type SharedEventEnvelope,
  type SharedEventType,
} from "../../../packages/domain/src/index.js";
import {
  MutableClock,
  SequenceIdGenerator,
} from "../../helpers/application-adapters.js";
import {
  InMemoryEventStore,
  InMemoryProjectionStore,
} from "../../helpers/in-memory-ports.js";

const MEETING_ID = "meeting-decisions";
const OTHER_MEETING_ID = "meeting-other";
const FACILITATOR_ID = "participant-facilitator";
const PARTICIPANT_ID = "participant-operations";
const PREMISE_ID = "premise-rollout";
const EVIDENCE_ID = "evidence-rollout";
const DISSENT_ID = "dissent-rollout";
const ACTION_ID = "action-rollout";
const NOW = timestamp("2026-07-19T05:06:07.000Z");

const completeReadiness = {
  actionIds: true,
  evidenceIds: true,
  monitorCondition: true,
  outcome: true,
  premiseIds: true,
} as const;

function stableFixtureHash(value: string): string {
  let hash = 2_166_136_261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return `fixture-${(hash >>> 0).toString(16)}`;
}

function dependencies(): DecisionDependencies {
  return {
    clock: new MutableClock(NOW),
    events: new InMemoryEventStore<DomainEvent>(),
    hash: stableFixtureHash,
    ids: new SequenceIdGenerator(),
    projections: new InMemoryProjectionStore<MeetingProjection>(),
  };
}

function facilitatorContext(meetingScope = MEETING_ID) {
  return userAuthorizationContext({
    meetingId: meetingScope,
    participantId: FACILITATOR_ID,
    role: "facilitator",
    sessionId: "session-facilitator",
    userId: "user-facilitator",
  });
}

function participantContext(meetingScope = MEETING_ID) {
  return userAuthorizationContext({
    meetingId: meetingScope,
    participantId: PARTICIPANT_ID,
    role: "participant",
    sessionId: "session-participant",
    userId: "user-participant",
  });
}

function draftFields(
  overrides: Partial<DecisionDraftFields> = {},
): DecisionDraftFields {
  return {
    actionIds: [ACTION_ID],
    dissentIds: [DISSENT_ID],
    evidenceIds: [EVIDENCE_ID],
    monitorCondition: {
      description: "Monitor rollout safety signals",
    },
    outcome: "Proceed with a reversible regional rollout",
    premiseIds: [PREMISE_ID],
    title: "Conditional rollout",
    ...overrides,
  };
}

function sharedEvent<Type extends SharedEventType>(
  eventType: Type,
  position: number,
  payload: DomainEventPayloads[Type],
): SharedEventEnvelope<Type> {
  return {
    actor: { kind: "system" },
    correlationId: correlationId(`seed-correlation-${String(position)}`),
    eventId: eventId(`seed-event-${String(position)}`),
    eventType,
    meetingId: meetingId(MEETING_ID),
    occurredAt: NOW,
    payload,
    position: meetingPosition(position),
    schemaVersion: schemaVersion(1),
    visibility: "shared",
  };
}

async function seedSharedReferences(deps: DecisionDependencies): Promise<void> {
  const premise = createPremise({
    confirmationStatus: "confirmed",
    createdAt: NOW,
    createdBy: participantId(FACILITATOR_ID),
    dependencyScope: [nonEmptyText("regional-rollout")],
    id: premiseId(PREMISE_ID),
    meetingId: meetingId(MEETING_ID),
    origin: "human_input",
    revision: revisionNumber(1),
    statement: nonEmptyText("Rollback remains available"),
    visibility: "shared",
  });
  const evidence = createEvidence({
    confirmationStatus: "confirmed",
    createdAt: NOW,
    createdBy: participantId(FACILITATOR_ID),
    disclosureAuditReferenceId: auditReferenceId("audit-rollout"),
    exactSnippet: nonEmptyText("Synthetic evidence supports staged rollout."),
    id: evidenceId(EVIDENCE_ID),
    meetingId: meetingId(MEETING_ID),
    origin: "source_artifact",
    revision: revisionNumber(1),
    sourceArtifactId: artifactId("artifact-rollout"),
    sourceRange: textRange(0, 10),
    visibility: "shared",
  });
  const dissent = createDissent({
    confirmationStatus: "confirmed",
    createdAt: NOW,
    createdBy: participantId(PARTICIPANT_ID),
    id: dissentId(DISSENT_ID),
    meetingId: meetingId(MEETING_ID),
    origin: "human_input",
    participantId: participantId(PARTICIPANT_ID),
    reason: nonEmptyText("Retain a manual rollback gate"),
    retained: true,
    revision: revisionNumber(1),
    visibility: "shared",
  });
  const action = createAction({
    affectedPremiseIds: [premise.id],
    confirmationStatus: "confirmed",
    createdAt: NOW,
    createdBy: participantId(FACILITATOR_ID),
    id: actionId(ACTION_ID),
    meetingId: meetingId(MEETING_ID),
    origin: "human_input",
    ownerParticipantId: participantId(PARTICIPANT_ID),
    revision: revisionNumber(1),
    scope: [nonEmptyText("regional-rollout")],
    status: "planned",
    visibility: "shared",
  });
  const events: readonly DomainEvent[] = [
    sharedEvent("EvidenceShared", 1, { evidence }),
    sharedEvent("InferenceConfirmed", 2, {
      confirmedBy: participantId(FACILITATOR_ID),
      result: { entity: premise, kind: "premise" },
      suggestionId: suggestionId("suggestion-premise"),
    }),
    sharedEvent("InferenceConfirmed", 3, {
      confirmedBy: participantId(FACILITATOR_ID),
      result: { entity: dissent, kind: "dissent" },
      suggestionId: suggestionId("suggestion-dissent"),
    }),
    sharedEvent("InferenceConfirmed", 4, {
      confirmedBy: participantId(FACILITATOR_ID),
      result: { entity: action, kind: "action" },
      suggestionId: suggestionId("suggestion-action"),
    }),
  ];
  const result = await deps.events.append({
    events,
    expectedPosition: 0,
    meetingId: MEETING_ID,
  });
  if (result.kind !== "appended") {
    throw new Error("Shared reference fixture failed");
  }
}

async function saveInitialDraft(
  deps: DecisionDependencies,
  expectedPosition: number,
  fields: DecisionDraftFields = draftFields(),
) {
  const saved = await saveDecisionDraft(deps, facilitatorContext(), {
    ...fields,
    changeReason: "Initial facilitator draft",
    expectedPosition,
    idempotencyKey: "save-initial-draft",
    meetingId: MEETING_ID,
  });
  if (saved.kind !== "draft_saved") {
    throw new Error(`Draft fixture failed: ${saved.code}`);
  }
  return saved;
}

describe("Decision lifecycle application layer", () => {
  it("reserves Draft, Ready, and Commit shared-state mutations for facilitators", async () => {
    const deps = dependencies();
    await expect(
      saveDecisionDraft(deps, participantContext(), {
        ...draftFields(),
        changeReason: "Participant-proposed draft",
        expectedPosition: 0,
        idempotencyKey: "participant-draft",
        meetingId: MEETING_ID,
      }),
    ).resolves.toEqual({ code: "FORBIDDEN", kind: "failed" });

    await expect(
      markDecisionReady(deps, participantContext(), {
        decisionId: "decision-hidden",
        expectedPosition: 0,
        idempotencyKey: "participant-ready",
        meetingId: MEETING_ID,
      }),
    ).resolves.toEqual({ code: "FORBIDDEN", kind: "failed" });
    await expect(
      commitDecision(deps, participantContext(), {
        decisionId: "decision-hidden",
        expectedPosition: 0,
        explicitCommit: true,
        idempotencyKey: "participant-commit",
        meetingId: MEETING_ID,
      }),
    ).resolves.toEqual({ code: "FORBIDDEN", kind: "failed" });
    await expect(
      startDecisionMonitoring(deps, participantContext(), {
        decisionId: "decision-hidden",
        expectedPosition: 0,
        idempotencyKey: "participant-monitoring",
        meetingId: MEETING_ID,
      }),
    ).resolves.toEqual({ code: "FORBIDDEN", kind: "failed" });
    await expect(
      saveDecisionDraft(deps, facilitatorContext(OTHER_MEETING_ID), {
        ...draftFields(),
        changeReason: "Cross-meeting attempt",
        expectedPosition: 0,
        idempotencyKey: "cross-meeting-draft",
        meetingId: MEETING_ID,
      }),
    ).resolves.toEqual({ code: "FORBIDDEN", kind: "failed" });
  });

  it("derives readiness canonically so false caller assertions cannot satisfy it", async () => {
    const missingReferenceDeps = dependencies();
    const missingReferenceDraft = await saveInitialDraft(
      missingReferenceDeps,
      0,
    );
    const falseMissingReferenceAssertion = {
      decisionId: missingReferenceDraft.decision.id,
      expectedPosition: 1,
      idempotencyKey: "ready-with-missing-references",
      meetingId: MEETING_ID,
      readiness: completeReadiness,
    };
    await expect(
      markDecisionReady(
        missingReferenceDeps,
        facilitatorContext(),
        falseMissingReferenceAssertion,
      ),
    ).resolves.toEqual({
      code: "REFERENCED_ENTITY_NOT_FOUND",
      kind: "failed",
    });
    expect(await missingReferenceDeps.events.position(MEETING_ID)).toBe(1);

    const incompleteDeps = dependencies();
    await seedSharedReferences(incompleteDeps);
    const incompleteDraft = await saveInitialDraft(
      incompleteDeps,
      4,
      draftFields({ actionIds: [] }),
    );
    const falseCompletenessAssertion = {
      decisionId: incompleteDraft.decision.id,
      expectedPosition: 5,
      idempotencyKey: "ready-with-incomplete-canonical-state",
      meetingId: MEETING_ID,
      readiness: completeReadiness,
    };
    await expect(
      markDecisionReady(
        incompleteDeps,
        facilitatorContext(),
        falseCompletenessAssertion,
      ),
    ).resolves.toEqual({
      code: "READINESS_INCOMPLETE",
      kind: "failed",
    });
    expect(await incompleteDeps.events.position(MEETING_ID)).toBe(5);
  });

  it("replays every lifecycle command idempotently and refreshes the projection", async () => {
    const deps = dependencies();
    await seedSharedReferences(deps);
    const draftInput = {
      ...draftFields(),
      changeReason: "Initial facilitator draft",
      expectedPosition: 4,
      idempotencyKey: "idempotent-draft",
      meetingId: MEETING_ID,
    };
    const firstDraft = await saveDecisionDraft(
      deps,
      facilitatorContext(),
      draftInput,
    );
    const replayedDraft = await saveDecisionDraft(
      deps,
      facilitatorContext(),
      draftInput,
    );
    expect(firstDraft).toMatchObject({
      kind: "draft_saved",
      replayed: false,
    });
    expect(replayedDraft).toMatchObject({
      kind: "draft_saved",
      replayed: true,
    });
    if (firstDraft.kind !== "draft_saved") {
      throw new Error("Idempotent draft fixture failed");
    }

    const readyInput = {
      decisionId: firstDraft.decision.id,
      expectedPosition: 5,
      idempotencyKey: "idempotent-ready",
      meetingId: MEETING_ID,
      readiness: {
        actionIds: false,
        evidenceIds: false,
        monitorCondition: false,
        outcome: false,
        premiseIds: false,
      },
    };
    const firstReady = await markDecisionReady(
      deps,
      facilitatorContext(),
      readyInput,
    );
    const replayedReady = await markDecisionReady(
      deps,
      facilitatorContext(),
      readyInput,
    );
    expect(firstReady).toMatchObject({ kind: "ready", replayed: false });
    expect(replayedReady).toMatchObject({ kind: "ready", replayed: true });

    const commitInput = {
      decisionId: firstDraft.decision.id,
      expectedPosition: 6,
      explicitCommit: true,
      idempotencyKey: "idempotent-commit",
      meetingId: MEETING_ID,
    };
    const firstCommit = await commitDecision(
      deps,
      facilitatorContext(),
      commitInput,
    );
    const replayedCommit = await commitDecision(
      deps,
      facilitatorContext(),
      commitInput,
    );
    expect(firstCommit).toMatchObject({
      kind: "committed",
      replayed: false,
    });
    expect(replayedCommit).toMatchObject({
      kind: "committed",
      replayed: true,
    });

    const monitoringInput = {
      decisionId: firstDraft.decision.id,
      expectedPosition: 7,
      idempotencyKey: "idempotent-monitoring",
      meetingId: MEETING_ID,
    };
    const firstMonitoring = await startDecisionMonitoring(
      deps,
      facilitatorContext(),
      monitoringInput,
    );
    const replayedMonitoring = await startDecisionMonitoring(
      deps,
      facilitatorContext(),
      monitoringInput,
    );
    expect(firstMonitoring).toMatchObject({
      decision: {
        activeRevision: 2,
        monitorCondition: {
          registrationId: "monitor-registration-1",
        },
        status: "MONITORING",
      },
      kind: "monitoring_started",
      monitorRegistrationId: "monitor-registration-1",
      replayed: false,
    });
    expect(replayedMonitoring).toEqual({
      ...firstMonitoring,
      replayed: true,
    });

    const records = await deps.events.load(MEETING_ID);
    expect(
      records.filter(({ event }) => event.eventType === "DecisionDrafted"),
    ).toHaveLength(1);
    expect(
      records.filter(({ event }) => event.eventType === "DecisionMarkedReady"),
    ).toHaveLength(1);
    expect(
      records.filter(({ event }) => event.eventType === "DecisionCommitted"),
    ).toHaveLength(1);
    const monitoringRecords = records.filter(
      ({ event }) => event.eventType === "MonitoringStarted",
    );
    expect(monitoringRecords).toHaveLength(1);
    expect(monitoringRecords[0]?.event).toMatchObject({
      actor: { kind: "system" },
      payload: {
        decision: {
          activeRevision: 2,
          monitorCondition: {
            registrationId: "monitor-registration-1",
          },
        },
        monitorRegistrationId: "monitor-registration-1",
      },
    });
    const projection = await deps.projections.get({
      meetingId: MEETING_ID,
      ownerParticipantId: FACILITATOR_ID,
      projection: "meeting",
    });
    expect(projection?.shared.decisions[0]?.status).toBe("MONITORING");
    expect(projection?.shared.decisionRevisions).toHaveLength(2);
  });

  it("appends immutable DRAFT revisions with an unbroken lineage", async () => {
    const deps = dependencies();
    const first = await saveInitialDraft(deps, 0);
    const originalSnapshot = structuredClone(first.revision.snapshot);
    const revised = await saveDecisionDraft(deps, facilitatorContext(), {
      ...draftFields({
        outcome: "Proceed only after a signed rollback rehearsal",
        title: "Rehearsed conditional rollout",
      }),
      changeReason: "Added rollback rehearsal gate",
      decisionId: first.decision.id,
      expectedPosition: 1,
      idempotencyKey: "save-revised-draft",
      meetingId: MEETING_ID,
    });
    expect(revised.kind).toBe("draft_saved");
    if (revised.kind !== "draft_saved") {
      throw new Error("Revised draft was unexpectedly rejected");
    }

    expect(first.revision.snapshot).toEqual(originalSnapshot);
    expect(revised.decision.id).toBe(first.decision.id);
    expect(revised.revision.version).toBe(2);
    expect(revised.revision.previousRevisionId).toBe(first.revision.id);
    expect(revised.revision.snapshot.status).toBe("DRAFT");
    expect(revised.revision.snapshot.outcome).not.toBe(
      first.revision.snapshot.outcome,
    );

    const projection = await deps.projections.get({
      meetingId: MEETING_ID,
      ownerParticipantId: FACILITATOR_ID,
      projection: "meeting",
    });
    expect(projection?.shared.decisionRevisions).toEqual([
      first.revision,
      revised.revision,
    ]);
    expect(projection?.shared.decisions[0]?.activeRevision).toBe(2);
  });

  it("keeps DECISION_READY separate from an explicit facilitator commit", async () => {
    const deps = dependencies();
    await seedSharedReferences(deps);
    const draft = await saveInitialDraft(deps, 4);
    const ready = await markDecisionReady(deps, facilitatorContext(), {
      decisionId: draft.decision.id,
      expectedPosition: 5,
      idempotencyKey: "mark-ready",
      meetingId: MEETING_ID,
    });
    expect(ready).toMatchObject({
      decision: { status: "DECISION_READY" },
      kind: "ready",
    });
    await expect(
      commitDecision(deps, facilitatorContext(), {
        decisionId: draft.decision.id,
        expectedPosition: 6,
        explicitCommit: false,
        idempotencyKey: "implicit-commit",
        meetingId: MEETING_ID,
      }),
    ).resolves.toEqual({
      code: "EXPLICIT_COMMIT_REQUIRED",
      kind: "failed",
    });
    expect(await deps.events.position(MEETING_ID)).toBe(6);

    const committed = await commitDecision(deps, facilitatorContext(), {
      decisionId: draft.decision.id,
      expectedPosition: 6,
      explicitCommit: true,
      idempotencyKey: "explicit-commit",
      meetingId: MEETING_ID,
    });
    expect(committed).toMatchObject({
      decision: {
        activeRevision: 2,
        status: "COMMITTED",
      },
      kind: "committed",
      revision: {
        previousRevisionId: draft.revision.id,
        snapshot: { status: "COMMITTED" },
        version: 2,
      },
    });
    if (committed.kind !== "committed") {
      throw new Error("Explicit commit was unexpectedly rejected");
    }
    expect(committed.decision.activeRevisionId).toBe(committed.revision.id);
    expect(committed.decision.status).toBe(committed.revision.snapshot.status);
    expect(draft.revision.snapshot.status).toBe("DRAFT");
    expect(draft.revision.version).toBe(1);

    const projection = await deps.projections.get({
      meetingId: MEETING_ID,
      ownerParticipantId: FACILITATOR_ID,
      projection: "meeting",
    });
    expect(projection?.shared.decisionRevisions).toEqual([
      draft.revision,
      committed.revision,
    ]);
  });
});
