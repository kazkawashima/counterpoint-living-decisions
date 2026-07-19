import type { DatabaseSync } from "node:sqlite";

import type {
  IdentityRecord,
  IdentityRepository,
  MeetingRecord,
  MeetingRepository,
  ParticipantAssignment,
  SessionRecord,
  SessionRepository,
} from "@counterpoint/ports";

import { isScryptPasswordHash } from "./identity.js";
import type { NodeSqliteDatabase } from "./sqlite.js";

const MINIMUM_ASSIGNMENTS = 3;
const MAXIMUM_ASSIGNMENTS = 8;

interface IdentityRow {
  readonly active: number;
  readonly password_hash: string;
  readonly user_id: string;
}

interface MeetingRow {
  readonly active: number;
  readonly code: string;
  readonly created_by_user_id: string;
  readonly facilitator_participant_id: string;
  readonly meeting_id: string;
  readonly purpose: string;
}

interface ParticipantAssignmentRow {
  readonly active: number;
  readonly meeting_id: string;
  readonly participant_id: string;
  readonly role: "facilitator" | "participant";
  readonly user_id: string;
}

interface SessionRow {
  readonly absolute_expires_at: string;
  readonly created_at: string;
  readonly last_activity_at: string;
  readonly revoked_at: string | null;
  readonly session_id: string;
  readonly token_hash: string;
  readonly user_id: string;
}

export interface SyntheticUserSeed {
  readonly active?: boolean;
  readonly passwordHash: string;
  readonly userId: string;
}

function requireNonEmpty(value: string, label: string): void {
  if (value.length === 0) {
    throw new TypeError(`${label} must not be empty`);
  }
}

function runTransaction<T>(database: DatabaseSync, work: () => T): T {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    if (database.isTransaction) {
      database.exec("ROLLBACK");
    }
    throw error;
  }
}

function identityFromRow(row: IdentityRow): IdentityRecord {
  return {
    active: row.active === 1,
    passwordHash: row.password_hash,
    userId: row.user_id,
  };
}

function meetingFromRow(row: MeetingRow): MeetingRecord {
  return {
    active: row.active === 1,
    code: row.code,
    createdByUserId: row.created_by_user_id,
    facilitatorParticipantId: row.facilitator_participant_id,
    meetingId: row.meeting_id,
    purpose: row.purpose,
  };
}

function assignmentFromRow(
  row: ParticipantAssignmentRow,
): ParticipantAssignment {
  return {
    active: row.active === 1,
    meetingId: row.meeting_id,
    participantId: row.participant_id,
    role: row.role,
    userId: row.user_id,
  };
}

function sessionFromRow(row: SessionRow): SessionRecord {
  return {
    absoluteExpiresAt: row.absolute_expires_at,
    createdAt: row.created_at,
    lastActivityAt: row.last_activity_at,
    ...(row.revoked_at === null ? {} : { revokedAt: row.revoked_at }),
    sessionId: row.session_id,
    tokenHash: row.token_hash,
    userId: row.user_id,
  };
}

function validateMeetingCreation(
  meeting: MeetingRecord,
  assignments: readonly ParticipantAssignment[],
): void {
  requireNonEmpty(meeting.meetingId, "meetingId");
  requireNonEmpty(meeting.code, "meeting code");
  requireNonEmpty(meeting.createdByUserId, "createdByUserId");
  requireNonEmpty(meeting.facilitatorParticipantId, "facilitatorParticipantId");
  requireNonEmpty(meeting.purpose, "meeting purpose");
  if (
    assignments.length < MINIMUM_ASSIGNMENTS ||
    assignments.length > MAXIMUM_ASSIGNMENTS
  ) {
    throw new TypeError("Meeting requires 3–8 participant assignments");
  }

  const participantIds = new Set<string>();
  const userIds = new Set<string>();
  for (const assignment of assignments) {
    requireNonEmpty(assignment.participantId, "participantId");
    requireNonEmpty(assignment.userId, "assignment userId");
    if (assignment.meetingId !== meeting.meetingId) {
      throw new TypeError("Every assignment must match its meeting");
    }
    if (!assignment.active) {
      throw new TypeError("New meeting assignments must be active");
    }
    if (
      participantIds.has(assignment.participantId) ||
      userIds.has(assignment.userId)
    ) {
      throw new TypeError(
        "Meeting assignments require unique participants and users",
      );
    }
    participantIds.add(assignment.participantId);
    userIds.add(assignment.userId);
  }

  const facilitators = assignments.filter(({ role }) => role === "facilitator");
  const facilitator = facilitators[0];
  if (
    facilitators.length !== 1 ||
    facilitator?.participantId !== meeting.facilitatorParticipantId ||
    facilitator.userId !== meeting.createdByUserId
  ) {
    throw new TypeError(
      "Meeting requires its creator as the single facilitator assignment",
    );
  }
}

