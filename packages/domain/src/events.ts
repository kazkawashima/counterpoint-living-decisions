import type {
  Action,
  Decision,
  DecisionRevision,
  Dissent,
  Evidence,
  ExternalEvent,
  Meeting,
  MonitorCondition,
  Option,
  Participant,
  Premise,
  Proposition,
  ReconsiderationTask,
  SourceArtifact,
  Stance,
  Utterance,
  Visibility,
} from "./entities.js";
import type {
  ActionId,
  ArtifactId,
  CausationId,
  ContentHash,
  CorrelationId,
  DecisionId,
  DisclosureId,
  DisplayTokenId,
  EventId,
  EvidenceId,
  ExternalEventId,
  IdempotencyKey,
  MeetingId,
  MeetingPosition,
  MonitorRegistrationId,
  NonEmptyText,
  ParticipantId,
  PremiseId,
  PreviewHash,
  PromptVersion,
  ReconsiderationTaskId,
  ResetRequestId,
  SchemaVersion,
  SourceReferenceId,
  SuggestionId,
  TextRange,
  Timestamp,
} from "./values.js";

export type DomainActor =
  | {
      readonly kind: "participant";
      readonly participantId: ParticipantId;
    }
  | {
      readonly kind: "system";
    }
  | {
      readonly kind: "ai";
      readonly model: NonEmptyText;
    };

export interface AiSuggestionMetadata {
  readonly model: NonEmptyText;
  readonly promptVersion: PromptVersion;
  readonly inputReferenceIds: readonly SourceReferenceId[];
  readonly confidence: number;
  readonly reason: NonEmptyText;
}

export interface PremiseInferenceSuggestionDetails {
  readonly evidenceReferenceIds: readonly SourceReferenceId[];
  readonly dependencyScope: readonly NonEmptyText[];
  readonly monitorCondition?: MonitorCondition;
}

export interface DissentInferenceSuggestionDetails {
  readonly participantId: ParticipantId;
  readonly retained: boolean;
}

export interface ActionInferenceSuggestionDetails {
  readonly ownerParticipantId: ParticipantId;
  readonly scope: readonly NonEmptyText[];
  readonly affectedPremiseSuggestionIds: readonly SuggestionId[];
}

export interface DecisionInferenceSuggestionDetails {
  readonly title: NonEmptyText;
  readonly outcome: NonEmptyText;
  readonly monitorCondition: MonitorCondition;
  readonly premiseSuggestionIds: readonly SuggestionId[];
  readonly dissentSuggestionIds: readonly SuggestionId[];
  readonly actionSuggestionIds: readonly SuggestionId[];
  readonly provenance?:
    | {
        readonly origin: "ai_assisted";
        readonly operation: NonEmptyText;
        readonly outputSchemaVersion: NonEmptyText;
        readonly generatedAt: Timestamp;
      }
    | {
        readonly origin: "human_authored";
      };
}

export type InferenceSuggestionDetails =
  | PremiseInferenceSuggestionDetails
  | DissentInferenceSuggestionDetails
  | ActionInferenceSuggestionDetails
  | DecisionInferenceSuggestionDetails;

interface InferenceSuggestedPayloadBase {
  readonly suggestionId: SuggestionId;
  readonly statement: NonEmptyText;
  readonly metadata: AiSuggestionMetadata;
}

export type InferenceSuggestedPayload = InferenceSuggestedPayloadBase &
  (
    | {
        readonly candidateKind: "proposition";
        readonly details?: never;
      }
    | {
        readonly candidateKind: "premise";
        readonly details?: PremiseInferenceSuggestionDetails;
      }
    | {
        readonly candidateKind: "dissent";
        readonly details?: DissentInferenceSuggestionDetails;
      }
    | {
        readonly candidateKind: "action";
        readonly details?: ActionInferenceSuggestionDetails;
      }
    | {
        readonly candidateKind: "decision";
        readonly details?: DecisionInferenceSuggestionDetails;
      }
  );

export interface DisclosureOutgoingPayload {
  readonly exactSnippet: NonEmptyText;
  readonly sourceArtifactId: ArtifactId;
  readonly sourceRange: TextRange;
}

export type ConfirmedInference =
  | {
      readonly kind: "proposition";
      readonly entity: Proposition;
    }
  | {
      readonly kind: "stance";
      readonly entity: Stance;
    }
  | {
      readonly kind: "premise";
      readonly entity: Premise;
    }
  | {
      readonly kind: "option";
      readonly entity: Option;
    }
  | {
      readonly kind: "dissent";
      readonly entity: Dissent;
    }
  | {
      readonly kind: "action";
      readonly entity: Action;
    };

/*
 * Payloads intentionally contain only domain data needed by the flagship.
 * Transport-only fields belong in packages/protocol, while these shapes remain
 * stable event meanings that reducers can replay without runtime dependencies.
 */
