import { z } from "zod";

import { EventTypeSchema } from "./events.js";
import {
  ActionIdSchema,
  CorrelationIdSchema,
  DecisionIdSchema,
  DecisionRevisionIdSchema,
  DisclosureCandidateIdSchema,
  DissentIdSchema,
  EvidenceIdSchema,
  EventIdSchema,
  IdempotencyKeySchema,
  MeetingIdSchema,
  MeetingPositionSchema,
  MonitorRegistrationIdSchema,
  OpaqueIdSchema,
  ParticipantIdSchema,
  PremiseIdSchema,
  ServerDerivedActorSchema,
  SourceArtifactIdSchema,
  UserIdSchema,
  UtcIsoTimestampSchema,
} from "./primitives.js";
import { ProtocolVersionSchema } from "./versions.js";

export const HTTP_API_V1_PREFIX = "/api/v1" as const;
export const HTTP_API_VERSION_PREFIX = HTTP_API_V1_PREFIX;

const TITLE_MAX_LENGTH = 256;
const TEXT_MAX_LENGTH = 20 * 1024 * 1024;

const NonEmptyTextSchema = z.string().trim().min(1).max(TEXT_MAX_LENGTH);
const TitleSchema = z.string().trim().min(1).max(TITLE_MAX_LENGTH);
const OptionalCorrelationShape = {
  correlationId: CorrelationIdSchema.optional(),
} as const;
const RequiredCorrelationShape = {
  correlationId: CorrelationIdSchema,
} as const;
const MeetingMutationShape = {
  meetingId: MeetingIdSchema,
  expectedPosition: MeetingPositionSchema,
  idempotencyKey: IdempotencyKeySchema,
  ...OptionalCorrelationShape,
} as const;
const MeetingMutationReceiptShape = {
  meetingId: MeetingIdSchema,
  position: MeetingPositionSchema,
  ...RequiredCorrelationShape,
} as const;

export const BearerTokenSchema = z.string().min(1).max(4096);
export const MeetingCodeSchema = z.string().trim().min(1).max(64);
export const PreviewHashSchema = z
  .string()
  .min(1)
  .max(512)
  .regex(/^\S+$/u, "previewHash must not contain whitespace")
  .brand<"PreviewHash">();

export const ParticipantRoleSchema = z.enum(["facilitator", "participant"]);
export const MeetingPhaseSchema = z.enum([
  "preparing",
  "deliberating",
  "deciding",
  "ended",
]);
export const CapabilitySchema = z.enum([
  "meeting:read",
  "private:read-own",
  "artifact:create-own",
  "disclosure:propose-own",
  "disclosure:approve-own",
  "decision:commit",
  "decision:review-confirm",
  "demo:event-inject",
  "demo:reset",
  "byok:configure",
]);

export type ParticipantRole = z.infer<typeof ParticipantRoleSchema>;
export type MeetingPhase = z.infer<typeof MeetingPhaseSchema>;
export type Capability = z.infer<typeof CapabilitySchema>;
export type PreviewHash = z.infer<typeof PreviewHashSchema>;

export const LoginRequestSchema = z.strictObject({
  userId: UserIdSchema,
  password: z.string().min(1).max(1024),
  ...OptionalCorrelationShape,
});
export const LoginResponseSchema = z.strictObject({
  bearerToken: BearerTokenSchema,
  userId: UserIdSchema,
  expiresAt: UtcIsoTimestampSchema,
  ...RequiredCorrelationShape,
});
export const LogoutRequestSchema = z.strictObject({
  ...OptionalCorrelationShape,
});
export const LogoutResponseSchema = z.strictObject({
  loggedOutAt: UtcIsoTimestampSchema,
  ...RequiredCorrelationShape,
});

export type LoginRequest = z.infer<typeof LoginRequestSchema>;
export type LoginResponse = z.infer<typeof LoginResponseSchema>;
export type LogoutRequest = z.infer<typeof LogoutRequestSchema>;
export type LogoutResponse = z.infer<typeof LogoutResponseSchema>;

