import type {
  MeetingApiKeyLease,
  MeetingApiKeyLeaseConfigureResult,
  MeetingApiKeyLeaseMutationResult,
  MeetingApiKeyLeaseStore,
} from "@counterpoint/ports";
import { describe, expect, it } from "vitest";

import { handleMeetingByokHttp } from "../../../apps/worker/src/meeting-byok-http.js";
import {
  DeterministicSessionTokenIssuer,
  InMemoryMeetingRepository,
  InMemorySessionRepository,
  MutableClock,
} from "../../helpers/application-adapters.js";

const NOW = "2026-07-22T08:00:00.000Z";
const MEETING_ID = "meeting-worker-byok";
const FACILITATOR_USER_ID = "facilitator-worker-byok";
const PARTICIPANT_USER_ID = "participant-worker-byok";
const JUDGE_USER_ID = "judge-worker-byok";
const FACILITATOR_BEARER = "facilitatorbearertoken";
const SECOND_FACILITATOR_BEARER = "secondfacilitatorbearer";
const PARTICIPANT_BEARER = "participantbearertoken";
const JUDGE_BEARER = "judgebearertokenvalue";
const BYOK = "sk-synthetic-worker-byok-never-returned";

class MemoryLeaseStore implements MeetingApiKeyLeaseStore {
  readonly #leases = new Map<string, MeetingApiKeyLease>();

  clear(input: {
    readonly meetingId: string;
    readonly ownerParticipantId: string;
    readonly ownerSessionId: string;
  }): Promise<MeetingApiKeyLeaseMutationResult> {
    const lease = this.#leases.get(input.meetingId);
    if (lease === undefined) return Promise.resolve({ kind: "missing" });
    if (
      lease.ownerParticipantId !== input.ownerParticipantId ||
      lease.ownerSessionId !== input.ownerSessionId
    ) {
      return Promise.resolve({ kind: "owner_mismatch" });
    }
    this.#leases.delete(input.meetingId);
    return Promise.resolve({ kind: "applied" });
  }

  clearBySession(sessionId: string): Promise<void> {
    for (const [meetingId, lease] of this.#leases) {
      if (lease.ownerSessionId === sessionId) this.#leases.delete(meetingId);
    }
    return Promise.resolve();
  }

  configure(
    lease: MeetingApiKeyLease,
  ): Promise<MeetingApiKeyLeaseConfigureResult> {
    const current = this.#leases.get(lease.meetingId);
    if (
      current !== undefined &&
      (current.ownerParticipantId !== lease.ownerParticipantId ||
        current.ownerSessionId !== lease.ownerSessionId)
    ) {
      return Promise.resolve({ kind: "owner_mismatch" });
    }
    this.#leases.set(lease.meetingId, lease);
    return Promise.resolve({ kind: "configured" });
  }

  findByMeeting(meetingId: string): Promise<MeetingApiKeyLease | undefined> {
    return Promise.resolve(this.#leases.get(meetingId));
  }

  heartbeat(input: {
    readonly heartbeatAt: string;
    readonly meetingId: string;
    readonly ownerParticipantId: string;
    readonly ownerSessionId: string;
  }): Promise<MeetingApiKeyLeaseMutationResult> {
    const lease = this.#leases.get(input.meetingId);
    if (lease === undefined) return Promise.resolve({ kind: "missing" });
    if (
      lease.ownerParticipantId !== input.ownerParticipantId ||
      lease.ownerSessionId !== input.ownerSessionId
    ) {
      return Promise.resolve({ kind: "owner_mismatch" });
    }
    this.#leases.set(input.meetingId, {
      ...lease,
      heartbeatAt: input.heartbeatAt,
    });
    return Promise.resolve({ kind: "applied" });
  }
}

async function fixture() {
  const clock = new MutableClock(NOW);
  const meetings = new InMemoryMeetingRepository();
  const sessions = new InMemorySessionRepository();
  const tokens = new DeterministicSessionTokenIssuer();
  const leases = new MemoryLeaseStore();
  await meetings.createWithAssignments(
    {
      active: true,
      code: "WORKER-BYOK",
      createdByUserId: FACILITATOR_USER_ID,
      facilitatorParticipantId: "participant-facilitator",
      meetingId: MEETING_ID,
      purpose: "Worker BYOK boundary",
    },
    [
      {
        active: true,
        meetingId: MEETING_ID,
        participantId: "participant-facilitator",
        role: "facilitator",
        userId: FACILITATOR_USER_ID,
      },
      {
        active: true,
        meetingId: MEETING_ID,
        participantId: "participant-member",
        role: "participant",
        userId: PARTICIPANT_USER_ID,
      },
      {
        active: true,
        meetingId: MEETING_ID,
        participantId: "participant-judge",
        role: "facilitator",
        userId: JUDGE_USER_ID,
      },
    ],
  );
  const sessionInputs = [
    ["session-facilitator", FACILITATOR_USER_ID, FACILITATOR_BEARER],
    [
      "session-facilitator-second",
      FACILITATOR_USER_ID,
      SECOND_FACILITATOR_BEARER,
    ],
    ["session-participant", PARTICIPANT_USER_ID, PARTICIPANT_BEARER],
    ["session-judge", JUDGE_USER_ID, JUDGE_BEARER],
  ] as const;
  for (const [sessionId, userId, bearer] of sessionInputs) {
    await sessions.put({
      absoluteExpiresAt: "2026-07-22T16:00:00.000Z",
      createdAt: NOW,
      lastActivityAt: NOW,
      sessionId,
      tokenHash: await tokens.digest(bearer),
      userId,
    });
  }
  return {
    dependencies: {
      authorizationPolicy: {
        judgeManagedAiUserIds: new Set([JUDGE_USER_ID]),
      },
      clock,
      leases,
      meetings,
      sessions,
      tokens,
    },
    leases,
  };
}

