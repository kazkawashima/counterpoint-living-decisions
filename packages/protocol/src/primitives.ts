import { z } from "zod";

const OPAQUE_ID_MAX_LENGTH = 256;
const OPAQUE_ID_PATTERN = /^\S+$/u;

function containsControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
  });
}

function brandedOpaqueId<const Brand extends string>(brand: Brand) {
  return z
    .string()
    .min(1, `${brand} must not be empty`)
    .max(
      OPAQUE_ID_MAX_LENGTH,
      `${brand} must be at most ${OPAQUE_ID_MAX_LENGTH} characters`,
    )
    .regex(OPAQUE_ID_PATTERN, `${brand} must not contain whitespace`)
    .refine(
      (value) => !containsControlCharacter(value),
      `${brand} must not contain control characters`,
    )
    .brand<Brand>();
}

/**
 * IDs are validated only as opaque wire tokens. Their internal format must not
 * be inspected by protocol consumers.
 */
export const OpaqueIdSchema = brandedOpaqueId("OpaqueId");
export const EventIdSchema = brandedOpaqueId("EventId");
export const MeetingIdSchema = brandedOpaqueId("MeetingId");
export const UserIdSchema = brandedOpaqueId("UserId");
export const ParticipantIdSchema = brandedOpaqueId("ParticipantId");
export const SourceArtifactIdSchema = brandedOpaqueId("SourceArtifactId");
export const UtteranceIdSchema = brandedOpaqueId("UtteranceId");
export const PropositionIdSchema = brandedOpaqueId("PropositionId");
export const StanceIdSchema = brandedOpaqueId("StanceId");
export const QuestionIdSchema = brandedOpaqueId("QuestionId");
export const ClaimIdSchema = brandedOpaqueId("ClaimId");
export const PremiseIdSchema = brandedOpaqueId("PremiseId");
export const EvidenceIdSchema = brandedOpaqueId("EvidenceId");
export const OptionIdSchema = brandedOpaqueId("OptionId");
export const CriterionIdSchema = brandedOpaqueId("CriterionId");
export const ConstraintIdSchema = brandedOpaqueId("ConstraintId");
export const RiskIdSchema = brandedOpaqueId("RiskId");
export const EvaluationIdSchema = brandedOpaqueId("EvaluationId");
export const DecisionIdSchema = brandedOpaqueId("DecisionId");
export const DissentIdSchema = brandedOpaqueId("DissentId");
export const ActionIdSchema = brandedOpaqueId("ActionId");
export const InterventionIdSchema = brandedOpaqueId("InterventionId");
export const ExternalEventIdSchema = brandedOpaqueId("ExternalEventId");
export const DecisionRevisionIdSchema = brandedOpaqueId("DecisionRevisionId");
export const ReconsiderationTaskIdSchema = brandedOpaqueId(
  "ReconsiderationTaskId",
);
export const RelationIdSchema = brandedOpaqueId("RelationId");
export const DisclosureCandidateIdSchema = brandedOpaqueId(
  "DisclosureCandidateId",
);
export const MonitorRegistrationIdSchema = brandedOpaqueId(
  "MonitorRegistrationId",
);
export const DisplayTokenIdSchema = brandedOpaqueId("DisplayTokenId");
export const ResetRequestIdSchema = brandedOpaqueId("ResetRequestId");
export const ActorIdSchema = brandedOpaqueId("ActorId");
export const CorrelationIdSchema = brandedOpaqueId("CorrelationId");
export const CausationIdSchema = brandedOpaqueId("CausationId");
export const IdempotencyKeySchema = brandedOpaqueId("IdempotencyKey");

