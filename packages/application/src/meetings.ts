import type {
  IdGenerator,
  MeetingRecord,
  MeetingRepository,
  ParticipantAssignment,
  SessionRecord,
} from "@counterpoint/ports";

import type { UserAuthorizationContext } from "./authorization.js";
import { userAuthorizationContext } from "./sessions.js";

const MINIMUM_PARTICIPANTS = 3;
const MAXIMUM_PARTICIPANTS = 8;

export type MeetingOperationFailure =
  | {
      readonly code: "FORBIDDEN";
      readonly kind: "rejected";
    }
  | {
      readonly code: "MEETING_NOT_FOUND";
      readonly kind: "rejected";
    }
  | {
      readonly code: "VALIDATION_FAILED";
      readonly kind: "rejected";
      readonly reason: string;
    };

export type CreateMeetingResult =
  | {
      readonly assignments: readonly ParticipantAssignment[];
      readonly kind: "created";
      readonly meeting: MeetingRecord;
    }
  | MeetingOperationFailure;

export async function createMeeting(
  dependencies: {
    readonly ids: IdGenerator;
    readonly meetings: MeetingRepository;
  },
  context: UserAuthorizationContext,
  input: {
    readonly purpose: string;
    readonly users: readonly {
      readonly role: "facilitator" | "participant";
      readonly userId: string;
    }[];
  },
): Promise<CreateMeetingResult> {
  if (context.role !== "facilitator") {
    return { code: "FORBIDDEN", kind: "rejected" };
  }

  const purpose = input.purpose.trim();
  const uniqueUsers = new Set(input.users.map(({ userId }) => userId));
  const facilitatorUsers = input.users.filter(
    ({ role }) => role === "facilitator",
  );
  if (
    purpose.length === 0 ||
    input.users.length < MINIMUM_PARTICIPANTS ||
    input.users.length > MAXIMUM_PARTICIPANTS ||
    uniqueUsers.size !== input.users.length ||
    facilitatorUsers.length !== 1 ||
    facilitatorUsers[0]?.userId !== context.userId
  ) {
    return {
      code: "VALIDATION_FAILED",
      kind: "rejected",
      reason:
        "Meeting requires a purpose, 3–8 unique users, and the current facilitator as its only facilitator.",
    };
  }

  const meetingId = dependencies.ids.next("meeting");
  const assignments = input.users.map<ParticipantAssignment>(
    ({ role, userId }) => ({
      active: true,
      meetingId,
      participantId: dependencies.ids.next("participant"),
      role,
      userId,
    }),
  );
  const facilitator = assignments.find(({ role }) => role === "facilitator");
  if (facilitator === undefined) {
    throw new Error("Validated meeting lost its facilitator assignment");
  }
  const meeting: MeetingRecord = {
    active: true,
    code: dependencies.ids.next("meeting-code"),
    createdByUserId: context.userId,
    facilitatorParticipantId: facilitator.participantId,
    meetingId,
    purpose,
  };

  await dependencies.meetings.createWithAssignments(meeting, assignments);
  return { assignments, kind: "created", meeting };
}

export async function listAssignedMeetings(
  meetings: MeetingRepository,
  userId: string,
): Promise<readonly MeetingRecord[]> {
  return meetings.listAssigned(userId);
}

export async function resolveMeetingAuthorization(
  meetings: MeetingRepository,
  session: Pick<SessionRecord, "sessionId" | "userId">,
  meetingId: string,
): Promise<
  | {
      readonly authorization: UserAuthorizationContext;
      readonly kind: "authorized";
    }
  | MeetingOperationFailure
> {
  const meeting = await meetings.findById(meetingId);
  const assignment = await meetings.findAssignment(meetingId, session.userId);
  if (!meeting?.active || !assignment?.active) {
    return { code: "FORBIDDEN", kind: "rejected" };
  }

  return {
    authorization: userAuthorizationContext({
      meetingId,
      participantId: assignment.participantId,
      role: assignment.role,
      sessionId: session.sessionId,
      userId: session.userId,
    }),
    kind: "authorized",
  };
}

export async function joinMeetingByCode(
  meetings: MeetingRepository,
  input: {
    readonly code: string;
    readonly sessionId: string;
    readonly userId: string;
  },
): Promise<
  | {
      readonly authorization: UserAuthorizationContext;
      readonly kind: "joined";
      readonly meeting: MeetingRecord;
    }
  | MeetingOperationFailure
> {
  const meeting = await meetings.findByCode(input.code.trim());
  if (!meeting?.active) {
    return { code: "MEETING_NOT_FOUND", kind: "rejected" };
  }
  const resolved = await resolveMeetingAuthorization(
    meetings,
    {
      sessionId: input.sessionId,
      userId: input.userId,
    },
    meeting.meetingId,
  );
  if (resolved.kind !== "authorized") {
    return resolved;
  }

  return {
    authorization: resolved.authorization,
    kind: "joined",
    meeting,
  };
}