export const AssignedMeetingSchema = z.strictObject({
  meetingId: MeetingIdSchema,
  participantId: ParticipantIdSchema,
  purpose: NonEmptyTextSchema,
  phase: MeetingPhaseSchema,
  position: MeetingPositionSchema,
  role: ParticipantRoleSchema,
});
export const ListAssignedMeetingsRequestSchema = z.strictObject({
  ...OptionalCorrelationShape,
});
export const ListAssignedMeetingsResponseSchema = z.strictObject({
  meetings: z.array(AssignedMeetingSchema),
  ...RequiredCorrelationShape,
});
export const AssignedMeetingListRequestSchema =
  ListAssignedMeetingsRequestSchema;
export const AssignedMeetingListResponseSchema =
  ListAssignedMeetingsResponseSchema;

export type AssignedMeeting = z.infer<typeof AssignedMeetingSchema>;
export type ListAssignedMeetingsRequest = z.infer<
  typeof ListAssignedMeetingsRequestSchema
>;
export type ListAssignedMeetingsResponse = z.infer<
  typeof ListAssignedMeetingsResponseSchema
>;
export type AssignedMeetingListRequest = ListAssignedMeetingsRequest;
export type AssignedMeetingListResponse = ListAssignedMeetingsResponse;

export const JoinMeetingByCodeRequestSchema = z.strictObject({
  code: MeetingCodeSchema,
  idempotencyKey: IdempotencyKeySchema,
  ...OptionalCorrelationShape,
});
export const JoinMeetingByCodeResponseSchema = z.strictObject({
  meeting: AssignedMeetingSchema,
  capabilities: z.array(CapabilitySchema),
  position: MeetingPositionSchema,
  ...RequiredCorrelationShape,
});
export const CodeJoinRequestSchema = JoinMeetingByCodeRequestSchema;
export const CodeJoinResponseSchema = JoinMeetingByCodeResponseSchema;

export type JoinMeetingByCodeRequest = z.infer<
  typeof JoinMeetingByCodeRequestSchema
>;
export type JoinMeetingByCodeResponse = z.infer<
  typeof JoinMeetingByCodeResponseSchema
>;
export type CodeJoinRequest = JoinMeetingByCodeRequest;
export type CodeJoinResponse = JoinMeetingByCodeResponse;

export const MeetingUserAssignmentInputSchema = z.strictObject({
  userId: UserIdSchema,
  role: ParticipantRoleSchema,
});
export const CreateMeetingRequestSchema = z
  .strictObject({
    purpose: NonEmptyTextSchema,
    users: z.array(MeetingUserAssignmentInputSchema).min(3).max(8),
    idempotencyKey: IdempotencyKeySchema,
    ...OptionalCorrelationShape,
  })
  .superRefine((request, context) => {
    const userIds = request.users.map(({ userId }) => userId);
    if (new Set(userIds).size !== userIds.length) {
      context.addIssue({
        code: "custom",
        message: "meeting users must be unique",
        path: ["users"],
      });
    }
    if (
      request.users.filter(({ role }) => role === "facilitator").length !== 1
    ) {
      context.addIssue({
        code: "custom",
        message: "meeting requires exactly one facilitator assignment",
        path: ["users"],
      });
    }
  });
export const MeetingParticipantAssignmentSchema = z.strictObject({
  userId: UserIdSchema,
  participantId: ParticipantIdSchema,
  role: ParticipantRoleSchema,
});
export const CreateMeetingResponseSchema = z.strictObject({
  meetingId: MeetingIdSchema,
  code: MeetingCodeSchema,
  purpose: NonEmptyTextSchema,
  phase: MeetingPhaseSchema,
  assignments: z.array(MeetingParticipantAssignmentSchema).min(3).max(8),
  position: MeetingPositionSchema,
  ...RequiredCorrelationShape,
});
export const FacilitatorCreateMeetingRequestSchema = CreateMeetingRequestSchema;
export const FacilitatorCreateMeetingResponseSchema =
  CreateMeetingResponseSchema;

