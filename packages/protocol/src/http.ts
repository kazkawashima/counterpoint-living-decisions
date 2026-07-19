import { z } from "zod";

import { EventTypeSchema } from "./events.js";
import {
  ActionIdSchema,
  CorrelationIdSchema,
  ContentHashSchema,
  DecisionIdSchema,
  DecisionRevisionIdSchema,
  DisclosureCandidateIdSchema,
  DisplayTokenIdSchema,
  DissentIdSchema,
  EvidenceIdSchema,
  EventIdSchema,
  ExternalEventIdSchema,
  IdempotencyKeySchema,
  MeetingIdSchema,
  MeetingPositionSchema,
  MonitorRegistrationIdSchema,
  OpaqueIdSchema,
  ParticipantIdSchema,
  PremiseIdSchema,
  ReconsiderationTaskIdSchema,
  ResetRequestIdSchema,
  ServerDerivedActorSchema,
  SourceArtifactIdSchema,
  UtteranceIdSchema,
  UserIdSchema,
  UtcIsoTimestampSchema,
} from "./primitives.js";
import { ProtocolVersionSchema } from "./versions.js";

export const HTTP_API_V1_PREFIX = "/api/v1" as const;
export const HTTP_API_VERSION_PREFIX = HTTP_API_V1_PREFIX;

const TITLE_MAX_LENGTH = 256;
const TEXT_MAX_LENGTH = 20 * 1024 * 1024;
const REVIEW_REASON_MAX_LENGTH = 4096;