export function seedSyntheticUsers(
  owner: NodeSqliteDatabase,
  users: readonly SyntheticUserSeed[],
): void {
  if (users.length === 0) {
    throw new TypeError("At least one synthetic user is required");
  }
  const userIds = new Set<string>();
  for (const user of users) {
    requireNonEmpty(user.userId, "synthetic userId");
    if (!isScryptPasswordHash(user.passwordHash)) {
      throw new TypeError(
        "Synthetic users require an encoded scrypt password hash",
      );
    }
    if (userIds.has(user.userId)) {
      throw new TypeError("Synthetic user IDs must be unique");
    }
    userIds.add(user.userId);
  }

  runTransaction(owner.database, () => {
    const statement = owner.database.prepare(
      `
        INSERT INTO users (user_id, password_hash, active)
        VALUES (?, ?, ?)
        ON CONFLICT (user_id) DO UPDATE SET
          password_hash = excluded.password_hash,
          active = excluded.active
      `,
    );
    for (const user of users) {
      statement.run(
        user.userId,
        user.passwordHash,
        user.active === false ? 0 : 1,
      );
    }
  });
}

export class SqliteIdentityRepository implements IdentityRepository {
  readonly #owner: NodeSqliteDatabase;

  constructor(owner: NodeSqliteDatabase) {
    this.#owner = owner;
  }

  async findByUserId(userId: string): Promise<IdentityRecord | undefined> {
    await Promise.resolve();
    requireNonEmpty(userId, "userId");
    const row = this.#owner.database
      .prepare(
        `
          SELECT user_id, password_hash, active
          FROM users
          WHERE user_id = ?
        `,
      )
      .get(userId) as unknown as IdentityRow | undefined;
    return row === undefined ? undefined : identityFromRow(row);
  }
}

export class SqliteSessionRepository implements SessionRepository {
  readonly #owner: NodeSqliteDatabase;

  constructor(owner: NodeSqliteDatabase) {
    this.#owner = owner;
  }

  async findById(sessionId: string): Promise<SessionRecord | undefined> {
    await Promise.resolve();
    requireNonEmpty(sessionId, "sessionId");
    const row = this.#owner.database
      .prepare(
        `
          SELECT
            session_id,
            token_hash,
            user_id,
            created_at,
            last_activity_at,
            absolute_expires_at,
            revoked_at
          FROM sessions
          WHERE session_id = ?
        `,
      )
      .get(sessionId) as unknown as SessionRow | undefined;
    return row === undefined ? undefined : sessionFromRow(row);
  }

  async findByTokenHash(tokenHash: string): Promise<SessionRecord | undefined> {
    await Promise.resolve();
    requireNonEmpty(tokenHash, "tokenHash");
    const row = this.#owner.database
      .prepare(
        `
          SELECT
            session_id,
            token_hash,
            user_id,
            created_at,
            last_activity_at,
            absolute_expires_at,
            revoked_at
          FROM sessions
          WHERE token_hash = ?
        `,
      )
      .get(tokenHash) as unknown as SessionRow | undefined;
    return row === undefined ? undefined : sessionFromRow(row);
  }

  async put(session: SessionRecord): Promise<void> {
    await Promise.resolve();
    requireNonEmpty(session.sessionId, "sessionId");
    requireNonEmpty(session.tokenHash, "tokenHash");
    requireNonEmpty(session.userId, "session userId");
    requireNonEmpty(session.createdAt, "session createdAt");
    requireNonEmpty(session.lastActivityAt, "session lastActivityAt");
    requireNonEmpty(session.absoluteExpiresAt, "session absoluteExpiresAt");
    this.#owner.database
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
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        session.sessionId,
        session.tokenHash,
        session.userId,
        session.createdAt,
        session.lastActivityAt,
        session.absoluteExpiresAt,
        session.revokedAt ?? null,
      );
  }

  async revoke(sessionId: string, revokedAt: string): Promise<void> {
    await Promise.resolve();
    requireNonEmpty(sessionId, "sessionId");
    requireNonEmpty(revokedAt, "revokedAt");
    this.#owner.database
      .prepare(
        `
          UPDATE sessions
          SET revoked_at = COALESCE(revoked_at, ?)
          WHERE session_id = ?
        `,
      )
      .run(revokedAt, sessionId);
  }

  async touch(sessionId: string, lastActivityAt: string): Promise<void> {
    await Promise.resolve();
    requireNonEmpty(sessionId, "sessionId");
    requireNonEmpty(lastActivityAt, "lastActivityAt");
    this.#owner.database
      .prepare(
        `
          UPDATE sessions
          SET last_activity_at = ?
          WHERE session_id = ? AND revoked_at IS NULL
        `,
      )
      .run(lastActivityAt, sessionId);
  }
}

