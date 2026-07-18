import {
  actionId,
  artifactId,
  auditReferenceId,
  contentHash,
  correlationId,
  createAction,
  createDecision,
  createDecisionRevision,
  createEvidence,
  createMeeting,
  createParticipant,
  createSourceArtifact,
  createUtterance,
  decisionId,
  decisionRevisionId,
  dissentId,
  eventId,
  evidenceId,
  idempotencyKey,
  meetingId,
  meetingPosition,
  nonEmptyText,
  participantId,
  premiseId,
  reconsiderationTaskId,
  revisionNumber,
  schemaVersion,
  sourceReferenceId,
  textRange,
  timestamp,
  userId,
  utteranceId,
  type Action,
  type Decision,
  type DecisionRevision,
  type DecisionStatus,
  type DomainEventPayloads,
  type IdempotencyKey,
  type Meeting,
  type NonEmptyText,
  type Participant,
  type PrivateEventEnvelope,
  type PrivateEventType,
  type SharedEventEnvelope,
  type SharedEventType,
  type SourceArtifact,
  type Utterance,
} from "../../../packages/domain/src/index.js";

export const ids = {
  actionEurope: actionId("action-europe"),
  actionUs: actionId("action-us"),
  artifactPrivate: artifactId("artifact-private"),
  decision: decisionId("decision-rollout"),
  evidence: evidenceId("evidence-regulatory"),
  facilitator: participantId("participant-facilitator"),
  legal: participantId("participant-legal"),
  meeting: meetingId("meeting-flagship"),
  premiseEurope: premiseId("premise-europe"),
  premiseUs: premiseId("premise-us"),
  revision1: decisionRevisionId("revision-1"),
  revision2: decisionRevisionId("revision-2"),
  sourceReference: sourceReferenceId("source-reference-1"),
  task: reconsiderationTaskId("task-review"),
} as const;

export const now = timestamp("2026-07-19T00:00:00.000Z");
export const later = timestamp("2026-07-20T00:00:00.000Z");

export function flagshipMeeting(overrides: Partial<Meeting> = {}): Meeting {
  return createMeeting({
    id: ids.meeting,
    meetingId: ids.meeting,
    createdAt: now,
    createdBy: ids.facilitator,
    visibility: "shared",
    origin: "human_input",
    confirmationStatus: "confirmed",
    revision: revisionNumber(1),
    purpose: nonEmptyText("Plan a safe global rollout"),
    phase: "deliberating",
    facilitatorParticipantId: ids.facilitator,
    participantAssignments: [
      {
        participantId: ids.facilitator,
        role: "facilitator",
        active: true,
      },
      { participantId: ids.legal, role: "participant", active: true },
    ],
    displayTokens: [],
    ...overrides,
  });
}

export function facilitatorParticipant(
  overrides: Partial<Participant> = {},
): Participant {
  return createParticipant({
    id: ids.facilitator,
    meetingId: ids.meeting,
    createdAt: now,
    createdBy: ids.facilitator,
    visibility: "shared",
    origin: "human_input",
    confirmationStatus: "confirmed",
    revision: revisionNumber(1),
    userId: userId("user-facilitator"),
    role: "facilitator",
    permissions: [
      "read_shared",
      "read_own_private",
      "commit_decision",
      "confirm_review_required",
    ],
    active: true,
    ...overrides,
  });
}

export function decisionSnapshot(status: DecisionStatus = "DRAFT") {
  return {
    title: nonEmptyText("Global rollout"),
    outcome: nonEmptyText("Roll out Europe after legal clearance"),
    status,
    premiseIds: [ids.premiseEurope],
    evidenceIds: [ids.evidence],
    dissentIds: [dissentId("dissent-1")],
    actionIds: [ids.actionEurope, ids.actionUs],
    monitorCondition: {
      description: nonEmptyText("Monitor regulatory changes"),
    },
  } as const;
}

export function firstRevision(
  status: DecisionStatus = "DRAFT",
): DecisionRevision {
  return createDecisionRevision({
    id: ids.revision1,
    meetingId: ids.meeting,
    createdAt: now,
    createdBy: ids.facilitator,
    visibility: "shared",
    origin: "human_input",
    confirmationStatus: "confirmed",
    revision: revisionNumber(1),
    decisionId: ids.decision,
    version: revisionNumber(1),
    snapshot: decisionSnapshot(status),
    changeReason: nonEmptyText("Initial draft"),
  });
}