export type MeetingUserAssignmentInput = z.infer<
  typeof MeetingUserAssignmentInputSchema
>;
export type MeetingParticipantAssignment = z.infer<
  typeof MeetingParticipantAssignmentSchema
>;
export type CreateMeetingRequest = z.infer<typeof CreateMeetingRequestSchema>;
export type CreateMeetingResponse = z.infer<typeof CreateMeetingResponseSchema>;
export type FacilitatorCreateMeetingRequest = CreateMeetingRequest;
export type FacilitatorCreateMeetingResponse = CreateMeetingResponse;

export const TextRangeSchema = z
  .strictObject({
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
  })
  .refine(({ end, start }) => end > start, {
    message: "source range must satisfy 0 <= start < end",
    path: ["end"],
  });
export const PrivateTextSourceFixtureSchema = z.strictObject({
  sourceArtifactId: SourceArtifactIdSchema,
  title: TitleSchema,
  text: NonEmptyTextSchema,
  createdAt: UtcIsoTimestampSchema,
});
export const DisclosureOutgoingPayloadSchema = z.strictObject({
  sourceArtifactId: SourceArtifactIdSchema,
  exactSnippet: NonEmptyTextSchema,
  sourceRange: TextRangeSchema,
});
export const DisclosureCandidateSchema = z.strictObject({
  candidateId: DisclosureCandidateIdSchema,
  state: z.enum(["proposed", "previewed", "approved", "rejected"]),
  outgoingPayload: DisclosureOutgoingPayloadSchema,
  previewHash: PreviewHashSchema.optional(),
});
export const InferenceSuggestionSchema = z.strictObject({
  suggestionId: OpaqueIdSchema,
  kind: z.enum(["proposition", "premise", "dissent", "action", "decision"]),
  statement: NonEmptyTextSchema,
  confirmationStatus: z.enum(["proposed", "confirmed", "rejected"]),
});

export type TextRange = z.infer<typeof TextRangeSchema>;
export type PrivateTextSourceFixture = z.infer<
  typeof PrivateTextSourceFixtureSchema
>;
export type DisclosureOutgoingPayload = z.infer<
  typeof DisclosureOutgoingPayloadSchema
>;
export type DisclosureCandidate = z.infer<typeof DisclosureCandidateSchema>;
export type InferenceSuggestion = z.infer<typeof InferenceSuggestionSchema>;

