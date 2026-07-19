import { describe, expect, it, vi } from "vitest";

import { WebCryptoSessionTokenIssuer } from "@counterpoint/adapters-cloudflare";
import type {
  ManagedRealtimeCallOwnership,
  ManagedRealtimeCallOwner,
  ManagedRealtimeStartClaim,
  ManagedRealtimeStartClaimResult,
} from "@counterpoint/adapters-cloudflare";
import type {
  MeetingRepository,
  SessionRecord,
  UsageLimiter,
} from "@counterpoint/ports";

import {
  handleJudgeManagedRealtimeHttp,
  type JudgeManagedRealtimeControllerStub,
  type JudgeManagedRealtimeOwnershipRepository,
} from "../../../apps/worker/src/judge-managed-realtime-http.js";

const MEETING_ID = "meeting-worker-managed-http";
const USER_ID = "judge-worker-managed-http";
const PARTICIPANT_ID = "participant-worker-managed-http";
const SESSION_ID = "session-worker-managed-http";
const BEARER = "bearer-worker-managed-http";
const NOW = "2026-07-19T12:00:00.000Z";
const RESERVATION_ID = "reservation-server-owned";

interface Fixture {
  readonly controller: JudgeManagedRealtimeControllerStub;
  readonly controllerRequests: Request[];
  readonly dependencies: Parameters<
    typeof handleJudgeManagedRealtimeHttp
  >[0]["dependencies"];
  readonly ownerships: JudgeManagedRealtimeOwnershipRepository & {
    created?: ManagedRealtimeCallOwnership;
  };
  readonly usage: UsageLimiter & { readonly reserve: ReturnType<typeof vi.fn> };
}

function session(): SessionRecord {
  return {
    absoluteExpiresAt: "2026-07-19T20:00:00.000Z",
    createdAt: NOW,
    lastActivityAt: NOW,
    sessionId: SESSION_ID,
    tokenHash: "unused-before-fixture",
    userId: USER_ID,
  };
}

function fixture(): Fixture {
  const tokens = new WebCryptoSessionTokenIssuer();
  const storedSession = session();
  const controllerRequests: Request[] = [];
  const controller: JudgeManagedRealtimeControllerStub = {
    fetch(input, init) {
      const request =
        input instanceof Request ? input : new Request(input, init);
      controllerRequests.push(request);
      const path = new URL(request.url).pathname;
      if (path === "/start") {
        return Promise.resolve(
          Response.json(
            {
              channel: "private",
              kind: "started",
              model: "gpt-realtime-2.1",
              sdpAnswer: "v=0\r\ns=server-answer\r\n",
            },
            { status: 201 },
          ),
        );
      }
      if (path === "/turn") {
        return Promise.resolve(
          Response.json({ kind: "begun", replayed: false }, { status: 201 }),
        );
      }
      if (path === "/transcript") {
        return Promise.resolve(
          Response.json(
            { kind: "completed", transcript: "bounded transcript" },
            { status: 200 },
          ),
        );
      }
      return Promise.resolve(Response.json({ kind: "terminated" }));
    },
  };

  const ownerships: JudgeManagedRealtimeOwnershipRepository & {
    created?: ManagedRealtimeCallOwnership;
  } = {
    claimStart() {
      return Promise.resolve("claimed");
    },
    async create(ownership) {
      ownerships.created = ownership;
      return "created";
    },
    async findActiveOwned(owner) {
      const created = ownerships.created;
      return created !== undefined && sameOwner(created, owner)
        ? created
        : undefined;
    },
    async terminateOwned() {
      return "terminated";
    },
  };
  const usage = {
    finalize: vi.fn(async () => undefined),
    release: vi.fn(async () => undefined),
    reserve: vi.fn(async () => ({
      kind: "allowed" as const,
      reservationId: RESERVATION_ID,
    })),
  } as unknown as UsageLimiter & { readonly reserve: ReturnType<typeof vi.fn> };
  const meetings: MeetingRepository = {
    createWithAssignments: vi.fn(async () => undefined),
    findAssignment: vi.fn(async () => ({
      active: true,
      meetingId: MEETING_ID,
      participantId: PARTICIPANT_ID,
      role: "participant" as const,
      userId: USER_ID,
    })),
    findByCode: vi.fn(async () => undefined),
    findById: vi.fn(async () => ({
      active: true,
      code: "WORKER-MANAGED-HTTP",
      createdByUserId: "facilitator",
      facilitatorParticipantId: "participant-facilitator",
      meetingId: MEETING_ID,
      purpose: "managed http fixture",
    })),
    listAssigned: vi.fn(async () => []),
    listAssignments: vi.fn(async () => []),
  };
  const dependencies = {
    authorizationPolicy: { judgeManagedAiUserIds: new Set([USER_ID]) },
    clock: { now: () => NOW },
    controllers: () => controller,
    ipReservation: {
      hashIp: async () => `hmac-sha256:${"0".repeat(64)}`,
      ipAddress: "203.0.113.9",
    },
    meetings,
    ownerships,
    sessions: {
      findById: async () => storedSession,
      findByTokenHash: async (tokenHash: string) =>
        tokenHash === (await tokens.digest(BEARER)) ? storedSession : undefined,
      put: vi.fn(async () => undefined),
      revoke: vi.fn(async () => undefined),
      touch: vi.fn(async () => undefined),
    },
    tokens,
    usage,
  };
  return { controller, controllerRequests, dependencies, ownerships, usage };
}