export function flagshipDecision(
  status: DecisionStatus = "DRAFT",
  overrides: Partial<Decision> = {},
): Decision {
  return createDecision({
    id: ids.decision,
    meetingId: ids.meeting,
    createdAt: now,
    createdBy: ids.facilitator,
    visibility: "shared",
    origin: "human_input",
    confirmationStatus: "confirmed",
    revision: revisionNumber(1),
    title: nonEmptyText("Global rollout"),
    outcome: nonEmptyText("Roll out Europe after legal clearance"),
    status,
    activeRevision: revisionNumber(1),
    activeRevisionId: ids.revision1,
    premiseIds: [ids.premiseEurope],
    evidenceIds: [ids.evidence],
    dissentIds: [dissentId("dissent-1")],
    actionIds: [ids.actionEurope, ids.actionUs],
    monitorCondition: {
      description: nonEmptyText("Monitor regulatory changes"),
    },
    ...(status === "SUPERSEDED"
      ? { supersededByDecisionId: decisionId("replacement-decision") }
      : {}),
    ...overrides,
  });
}

export function action(
  id: Action["id"],
  premise: Action["affectedPremiseIds"][number],
  scope: string,
  overrides: Partial<Action> = {},
): Action {
  return createAction({
    id,
    meetingId: ids.meeting,
    createdAt: now,
    createdBy: ids.facilitator,
    visibility: "shared",
    origin: "human_input",
    confirmationStatus: "confirmed",
    revision: revisionNumber(1),
    ownerParticipantId: ids.facilitator,
    scope: [nonEmptyText(scope)],
    status: "active",
    affectedPremiseIds: [premise],
    ...overrides,
  });
}

export function privateArtifact(): SourceArtifact {
  return createSourceArtifact({
    id: ids.artifactPrivate,
    meetingId: ids.meeting,
    createdAt: now,
    createdBy: ids.legal,
    visibility: "private",
    ownerParticipantId: ids.legal,
    origin: "source_artifact",
    confirmationStatus: "not_applicable",
    revision: revisionNumber(1),
    artifactType: "document",
    storageReference: nonEmptyText("private/legal/secret-memo.pdf"),
    contentHash: contentHash("private-hash"),
    sizeBytes: 1024,
    processingState: "processed",
  });
}

export function privateUtterance(): Utterance {
  return createUtterance({
    id: utteranceId("utterance-private"),
    meetingId: ids.meeting,
    createdAt: now,
    createdBy: ids.legal,
    visibility: "private",
    ownerParticipantId: ids.legal,
    origin: "human_utterance",
    confirmationStatus: "not_applicable",
    revision: revisionNumber(1),
    participantId: ids.legal,
    channel: "private",
    text: nonEmptyText("PRIVATE: unreleased legal analysis"),
    capturedAt: now,
    idempotencyKey: idempotencyKey("utterance-private"),
  });
}

export function sharedEvidence() {
  return createEvidence({
    id: ids.evidence,
    meetingId: ids.meeting,
    createdAt: now,
    createdBy: ids.legal,
    visibility: "shared",
    origin: "source_artifact",
    confirmationStatus: "confirmed",
    revision: revisionNumber(1),
    exactSnippet: nonEmptyText("Approved regulatory excerpt"),
    sourceArtifactId: ids.artifactPrivate,
    sourceRange: textRange(8, 39),
    disclosureAuditReferenceId: auditReferenceId("disclosure-audit-1"),
  });
}

export function sharedEvent<Type extends SharedEventType>(
  type: Type,
  position: number,
  payload: DomainEventPayloads[Type],
  key?: IdempotencyKey,
): SharedEventEnvelope<Type> {
  return {
    eventId: eventId(`${type}-${String(position)}`),
    eventType: type,
    schemaVersion: schemaVersion(1),
    meetingId: ids.meeting,
    position: meetingPosition(position),
    actor: { kind: "system" },
    occurredAt: now,
    correlationId: correlationId(`correlation-${String(position)}`),
    visibility: "shared",
    payload,
    ...(key === undefined ? {} : { idempotencyKey: key }),
  };
}

export function privateEvent<Type extends PrivateEventType>(
  type: Type,
  position: number,
  payload: DomainEventPayloads[Type],
  ownerParticipantId = ids.legal,
  key?: IdempotencyKey,
): PrivateEventEnvelope<Type> {
  return {
    eventId: eventId(`${type}-${String(position)}`),
    eventType: type,
    schemaVersion: schemaVersion(1),
    meetingId: ids.meeting,
    position: meetingPosition(position),
    actor: { kind: "participant", participantId: ownerParticipantId },
    occurredAt: now,
    correlationId: correlationId(`correlation-${String(position)}`),
    visibility: "private",
    ownerParticipantId,
    payload,
    ...(key === undefined ? {} : { idempotencyKey: key }),
  };
}

export const readinessComplete = {
  outcome: true,
  premiseIds: true,
  evidenceIds: true,
  actionIds: true,
  monitorCondition: true,
} as const;

export const auditReason: NonEmptyText = nonEmptyText(
  "Reviewed against current evidence",
);
