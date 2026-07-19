/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import {
  D1MeetingRepository,
  D1ManagedRealtimeCallOwnershipRepository,
  D1SessionRepository,
  D1UsageLimiter,
  WebCryptoSessionTokenIssuer,
  type ManagedRealtimeCallOwner,
  type ManagedRealtimeCallOwnership,
} from "@counterpoint/adapters-cloudflare";

import {
  resolveJudgeManagedAuthorization,
  resolveOwnedJudgeManagedCall,
} from "../../apps/worker/src/judge-managed-realtime-authorization.js";

const NOW_EPOCH = 1_784_486_400;
const HASH = `hmac-sha256:${"a".repeat(64)}`;

interface Fixture {
  readonly accountId: string;
  readonly meetingId: string;
  readonly participantId: string;
  readonly rawBearerToken: string;
  readonly reservationId: string;
  readonly sessionId: string;
  readonly userId: string;
}

async function fixture(label: string): Promise<Fixture> {
  const suffix = `${label}-${crypto.randomUUID()}`;
  const userId = `judge-${suffix}`;
  const meetingId = `meeting-${suffix}`;
  const participantId = `participant-${suffix}`;
  const sessionId = `session-${suffix}`;
  const rawBearerToken = `bearer-token-${suffix}`;
  const tokens = new WebCryptoSessionTokenIssuer();
  const now = new Date(NOW_EPOCH * 1_000).toISOString();
  const absoluteExpiresAt = new Date(
    (NOW_EPOCH + 8 * 60 * 60) * 1_000,
  ).toISOString();
  const database = env.DB.withSession("first-primary");
  await database.batch([
    database
      .prepare(
        `
          INSERT INTO users (user_id, password_hash, active)
          VALUES (?, ?, 1)
        `,
      )
      .bind(userId, `password-hash-${suffix}`),
    database
      .prepare(
        `
          INSERT INTO meetings (
            meeting_id,
            code,
            created_by_user_id,
            facilitator_participant_id,
            purpose,
            active
          ) VALUES (?, ?, ?, ?, ?, 1)
        `,
      )
      .bind(
        meetingId,
        `code-${suffix}`,
        userId,
        participantId,
        `purpose-${suffix}`,
      ),
    database
      .prepare(
        `
          INSERT INTO participant_assignments (
            meeting_id,
            participant_id,
            user_id,
            role,
            active
          ) VALUES (?, ?, ?, 'facilitator', 1)
        `,
      )
      .bind(meetingId, participantId, userId),
    database
      .prepare(
        `
          INSERT INTO sessions (
            session_id,
            token_hash,
            user_id,
            created_at,
            last_activity_at,
            absolute_expires_at,
            revoked_at
          ) VALUES (?, ?, ?, ?, ?, ?, NULL)
        `,
      )
      .bind(
        sessionId,
        await tokens.digest(rawBearerToken),
        userId,
        now,
        now,
        absoluteExpiresAt,
      ),
  ]);

  const limiter = new D1UsageLimiter(env.DB, {
    clock: () => new Date(NOW_EPOCH * 1_000).toISOString(),
    hashIp: () => Promise.resolve(HASH),
    ids: (namespace) => `${namespace}-${suffix}`,
    limits: {
      accountRequestsPerWindow: 10,
      concurrentReservations: 10,
      costMicroUsdPerWindow: 25_000_000,
      generationsPerWindow: 10,
      ipRequestsPerWindow: 10,
      meetingRequestsPerWindow: 10,
      realtimeSecondsPerWindow: 600,
      reservationTtlSeconds: 120,
      tokensPerWindow: 10_000,
    },
    model: "gpt-realtime-2.1",
    operation: "judge_realtime",
    pricingVersion: "test-pricing-v1",
  });
  const decision = await limiter.reserve(
    {
      accountId: userId,
      ipAddress: "192.0.2.10",
      meetingId,
    },
    {
      estimatedCostUsd: 0.000_001,
      estimatedInputTokens: 0,
      estimatedOutputTokens: 0,
      generationCount: 0,
      realtimeSeconds: 30,
    },
  );
  if (decision.kind !== "allowed") {
    throw new Error("Test fixture usage reservation was denied");
  }
  return {
    accountId: userId,
    meetingId,
    participantId,
    rawBearerToken,
    reservationId: decision.reservationId,
    sessionId,
    userId,
  };
}

