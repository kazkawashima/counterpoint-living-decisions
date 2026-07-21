import { handleIssueRealtimeClientSecretHttp } from "@counterpoint/http-api";
import type {
  ManagedRealtimeSecretIssuer,
  MeetingApiKeyLease,
  MeetingApiKeyLeaseConfigureResult,
  MeetingApiKeyLeaseMutationResult,
  MeetingApiKeyLeaseStore,
  RealtimeSecret,
  RealtimeSecretIssuer,
} from "@counterpoint/ports";
import { describe, expect, it } from "vitest";

import {
  DeterministicSessionTokenIssuer,
  InMemoryMeetingRepository,
  InMemorySessionRepository,
  MutableClock,
} from "../helpers/application-adapters.js";

const NOW = "2026-07-19T12:00:00.000Z";
const MEETING_ID = "meeting-http-contract";
const BEARER_TOKEN = "contractbearertoken";
const BYOK = "sk-synthetic-contract-byok-never-returned";

class MemoryLeaseStore implements MeetingApiKeyLeaseStore {
  readonly #leases = new Map<string, MeetingApiKeyLease>();

  clear(): Promise<MeetingApiKeyLeaseMutationResult> {
    return Promise.resolve({ kind: "missing" });
  }

  clearBySession(): Promise<void> {
    return Promise.resolve();
  }

  configure(
    lease: MeetingApiKeyLease,
  ): Promise<MeetingApiKeyLeaseConfigureResult> {
    this.#leases.set(lease.meetingId, lease);
    return Promise.resolve({ kind: "configured" });
  }

  findByMeeting(meetingId: string): Promise<MeetingApiKeyLease | undefined> {
    return Promise.resolve(this.#leases.get(meetingId));
  }

  heartbeat(): Promise<MeetingApiKeyLeaseMutationResult> {
    return Promise.resolve({ kind: "missing" });
  }
}

class FixtureByokIssuer implements RealtimeSecretIssuer {
  readonly inputs: Parameters<RealtimeSecretIssuer["issue"]>[0][] = [];

  issue(
    input: Parameters<RealtimeSecretIssuer["issue"]>[0],
  ): Promise<RealtimeSecret> {
    this.inputs.push(input);
    return Promise.resolve({
      channel: input.channel,
      expiresAt: "2026-07-19T12:01:00.000Z",
      model: "gpt-realtime-contract",
      value: "ek_contract_byok",
    });
  }
}

class FixtureManagedIssuer implements ManagedRealtimeSecretIssuer {
  readonly inputs: Parameters<ManagedRealtimeSecretIssuer["issue"]>[0][] = [];

