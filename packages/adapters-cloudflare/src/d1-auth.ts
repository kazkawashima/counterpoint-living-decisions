/// <reference types="@cloudflare/workers-types" />

import type {
  IdentityRecord,
  IdentityRepository,
  MeetingRecord,
  MeetingRepository,
  ParticipantAssignment,
  SessionRecord,
  SessionRepository,
} from "@counterpoint/ports";

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

function requireNonEmpty(value: string, label: string): void {
  if (value.length === 0) {
    throw new TypeError(`${label} must not be empty`);
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

export class D1IdentityRepository implements IdentityRepository {
  readonly #database: D1Database;

  constructor(database: D1Database) {
    this.#database = database;
  }

  async findByUserId(userId: string): Promise<IdentityRecord | undefined> {
    requireNonEmpty(userId, "userId");
    const row = await this.#database
      .withSession("first-primary")
      .prepare(
        `
          SELECT user_id, password_hash, active
          FROM users
          WHERE user_id = ?
        `,
      )
      .bind(userId)
      .first<IdentityRow>();
    return row === null ? undefined : identityFromRow(row);
  }
}

export class D1SessionRepository implements SessionRepository {
  readonly #database: D1Database;

  constructor(database: D1Database) {
    this.#database = database;
  }

  async findById(sessionId: string): Promise<SessionRecord | undefined> {
    requireNonEmpty(sessionId, "sessionId");
    const row = await this.#database
      .withSession("first-primary")
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
      .bind(sessionId)
      .first<SessionRow>();
    return row === null ? undefined : sessionFromRow(row);
  }

  async findByTokenHash(tokenHash: string): Promise<SessionRecord | undefined> {
    requireNonEmpty(tokenHash, "tokenHash");
    const row = await this.#database
      .withSession("first-primary")
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
      .bind(tokenHash)
      .first<SessionRow>();
    return row === null ? undefined : sessionFromRow(row);
  }

  async put(session: SessionRecord): Promise<void> {
    requireNonEmpty(session.sessionId, "sessionId");
    requireNonEmpty(session.tokenHash, "tokenHash");
    requireNonEmpty(session.userId, "session userId");
    requireNonEmpty(session.createdAt, "session createdAt");
    requireNonEmpty(session.lastActivityAt, "session lastActivityAt");
    requireNonEmpty(session.absoluteExpiresAt, "session absoluteExpiresAt");
    await this.#database
      .withSession("first-primary")
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
          ON CONFLICT (session_id) DO UPDATE SET
            token_hash = excluded.token_hash,
            user_id = excluded.user_id,
            created_at = excluded.created_at,
            last_activity_at = excluded.last_activity_at,
            absolute_expires_at = excluded.absolute_expires_at,
            revoked_at = excluded.revoked_at
        `,
      )
      .bind(
        session.sessionId,
        session.tokenHash,
        session.userId,
        session.createdAt,
        session.lastActivityAt,
        session.absoluteExpiresAt,
        session.revokedAt ?? null,
      )
      .run();
  }

  async revoke(sessionId: string, revokedAt: string): Promise<void> {
    requireNonEmpty(sessionId, "sessionId");
    requireNonEmpty(revokedAt, "revokedAt");
    await this.#database
      .withSession("first-primary")
      .prepare(
        `
          UPDATE sessions
          SET revoked_at = COALESCE(revoked_at, ?)
          WHERE session_id = ?
        `,
      )
      .bind(revokedAt, sessionId)
      .run();
  }

  async touch(sessionId: string, lastActivityAt: string): Promise<void> {
    requireNonEmpty(sessionId, "sessionId");
    requireNonEmpty(lastActivityAt, "lastActivityAt");
    await this.#database
      .withSession("first-primary")
      .prepare(
        `
          UPDATE sessions
          SET last_activity_at = ?
          WHERE session_id = ? AND revoked_at IS NULL
        `,
      )
      .bind(lastActivityAt, sessionId)
      .run();
  }
}

export class D1MeetingRepository implements MeetingRepository {
  readonly #database: D1Database;

  constructor(database: D1Database) {
    this.#database = database;
  }

  async createWithAssignments(
    meeting: MeetingRecord,
    assignments: readonly ParticipantAssignment[],
  ): Promise<void> {
    validateMeetingCreation(meeting, assignments);
    const session = this.#database.withSession("first-primary");
    const statements = [
      session
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
        .bind(
          meeting.meetingId,
          meeting.code,
          meeting.createdByUserId,
          meeting.facilitatorParticipantId,
          meeting.purpose,
          meeting.active ? 1 : 0,
        ),
      ...assignments.map((assignment) =>
        session
          .prepare(
            `
              INSERT INTO participant_assignments (
                meeting_id,
                participant_id,
                user_id,
                role,
                active
              ) VALUES (?, ?, ?, ?, ?)
            `,
          )
          .bind(
            assignment.meetingId,
            assignment.participantId,
            assignment.userId,
            assignment.role,
            assignment.active ? 1 : 0,
          ),
      ),
    ];
    await session.batch(statements);
  }

  async findAssignment(
    meetingId: string,
    userId: string,
  ): Promise<ParticipantAssignment | undefined> {
    requireNonEmpty(meetingId, "meetingId");
    requireNonEmpty(userId, "userId");
    const row = await this.#database
      .withSession("first-primary")
      .prepare(
        `
          SELECT meeting_id, participant_id, user_id, role, active
          FROM participant_assignments
          WHERE meeting_id = ? AND user_id = ?
        `,
      )
      .bind(meetingId, userId)
      .first<ParticipantAssignmentRow>();
    return row === null ? undefined : assignmentFromRow(row);
  }

  async findByCode(code: string): Promise<MeetingRecord | undefined> {
    requireNonEmpty(code, "meeting code");
    const row = await this.#database
      .withSession("first-primary")
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
      .bind(code)
      .first<MeetingRow>();
    return row === null ? undefined : meetingFromRow(row);
  }

  async findById(meetingId: string): Promise<MeetingRecord | undefined> {
    requireNonEmpty(meetingId, "meetingId");
    const row = await this.#database
      .withSession("first-primary")
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
      .bind(meetingId)
      .first<MeetingRow>();
    return row === null ? undefined : meetingFromRow(row);
  }

  async listAssignments(
    meetingId: string,
  ): Promise<readonly ParticipantAssignment[]> {
    requireNonEmpty(meetingId, "meetingId");
    const result = await this.#database
      .withSession("first-primary")
      .prepare(
        `
          SELECT meeting_id, participant_id, user_id, role, active
          FROM participant_assignments
          WHERE meeting_id = ?
          ORDER BY participant_id ASC
        `,
      )
      .bind(meetingId)
      .all<ParticipantAssignmentRow>();
    return result.results.map(assignmentFromRow);
  }

  async listAssigned(userId: string): Promise<readonly MeetingRecord[]> {
    requireNonEmpty(userId, "userId");
    const result = await this.#database
      .withSession("first-primary")
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
      .bind(userId)
      .all<MeetingRow>();
    return result.results.map(meetingFromRow);
  }
}
