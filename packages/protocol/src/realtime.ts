import { z } from "zod";

import { ErrorEnvelopeSchema } from "./errors.js";
import {
  DisclosureCandidateSchema,
  InferenceSuggestionSchema,
  RoleProjectionResponseSchema,
} from "./http.js";
import {
  CorrelationIdSchema,
  MeetingIdSchema,
  MeetingPositionSchema,
  OpaqueIdSchema,
  ParticipantIdSchema,
  SourceArtifactIdSchema,
  UtcIsoTimestampSchema,
} from "./primitives.js";

export const APPLICATION_REALTIME_SCHEMA_VERSION = "1" as const;
export const ApplicationRealtimeSchemaVersionSchema = z.literal(
  APPLICATION_REALTIME_SCHEMA_VERSION,
);

/**
 * A one-time application WebSocket credential. Consumers must treat the value
 * as opaque and must not substitute a browser session Bearer token for it.
 */
export const RealtimeTicketSchema = OpaqueIdSchema;

export const RealtimeTicketRequestSchema = z.strictObject({
  meetingId: MeetingIdSchema,
  lastSeenPosition: MeetingPositionSchema,
});

export const RealtimeTicketResponseSchema = z.strictObject({
  ticket: RealtimeTicketSchema,
  expiresAt: UtcIsoTimestampSchema,
  meetingId: MeetingIdSchema,
  correlationId: CorrelationIdSchema,
});

export const SharedRealtimeVisibilitySchema = z.strictObject({
  kind: z.literal("shared"),
});

export const OwnerPrivateRealtimeVisibilitySchema = z.strictObject({
  kind: z.literal("owner_private"),
  ownerParticipantId: ParticipantIdSchema,
});

export const RealtimeVisibilitySchema = z.discriminatedUnion("kind", [
  SharedRealtimeVisibilitySchema,
  OwnerPrivateRealtimeVisibilitySchema,
]);

const applicationRealtimeMessageMetadataShape = {
  schemaVersion: ApplicationRealtimeSchemaVersionSchema,
  meetingId: MeetingIdSchema,
  position: MeetingPositionSchema,
  correlationId: CorrelationIdSchema,
} as const;

export const ConnectionReadyPayloadSchema = z.strictObject({});

export const ConnectionReadyMessageSchema = z.strictObject({
  type: z.literal("connection.ready"),
  ...applicationRealtimeMessageMetadataShape,
  visibility: RealtimeVisibilitySchema,
  payload: ConnectionReadyPayloadSchema,
});

export const RealtimePrivateSourceMetadataSchema = z.strictObject({
  sourceArtifactId: SourceArtifactIdSchema,
  createdAt: UtcIsoTimestampSchema,
  sizeBytes: z.number().int().nonnegative(),
  processingState: z.enum(["registered", "processing", "processed", "failed"]),
});

export const RealtimeRoleProjectionSchema = RoleProjectionResponseSchema.pick({
  capabilities: true,
  correlationId: true,
  meeting: true,
  participant: true,
  shared: true,
}).extend({
  privateWorkspace: z.strictObject({
    sources: z.array(RealtimePrivateSourceMetadataSchema),
    disclosureCandidates: z.array(DisclosureCandidateSchema),
    inferenceSuggestions: z.array(InferenceSuggestionSchema),
    utterances:
      RoleProjectionResponseSchema.shape.privateWorkspace.shape.utterances,
  }),
});

export const RoleProjectionUpdatedPayloadSchema = RealtimeRoleProjectionSchema;

export const RoleProjectionUpdatedMessageSchema = z.strictObject({
  type: z.literal("role_projection.updated"),
  ...applicationRealtimeMessageMetadataShape,
  visibility: OwnerPrivateRealtimeVisibilitySchema,
  payload: RoleProjectionUpdatedPayloadSchema,
});

export const ProtocolErrorMessageSchema = z.strictObject({
  type: z.literal("protocol.error"),
  ...applicationRealtimeMessageMetadataShape,
  visibility: RealtimeVisibilitySchema,
  payload: ErrorEnvelopeSchema,
});

export const ApplicationRealtimeMessageSchema = z.discriminatedUnion("type", [
  ConnectionReadyMessageSchema,
  RoleProjectionUpdatedMessageSchema,
  ProtocolErrorMessageSchema,
]);

export const IssueRealtimeTicketRequestSchema = RealtimeTicketRequestSchema;
export const IssueRealtimeTicketResponseSchema = RealtimeTicketResponseSchema;

export type ApplicationRealtimeSchemaVersion = z.infer<
  typeof ApplicationRealtimeSchemaVersionSchema
>;
export type RealtimeTicket = z.infer<typeof RealtimeTicketSchema>;
export type RealtimeTicketRequest = z.infer<typeof RealtimeTicketRequestSchema>;
export type RealtimeTicketResponse = z.infer<
  typeof RealtimeTicketResponseSchema
>;
export type IssueRealtimeTicketRequest = RealtimeTicketRequest;
export type IssueRealtimeTicketResponse = RealtimeTicketResponse;
export type SharedRealtimeVisibility = z.infer<
  typeof SharedRealtimeVisibilitySchema
>;
export type OwnerPrivateRealtimeVisibility = z.infer<
  typeof OwnerPrivateRealtimeVisibilitySchema
>;
export type RealtimeVisibility = z.infer<typeof RealtimeVisibilitySchema>;
export type ConnectionReadyPayload = z.infer<
  typeof ConnectionReadyPayloadSchema
>;
export type ConnectionReadyMessage = z.infer<
  typeof ConnectionReadyMessageSchema
>;
export type RoleProjectionUpdatedPayload = z.infer<
  typeof RoleProjectionUpdatedPayloadSchema
>;
export type RealtimePrivateSourceMetadata = z.infer<
  typeof RealtimePrivateSourceMetadataSchema
>;
export type RealtimeRoleProjection = z.infer<
  typeof RealtimeRoleProjectionSchema
>;
export type RoleProjectionUpdatedMessage = z.infer<
  typeof RoleProjectionUpdatedMessageSchema
>;
export type ProtocolErrorMessage = z.infer<typeof ProtocolErrorMessageSchema>;
export type ApplicationRealtimeMessage = z.infer<
  typeof ApplicationRealtimeMessageSchema
>;