function request(
  method: "DELETE" | "POST" | "PUT",
  bearer: string,
  body: unknown,
): Request {
  return new Request(
    `https://counterpoint.test/api/v1/meetings/${MEETING_ID}/byok`,
    {
      body: JSON.stringify(body),
      headers: {
        authorization: `Bearer ${bearer}`,
        "content-type": "application/json",
      },
      method,
    },
  );
}

async function handle(
  dependencies: Awaited<ReturnType<typeof fixture>>["dependencies"],
  operation: "clear" | "configure" | "heartbeat",
  bearer: string,
  body: unknown,
) {
  const response = await handleMeetingByokHttp({
    correlationId: `correlation-${operation}`,
    dependencies,
    meetingId: MEETING_ID,
    operation,
    request: request(
      operation === "configure"
        ? "PUT"
        : operation === "clear"
          ? "DELETE"
          : "POST",
      bearer,
      body,
    ),
  });
  return { body: await response.json(), status: response.status };
}

describe("Worker meeting BYOK HTTP boundary", () => {
  it("configures, heartbeats, and clears a facilitator lease without returning the key", async () => {
    const { dependencies, leases } = await fixture();

    const configured = await handle(
      dependencies,
      "configure",
      FACILITATOR_BEARER,
      {
        apiKey: BYOK,
        meetingId: MEETING_ID,
      },
    );
    expect(configured).toEqual({
      body: {
        configured: true,
        correlationId: "correlation-configure",
        keySource: "byok",
        meetingId: MEETING_ID,
      },
      status: 201,
    });
    expect(JSON.stringify(configured.body)).not.toContain(BYOK);
    expect((await leases.findByMeeting(MEETING_ID))?.apiKey).toBe(BYOK);

    const heartbeat = await handle(
      dependencies,
      "heartbeat",
      FACILITATOR_BEARER,
      {
        meetingId: MEETING_ID,
      },
    );
    expect(heartbeat).toMatchObject({ body: { active: true }, status: 200 });

    const cleared = await handle(dependencies, "clear", FACILITATOR_BEARER, {
      meetingId: MEETING_ID,
    });
    expect(cleared).toMatchObject({ body: { cleared: true }, status: 200 });
    expect(await leases.findByMeeting(MEETING_ID)).toBeUndefined();
  });

  it("rejects participant and judge-managed configuration", async () => {
    const { dependencies } = await fixture();
    const body = { apiKey: BYOK, meetingId: MEETING_ID };

    await expect(
      handle(dependencies, "configure", PARTICIPANT_BEARER, body),
    ).resolves.toMatchObject({ body: { code: "FORBIDDEN" }, status: 403 });
    await expect(
      handle(dependencies, "configure", JUDGE_BEARER, body),
    ).resolves.toMatchObject({
      body: { code: "JUDGE_MODE_FORBIDDEN" },
      status: 403,
    });
  });

  it("does not let a second facilitator session replace an active owner lease", async () => {
    const { dependencies } = await fixture();
    const body = { apiKey: BYOK, meetingId: MEETING_ID };
    await handle(dependencies, "configure", FACILITATOR_BEARER, body);

    const replacement = await handle(
      dependencies,
      "configure",
      SECOND_FACILITATOR_BEARER,
      { apiKey: "sk-synthetic-second-owner-key", meetingId: MEETING_ID },
    );

    expect(replacement).toMatchObject({
      body: { code: "FORBIDDEN" },
      status: 403,
    });
    expect(JSON.stringify(replacement.body)).not.toContain("sk-synthetic");
  });

  it("rejects malformed bodies and meeting scope mismatches before lease mutation", async () => {
    const { dependencies, leases } = await fixture();

    const result = await handle(dependencies, "configure", FACILITATOR_BEARER, {
      apiKey: BYOK,
      meetingId: "meeting-wrong-scope",
    });

    expect(result).toMatchObject({
      body: { code: "VALIDATION_FAILED" },
      status: 400,
    });
    expect(await leases.findByMeeting(MEETING_ID)).toBeUndefined();
  });
});