export const SharedEvidenceSchema = z.strictObject({
  evidenceId: EvidenceIdSchema,
  exactSnippet: NonEmptyTextSchema,
  sourceArtifactId: SourceArtifactIdSchema,
  sourceRange: TextRangeSchema,
  createdAt: UtcIsoTimestampSchema,
});
export const SharedPremiseSchema = z.strictObject({
  premiseId: PremiseIdSchema,
  statement: NonEmptyTextSchema,
  confirmationStatus: z.enum(["proposed", "confirmed", "rejected"]),
});
export const SharedDissentSchema = z.strictObject({
  dissentId: DissentIdSchema,
  reason: NonEmptyTextSchema,
  retained: z.boolean(),
});
export const SharedActionSchema = z.strictObject({
  actionId: ActionIdSchema,
  ownerParticipantId: ParticipantIdSchema,
  scope: z.array(NonEmptyTextSchema).min(1),
  status: z.enum(["planned", "active", "held", "completed"]),
});
export const MeetingParticipantProjectionSchema = z.strictObject({
  participantId: ParticipantIdSchema,
  userId: UserIdSchema,
  role: ParticipantRoleSchema,
  active: z.boolean(),
  joinedAt: UtcIsoTimestampSchema.optional(),
});
export const MonitorConditionSchema = z.strictObject({
  description: NonEmptyTextSchema,
  registrationId: MonitorRegistrationIdSchema.optional(),
});
export const DecisionReadinessSchema = z.strictObject({
  outcome: z.boolean(),
  premiseIds: z.boolean(),
  evidenceIds: z.boolean(),
  actionIds: z.boolean(),
  monitorCondition: z.boolean(),
});
export const DecisionStatusSchema = z.enum([
  "DRAFT",
  "DECISION_READY",
  "COMMITTED",
  "MONITORING",
  "AT_RISK",
  "REVIEW_REQUIRED",
  "SUPERSEDED",
  "REJECTED",
]);
export const DecisionSnapshotSchema = z.strictObject({
  title: TitleSchema,
  outcome: NonEmptyTextSchema,
  status: DecisionStatusSchema,
  premiseIds: z.array(PremiseIdSchema),
  evidenceIds: z.array(EvidenceIdSchema),
  dissentIds: z.array(DissentIdSchema),
  actionIds: z.array(ActionIdSchema),
  monitorCondition: MonitorConditionSchema,
});
export const DecisionSchema = z.strictObject({
  decisionId: DecisionIdSchema,
  status: DecisionStatusSchema,
  activeRevision: z.number().int().positive(),
  activeRevisionId: DecisionRevisionIdSchema,
  snapshot: DecisionSnapshotSchema,
  readiness: DecisionReadinessSchema,
  updatedAt: UtcIsoTimestampSchema,
});
export const DecisionRevisionSchema = z.strictObject({
  revisionId: DecisionRevisionIdSchema,
  decisionId: DecisionIdSchema,
  version: z.number().int().positive(),
  previousRevisionId: DecisionRevisionIdSchema.optional(),
  snapshot: DecisionSnapshotSchema,
  changeReason: NonEmptyTextSchema,
  createdAt: UtcIsoTimestampSchema,
  createdBy: ParticipantIdSchema,
});
export const AuditEntrySchema = z.strictObject({
  auditId: OpaqueIdSchema,
  eventId: EventIdSchema,
  eventType: EventTypeSchema,
  meetingId: MeetingIdSchema,
  position: MeetingPositionSchema,
  actor: ServerDerivedActorSchema,
  occurredAt: UtcIsoTimestampSchema,
  correlationId: CorrelationIdSchema,
});

export type SharedEvidence = z.infer<typeof SharedEvidenceSchema>;
export type SharedPremise = z.infer<typeof SharedPremiseSchema>;
export type SharedDissent = z.infer<typeof SharedDissentSchema>;
export type SharedAction = z.infer<typeof SharedActionSchema>;
export type MeetingParticipantProjection = z.infer<
  typeof MeetingParticipantProjectionSchema
>;
export type MonitorCondition = z.infer<typeof MonitorConditionSchema>;
export type DecisionReadiness = z.infer<typeof DecisionReadinessSchema>;
export type DecisionStatus = z.infer<typeof DecisionStatusSchema>;
export type DecisionSnapshot = z.infer<typeof DecisionSnapshotSchema>;
export type Decision = z.infer<typeof DecisionSchema>;
export type DecisionRevision = z.infer<typeof DecisionRevisionSchema>;
export type AuditEntry = z.infer<typeof AuditEntrySchema>;

export const ListSharedEvidenceResponseSchema = z.strictObject({
  evidence: z.array(SharedEvidenceSchema),
  meetingId: MeetingIdSchema,
  position: MeetingPositionSchema,
  ...RequiredCorrelationShape,
});
export type ListSharedEvidenceResponse = z.infer<
  typeof ListSharedEvidenceResponseSchema
>;

