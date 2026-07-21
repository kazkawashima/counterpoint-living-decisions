/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import {
  D1MeetingRepository,
  D1ManagedRealtimeCallOwnershipRepository,
  D1SessionRepository,
  createKeyedIpHash,
  type ManagedRealtimeCallOwner,
  WebCryptoSessionTokenIssuer,
} from "@counterpoint/adapters-cloudflare";
import type { ParticipantAssignment } from "@counterpoint/ports";
import {
  CreateManagedRealtimeCallResponseSchema,
  ErrorEnvelopeSchema,
  RealtimeAccessResponseSchema,
} from "@counterpoint/protocol";

import {
  JUDGE_REALTIME_RESERVED_USAGE,
  createJudgeRealtimeUsageLimiter,
} from "../../apps/worker/src/judge-realtime-call-controller.js";
import {
  createWorkerHandler,
  judgeRealtimeCallControllerFor,
  type Env,
} from "../../apps/worker/src/index.js";
import { JUDGE_GLOBAL_USAGE_LIMITS } from "../../apps/worker/src/judge-structured-ai.js";

const MEETING_ID = "meeting/worker-managed-http-c4";
const CROSS_MEETING_ID = "meeting/worker-managed-http-c4-cross";
const JUDGE_USER_ID = "judge-worker-managed-c4";
const JUDGE_BEARER = "judge-worker-managed-bearer-c4";
const ORDINARY_BEARER = "ordinary-worker-access-bearer-c4";
const JUDGE_PARTICIPANT_ID = "participant-worker-managed-judge-c4";
const CROSS_JUDGE_PARTICIPANT_ID = "participant-worker-managed-cross-judge-c4";
const IP_ADDRESS = "203.0.113.44";
const IP_SECRET = "judge-ip-secret-worker-managed-c4-0123456789abcdef";
const STANDARD_KEY = "sk-standard-worker-managed-c4-never-exposed";

type WorkerRequest = Parameters<
  NonNullable<ReturnType<typeof createWorkerHandler>["fetch"]>
>[0];

type FakeControllerFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

interface FakeControllerNamespace {
  readonly get: (id: string) => { fetch: FakeControllerFetch };
  readonly idFromName: (name: string) => string;
}

function workerRequest(request: Request): WorkerRequest {
  return request as unknown as WorkerRequest;
}

function jsonBody(response: Response): Promise<Record<string, unknown>> {
  return response.json();
}

function request(
  path: string,
  body: Record<string, unknown>,
  bearerToken = JUDGE_BEARER,
): WorkerRequest {
  return workerRequest(
    new Request(`https://198.51.100.44${path}`, {
      body: JSON.stringify(body),
      headers: {
        authorization: `Bearer ${bearerToken}`,
        "CF-Connecting-IP": IP_ADDRESS,
        "content-type": "application/json",
      },
      method: "POST",
    }),
  );
}

function getRequest(
  path: string,
  bearerToken = JUDGE_BEARER,
  includeIp = true,
): WorkerRequest {
  return workerRequest(
    new Request(`https://198.51.100.44${path}`, {
      headers: {
        authorization: `Bearer ${bearerToken}`,
        ...(includeIp ? { "CF-Connecting-IP": IP_ADDRESS } : {}),
      },
      method: "GET",
    }),
  );
}

function fakeControllerNamespace(
  options: { readonly failStart?: boolean } = {},
): FakeControllerNamespace {
  return {
    get(reservationId) {
      return {
        async fetch(input) {
          const url =
            typeof input === "string"
              ? new URL(input)
              : input instanceof URL
                ? input
                : new URL(input.url);
          const path = url.pathname;
          if (path === "/start") {
            if (options.failStart === true) {
              return Response.json(
                {
                  code: "PROVIDER_CONNECT_FAILED",
                  providerResponse:
                    "private upstream response sk-provider-secret",
                },
                { status: 503 },
              );
            }
            return Response.json({
              channel: "private",
              kind: "started",
              model: "gpt-realtime-2.1",
              sdpAnswer: "v=0\r\ns=fake-controller-answer\r\n",
            });
          }
          if (path === "/turn") {
            return Response.json({ kind: "begun", replayed: false });
          }
          if (path === "/transcript") {
            return Response.json({
              kind: "completed",
              transcript: "synthetic managed transcript",
            });
          }
          if (path === "/terminate") {
            const usage = createJudgeRealtimeUsageLimiter(env.DB, {
              clock: () => new Date().toISOString(),
              hashIp: createKeyedIpHash(IP_SECRET),
              ids: (namespace) =>
                `${namespace}-fake-controller-${crypto.randomUUID()}`,
            });
            await usage.finalize(reservationId, JUDGE_REALTIME_RESERVED_USAGE);
            return Response.json({ kind: "terminated" });
          }
          return Response.json({ code: "INVALID_REQUEST" }, { status: 400 });
        },
      };
    },
    idFromName(name) {
      return name;
    },
  };
}