  issue(
    input: Parameters<ManagedRealtimeSecretIssuer["issue"]>[0],
  ): Promise<RealtimeSecret> {
    this.inputs.push(input);
    return Promise.resolve({
      channel: input.channel,
      expiresAt: "2026-07-19T12:01:00.000Z",
      model: "gpt-realtime-contract",
      value: "ek_contract_managed",
    });
  }
}

async function fixture(options: {
  readonly judge: boolean;
  readonly judgeByokIssuer?: ManagedRealtimeSecretIssuer;
  readonly managedIssuer?: ManagedRealtimeSecretIssuer;
}) {
  const clock = new MutableClock(NOW);
  const meetings = new InMemoryMeetingRepository();
  const sessions = new InMemorySessionRepository();
  const tokens = new DeterministicSessionTokenIssuer();
  const leases = new MemoryLeaseStore();
  const byokIssuer = new FixtureByokIssuer();
  const judgeByokApiKeys: string[] = [];
  const userId = options.judge ? "user-judge" : "user-ordinary";
  await meetings.createWithAssignments(
    {
      active: true,
      code: "HTTP-CONTRACT",
      createdByUserId: userId,
      facilitatorParticipantId: "participant-facilitator",
      meetingId: MEETING_ID,
      purpose: "Shared HTTP contract",
    },
    [
      {
        active: true,
        meetingId: MEETING_ID,
        participantId: "participant-facilitator",
        role: "facilitator",
        userId,
      },
    ],
  );
  await sessions.put({
    absoluteExpiresAt: "2026-07-19T20:00:00.000Z",
    createdAt: NOW,
    lastActivityAt: NOW,
    sessionId: "session-http-contract",
    tokenHash: await tokens.digest(BEARER_TOKEN),
    userId,
  });
  if (!options.judge) {
    await leases.configure({
      apiKey: BYOK,
      heartbeatAt: NOW,
      meetingId: MEETING_ID,
      ownerParticipantId: "participant-facilitator",
      ownerSessionId: "session-http-contract",
    });
  }
  return {
    byokIssuer,
    judgeByokApiKeys,
    dependencies: {
      authorizationPolicy: options.judge
        ? { judgeManagedAiUserIds: new Set([userId]) }
        : {},
      clock,
      ...(options.judgeByokIssuer === undefined
        ? {}
        : {
            judgeByokIssuerFactory: (apiKey: string) => {
              judgeByokApiKeys.push(apiKey);
              return options.judgeByokIssuer;
            },
          }),
      meetings,
      realtimeSecrets: {
        clock,
        hashSafetyIdentifier: (value: string) => `sha256:${value.length}`,
        issuer: byokIssuer,
        ...(options.managedIssuer === undefined
          ? {}
          : { judgeManagedIssuer: options.managedIssuer }),
        leases,
      },
      sessions,
      tokens,
    },
  };
}

function request(body: unknown, bearerToken = BEARER_TOKEN): Request {
  return new Request(
    `https://counterpoint.test/api/v1/meetings/${MEETING_ID}/realtime/client-secrets`,
    {
      body: JSON.stringify(body),
      headers: {
        authorization: `Bearer ${bearerToken}`,
        "content-type": "application/json",
      },
      method: "POST",
    },
  );
}

async function handle(
  dependencies: Awaited<ReturnType<typeof fixture>>["dependencies"],
  body: unknown,
  options: { readonly bearerToken?: string; readonly meetingId?: string } = {},
) {
  const response = await handleIssueRealtimeClientSecretHttp({
    correlationId: "correlation-http-contract",
    dependencies,
    meetingId: options.meetingId ?? MEETING_ID,
    request: request(body, options.bearerToken),
  });
  return {
    body: await response.json(),
    headers: response.headers,
    status: response.status,
  };
}

describe("shared Realtime client-secret HTTP semantics", () => {
  it("issues judge-managed credentials without a BYOK lease", async () => {
    const managedIssuer = new FixtureManagedIssuer();
    const { byokIssuer, dependencies } = await fixture({
      judge: true,
      managedIssuer,
    });

    const result = await handle(dependencies, {
      channel: "private",
      meetingId: MEETING_ID,
    });

    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({
      clientSecret: "ek_contract_managed",
      correlationId: "correlation-http-contract",
      keySource: "judgeManaged",
    });
    expect(result.headers.get("cache-control")).toBe("no-store");
    expect(result.headers.get("x-correlation-id")).toBe(
      "correlation-http-contract",
    );
    expect(byokIssuer.inputs).toEqual([]);
    expect(managedIssuer.inputs).toHaveLength(1);
    expect("apiKey" in managedIssuer.inputs[0]!).toBe(false);
    expect(JSON.stringify(result.body)).not.toContain(BYOK);
  });

  it("lets an allowlisted judge use a request-scoped BYOK key without storing or returning it", async () => {
    const judgeByokIssuer = new FixtureManagedIssuer();
    const { dependencies, judgeByokApiKeys } = await fixture({
      judge: true,
      judgeByokIssuer,
    });

    const result = await handle(dependencies, {
      apiKey: BYOK,
      channel: "private",
      meetingId: MEETING_ID,
    });

    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({
      clientSecret: "ek_contract_managed",
      keySource: "judgeProvided",
    });
    expect(judgeByokApiKeys).toEqual([BYOK]);
    expect(judgeByokIssuer.inputs).toHaveLength(1);
    expect(JSON.stringify(result.body)).not.toContain(BYOK);
  });

  it("does not accept a request-scoped BYOK key from an ordinary account", async () => {
    const { byokIssuer, dependencies } = await fixture({ judge: false });

    const result = await handle(dependencies, {
      apiKey: BYOK,
      channel: "private",
      meetingId: MEETING_ID,
    });

    expect(result).toMatchObject({
      body: { code: "VALIDATION_FAILED" },
      status: 400,
    });
    expect(byokIssuer.inputs).toEqual([]);
  });

  it("preserves ordinary BYOK behavior without inheriting judge mode", async () => {
    const managedIssuer = new FixtureManagedIssuer();
    const { byokIssuer, dependencies } = await fixture({
      judge: false,
      managedIssuer,
    });

    const result = await handle(dependencies, {
      channel: "shared",
      meetingId: MEETING_ID,
    });

    expect(result.body).toMatchObject({
      clientSecret: "ek_contract_byok",
      keySource: "facilitatorProvided",
    });
    expect(byokIssuer.inputs).toHaveLength(1);
    expect(managedIssuer.inputs).toEqual([]);
  });

  it("rejects client-supplied judge authority before authentication or provider work", async () => {
    const managedIssuer = new FixtureManagedIssuer();
    const { byokIssuer, dependencies } = await fixture({
      judge: true,
      managedIssuer,
    });

    const result = await handle(dependencies, {
      channel: "private",
      judgeMode: true,
      keySource: "judgeManaged",
      meetingId: MEETING_ID,
    });

    expect(result).toMatchObject({
      body: { code: "VALIDATION_FAILED" },
      status: 400,
    });
    expect(byokIssuer.inputs).toEqual([]);
    expect(managedIssuer.inputs).toEqual([]);
  });

  it("fails closed on missing auth, path mismatch, and absent managed issuer", async () => {
    const { dependencies } = await fixture({ judge: true });

    await expect(
      handle(
        dependencies,
        { channel: "private", meetingId: MEETING_ID },
        { bearerToken: "short" },
      ),
    ).resolves.toMatchObject({
      body: { code: "AUTHENTICATION_REQUIRED" },
      status: 401,
    });
    await expect(
      handle(
        dependencies,
        { channel: "private", meetingId: MEETING_ID },
        { meetingId: "meeting-other" },
      ),
    ).resolves.toMatchObject({
      body: { code: "VALIDATION_FAILED" },
      status: 400,
    });
    await expect(
      handle(dependencies, {
        channel: "private",
        meetingId: MEETING_ID,
      }),
    ).resolves.toMatchObject({
      body: { code: "REALTIME_UNAVAILABLE" },
      status: 503,
    });
  });

  it("reissues from a fresh managed issuer without coordinator or lease state", async () => {
    for (const suffix of ["first", "after-eviction"]) {
      const managedIssuer = new FixtureManagedIssuer();
      const { dependencies } = await fixture({
        judge: true,
        managedIssuer,
      });
      const result = await handle(dependencies, {
        channel: "shared",
        meetingId: MEETING_ID,
      });
      expect(result.body).toMatchObject({
        clientSecret: "ek_contract_managed",
        keySource: "judgeManaged",
      });
      expect(managedIssuer.inputs, suffix).toHaveLength(1);
    }
  });
});