export interface DomainEventPayloads {
  readonly MeetingCreated: {
    readonly meeting: Meeting;
  };
  readonly ParticipantAssigned: {
    readonly participant: Participant;
  };
  readonly ParticipantJoined: {
    readonly participantId: ParticipantId;
    readonly joinedAt: Timestamp;
  };
  readonly MeetingEnded: {
    readonly endedAt: Timestamp;
    readonly reason?: NonEmptyText;
  };
  readonly DisplayTokenIssued: {
    readonly displayTokenId: DisplayTokenId;
    readonly expiresAt: Timestamp;
  };
  readonly DisplayTokenRevoked: {
    readonly displayTokenId: DisplayTokenId;
    readonly revokedAt: Timestamp;
  };
  readonly ArtifactRegistered: {
    readonly artifact: SourceArtifact;
  };
  readonly ArtifactProcessed: {
    readonly artifactId: ArtifactId;
    readonly processingState: "processed" | "failed";
    readonly contentHash?: ContentHash;
    readonly failureCode?: NonEmptyText;
  };
  readonly UtteranceCaptured: {
    readonly utterance: Utterance;
  };
  readonly SharedFloorAcquired: {
    readonly participantId: ParticipantId;
    readonly leaseExpiresAt: Timestamp;
  };
  readonly SharedFloorReleased: {
    readonly participantId: ParticipantId;
    readonly reason: "released" | "expired" | "disconnected";
  };
  readonly DisclosureProposed: {
    readonly disclosureId: DisclosureId;
    readonly ownerParticipantId: ParticipantId;
    readonly outgoingPayload: DisclosureOutgoingPayload;
  };
  readonly DisclosurePreviewed: {
    readonly disclosureId: DisclosureId;
    readonly outgoingPayload: DisclosureOutgoingPayload;
    readonly previewHash: PreviewHash;
  };
  readonly DisclosureApproved: {
    readonly disclosureId: DisclosureId;
    readonly previewHash: PreviewHash;
    readonly resultingEvidenceId: EvidenceId;
    readonly approvedAt: Timestamp;
  };
  readonly DisclosureRejected: {
    readonly disclosureId: DisclosureId;
    readonly rejectedAt: Timestamp;
    readonly reason?: NonEmptyText;
  };
  readonly EvidenceShared: {
    readonly evidence: Evidence;
  };
  readonly InferenceSuggested: InferenceSuggestedPayload;
  readonly InferenceConfirmed: {
    readonly suggestionId: SuggestionId;
    readonly result: ConfirmedInference;
    readonly confirmedBy: ParticipantId;
  };
  readonly InferenceRejected: {
    readonly suggestionId: SuggestionId;
    readonly rejectedBy: ParticipantId;
    readonly reason?: NonEmptyText;
  };
  readonly DecisionDrafted: {
    readonly decision: Decision;
    readonly revision: DecisionRevision;
  };
  readonly DecisionMarkedReady: {
    readonly decision: Decision;
  };
  readonly DecisionCommitted: {
    readonly decision: Decision;
    readonly revision: DecisionRevision;
  };
  readonly MonitoringStarted: {
    readonly decision: Decision;
    readonly monitorRegistrationId: MonitorRegistrationId;
  };
  readonly ExternalEventReceived: {
    readonly externalEvent: ExternalEvent;
  };
  readonly AssumptionInvalidationSuggested: {
    readonly suggestionId: SuggestionId;
    readonly decisionId: DecisionId;
    readonly externalEventId: ExternalEventId;
    readonly affectedPremiseIds: readonly PremiseId[];
    readonly affectedActionIds: readonly ActionId[];
    readonly evidenceReferenceIds: readonly SourceReferenceId[];
    readonly metadata: AiSuggestionMetadata;
  };
  readonly DecisionMarkedAtRisk: {
    readonly decision: Decision;
    readonly suggestionId: SuggestionId;
    readonly affectedPremiseIds: readonly PremiseId[];
    readonly affectedActionIds: readonly ActionId[];
  };
  readonly FacilitatorReviewed: {
    readonly decisionId: DecisionId;
    readonly suggestionId: SuggestionId;
    readonly facilitatorParticipantId: ParticipantId;
    readonly disposition: "confirm_invalidation" | "reject_suggestion";
    readonly reviewedPremiseIds: readonly PremiseId[];
    readonly reviewedEvidenceReferenceIds: readonly SourceReferenceId[];
    readonly reviewedActionIds: readonly ActionId[];
    readonly reason: NonEmptyText;
  };
  readonly DecisionReviewRequired: {
    readonly decision: Decision;
    readonly suggestionId: SuggestionId;
    readonly heldActionIds: readonly ActionId[];
    readonly reconsiderationTaskId: ReconsiderationTaskId;
  };
  readonly ActionHeld: {
    readonly decisionId: DecisionId;
    readonly suggestionId: SuggestionId;
    readonly actions: readonly Action[];
  };
  readonly ReconsiderationTaskCreated: {
    readonly task: ReconsiderationTask;
  };
  readonly DecisionRevisionCommitted: {
    readonly decision: Decision;
    readonly revision: DecisionRevision;
  };
  readonly DecisionSuperseded: {
    readonly decision: Decision;
    readonly replacementDecisionId: DecisionId;
  };
  readonly DecisionRejected: {
    readonly decision: Decision;
    readonly reason: NonEmptyText;
  };
  readonly DemoResetRequested: {
    readonly resetRequestId: ResetRequestId;
    readonly seedName: NonEmptyText;
  };
  readonly DemoResetCompleted: {
    readonly resetRequestId: ResetRequestId;
    readonly seedName: NonEmptyText;
  };
  readonly ApiKeyLeaseUpdated: {
    readonly expiresAt: Timestamp;
  };
  readonly ApiKeyLeaseExpired: {
    readonly expiredAt: Timestamp;
    readonly reason: "heartbeat_lost" | "meeting_ended" | "session_ended";
  };
}

