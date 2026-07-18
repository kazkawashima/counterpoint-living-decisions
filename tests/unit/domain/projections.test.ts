import { describe, expect, it } from "vitest";

import {
  ProjectionError,
  assertExpectedPosition,
  createEmptyMeetingProjection,
  eventId,
  getOwnerPrivateProjection,
  idempotencyKey,
  meetingId,
  meetingPosition,
  nonEmptyText,
  participantId,
  reduceMeetingProjection,
  replayMeeting,
  replaySharedMeeting,
  resetRequestId,
  suggestionId,
  toSharedMeetingProjection,
  type DomainEvent,
  type SharedDomainEvent,
} from "../../../packages/domain/src/index.js";
import {
  action,
  facilitatorParticipant,
  firstRevision,
  flagshipDecision,
  flagshipMeeting,
  ids,
  privateArtifact,
  privateEvent,
  privateUtterance,
  sharedEvent,
  sharedEvidence,
} from "./fixtures.js";

function flagshipEvents(): readonly DomainEvent[] {
  return [
    sharedEvent("MeetingCreated", 1, { meeting: flagshipMeeting() }),
    sharedEvent("ParticipantAssigned", 2, {
      participant: facilitatorParticipant(),
    }),
    privateEvent(
      "ArtifactRegistered",
      3,
      { artifact: privateArtifact() },
      ids.legal,
      idempotencyKey("register-private-artifact"),
    ),
    privateEvent(
      "UtteranceCaptured",
      4,
      { utterance: privateUtterance() },
      ids.legal,
      idempotencyKey("capture-private-utterance"),
    ),
    sharedEvent("EvidenceShared", 5, { evidence: sharedEvidence() }),
    sharedEvent("InferenceConfirmed", 6, {
      suggestionId: suggestionId("suggestion-action-europe"),
      result: {
        kind: "action",
        entity: action(ids.actionEurope, ids.premiseEurope, "Europe rollout"),
      },
      confirmedBy: ids.facilitator,
    }),
    sharedEvent("DecisionDrafted", 7, {
      decision: flagshipDecision(),
      revision: firstRevision(),
    }),
  ];
}

describe("meeting projection replay", () => {
  it("replays deterministically from the same ordered event stream", () => {
    const events = flagshipEvents();
    const first = replayMeeting(ids.meeting, events);
    const second = replayMeeting(ids.meeting, events);

    expect(first).toEqual(second);
    expect(first.position).toBe(7);
    expect(first.shared.decisions).toHaveLength(1);
    expect(first.shared.actions).toHaveLength(1);
  });

  it("builds the same shared projection without loading private payloads", () => {
    const events = flagshipEvents();
    const complete = replayMeeting(ids.meeting, events);
    const sharedEvents = events.filter(
      (event): event is SharedDomainEvent => event.visibility === "shared",
    );
    const rebuiltShared = replaySharedMeeting(ids.meeting, sharedEvents);

    expect(rebuiltShared).toEqual(toSharedMeetingProjection(complete));
    const serialized = JSON.stringify(rebuiltShared);
    expect(serialized).not.toContain("PRIVATE:");
    expect(serialized).not.toContain("secret-memo");
    expect(rebuiltShared.position).toBe(7);
  });

  it("isolates owner-private records from other owners", () => {
    const projection = replayMeeting(ids.meeting, flagshipEvents());
    const legal = getOwnerPrivateProjection(projection, ids.legal);
    const anotherOwner = getOwnerPrivateProjection(
      projection,
      participantId("participant-safety"),
    );

    expect(legal.artifacts).toHaveLength(1);
    expect(legal.utterances[0]?.text).toContain("PRIVATE:");
    expect(anotherOwner.artifacts).toEqual([]);
    expect(anotherOwner.utterances).toEqual([]);
  });

  it("treats same-content retries as no-ops", () => {
    const key = idempotencyKey("create-meeting");
    const original = sharedEvent(
      "MeetingCreated",
      1,
      { meeting: flagshipMeeting() },
      key,
    );
    const once = reduceMeetingProjection(
      createEmptyMeetingProjection(ids.meeting),
      original,
    );

    expect(reduceMeetingProjection(once, original)).toBe(once);
    expect(
      reduceMeetingProjection(once, {
        ...original,
        eventId: eventId("retry-event-id"),
        position: meetingPosition(2),
      }),
    ).toBe(once);
  });

  it("rejects idempotency conflicts, stale positions, and position gaps", () => {
    const key = idempotencyKey("create-meeting");
    const original = sharedEvent(
      "MeetingCreated",
      1,
      { meeting: flagshipMeeting() },
      key,
    );
    const once = reduceMeetingProjection(
      createEmptyMeetingProjection(ids.meeting),
      original,
    );

    expect(() =>
      reduceMeetingProjection(once, {
        ...original,
        eventId: eventId("conflicting-event"),
        position: meetingPosition(2),
        payload: {
          meeting: flagshipMeeting({
            purpose: nonEmptyText("Different purpose"),
          }),
        },
      }),
    ).toThrowError(expect.objectContaining({ code: "IDEMPOTENCY_CONFLICT" }));

    expect(() =>
      reduceMeetingProjection(
        once,
        sharedEvent("ParticipantAssigned", 1, {
          participant: facilitatorParticipant(),
        }),
      ),
    ).toThrowError(expect.objectContaining({ code: "STALE_POSITION" }));

    expect(() =>
      reduceMeetingProjection(
        once,
        sharedEvent("ParticipantAssigned", 3, {
          participant: facilitatorParticipant(),
        }),
      ),
    ).toThrowError(expect.objectContaining({ code: "POSITION_GAP" }));
  });

  it("checks optimistic expected positions", () => {
    const projection = replayMeeting(ids.meeting, flagshipEvents());
    expect(() =>
      assertExpectedPosition(projection, {
        expectedPosition: meetingPosition(5),
      }),
    ).toThrowError(
      expect.objectContaining({ code: "OPTIMISTIC_CONCURRENCY_CONFLICT" }),
    );
    expect(() =>
      assertExpectedPosition(projection, {
        expectedPosition: meetingPosition(6),
      }),
    ).toThrowError(
      expect.objectContaining({ code: "OPTIMISTIC_CONCURRENCY_CONFLICT" }),
    );
    expect(() =>
      assertExpectedPosition(projection, {
        expectedPosition: meetingPosition(7),
      }),
    ).not.toThrow();
  });

  it("applies reset only to the event's meeting projection", () => {
    const before = replayMeeting(ids.meeting, flagshipEvents());
    const reset = reduceMeetingProjection(
      before,
      sharedEvent("DemoResetCompleted", 8, {
        resetRequestId: resetRequestId("reset-flagship"),
        seedName: nonEmptyText("flagship"),
      }),
    );
    const otherMeetingId = meetingId("meeting-other");
    const other = createEmptyMeetingProjection(otherMeetingId);

    expect(reset.shared.evidence).toEqual([]);
    expect(reset.privateWorkspaces).toEqual([]);
    expect(reset.shared.meeting?.phase).toBe("preparing");
    expect(other).toEqual(createEmptyMeetingProjection(otherMeetingId));
    expect(() =>
      reduceMeetingProjection(
        other,
        sharedEvent("DemoResetCompleted", 1, {
          resetRequestId: resetRequestId("reset-flagship"),
          seedName: nonEmptyText("flagship"),
        }),
      ),
    ).toThrow(ProjectionError);
  });
});
