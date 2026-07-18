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
  findAssignment(
    meetingId: string,
    userId: string,
  ): Promise<ParticipantAssignment | undefined>;

  findById(meetingId: string): Promise<MeetingRecord | undefined>;

  listAssigned(userId: string): Promise<readonly MeetingRecord[]>;
}
