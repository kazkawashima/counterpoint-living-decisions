import {
  CryptographicIdGenerator,
  CURRENT_SQLITE_MIGRATION_COUNT,
  NodeSqliteDatabase,
  ScryptPasswordHasher,
  seedSyntheticUsers,
  Sha256SessionTokenIssuer,
  sqliteMigrationCount,
  SqliteIdentityRepository,
  SqliteMeetingRepository,
  SqliteSessionRepository,
  SystemClock,
} from "@counterpoint/adapters-node";
import type {
  Clock,
  IdGenerator,
  IdentityRepository,
  MeetingRepository,
  PasswordVerifier,
  SessionRepository,
  SessionTokenIssuer,
} from "@counterpoint/ports";

import type { ServerConfiguration } from "./config.js";

export interface ServerRuntime {
  readonly clock: Clock;
  readonly facilitatorUserIds: ReadonlySet<string>;
  readonly ids: IdGenerator;
  readonly identities: IdentityRepository;
  readonly meetings: MeetingRepository;
  readonly migrationsCurrent: boolean;
  readonly openAiConfigured: boolean;
  readonly passwords: PasswordVerifier;
  readonly sessions: SessionRepository;
  readonly tokens: SessionTokenIssuer;
}

export interface LocalServerRuntime extends ServerRuntime {
  close(): void;
}

const FLAGSHIP_MEETING_ID = "meeting-global-ai-rollout";
const FLAGSHIP_MEETING_CODE = "GLOBAL-AI-2026";

async function seedFlagshipMeeting(
  meetings: MeetingRepository,
  configuration: ServerConfiguration,
): Promise<void> {
  if ((await meetings.findById(FLAGSHIP_MEETING_ID)) !== undefined) {
    return;
  }
  const facilitator = configuration.demoUsers.find(
    ({ role }) => role === "facilitator",
  );
  if (facilitator === undefined) {
    throw new Error("Flagship seed requires one facilitator");
  }

  const assignments = configuration.demoUsers.map(({ role, userId }) => ({
    active: true,
    meetingId: FLAGSHIP_MEETING_ID,
    participantId: `participant-${userId}`,
    role,
    userId,
  }));
  await meetings.createWithAssignments(
    {
      active: true,
      code: FLAGSHIP_MEETING_CODE,
      createdByUserId: facilitator.userId,
      facilitatorParticipantId: `participant-${facilitator.userId}`,
      meetingId: FLAGSHIP_MEETING_ID,
      purpose: "Global AI Product Rollout",
    },
    assignments,
  );
}

export async function createLocalServerRuntime(
  configuration: ServerConfiguration,
): Promise<LocalServerRuntime> {
  const database = new NodeSqliteDatabase(configuration.databasePath);
  try {
    seedSyntheticUsers(
      database,
      configuration.demoUsers.map(({ passwordHash, userId }) => ({
        passwordHash,
        userId,
      })),
    );
    const meetings = new SqliteMeetingRepository(database);
    await seedFlagshipMeeting(meetings, configuration);

    return {
      clock: new SystemClock(),
      close: () => database.close(),
      facilitatorUserIds: new Set(
        configuration.demoUsers
          .filter(({ role }) => role === "facilitator")
          .map(({ userId }) => userId),
      ),
      ids: new CryptographicIdGenerator(),
      identities: new SqliteIdentityRepository(database),
      meetings,
      migrationsCurrent:
        sqliteMigrationCount(database.database) ===
        CURRENT_SQLITE_MIGRATION_COUNT,
      openAiConfigured: configuration.openAiConfigured,
      passwords: new ScryptPasswordHasher(),
      sessions: new SqliteSessionRepository(database),
      tokens: new Sha256SessionTokenIssuer(),
    };
  } catch (error) {
    database.close();
    throw error;
  }
}
