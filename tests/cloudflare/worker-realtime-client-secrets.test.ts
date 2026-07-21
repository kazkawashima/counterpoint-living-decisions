/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import {
  D1MeetingRepository,
  D1SessionRepository,
  WebCryptoSessionTokenIssuer,
} from "@counterpoint/adapters-cloudflare";
import type {
  ManagedRealtimeSecretIssuer,
  ParticipantAssignment,
} from "@counterpoint/ports";

import {
  createWorkerHandler,
  meetingCoordinatorFor,
  type CreateWorkerHandlerOptions,
  type Env,
} from "../../apps/worker/src/index.js";

const MEETING_ID = "meeting/worker-judge-c3";
const JUDGE_USER_ID = "judge-worker-c3";
const ORDINARY_USER_ID = "ordinary-worker-c3";
const FACILITATOR_USER_ID = "facilitator-worker-c3";
const JUDGE_BEARER = "judge-worker-bearer-token-c3";
const ORDINARY_BEARER = "ordinary-worker-bearer-token-c3";
const FACILITATOR_BEARER = "facilitator-worker-bearer-token-c3";
const SECOND_FACILITATOR_BEARER = "facilitator-worker-second-bearer-token-c3";
const STANDARD_KEY = "sk-standard-worker-secret-never-exposed-c3";

type WorkerRequest = Parameters<
  NonNullable<ReturnType<typeof createWorkerHandler>["fetch"]>
>[0];

function workerEnv(bindings: {
  readonly JUDGE_IP_HMAC_SECRET?: string;
  readonly JUDGE_MANAGED_REALTIME_ROUTE_ENABLED?: string;
  readonly JUDGE_USER_ID?: string;
  readonly OPENAI_API_KEY_JUDGE?: string;
}): Env {
  return {
    ARTIFACTS: env.ARTIFACTS,
    ASSETS: env.ASSETS,
    DB: env.DB,
    JUDGE_REALTIME_CALLS: env.JUDGE_REALTIME_CALLS,
    MEETINGS: env.MEETINGS,
    OPENAI_MODE: env.OPENAI_MODE,
    OPENAI_MODEL: env.OPENAI_MODEL,
    RUNTIME_MODE: env.RUNTIME_MODE,
    ...bindings,
  };
}

