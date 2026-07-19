import { describe, expect, expectTypeOf, it } from "vitest";

import {
  APPLICATION_REALTIME_SCHEMA_VERSION,
  ApplicationRealtimeMessageSchema,
  ConnectionReadyMessageSchema,
  ProtocolErrorMessageSchema,
  RealtimeTicketRequestSchema,
  RealtimeTicketResponseSchema,
  RealtimeRoleProjectionSchema,
  RealtimeVisibilitySchema,
  RoleProjectionUpdatedMessageSchema,
  type ApplicationRealtimeMessage,
  type ConnectionReadyMessage,
  type ProtocolErrorMessage,
  type RealtimeTicketRequest,
  type RealtimeTicketResponse,
  type RoleProjectionUpdatedMessage,
} from "@counterpoint/protocol";

const messageMetadata = {
  schemaVersion: APPLICATION_REALTIME_SCHEMA_VERSION,
  meetingId: "meeting-1",
  position: 4,
  correlationId: "correlation-1",
} as const;

const roleProjection = {
  meeting: {
    meetingId: "meeting-1",
    purpose: "Synthetic rollout decision",
    phase: "deliberating",
  },
  participant: {
    participantId: "participant-1",
    userId: "user-1",
    role: "participant",
  },
  capabilities: ["meeting:read", "private:read-own"],
  shared: {
    position: 4,
    participants: [],
    evidence: [],
    premises: [],
    dissent: [],
    actions: [],
    decisions: [],
    utterances: [],
    sharedFloor: null,
  },
  privateWorkspace: {
    sources: [],
    disclosureCandidates: [],
    inferenceSuggestions: [],
    utterances: [],
  },
  correlationId: "correlation-1",
} as const;

describe("application realtime protocol v1", () => {
  it("parses strict one-time ticket request and response DTOs", () => {
    const request = RealtimeTicketRequestSchema.parse({
      meetingId: "meeting-1",
      lastSeenPosition: 3,
    });
    const response = RealtimeTicketResponseSchema.parse({
      ticket: "one-time-ticket-1",
      expiresAt: "2026-07-19T12:00:30.000Z",
      meetingId: "meeting-1",
      correlationId: "correlation-1",
    });

    expectTypeOf(request).toEqualTypeOf<RealtimeTicketRequest>();
    expectTypeOf(response).toEqualTypeOf<RealtimeTicketResponse>();
    expect(
      RealtimeTicketRequestSchema.safeParse({
        meetingId: "meeting-1",
        lastSeenPosition: 3,
        bearerToken: "browser-session-token",
      }).success,
    ).toBe(false);
    expect(
      RealtimeTicketResponseSchema.safeParse({
        ...response,
        extra: "undeclared",
      }).success,
    ).toBe(false);
  });

  it("rejects invalid replay and message positions", () => {
    expect(
      RealtimeTicketRequestSchema.safeParse({
        meetingId: "meeting-1",
        lastSeenPosition: -1,
      }).success,
    ).toBe(false);
    expect(
      ConnectionReadyMessageSchema.safeParse({
        type: "connection.ready",
        ...messageMetadata,
        position: 1.5,
        visibility: { kind: "shared" },
        payload: {},
      }).success,
    ).toBe(false);
  });

  it("requires an owner for private visibility and rejects scope extras", () => {
    expect(
      RealtimeVisibilitySchema.safeParse({
        kind: "owner_private",
      }).success,
    ).toBe(false);
    expect(
      RealtimeVisibilitySchema.safeParse({
        kind: "shared",
        ownerParticipantId: "participant-1",
      }).success,
    ).toBe(false);
    expect(
      RoleProjectionUpdatedMessageSchema.safeParse({
        type: "role_projection.updated",
        ...messageMetadata,
        visibility: { kind: "owner_private" },
        payload: roleProjection,
      }).success,
    ).toBe(false);
  });

  it("parses connection, role projection, and protocol error messages", () => {
    const ready = ConnectionReadyMessageSchema.parse({
      type: "connection.ready",
      ...messageMetadata,
      visibility: { kind: "shared" },
      payload: {},
    });
    const projection = RoleProjectionUpdatedMessageSchema.parse({
      type: "role_projection.updated",
      ...messageMetadata,
      visibility: {
        kind: "owner_private",
        ownerParticipantId: "participant-1",
      },
      payload: roleProjection,
    });
    const error = ProtocolErrorMessageSchema.parse({
      type: "protocol.error",
      ...messageMetadata,
      visibility: { kind: "shared" },
      payload: {
        code: "REALTIME_UNAVAILABLE",
        message: "Realtime is temporarily unavailable.",
        correlationId: "correlation-1",
        retryable: true,
        details: {},
      },
    });

    expectTypeOf(ready).toEqualTypeOf<ConnectionReadyMessage>();
    expectTypeOf(projection).toEqualTypeOf<RoleProjectionUpdatedMessage>();
    expectTypeOf(error).toEqualTypeOf<ProtocolErrorMessage>();
    expectTypeOf(
      ApplicationRealtimeMessageSchema.parse(ready),
    ).toEqualTypeOf<ApplicationRealtimeMessage>();
    expect(ApplicationRealtimeMessageSchema.safeParse(projection).success).toBe(
      true,
    );
    expect(ApplicationRealtimeMessageSchema.safeParse(error).success).toBe(
      true,
    );
  });

  it("allows private source metadata but rejects bodies and storage details", () => {
    const metadataProjection = {
      ...roleProjection,
      privateWorkspace: {
        ...roleProjection.privateWorkspace,
        sources: [
          {
            sourceArtifactId: "source-artifact-1",
            createdAt: "2026-07-19T12:00:00.000Z",
            sizeBytes: 42,
            processingState: "processed",
          },
        ],
      },
    } as const;

    expect(
      RealtimeRoleProjectionSchema.safeParse(metadataProjection).success,
    ).toBe(true);
    for (const privateDetail of [
      { text: "owner-private body" },
      { storageReference: "private/path.txt" },
      { title: "Unpersisted title" },
    ]) {
      expect(
        RealtimeRoleProjectionSchema.safeParse({
          ...metadataProjection,
          privateWorkspace: {
            ...metadataProjection.privateWorkspace,
            sources: [
              {
                ...metadataProjection.privateWorkspace.sources[0],
                ...privateDetail,
              },
            ],
          },
        }).success,
      ).toBe(false);
    }
  });

  it("rejects unknown fields, unsupported versions, and Bearer message fields", () => {
    const ready = {
      type: "connection.ready",
      ...messageMetadata,
      visibility: { kind: "shared" },
      payload: {},
    } as const;

    expect(
      ConnectionReadyMessageSchema.safeParse({
        ...ready,
        unknown: true,
      }).success,
    ).toBe(false);
    expect(
      ConnectionReadyMessageSchema.safeParse({
        ...ready,
        schemaVersion: "2",
      }).success,
    ).toBe(false);
    expect(
      ConnectionReadyMessageSchema.safeParse({
        ...ready,
        bearerToken: "browser-session-token",
      }).success,
    ).toBe(false);
    expect(
      ConnectionReadyMessageSchema.safeParse({
        ...ready,
        payload: { unknown: true },
      }).success,
    ).toBe(false);
  });
});