function workerEnv(namespace: FakeControllerNamespace): Env {
  return {
    ARTIFACTS: env.ARTIFACTS,
    ASSETS: env.ASSETS,
    DB: env.DB,
    JUDGE_IP_HMAC_SECRET: IP_SECRET,
    JUDGE_MANAGED_REALTIME_ROUTE_ENABLED: "enabled",
    JUDGE_REALTIME_CALLS: namespace as unknown as Env["JUDGE_REALTIME_CALLS"],
    JUDGE_USER_ID,
    MEETINGS: env.MEETINGS,
    OPENAI_API_KEY_JUDGE: STANDARD_KEY,
    OPENAI_MODE: env.OPENAI_MODE,
    OPENAI_MODEL: env.OPENAI_MODEL,
    RUNTIME_MODE: env.RUNTIME_MODE,
  };
}

async function seedFixture(): Promise<void> {
  const database = env.DB.withSession("first-primary");
  await database.batch(
    ["product", "safety", JUDGE_USER_ID].map((userId) =>
      database
        .prepare(
          `
            INSERT INTO users (user_id, password_hash, active)
            VALUES (?, ?, 1)
            ON CONFLICT (user_id) DO UPDATE SET active = 1
          `,
        )
        .bind(userId, `password-hash:${userId}`),
    ),
  );

  const meetings = new D1MeetingRepository(env.DB);
  const assignments: readonly ParticipantAssignment[] = [
    {
      active: true,
      meetingId: MEETING_ID,
      participantId: "participant-worker-managed-product-c4",
      role: "facilitator",
      userId: "product",
    },
    {
      active: true,
      meetingId: MEETING_ID,
      participantId: JUDGE_PARTICIPANT_ID,
      role: "participant",
      userId: JUDGE_USER_ID,
    },
    {
      active: true,
      meetingId: MEETING_ID,
      participantId: "participant-worker-managed-safety-c4",
      role: "participant",
      userId: "safety",
    },
  ];
  if ((await meetings.findById(MEETING_ID)) === undefined) {
    await meetings.createWithAssignments(
      {
        active: true,
        code: "WORKER-MANAGED-HTTP-C4",
        createdByUserId: "product",
        facilitatorParticipantId: "participant-worker-managed-product-c4",
        meetingId: MEETING_ID,
        purpose: "Hosted managed realtime HTTP proof",
      },
      assignments,
    );
  }

  const crossAssignments: readonly ParticipantAssignment[] = [
    {
      active: true,
      meetingId: CROSS_MEETING_ID,
      participantId: "participant-worker-managed-cross-product-c4",
      role: "facilitator",
      userId: "product",
    },
    {
      active: true,
      meetingId: CROSS_MEETING_ID,
      participantId: CROSS_JUDGE_PARTICIPANT_ID,
      role: "participant",
      userId: JUDGE_USER_ID,
    },
    {
      active: true,
      meetingId: CROSS_MEETING_ID,
      participantId: "participant-worker-managed-cross-safety-c4",
      role: "participant",
      userId: "safety",
    },
  ];
  if ((await meetings.findById(CROSS_MEETING_ID)) === undefined) {
    await meetings.createWithAssignments(
      {
        active: true,
        code: "WORKER-MANAGED-HTTP-C4-CROSS",
        createdByUserId: "product",
        facilitatorParticipantId: "participant-worker-managed-cross-product-c4",
        meetingId: CROSS_MEETING_ID,
        purpose: "Hosted cross-meeting isolation proof",
      },
      crossAssignments,
    );
  }

  const tokens = new WebCryptoSessionTokenIssuer();
  const sessions = new D1SessionRepository(env.DB);
  const now = new Date();
  await sessions.put({
    absoluteExpiresAt: new Date(
      now.getTime() + 8 * 60 * 60 * 1_000,
    ).toISOString(),
    createdAt: now.toISOString(),
    lastActivityAt: now.toISOString(),
    sessionId: "session-worker-managed-c4",
    tokenHash: await tokens.digest(JUDGE_BEARER),
    userId: JUDGE_USER_ID,
  });
  await sessions.put({
    absoluteExpiresAt: new Date(
      now.getTime() + 8 * 60 * 60 * 1_000,
    ).toISOString(),
    createdAt: now.toISOString(),
    lastActivityAt: now.toISOString(),
    sessionId: "session-worker-ordinary-access-c4",
    tokenHash: await tokens.digest(ORDINARY_BEARER),
    userId: "safety",
  });
}

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare(
      "DELETE FROM judge_managed_realtime_start_claims WHERE meeting_id = ? AND user_id = ?",
    ).bind(MEETING_ID, JUDGE_USER_ID),
    env.DB.prepare(
      "DELETE FROM judge_managed_realtime_calls WHERE meeting_id = ? AND user_id = ?",
    ).bind(MEETING_ID, JUDGE_USER_ID),
    env.DB.prepare(
      "DELETE FROM judge_usage_reservations WHERE meeting_id = ? AND account_id = ?",
    ).bind(MEETING_ID, JUDGE_USER_ID),
  ]);
});

