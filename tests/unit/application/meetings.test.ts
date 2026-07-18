import { describe, expect, it } from "vitest";

import {
  createMeeting,
  joinMeetingByCode,
  listAssignedMeetings,
  resolveMeetingAuthorization,
  userAuthorizationContext,
} from "../../../packages/application/src/index.js";
import {
  InMemoryMeetingRepository,
  SequenceIdGenerator,
} from "../../helpers/application-adapters.js";

const facilitator = userAuthorizationContext({
  meetingId: "meeting-bootstrap",
  participantId: "participant-facilitator",
  role: "facilitator",
  sessionId: "session-facilitator",
  userId: "user-facilitator",
});

const participants = [
  { role: "facilitator" as const, userId: "user-facilitator" },
  { role: "participant" as const, userId: "user-legal" },
  { role: "participant" as const, userId: "user-operations" },
];

describe("meeting participation", () => {
  it("creates a 3–8 user meeting atomically with one facilitator", async () => {
    const meetings = new InMemoryMeetingRepository();
    const result = await createMeeting(
      { ids: new SequenceIdGenerator(), meetings },
      facilitator,
      {
        purpose: "  Decide a safe rollout  ",
        users: participants,
      },
    );

    expect(result.kind).toBe("created");
    if (result.kind === "created") {
      expect(result.meeting).toMatchObject({
        createdByUserId: "user-facilitator",
        purpose: "Decide a safe rollout",
      });
      expect(result.assignments).toHaveLength(3);
      await expect(
        listAssignedMeetings(meetings, "user-legal"),
      ).resolves.toEqual([result.meeting]);
    }
  });

  it("rejects non-facilitators and malformed assignment sets", async () => {
    const dependencies = {
      ids: new SequenceIdGenerator(),
      meetings: new InMemoryMeetingRepository(),
    };
    const participant = userAuthorizationContext({
      meetingId: "meeting-bootstrap",
      participantId: "participant-legal",
      role: "participant",
      sessionId: "session-legal",
      userId: "user-legal",
    });

    await expect(
      createMeeting(dependencies, participant, {
        purpose: "Forbidden",
        users: participants,
      }),
    ).resolves.toEqual({ code: "FORBIDDEN", kind: "rejected" });
    await expect(
      createMeeting(dependencies, facilitator, {
        purpose: "Too few",
        users: participants.slice(0, 2),
      }),
    ).resolves.toMatchObject({
      code: "VALIDATION_FAILED",
      kind: "rejected",
    });
    await expect(
      createMeeting(dependencies, facilitator, {
        purpose: "Duplicate",
        users: [...participants, participants[1]!],
      }),
    ).resolves.toMatchObject({
      code: "VALIDATION_FAILED",
      kind: "rejected",
    });
  });

  it("joins only active assigned users through the fallback meeting code", async () => {
    const meetings = new InMemoryMeetingRepository();
    const created = await createMeeting(
      { ids: new SequenceIdGenerator(), meetings },
      facilitator,
      { purpose: "Join test", users: participants },
    );
    if (created.kind !== "created") {
      throw new Error("Fixture meeting creation failed");
    }

    const joined = await joinMeetingByCode(meetings, {
      code: created.meeting.code,
      sessionId: "session-legal",
      userId: "user-legal",
    });
    expect(joined).toMatchObject({
      kind: "joined",
      authorization: {
        meetingId: created.meeting.meetingId,
        role: "participant",
        userId: "user-legal",
      },
    });
    await expect(
      joinMeetingByCode(meetings, {
        code: created.meeting.code,
        sessionId: "session-outsider",
        userId: "user-outsider",
      }),
    ).resolves.toEqual({ code: "FORBIDDEN", kind: "rejected" });
    await expect(
      joinMeetingByCode(meetings, {
        code: "unknown-code",
        sessionId: "session-legal",
        userId: "user-legal",
      }),
    ).resolves.toEqual({
      code: "MEETING_NOT_FOUND",
      kind: "rejected",
    });

    await expect(
      resolveMeetingAuthorization(
        meetings,
        {
          sessionId: "session-outsider",
          userId: "user-outsider",
        },
        created.meeting.meetingId,
      ),
    ).resolves.toEqual({ code: "FORBIDDEN", kind: "rejected" });
  });
});
