/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import {
  D1IdentityRepository,
  D1MeetingRepository,
  D1SessionRepository,
} from "@counterpoint/adapters-cloudflare";
import type {
  MeetingRecord,
  ParticipantAssignment,
  SessionRecord,
} from "@counterpoint/ports";

import { sessionRepositoryContract } from "../contract/session-repository-contract.js";

async function seedUsers(
  users: readonly {
    readonly active?: boolean;
    readonly userId: string;
  }[],
): Promise<void> {
  const session = env.DB.withSession("first-primary");
  await session.batch(
    users.map((user) =>
      session
        .prepare(
          `
            INSERT INTO users (user_id, password_hash, active)
            VALUES (?, ?, ?)
            ON CONFLICT (user_id) DO UPDATE SET
              password_hash = excluded.password_hash,
              active = excluded.active
          `,
        )
        .bind(
          user.userId,
          `password-hash:${user.userId}`,
          user.active === false ? 0 : 1,
        ),
    ),
  );
}

function meetingFixture(
  meetingId: string,
  createdByUserId: string,
): {
  readonly assignments: readonly ParticipantAssignment[];
  readonly meeting: MeetingRecord;
} {
  const facilitatorParticipantId = `participant-${meetingId}-facilitator`;
  const otherUserIds =
    meetingId === "meeting-a" ? ["user-b", "user-c"] : ["user-b", "user-e"];
  return {
    assignments: [
      {
        active: true,
        meetingId,
        participantId: facilitatorParticipantId,
        role: "facilitator",
        userId: createdByUserId,
      },
      ...otherUserIds.map<ParticipantAssignment>((userId) => ({
        active: true,
        meetingId,
        participantId: `participant-${meetingId}-${userId}`,
        role: "participant",
        userId,
      })),
    ],
    meeting: {
      active: true,
      code: `code-${meetingId}`,
      createdByUserId,
      facilitatorParticipantId,
      meetingId,
      purpose: `Purpose for ${meetingId}`,
    },
  };
}

describe("Cloudflare D1 authentication repositories", () => {
  it("finds identities by exact user ID and preserves active state", async () => {
    await seedUsers([
      { userId: "user-a" },
      { active: false, userId: "user-b" },
    ]);
    const repository = new D1IdentityRepository(env.DB);

    await expect(repository.findByUserId("user-a")).resolves.toEqual({
      active: true,
      passwordHash: "password-hash:user-a",
      userId: "user-a",
    });
    await expect(repository.findByUserId("user-b")).resolves.toEqual({
      active: false,
      passwordHash: "password-hash:user-b",
      userId: "user-b",
    });
    await expect(repository.findByUserId("user")).resolves.toBeUndefined();
  });

  it("satisfies the shared session contract using token hashes only", async () => {
    await seedUsers([{ userId: "user-a" }]);

    await sessionRepositoryContract(() => new D1SessionRepository(env.DB));

    const rows = await env.DB.withSession("first-primary")
      .prepare("SELECT * FROM sessions WHERE session_id = ?")
      .bind("session-a")
      .all<Record<string, unknown>>();
    expect(rows.results).toEqual([
      expect.objectContaining({
        session_id: "session-a",
        token_hash: "token-hash-a",
      }),
    ]);
    expect(JSON.stringify(rows.results)).not.toContain("raw-bearer-token");
  });

  it("upserts sessions safely and preserves the first revocation time", async () => {
    await seedUsers([{ userId: "user-a" }]);
    const repository = new D1SessionRepository(env.DB);
    const original: SessionRecord = {
      absoluteExpiresAt: "2026-07-19T08:00:00.000Z",
      createdAt: "2026-07-19T00:00:00.000Z",
      lastActivityAt: "2026-07-19T00:00:00.000Z",
      sessionId: "session-upsert",
      tokenHash: "token-hash-upsert",
      userId: "user-a",
    };

    await repository.put(original);
    await repository.put({
      ...original,
      lastActivityAt: "2026-07-19T01:00:00.000Z",
    });
    await expect(
      repository.findById(original.sessionId),
    ).resolves.toMatchObject({
      lastActivityAt: "2026-07-19T01:00:00.000Z",
    });

    await repository.revoke(original.sessionId, "2026-07-19T02:00:00.000Z");
    await repository.revoke(original.sessionId, "2026-07-19T03:00:00.000Z");
    await repository.touch(original.sessionId, "2026-07-19T04:00:00.000Z");
    await expect(
      repository.findById(original.sessionId),
    ).resolves.toMatchObject({
      lastActivityAt: "2026-07-19T01:00:00.000Z",
      revokedAt: "2026-07-19T02:00:00.000Z",
    });
  });

  it("keeps meeting and user queries within their exact scopes", async () => {
    await seedUsers(
      ["user-a", "user-b", "user-c", "user-d", "user-e"].map((userId) => ({
        userId,
      })),
    );
    const repository = new D1MeetingRepository(env.DB);
    const first = meetingFixture("meeting-a", "user-a");
    const second = meetingFixture("meeting-b", "user-d");
    await repository.createWithAssignments(first.meeting, first.assignments);
    await repository.createWithAssignments(second.meeting, second.assignments);

    await expect(repository.findById("meeting-a")).resolves.toEqual(
      first.meeting,
    );
    await expect(repository.findByCode("code-meeting-b")).resolves.toEqual(
      second.meeting,
    );
    await expect(
      repository.findAssignment("meeting-a", "user-b"),
    ).resolves.toMatchObject({
      meetingId: "meeting-a",
      userId: "user-b",
    });
    await expect(
      repository.findAssignment("meeting-a", "user-d"),
    ).resolves.toBeUndefined();
    await expect(repository.listAssignments("meeting-a")).resolves.toEqual(
      [...first.assignments].sort((left, right) =>
        left.participantId.localeCompare(right.participantId),
      ),
    );
    await expect(repository.listAssigned("user-b")).resolves.toEqual([
      first.meeting,
      second.meeting,
    ]);

    await env.DB.withSession("first-primary")
      .prepare(
        `
          UPDATE participant_assignments
          SET active = 0
          WHERE meeting_id = ? AND user_id = ?
        `,
      )
      .bind("meeting-b", "user-b")
      .run();
    await expect(repository.listAssigned("user-b")).resolves.toEqual([
      first.meeting,
    ]);
  });

  it("atomically rolls back meeting creation when an assignment fails", async () => {
    await seedUsers([
      { userId: "user-a" },
      { userId: "user-b" },
      { userId: "user-c" },
    ]);
    const repository = new D1MeetingRepository(env.DB);
    const fixture = meetingFixture("meeting-atomic", "user-a");
    const assignments = fixture.assignments.map((assignment, index) =>
      index === fixture.assignments.length - 1
        ? { ...assignment, userId: "missing-user" }
        : assignment,
    );

    await expect(
      repository.createWithAssignments(fixture.meeting, assignments),
    ).rejects.toThrow();
    await expect(
      repository.findById(fixture.meeting.meetingId),
    ).resolves.toBeUndefined();
    await expect(
      repository.listAssignments(fixture.meeting.meetingId),
    ).resolves.toEqual([]);
  });
});
