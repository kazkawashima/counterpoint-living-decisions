import { describe, expect, it, vi } from "vitest";

import {
  MEETING_API_KEY_LEASE_TTL_MS,
  clearMeetingByok,
  clearMeetingByokLeasesBySession,
  configureMeetingByok,
  heartbeatMeetingByok,
  issueRealtimeClientSecret,
  resolveRealtimeAccess,
  userAuthorizationContext,
  type RealtimeSecretDependencies,
  type UserAuthorizationContext,
} from "../../../packages/application/src/index.js";
import type {
  ManagedRealtimeSecretIssuer,
  MeetingApiKeyLease,
  MeetingApiKeyLeaseConfigureResult,
  MeetingApiKeyLeaseMutationResult,
  MeetingApiKeyLeaseStore,
  RealtimeSecret,
  RealtimeSecretIssuer,
} from "../../../packages/ports/src/index.js";
import { MutableClock } from "../../helpers/application-adapters.js";

const NOW = "2026-07-19T12:00:00.000Z";
const STANDARD_API_KEY = "sk-standard-secret-never-returned";

class InMemoryMeetingApiKeyLeaseStore implements MeetingApiKeyLeaseStore {
  readonly #leases = new Map<string, MeetingApiKeyLease>();
  failReads = false;

  clear(input: {
    readonly meetingId: string;
    readonly ownerParticipantId: string;
    readonly ownerSessionId: string;
  }): Promise<MeetingApiKeyLeaseMutationResult> {
    const lease = this.#leases.get(input.meetingId);
    if (lease === undefined) {
      return Promise.resolve({ kind: "missing" });
    }
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
      if (lease.ownerSessionId === sessionId) {
        this.#leases.delete(meetingId);
      }
    }
    return Promise.resolve();
  }

  configure(
    lease: MeetingApiKeyLease,
  ): Promise<MeetingApiKeyLeaseConfigureResult> {
    const existing = this.#leases.get(lease.meetingId);
    if (
      existing !== undefined &&
      (existing.ownerParticipantId !== lease.ownerParticipantId ||
        existing.ownerSessionId !== lease.ownerSessionId)
    ) {
      return Promise.resolve({ kind: "owner_mismatch" });
    }
    this.#leases.set(lease.meetingId, lease);
    return Promise.resolve({ kind: "configured" });
  }

  findByMeeting(meetingId: string): Promise<MeetingApiKeyLease | undefined> {
    if (this.failReads) {
      return Promise.reject(new Error("synthetic lease storage outage"));
    }
    return Promise.resolve(this.#leases.get(meetingId));
  }

  heartbeat(input: {
    readonly heartbeatAt: string;
    readonly meetingId: string;
    readonly ownerParticipantId: string;
    readonly ownerSessionId: string;
  }): Promise<MeetingApiKeyLeaseMutationResult> {
    const lease = this.#leases.get(input.meetingId);
    if (lease === undefined) {
      return Promise.resolve({ kind: "missing" });
    }
    if (
      lease.ownerParticipantId !== input.ownerParticipantId ||
      lease.ownerSessionId !== input.ownerSessionId
    ) {
      return Promise.resolve({ kind: "owner_mismatch" });
    }
    const renewed = { ...lease, heartbeatAt: input.heartbeatAt };
    this.#leases.set(input.meetingId, renewed);
    return Promise.resolve({ kind: "applied" });
  }
}

class CapturingRealtimeSecretIssuer implements RealtimeSecretIssuer {
  readonly inputs: Parameters<RealtimeSecretIssuer["issue"]>[0][] = [];
  expiresAt = "2026-07-19T12:10:00.000Z";
  fail = false;

  issue(
    input: Parameters<RealtimeSecretIssuer["issue"]>[0],
  ): Promise<RealtimeSecret> {
    this.inputs.push(input);
    if (this.fail) {
      return Promise.reject(new Error("provider unavailable"));
    }
    return Promise.resolve({
      channel: input.channel,
      expiresAt: this.expiresAt,
      model: "gpt-realtime-2.1",
      value: "ek_ephemeral_client_secret",
    });
  }
}