export type DomainEventType = keyof DomainEventPayloads;

export const domainEventTypes = [
  "MeetingCreated",
  "ParticipantAssigned",
  "ParticipantJoined",
  "MeetingEnded",
  "DisplayTokenIssued",
  "DisplayTokenRevoked",
  "ArtifactRegistered",
  "ArtifactProcessed",
  "UtteranceCaptured",
  "SharedFloorAcquired",
  "SharedFloorReleased",
  "DisclosureProposed",
  "DisclosurePreviewed",
  "DisclosureApproved",
  "DisclosureRejected",
  "EvidenceShared",
  "InferenceSuggested",
  "InferenceConfirmed",
  "InferenceRejected",
  "DecisionDrafted",
  "DecisionMarkedReady",
  "DecisionCommitted",
  "MonitoringStarted",
  "ExternalEventReceived",
  "AssumptionInvalidationSuggested",
  "DecisionMarkedAtRisk",
  "FacilitatorReviewed",
  "DecisionReviewRequired",
  "ActionHeld",
  "ReconsiderationTaskCreated",
  "DecisionRevisionCommitted",
  "DecisionSuperseded",
  "DecisionRejected",
  "DemoResetRequested",
  "DemoResetCompleted",
  "ApiKeyLeaseUpdated",
  "ApiKeyLeaseExpired",
] as const satisfies readonly DomainEventType[];

type MissingDomainEventType = Exclude<
  DomainEventType,
  (typeof domainEventTypes)[number]
>;
const allDomainEventTypesAreListed: MissingDomainEventType extends never
  ? true
  : false = true;
void allDomainEventTypesAreListed;

export type DualVisibilityEventType =
  | "ArtifactRegistered"
  | "ArtifactProcessed"
  | "UtteranceCaptured"
  | "InferenceSuggested"
  | "InferenceConfirmed"
  | "InferenceRejected";

export type PrivateOnlyEventType =
  | "DisclosureProposed"
  | "DisclosurePreviewed"
  | "DisclosureApproved"
  | "DisclosureRejected";

export type PrivateEventType = DualVisibilityEventType | PrivateOnlyEventType;

export type SharedEventType = Exclude<DomainEventType, PrivateOnlyEventType>;

interface EventEnvelopeBase<Type extends DomainEventType> {
  readonly eventId: EventId;
  readonly eventType: Type;
  readonly schemaVersion: SchemaVersion;
  readonly meetingId: MeetingId;
  readonly position: MeetingPosition;
  readonly actor: DomainActor;
  readonly occurredAt: Timestamp;
  readonly correlationId: CorrelationId;
  readonly causationId?: CausationId;
  readonly idempotencyKey?: IdempotencyKey;
  readonly payload: DomainEventPayloads[Type];
}

export type SharedEventEnvelope<Type extends SharedEventType> =
  EventEnvelopeBase<Type> & {
    readonly visibility: "shared";
    readonly ownerParticipantId?: never;
  };

export type PrivateEventEnvelope<Type extends PrivateEventType> =
  EventEnvelopeBase<Type> & {
    readonly visibility: "private";
    readonly ownerParticipantId: ParticipantId;
  };

export type SharedDomainEvent = {
  readonly [Type in SharedEventType]: SharedEventEnvelope<Type>;
}[SharedEventType];

export type PrivateDomainEvent = {
  readonly [Type in PrivateEventType]: PrivateEventEnvelope<Type>;
}[PrivateEventType];

export type DomainEvent = SharedDomainEvent | PrivateDomainEvent;

export type EventOf<Type extends DomainEventType> = Extract<
  DomainEvent,
  { readonly eventType: Type }
>;

export interface AppendContract {
  readonly expectedPosition: MeetingPosition;
  readonly idempotencyKey?: IdempotencyKey;
}

export interface EventReference {
  readonly eventId: EventId;
  readonly eventType: DomainEventType;
  readonly meetingId: MeetingId;
  readonly position: MeetingPosition;
  readonly visibility: Visibility;
  readonly occurredAt: Timestamp;
}

export function toEventReference(event: DomainEvent): EventReference {
  return {
    eventId: event.eventId,
    eventType: event.eventType,
    meetingId: event.meetingId,
    position: event.position,
    visibility: event.visibility,
    occurredAt: event.occurredAt,
  };
}