async function seedJudgeFixture(): Promise<void> {
  const database = env.DB.withSession("first-primary");
  await database.batch(
    [FACILITATOR_USER_ID, JUDGE_USER_ID, ORDINARY_USER_ID].map((userId) =>
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

  const assignments: readonly ParticipantAssignment[] = [
    {
      active: true,
      meetingId: MEETING_ID,
      participantId: "participant-worker-facilitator",
      role: "facilitator",
      userId: FACILITATOR_USER_ID,
    },
    {
      active: true,
      meetingId: MEETING_ID,
      participantId: "participant-worker-judge",
      role: "participant",
      userId: JUDGE_USER_ID,
    },
    {
      active: true,
      meetingId: MEETING_ID,
      participantId: "participant-worker-ordinary",
      role: "participant",
      userId: ORDINARY_USER_ID,
    },
  ];
  const meetings = new D1MeetingRepository(env.DB);
  if ((await meetings.findById(MEETING_ID)) === undefined) {
    await meetings.createWithAssignments(
      {
        active: true,
        code: "WORKER-JUDGE-C3",
        createdByUserId: FACILITATOR_USER_ID,
        facilitatorParticipantId: "participant-worker-facilitator",
        meetingId: MEETING_ID,
        purpose: "Judge-managed Worker Realtime proof",
      },
      assignments,
    );
  }

  const tokens = new WebCryptoSessionTokenIssuer();
  const sessions = new D1SessionRepository(env.DB);
  const now = new Date();
  const absoluteExpiresAt = new Date(
    now.getTime() + 8 * 60 * 60 * 1_000,
  ).toISOString();
  await sessions.put({
    absoluteExpiresAt,
    createdAt: now.toISOString(),
    lastActivityAt: now.toISOString(),
    sessionId: "session-worker-judge-c3",
    tokenHash: await tokens.digest(JUDGE_BEARER),
    userId: JUDGE_USER_ID,
  });
  await sessions.put({
    absoluteExpiresAt,
    createdAt: now.toISOString(),
    lastActivityAt: now.toISOString(),
    sessionId: "session-worker-ordinary-c3",
    tokenHash: await tokens.digest(ORDINARY_BEARER),
    userId: ORDINARY_USER_ID,
  });
  await sessions.put({
    absoluteExpiresAt,
    createdAt: now.toISOString(),
    lastActivityAt: now.toISOString(),
    sessionId: "session-worker-facilitator-c3",
    tokenHash: await tokens.digest(FACILITATOR_BEARER),
    userId: FACILITATOR_USER_ID,
  });
  await sessions.put({
    absoluteExpiresAt,
    createdAt: now.toISOString(),
    lastActivityAt: now.toISOString(),
    sessionId: "session-worker-facilitator-second-c3",
    tokenHash: await tokens.digest(SECOND_FACILITATOR_BEARER),
    userId: FACILITATOR_USER_ID,
  });
}

function request(bearerToken: string): WorkerRequest {
  return new Request(
    `https://counterpoint.test/api/v1/meetings/${encodeURIComponent(MEETING_ID)}/realtime/client-secrets`,
    {
      body: JSON.stringify({
        channel: "private",
        meetingId: MEETING_ID,
      }),
      headers: {
        authorization: `Bearer ${bearerToken}`,
        "content-type": "application/json",
      },
      method: "POST",
    },
  ) as unknown as WorkerRequest;
}

describe("Cloudflare Worker judge-managed Realtime client secrets", () => {
  it("reports an unknown API route truthfully instead of blaming artifact storage", async () => {
    const response = await createWorkerHandler().fetch!(
      new Request(
        "https://counterpoint.test/api/v1/definitely-not-a-route",
      ) as unknown as WorkerRequest,
      workerEnv({}),
      {} as ExecutionContext,
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      code: "ROUTE_NOT_FOUND",
      retryable: false,
    });
  });

  it("persists an ordinary facilitator BYOK lease only in the meeting coordinator lifecycle", async () => {
    await seedJudgeFixture();
    const configuredEnv = workerEnv({ JUDGE_USER_ID });
    const handler = createWorkerHandler();
    const meetingPath = `/api/v1/meetings/${encodeURIComponent(MEETING_ID)}`;
    const call = (path: string, method: string, body?: unknown) =>
      handler.fetch!(
        new Request(`https://counterpoint.test${path}`, {
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          headers: {
            authorization: `Bearer ${FACILITATOR_BEARER}`,
            ...(body === undefined
              ? {}
              : { "content-type": "application/json" }),
          },
          method,
        }) as unknown as WorkerRequest,
        configuredEnv,
        {} as ExecutionContext,
      );

    const before = await call(`${meetingPath}/realtime/access`, "GET");
    expect(before.status).toBe(200);
    await expect(before.json()).resolves.toMatchObject({ mode: "unavailable" });

    const configured = await call(`${meetingPath}/byok`, "PUT", {
      apiKey: STANDARD_KEY,
      meetingId: MEETING_ID,
    });
    expect(configured.status).toBe(201);
    const configuredText = await configured.clone().text();
    await expect(configured.json()).resolves.toMatchObject({
      configured: true,
      keySource: "byok",
      meetingId: MEETING_ID,
    });
    expect(configuredText).not.toContain(STANDARD_KEY);

    const active = await call(`${meetingPath}/realtime/access`, "GET");
    expect(active.status).toBe(200);
    await expect(active.json()).resolves.toMatchObject({
      mode: "facilitatorProvided",
    });

    const heartbeat = await call(`${meetingPath}/byok/heartbeat`, "POST", {
      meetingId: MEETING_ID,
    });
    expect(heartbeat.status).toBe(200);
    await expect(heartbeat.json()).resolves.toMatchObject({ active: true });

    const cleared = await call(`${meetingPath}/byok`, "DELETE", {
      meetingId: MEETING_ID,
    });
    expect(cleared.status).toBe(200);
    await expect(cleared.json()).resolves.toMatchObject({ cleared: true });

    const after = await call(`${meetingPath}/realtime/access`, "GET");
    expect(after.status).toBe(200);
    await expect(after.json()).resolves.toMatchObject({ mode: "unavailable" });
  });

  it("clears a meeting BYOK lease on logout so another facilitator session can own it", async () => {
    await seedJudgeFixture();
    const configuredEnv = workerEnv({ JUDGE_USER_ID });
    const handler = createWorkerHandler();
    const meetingPath = `/api/v1/meetings/${encodeURIComponent(MEETING_ID)}`;
    const configure = (bearer: string, apiKey: string) =>
      handler.fetch!(
        new Request(`https://counterpoint.test${meetingPath}/byok`, {
          body: JSON.stringify({ apiKey, meetingId: MEETING_ID }),
          headers: {
            authorization: `Bearer ${bearer}`,
            "content-type": "application/json",
          },
          method: "PUT",
        }) as unknown as WorkerRequest,
        configuredEnv,
        {} as ExecutionContext,
      );

    expect((await configure(FACILITATOR_BEARER, STANDARD_KEY)).status).toBe(
      201,
    );
    const logout = await handler.fetch!(
      new Request("https://counterpoint.test/api/v1/logout", {
        body: JSON.stringify({}),
        headers: {
          authorization: `Bearer ${FACILITATOR_BEARER}`,
          "content-type": "application/json",
        },
        method: "POST",
      }) as unknown as WorkerRequest,
      configuredEnv,
      {} as ExecutionContext,
    );
    expect(logout.status).toBe(200);

    const replacement = await configure(
      SECOND_FACILITATOR_BEARER,
      "sk-synthetic-replacement-key-never-returned",
    );
    expect(replacement.status).toBe(201);

    const cleared = await handler.fetch!(
      new Request(`https://counterpoint.test${meetingPath}/byok`, {
        body: JSON.stringify({ meetingId: MEETING_ID }),
        headers: {
          authorization: `Bearer ${SECOND_FACILITATOR_BEARER}`,
          "content-type": "application/json",
        },
        method: "DELETE",
      }) as unknown as WorkerRequest,
      configuredEnv,
      {} as ExecutionContext,
    );
    expect(cleared.status).toBe(200);
  });

  it("issues a server-funded short-lived secret to an allowlisted judge without storing the standard key", async () => {
    await seedJudgeFixture();
    const configuredEnv = workerEnv({
      JUDGE_MANAGED_REALTIME_ROUTE_ENABLED: "enabled",
      JUDGE_USER_ID,
      OPENAI_API_KEY_JUDGE: STANDARD_KEY,
    });
    const factoryKeys: string[] = [];
    const issuerInputs: Parameters<ManagedRealtimeSecretIssuer["issue"]>[0][] =
      [];
    const options: CreateWorkerHandlerOptions & {
      readonly judgeManagedRealtimeClientSecretIssuerFactory: (
        apiKey: string,
      ) => ManagedRealtimeSecretIssuer;
    } = {
      judgeManagedRealtimeClientSecretIssuerFactory: (apiKey) => {
        factoryKeys.push(apiKey);
        return {
          issue: (input) => {
            issuerInputs.push(input);
            return Promise.resolve({
              channel: input.channel,
              expiresAt: new Date(Date.now() + 30_000).toISOString(),
              model: "gpt-realtime-2.1",
              value: "ek_worker_judge_ephemeral_only",
            });
          },
        };
      },
    };

    const firstHandler = createWorkerHandler(options);
    const first = await firstHandler.fetch!(
      request(JUDGE_BEARER),
      configuredEnv,
      {} as ExecutionContext,
    );
    expect(first.status).toBe(201);
    await expect(first.clone().json()).resolves.toMatchObject({
      clientSecret: "ek_worker_judge_ephemeral_only",
      keySource: "judgeManaged",
    });
    expect(await first.text()).not.toContain(STANDARD_KEY);
    expect(factoryKeys).toEqual([STANDARD_KEY]);
    expect(issuerInputs).toEqual([
      expect.objectContaining({
        channel: "private",
        meetingId: MEETING_ID,
        ownerParticipantId: "participant-worker-judge",
        sessionId: "session-worker-judge-c3",
      }),
    ]);
    expect(issuerInputs[0]?.safetyIdentifier).toMatch(/^[0-9a-f]{64}$/u);

    const ordinary = await firstHandler.fetch!(
      request(ORDINARY_BEARER),
      configuredEnv,
      {} as ExecutionContext,
    );
    expect(ordinary.status).toBe(400);
    await expect(ordinary.json()).resolves.toMatchObject({
      code: "API_KEY_REQUIRED",
    });

    const access = await firstHandler.fetch!(
      new Request(
        `https://counterpoint.test/api/v1/meetings/${encodeURIComponent(MEETING_ID)}/realtime/access`,
        {
          headers: { authorization: `Bearer ${JUDGE_BEARER}` },
        },
      ) as unknown as WorkerRequest,
      configuredEnv,
      {} as ExecutionContext,
    );
    expect(access.status).toBe(200);
    await expect(access.json()).resolves.toMatchObject({
      mode: "judgeManaged",
      usageSummary: "hidden",
    });

    const afterEviction = await createWorkerHandler(options).fetch!(
      request(JUDGE_BEARER),
      configuredEnv,
      {} as ExecutionContext,
    );
    expect(afterEviction.status).toBe(201);
    await expect(afterEviction.json()).resolves.toMatchObject({
      clientSecret: "ek_worker_judge_ephemeral_only",
      keySource: "judgeManaged",
    });
    expect(factoryKeys).toEqual([STANDARD_KEY, STANDARD_KEY]);

    const coordinatorHealth = await (
      await meetingCoordinatorFor(configuredEnv, MEETING_ID).fetch(
        "https://meeting-coordinator.internal/health",
      )
    ).text();
    const databaseRows = await env.DB.withSession("first-primary")
      .prepare(
        `
          SELECT user_id AS value FROM users
          UNION ALL SELECT token_hash AS value FROM sessions
          UNION ALL SELECT purpose AS value FROM meetings
          UNION ALL SELECT participant_id AS value FROM participant_assignments
        `,
      )
      .all<{ readonly value: string }>();
    expect(coordinatorHealth).not.toContain(STANDARD_KEY);
    expect(JSON.stringify(databaseRows.results)).not.toContain(STANDARD_KEY);
    expect(JSON.stringify(await env.ARTIFACTS.list())).not.toContain(
      STANDARD_KEY,
    );
  });

  it("keeps the allowlisted judge fail-closed when the Worker Secret is absent", async () => {
    await seedJudgeFixture();
    const response = await createWorkerHandler().fetch!(
      request(JUDGE_BEARER),
      workerEnv({ JUDGE_USER_ID }),
      {} as ExecutionContext,
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "REALTIME_UNAVAILABLE",
    });
  });

  it("keeps the managed-call HTTP contract unrouted until in-call spend is bounded", async () => {
    await seedJudgeFixture();
    const response = await createWorkerHandler().fetch!(
      new Request(
        `https://counterpoint.test/api/v1/meetings/${encodeURIComponent(MEETING_ID)}/realtime/calls`,
        {
          body: JSON.stringify({
            channel: "private",
            idempotencyKey: "managed-start-provider-guard",
            meetingId: MEETING_ID,
            sdpOffer: "v=0\r\ns=must-not-reach-provider\r\n",
          }),
          headers: {
            authorization: `Bearer ${JUDGE_BEARER}`,
            "content-type": "application/json",
          },
          method: "POST",
        },
      ) as unknown as WorkerRequest,
      workerEnv({
        JUDGE_USER_ID,
        OPENAI_API_KEY_JUDGE: STANDARD_KEY,
      }),
      {} as ExecutionContext,
    );

    expect(response.status).toBe(503);
    const responseText = await response.clone().text();
    await expect(response.json()).resolves.toMatchObject({
      code: "REALTIME_UNAVAILABLE",
    });
    expect(responseText).not.toContain(STANDARD_KEY);
  });

  it("keeps an explicitly enabled managed route fail-closed without verified IP input", async () => {
    await seedJudgeFixture();
    const response = await createWorkerHandler().fetch!(
      new Request(
        `https://counterpoint.test/api/v1/meetings/${encodeURIComponent(MEETING_ID)}/realtime/calls`,
        {
          body: JSON.stringify({
            channel: "private",
            idempotencyKey: "managed-start-missing-ip",
            meetingId: MEETING_ID,
            sdpOffer: "v=0\r\ns=missing-ip-header\r\n",
          }),
          headers: {
            authorization: `Bearer ${JUDGE_BEARER}`,
            "content-type": "application/json",
          },
          method: "POST",
        },
      ) as unknown as WorkerRequest,
      workerEnv({
        JUDGE_IP_HMAC_SECRET: "judge-ip-secret-worker-c3-0123456789abcdef",
        JUDGE_MANAGED_REALTIME_ROUTE_ENABLED: "enabled",
        JUDGE_USER_ID,
        OPENAI_API_KEY_JUDGE: STANDARD_KEY,
      }),
      {} as ExecutionContext,
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "REALTIME_UNAVAILABLE",
    });
    const reservationCount = await env.DB.withSession("first-primary")
      .prepare(
        `
          SELECT COUNT(*) AS count
          FROM judge_usage_reservations
          WHERE meeting_id = ? AND account_id = ?
        `,
      )
      .bind(MEETING_ID, JUDGE_USER_ID)
      .first<{ readonly count: number }>();
    expect(reservationCount?.count).toBe(0);
  });
});
