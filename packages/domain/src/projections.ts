import type {
  Action,
  Decision,
  DecisionRevision,
  Dissent,
  Evidence,
  ExternalEvent,
  Meeting,
  Option,
  Participant,
  Premise,
  Proposition,
  ReconsiderationTask,
  SourceArtifact,
  Stance,
  Utterance,
} from "./entities.js";
import type {
  AppendContract,
  DomainEvent,
  DomainEventType,
  EventReference,
  PrivateDomainEvent,
  SharedDomainEvent,
} from "./events.js";
import { toEventReference } from "./events.js";
import type {
  DisclosureId,
  EventId,
  IdempotencyKey,
  MeetingId,
  MeetingPosition,
  ParticipantId,
  PreviewHash,
  Timestamp,
} from "./values.js";
import { meetingPosition } from "./values.js";

export interface SharedFloorProjection {
  readonly participantId: ParticipantId;
  readonly leaseExpiresAt: Timestamp;
}

export interface SharedMeetingProjection {
  readonly meetingId: MeetingId;
  readonly position: MeetingPosition;
  readonly meeting: Meeting | undefined;
  readonly participants: readonly Participant[];
  readonly artifacts: readonly SourceArtifact[];
  readonly utterances: readonly Utterance[];
  readonly evidence: readonly Evidence[];
  readonly propositions: readonly Proposition[];
  readonly stances: readonly Stance[];
  readonly premises: readonly Premise[];
  readonly options: readonly Option[];
  readonly dissent: readonly Dissent[];
  readonly decisions: readonly Decision[];
  readonly decisionRevisions: readonly DecisionRevision[];
  readonly actions: readonly Action[];
  readonly reconsiderationTasks: readonly ReconsiderationTask[];
  readonly externalEvents: readonly ExternalEvent[];
  readonly sharedFloor: SharedFloorProjection | undefined;
  readonly auditTimeline: readonly EventReference[];
}

export interface DisclosureProjection {
  readonly disclosureId: DisclosureId;
  readonly state: "proposed" | "previewed" | "approved" | "rejected";
  readonly previewHash?: PreviewHash;
}

export interface OwnerPrivateProjection {
  readonly meetingId: MeetingId;
  readonly ownerParticipantId: ParticipantId;
  readonly artifacts: readonly SourceArtifact[];
  readonly utterances: readonly Utterance[];
  readonly disclosures: readonly DisclosureProjection[];
  readonly inferenceSuggestionIds: readonly string[];
}

interface IdempotencyReceipt {
  readonly key: IdempotencyKey;
  readonly eventId: EventId;
  readonly fingerprint: string;
}

interface ProcessedEventReceipt {
  readonly eventId: EventId;
  readonly fingerprint: string;
}

export interface MeetingProjection {
  readonly meetingId: MeetingId;
  readonly position: MeetingPosition;
  readonly shared: SharedMeetingProjection;
  readonly privateWorkspaces: readonly OwnerPrivateProjection[];
  readonly idempotencyReceipts: readonly IdempotencyReceipt[];
  readonly processedEvents: readonly ProcessedEventReceipt[];
}

export class ProjectionError extends Error {
  readonly code:
    | "MEETING_SCOPE_MISMATCH"
    | "STALE_POSITION"
    | "POSITION_GAP"
    | "IDEMPOTENCY_CONFLICT"
    | "EVENT_ID_CONFLICT"
    | "OPTIMISTIC_CONCURRENCY_CONFLICT"
    | "INVALID_EVENT_PAYLOAD";

  constructor(code: ProjectionError["code"], message: string) {
    super(message);
    this.name = "ProjectionError";
    this.code = code;
  }
}

export function createEmptySharedMeetingProjection(
  meetingId: MeetingId,
): SharedMeetingProjection {
  return {
    meetingId,
    position: meetingPosition(0),
    meeting: undefined,
    participants: [],
    artifacts: [],
    utterances: [],
    evidence: [],
    propositions: [],
    stances: [],
    premises: [],
    options: [],
    dissent: [],
    decisions: [],
    decisionRevisions: [],
    actions: [],
    reconsiderationTasks: [],
    externalEvents: [],
    sharedFloor: undefined,
    auditTimeline: [],
  };
}

export function createEmptyMeetingProjection(
  meetingId: MeetingId,
): MeetingProjection {
  return {
    meetingId,
    position: meetingPosition(0),
    shared: createEmptySharedMeetingProjection(meetingId),
    privateWorkspaces: [],
    idempotencyReceipts: [],
    processedEvents: [],
  };
}

