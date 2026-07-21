import { expect } from "vitest";

interface CoordinatorResponse {
  readonly body: unknown;
  readonly status: number;
}

export type MeetingCoordinatorRequest = (
  path: string,
  body: unknown,
) => Promise<CoordinatorResponse>;

const issuedAt = "2026-07-19T00:00:00.000Z";
const expiresAt = "2026-07-19T00:00:30.000Z";

function ticket(overrides: Record<string, unknown> = {}) {
  return {
    correlationId: "correlation-ticket",
    digest: "sha256-ticket-a",
    expiresAt,
    issuedAt,
    lastSeenPosition: 0,
    meetingId: "meeting-coordination-contract",
    participantId: "participant-a",
    role: "participant",
    sessionId: "session-a",
    userId: "user-a",
    ...overrides,
  };
}

export async function meetingCoordinatorContract(
  request: MeetingCoordinatorRequest,
): Promise<void> {
  await expect(request("/tickets/issue", ticket())).resolves.toEqual({
    body: { kind: "issued", replayed: false },
    status: 201,
  });
  await expect(request("/tickets/issue", ticket())).resolves.toEqual({
    body: { kind: "issued", replayed: true },
    status: 200,
  });
  await expect(
    request("/tickets/issue", ticket({ sessionId: "different-session" })),
  ).resolves.toEqual({
    body: { code: "IDEMPOTENCY_CONFLICT" },
    status: 409,
  });
  await expect(
    request("/tickets/issue", {
      ...ticket({ digest: "raw-ticket-rejected" }),
      ticket: "must-never-enter-the-coordinator",
    }),
  ).resolves.toEqual({
    body: { code: "INVALID_REQUEST" },
    status: 400,
  });

  await expect(
    request("/tickets/consume", {
      digest: "sha256-ticket-a",
      now: "2026-07-19T00:00:01.000Z",
    }),
  ).resolves.toMatchObject({
    body: {
      claims: {
        digest: "sha256-ticket-a",
        meetingId: "meeting-coordination-contract",
      },
      kind: "consumed",
    },
    status: 200,
  });
  await expect(
    request("/tickets/consume", {
      digest: "sha256-ticket-a",
      now: "2026-07-19T00:00:02.000Z",
    }),
  ).resolves.toEqual({
    body: { kind: "unavailable" },
    status: 404,
  });

  await request("/tickets/issue", ticket({ digest: "sha256-ticket-revoke" }));
  await expect(
    request("/sessions/revoke", { sessionId: "session-a" }),
  ).resolves.toEqual({
    body: { discardedTickets: 1, kind: "revoked" },
    status: 200,
  });
  await expect(
    request("/tickets/consume", {
      digest: "sha256-ticket-revoke",
      now: "2026-07-19T00:00:02.000Z",
    }),
  ).resolves.toEqual({
    body: { kind: "unavailable" },
    status: 404,
  });
  await expect(
    request("/tickets/issue", ticket({ digest: "sha256-ticket-after-revoke" })),
  ).resolves.toEqual({
    body: { code: "SESSION_REVOKED" },
    status: 409,
  });
  await expect(
    request(
      "/tickets/issue",
      ticket({
        digest: "sha256-wrong-meeting",
        meetingId: "meeting-other",
        sessionId: "session-other",
      }),
    ),
  ).resolves.toEqual({
    body: { code: "MEETING_SCOPE_CONFLICT" },
    status: 409,
  });

  const displayTicket = ticket({
    digest: "sha256-display-ticket",
    participantId: undefined,
    role: "display",
    sessionId: "session-display",
    userId: "display-token-subject",
  });
  await expect(request("/tickets/issue", displayTicket)).resolves.toMatchObject(
    { status: 201 },
  );
  await expect(
    request("/sessions/revoke", { sessionId: "session-display" }),
  ).resolves.toEqual({
    body: { discardedTickets: 1, kind: "revoked" },
    status: 200,
  });
  await expect(
    request("/tickets/consume", {
      digest: "sha256-display-ticket",
      now: "2026-07-19T00:00:02.000Z",
    }),
  ).resolves.toEqual({
    body: { kind: "unavailable" },
    status: 404,
  });

  const shared = {
    correlationId: "correlation-shared",
    kind: "projection",
    publicationId: "publication-shared",
    sourcePosition: 1,
    visibility: { kind: "shared" },
  } as const;
  await expect(request("/publications", shared)).resolves.toEqual({
    body: {
      coordinationPosition: 1,
      kind: "published",
      replayed: false,
    },
    status: 201,
  });
  await expect(
    request("/publications", {
      correlationId: "correlation-private-a",
      kind: "projection",
      publicationId: "publication-private-a",
      sourcePosition: 2,
      visibility: {
        kind: "owner_private",
        ownerParticipantId: "participant-a",
      },
    }),
  ).resolves.toMatchObject({ status: 201 });

  const byokLease = {
    apiKey: "sk-synthetic-coordinator-byok-canary",
    heartbeatAt: new Date().toISOString(),
    meetingId: "meeting-coordination-contract",
    ownerParticipantId: "participant-byok-owner",
    ownerSessionId: "session-byok-owner",
  };
  await expect(request("/byok/configure", byokLease)).resolves.toEqual({
    body: { kind: "configured" },
    status: 201,
  });
  await expect(
    request("/byok/configure", {
      ...byokLease,
      ownerSessionId: "session-byok-attacker",
    }),
  ).resolves.toEqual({
    body: { kind: "owner_mismatch" },
    status: 409,
  });
  await expect(
    request("/byok/find", { meetingId: byokLease.meetingId }),
  ).resolves.toEqual({
    body: { kind: "found", lease: byokLease },
    status: 200,
  });
  await expect(
    request("/byok/heartbeat", {
      heartbeatAt: new Date().toISOString(),
      meetingId: byokLease.meetingId,
      ownerParticipantId: byokLease.ownerParticipantId,
      ownerSessionId: "session-byok-attacker",
    }),
  ).resolves.toEqual({
    body: { kind: "owner_mismatch" },
    status: 409,
  });
  await expect(
    request("/sessions/revoke", { sessionId: byokLease.ownerSessionId }),
  ).resolves.toMatchObject({ status: 200 });
  await expect(
    request("/byok/find", { meetingId: byokLease.meetingId }),
  ).resolves.toEqual({ body: { kind: "missing" }, status: 404 });

  const expiredLease = {
    ...byokLease,
    heartbeatAt: new Date(Date.now() - 5 * 60 * 1_000).toISOString(),
    ownerSessionId: "session-byok-expired",
  };
  await expect(request("/byok/configure", expiredLease)).resolves.toEqual({
    body: { kind: "configured" },
    status: 201,
  });
  await expect(
    request("/byok/find", { meetingId: expiredLease.meetingId }),
  ).resolves.toEqual({ body: { kind: "missing" }, status: 404 });
  await expect(
    request("/publications", {
      correlationId: "correlation-private-b",
      kind: "projection",
      publicationId: "publication-private-b",
      sourcePosition: 3,
      visibility: {
        kind: "owner_private",
        ownerParticipantId: "participant-b",
      },
    }),
  ).resolves.toMatchObject({ status: 201 });
  await expect(
    request("/publications", {
      correlationId: "correlation-reset",
      kind: "reset",
      publicationId: "publication-reset",
      sourcePosition: 4,
      visibility: { kind: "shared" },
    }),
  ).resolves.toEqual({
    body: {
      coordinationPosition: 4,
      kind: "published",
      replayed: false,
    },
    status: 201,
  });

  await expect(request("/publications", shared)).resolves.toEqual({
    body: {
      coordinationPosition: 1,
      kind: "published",
      replayed: true,
    },
    status: 200,
  });
  await expect(
    request("/publications", {
      ...shared,
      correlationId: "semantic-conflict",
    }),
  ).resolves.toEqual({
    body: { code: "IDEMPOTENCY_CONFLICT" },
    status: 409,
  });
  await expect(
    request("/publications", {
      correlationId: "correlation-stale",
      kind: "projection",
      publicationId: "publication-stale",
      sourcePosition: 3,
      visibility: { kind: "shared" },
    }),
  ).resolves.toEqual({
    body: { actualPosition: 4, code: "POSITION_CONFLICT" },
    status: 409,
  });
  await expect(
    request("/publications", {
      ...shared,
      payload: { privateText: "must never be coordinated" },
      publicationId: "publication-with-payload",
      sourcePosition: 5,
    }),
  ).resolves.toEqual({
    body: { code: "INVALID_REQUEST" },
    status: 400,
  });

  await expect(
    request("/resume", {
      afterVisiblePosition: 1,
      audience: { kind: "participant", participantId: "participant-a" },
    }),
  ).resolves.toEqual({
    body: {
      durableTruth: "d1",
      publications: [
        {
          correlationId: "correlation-private-a",
          kind: "projection",
          publicationId: "publication-private-a",
          sourcePosition: 2,
          visiblePosition: 2,
        },
        {
          correlationId: "correlation-reset",
          kind: "reset",
          publicationId: "publication-reset",
          sourcePosition: 4,
          visiblePosition: 3,
        },
      ],
      requiresSnapshot: false,
      visiblePosition: 3,
    },
    status: 200,
  });
  await expect(
    request("/resume", {
      afterVisiblePosition: 0,
      audience: { kind: "display" },
    }),
  ).resolves.toEqual({
    body: {
      durableTruth: "d1",
      publications: [
        {
          correlationId: "correlation-shared",
          kind: "projection",
          publicationId: "publication-shared",
          sourcePosition: 1,
          visiblePosition: 1,
        },
        {
          correlationId: "correlation-reset",
          kind: "reset",
          publicationId: "publication-reset",
          sourcePosition: 4,
          visiblePosition: 2,
        },
      ],
      requiresSnapshot: false,
      visiblePosition: 2,
    },
    status: 200,
  });
  await expect(
    request("/resume", {
      afterVisiblePosition: 99,
      audience: { kind: "display" },
    }),
  ).resolves.toMatchObject({
    body: {
      durableTruth: "d1",
      publications: [],
      requiresSnapshot: true,
      visiblePosition: 2,
    },
    status: 200,
  });
}