function sameOwner(
  ownership: ManagedRealtimeCallOwnership,
  owner: ManagedRealtimeCallOwner,
): boolean {
  return (
    ownership.managedCallId === owner.managedCallId &&
    ownership.meetingId === owner.meetingId &&
    ownership.participantId === owner.participantId &&
    ownership.sessionId === owner.sessionId &&
    ownership.userId === owner.userId
  );
}

function request(body: unknown): Request {
  return new Request("https://counterpoint.test/managed", {
    body: JSON.stringify(body),
    headers: {
      authorization: `Bearer ${BEARER}`,
      "content-type": "application/json",
    },
    method: "POST",
  });
}

describe("Worker managed Realtime HTTP boundary", () => {
  it("creates ownership from server reservation data and strips internal fields", async () => {
    const fixtureValue = fixture();
    const response = await handleJudgeManagedRealtimeHttp({
      correlationId: "correlation-worker-managed-create",
      dependencies: fixtureValue.dependencies,
      meetingId: MEETING_ID,
      operation: "start",
      request: request({
        channel: "private",
        idempotencyKey: "managed-start-create",
        meetingId: MEETING_ID,
        sdpOffer: "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n",
      }),
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      channel: "private",
      correlationId: "correlation-worker-managed-create",
      managedCallId: expect.any(String),
      meetingId: MEETING_ID,
      model: "gpt-realtime-2.1",
      sdpAnswer: "v=0\r\ns=server-answer\r\n",
    });
    expect(fixtureValue.ownerships.created).toMatchObject({
      accountId: USER_ID,
      participantId: PARTICIPANT_ID,
      reservationId: RESERVATION_ID,
      sessionId: SESSION_ID,
      userId: USER_ID,
    });
    const internalStart = fixtureValue.controllerRequests[0];
    expect(internalStart).toBeDefined();
    const internalBody = (await internalStart?.clone().json()) as Record<
      string,
      unknown
    >;
    expect(internalBody.reservationId).toBe(RESERVATION_ID);
    expect(internalBody.safetyIdentifier).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(internalBody).not.toHaveProperty("meetingId");
    expect(internalBody).not.toHaveProperty("participantId");
  });

  it("reauthorizes the opaque handle before forwarding a turn", async () => {
    const fixtureValue = fixture();
    const start = await handleJudgeManagedRealtimeHttp({
      correlationId: "correlation-worker-managed-create",
      dependencies: fixtureValue.dependencies,
      meetingId: MEETING_ID,
      operation: "start",
      request: request({
        channel: "private",
        idempotencyKey: "managed-start-turn-fixture",
        meetingId: MEETING_ID,
        sdpOffer: "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n",
      }),
    });
    const started = (await start.json()) as { managedCallId: string };
    const response = await handleJudgeManagedRealtimeHttp({
      correlationId: "correlation-worker-managed-turn",
      dependencies: fixtureValue.dependencies,
      managedCallId: started.managedCallId,
      meetingId: MEETING_ID,
      operation: "turn",
      request: request({
        managedCallId: started.managedCallId,
        meetingId: MEETING_ID,
        utteranceId: "utterance-worker-managed-http",
      }),
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      correlationId: "correlation-worker-managed-turn",
      managedCallId: started.managedCallId,
      meetingId: MEETING_ID,
      utteranceId: "utterance-worker-managed-http",
    });
    expect(fixtureValue.controllerRequests.at(-1)).toBeDefined();
    expect(
      await fixtureValue.controllerRequests.at(-1)?.clone().json(),
    ).toEqual({ utteranceId: "utterance-worker-managed-http" });
  });

  it("rejects a body/path meeting mismatch before authorization or provider dispatch", async () => {
    const fixtureValue = fixture();
    const response = await handleJudgeManagedRealtimeHttp({
      correlationId: "correlation-worker-managed-mismatch",
      dependencies: fixtureValue.dependencies,
      meetingId: MEETING_ID,
      operation: "start",
      request: request({
        channel: "private",
        idempotencyKey: "managed-start-mismatch",
        meetingId: "other-meeting",
        sdpOffer: "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n",
      }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    expect(fixtureValue.usage.reserve).not.toHaveBeenCalled();
    expect(fixtureValue.controllerRequests).toHaveLength(0);
  });

  it("claims an idempotency key before reserving usage and suppresses replays", async () => {
    const fixtureValue = fixture();
    let storedClaim: ManagedRealtimeStartClaim | undefined;
    fixtureValue.ownerships.claimStart = vi.fn(
      (
        claim: ManagedRealtimeStartClaim,
      ): Promise<ManagedRealtimeStartClaimResult> => {
        if (storedClaim === undefined) {
          storedClaim = claim;
          return Promise.resolve("claimed");
        }
        return Promise.resolve(
          storedClaim.startKeyHash === claim.startKeyHash &&
            storedClaim.requestFingerprint === claim.requestFingerprint
            ? "replayed"
            : "conflict",
        );
      },
    );
    const body = {
      channel: "private",
      idempotencyKey: "managed-start-idempotent",
      meetingId: MEETING_ID,
      sdpOffer: "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n",
    } as const;

    const first = await handleJudgeManagedRealtimeHttp({
      correlationId: "correlation-managed-idempotent-first",
      dependencies: fixtureValue.dependencies,
      meetingId: MEETING_ID,
      operation: "start",
      request: request(body),
    });
    const replay = await handleJudgeManagedRealtimeHttp({
      correlationId: "correlation-managed-idempotent-replay",
      dependencies: fixtureValue.dependencies,
      meetingId: MEETING_ID,
      operation: "start",
      request: request(body),
    });

    expect(first.status).toBe(201);
    expect(replay.status).toBe(409);
    await expect(replay.json()).resolves.toMatchObject({
      code: "CONFLICT",
      details: { reason: "MANAGED_REALTIME_START_ALREADY_CLAIMED" },
    });
    expect(fixtureValue.usage.reserve).toHaveBeenCalledTimes(1);
    expect(fixtureValue.controllerRequests).toHaveLength(1);
    expect(storedClaim).toMatchObject({
      meetingId: MEETING_ID,
      participantId: PARTICIPANT_ID,
      sessionId: SESSION_ID,
      userId: USER_ID,
    });
    expect(storedClaim?.startKeyHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(storedClaim?.requestFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(JSON.stringify(storedClaim)).not.toContain("m=audio");
  });

  it("rejects idempotency-key reuse with changed SDP before reserving usage", async () => {
    const fixtureValue = fixture();
    let firstClaim: ManagedRealtimeStartClaim | undefined;
    fixtureValue.ownerships.claimStart = vi.fn(
      (
        claim: ManagedRealtimeStartClaim,
      ): Promise<ManagedRealtimeStartClaimResult> => {
        if (firstClaim === undefined) {
          firstClaim = claim;
          return Promise.resolve("claimed");
        }
        return Promise.resolve(
          firstClaim.requestFingerprint === claim.requestFingerprint
            ? "replayed"
            : "conflict",
        );
      },
    );
    const base = {
      channel: "private",
      idempotencyKey: "managed-start-conflict",
      meetingId: MEETING_ID,
    } as const;
    await handleJudgeManagedRealtimeHttp({
      correlationId: "correlation-managed-conflict-first",
      dependencies: fixtureValue.dependencies,
      meetingId: MEETING_ID,
      operation: "start",
      request: request({ ...base, sdpOffer: "v=0\r\ns=first\r\n" }),
    });
    const conflict = await handleJudgeManagedRealtimeHttp({
      correlationId: "correlation-managed-conflict-second",
      dependencies: fixtureValue.dependencies,
      meetingId: MEETING_ID,
      operation: "start",
      request: request({ ...base, sdpOffer: "v=0\r\ns=changed\r\n" }),
    });

    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({
      details: { reason: "IDEMPOTENCY_KEY_REUSED" },
    });
    expect(fixtureValue.usage.reserve).toHaveBeenCalledTimes(1);
  });
});