class CapturingManagedRealtimeSecretIssuer implements ManagedRealtimeSecretIssuer {
  readonly inputs: Parameters<ManagedRealtimeSecretIssuer["issue"]>[0][] = [];

  issue(
    input: Parameters<ManagedRealtimeSecretIssuer["issue"]>[0],
  ): Promise<RealtimeSecret> {
    this.inputs.push(input);
    return Promise.resolve({
      channel: input.channel,
      expiresAt: "2026-07-19T12:10:00.000Z",
      model: "gpt-realtime-2.1",
      value: "ek_judge_managed_ephemeral_secret",
    });
  }
}

function facilitatorContext(
  overrides: Partial<UserAuthorizationContext> = {},
): UserAuthorizationContext {
  return {
    ...userAuthorizationContext({
      meetingId: "meeting-a",
      participantId: "participant-facilitator",
      role: "facilitator",
      sessionId: "session-facilitator",
      userId: "user-facilitator",
    }),
    ...overrides,
  };
}

function participantContext(
  overrides: Partial<UserAuthorizationContext> = {},
): UserAuthorizationContext {
  return {
    ...userAuthorizationContext({
      meetingId: "meeting-a",
      participantId: "participant-legal",
      role: "participant",
      sessionId: "session-participant",
      userId: "user-participant",
    }),
    ...overrides,
  };
}

function judgeContext(): UserAuthorizationContext {
  return userAuthorizationContext(
    {
      meetingId: "meeting-a",
      participantId: "participant-judge",
      role: "facilitator",
      sessionId: "session-judge",
      userId: "user-judge",
    },
    { judgeManagedAiUserIds: new Set(["user-judge"]) },
  );
}

function fixture() {
  const clock = new MutableClock(NOW);
  const issuer = new CapturingRealtimeSecretIssuer();
  const judgeManagedIssuer = new CapturingManagedRealtimeSecretIssuer();
  const leases = new InMemoryMeetingApiKeyLeaseStore();
  const hashSafetyIdentifier = vi.fn(
    (value: string) => `sha256:${Buffer.from(value).toString("hex")}`,
  );
  const dependencies: RealtimeSecretDependencies = {
    clock,
    hashSafetyIdentifier,
    issuer,
    judgeManagedIssuer,
    leases,
  };
  return {
    clock,
    dependencies,
    hashSafetyIdentifier,
    issuer,
    judgeManagedIssuer,
    leases,
  };
}

async function configure(
  dependencies: RealtimeSecretDependencies,
  context = facilitatorContext(),
  meetingId = context.meetingId,
) {
  return configureMeetingByok(dependencies, context, {
    apiKey: STANDARD_API_KEY,
    meetingId,
  });
}