export const RoleProjectionQuerySchema = z.strictObject({
  meetingId: MeetingIdSchema,
  ...OptionalCorrelationShape,
});
export const RoleProjectionResponseSchema = z.strictObject({
  meeting: z.strictObject({
    meetingId: MeetingIdSchema,
    purpose: NonEmptyTextSchema,
    phase: MeetingPhaseSchema,
  }),
  participant: z.strictObject({
    participantId: ParticipantIdSchema,
    userId: UserIdSchema,
    role: ParticipantRoleSchema,
  }),
  capabilities: z.array(CapabilitySchema),
  shared: z.strictObject({
    position: MeetingPositionSchema,
    participants: z.array(MeetingParticipantProjectionSchema),
    evidence: z.array(SharedEvidenceSchema),
    premises: z.array(SharedPremiseSchema),
    dissent: z.array(SharedDissentSchema),
    actions: z.array(SharedActionSchema),
    decisions: z.array(DecisionSchema),
  }),
  privateWorkspace: z.strictObject({
    sources: z.array(PrivateTextSourceFixtureSchema),
    disclosureCandidates: z.array(DisclosureCandidateSchema),
    inferenceSuggestions: z.array(InferenceSuggestionSchema),
  }),
  ...RequiredCorrelationShape,
});
export const GetRoleProjectionRequestSchema = RoleProjectionQuerySchema;
export const GetRoleProjectionResponseSchema = RoleProjectionResponseSchema;

export type RoleProjectionQuery = z.infer<typeof RoleProjectionQuerySchema>;
export type RoleProjectionResponse = z.infer<
  typeof RoleProjectionResponseSchema
>;
export type GetRoleProjectionRequest = RoleProjectionQuery;
export type GetRoleProjectionResponse = RoleProjectionResponse;

export const RegisterPrivateTextSourceFixtureRequestSchema = z.strictObject({
  ...MeetingMutationShape,
  title: TitleSchema,
  text: NonEmptyTextSchema,
});
export const RegisterPrivateTextSourceFixtureResponseSchema = z.strictObject({
  ...MeetingMutationReceiptShape,
  source: PrivateTextSourceFixtureSchema,
});
export const PrivateTextSourceFixtureRegistrationRequestSchema =
  RegisterPrivateTextSourceFixtureRequestSchema;
export const PrivateTextSourceFixtureRegistrationResponseSchema =
  RegisterPrivateTextSourceFixtureResponseSchema;

export type RegisterPrivateTextSourceFixtureRequest = z.infer<
  typeof RegisterPrivateTextSourceFixtureRequestSchema
>;
export type RegisterPrivateTextSourceFixtureResponse = z.infer<
  typeof RegisterPrivateTextSourceFixtureResponseSchema
>;
export type PrivateTextSourceFixtureRegistrationRequest =
  RegisterPrivateTextSourceFixtureRequest;
export type PrivateTextSourceFixtureRegistrationResponse =
  RegisterPrivateTextSourceFixtureResponse;

export const ProposeDisclosureRequestSchema = z.strictObject({
  ...MeetingMutationShape,
  sourceArtifactId: SourceArtifactIdSchema,
  exactSnippet: NonEmptyTextSchema,
  sourceRange: TextRangeSchema,
});
export const ProposeDisclosureResponseSchema = z.strictObject({
  ...MeetingMutationReceiptShape,
  candidate: DisclosureCandidateSchema,
});
export const PreviewDisclosureRequestSchema = z.strictObject({
  ...MeetingMutationShape,
  candidateId: DisclosureCandidateIdSchema,
  exactSnippet: NonEmptyTextSchema,
  sourceRange: TextRangeSchema,
});
export const PreviewDisclosureResponseSchema = z.strictObject({
  ...MeetingMutationReceiptShape,
  candidateId: DisclosureCandidateIdSchema,
  outgoingPayload: DisclosureOutgoingPayloadSchema,
  previewHash: PreviewHashSchema,
});
export const ApproveDisclosureRequestSchema = z.strictObject({
  ...MeetingMutationShape,
  candidateId: DisclosureCandidateIdSchema,
  previewHash: PreviewHashSchema,
});
export const ApproveDisclosureResponseSchema = z.strictObject({
  ...MeetingMutationReceiptShape,
  candidateId: DisclosureCandidateIdSchema,
  previewHash: PreviewHashSchema,
  evidence: SharedEvidenceSchema,
});
export const RejectDisclosureRequestSchema = z.strictObject({
  ...MeetingMutationShape,
  candidateId: DisclosureCandidateIdSchema,
  reason: NonEmptyTextSchema.optional(),
});
export const RejectDisclosureResponseSchema = z.strictObject({
  ...MeetingMutationReceiptShape,
  candidateId: DisclosureCandidateIdSchema,
  state: z.literal("rejected"),
});