function ownership(
  fixtureValue: Fixture,
  managedCallId: string,
): ManagedRealtimeCallOwnership {
  return {
    accountId: fixtureValue.accountId,
    channel: "private",
    createdAtEpoch: NOW_EPOCH,
    expiresAtEpoch: NOW_EPOCH + 60,
    managedCallId,
    meetingId: fixtureValue.meetingId,
    participantId: fixtureValue.participantId,
    reservationId: fixtureValue.reservationId,
    sessionId: fixtureValue.sessionId,
    userId: fixtureValue.userId,
  };
}

function owner(
  fixtureValue: Fixture,
  managedCallId: string,
): ManagedRealtimeCallOwner {
  return {
    managedCallId,
    meetingId: fixtureValue.meetingId,
    participantId: fixtureValue.participantId,
    sessionId: fixtureValue.sessionId,
    userId: fixtureValue.userId,
  };
}

describe("D1 managed Realtime call ownership", () => {
  it("binds one opaque handle to server-resolved identity and reservation data", async () => {
    const seeded = await fixture("persist");
    const repository = new D1ManagedRealtimeCallOwnershipRepository(env.DB);
    const managedCallId = `managed-${crypto.randomUUID()}`;

    await expect(
      repository.create(ownership(seeded, managedCallId)),
    ).resolves.toBe("created");
    await expect(
      repository.findActiveOwned(owner(seeded, managedCallId), NOW_EPOCH + 1),
    ).resolves.toEqual(ownership(seeded, managedCallId));

    const row = await env.DB.withSession("first-primary")
      .prepare(
        `
          SELECT *
          FROM judge_managed_realtime_calls
          WHERE managed_call_id = ?
        `,
      )
      .bind(managedCallId)
      .first<Record<string, unknown>>();
    expect(row).toMatchObject({
      account_id: seeded.accountId,
      channel: "private",
      meeting_id: seeded.meetingId,
      participant_id: seeded.participantId,
      reservation_id: seeded.reservationId,
      session_id: seeded.sessionId,
      status: "active",
      user_id: seeded.userId,
    });
    expect(Object.keys(row ?? {})).not.toContain("provider_call_id");
  });

  it("fails closed for every cross-owner and cross-meeting lookup", async () => {
    const seeded = await fixture("idor");
    const repository = new D1ManagedRealtimeCallOwnershipRepository(env.DB);
    const managedCallId = `managed-${crypto.randomUUID()}`;
    await repository.create(ownership(seeded, managedCallId));
    const exact = owner(seeded, managedCallId);

    for (const changed of [
      { ...exact, userId: "other-user" },
      { ...exact, sessionId: "other-session" },
      { ...exact, meetingId: "other-meeting" },
      { ...exact, participantId: "other-participant" },
      { ...exact, managedCallId: "other-call" },
    ]) {
      await expect(
        repository.findActiveOwned(changed, NOW_EPOCH + 1),
      ).resolves.toBeUndefined();
    }
    await expect(
      repository.findActiveOwned(exact, NOW_EPOCH + 61),
    ).resolves.toBeUndefined();
  });

  it("requires an exact active reservation whose account, meeting, and lifetime match", async () => {
    const seeded = await fixture("reservation");
    const repository = new D1ManagedRealtimeCallOwnershipRepository(env.DB);

    await expect(
      repository.create({
        ...ownership(seeded, `managed-${crypto.randomUUID()}`),
        accountId: "other-account",
      }),
    ).rejects.toThrow("accountId must match the authenticated user");
    await expect(
      repository.create({
        ...ownership(seeded, `managed-${crypto.randomUUID()}`),
        meetingId: "other-meeting",
      }),
    ).resolves.toBe("unavailable");
    await expect(
      repository.create({
        ...ownership(seeded, `managed-${crypto.randomUUID()}`),
        expiresAtEpoch: NOW_EPOCH + 121,
      }),
    ).resolves.toBe("unavailable");

    await env.DB.withSession("first-primary")
      .prepare(
        `
          UPDATE judge_usage_reservations
          SET status = 'released', released_at_epoch = ?
          WHERE reservation_id = ?
        `,
      )
      .bind(NOW_EPOCH + 1, seeded.reservationId)
      .run();
    await expect(
      repository.create(ownership(seeded, `managed-${crypto.randomUUID()}`)),
    ).resolves.toBe("unavailable");
  });

  it("lets exactly one opaque handle claim a reservation under a race", async () => {
    const seeded = await fixture("race");
    const repository = new D1ManagedRealtimeCallOwnershipRepository(env.DB);
    const results = await Promise.all([
      repository.create(ownership(seeded, `managed-a-${crypto.randomUUID()}`)),
      repository.create(ownership(seeded, `managed-b-${crypto.randomUUID()}`)),
    ]);

    expect(results.sort()).toEqual(["created", "unavailable"]);
    const count = await env.DB.withSession("first-primary")
      .prepare(
        `
          SELECT COUNT(*) AS count
          FROM judge_managed_realtime_calls
          WHERE reservation_id = ?
        `,
      )
      .bind(seeded.reservationId)
      .first<{ readonly count: number }>();
    expect(count?.count).toBe(1);
  });

  it("terminates idempotently only for the exact authenticated owner", async () => {
    const seeded = await fixture("terminate");
    const repository = new D1ManagedRealtimeCallOwnershipRepository(env.DB);
    const managedCallId = `managed-${crypto.randomUUID()}`;
    const exact = owner(seeded, managedCallId);
    await repository.create(ownership(seeded, managedCallId));

    await expect(
      repository.terminateOwned(
        { ...exact, sessionId: "attacker-session" },
        NOW_EPOCH + 10,
      ),
    ).resolves.toBe("unavailable");
    await expect(
      repository.findActiveOwned(exact, NOW_EPOCH + 11),
    ).resolves.toBeDefined();
    await expect(
      repository.terminateOwned(exact, NOW_EPOCH + 12),
    ).resolves.toBe("terminated");
    await expect(
      repository.terminateOwned(exact, NOW_EPOCH + 30),
    ).resolves.toBe("terminated");
    await expect(
      repository.findActiveOwned(exact, NOW_EPOCH + 13),
    ).resolves.toBeUndefined();
  });

  it("rejects malformed opaque IDs without reflecting their contents", async () => {
    const seeded = await fixture("validation");
    const repository = new D1ManagedRealtimeCallOwnershipRepository(env.DB);
    const unsafeValue = "unsafe managed call";

    await expect(
      repository.create(ownership(seeded, unsafeValue)),
    ).rejects.toThrow("managedCallId must be an opaque identifier");
    try {
      await repository.create(ownership(seeded, unsafeValue));
    } catch (error) {
      expect(String(error)).not.toContain(unsafeValue);
    }
  });

  it("re-authenticates and re-resolves judge ownership for every call operation", async () => {
    const seeded = await fixture("auth");
    const repository = new D1ManagedRealtimeCallOwnershipRepository(env.DB);
    const managedCallId = `managed-${crypto.randomUUID()}`;
    await repository.create(ownership(seeded, managedCallId));
    const dependencies = {
      authorizationPolicy: {
        judgeManagedAiUserIds: new Set([seeded.userId]),
      },
      clock: {
        now: () => new Date((NOW_EPOCH + 1) * 1_000).toISOString(),
      },
      meetings: new D1MeetingRepository(env.DB),
      sessions: new D1SessionRepository(env.DB),
      tokens: new WebCryptoSessionTokenIssuer(),
    };
    const authenticatedRequest = new Request("https://counterpoint.test/call", {
      headers: { authorization: `Bearer ${seeded.rawBearerToken}` },
    });

    await expect(
      resolveJudgeManagedAuthorization({
        dependencies,
        meetingId: seeded.meetingId,
        request: authenticatedRequest,
      }),
    ).resolves.toMatchObject({
      authorization: {
        meetingId: seeded.meetingId,
        participantId: seeded.participantId,
        sessionId: seeded.sessionId,
        userId: seeded.userId,
      },
      kind: "authorized",
    });
    await expect(
      resolveOwnedJudgeManagedCall({
        dependencies,
        managedCallId,
        meetingId: seeded.meetingId,
        ownerships: repository,
        request: authenticatedRequest,
      }),
    ).resolves.toMatchObject({
      kind: "authorized",
      ownership: {
        managedCallId,
        reservationId: seeded.reservationId,
      },
    });
  });

  it("fails closed after session revocation, assignment removal, scope changes, or storage failure", async () => {
    const seeded = await fixture("reauthorize");
    const repository = new D1ManagedRealtimeCallOwnershipRepository(env.DB);
    const managedCallId = `managed-${crypto.randomUUID()}`;
    await repository.create(ownership(seeded, managedCallId));
    const clock = {
      now: () => new Date((NOW_EPOCH + 1) * 1_000).toISOString(),
    };
    const dependencies = {
      authorizationPolicy: {
        judgeManagedAiUserIds: new Set([seeded.userId]),
      },
      clock,
      meetings: new D1MeetingRepository(env.DB),
      sessions: new D1SessionRepository(env.DB),
      tokens: new WebCryptoSessionTokenIssuer(),
    };
    const authenticatedRequest = new Request("https://counterpoint.test/call", {
      headers: { authorization: `Bearer ${seeded.rawBearerToken}` },
    });

    await expect(
      resolveOwnedJudgeManagedCall({
        dependencies,
        managedCallId,
        meetingId: "other-meeting",
        ownerships: repository,
        request: authenticatedRequest,
      }),
    ).resolves.toMatchObject({ code: "FORBIDDEN", kind: "rejected" });
    await expect(
      resolveOwnedJudgeManagedCall({
        dependencies: {
          ...dependencies,
          authorizationPolicy: { judgeManagedAiUserIds: new Set() },
        },
        managedCallId,
        meetingId: seeded.meetingId,
        ownerships: repository,
        request: authenticatedRequest,
      }),
    ).resolves.toMatchObject({
      code: "JUDGE_MODE_FORBIDDEN",
      kind: "rejected",
    });
    await expect(
      resolveOwnedJudgeManagedCall({
        dependencies,
        managedCallId,
        meetingId: seeded.meetingId,
        ownerships: {
          findActiveOwned: () => Promise.reject(new Error("private D1 error")),
        },
        request: authenticatedRequest,
      }),
    ).resolves.toMatchObject({
      code: "REALTIME_UNAVAILABLE",
      kind: "rejected",
    });

    await env.DB.withSession("first-primary")
      .prepare(
        `
          UPDATE participant_assignments
          SET active = 0
          WHERE meeting_id = ? AND user_id = ?
        `,
      )
      .bind(seeded.meetingId, seeded.userId)
      .run();
    await expect(
      resolveOwnedJudgeManagedCall({
        dependencies,
        managedCallId,
        meetingId: seeded.meetingId,
        ownerships: repository,
        request: authenticatedRequest,
      }),
    ).resolves.toMatchObject({ code: "FORBIDDEN", kind: "rejected" });

    await env.DB.withSession("first-primary")
      .prepare(
        `
          UPDATE participant_assignments
          SET active = 1
          WHERE meeting_id = ? AND user_id = ?
        `,
      )
      .bind(seeded.meetingId, seeded.userId)
      .run();
    await new D1SessionRepository(env.DB).revoke(
      seeded.sessionId,
      new Date((NOW_EPOCH + 2) * 1_000).toISOString(),
    );
    await expect(
      resolveOwnedJudgeManagedCall({
        dependencies,
        managedCallId,
        meetingId: seeded.meetingId,
        ownerships: repository,
        request: authenticatedRequest,
      }),
    ).resolves.toMatchObject({ code: "SESSION_EXPIRED", kind: "rejected" });
  });
});
