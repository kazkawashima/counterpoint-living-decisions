import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  CryptographicIdGenerator,
  NodeSqliteDatabase,
  ScryptPasswordHasher,
  seedSyntheticUsers,
  Sha256SessionTokenIssuer,
  SqliteIdentityRepository,
  SqliteMeetingRepository,
  SqliteSessionRepository,
  type SyntheticUserSeed,
} from "@counterpoint/adapters-node";
import {
  SESSION_INACTIVITY_MS,
  authenticateSession,
  createMeeting,
  joinMeetingByCode,
  listAssignedMeetings,
  login,
  logout,
  userAuthorizationContext,
} from "@counterpoint/application";
import type {
  Clock,
  MeetingRecord,
  ParticipantAssignment,
} from "@counterpoint/ports";
import { afterEach, describe, expect, it } from "vitest";

const FACILITATOR_PASSWORD = "synthetic-facilitator-password";
const PARTICIPANT_ONE_PASSWORD = "synthetic-participant-one-password";
const PARTICIPANT_TWO_PASSWORD = "synthetic-participant-two-password";
const OUTSIDER_PASSWORD = "synthetic-outsider-password";

const temporaryDirectories: string[] = [];
const databases: NodeSqliteDatabase[] = [];

class TestClock implements Clock {
  #milliseconds: number;

  constructor(value: string) {
    this.#milliseconds = Date.parse(value);
  }

  advance(milliseconds: number): void {
    this.#milliseconds += milliseconds;
  }

  now(): string {
    return new Date(this.#milliseconds).toISOString();
  }
}

async function temporaryDatabasePath(): Promise<string> {
  const directory = await mkdtemp(
    join(tmpdir(), "counterpoint-node-auth-meetings-"),
  );
  temporaryDirectories.push(directory);
  return join(directory, "counterpoint.sqlite");
}

function track(owner: NodeSqliteDatabase): NodeSqliteDatabase {
  databases.push(owner);
  return owner;
}

async function syntheticUsers(
  passwords: ScryptPasswordHasher,
): Promise<readonly SyntheticUserSeed[]> {
  return Promise.all([
    passwords.hash(FACILITATOR_PASSWORD).then((passwordHash) => ({
      passwordHash,
      userId: "user-facilitator",
    })),
    passwords.hash(PARTICIPANT_ONE_PASSWORD).then((passwordHash) => ({
      passwordHash,
      userId: "user-participant-one",
    })),
    passwords.hash(PARTICIPANT_TWO_PASSWORD).then((passwordHash) => ({
      passwordHash,
      userId: "user-participant-two",
    })),
    passwords.hash(OUTSIDER_PASSWORD).then((passwordHash) => ({
      passwordHash,
      userId: "user-outsider",
    })),
  ]);
}

function dependencies(
  owner: NodeSqliteDatabase,
  passwords: ScryptPasswordHasher,
  clock: Clock,
) {
  return {
    clock,
    identities: new SqliteIdentityRepository(owner),
    ids: new CryptographicIdGenerator(),
    passwords,
    sessions: new SqliteSessionRepository(owner),
    tokens: new Sha256SessionTokenIssuer(),
  };
}

function assignmentsFor(
  meetingId: string,
  facilitatorParticipantId: string,
  users: readonly [string, string],
): readonly ParticipantAssignment[] {
  return [
    {
      active: true,
      meetingId,
      participantId: facilitatorParticipantId,
      role: "facilitator",
      userId: "user-facilitator",
    },
    {
      active: true,
      meetingId,
      participantId: `${meetingId}-participant-one`,
      role: "participant",
      userId: users[0],
    },
    {
      active: true,
      meetingId,
      participantId: `${meetingId}-participant-two`,
      role: "participant",
      userId: users[1],
    },
  ];
}

afterEach(async () => {
  for (const owner of databases.splice(0)) {
    owner.close();
  }
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { force: true, recursive: true });
  }
});

