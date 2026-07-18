import type {
  Clock,
  IdGenerator,
  IdentityRecord,
  IdentityRepository,
  MeetingRecord,
  MeetingRepository,
  ParticipantAssignment,
  PasswordVerifier,
  SessionRecord,
  SessionRepository,
  SessionToken,
  SessionTokenIssuer,
} from "../../packages/ports/src/index.js";

export class MutableClock implements Clock {
  #value: string;

  constructor(value: string) {
    this.#value = value;
  }

  advance(milliseconds: number): void {
    this.#value = new Date(
      Date.parse(this.#value) + milliseconds,
    ).toISOString();
  }

  now(): string {
    return this.#value;
  }
}

export class SequenceIdGenerator implements IdGenerator {
  readonly #counts = new Map<string, number>();

  next(namespace: string): string {
    const count = (this.#counts.get(namespace) ?? 0) + 1;
    this.#counts.set(namespace, count);
    return `${namespace}-${String(count)}`;
  }
}

export class PlaintextFixturePasswordVerifier implements PasswordVerifier {
  verify(password: string, encodedHash: string): Promise<boolean> {
    return Promise.resolve(encodedHash === `fixture:${password}`);
  }
}

export class DeterministicSessionTokenIssuer implements SessionTokenIssuer {
  #count = 0;

  digest(value: string): Promise<string> {
    return Promise.resolve(
      `digest:${[...value]
        .map((character) => character.codePointAt(0)?.toString(16) ?? "")
        .join("")}`,
    );
  }

  issue(): Promise<SessionToken> {
    this.#count += 1;
    const value = `session-token-${String(this.#count)}`;
    return this.digest(value).then((hash) => ({ hash, value }));
  }
}

export class InMemoryIdentityRepository implements IdentityRepository {
  readonly #identities = new Map<string, IdentityRecord>();

  constructor(identities: readonly IdentityRecord[]) {
    for (const identity of identities) {
      this.#identities.set(identity.userId, identity);
    }
  }

  findByUserId(userId: string): Promise<IdentityRecord | undefined> {
    return Promise.resolve(this.#identities.get(userId));
  }
}

export class InMemorySessionRepository implements SessionRepository {
  readonly #sessions = new Map<string, SessionRecord>();

  findByTokenHash(tokenHash: string): Promise<SessionRecord | undefined> {
    return Promise.resolve(
      [...this.#sessions.values()].find(
        (session) => session.tokenHash === tokenHash,
      ),
    );
  }

  put(session: SessionRecord): Promise<void> {
    this.#sessions.set(session.sessionId, session);
    return Promise.resolve();
  }

  revoke(sessionId: string, revokedAt: string): Promise<void> {
    const session = this.#sessions.get(sessionId);
    if (session !== undefined) {
      this.#sessions.set(sessionId, { ...session, revokedAt });
    }
    return Promise.resolve();
  }

  session(sessionId: string): SessionRecord | undefined {
    return this.#sessions.get(sessionId);
  }

  touch(sessionId: string, lastActivityAt: string): Promise<void> {
    const session = this.#sessions.get(sessionId);
    if (session !== undefined) {
      this.#sessions.set(sessionId, { ...session, lastActivityAt });
    }
    return Promise.resolve();
  }
}

export class InMemoryMeetingRepository implements MeetingRepository {
  readonly #assignments: ParticipantAssignment[] = [];
  readonly #meetings = new Map<string, MeetingRecord>();

  createWithAssignments(
    meeting: MeetingRecord,
    assignments: readonly ParticipantAssignment[],
  ): Promise<void> {
    if (this.#meetings.has(meeting.meetingId)) {
      return Promise.reject(new Error("Meeting already exists"));
    }
    this.#meetings.set(meeting.meetingId, meeting);
    this.#assignments.push(...assignments);
    return Promise.resolve();
  }

  findAssignment(
    meetingId: string,
    userId: string,
  ): Promise<ParticipantAssignment | undefined> {
    return Promise.resolve(
      this.#assignments.find(
        (assignment) =>
          assignment.meetingId === meetingId && assignment.userId === userId,
      ),
    );
  }

  findByCode(code: string): Promise<MeetingRecord | undefined> {
    return Promise.resolve(
      [...this.#meetings.values()].find((meeting) => meeting.code === code),
    );
  }

  findById(meetingId: string): Promise<MeetingRecord | undefined> {
    return Promise.resolve(this.#meetings.get(meetingId));
  }

  listAssignments(
    meetingId: string,
  ): Promise<readonly ParticipantAssignment[]> {
    return Promise.resolve(
      this.#assignments.filter(
        (assignment) => assignment.meetingId === meetingId,
      ),
    );
  }

  listAssigned(userId: string): Promise<readonly MeetingRecord[]> {
    const meetingIds = new Set(
      this.#assignments
        .filter(
          (assignment) => assignment.userId === userId && assignment.active,
        )
        .map(({ meetingId }) => meetingId),
    );
    return Promise.resolve(
      [...this.#meetings.values()].filter(
        (meeting) => meeting.active && meetingIds.has(meeting.meetingId),
      ),
    );
  }
}