export type ProposeDisclosureRequest = z.infer<
  typeof ProposeDisclosureRequestSchema
>;
export type ProposeDisclosureResponse = z.infer<
  typeof ProposeDisclosureResponseSchema
>;
export type PreviewDisclosureRequest = z.infer<
  typeof PreviewDisclosureRequestSchema
>;
export type PreviewDisclosureResponse = z.infer<
  typeof PreviewDisclosureResponseSchema
>;
export type ApproveDisclosureRequest = z.infer<
  typeof ApproveDisclosureRequestSchema
>;
export type ApproveDisclosureResponse = z.infer<
  typeof ApproveDisclosureResponseSchema
>;
export type RejectDisclosureRequest = z.infer<
  typeof RejectDisclosureRequestSchema
>;
export type RejectDisclosureResponse = z.infer<
  typeof RejectDisclosureResponseSchema
>;

export const InferenceDispositionSchema = z.enum(["confirmed", "rejected"]);
export const DispositionConfirmedInferenceRequestSchema = z.strictObject({
  ...MeetingMutationShape,
  suggestionId: OpaqueIdSchema,
  disposition: InferenceDispositionSchema,
  reason: NonEmptyTextSchema.optional(),
});
export const DispositionConfirmedInferenceResponseSchema = z.strictObject({
  ...MeetingMutationReceiptShape,
  suggestionId: OpaqueIdSchema,
  disposition: InferenceDispositionSchema,
});
export const ConfirmedInferenceDispositionRequestSchema =
  DispositionConfirmedInferenceRequestSchema;
export const ConfirmedInferenceDispositionResponseSchema =
  DispositionConfirmedInferenceResponseSchema;
export const InferenceDispositionRequestSchema =
  DispositionConfirmedInferenceRequestSchema;
export const InferenceDispositionResponseSchema =
  DispositionConfirmedInferenceResponseSchema;

export type InferenceDisposition = z.infer<typeof InferenceDispositionSchema>;
export type DispositionConfirmedInferenceRequest = z.infer<
  typeof DispositionConfirmedInferenceRequestSchema
>;
export type DispositionConfirmedInferenceResponse = z.infer<
  typeof DispositionConfirmedInferenceResponseSchema
>;
export type ConfirmedInferenceDispositionRequest =
  DispositionConfirmedInferenceRequest;
export type ConfirmedInferenceDispositionResponse =
  DispositionConfirmedInferenceResponse;

const DecisionContentShape = {
  title: TitleSchema,
  outcome: NonEmptyTextSchema,
  premiseIds: z.array(PremiseIdSchema),
  evidenceIds: z.array(EvidenceIdSchema),
  dissentIds: z.array(DissentIdSchema),
  actionIds: z.array(ActionIdSchema),
  monitorCondition: MonitorConditionSchema,
} as const;

