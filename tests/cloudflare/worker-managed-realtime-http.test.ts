/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

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
  JUDGE_REALTIME_RESERVED_USAGE,
  createJudgeRealtimeUsageLimiter,
} from "../../apps/worker/src/judge-realtime-call-controller.js";
import { createWorkerHandler, type Env } from "../../apps/worker/src/index.js";

const MEETING_ID = "meeting/worker-managed-http-c4";
const CROSS_MEETING_ID = "meeting/worker-managed-http-c4-cross";
const JUDGE_USER_ID = "judge-worker-managed-c4";
const JUDGE_BEARER = "judge-worker-managed-bearer-c4";
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

function fakeControllerNamespace(): FakeControllerNamespace {
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
}

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
  it("authorizes, isolates, terminates, and settles a managed call without provider I/O", async () => {
    await seedFixture();
    const handler = createWorkerHandler();
    const namespace = fakeControllerNamespace();
    const environment = workerEnv(namespace);

    const start = await handler.fetch!(
      request(
        `/api/v1/meetings/${encodeURIComponent(MEETING_ID)}/realtime/calls`,
        {
          channel: "private",
          meetingId: MEETING_ID,
          sdpOffer: "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n",
        },
      ),
      environment,
      {} as ExecutionContext,
    );
    expect(start.status).toBe(201);
    const started = await jsonBody(start);
    const managedCallId = started.managedCallId;
    expect(typeof managedCallId).toBe("string");
    expect(started).not.toHaveProperty("providerCallId");
    expect(started).not.toHaveProperty("safetyIdentifier");

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
    });
    await env.DB.batch([
      env.DB.prepare(
        "DELETE FROM judge_managed_realtime_calls WHERE meeting_id = ? AND user_id = ?",
      ).bind(MEETING_ID, JUDGE_USER_ID),
      env.DB.prepare(
        "DELETE FROM judge_usage_reservations WHERE meeting_id = ? AND account_id = ?",
      ).bind(MEETING_ID, JUDGE_USER_ID),
    ]);
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