describe("L2 Node authentication and meeting adapters", () => {
  it("persists login, meeting assignment, and code join across restart without storing raw Bearer values", async () => {
    const path = await temporaryDatabasePath();
    const passwords = new ScryptPasswordHasher();
    const users = await syntheticUsers(passwords);
    const clock = new TestClock("2026-07-19T00:00:00.000Z");
    const firstOwner = track(new NodeSqliteDatabase(path));

    seedSyntheticUsers(firstOwner, users);
    seedSyntheticUsers(firstOwner, users);
    expect(() =>
      seedSyntheticUsers(firstOwner, [
        {
          passwordHash: FACILITATOR_PASSWORD,
          userId: "user-plaintext-rejected",
        },
      ]),
    ).toThrow("encoded scrypt password hash");
    const encodedUsers = JSON.stringify(
      firstOwner.database
        .prepare("SELECT user_id, password_hash FROM users ORDER BY user_id")
        .all(),
    );
    expect(encodedUsers).not.toContain(FACILITATOR_PASSWORD);
    expect(encodedUsers).not.toContain(PARTICIPANT_ONE_PASSWORD);
    expect(users[0]?.passwordHash).toMatch(
      /^scrypt\$v1\$16384\$8\$1\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/,
    );
    await expect(
      passwords.verify(FACILITATOR_PASSWORD, users[0]?.passwordHash ?? ""),
    ).resolves.toBe(true);
    await expect(
      passwords.verify("wrong-password", users[0]?.passwordHash ?? ""),
    ).resolves.toBe(false);
    await expect(
      passwords.verify(FACILITATOR_PASSWORD, "not-an-encoded-hash"),
    ).resolves.toBe(false);

    const firstDependencies = dependencies(firstOwner, passwords, clock);
    const facilitatorLogin = await login(firstDependencies, {
      password: FACILITATOR_PASSWORD,
      userId: "user-facilitator",
    });
    const participantLogin = await login(firstDependencies, {
      password: PARTICIPANT_ONE_PASSWORD,
      userId: "user-participant-one",
    });
    const outsiderLogin = await login(firstDependencies, {
      password: OUTSIDER_PASSWORD,
      userId: "user-outsider",
    });
    if (
      facilitatorLogin.kind !== "authenticated" ||
      participantLogin.kind !== "authenticated" ||
      outsiderLogin.kind !== "authenticated"
    ) {
      throw new Error("Synthetic fixture login failed");
    }

    const persistedSessions = JSON.stringify(
      firstOwner.database.prepare("SELECT * FROM sessions").all(),
    );
    expect(persistedSessions).not.toContain(facilitatorLogin.bearerToken);
    expect(persistedSessions).not.toContain(participantLogin.bearerToken);
    expect(
      firstOwner.database
        .prepare("SELECT token_hash FROM sessions WHERE user_id = ?")
        .get("user-facilitator"),
    ).toMatchObject({
      token_hash: await firstDependencies.tokens.digest(
        facilitatorLogin.bearerToken,
      ),
    });

    const facilitatorSession = await authenticateSession(
      firstDependencies,
      facilitatorLogin.bearerToken,
    );
    if (facilitatorSession.kind !== "authenticated") {
      throw new Error("Persisted facilitator session was not authenticated");
    }
    const meetings = new SqliteMeetingRepository(firstOwner);
    const created = await createMeeting(
      {
        ids: firstDependencies.ids,
        meetings,
      },
      userAuthorizationContext({
        meetingId: "meeting-bootstrap",
        participantId: "participant-bootstrap",
        role: "facilitator",
        sessionId: facilitatorSession.session.sessionId,
        userId: facilitatorSession.session.userId,
      }),
      {
        purpose: "Synthetic flagship decision",
        users: [
          { role: "facilitator", userId: "user-facilitator" },
          { role: "participant", userId: "user-participant-one" },
          { role: "participant", userId: "user-participant-two" },
        ],
      },
    );
    if (created.kind !== "created") {
      throw new Error("Synthetic fixture meeting was not created");
    }
    await expect(
      listAssignedMeetings(meetings, "user-participant-one"),
    ).resolves.toEqual([created.meeting]);
    await expect(
      listAssignedMeetings(meetings, "user-outsider"),
    ).resolves.toEqual([]);

    firstOwner.close();
    const restartedOwner = track(new NodeSqliteDatabase(path));
    const restartedDependencies = dependencies(
      restartedOwner,
      passwords,
      clock,
    );
    await expect(
      authenticateSession(restartedDependencies, facilitatorLogin.bearerToken),
    ).resolves.toMatchObject({ kind: "authenticated" });
    const restartedParticipantSession = await authenticateSession(
      restartedDependencies,
      participantLogin.bearerToken,
    );
    if (restartedParticipantSession.kind !== "authenticated") {
      throw new Error("Restarted participant session was not authenticated");
    }

    const restartedMeetings = new SqliteMeetingRepository(restartedOwner);
    await expect(
      listAssignedMeetings(restartedMeetings, "user-participant-one"),
    ).resolves.toEqual([created.meeting]);
    await expect(
      listAssignedMeetings(restartedMeetings, "user-outsider"),
    ).resolves.toEqual([]);
    await expect(
      joinMeetingByCode(restartedMeetings, {
        code: created.meeting.code,
        sessionId: restartedParticipantSession.session.sessionId,
        userId: restartedParticipantSession.session.userId,
      }),
    ).resolves.toMatchObject({
      authorization: {
        meetingId: created.meeting.meetingId,
        role: "participant",
        userId: "user-participant-one",
      },
      kind: "joined",
    });
    await expect(
      joinMeetingByCode(restartedMeetings, {
        code: created.meeting.code,
        sessionId: "outsider-session",
        userId: "user-outsider",
      }),
    ).resolves.toEqual({ code: "FORBIDDEN", kind: "rejected" });

    await logout(restartedDependencies, participantLogin.bearerToken);
    await expect(
      authenticateSession(restartedDependencies, participantLogin.bearerToken),
    ).resolves.toEqual({
      code: "AUTHENTICATION_REQUIRED",
      kind: "rejected",
    });
  });

  it("uses the injected clock to expire and persist revocation after inactivity", async () => {
    const path = await temporaryDatabasePath();
    const owner = track(new NodeSqliteDatabase(path));
    const passwords = new ScryptPasswordHasher();
    const [facilitator] = await syntheticUsers(passwords);
    if (facilitator === undefined) {
      throw new Error("Synthetic facilitator fixture is missing");
    }
    seedSyntheticUsers(owner, [facilitator]);
    const clock = new TestClock("2026-07-19T00:00:00.000Z");
    const ports = dependencies(owner, passwords, clock);
    const result = await login(ports, {
      password: FACILITATOR_PASSWORD,
      userId: "user-facilitator",
    });
    if (result.kind !== "authenticated") {
      throw new Error("Synthetic fixture login failed");
    }

    clock.advance(SESSION_INACTIVITY_MS);
    await expect(
      authenticateSession(ports, result.bearerToken),
    ).resolves.toEqual({
      code: "SESSION_EXPIRED",
      kind: "rejected",
    });
    expect(
      owner.database
        .prepare("SELECT revoked_at FROM sessions WHERE user_id = ?")
        .get("user-facilitator"),
    ).toMatchObject({ revoked_at: clock.now() });
  });

  it("rolls back duplicate and cross-user meeting writes while keeping queries scoped", async () => {
    const path = await temporaryDatabasePath();
    const owner = track(new NodeSqliteDatabase(path));
    const passwords = new ScryptPasswordHasher();
    seedSyntheticUsers(owner, await syntheticUsers(passwords));
    const meetings = new SqliteMeetingRepository(owner);
    const original: MeetingRecord = {
      active: true,
      code: "FLAGSHIP-CODE",
      createdByUserId: "user-facilitator",
      facilitatorParticipantId: "participant-facilitator",
      meetingId: "meeting-flagship",
      purpose: "Synthetic flagship decision",
    };
    await meetings.createWithAssignments(
      original,
      assignmentsFor(original.meetingId, original.facilitatorParticipantId, [
        "user-participant-one",
        "user-participant-two",
      ]),
    );

    const duplicateUserMeeting: MeetingRecord = {
      ...original,
      code: "DUPLICATE-USER-CODE",
      facilitatorParticipantId: "duplicate-participant-facilitator",
      meetingId: "meeting-duplicate-user",
    };
    await expect(
      meetings.createWithAssignments(duplicateUserMeeting, [
        {
          active: true,
          meetingId: duplicateUserMeeting.meetingId,
          participantId: duplicateUserMeeting.facilitatorParticipantId,
          role: "facilitator",
          userId: "user-facilitator",
        },
        {
          active: true,
          meetingId: duplicateUserMeeting.meetingId,
          participantId: "duplicate-user-one",
          role: "participant",
          userId: "user-participant-one",
        },
        {
          active: true,
          meetingId: duplicateUserMeeting.meetingId,
          participantId: "duplicate-user-two",
          role: "participant",
          userId: "user-participant-one",
        },
      ]),
    ).rejects.toThrow("unique participants and users");
    await expect(
      meetings.findById(duplicateUserMeeting.meetingId),
    ).resolves.toBeUndefined();

    const duplicateCodeMeeting: MeetingRecord = {
      ...original,
      facilitatorParticipantId: "duplicate-code-facilitator",
      meetingId: "meeting-duplicate-code",
    };
    await expect(
      meetings.createWithAssignments(
        duplicateCodeMeeting,
        assignmentsFor(
          duplicateCodeMeeting.meetingId,
          duplicateCodeMeeting.facilitatorParticipantId,
          ["user-participant-one", "user-participant-two"],
        ),
      ),
    ).rejects.toThrow();
    await expect(
      meetings.findById(duplicateCodeMeeting.meetingId),
    ).resolves.toBeUndefined();

    const missingUserMeeting: MeetingRecord = {
      ...original,
      code: "MISSING-USER-CODE",
      facilitatorParticipantId: "missing-user-facilitator",
      meetingId: "meeting-missing-user",
    };
    await expect(
      meetings.createWithAssignments(
        missingUserMeeting,
        assignmentsFor(
          missingUserMeeting.meetingId,
          missingUserMeeting.facilitatorParticipantId,
          ["user-participant-one", "user-not-seeded"],
        ),
      ),
    ).rejects.toThrow();
    await expect(
      meetings.findById(missingUserMeeting.meetingId),
    ).resolves.toBeUndefined();
    await expect(
      meetings.findAssignment(original.meetingId, "user-outsider"),
    ).resolves.toBeUndefined();
    await expect(
      meetings.findAssignment("meeting-other", "user-participant-one"),
    ).resolves.toBeUndefined();
    await expect(meetings.listAssigned("user-outsider")).resolves.toEqual([]);
    await expect(
      meetings.findByCode("MISSING-USER-CODE"),
    ).resolves.toBeUndefined();
  });
});