export const SaveDecisionDraftRequestSchema = z.strictObject({
  ...MeetingMutationShape,
  decisionId: DecisionIdSchema.optional(),
  ...DecisionContentShape,
  changeReason: NonEmptyTextSchema,
});
export const SaveDecisionDraftResponseSchema = z.strictObject({
  ...MeetingMutationReceiptShape,
  decision: DecisionSchema,
  revision: DecisionRevisionSchema,
});
export const MarkDecisionReadyRequestSchema = z.strictObject({
  ...MeetingMutationShape,
  decisionId: DecisionIdSchema,
});
export const MarkDecisionReadyResponseSchema = z.strictObject({
  ...MeetingMutationReceiptShape,
  decision: DecisionSchema,
});
export const CommitDecisionRequestSchema = z.strictObject({
  ...MeetingMutationShape,
  decisionId: DecisionIdSchema,
});
export const CommitDecisionResponseSchema = z.strictObject({
  ...MeetingMutationReceiptShape,
  decision: DecisionSchema,
  revision: DecisionRevisionSchema,
});
export const DecisionHistoryQuerySchema = z.strictObject({
  meetingId: MeetingIdSchema,
  decisionId: DecisionIdSchema,
  ...OptionalCorrelationShape,
});
export const DecisionHistoryResponseSchema = z.strictObject({
  meetingId: MeetingIdSchema,
  decision: DecisionSchema,
  revisions: z.array(DecisionRevisionSchema),
  ...RequiredCorrelationShape,
});
export const DecisionAuditQuerySchema = z.strictObject({
  meetingId: MeetingIdSchema,
  decisionId: DecisionIdSchema.optional(),
  ...OptionalCorrelationShape,
});
export const DecisionAuditResponseSchema = z.strictObject({
  meetingId: MeetingIdSchema,
  entries: z.array(AuditEntrySchema),
  ...RequiredCorrelationShape,
});
export const GetDecisionHistoryRequestSchema = DecisionHistoryQuerySchema;
export const GetDecisionHistoryResponseSchema = DecisionHistoryResponseSchema;
export const GetDecisionAuditRequestSchema = DecisionAuditQuerySchema;
export const GetDecisionAuditResponseSchema = DecisionAuditResponseSchema;

export type SaveDecisionDraftRequest = z.infer<
  typeof SaveDecisionDraftRequestSchema
>;
export type SaveDecisionDraftResponse = z.infer<
  typeof SaveDecisionDraftResponseSchema
>;
export type MarkDecisionReadyRequest = z.infer<
  typeof MarkDecisionReadyRequestSchema
>;
export type MarkDecisionReadyResponse = z.infer<
  typeof MarkDecisionReadyResponseSchema
>;
export type CommitDecisionRequest = z.infer<typeof CommitDecisionRequestSchema>;
export type CommitDecisionResponse = z.infer<
  typeof CommitDecisionResponseSchema
>;
export type DecisionHistoryQuery = z.infer<typeof DecisionHistoryQuerySchema>;
export type DecisionHistoryResponse = z.infer<
  typeof DecisionHistoryResponseSchema
>;
export type DecisionAuditQuery = z.infer<typeof DecisionAuditQuerySchema>;
export type DecisionAuditResponse = z.infer<typeof DecisionAuditResponseSchema>;
export type GetDecisionHistoryRequest = DecisionHistoryQuery;
export type GetDecisionHistoryResponse = DecisionHistoryResponse;
export type GetDecisionAuditRequest = DecisionAuditQuery;
export type GetDecisionAuditResponse = DecisionAuditResponse;

export const HealthRequestSchema = z.strictObject({});
export const HealthResponseSchema = z.strictObject({
  status: z.literal("ok"),
  checkedAt: UtcIsoTimestampSchema,
  protocolVersion: ProtocolVersionSchema,
});
export const DependencyStatusSchema = z.strictObject({
  name: z.enum(["database", "artifact_storage", "realtime", "openai"]),
  status: z.enum(["available", "degraded", "unavailable", "not_configured"]),
  message: z.string().trim().min(1).max(512).optional(),
});
export const ReadinessRequestSchema = z.strictObject({});
export const ReadinessResponseSchema = z.strictObject({
  status: z.enum(["ready", "not_ready"]),
  checkedAt: UtcIsoTimestampSchema,
  protocolVersion: ProtocolVersionSchema,
  migrationsCurrent: z.boolean(),
  dependencies: z.array(DependencyStatusSchema),
});

export type HealthRequest = z.infer<typeof HealthRequestSchema>;
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
export type DependencyStatus = z.infer<typeof DependencyStatusSchema>;
export type ReadinessRequest = z.infer<typeof ReadinessRequestSchema>;
export type ReadinessResponse = z.infer<typeof ReadinessResponseSchema>;