export class SqliteMeetingRepository implements MeetingRepository {
  readonly #owner: NodeSqliteDatabase;

  constructor(owner: NodeSqliteDatabase) {
    this.#owner = owner;
  }

  async createWithAssignments(
    meeting: MeetingRecord,
    assignments: readonly ParticipantAssignment[],
  ): Promise<void> {
    await Promise.resolve();
    validateMeetingCreation(meeting, assignments);
    const database = this.#owner.database;
    runTransaction(database, () => {
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
            ) VALUES (?, ?, ?, ?, ?, ?)
          `,
        )
        .run(
          meeting.meetingId,
          meeting.code,
          meeting.createdByUserId,
          meeting.facilitatorParticipantId,
          meeting.purpose,
          meeting.active ? 1 : 0,
        );
      const insertAssignment = database.prepare(
        `
          INSERT INTO participant_assignments (
            meeting_id,
            participant_id,
            user_id,
            role,
            active
          ) VALUES (?, ?, ?, ?, ?)
        `,
      );
      for (const assignment of assignments) {
        insertAssignment.run(
          assignment.meetingId,
          assignment.participantId,
          assignment.userId,
          assignment.role,
          assignment.active ? 1 : 0,
        );
      }
    });
  }

  async findAssignment(
    meetingId: string,
    userId: string,
  ): Promise<ParticipantAssignment | undefined> {
    await Promise.resolve();
    requireNonEmpty(meetingId, "meetingId");
    requireNonEmpty(userId, "userId");
    const row = this.#owner.database
      .prepare(
        `
          SELECT meeting_id, participant_id, user_id, role, active
          FROM participant_assignments
          WHERE meeting_id = ? AND user_id = ?
        `,
      )
      .get(meetingId, userId) as unknown as
      ParticipantAssignmentRow | undefined;
    return row === undefined ? undefined : assignmentFromRow(row);
  }

  async findByCode(code: string): Promise<MeetingRecord | undefined> {
    await Promise.resolve();
    requireNonEmpty(code, "meeting code");
    const row = this.#owner.database
      .prepare(
        `
          SELECT
            meeting_id,
            code,
            created_by_user_id,
            facilitator_participant_id,
            purpose,
            active
          FROM meetings
          WHERE code = ?
        `,
      )
      .get(code) as unknown as MeetingRow | undefined;
    return row === undefined ? undefined : meetingFromRow(row);
  }

  async findById(meetingId: string): Promise<MeetingRecord | undefined> {
    await Promise.resolve();
    requireNonEmpty(meetingId, "meetingId");
    const row = this.#owner.database
      .prepare(
        `
          SELECT
            meeting_id,
            code,
            created_by_user_id,
            facilitator_participant_id,
            purpose,
            active
          FROM meetings
          WHERE meeting_id = ?
        `,
      )
      .get(meetingId) as unknown as MeetingRow | undefined;
    return row === undefined ? undefined : meetingFromRow(row);
  }

  async listAssignments(
    meetingId: string,
  ): Promise<readonly ParticipantAssignment[]> {
    await Promise.resolve();
    requireNonEmpty(meetingId, "meetingId");
    const rows = this.#owner.database
      .prepare(
        `
          SELECT meeting_id, participant_id, user_id, role, active
          FROM participant_assignments
          WHERE meeting_id = ?
          ORDER BY participant_id ASC
        `,
      )
      .all(meetingId) as unknown as ParticipantAssignmentRow[];
    return rows.map(assignmentFromRow);
  }

  async listAssigned(userId: string): Promise<readonly MeetingRecord[]> {
    await Promise.resolve();
    requireNonEmpty(userId, "userId");
    const rows = this.#owner.database
      .prepare(
        `
          SELECT
            meetings.meeting_id,
            meetings.code,
            meetings.created_by_user_id,
            meetings.facilitator_participant_id,
            meetings.purpose,
            meetings.active
          FROM meetings
          INNER JOIN participant_assignments
            ON participant_assignments.meeting_id = meetings.meeting_id
          WHERE participant_assignments.user_id = ?
            AND participant_assignments.active = 1
            AND meetings.active = 1
          ORDER BY meetings.created_at ASC, meetings.meeting_id ASC
        `,
      )
      .all(userId) as unknown as MeetingRow[];
    return rows.map(meetingFromRow);
  }
}