describe("meeting-scoped realtime BYOK leases", () => {
  it("resolves ordinary access from an active lease without exposing lease data", async () => {
    const { dependencies } = fixture();

    await expect(
      resolveRealtimeAccess(
        {
          clock: dependencies.clock,
          judgeManagedAvailable: false,
          leases: dependencies.leases,
        },
        participantContext(),
        { meetingId: "meeting-a" },
      ),
    ).resolves.toEqual({ kind: "resolved", mode: "unavailable" });

    await configure(dependencies);
    const result = await resolveRealtimeAccess(
      {
        clock: dependencies.clock,
        judgeManagedAvailable: false,
        leases: dependencies.leases,
      },
      participantContext(),
      { meetingId: "meeting-a" },
    );
    expect(result).toEqual({
      kind: "resolved",
      mode: "facilitatorProvided",
    });
    expect(JSON.stringify(result)).not.toContain(STANDARD_API_KEY);
  });

  it("resolves judge access only from managed availability and never falls back to BYOK", async () => {
    const { dependencies, leases } = fixture();
    await configure(dependencies);
    leases.failReads = true;

    await expect(
      resolveRealtimeAccess(
        {
          clock: dependencies.clock,
          judgeManagedAvailable: true,
          leases,
        },
        judgeContext(),
        { meetingId: "meeting-a" },
      ),
    ).resolves.toEqual({ kind: "resolved", mode: "judgeManaged" });
    await expect(
      resolveRealtimeAccess(
        {
          clock: dependencies.clock,
          judgeManagedAvailable: false,
          leases,
        },
        judgeContext(),
        { meetingId: "meeting-a" },
      ),
    ).resolves.toEqual({ kind: "resolved", mode: "unavailable" });
  });

  it("fails closed for unauthorized scope and lease storage failure", async () => {
    const { dependencies, leases } = fixture();
    await expect(
      resolveRealtimeAccess(
        {
          clock: dependencies.clock,
          judgeManagedAvailable: false,
          leases,
        },
        participantContext(),
        { meetingId: "meeting-other" },
      ),
    ).resolves.toEqual({ code: "FORBIDDEN", kind: "failed" });

    leases.failReads = true;
    await expect(
      resolveRealtimeAccess(
        {
          clock: dependencies.clock,
          judgeManagedAvailable: false,
          leases,
        },
        participantContext(),
        { meetingId: "meeting-a" },
      ),
    ).resolves.toEqual({
      code: "REALTIME_UNAVAILABLE",
      kind: "failed",
    });
  });

  it("configures only in transient lease storage and never returns the standard key", async () => {
    const { dependencies, leases } = fixture();

    const result = await configure(dependencies);

    expect(result).toEqual({
      expiresAt: "2026-07-19T12:05:00.000Z",
      kind: "configured",
      meetingId: "meeting-a",
    });
    expect(JSON.stringify(result)).not.toContain(STANDARD_API_KEY);
    await expect(leases.findByMeeting("meeting-a")).resolves.toEqual({
      apiKey: STANDARD_API_KEY,
      heartbeatAt: NOW,
      meetingId: "meeting-a",
      ownerParticipantId: "participant-facilitator",
      ownerSessionId: "session-facilitator",
    });
  });

  it("requires facilitator byok permission and rejects cross-meeting scope", async () => {
    const { dependencies, issuer, leases } = fixture();

    await expect(
      configureMeetingByok(dependencies, participantContext(), {
        apiKey: STANDARD_API_KEY,
        meetingId: "meeting-a",
      }),
    ).resolves.toEqual({ code: "FORBIDDEN", kind: "failed" });
    await configure(dependencies);
    await expect(
      heartbeatMeetingByok(dependencies, participantContext(), {
        meetingId: "meeting-a",
      }),
    ).resolves.toEqual({ code: "FORBIDDEN", kind: "failed" });
    await expect(
      clearMeetingByok(dependencies, participantContext(), {
        meetingId: "meeting-a",
      }),
    ).resolves.toEqual({ code: "FORBIDDEN", kind: "failed" });
    await expect(
      configureMeetingByok(dependencies, facilitatorContext(), {
        apiKey: STANDARD_API_KEY,
        meetingId: "meeting-b",
      }),
    ).resolves.toEqual({ code: "FORBIDDEN", kind: "failed" });
    await expect(
      issueRealtimeClientSecret(dependencies, participantContext(), {
        channel: "shared",
        meetingId: "meeting-b",
      }),
    ).resolves.toEqual({ code: "FORBIDDEN", kind: "failed" });
    expect(issuer.inputs).toHaveLength(0);
    await expect(leases.findByMeeting("meeting-a")).resolves.toBeDefined();
    await expect(leases.findByMeeting("meeting-b")).resolves.toBeUndefined();
  });

  it("expires at the exact five-minute boundary and removes the raw key", async () => {
    const { clock, dependencies, issuer, leases } = fixture();
    await configure(dependencies);

    clock.advance(MEETING_API_KEY_LEASE_TTL_MS - 1);
    await expect(
      issueRealtimeClientSecret(dependencies, participantContext(), {
        channel: "shared",
        meetingId: "meeting-a",
      }),
    ).resolves.toMatchObject({ kind: "issued" });

    clock.advance(1);
    await expect(
      issueRealtimeClientSecret(dependencies, participantContext(), {
        channel: "shared",
        meetingId: "meeting-a",
      }),
    ).resolves.toEqual({
      code: "API_KEY_REQUIRED",
      kind: "failed",
    });
    expect(issuer.inputs).toHaveLength(1);
    await expect(leases.findByMeeting("meeting-a")).resolves.toBeUndefined();
  });

  it("renews from heartbeat time and enforces the facilitator session owner", async () => {
    const { clock, dependencies } = fixture();
    await configure(dependencies);
    const otherSession = facilitatorContext({
      sessionId: "session-facilitator-other",
    });

    await expect(
      heartbeatMeetingByok(dependencies, otherSession, {
        meetingId: "meeting-a",
      }),
    ).resolves.toEqual({ code: "FORBIDDEN", kind: "failed" });
    await expect(
      clearMeetingByok(dependencies, otherSession, {
        meetingId: "meeting-a",
      }),
    ).resolves.toEqual({ code: "FORBIDDEN", kind: "failed" });
    await expect(
      configureMeetingByok(dependencies, otherSession, {
        apiKey: "sk-attempted-session-takeover",
        meetingId: "meeting-a",
      }),
    ).resolves.toEqual({ code: "FORBIDDEN", kind: "failed" });

    clock.advance(MEETING_API_KEY_LEASE_TTL_MS - 1);
    await expect(
      heartbeatMeetingByok(dependencies, facilitatorContext(), {
        meetingId: "meeting-a",
      }),
    ).resolves.toEqual({
      expiresAt: "2026-07-19T12:09:59.999Z",
      kind: "active",
      meetingId: "meeting-a",
    });
    clock.advance(MEETING_API_KEY_LEASE_TTL_MS - 1);
    await expect(
      issueRealtimeClientSecret(dependencies, participantContext(), {
        channel: "shared",
        meetingId: "meeting-a",
      }),
    ).resolves.toMatchObject({ kind: "issued" });
  });

  it("binds private issuance to the caller and hashes the safety identifier", async () => {
    const { dependencies, hashSafetyIdentifier, issuer } = fixture();
    await configure(dependencies);

    const result = await issueRealtimeClientSecret(
      dependencies,
      participantContext(),
      {
        channel: "private",
        meetingId: "meeting-a",
      },
    );

    expect(result).toEqual({
      channel: "private",
      clientSecret: "ek_ephemeral_client_secret",
      expiresAt: "2026-07-19T12:10:00.000Z",
      keySource: "facilitatorProvided",
      kind: "issued",
      meetingId: "meeting-a",
      model: "gpt-realtime-2.1",
    });
    expect(JSON.stringify(result)).not.toContain(STANDARD_API_KEY);
    expect(hashSafetyIdentifier).toHaveBeenCalledWith(
      "counterpoint:realtime-safety:v1:user-participant",
    );
    expect(issuer.inputs).toEqual([
      {
        apiKey: STANDARD_API_KEY,
        channel: "private",
        meetingId: "meeting-a",
        ownerParticipantId: "participant-legal",
        safetyIdentifier:
          "sha256:636f756e746572706f696e743a7265616c74696d652d7361666574793a76313a757365722d7061727469636970616e74",
        sessionId: "session-participant",
      },
    ]);
    expect(issuer.inputs[0]?.safetyIdentifier).not.toBe("user-participant");
  });

  it("uses the managed issuer only for an allowlisted judge and never touches BYOK storage", async () => {
    const { dependencies, issuer, judgeManagedIssuer, leases } = fixture();
    const context = judgeContext();

    await expect(
      issueRealtimeClientSecret(dependencies, context, {
        channel: "private",
        meetingId: "meeting-a",
      }),
    ).resolves.toEqual({
      channel: "private",
      clientSecret: "ek_judge_managed_ephemeral_secret",
      expiresAt: "2026-07-19T12:10:00.000Z",
      keySource: "judgeManaged",
      kind: "issued",
      meetingId: "meeting-a",
      model: "gpt-realtime-2.1",
    });
    expect(issuer.inputs).toEqual([]);
    expect(judgeManagedIssuer.inputs).toEqual([
      {
        channel: "private",
        meetingId: "meeting-a",
        ownerParticipantId: "participant-judge",
        safetyIdentifier:
          "sha256:636f756e746572706f696e743a7265616c74696d652d7361666574793a76313a757365722d6a75646765",
        sessionId: "session-judge",
      },
    ]);
    await expect(leases.findByMeeting("meeting-a")).resolves.toBeUndefined();

    await expect(
      configureMeetingByok(dependencies, context, {
        apiKey: STANDARD_API_KEY,
        meetingId: "meeting-a",
      }),
    ).resolves.toEqual({
      code: "JUDGE_MODE_FORBIDDEN",
      kind: "failed",
    });
    await expect(
      heartbeatMeetingByok(dependencies, context, {
        meetingId: "meeting-a",
      }),
    ).resolves.toEqual({
      code: "JUDGE_MODE_FORBIDDEN",
      kind: "failed",
    });
    await expect(
      clearMeetingByok(dependencies, context, {
        meetingId: "meeting-a",
      }),
    ).resolves.toEqual({
      code: "JUDGE_MODE_FORBIDDEN",
      kind: "failed",
    });
  });

  it("fails judge mode closed when its managed issuer is absent and never falls back to BYOK", async () => {
    const { dependencies, issuer } = fixture();
    const withoutJudgeIssuer: RealtimeSecretDependencies = {
      clock: dependencies.clock,
      hashSafetyIdentifier: dependencies.hashSafetyIdentifier,
      issuer: dependencies.issuer,
      leases: dependencies.leases,
    };
    await configure(withoutJudgeIssuer);

    await expect(
      issueRealtimeClientSecret(withoutJudgeIssuer, judgeContext(), {
        channel: "shared",
        meetingId: "meeting-a",
      }),
    ).resolves.toEqual({
      code: "REALTIME_UNAVAILABLE",
      kind: "failed",
    });
    expect(issuer.inputs).toEqual([]);
  });

  it("omits an owner binding for shared issuance and maps issuer failure", async () => {
    const { dependencies, issuer } = fixture();
    await configure(dependencies);

    await expect(
      issueRealtimeClientSecret(dependencies, participantContext(), {
        channel: "shared",
        meetingId: "meeting-a",
      }),
    ).resolves.toMatchObject({ channel: "shared", kind: "issued" });
    expect(issuer.inputs[0]).not.toHaveProperty("ownerParticipantId");

    issuer.fail = true;
    await expect(
      issueRealtimeClientSecret(dependencies, participantContext(), {
        channel: "private",
        meetingId: "meeting-a",
      }),
    ).resolves.toEqual({
      code: "REALTIME_UNAVAILABLE",
      kind: "failed",
    });
  });

  it("fails closed when the provider returns an already expired secret", async () => {
    const { dependencies, issuer } = fixture();
    await configure(dependencies);
    issuer.expiresAt = NOW;

    await expect(
      issueRealtimeClientSecret(dependencies, participantContext(), {
        channel: "private",
        meetingId: "meeting-a",
      }),
    ).resolves.toEqual({
      code: "REALTIME_UNAVAILABLE",
      kind: "failed",
    });
  });

  it("lets the owning facilitator clear the lease without exposing it", async () => {
    const { dependencies, leases } = fixture();
    await configure(dependencies);

    const result = await clearMeetingByok(dependencies, facilitatorContext(), {
      meetingId: "meeting-a",
    });

    expect(result).toEqual({ kind: "cleared", meetingId: "meeting-a" });
    expect(JSON.stringify(result)).not.toContain(STANDARD_API_KEY);
    await expect(leases.findByMeeting("meeting-a")).resolves.toBeUndefined();
  });

  it("clears every lease owned by a logged-out session and no other session", async () => {
    const { dependencies, leases } = fixture();
    const secondContext = facilitatorContext({
      meetingId: "meeting-b",
      participantId: "participant-facilitator-b",
    });
    const thirdContext = facilitatorContext({
      meetingId: "meeting-c",
      participantId: "participant-facilitator-c",
      sessionId: "session-other",
    });
    await configure(dependencies);
    await configure(dependencies, secondContext);
    await configure(dependencies, thirdContext);

    await clearMeetingByokLeasesBySession(dependencies, "session-facilitator");

    await expect(leases.findByMeeting("meeting-a")).resolves.toBeUndefined();
    await expect(leases.findByMeeting("meeting-b")).resolves.toBeUndefined();
    await expect(leases.findByMeeting("meeting-c")).resolves.toMatchObject({
      ownerSessionId: "session-other",
    });
  });
});
