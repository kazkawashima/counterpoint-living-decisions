import { describe, expect, expectTypeOf, it } from "vitest";

import {
  ActorSchema,
  ActionIdSchema,
  CausationIdSchema,
  ConfirmationStatusSchema,
  CorrelationIdSchema,
  DecisionIdSchema,
  DisclosureCandidateIdSchema,
  DisplayTokenIdSchema,
  EventIdSchema,
  IdempotencyKeySchema,
  MeetingIdSchema,
  MeetingPositionSchema,
  OriginSchema,
  ParticipantIdSchema,
  PremiseIdSchema,
  ReconsiderationTaskIdSchema,
  SourceArtifactIdSchema,
  UserIdSchema,
  UtcIsoTimestampSchema,
  VisibilitySchema,
  type CorrelationId,
  type MeetingId,
} from "@counterpoint/protocol";

describe("protocol wire primitives", () => {
  it("parses opaque IDs into distinct branded wire values", () => {
    const meetingId = MeetingIdSchema.parse("meeting_01JY");
    const correlationId = CorrelationIdSchema.parse("correlation:request-1");

    expect(meetingId).toBe("meeting_01JY");
    expect(correlationId).toBe("correlation:request-1");
    expectTypeOf(meetingId).toEqualTypeOf<MeetingId>();
    expectTypeOf(correlationId).toEqualTypeOf<CorrelationId>();

    for (const schema of [
      EventIdSchema,
      MeetingIdSchema,
      UserIdSchema,
      ParticipantIdSchema,
      SourceArtifactIdSchema,
      PremiseIdSchema,
      DecisionIdSchema,
      ActionIdSchema,
      ReconsiderationTaskIdSchema,
      DisclosureCandidateIdSchema,
      DisplayTokenIdSchema,
      CorrelationIdSchema,
      CausationIdSchema,
      IdempotencyKeySchema,
    ]) {
      expect(schema.safeParse("").success).toBe(false);
      expect(schema.safeParse(" leading-space").success).toBe(false);
      expect(schema.safeParse("line\nbreak").success).toBe(false);
      expect(schema.safeParse({ id: "not-a-string" }).success).toBe(false);
    }
  });

  it("accepts only monotonic non-negative meeting positions", () => {
    expect(MeetingPositionSchema.parse(0)).toBe(0);
    expect(MeetingPositionSchema.parse(42)).toBe(42);
    expect(MeetingPositionSchema.safeParse(-1).success).toBe(false);
    expect(MeetingPositionSchema.safeParse(1.5).success).toBe(false);
  });

  it("accepts only UTC ISO timestamps", () => {
    expect(
      UtcIsoTimestampSchema.safeParse("2026-07-19T05:04:03.123Z").success,
    ).toBe(true);
    expect(
      UtcIsoTimestampSchema.safeParse("2026-07-19T14:04:03+09:00").success,
    ).toBe(false);
    expect(UtcIsoTimestampSchema.safeParse("2026-07-19T05:04:03").success).toBe(
      false,
    );
    expect(UtcIsoTimestampSchema.safeParse("not-a-date").success).toBe(false);
  });

  it("uses the canonical visibility, origin, and confirmation vocabularies", () => {
    expect(VisibilitySchema.options).toEqual(["private", "shared"]);
    expect(OriginSchema.options).toEqual([
      "human_utterance",
      "human_input",
      "source_artifact",
      "ai_inference",
      "system",
    ]);
    expect(ConfirmationStatusSchema.options).toEqual([
      "not_applicable",
      "proposed",
      "confirmed",
      "rejected",
    ]);

    expect(VisibilitySchema.safeParse("facilitator").success).toBe(false);
    expect(OriginSchema.safeParse("AI").success).toBe(false);
    expect(ConfirmationStatusSchema.safeParse("approved").success).toBe(false);
  });

  it("accepts only strict server-derived actor shapes", () => {
    expect(
      ActorSchema.parse({
        kind: "participant",
        participantId: "participant-1",
      }),
    ).toEqual({
      kind: "participant",
      participantId: "participant-1",
    });
    expect(
      ActorSchema.parse({ kind: "system", actorId: "webhook-adapter" }),
    ).toEqual({ kind: "system", actorId: "webhook-adapter" });

    expect(
      ActorSchema.safeParse({
        kind: "participant",
        participantId: "participant-1",
        role: "facilitator",
      }).success,
    ).toBe(false);
    expect(
      ActorSchema.safeParse({
        kind: "participant",
        actorId: "client-supplied",
      }).success,
    ).toBe(false);
  });
});
