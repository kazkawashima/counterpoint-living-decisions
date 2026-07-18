export interface ProjectionScope {
  readonly meetingId: string;
  readonly ownerParticipantId?: string;
  readonly projection: string;
}

export interface ProjectionStore<TProjection> {
  get(scope: ProjectionScope): Promise<TProjection | undefined>;
  put(scope: ProjectionScope, value: TProjection): Promise<void>;
}

export interface IdentityRecord {
  readonly active: boolean;
  readonly passwordHash: string;
  readonly userId: string;
}

export interface IdentityRepository {
  findByUserId(userId: string): Promise<IdentityRecord | undefined>;
}

export interface MeetingRecord {
  readonly active: boolean;
  readonly code: string;
  readonly createdByUserId: string;
  readonly facilitatorParticipantId: string;
  readonly meetingId: string;
  readonly purpose: string;
}

export interface ParticipantAssignment {
  readonly active: boolean;
  readonly meetingId: string;
  readonly participantId: string;
  readonly role: "facilitator" | "participant";
  readonly userId: string;
}

export interface MeetingRepository {
  createWithAssignments(
    meeting: MeetingRecord,
    assignments: readonly ParticipantAssignment[],
  ): Promise<void>;

  findAssignment(
    meetingId: string,
    userId: string,
  ): Promise<ParticipantAssignment | undefined>;

  findByCode(code: string): Promise<MeetingRecord | undefined>;

  findById(meetingId: string): Promise<MeetingRecord | undefined>;

  listAssignments(meetingId: string): Promise<readonly ParticipantAssignment[]>;

  listAssigned(userId: string): Promise<readonly MeetingRecord[]>;
}

export interface SessionRecord {
  readonly absoluteExpiresAt: string;
  readonly createdAt: string;
  readonly lastActivityAt: string;
  readonly revokedAt?: string;
  readonly sessionId: string;
  readonly tokenHash: string;
  readonly userId: string;
}

export interface SessionRepository {
  findByTokenHash(tokenHash: string): Promise<SessionRecord | undefined>;
  put(session: SessionRecord): Promise<void>;
  revoke(sessionId: string, revokedAt: string): Promise<void>;
  touch(sessionId: string, lastActivityAt: string): Promise<void>;
}