export type OpaqueId = z.infer<typeof OpaqueIdSchema>;
export type EventId = z.infer<typeof EventIdSchema>;
export type MeetingId = z.infer<typeof MeetingIdSchema>;
export type UserId = z.infer<typeof UserIdSchema>;
export type ParticipantId = z.infer<typeof ParticipantIdSchema>;
export type SourceArtifactId = z.infer<typeof SourceArtifactIdSchema>;
export type UtteranceId = z.infer<typeof UtteranceIdSchema>;
export type PropositionId = z.infer<typeof PropositionIdSchema>;
export type StanceId = z.infer<typeof StanceIdSchema>;
export type QuestionId = z.infer<typeof QuestionIdSchema>;
export type ClaimId = z.infer<typeof ClaimIdSchema>;
export type PremiseId = z.infer<typeof PremiseIdSchema>;
export type EvidenceId = z.infer<typeof EvidenceIdSchema>;
export type OptionId = z.infer<typeof OptionIdSchema>;
export type CriterionId = z.infer<typeof CriterionIdSchema>;
export type ConstraintId = z.infer<typeof ConstraintIdSchema>;
export type RiskId = z.infer<typeof RiskIdSchema>;
export type EvaluationId = z.infer<typeof EvaluationIdSchema>;
export type DecisionId = z.infer<typeof DecisionIdSchema>;
export type DissentId = z.infer<typeof DissentIdSchema>;
export type ActionId = z.infer<typeof ActionIdSchema>;
export type InterventionId = z.infer<typeof InterventionIdSchema>;
export type ExternalEventId = z.infer<typeof ExternalEventIdSchema>;
export type DecisionRevisionId = z.infer<typeof DecisionRevisionIdSchema>;
export type ReconsiderationTaskId = z.infer<typeof ReconsiderationTaskIdSchema>;
export type RelationId = z.infer<typeof RelationIdSchema>;
export type DisclosureCandidateId = z.infer<typeof DisclosureCandidateIdSchema>;
export type MonitorRegistrationId = z.infer<typeof MonitorRegistrationIdSchema>;
export type DisplayTokenId = z.infer<typeof DisplayTokenIdSchema>;
export type ResetRequestId = z.infer<typeof ResetRequestIdSchema>;
export type ActorId = z.infer<typeof ActorIdSchema>;
export type CorrelationId = z.infer<typeof CorrelationIdSchema>;
export type CausationId = z.infer<typeof CausationIdSchema>;
export type IdempotencyKey = z.infer<typeof IdempotencyKeySchema>;

export const MeetingPositionSchema = z
  .number()
  .int()
  .nonnegative()
  .brand<"MeetingPosition">();
export type MeetingPosition = z.infer<typeof MeetingPositionSchema>;

/**
 * The wire contract requires UTC rather than merely any ISO-8601 offset.
 * `z.iso.datetime()` rejects local datetimes and non-Z offsets.
 */
export const UtcIsoTimestampSchema = z.iso
  .datetime()
  .brand<"UtcIsoTimestamp">();
export type UtcIsoTimestamp = z.infer<typeof UtcIsoTimestampSchema>;

export const VisibilitySchema = z.enum(["private", "shared"]);
export type Visibility = z.infer<typeof VisibilitySchema>;

export const OriginSchema = z.enum([
  "human_utterance",
  "human_input",
  "source_artifact",
  "ai_inference",
  "system",
]);
export type Origin = z.infer<typeof OriginSchema>;

export const ConfirmationStatusSchema = z.enum([
  "not_applicable",
  "proposed",
  "confirmed",
  "rejected",
]);
export type ConfirmationStatus = z.infer<typeof ConfirmationStatusSchema>;

export const ParticipantActorSchema = z.strictObject({
  kind: z.literal("participant"),
  participantId: ParticipantIdSchema,
});

export const SystemActorSchema = z.strictObject({
  kind: z.literal("system"),
  actorId: ActorIdSchema,
});

/**
 * Actor is event metadata created from authenticated server context. Client
 * command schemas must not accept this value as authority.
 */
export const ServerDerivedActorSchema = z.discriminatedUnion("kind", [
  ParticipantActorSchema,
  SystemActorSchema,
]);
export const ActorSchema = ServerDerivedActorSchema;

export type ParticipantActor = z.infer<typeof ParticipantActorSchema>;
export type SystemActor = z.infer<typeof SystemActorSchema>;
export type ServerDerivedActor = z.infer<typeof ServerDerivedActorSchema>;
export type Actor = ServerDerivedActor;