async function createOwnedCall(managedCallId: string): Promise<{
  readonly limiter: ReturnType<typeof createJudgeRealtimeUsageLimiter>;
  readonly owner: ManagedRealtimeCallOwner;
  readonly ownerships: D1ManagedRealtimeCallOwnershipRepository;
  readonly reservationId: string;
}> {
  const nowEpoch = Math.floor(Date.now() / 1_000);
  const limiter = createJudgeRealtimeUsageLimiter(env.DB, {
    clock: () => new Date().toISOString(),
    hashIp: createKeyedIpHash(IP_SECRET),
    ids: (namespace) => `${namespace}-reauth-c4-${crypto.randomUUID()}`,
  });
  const reservation = await limiter.reserve(
    {
      accountId: JUDGE_USER_ID,
      ipAddress: IP_ADDRESS,
      meetingId: MEETING_ID,
    },
    JUDGE_REALTIME_RESERVED_USAGE,
  );
  if (reservation.kind === "denied") {
    throw new Error(`Fixture reservation denied: ${reservation.limit}`);
  }
  const owner: ManagedRealtimeCallOwner = {
    managedCallId,
    meetingId: MEETING_ID,
    participantId: JUDGE_PARTICIPANT_ID,
    sessionId: "session-worker-managed-c4",
    userId: JUDGE_USER_ID,
  };
  const ownerships = new D1ManagedRealtimeCallOwnershipRepository(env.DB);
  const created = await ownerships.create({
    ...owner,
    accountId: JUDGE_USER_ID,
    channel: "private",
    createdAtEpoch: nowEpoch,
    expiresAtEpoch: nowEpoch + 60,
    reservationId: reservation.reservationId,
  });
  if (created !== "created") {
    await limiter.release(reservation.reservationId);
    throw new Error("Fixture ownership was not created");
  }
  return {
    limiter,
    owner,
    ownerships,
    reservationId: reservation.reservationId,
  };
}