const NonEmptyTextSchema = z.string().trim().min(1).max(TEXT_MAX_LENGTH);
const TitleSchema = z.string().trim().min(1).max(TITLE_MAX_LENGTH);
const ReviewReasonSchema = z
  .string()
  .trim()
  .min(1)
  .max(REVIEW_REASON_MAX_LENGTH);
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
export const PrivateArtifactSchema = z.strictObject({
  sourceArtifactId: SourceArtifactIdSchema,
  derivedArtifactId: SourceArtifactIdSchema.optional(),
  filename: TitleSchema,
  contentType: z.string().trim().min(1).max(256),
  sourceContentHash: ContentHashSchema,
  derivedContentHash: ContentHashSchema.optional(),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(20 * 1024 * 1024),
  derivedSizeBytes: z
    .number()
    .int()
    .positive()
    .max(20 * 1024 * 1024)
    .optional(),
  processingState: z.enum(["processed", "failed"]),
  failureCode: z.string().trim().min(1).max(256).optional(),
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
export type PrivateArtifact = z.infer<typeof PrivateArtifactSchema>;
export type DisclosureOutgoingPayload = z.infer<
  typeof DisclosureOutgoingPayloadSchema
>;
export type DisclosureCandidate = z.infer<typeof DisclosureCandidateSchema>;
export type InferenceSuggestion = z.infer<typeof InferenceSuggestionSchema>;

const UtteranceTextSchema = z.string().min(1).max(4000);
export const UtteranceChannelSchema = z.enum(["private", "shared"]);
export const CapturedUtteranceSchema = z.strictObject({
  utteranceId: UtteranceIdSchema,
  participantId: ParticipantIdSchema,
  channel: UtteranceChannelSchema,
  text: UtteranceTextSchema,
  capturedAt: UtcIsoTimestampSchema,
});
export const SharedFloorProjectionSchema = z.strictObject({
  participantId: ParticipantIdSchema,
  leaseExpiresAt: UtcIsoTimestampSchema,
});

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
  supersededByDecisionId: DecisionIdSchema.optional(),
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
export const ListSharedDecisionsResponseSchema = z.strictObject({
  decisions: z.array(DecisionSchema),
  meetingId: MeetingIdSchema,
  position: MeetingPositionSchema,
  ...RequiredCorrelationShape,
});
export type ListSharedDecisionsResponse = z.infer<
  typeof ListSharedDecisionsResponseSchema
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
    utterances: z.array(CapturedUtteranceSchema),
    sharedFloor: SharedFloorProjectionSchema.nullable(),
  }),
  privateWorkspace: z.strictObject({
    artifacts: z.array(PrivateArtifactSchema),
    sources: z.array(PrivateTextSourceFixtureSchema),
    disclosureCandidates: z.array(DisclosureCandidateSchema),
    inferenceSuggestions: z.array(InferenceSuggestionSchema),
    utterances: z.array(CapturedUtteranceSchema),
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

const ByokApiKeySchema = z.string().min(20).max(4096);
const RealtimeClientSecretSchema = z.string().min(1).max(4096);
const RealtimeModelSchema = z.string().trim().min(1).max(256);

export const RealtimeChannelSchema = z.enum(["private", "shared"]);

export const ConfigureMeetingByokRequestSchema = z.strictObject({
  meetingId: MeetingIdSchema,
  apiKey: ByokApiKeySchema,
  ...OptionalCorrelationShape,
});
export const ConfigureMeetingByokResponseSchema = z.strictObject({
  meetingId: MeetingIdSchema,
  configured: z.literal(true),
  keySource: z.literal("byok"),
  ...RequiredCorrelationShape,
});
export const HeartbeatMeetingByokRequestSchema = z.strictObject({
  meetingId: MeetingIdSchema,
  ...OptionalCorrelationShape,
});
export const HeartbeatMeetingByokResponseSchema = z.strictObject({
  meetingId: MeetingIdSchema,
  active: z.literal(true),
  ...RequiredCorrelationShape,
});
export const ClearMeetingByokRequestSchema = z.strictObject({
  meetingId: MeetingIdSchema,
  ...OptionalCorrelationShape,
});
export const ClearMeetingByokResponseSchema = z.strictObject({
  meetingId: MeetingIdSchema,
  cleared: z.literal(true),
  ...RequiredCorrelationShape,
});
export const IssueRealtimeClientSecretRequestSchema = z.strictObject({
  meetingId: MeetingIdSchema,
  channel: RealtimeChannelSchema,
  ...OptionalCorrelationShape,
});
export const IssueRealtimeClientSecretResponseSchema = z.strictObject({
  meetingId: MeetingIdSchema,
  channel: RealtimeChannelSchema,
  clientSecret: RealtimeClientSecretSchema,
  expiresAt: UtcIsoTimestampSchema,
  model: RealtimeModelSchema,
  ...RequiredCorrelationShape,
});

export type RealtimeChannel = z.infer<typeof RealtimeChannelSchema>;
export type ConfigureMeetingByokRequest = z.infer<
  typeof ConfigureMeetingByokRequestSchema
>;
export type ConfigureMeetingByokResponse = z.infer<
  typeof ConfigureMeetingByokResponseSchema
>;
export type HeartbeatMeetingByokRequest = z.infer<
  typeof HeartbeatMeetingByokRequestSchema
>;
export type HeartbeatMeetingByokResponse = z.infer<
  typeof HeartbeatMeetingByokResponseSchema
>;
export type ClearMeetingByokRequest = z.infer<
  typeof ClearMeetingByokRequestSchema
>;
export type ClearMeetingByokResponse = z.infer<
  typeof ClearMeetingByokResponseSchema
>;
export type IssueRealtimeClientSecretRequest = z.infer<
  typeof IssueRealtimeClientSecretRequestSchema
>;
export type IssueRealtimeClientSecretResponse = z.infer<
  typeof IssueRealtimeClientSecretResponseSchema
>;

export const AcquireSharedFloorRequestSchema = z.strictObject({
  meetingId: MeetingIdSchema,
  utteranceId: UtteranceIdSchema,
  ...OptionalCorrelationShape,
});
export const AcquireSharedFloorResponseSchema = z.strictObject({
  meetingId: MeetingIdSchema,
  utteranceId: UtteranceIdSchema,
  participantId: ParticipantIdSchema,
  leaseExpiresAt: UtcIsoTimestampSchema,
  ...RequiredCorrelationShape,
});
export const ReleaseSharedFloorRequestSchema = z.strictObject({
  meetingId: MeetingIdSchema,
  utteranceId: UtteranceIdSchema,
});
export const ReleaseSharedFloorResponseSchema = z.strictObject({
  meetingId: MeetingIdSchema,
  utteranceId: UtteranceIdSchema,
  releasedAt: UtcIsoTimestampSchema,
  ...RequiredCorrelationShape,
});
export const CaptureUtteranceRequestSchema = z.strictObject({
  meetingId: MeetingIdSchema,
  utteranceId: UtteranceIdSchema,
  channel: UtteranceChannelSchema,
  text: UtteranceTextSchema,
  capturedAt: UtcIsoTimestampSchema,
});
export const CaptureUtteranceResponseSchema = z.strictObject({
  meetingId: MeetingIdSchema,
  utterance: CapturedUtteranceSchema,
  replayed: z.boolean(),
  position: MeetingPositionSchema,
  ...RequiredCorrelationShape,
});

export type UtteranceChannel = z.infer<typeof UtteranceChannelSchema>;
export type AcquireSharedFloorRequest = z.infer<
  typeof AcquireSharedFloorRequestSchema
>;
export type AcquireSharedFloorResponse = z.infer<
  typeof AcquireSharedFloorResponseSchema
>;
export type ReleaseSharedFloorRequest = z.infer<
  typeof ReleaseSharedFloorRequestSchema
>;
export type ReleaseSharedFloorResponse = z.infer<
  typeof ReleaseSharedFloorResponseSchema
>;
export type CaptureUtteranceRequest = z.infer<
  typeof CaptureUtteranceRequestSchema
>;
export type CapturedUtterance = z.infer<typeof CapturedUtteranceSchema>;
export type CaptureUtteranceResponse = z.infer<
  typeof CaptureUtteranceResponseSchema
>;

const DisplayTokenSchema = z.string().min(1).max(4096);

export const IssueDisplayTokenRequestSchema = z.strictObject({
  meetingId: MeetingIdSchema,
  expectedPosition: MeetingPositionSchema,
  ...OptionalCorrelationShape,
});
export const IssueDisplayTokenResponseSchema = z.strictObject({
  meetingId: MeetingIdSchema,
  displayTokenId: DisplayTokenIdSchema,
  displayToken: DisplayTokenSchema,
  expiresAt: UtcIsoTimestampSchema,
  position: MeetingPositionSchema,
  ...RequiredCorrelationShape,
});
export const RevokeDisplayTokenRequestSchema = z.strictObject({
  meetingId: MeetingIdSchema,
  displayTokenId: DisplayTokenIdSchema,
  expectedPosition: MeetingPositionSchema,
  ...OptionalCorrelationShape,
});
export const RevokeDisplayTokenResponseSchema = z.strictObject({
  meetingId: MeetingIdSchema,
  displayTokenId: DisplayTokenIdSchema,
  revokedAt: UtcIsoTimestampSchema,
  position: MeetingPositionSchema,
  ...RequiredCorrelationShape,
});
export const SharedDisplayProjectionResponseSchema = z.strictObject({
  meeting: z.strictObject({
    meetingId: MeetingIdSchema,
    purpose: NonEmptyTextSchema,
    phase: MeetingPhaseSchema,
  }),
  shared: z.strictObject({
    position: MeetingPositionSchema,
    evidence: z.array(SharedEvidenceSchema),
    premises: z.array(SharedPremiseSchema),
    dissent: z.array(SharedDissentSchema),
    actions: z.array(SharedActionSchema),
    decisions: z.array(DecisionSchema),
  }),
  expiresAt: UtcIsoTimestampSchema,
  ...RequiredCorrelationShape,
});

export type IssueDisplayTokenRequest = z.infer<
  typeof IssueDisplayTokenRequestSchema
>;
export type IssueDisplayTokenResponse = z.infer<
  typeof IssueDisplayTokenResponseSchema
>;
export type RevokeDisplayTokenRequest = z.infer<
  typeof RevokeDisplayTokenRequestSchema
>;
export type RevokeDisplayTokenResponse = z.infer<
  typeof RevokeDisplayTokenResponseSchema
>;
export type SharedDisplayProjectionResponse = z.infer<
  typeof SharedDisplayProjectionResponseSchema
>;

export const RegisterPrivateTextSourceFixtureRequestSchema = z.strictObject({
  ...MeetingMutationShape,
  title: TitleSchema,
  text: NonEmptyTextSchema,
});
export const RegisterPrivateTextSourceFixtureResponseSchema = z.strictObject({
  ...MeetingMutationReceiptShape,
  source: PrivateTextSourceFixtureSchema,
});
export const UploadPrivateArtifactFieldsSchema = z.strictObject({
  meetingId: MeetingIdSchema,
  idempotencyKey: IdempotencyKeySchema,
  ...OptionalCorrelationShape,
});
export const UploadPrivateArtifactResponseSchema = z.strictObject({
  ...MeetingMutationReceiptShape,
  artifact: PrivateArtifactSchema,
});
export const DownloadPrivateArtifactQuerySchema = z.strictObject({
  artifactId: SourceArtifactIdSchema,
  meetingId: MeetingIdSchema,
  representation: z.enum(["source", "derived"]).default("source"),
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
export type UploadPrivateArtifactFields = z.infer<
  typeof UploadPrivateArtifactFieldsSchema
>;
export type UploadPrivateArtifactResponse = z.infer<
  typeof UploadPrivateArtifactResponseSchema
>;
export type DownloadPrivateArtifactQuery = z.infer<
  typeof DownloadPrivateArtifactQuerySchema
>;

export const DisclosureAssistanceSchema = z.enum(["ai_preferred", "manual"]);
export const DisclosureProposalOriginSchema = z.enum([
  "ai_assisted",
  "human_selected",
]);
export const ProposeDisclosureRequestSchema = z.strictObject({
  ...MeetingMutationShape,
  assistance: DisclosureAssistanceSchema.default("manual"),
  sourceArtifactId: SourceArtifactIdSchema,
  exactSnippet: NonEmptyTextSchema,
  sourceRange: TextRangeSchema,
});
export const ProposeDisclosureResponseSchema = z.strictObject({
  ...MeetingMutationReceiptShape,
  candidate: DisclosureCandidateSchema,
  origin: DisclosureProposalOriginSchema,
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

const ProvenanceValueSchema = z.string().trim().min(1).max(256);
const ConciseReasonSchema = z.string().trim().min(1).max(1_000);

export const DecisionSynthesisAssistanceSchema = z.enum([
  "ai_preferred",
  "manual",
]);
export const SharedDecisionCandidateOriginSchema = z.enum([
  "ai_assisted",
  "human_authored",
]);
export const AiAssistedDecisionCandidateProvenanceSchema = z.strictObject({
  origin: z.literal("ai_assisted"),
  model: ProvenanceValueSchema,
  operation: ProvenanceValueSchema,
  promptVersion: ProvenanceValueSchema,
  schemaVersion: ProvenanceValueSchema,
  inputReferenceIds: z.array(EvidenceIdSchema).min(1),
  generatedAt: UtcIsoTimestampSchema,
  confidence: z.number().min(0).max(1),
  reason: ConciseReasonSchema,
});
export const HumanAuthoredDecisionCandidateProvenanceSchema = z.strictObject({
  origin: z.literal("human_authored"),
});
export const SharedDecisionCandidateProvenanceSchema = z.discriminatedUnion(
  "origin",
  [
    AiAssistedDecisionCandidateProvenanceSchema,
    HumanAuthoredDecisionCandidateProvenanceSchema,
  ],
);
export const SharedDecisionPremiseInputSchema = z.strictObject({
  statement: NonEmptyTextSchema,
  evidenceReferenceIds: z.array(EvidenceIdSchema).min(1),
});
export const SharedDecisionActionInputSchema = z.strictObject({
  ownerParticipantId: ParticipantIdSchema,
  scope: z.array(NonEmptyTextSchema).min(1),
});
export const SharedDecisionDissentInputSchema = z.strictObject({
  reason: NonEmptyTextSchema,
  retained: z.boolean(),
});
export const SharedDecisionPremiseCandidateSchema =
  SharedDecisionPremiseInputSchema.extend({
    candidateId: OpaqueIdSchema,
    confidence: z.number().min(0).max(1),
    reason: NonEmptyTextSchema,
  });
export const SharedDecisionActionCandidateSchema =
  SharedDecisionActionInputSchema.extend({
    candidateId: OpaqueIdSchema,
  });
export const SharedDecisionDissentCandidateSchema =
  SharedDecisionDissentInputSchema.extend({
    candidateId: OpaqueIdSchema,
  });
export const SharedDecisionCandidateMonitorConditionSchema = z.strictObject({
  description: NonEmptyTextSchema,
});
export const SharedDecisionCandidateDraftSchema = z.strictObject({
  title: TitleSchema,
  outcome: NonEmptyTextSchema,
  premiseCandidates: z.array(SharedDecisionPremiseCandidateSchema).min(1),
  dissentCandidates: z.array(SharedDecisionDissentCandidateSchema),
  actionCandidates: z.array(SharedDecisionActionCandidateSchema),
  monitorCondition: SharedDecisionCandidateMonitorConditionSchema,
});
export const ManualSharedDecisionDraftInputSchema = z.strictObject({
  title: TitleSchema,
  outcome: NonEmptyTextSchema,
  premises: z.array(SharedDecisionPremiseInputSchema).min(1),
  dissent: z.array(SharedDecisionDissentInputSchema),
  actions: z.array(SharedDecisionActionInputSchema),
  monitorCondition: SharedDecisionCandidateMonitorConditionSchema,
});
export const SharedDecisionSynthesisCandidateSchema = z.strictObject({
  candidateId: OpaqueIdSchema,
  provenance: SharedDecisionCandidateProvenanceSchema,
  draft: SharedDecisionCandidateDraftSchema,
});
export const AiPreferredSharedDecisionSynthesisRequestSchema = z.strictObject({
  ...MeetingMutationShape,
  assistance: z.literal("ai_preferred"),
});
export const ManualSharedDecisionSynthesisRequestSchema = z.strictObject({
  ...MeetingMutationShape,
  assistance: z.literal("manual"),
  draft: ManualSharedDecisionDraftInputSchema,
});
export const SynthesizeSharedDecisionRequestSchema = z.discriminatedUnion(
  "assistance",
  [
    AiPreferredSharedDecisionSynthesisRequestSchema,
    ManualSharedDecisionSynthesisRequestSchema,
  ],
);
export const SynthesizeSharedDecisionResponseSchema = z.strictObject({
  ...MeetingMutationReceiptShape,
  candidate: SharedDecisionSynthesisCandidateSchema,
});
export const SharedDecisionSynthesisRequestSchema =
  SynthesizeSharedDecisionRequestSchema;
export const SharedDecisionSynthesisResponseSchema =
  SynthesizeSharedDecisionResponseSchema;

export const ConfirmedPremiseCandidateDispositionSchema = z.strictObject({
  candidateId: OpaqueIdSchema,
  disposition: z.literal("confirmed"),
  premise: SharedDecisionPremiseInputSchema,
});
export const RejectedPremiseCandidateDispositionSchema = z.strictObject({
  candidateId: OpaqueIdSchema,
  disposition: z.literal("rejected"),
  reason: NonEmptyTextSchema.optional(),
});
export const PremiseCandidateDispositionSchema = z.discriminatedUnion(
  "disposition",
  [
    ConfirmedPremiseCandidateDispositionSchema,
    RejectedPremiseCandidateDispositionSchema,
  ],
);
export const DispositionSharedDecisionCandidateRequestSchema = z
  .strictObject({
    ...MeetingMutationShape,
    candidateId: OpaqueIdSchema,
    title: TitleSchema,
    outcome: NonEmptyTextSchema,
    premiseDispositions: z.array(PremiseCandidateDispositionSchema).min(1),
    dissent: z.array(SharedDecisionDissentInputSchema),
    actions: z.array(SharedDecisionActionInputSchema),
    monitorCondition: SharedDecisionCandidateMonitorConditionSchema,
    reason: NonEmptyTextSchema.optional(),
  })
  .superRefine(({ premiseDispositions }, context) => {
    const candidateIds = premiseDispositions.map(
      ({ candidateId }) => candidateId,
    );
    if (new Set(candidateIds).size !== candidateIds.length) {
      context.addIssue({
        code: "custom",
        message: "premise candidate dispositions must be unique",
        path: ["premiseDispositions"],
      });
    }
  });
export const DispositionSharedDecisionCandidateResponseSchema = z.strictObject({
  ...MeetingMutationReceiptShape,
  candidateId: OpaqueIdSchema,
  premiseDispositions: z.array(
    z.strictObject({
      candidateId: OpaqueIdSchema,
      disposition: z.enum(["confirmed", "rejected"]),
    }),
  ),
  premises: z.array(SharedPremiseSchema),
  dissent: z.array(SharedDissentSchema),
  actions: z.array(SharedActionSchema),
});
export const SharedDecisionCandidateDispositionRequestSchema =
  DispositionSharedDecisionCandidateRequestSchema;
export const SharedDecisionCandidateDispositionResponseSchema =
  DispositionSharedDecisionCandidateResponseSchema;

export type DecisionSynthesisAssistance = z.infer<
  typeof DecisionSynthesisAssistanceSchema
>;
export type SharedDecisionCandidateOrigin = z.infer<
  typeof SharedDecisionCandidateOriginSchema
>;
export type AiAssistedDecisionCandidateProvenance = z.infer<
  typeof AiAssistedDecisionCandidateProvenanceSchema
>;
export type HumanAuthoredDecisionCandidateProvenance = z.infer<
  typeof HumanAuthoredDecisionCandidateProvenanceSchema
>;
export type SharedDecisionCandidateProvenance = z.infer<
  typeof SharedDecisionCandidateProvenanceSchema
>;
export type SharedDecisionPremiseInput = z.infer<
  typeof SharedDecisionPremiseInputSchema
>;
export type SharedDecisionActionInput = z.infer<
  typeof SharedDecisionActionInputSchema
>;
export type SharedDecisionDissentInput = z.infer<
  typeof SharedDecisionDissentInputSchema
>;
export type SharedDecisionPremiseCandidate = z.infer<
  typeof SharedDecisionPremiseCandidateSchema
>;
export type SharedDecisionActionCandidate = z.infer<
  typeof SharedDecisionActionCandidateSchema
>;
export type SharedDecisionDissentCandidate = z.infer<
  typeof SharedDecisionDissentCandidateSchema
>;
export type SharedDecisionCandidateMonitorCondition = z.infer<
  typeof SharedDecisionCandidateMonitorConditionSchema
>;
export type SharedDecisionCandidateDraft = z.infer<
  typeof SharedDecisionCandidateDraftSchema
>;
export type ManualSharedDecisionDraftInput = z.infer<
  typeof ManualSharedDecisionDraftInputSchema
>;
export type SharedDecisionSynthesisCandidate = z.infer<
  typeof SharedDecisionSynthesisCandidateSchema
>;
export type AiPreferredSharedDecisionSynthesisRequest = z.infer<
  typeof AiPreferredSharedDecisionSynthesisRequestSchema
>;
export type ManualSharedDecisionSynthesisRequest = z.infer<
  typeof ManualSharedDecisionSynthesisRequestSchema
>;
export type SynthesizeSharedDecisionRequest = z.infer<
  typeof SynthesizeSharedDecisionRequestSchema
>;
export type SynthesizeSharedDecisionResponse = z.infer<
  typeof SynthesizeSharedDecisionResponseSchema
>;
export type SharedDecisionSynthesisRequest = SynthesizeSharedDecisionRequest;
export type SharedDecisionSynthesisResponse = SynthesizeSharedDecisionResponse;
export type ConfirmedPremiseCandidateDisposition = z.infer<
  typeof ConfirmedPremiseCandidateDispositionSchema
>;
export type RejectedPremiseCandidateDisposition = z.infer<
  typeof RejectedPremiseCandidateDispositionSchema
>;
export type PremiseCandidateDisposition = z.infer<
  typeof PremiseCandidateDispositionSchema
>;
export type DispositionSharedDecisionCandidateRequest = z.infer<
  typeof DispositionSharedDecisionCandidateRequestSchema
>;
export type DispositionSharedDecisionCandidateResponse = z.infer<
  typeof DispositionSharedDecisionCandidateResponseSchema
>;
export type SharedDecisionCandidateDispositionRequest =
  DispositionSharedDecisionCandidateRequest;
export type SharedDecisionCandidateDispositionResponse =
  DispositionSharedDecisionCandidateResponse;

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
export const StartDecisionMonitoringRequestSchema = z.strictObject({
  ...MeetingMutationShape,
  decisionId: DecisionIdSchema,
});
export const StartDecisionMonitoringResponseSchema = z.strictObject({
  ...MeetingMutationReceiptShape,
  decision: DecisionSchema,
  monitorRegistrationId: MonitorRegistrationIdSchema,
});
export const RegulatoryChangeWebhookRequestSchema = z.strictObject({
  description: NonEmptyTextSchema,
  effectiveAt: UtcIsoTimestampSchema,
  eventId: ExternalEventIdSchema,
  eventType: z.literal("regulatory_change"),
  jurisdiction: NonEmptyTextSchema,
  meetingId: MeetingIdSchema,
  monitorRegistrationId: MonitorRegistrationIdSchema,
  schemaVersion: z.literal(1),
  source: NonEmptyTextSchema,
  sourceReference: NonEmptyTextSchema,
});
export const ExternalEventReceiptSchema = z.strictObject({
  description: NonEmptyTextSchema,
  effectiveAt: UtcIsoTimestampSchema,
  eventId: ExternalEventIdSchema,
  eventType: NonEmptyTextSchema,
  jurisdiction: NonEmptyTextSchema,
  meetingId: MeetingIdSchema,
  monitorRegistrationId: MonitorRegistrationIdSchema,
  payloadHash: ContentHashSchema,
  receivedAt: UtcIsoTimestampSchema,
  schemaVersion: z.literal(1),
  source: NonEmptyTextSchema,
  sourceReference: NonEmptyTextSchema,
});
export const RegulatoryChangeWebhookResponseSchema = z.strictObject({
  ...RequiredCorrelationShape,
  evaluationStatus: z.literal("pending"),
  event: ExternalEventReceiptSchema,
  position: MeetingPositionSchema,
  replayed: z.boolean(),
  receiptStatus: z.literal("received"),
});
export const ListSharedExternalEventsResponseSchema = z.strictObject({
  events: z.array(ExternalEventReceiptSchema),
  meetingId: MeetingIdSchema,
  position: MeetingPositionSchema,
  ...RequiredCorrelationShape,
});
export const InjectDemoRegulatoryChangeRequestSchema = z.strictObject({
  idempotencyKey: IdempotencyKeySchema,
  ...OptionalCorrelationShape,
});
export const InjectDemoRegulatoryChangeResponseSchema =
  RegulatoryChangeWebhookResponseSchema;
export const DemoResetStatusSchema = z.literal("completed");
export const FacilitatorDemoResetRequestSchema = z.strictObject({
  ...MeetingMutationShape,
});
export const FacilitatorDemoResetResponseSchema = z.strictObject({
  ...MeetingMutationReceiptShape,
  resetRequestId: ResetRequestIdSchema,
  resetStatus: DemoResetStatusSchema,
});
export const ReconsiderationTaskSchema = z.strictObject({
  reconsiderationTaskId: ReconsiderationTaskIdSchema,
  decisionId: DecisionIdSchema,
  triggerExternalEventId: ExternalEventIdSchema,
  ownerParticipantId: ParticipantIdSchema,
  affectedPremiseIds: z.array(PremiseIdSchema).min(1),
  affectedActionIds: z.array(ActionIdSchema).min(1),
  state: z.enum(["open", "in_progress", "completed", "cancelled"]),
  createdAt: UtcIsoTimestampSchema,
});
export const InvalidationEvaluationSchema = z.strictObject({
  affectedActionIds: z.array(ActionIdSchema).min(1),
  affectedPremiseIds: z.array(PremiseIdSchema).min(1),
  confidence: z.number().min(0).max(1),
  decision: DecisionSchema,
  evidenceReferenceIds: z.array(OpaqueIdSchema).min(1),
  externalEventId: ExternalEventIdSchema,
  generatedAt: UtcIsoTimestampSchema,
  inputReferenceIds: z.array(OpaqueIdSchema).min(1),
  model: NonEmptyTextSchema,
  operation: z.literal("assumption_invalidation"),
  outputSchemaVersion: z.literal("1"),
  promptVersion: NonEmptyTextSchema,
  reason: NonEmptyTextSchema,
  review: z
    .strictObject({
      disposition: z.enum(["confirm_invalidation", "reject_suggestion"]),
      facilitatorParticipantId: ParticipantIdSchema,
      heldActionIds: z.array(ActionIdSchema),
      reason: ReviewReasonSchema,
      reconsiderationTask: ReconsiderationTaskSchema.optional(),
      reviewedAt: UtcIsoTimestampSchema,
    })
    .optional(),
  suggestionId: OpaqueIdSchema,
});
export const InvalidationReviewDispositionSchema = z.enum([
  "confirm_invalidation",
  "reject_suggestion",
]);
export const ReviewInvalidationRequestSchema = z.strictObject({
  ...MeetingMutationShape,
  decisionId: DecisionIdSchema,
  suggestionId: OpaqueIdSchema,
  disposition: InvalidationReviewDispositionSchema,
  reason: ReviewReasonSchema,
});

const ReviewInvalidationResponseShape = {
  ...MeetingMutationReceiptShape,
  suggestionId: OpaqueIdSchema,
  reviewReason: ReviewReasonSchema,
  reviewEventId: EventIdSchema,
  reviewAuditId: OpaqueIdSchema,
} as const;
const ReviewRequiredDecisionSchema = DecisionSchema.extend({
  status: z.literal("REVIEW_REQUIRED"),
  snapshot: DecisionSnapshotSchema.extend({
    status: z.literal("REVIEW_REQUIRED"),
  }),
});
const MonitoringDecisionSchema = DecisionSchema.extend({
  status: z.literal("MONITORING"),
  snapshot: DecisionSnapshotSchema.extend({
    status: z.literal("MONITORING"),
  }),
});
export const ConfirmInvalidationReviewResponseSchema = z.strictObject({
  ...ReviewInvalidationResponseShape,
  disposition: z.literal("confirm_invalidation"),
  decision: ReviewRequiredDecisionSchema,
  heldActionIds: z.array(ActionIdSchema).min(1),
  reconsiderationTask: ReconsiderationTaskSchema,
});
export const RejectInvalidationReviewResponseSchema = z.strictObject({
  ...ReviewInvalidationResponseShape,
  disposition: z.literal("reject_suggestion"),
  decision: MonitoringDecisionSchema,
});
export const ReviewInvalidationResponseSchema = z.discriminatedUnion(
  "disposition",
  [
    ConfirmInvalidationReviewResponseSchema,
    RejectInvalidationReviewResponseSchema,
  ],
);
export const FacilitatorInvalidationReviewRequestSchema =
  ReviewInvalidationRequestSchema;
export const FacilitatorInvalidationReviewResponseSchema =
  ReviewInvalidationResponseSchema;

export const DecisionReviewResolutionSchema = z.enum([
  "recommit_revision",
  "supersede_decision",
  "reject_decision",
]);
const DecisionReviewRequestShape = {
  ...MeetingMutationShape,
  decisionId: DecisionIdSchema,
} as const;
export const RecommitDecisionRevisionRequestSchema = z.strictObject({
  ...DecisionReviewRequestShape,
  resolution: z.literal("recommit_revision"),
  changeReason: NonEmptyTextSchema,
  title: TitleSchema,
  outcome: NonEmptyTextSchema,
  monitorCondition: z.strictObject({
    description: NonEmptyTextSchema,
  }),
});
export const SupersedeDecisionRequestSchema = z
  .strictObject({
    ...DecisionReviewRequestShape,
    resolution: z.literal("supersede_decision"),
    replacementDecisionId: DecisionIdSchema,
  })
  .refine(
    ({ decisionId, replacementDecisionId }) =>
      decisionId !== replacementDecisionId,
    {
      message: "replacement Decision must differ from the reviewed Decision",
      path: ["replacementDecisionId"],
    },
  );
export const RejectDecisionRequestSchema = z.strictObject({
  ...DecisionReviewRequestShape,
  resolution: z.literal("reject_decision"),
  reason: ReviewReasonSchema,
});
export const ResolveDecisionReviewRequestSchema = z.discriminatedUnion(
  "resolution",
  [
    RecommitDecisionRevisionRequestSchema,
    SupersedeDecisionRequestSchema,
    RejectDecisionRequestSchema,
  ],
);

const CommittedDecisionSchema = DecisionSchema.extend({
  status: z.literal("COMMITTED"),
  snapshot: DecisionSnapshotSchema.extend({
    status: z.literal("COMMITTED"),
  }),
});
const CommittedDecisionRevisionSchema = DecisionRevisionSchema.extend({
  previousRevisionId: DecisionRevisionIdSchema,
  snapshot: DecisionSnapshotSchema.extend({
    status: z.literal("COMMITTED"),
  }),
});
const SupersededDecisionSchema = DecisionSchema.extend({
  status: z.literal("SUPERSEDED"),
  snapshot: DecisionSnapshotSchema.extend({
    status: z.literal("SUPERSEDED"),
  }),
});
const RejectedDecisionSchema = DecisionSchema.extend({
  status: z.literal("REJECTED"),
  snapshot: DecisionSnapshotSchema.extend({
    status: z.literal("REJECTED"),
  }),
});
const DecisionReviewResponseShape = {
  ...MeetingMutationReceiptShape,
} as const;
export const RecommitDecisionRevisionResponseSchema = z
  .strictObject({
    ...DecisionReviewResponseShape,
    resolution: z.literal("recommit_revision"),
    decision: CommittedDecisionSchema,
    revision: CommittedDecisionRevisionSchema,
  })
  .superRefine(({ decision, revision }, context) => {
    if (
      revision.decisionId !== decision.decisionId ||
      revision.revisionId !== decision.activeRevisionId ||
      revision.version !== decision.activeRevision
    ) {
      context.addIssue({
        code: "custom",
        message:
          "committed revision must be the Decision's new active revision",
        path: ["revision"],
      });
    }
  });
export const SupersedeDecisionResponseSchema = z
  .strictObject({
    ...DecisionReviewResponseShape,
    resolution: z.literal("supersede_decision"),
    decision: SupersededDecisionSchema,
    replacementDecisionId: DecisionIdSchema,
  })
  .refine(
    ({ decision, replacementDecisionId }) =>
      decision.decisionId !== replacementDecisionId,
    {
      message: "replacement Decision must differ from the superseded Decision",
      path: ["replacementDecisionId"],
    },
  );
export const RejectDecisionResponseSchema = z.strictObject({
  ...DecisionReviewResponseShape,
  resolution: z.literal("reject_decision"),
  decision: RejectedDecisionSchema,
  reason: ReviewReasonSchema,
});
export const ResolveDecisionReviewResponseSchema = z.discriminatedUnion(
  "resolution",
  [
    RecommitDecisionRevisionResponseSchema,
    SupersedeDecisionResponseSchema,
    RejectDecisionResponseSchema,
  ],
);

export const ListInvalidationEvaluationsResponseSchema = z.strictObject({
  ...MeetingMutationReceiptShape,
  evaluations: z.array(InvalidationEvaluationSchema),
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
export const DecisionJsonExportQuerySchema = z.strictObject({
  meetingId: MeetingIdSchema,
  decisionId: DecisionIdSchema,
  ...OptionalCorrelationShape,
});
export const DecisionJsonExportResponseSchema = z
  .strictObject({
    meetingId: MeetingIdSchema,
    decision: DecisionSchema,
    revisions: z.array(DecisionRevisionSchema).min(1),
    auditEntries: z.array(AuditEntrySchema),
    exportedAt: UtcIsoTimestampSchema,
    ...RequiredCorrelationShape,
  })
  .superRefine(({ auditEntries, decision, meetingId, revisions }, context) => {
    const revisionIds = new Set<string>();
    const revisionVersions = new Set<number>();
    let includesActiveRevision = false;

    for (const [index, revision] of revisions.entries()) {
      if (revision.decisionId !== decision.decisionId) {
        context.addIssue({
          code: "custom",
          message: "export revisions must belong to the exported Decision",
          path: ["revisions", index, "decisionId"],
        });
      }
      if (
        revision.revisionId === decision.activeRevisionId &&
        revision.version === decision.activeRevision
      ) {
        includesActiveRevision = true;
      }
      if (revisionIds.has(revision.revisionId)) {
        context.addIssue({
          code: "custom",
          message: "export revisions must have unique revision IDs",
          path: ["revisions", index, "revisionId"],
        });
      }
      if (revisionVersions.has(revision.version)) {
        context.addIssue({
          code: "custom",
          message: "export revisions must have unique versions",
          path: ["revisions", index, "version"],
        });
      }
      revisionIds.add(revision.revisionId);
      revisionVersions.add(revision.version);
    }

    if (!includesActiveRevision) {
      context.addIssue({
        code: "custom",
        message: "export revisions must include the active Decision revision",
        path: ["revisions"],
      });
    }

    for (const [index, entry] of auditEntries.entries()) {
      if (entry.meetingId !== meetingId) {
        context.addIssue({
          code: "custom",
          message: "export audit entries must belong to the exported meeting",
          path: ["auditEntries", index, "meetingId"],
        });
      }
    }
  });
export const GetDecisionHistoryRequestSchema = DecisionHistoryQuerySchema;
export const GetDecisionHistoryResponseSchema = DecisionHistoryResponseSchema;
export const GetDecisionAuditRequestSchema = DecisionAuditQuerySchema;
export const GetDecisionAuditResponseSchema = DecisionAuditResponseSchema;
export const ExportDecisionJsonRequestSchema = DecisionJsonExportQuerySchema;
export const ExportDecisionJsonResponseSchema =
  DecisionJsonExportResponseSchema;

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
export type StartDecisionMonitoringRequest = z.infer<
  typeof StartDecisionMonitoringRequestSchema
>;
export type StartDecisionMonitoringResponse = z.infer<
  typeof StartDecisionMonitoringResponseSchema
>;
export type RegulatoryChangeWebhookRequest = z.infer<
  typeof RegulatoryChangeWebhookRequestSchema
>;
export type ExternalEventReceipt = z.infer<typeof ExternalEventReceiptSchema>;
export type RegulatoryChangeWebhookResponse = z.infer<
  typeof RegulatoryChangeWebhookResponseSchema
>;
export type ListSharedExternalEventsResponse = z.infer<
  typeof ListSharedExternalEventsResponseSchema
>;
export type InjectDemoRegulatoryChangeRequest = z.infer<
  typeof InjectDemoRegulatoryChangeRequestSchema
>;
export type InjectDemoRegulatoryChangeResponse = z.infer<
  typeof InjectDemoRegulatoryChangeResponseSchema
>;
export type DemoResetStatus = z.infer<typeof DemoResetStatusSchema>;
export type FacilitatorDemoResetRequest = z.infer<
  typeof FacilitatorDemoResetRequestSchema
>;
export type FacilitatorDemoResetResponse = z.infer<
  typeof FacilitatorDemoResetResponseSchema
>;
export type InvalidationEvaluation = z.infer<
  typeof InvalidationEvaluationSchema
>;
export type ReconsiderationTask = z.infer<typeof ReconsiderationTaskSchema>;
export type InvalidationReviewDisposition = z.infer<
  typeof InvalidationReviewDispositionSchema
>;
export type ReviewInvalidationRequest = z.infer<
  typeof ReviewInvalidationRequestSchema
>;
export type ConfirmInvalidationReviewResponse = z.infer<
  typeof ConfirmInvalidationReviewResponseSchema
>;
export type RejectInvalidationReviewResponse = z.infer<
  typeof RejectInvalidationReviewResponseSchema
>;
export type ReviewInvalidationResponse = z.infer<
  typeof ReviewInvalidationResponseSchema
>;
export type FacilitatorInvalidationReviewRequest = ReviewInvalidationRequest;
export type FacilitatorInvalidationReviewResponse = ReviewInvalidationResponse;
export type DecisionReviewResolution = z.infer<
  typeof DecisionReviewResolutionSchema
>;
export type RecommitDecisionRevisionRequest = z.infer<
  typeof RecommitDecisionRevisionRequestSchema
>;
export type SupersedeDecisionRequest = z.infer<
  typeof SupersedeDecisionRequestSchema
>;
export type RejectDecisionRequest = z.infer<typeof RejectDecisionRequestSchema>;
export type ResolveDecisionReviewRequest = z.infer<
  typeof ResolveDecisionReviewRequestSchema
>;
export type RecommitDecisionRevisionResponse = z.infer<
  typeof RecommitDecisionRevisionResponseSchema
>;
export type SupersedeDecisionResponse = z.infer<
  typeof SupersedeDecisionResponseSchema
>;
export type RejectDecisionResponse = z.infer<
  typeof RejectDecisionResponseSchema
>;
export type ResolveDecisionReviewResponse = z.infer<
  typeof ResolveDecisionReviewResponseSchema
>;
export type ListInvalidationEvaluationsResponse = z.infer<
  typeof ListInvalidationEvaluationsResponseSchema
>;
export type DecisionHistoryQuery = z.infer<typeof DecisionHistoryQuerySchema>;
export type DecisionHistoryResponse = z.infer<
  typeof DecisionHistoryResponseSchema
>;
export type DecisionAuditQuery = z.infer<typeof DecisionAuditQuerySchema>;
export type DecisionAuditResponse = z.infer<typeof DecisionAuditResponseSchema>;
export type DecisionJsonExportQuery = z.infer<
  typeof DecisionJsonExportQuerySchema
>;
export type DecisionJsonExportResponse = z.infer<
  typeof DecisionJsonExportResponseSchema
>;
export type GetDecisionHistoryRequest = DecisionHistoryQuery;
export type GetDecisionHistoryResponse = DecisionHistoryResponse;
export type GetDecisionAuditRequest = DecisionAuditQuery;
export type GetDecisionAuditResponse = DecisionAuditResponse;
export type ExportDecisionJsonRequest = DecisionJsonExportQuery;
export type ExportDecisionJsonResponse = DecisionJsonExportResponse;

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