export function assertExpectedPosition(
  projection: Pick<MeetingProjection, "position">,
  contract: AppendContract,
): void {
  if (projection.position !== contract.expectedPosition) {
    throw new ProjectionError(
      "OPTIMISTIC_CONCURRENCY_CONFLICT",
      `Expected meeting position ${String(contract.expectedPosition)}, actual ${String(projection.position)}`,
    );
  }
}

function upsertById<Entity extends { readonly id: string }>(
  entities: readonly Entity[],
  entity: Entity,
): readonly Entity[] {
  const index = entities.findIndex(({ id }) => id === entity.id);
  if (index < 0) {
    return [...entities, entity];
  }
  return entities.map((current, currentIndex) =>
    currentIndex === index ? entity : current,
  );
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(",")}]`;
  }
  const entries = Object.entries(value as Readonly<Record<string, unknown>>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`)
    .join(",")}}`;
}

function eventFingerprint(event: DomainEvent): string {
  return stableSerialize({
    eventType: event.eventType,
    meetingId: event.meetingId,
    visibility: event.visibility,
    ownerParticipantId:
      event.visibility === "private" ? event.ownerParticipantId : undefined,
    payload: event.payload,
  });
}

function findDuplicate(
  state: MeetingProjection,
  event: DomainEvent,
  fingerprint: string,
): "duplicate" | "new" {
  const processed = state.processedEvents.find(
    ({ eventId }) => eventId === event.eventId,
  );
  if (processed !== undefined) {
    if (processed.fingerprint !== fingerprint) {
      throw new ProjectionError(
        "EVENT_ID_CONFLICT",
        "An event ID was reused with different domain content",
      );
    }
    return "duplicate";
  }

  if (event.idempotencyKey !== undefined) {
    const receipt = state.idempotencyReceipts.find(
      ({ key }) => key === event.idempotencyKey,
    );
    if (receipt !== undefined) {
      if (receipt.fingerprint !== fingerprint) {
        throw new ProjectionError(
          "IDEMPOTENCY_CONFLICT",
          "An idempotency key was reused with different domain content",
        );
      }
      return "duplicate";
    }
  }
  return "new";
}

function ownerWorkspace(
  workspaces: readonly OwnerPrivateProjection[],
  meetingId: MeetingId,
  ownerParticipantId: ParticipantId,
): OwnerPrivateProjection {
  return (
    workspaces.find(
      (workspace) =>
        workspace.ownerParticipantId === ownerParticipantId &&
        workspace.meetingId === meetingId,
    ) ?? {
      meetingId,
      ownerParticipantId,
      artifacts: [],
      utterances: [],
      disclosures: [],
      inferenceSuggestionIds: [],
    }
  );
}

function upsertOwnerWorkspace(
  workspaces: readonly OwnerPrivateProjection[],
  workspace: OwnerPrivateProjection,
): readonly OwnerPrivateProjection[] {
  const index = workspaces.findIndex(
    ({ meetingId, ownerParticipantId }) =>
      meetingId === workspace.meetingId &&
      ownerParticipantId === workspace.ownerParticipantId,
  );
  return index < 0
    ? [...workspaces, workspace]
    : workspaces.map((current, currentIndex) =>
        currentIndex === index ? workspace : current,
      );
}

function updateDisclosure(
  disclosures: readonly DisclosureProjection[],
  disclosure: DisclosureProjection,
): readonly DisclosureProjection[] {
  const index = disclosures.findIndex(
    ({ disclosureId }) => disclosureId === disclosure.disclosureId,
  );
  return index < 0
    ? [...disclosures, disclosure]
    : disclosures.map((current, currentIndex) =>
        currentIndex === index ? disclosure : current,
      );
}

function validateEntityScope(
  event: DomainEvent,
  entity: { readonly meetingId: MeetingId },
): void {
  if (entity.meetingId !== event.meetingId) {
    throw new ProjectionError(
      "INVALID_EVENT_PAYLOAD",
      `${event.eventType} payload belongs to a different meeting`,
    );
  }
}

function reducePrivateWorkspace(
  state: readonly OwnerPrivateProjection[],
  event: PrivateDomainEvent,
): readonly OwnerPrivateProjection[] {
  const workspace = ownerWorkspace(
    state,
    event.meetingId,
    event.ownerParticipantId,
  );
  let next = workspace;

  switch (event.eventType) {
    case "ArtifactRegistered": {
      validateEntityScope(event, event.payload.artifact);
      if (
        event.payload.artifact.visibility !== "private" ||
        event.payload.artifact.ownerParticipantId !== event.ownerParticipantId
      ) {
        throw new ProjectionError(
          "INVALID_EVENT_PAYLOAD",
          "Private ArtifactRegistered payload must match its event owner",
        );
      }
      next = {
        ...workspace,
        artifacts: upsertById(workspace.artifacts, event.payload.artifact),
      };
      break;
    }
    case "ArtifactProcessed": {
      next = {
        ...workspace,
        artifacts: workspace.artifacts.map((artifact) =>
          artifact.id === event.payload.artifactId
            ? {
                ...artifact,
                processingState: event.payload.processingState,
                ...(event.payload.contentHash === undefined
                  ? {}
                  : { contentHash: event.payload.contentHash }),
              }
            : artifact,
        ),
      };
      break;
    }
    case "UtteranceCaptured": {
      validateEntityScope(event, event.payload.utterance);
      if (
        event.payload.utterance.visibility !== "private" ||
        event.payload.utterance.ownerParticipantId !== event.ownerParticipantId
      ) {
        throw new ProjectionError(
          "INVALID_EVENT_PAYLOAD",
          "Private UtteranceCaptured payload must match its event owner",
        );
      }
      next = {
        ...workspace,
        utterances: upsertById(workspace.utterances, event.payload.utterance),
      };
      break;
    }
    case "DisclosureProposed":
      next = {
        ...workspace,
        disclosures: updateDisclosure(workspace.disclosures, {
          disclosureId: event.payload.disclosureId,
          state: "proposed",
        }),
      };
      break;
    case "DisclosurePreviewed":
      next = {
        ...workspace,
        disclosures: updateDisclosure(workspace.disclosures, {
          disclosureId: event.payload.disclosureId,
          state: "previewed",
          previewHash: event.payload.previewHash,
        }),
      };
      break;
    case "DisclosureApproved":
      next = {
        ...workspace,
        disclosures: updateDisclosure(workspace.disclosures, {
          disclosureId: event.payload.disclosureId,
          state: "approved",
          previewHash: event.payload.previewHash,
        }),
      };
      break;
    case "DisclosureRejected":
      next = {
        ...workspace,
        disclosures: updateDisclosure(workspace.disclosures, {
          disclosureId: event.payload.disclosureId,
          state: "rejected",
        }),
      };
      break;
    case "InferenceSuggested":
      next = {
        ...workspace,
        inferenceSuggestionIds: workspace.inferenceSuggestionIds.includes(
          event.payload.suggestionId,
        )
          ? workspace.inferenceSuggestionIds
          : [...workspace.inferenceSuggestionIds, event.payload.suggestionId],
      };
      break;
    case "InferenceConfirmed":
    case "InferenceRejected":
      break;
  }

  return upsertOwnerWorkspace(state, next);
}

function reduceSharedEvent(
  state: SharedMeetingProjection,
  event: SharedDomainEvent,
): SharedMeetingProjection {
  if (event.meetingId !== state.meetingId) {
    throw new ProjectionError(
      "MEETING_SCOPE_MISMATCH",
      "Event and shared projection meeting IDs differ",
    );
  }
  if (event.position <= state.position) {
    throw new ProjectionError(
      "STALE_POSITION",
      `Shared event position ${String(event.position)} is not newer than ${String(state.position)}`,
    );
  }

  let next: SharedMeetingProjection = state;
  switch (event.eventType) {
    case "MeetingCreated":
      if (event.payload.meeting.id !== event.meetingId) {
        throw new ProjectionError(
          "INVALID_EVENT_PAYLOAD",
          "MeetingCreated payload belongs to a different meeting",
        );
      }
      next = { ...state, meeting: event.payload.meeting };
      break;
    case "ParticipantAssigned":
      validateEntityScope(event, event.payload.participant);
      next = {
        ...state,
        participants: upsertById(state.participants, event.payload.participant),
      };
      break;
    case "ParticipantJoined":
      next = {
        ...state,
        participants: state.participants.map((participant) =>
          participant.id === event.payload.participantId
            ? {
                ...participant,
                active: true,
                joinedAt: event.payload.joinedAt,
              }
            : participant,
        ),
      };
      break;
    case "MeetingEnded":
      next = {
        ...state,
        ...(state.meeting === undefined
          ? {}
          : { meeting: { ...state.meeting, phase: "ended" } }),
        sharedFloor: undefined,
      };
      break;
    case "DisplayTokenIssued":
      next = {
        ...state,
        ...(state.meeting === undefined
          ? {}
          : {
              meeting: {
                ...state.meeting,
                displayTokens: [
                  ...state.meeting.displayTokens,
                  {
                    tokenId: event.payload.displayTokenId,
                    expiresAt: event.payload.expiresAt,
                  },
                ],
              },
            }),
      };
      break;
    case "DisplayTokenRevoked":
      next = {
        ...state,
        ...(state.meeting === undefined
          ? {}
          : {
              meeting: {
                ...state.meeting,
                displayTokens: state.meeting.displayTokens.map((token) =>
                  token.tokenId === event.payload.displayTokenId
                    ? { ...token, revokedAt: event.payload.revokedAt }
                    : token,
                ),
              },
            }),
      };
      break;
    case "ArtifactRegistered":
      validateEntityScope(event, event.payload.artifact);
      if (event.payload.artifact.visibility !== "shared") {
        throw new ProjectionError(
          "INVALID_EVENT_PAYLOAD",
          "Shared ArtifactRegistered event cannot contain a private artifact",
        );
      }
      next = {
        ...state,
        artifacts: upsertById(state.artifacts, event.payload.artifact),
      };
      break;
    case "ArtifactProcessed":
      next = {
        ...state,
        artifacts: state.artifacts.map((artifact) =>
          artifact.id === event.payload.artifactId
            ? {
                ...artifact,
                processingState: event.payload.processingState,
                ...(event.payload.contentHash === undefined
                  ? {}
                  : { contentHash: event.payload.contentHash }),
              }
            : artifact,
        ),
      };
      break;
    case "UtteranceCaptured":
      validateEntityScope(event, event.payload.utterance);
      if (event.payload.utterance.visibility !== "shared") {
        throw new ProjectionError(
          "INVALID_EVENT_PAYLOAD",
          "Shared UtteranceCaptured event cannot contain a private utterance",
        );
      }
      next = {
        ...state,
        utterances: upsertById(state.utterances, event.payload.utterance),
      };
      break;
    case "SharedFloorAcquired":
      next = {
        ...state,
        sharedFloor: {
          participantId: event.payload.participantId,
          leaseExpiresAt: event.payload.leaseExpiresAt,
        },
      };
      break;
    case "SharedFloorReleased":
      next =
        state.sharedFloor?.participantId === event.payload.participantId
          ? { ...state, sharedFloor: undefined }
          : state;
      break;
    case "EvidenceShared":
      validateEntityScope(event, event.payload.evidence);
      if (event.payload.evidence.visibility !== "shared") {
        throw new ProjectionError(
          "INVALID_EVENT_PAYLOAD",
          "EvidenceShared cannot contain private Evidence",
        );
      }
      next = {
        ...state,
        evidence: upsertById(state.evidence, event.payload.evidence),
      };
      break;
    case "InferenceConfirmed":
      validateEntityScope(event, event.payload.result.entity);
      switch (event.payload.result.kind) {
        case "proposition":
          next = {
            ...state,
            propositions: upsertById(
              state.propositions,
              event.payload.result.entity,
            ),
          };
          break;
        case "stance":
          next = {
            ...state,
            stances: upsertById(state.stances, event.payload.result.entity),
          };
          break;
        case "premise":
          next = {
            ...state,
            premises: upsertById(state.premises, event.payload.result.entity),
          };
          break;
        case "option":
          next = {
            ...state,
            options: upsertById(state.options, event.payload.result.entity),
          };
          break;
        case "dissent":
          next = {
            ...state,
            dissent: upsertById(state.dissent, event.payload.result.entity),
          };
          break;
        case "action":
          next = {
            ...state,
            actions: upsertById(state.actions, event.payload.result.entity),
          };
          break;
      }
      break;
    case "DecisionDrafted":
      validateEntityScope(event, event.payload.decision);
      next = {
        ...state,
        decisions: upsertById(state.decisions, event.payload.decision),
        decisionRevisions: upsertById(
          state.decisionRevisions,
          event.payload.revision,
        ),
      };
      break;
    case "DecisionMarkedReady":
    case "DecisionCommitted":
    case "MonitoringStarted":
    case "DecisionMarkedAtRisk":
    case "DecisionReviewRequired":
    case "DecisionRevisionCommitted":
    case "DecisionSuperseded":
    case "DecisionRejected": {
      validateEntityScope(event, event.payload.decision);
      const revision =
        "revision" in event.payload ? event.payload.revision : undefined;
      next = {
        ...state,
        decisions: upsertById(state.decisions, event.payload.decision),
        decisionRevisions:
          revision === undefined
            ? state.decisionRevisions
            : upsertById(state.decisionRevisions, revision),
      };
      break;
    }
    case "ExternalEventReceived":
      validateEntityScope(event, event.payload.externalEvent);
      next = {
        ...state,
        externalEvents: upsertById(
          state.externalEvents,
          event.payload.externalEvent,
        ),
      };
      break;
    case "ActionHeld":
      next = {
        ...state,
        actions: event.payload.actions.reduce(
          (actions, action) => upsertById(actions, action),
          state.actions,
        ),
      };
      break;
    case "ReconsiderationTaskCreated":
      validateEntityScope(event, event.payload.task);
      next = {
        ...state,
        reconsiderationTasks: upsertById(
          state.reconsiderationTasks,
          event.payload.task,
        ),
      };
      break;
    case "DemoResetCompleted":
      next = {
        ...createEmptySharedMeetingProjection(state.meetingId),
        meeting:
          state.meeting === undefined
            ? undefined
            : {
                ...state.meeting,
                phase: "preparing",
                displayTokens: [],
              },
        participants: state.participants,
        auditTimeline: state.auditTimeline,
      };
      break;
    case "InferenceSuggested":
    case "InferenceRejected":
    case "AssumptionInvalidationSuggested":
    case "FacilitatorReviewed":
    case "DemoResetRequested":
    case "ApiKeyLeaseUpdated":
    case "ApiKeyLeaseExpired":
      break;
  }

  return {
    ...next,
    position: event.position,
    auditTimeline: [...next.auditTimeline, toEventReference(event)],
  };
}

export function reduceMeetingProjection(
  state: MeetingProjection,
  event: DomainEvent,
): MeetingProjection {
  if (event.meetingId !== state.meetingId) {
    throw new ProjectionError(
      "MEETING_SCOPE_MISMATCH",
      "Event and projection meeting IDs differ",
    );
  }

  const fingerprint = eventFingerprint(event);
  if (findDuplicate(state, event, fingerprint) === "duplicate") {
    return state;
  }
  if (event.position <= state.position) {
    throw new ProjectionError(
      "STALE_POSITION",
      `Event position ${String(event.position)} is stale at ${String(state.position)}`,
    );
  }
  if (event.position !== state.position + 1) {
    throw new ProjectionError(
      "POSITION_GAP",
      `Expected event position ${String(state.position + 1)}, received ${String(event.position)}`,
    );
  }

  const shared =
    event.visibility === "shared"
      ? reduceSharedEvent(state.shared, event)
      : state.shared;
  const privateWorkspaces =
    event.visibility === "private"
      ? reducePrivateWorkspace(state.privateWorkspaces, event)
      : event.eventType === "DemoResetCompleted"
        ? []
        : state.privateWorkspaces;
  return {
    ...state,
    position: event.position,
    shared,
    privateWorkspaces,
    processedEvents: [
      ...state.processedEvents,
      { eventId: event.eventId, fingerprint },
    ],
    idempotencyReceipts:
      event.idempotencyKey === undefined
        ? state.idempotencyReceipts
        : [
            ...state.idempotencyReceipts,
            {
              key: event.idempotencyKey,
              eventId: event.eventId,
              fingerprint,
            },
          ],
  };
}

export function replayMeeting(
  meetingId: MeetingId,
  events: readonly DomainEvent[],
): MeetingProjection {
  return events.reduce(
    reduceMeetingProjection,
    createEmptyMeetingProjection(meetingId),
  );
}

export function replaySharedMeeting(
  meetingId: MeetingId,
  events: readonly SharedDomainEvent[],
): SharedMeetingProjection {
  return events.reduce(
    reduceSharedEvent,
    createEmptySharedMeetingProjection(meetingId),
  );
}

export function toSharedMeetingProjection(
  projection: MeetingProjection,
): SharedMeetingProjection {
  return projection.shared;
}

export function getOwnerPrivateProjection(
  projection: MeetingProjection,
  ownerParticipantId: ParticipantId,
): OwnerPrivateProjection {
  return ownerWorkspace(
    projection.privateWorkspaces,
    projection.meetingId,
    ownerParticipantId,
  );
}

export function eventTypes(
  projection: SharedMeetingProjection,
): readonly DomainEventType[] {
  return projection.auditTimeline.map(({ eventType }) => eventType);
}
