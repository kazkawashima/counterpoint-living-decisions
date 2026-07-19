/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import {
  D1MeetingRepository,
  D1SessionRepository,
  WebCryptoSessionTokenIssuer,
} from "@counterpoint/adapters-cloudflare";
import type { ParticipantAssignment } from "@counterpoint/ports";

import {
  createWorkerHandler,
  meetingCoordinatorFor,
  type Env,
} from "../../apps/worker/src/index.js";

const MEETING_ID = "meeting/worker-judge-c3";
const JUDGE_USER_ID = "judge-worker-c3";
const ORDINARY_USER_ID = "ordinary-worker-c3";
const FACILITATOR_USER_ID = "facilitator-worker-c3";
const JUDGE_BEARER = "judge-worker-bearer-token-c3";
const ORDINARY_BEARER = "ordinary-worker-bearer-token-c3";
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
  it("keeps direct judge client-secret issuance disabled so usage control cannot be bypassed", async () => {
    await seedJudgeFixture();
    const configuredEnv = workerEnv({
      JUDGE_USER_ID,
      OPENAI_API_KEY_JUDGE: STANDARD_KEY,
    });

    const firstHandler = createWorkerHandler();
    const first = await firstHandler.fetch!(
      request(JUDGE_BEARER),
      configuredEnv,
      {} as ExecutionContext,
    );
    expect(first.status).toBe(503);
    await expect(first.clone().json()).resolves.toMatchObject({
      code: "REALTIME_UNAVAILABLE",
    });
    expect(await first.text()).not.toContain(STANDARD_KEY);

    const ordinary = await firstHandler.fetch!(
      request(ORDINARY_BEARER),
      configuredEnv,
      {} as ExecutionContext,
    );
    expect(ordinary.status).toBe(400);
    await expect(ordinary.json()).resolves.toMatchObject({
      code: "API_KEY_REQUIRED",
    });

    const afterEviction = await createWorkerHandler().fetch!(
      request(JUDGE_BEARER),
      configuredEnv,
      {} as ExecutionContext,
    );
    expect(afterEviction.status).toBe(503);
    await expect(afterEviction.json()).resolves.toMatchObject({
      code: "REALTIME_UNAVAILABLE",
    });

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