describe("Cloudflare Worker managed Realtime HTTP", () => {
  it("reports ephemeral judge access without claiming managed usage accounting", async () => {
    await seedFixture();
    const handler = createWorkerHandler();
    const environment = workerEnv(fakeControllerNamespace());
    const path = `/api/v1/meetings/${encodeURIComponent(MEETING_ID)}/realtime/access`;

    const managed = await handler.fetch!(
      getRequest(path),
      environment,
      {} as ExecutionContext,
    );
    expect(managed.status).toBe(200);
    const managedBody = RealtimeAccessResponseSchema.parse(
      await managed.json(),
    );
    expect(managedBody.mode).toBe("judgeManaged");
    expect(managedBody.usageSummary).toBe("hidden");
    expect(Object.keys(managedBody).sort()).toEqual([
      "correlationId",
      "mode",
      "usageSummary",
    ]);
    expect(JSON.stringify(managedBody)).not.toMatch(
      /api.?key|capability|lease|participant|session|user/iu,
    );

    const {
      OPENAI_API_KEY_JUDGE: omittedJudgeKey,
      ...environmentWithoutJudgeKey
    } = environment;
    const {
      JUDGE_IP_HMAC_SECRET: omittedIpSecret,
      ...environmentWithoutIpSecret
    } = environment;
    void omittedJudgeKey;
    void omittedIpSecret;
    const degradedEnvironments: readonly Env[] = [
      {
        ...environment,
        JUDGE_MANAGED_REALTIME_ROUTE_ENABLED: "disabled",
      },
      environmentWithoutJudgeKey,
    ];
    for (const degradedEnvironment of degradedEnvironments) {
      const degraded = await handler.fetch!(
        getRequest(path),
        degradedEnvironment,
        {} as ExecutionContext,
      );
      expect(degraded.status).toBe(200);
      expect(
        RealtimeAccessResponseSchema.parse(await degraded.json()),
      ).toMatchObject({
        mode: "unavailable",
        usageSummary: "hidden",
      });
    }

    const withoutIpSecret = await handler.fetch!(
      getRequest(path),
      environmentWithoutIpSecret,
      {} as ExecutionContext,
    );
    expect(withoutIpSecret.status).toBe(200);
    expect(
      RealtimeAccessResponseSchema.parse(await withoutIpSecret.json()),
    ).toMatchObject({ mode: "judgeManaged", usageSummary: "hidden" });

    const ordinary = await handler.fetch!(
      getRequest(path, ORDINARY_BEARER),
      environment,
      {} as ExecutionContext,
    );
    expect(ordinary.status).toBe(200);
    expect(
      RealtimeAccessResponseSchema.parse(await ordinary.json()),
    ).toMatchObject({ mode: "unavailable", usageSummary: "hidden" });

    const unauthenticated = await handler.fetch!(
      getRequest(path, "unknown-access-bearer"),
      environment,
      {} as ExecutionContext,
    );
    expect(unauthenticated.status).toBe(401);
    await expect(jsonBody(unauthenticated)).resolves.toMatchObject({
      code: "AUTHENTICATION_REQUIRED",
    });
  });

  it("rechecks active assignment for every realtime access request", async () => {
    await seedFixture();
    const handler = createWorkerHandler();
    const environment = workerEnv(fakeControllerNamespace());
    const path = `/api/v1/meetings/${encodeURIComponent(MEETING_ID)}/realtime/access`;
    const first = await handler.fetch!(
      getRequest(path),
      environment,
      {} as ExecutionContext,
    );
    expect(first.status).toBe(200);

    await env.DB.withSession("first-primary")
      .prepare(
        `
          UPDATE participant_assignments
          SET active = 0
          WHERE meeting_id = ? AND user_id = ?
        `,
      )
      .bind(MEETING_ID, JUDGE_USER_ID)
      .run();
    try {
      const second = await handler.fetch!(
        getRequest(path),
        environment,
        {} as ExecutionContext,
      );
      expect(second.status).toBe(403);
      await expect(jsonBody(second)).resolves.toMatchObject({
        code: "FORBIDDEN",
      });
    } finally {
      await env.DB.withSession("first-primary")
        .prepare(
          `
            UPDATE participant_assignments
            SET active = 1
            WHERE meeting_id = ? AND user_id = ?
          `,
        )
        .bind(MEETING_ID, JUDGE_USER_ID)
        .run();
    }
  });

  it("releases a failed start claim so the same idempotency key can retry", async () => {
    await seedFixture();
    const environment: Env = {
      ...workerEnv(fakeControllerNamespace()),
      JUDGE_REALTIME_CALLS: env.JUDGE_REALTIME_CALLS,
    };
    const response = await createWorkerHandler().fetch!(
      request(
        `/api/v1/meetings/${encodeURIComponent(MEETING_ID)}/realtime/calls`,
        {
          channel: "private",
          idempotencyKey: "managed-worker-real-do-fail-closed",
          meetingId: MEETING_ID,
          sdpOffer: "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n",
        },
      ),
      environment,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(503);
    await expect(jsonBody(response)).resolves.toMatchObject({
      code: "REALTIME_UNAVAILABLE",
    });
    const reservation = await env.DB.withSession("first-primary")
      .prepare(
        `
          SELECT reservation_id, status
          FROM judge_usage_reservations
          WHERE account_id = ? AND meeting_id = ?
          ORDER BY reserved_at_epoch DESC
          LIMIT 1
        `,
      )
      .bind(JUDGE_USER_ID, MEETING_ID)
      .first<{ readonly reservation_id: string; readonly status: string }>();
    expect(reservation?.status).toBe("released");
    if (reservation === null) {
      throw new Error("Expected a released real-DO reservation");
    }
    const ownership = await env.DB.withSession("first-primary")
      .prepare(
        `
          SELECT status
          FROM judge_managed_realtime_calls
          WHERE reservation_id = ?
        `,
      )
      .bind(reservation.reservation_id)
      .first<{ readonly status: string }>();
    expect(ownership?.status).toBe("terminated");
    const controllerStatus = await judgeRealtimeCallControllerFor(
      env,
      reservation.reservation_id,
    ).fetch("https://judge-realtime.internal/status");
    await expect(controllerStatus.json()).resolves.toEqual({
      kind: "not_configured",
    });
    const claim = await env.DB.withSession("first-primary")
      .prepare(
        `
          SELECT *
          FROM judge_managed_realtime_start_claims
          WHERE meeting_id = ? AND user_id = ?
        `,
      )
      .bind(MEETING_ID, JUDGE_USER_ID)
      .first<Record<string, unknown>>();
    expect(claim).toBeNull();

    const retry = await createWorkerHandler().fetch!(
      request(
        `/api/v1/meetings/${encodeURIComponent(MEETING_ID)}/realtime/calls`,
        {
          channel: "private",
          idempotencyKey: "managed-worker-real-do-fail-closed",
          meetingId: MEETING_ID,
          sdpOffer: "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n",
        },
      ),
      environment,
      {} as ExecutionContext,
    );
    expect(retry.status).toBe(503);
    await expect(jsonBody(retry)).resolves.toMatchObject({
      code: "REALTIME_UNAVAILABLE",
    });

    const retryReservations = await env.DB.withSession("first-primary")
      .prepare(
        `
          SELECT COUNT(*) AS count
          FROM judge_usage_reservations
          WHERE account_id = ? AND meeting_id = ? AND status = 'released'
        `,
      )
      .bind(JUDGE_USER_ID, MEETING_ID)
      .first<{ readonly count: number }>();
    expect(retryReservations?.count).toBe(2);

    await env.DB.batch([
      env.DB.prepare(
        "DELETE FROM judge_managed_realtime_start_claims WHERE meeting_id = ? AND user_id = ?",
      ).bind(MEETING_ID, JUDGE_USER_ID),
      env.DB.prepare(
        "DELETE FROM judge_managed_realtime_calls WHERE meeting_id = ? AND user_id = ?",
      ).bind(MEETING_ID, JUDGE_USER_ID),
      env.DB.prepare(
        "DELETE FROM judge_usage_reservations WHERE meeting_id = ? AND account_id = ?",
      ).bind(MEETING_ID, JUDGE_USER_ID),
    ]);
  });

  it("authorizes, isolates, terminates, and settles a managed call without provider I/O", async () => {
    await seedFixture();
    const handler = createWorkerHandler();
    const namespace = fakeControllerNamespace();
    const environment = workerEnv(namespace);
    const startBody = {
      channel: "private",
      idempotencyKey: "managed-worker-lifecycle",
      meetingId: MEETING_ID,
      sdpOffer: "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n",
    } as const;

    const start = await handler.fetch!(
      request(
        `/api/v1/meetings/${encodeURIComponent(MEETING_ID)}/realtime/calls`,
        startBody,
      ),
      environment,
      {} as ExecutionContext,
    );
    expect(start.status).toBe(201);
    const started = CreateManagedRealtimeCallResponseSchema.parse(
      await start.json(),
    );
    const managedCallId = started.managedCallId;
    expect(started).not.toHaveProperty("providerCallId");
    expect(started).not.toHaveProperty("safetyIdentifier");
    expect(start.headers.get("x-correlation-id")).toBe(started.correlationId);

    const usagePath = `/api/v1/meetings/${encodeURIComponent(MEETING_ID)}/judge/usage`;
    const usageSummary = await handler.fetch!(
      getRequest(usagePath),
      environment,
      {} as ExecutionContext,
    );
    expect(usageSummary.status).toBe(200);
    const usageBody = await jsonBody(usageSummary);
    const reservedTokens =
      JUDGE_REALTIME_RESERVED_USAGE.estimatedInputTokens +
      JUDGE_REALTIME_RESERVED_USAGE.estimatedOutputTokens;
    expect(usageBody).toMatchObject({
      dimensions: {
        account: {
          limit: Number.MAX_SAFE_INTEGER,
          remaining: Number.MAX_SAFE_INTEGER - 1,
          used: 1,
        },
        concurrency: {
          limit: Number.MAX_SAFE_INTEGER,
          remaining: Number.MAX_SAFE_INTEGER - 1,
          used: 1,
        },
        costMicroUsd: {
          limit: 25_000_000,
          remaining:
            25_000_000 -
            JUDGE_REALTIME_RESERVED_USAGE.estimatedCostUsd * 1_000_000,
          used: JUDGE_REALTIME_RESERVED_USAGE.estimatedCostUsd * 1_000_000,
        },
        generation: {
          limit: Number.MAX_SAFE_INTEGER,
          remaining: Number.MAX_SAFE_INTEGER - 3,
          used: 3,
        },
        ip: {
          limit: Number.MAX_SAFE_INTEGER,
          remaining: Number.MAX_SAFE_INTEGER - 1,
          used: 1,
        },
        meeting: {
          limit: Number.MAX_SAFE_INTEGER,
          remaining: Number.MAX_SAFE_INTEGER - 1,
          used: 1,
        },
        realtimeSeconds: {
          limit: Number.MAX_SAFE_INTEGER,
          remaining: Number.MAX_SAFE_INTEGER - 30,
          used: 30,
        },
        tokens: {
          limit: Number.MAX_SAFE_INTEGER,
          remaining: JUDGE_GLOBAL_USAGE_LIMITS.tokensPerWindow - reservedTokens,
          used: reservedTokens,
        },
      },
      rollingWindowSeconds: 86_400,
    });
    const serializedUsage = JSON.stringify(usageBody);
    for (const privateValue of [
      JUDGE_USER_ID,
      JUDGE_BEARER,
      IP_ADDRESS,
      MEETING_ID,
      STANDARD_KEY,
    ]) {
      expect(serializedUsage).not.toContain(privateValue);
    }
    const {
      OPENAI_API_KEY_JUDGE: omittedStandardKey,
      ...environmentWithoutStandardKey
    } = environment;
    void omittedStandardKey;
    const degradedUsage = await handler.fetch!(
      getRequest(usagePath),
      {
        ...environmentWithoutStandardKey,
        JUDGE_MANAGED_REALTIME_ROUTE_ENABLED: "disabled",
      },
      {} as ExecutionContext,
    );
    expect(degradedUsage.status).toBe(200);

    const replay = await handler.fetch!(
      request(
        `/api/v1/meetings/${encodeURIComponent(MEETING_ID)}/realtime/calls`,
        startBody,
      ),
      environment,
      {} as ExecutionContext,
    );
    expect(replay.status).toBe(409);
    await expect(jsonBody(replay)).resolves.toMatchObject({
      code: "CONFLICT",
      details: { reason: "MANAGED_REALTIME_START_ALREADY_CLAIMED" },
    });
    const parallelStart = await handler.fetch!(
      request(
        `/api/v1/meetings/${encodeURIComponent(MEETING_ID)}/realtime/calls`,
        {
          channel: "shared",
          idempotencyKey: "managed-worker-parallel-channel",
          meetingId: MEETING_ID,
          sdpOffer: "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n",
        },
      ),
      environment,
      {} as ExecutionContext,
    );
    expect(parallelStart.status).toBe(201);
    const parallelStarted = await jsonBody(parallelStart);
    const parallelManagedCallId = parallelStarted.managedCallId;
    expect(typeof parallelManagedCallId).toBe("string");
    expect(parallelManagedCallId).not.toBe(managedCallId);
    const reservationCount = await env.DB.withSession("first-primary")
      .prepare(
        `
          SELECT COUNT(*) AS count
          FROM judge_usage_reservations
          WHERE account_id = ? AND meeting_id = ?
        `,
      )
      .bind(JUDGE_USER_ID, MEETING_ID)
      .first<{ readonly count: number }>();
    expect(reservationCount?.count).toBe(2);

    const forbiddenUsage = await handler.fetch!(
      getRequest(usagePath),
      { ...environment, JUDGE_USER_ID: "different-judge" },
      {} as ExecutionContext,
    );
    expect(forbiddenUsage.status).toBe(403);
    await expect(jsonBody(forbiddenUsage)).resolves.toMatchObject({
      code: "JUDGE_MODE_FORBIDDEN",
    });
    const unauthenticatedUsage = await handler.fetch!(
      getRequest(usagePath, "unknown-bearer"),
      environment,
      {} as ExecutionContext,
    );
    expect(unauthenticatedUsage.status).toBe(401);
    await expect(jsonBody(unauthenticatedUsage)).resolves.toMatchObject({
      code: "AUTHENTICATION_REQUIRED",
    });
    const missingIpUsage = await handler.fetch!(
      getRequest(usagePath, JUDGE_BEARER, false),
      environment,
      {} as ExecutionContext,
    );
    expect(missingIpUsage.status).toBe(503);
    await expect(jsonBody(missingIpUsage)).resolves.toMatchObject({
      code: "REALTIME_UNAVAILABLE",
    });

    const crossMeetingTurn = await handler.fetch!(
      request(
        `/api/v1/meetings/${encodeURIComponent(CROSS_MEETING_ID)}/realtime/calls/${String(managedCallId)}/turn`,
        {
          managedCallId,
          meetingId: CROSS_MEETING_ID,
          utteranceId: "utterance-cross-meeting-c4",
        },
      ),
      environment,
      {} as ExecutionContext,
    );
    expect(crossMeetingTurn.status).toBe(403);
    await expect(jsonBody(crossMeetingTurn)).resolves.toMatchObject({
      code: "FORBIDDEN",
    });

    const turn = await handler.fetch!(
      request(
        `/api/v1/meetings/${encodeURIComponent(MEETING_ID)}/realtime/calls/${String(managedCallId)}/turn`,
        {
          managedCallId,
          meetingId: MEETING_ID,
          utteranceId: "utterance-managed-c4",
        },
      ),
      environment,
      {} as ExecutionContext,
    );
    expect(turn.status).toBe(201);

    const transcript = await handler.fetch!(
      request(
        `/api/v1/meetings/${encodeURIComponent(MEETING_ID)}/realtime/calls/${String(managedCallId)}/transcript`,
        {
          managedCallId,
          meetingId: MEETING_ID,
          utteranceId: "utterance-managed-c4",
        },
      ),
      environment,
      {} as ExecutionContext,
    );
    expect(transcript.status).toBe(200);
    await expect(jsonBody(transcript)).resolves.toMatchObject({
      transcript: "synthetic managed transcript",
    });

    const terminate = await handler.fetch!(
      request(
        `/api/v1/meetings/${encodeURIComponent(MEETING_ID)}/realtime/calls/${String(managedCallId)}/terminate`,
        { managedCallId, meetingId: MEETING_ID },
      ),
      environment,
      {} as ExecutionContext,
    );
    expect(terminate.status).toBe(200);
    await expect(jsonBody(terminate)).resolves.toMatchObject({
      terminated: true,
    });
    const terminateParallel = await handler.fetch!(
      request(
        `/api/v1/meetings/${encodeURIComponent(MEETING_ID)}/realtime/calls/${String(parallelManagedCallId)}/terminate`,
        { managedCallId: parallelManagedCallId, meetingId: MEETING_ID },
      ),
      environment,
      {} as ExecutionContext,
    );
    expect(terminateParallel.status).toBe(200);
    await expect(jsonBody(terminateParallel)).resolves.toMatchObject({
      terminated: true,
    });

    const reservation = await env.DB.withSession("first-primary")
      .prepare(
        `
          SELECT status
          FROM judge_usage_reservations
          WHERE account_id = ? AND meeting_id = ?
          ORDER BY reserved_at_epoch DESC
          LIMIT 1
        `,
      )
      .bind(JUDGE_USER_ID, MEETING_ID)
      .first<{ readonly status: string }>();
    expect(reservation?.status).toBe("finalized");

    const nextStart = await handler.fetch!(
      request(
        `/api/v1/meetings/${encodeURIComponent(MEETING_ID)}/realtime/calls`,
        {
          channel: "private",
          idempotencyKey: "managed-worker-after-lifecycle",
          meetingId: MEETING_ID,
          sdpOffer: "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n",
        },
      ),
      environment,
      {} as ExecutionContext,
    );
    expect(nextStart.status).toBe(429);
    await expect(jsonBody(nextStart)).resolves.toMatchObject({
      code: "USAGE_LIMIT_REACHED",
      details: { limit: "cost" },
    });
    await env.DB.batch([
      env.DB.prepare(
        "DELETE FROM judge_managed_realtime_start_claims WHERE meeting_id = ? AND user_id = ?",
      ).bind(MEETING_ID, JUDGE_USER_ID),
      env.DB.prepare(
        "DELETE FROM judge_managed_realtime_calls WHERE meeting_id = ? AND user_id = ?",
      ).bind(MEETING_ID, JUDGE_USER_ID),
      env.DB.prepare(
        "DELETE FROM judge_usage_reservations WHERE meeting_id = ? AND account_id = ?",
      ).bind(MEETING_ID, JUDGE_USER_ID),
    ]);

    const connectorFailure = await handler.fetch!(
      request(
        `/api/v1/meetings/${encodeURIComponent(MEETING_ID)}/realtime/calls`,
        {
          channel: "private",
          idempotencyKey: "managed-worker-connector-failure",
          meetingId: MEETING_ID,
          sdpOffer:
            "v=0\r\ns=private-offer-must-not-escape\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n",
        },
      ),
      workerEnv(fakeControllerNamespace({ failStart: true })),
      {} as ExecutionContext,
    );
    expect(connectorFailure.status).toBe(503);
    const connectorFailureBody = ErrorEnvelopeSchema.parse(
      await connectorFailure.json(),
    );
    expect(connectorFailureBody).toEqual({
      code: "REALTIME_UNAVAILABLE",
      correlationId: connectorFailureBody.correlationId,
      details: {},
      message: "Realtime updates are temporarily unavailable.",
      retryable: true,
    });
    expect(connectorFailure.headers.get("x-correlation-id")).toBe(
      connectorFailureBody.correlationId,
    );
    expect(JSON.stringify(connectorFailureBody)).not.toMatch(
      /private-offer|providerResponse|sk-provider|judge-worker|203\.0\.113\.44/iu,
    );
  });

  it("rechecks session revocation before forwarding an owned turn", async () => {
    await seedFixture();
    const fixture = await createOwnedCall("managed-revocation-c4");
    const sessions = new D1SessionRepository(env.DB);
    await sessions.revoke(fixture.owner.sessionId, new Date().toISOString());
    try {
      const response = await createWorkerHandler().fetch!(
        request(
          `/api/v1/meetings/${encodeURIComponent(MEETING_ID)}/realtime/calls/${fixture.owner.managedCallId}/turn`,
          {
            managedCallId: fixture.owner.managedCallId,
            meetingId: MEETING_ID,
            utteranceId: "utterance-revoked-c4",
          },
        ),
        workerEnv(fakeControllerNamespace()),
        {} as ExecutionContext,
      );
      expect(response.status).toBe(401);
      await expect(jsonBody(response)).resolves.toMatchObject({
        code: "AUTHENTICATION_REQUIRED",
      });
    } finally {
      await fixture.ownerships.terminateOwned(
        fixture.owner,
        Math.floor(Date.now() / 1_000),
      );
      await fixture.limiter.release(fixture.reservationId);
    }
  });

  it("rechecks active assignment before forwarding an owned turn", async () => {
    await seedFixture();
    const fixture = await createOwnedCall("managed-assignment-c4");
    await env.DB.withSession("first-primary")
      .prepare(
        `
          UPDATE participant_assignments
          SET active = 0
          WHERE meeting_id = ? AND user_id = ?
        `,
      )
      .bind(MEETING_ID, JUDGE_USER_ID)
      .run();
    try {
      const response = await createWorkerHandler().fetch!(
        request(
          `/api/v1/meetings/${encodeURIComponent(MEETING_ID)}/realtime/calls/${fixture.owner.managedCallId}/turn`,
          {
            managedCallId: fixture.owner.managedCallId,
            meetingId: MEETING_ID,
            utteranceId: "utterance-assignment-removed-c4",
          },
        ),
        workerEnv(fakeControllerNamespace()),
        {} as ExecutionContext,
      );
      expect(response.status).toBe(403);
      await expect(jsonBody(response)).resolves.toMatchObject({
        code: "FORBIDDEN",
      });
    } finally {
      await env.DB.withSession("first-primary")
        .prepare(
          `
            UPDATE participant_assignments
            SET active = 1
            WHERE meeting_id = ? AND user_id = ?
          `,
        )
        .bind(MEETING_ID, JUDGE_USER_ID)
        .run();
      await fixture.ownerships.terminateOwned(
        fixture.owner,
        Math.floor(Date.now() / 1_000),
      );
      await fixture.limiter.release(fixture.reservationId);
    }
  });
});
