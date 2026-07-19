import { describe, expect, it } from "vitest";

import {
  SHARED_FLOOR_LEASE_MS,
  acquireSharedFloor,
  captureUtterance,
  releaseSharedFloor,
  userAuthorizationContext,
  type CaptureUtteranceInput,
  type UserAuthorizationContext,
  type UtteranceDependencies,
} from "../../../packages/application/src/index.js";
import {
  meetingId,
  meetingPosition,
  replayMeeting,
  type DomainEvent,
} from "../../../packages/domain/src/index.js";
import { MutableClock } from "../../helpers/application-adapters.js";
import { InMemoryEventStore } from "../../helpers/in-memory-ports.js";
import { ids } from "../domain/fixtures.js";

const NOW = "2026-07-19T12:00:00.000Z";

function context(
  participantId: string,
  overrides: Partial<UserAuthorizationContext> = {},
): UserAuthorizationContext {
  return {
    ...userAuthorizationContext({
      meetingId: ids.meeting,
      participantId,
      role: participantId === ids.facilitator ? "facilitator" : "participant",
      sessionId: `session-${participantId}`,
      userId: `user-${participantId}`,
    }),
    ...overrides,
  };
}

function fixture() {
  const clock = new MutableClock(NOW);
  const events = new InMemoryEventStore<DomainEvent>();
  const dependencies: UtteranceDependencies = { clock, events };
  return {
    clock,
    dependencies,
    events,
    facilitator: context(ids.facilitator),
    participant: context(ids.legal),
  };
}

function privateInput(
  overrides: Partial<CaptureUtteranceInput> = {},
): CaptureUtteranceInput {
  return {
    capturedAt: NOW,
    channel: "private",
    meetingId: ids.meeting,
    text: "A synthetic private concern.",
    utteranceId: "utterance-private-1",
    ...overrides,
  };
}

describe("utterance application use cases", () => {
  it("excludes simultaneous shared-floor speakers atomically", async () => {
    const { dependencies, events, facilitator, participant } = fixture();

    const [first, second] = await Promise.all([
      acquireSharedFloor(dependencies, facilitator, {
        meetingId: ids.meeting,
        utteranceId: "utterance-facilitator",
      }),
      acquireSharedFloor(dependencies, participant, {
        meetingId: ids.meeting,
        utteranceId: "utterance-participant",
      }),
    ]);

    expect(first).toMatchObject({
      kind: "acquired",
      participantId: ids.facilitator,
    });
    expect(second).toEqual({
      code: "SHARED_FLOOR_BUSY",
      kind: "failed",
    });
    const records = await events.load(ids.meeting);
    expect(records).toHaveLength(1);
    expect(records[0]?.event).toMatchObject({
      eventType: "SharedFloorAcquired",
      payload: { participantId: ids.facilitator },
    });
  });

  it("keeps the same utterance idempotent, blocks another utterance, and expires at exactly 15 seconds", async () => {
    const { clock, dependencies, events, facilitator, participant } = fixture();
    const input = {
      meetingId: ids.meeting,
      utteranceId: "utterance-facilitator",
    };

    const first = await acquireSharedFloor(dependencies, facilitator, input);
    await expect(
      acquireSharedFloor(dependencies, facilitator, input),
    ).resolves.toEqual(
      first.kind === "acquired" ? { ...first, replayed: true } : first,
    );
    await expect(
      acquireSharedFloor(dependencies, facilitator, {
        ...input,
        utteranceId: "utterance-facilitator-next",
      }),
    ).resolves.toEqual({
      code: "SHARED_FLOOR_BUSY",
      kind: "failed",
    });

    clock.advance(SHARED_FLOOR_LEASE_MS - 1);
    await expect(
      acquireSharedFloor(dependencies, participant, {
        meetingId: ids.meeting,
        utteranceId: "utterance-participant",
      }),
    ).resolves.toEqual({
      code: "SHARED_FLOOR_BUSY",
      kind: "failed",
    });

    clock.advance(1);
    const acquired = await acquireSharedFloor(dependencies, participant, {
      meetingId: ids.meeting,
      utteranceId: "utterance-participant",
    });
    expect(acquired).toMatchObject({
      kind: "acquired",
      leaseExpiresAt: "2026-07-19T12:00:30.000Z",
      participantId: ids.legal,
      position: 3,
      replayed: false,
    });
    const records = await events.load(ids.meeting);
    expect(records.map(({ event }) => event.eventType)).toEqual([
      "SharedFloorAcquired",
      "SharedFloorReleased",
      "SharedFloorAcquired",
    ]);
    expect(records[1]?.event).toMatchObject({
      actor: { kind: "system" },
      payload: { participantId: ids.facilitator, reason: "expired" },
    });
  });

  it("stores private captures only in the caller's private workspace", async () => {
    const { dependencies, events, participant } = fixture();

    const result = await captureUtterance(
      dependencies,
      participant,
      privateInput(),
    );

    expect(result).toMatchObject({
      kind: "captured",
      replayed: false,
      utterance: {
        channel: "private",
        participantId: ids.legal,
        utteranceId: "utterance-private-1",
      },
    });
    const records = await events.load(ids.meeting);
    expect(records[0]?.event).toMatchObject({
      eventType: "UtteranceCaptured",
      ownerParticipantId: ids.legal,
      visibility: "private",
    });
    const projection = replayMeeting(
      meetingId(ids.meeting),
      records.map(({ event, position }) => ({
        ...event,
        position: meetingPosition(position),
      })),
    );
    expect(projection.shared.utterances).toEqual([]);
    expect(projection.privateWorkspaces).toHaveLength(1);
    expect(projection.privateWorkspaces[0]?.ownerParticipantId).toBe(ids.legal);
    expect(projection.privateWorkspaces[0]?.utterances).toHaveLength(1);
  });

  it("requires the caller's active, utterance-bound floor for shared capture", async () => {
    const { dependencies, facilitator, participant } = fixture();
    const shared = privateInput({
      channel: "shared",
      utteranceId: "utterance-shared-1",
    });

    await expect(
      captureUtterance(dependencies, participant, shared),
    ).resolves.toEqual({ code: "FORBIDDEN", kind: "failed" });

    await acquireSharedFloor(dependencies, facilitator, {
      meetingId: ids.meeting,
      utteranceId: shared.utteranceId,
    });
    await expect(
      captureUtterance(dependencies, participant, shared),
    ).resolves.toEqual({ code: "SHARED_FLOOR_BUSY", kind: "failed" });
    await expect(
      captureUtterance(dependencies, facilitator, shared),
    ).resolves.toMatchObject({
      kind: "captured",
      utterance: {
        channel: "shared",
        participantId: ids.facilitator,
      },
    });
  });

  it("replays an exact utterance duplicate without appending", async () => {
    const { dependencies, events, participant } = fixture();
    const input = privateInput();

    const first = await captureUtterance(dependencies, participant, input);
    const second = await captureUtterance(dependencies, participant, input);

    expect(second).toEqual(
      first.kind === "captured" ? { ...first, replayed: true } : first,
    );
    expect(await events.position(ids.meeting)).toBe(1);
  });

  it.each([
    ["channel", { channel: "shared" as const }],
    ["text", { text: "Different text." }],
    ["capturedAt", { capturedAt: "2026-07-19T12:00:01.000Z" }],
  ])("rejects utteranceId reuse with changed %s", async (_field, changed) => {
    const { dependencies, participant } = fixture();
    const input = privateInput();
    await captureUtterance(dependencies, participant, input);

    await expect(
      captureUtterance(dependencies, participant, {
        ...input,
        ...changed,
      }),
    ).resolves.toEqual({
      code: "IDEMPOTENCY_CONFLICT",
      kind: "failed",
    });
  });

  it("allows only the utterance-bound owner to release the floor", async () => {
    const { dependencies, events, facilitator, participant } = fixture();
    const input = {
      meetingId: ids.meeting,
      utteranceId: "utterance-shared-1",
    };
    await acquireSharedFloor(dependencies, facilitator, input);

    await expect(
      releaseSharedFloor(dependencies, participant, input),
    ).resolves.toEqual({ code: "FORBIDDEN", kind: "failed" });
    await expect(
      releaseSharedFloor(dependencies, facilitator, {
        ...input,
        utteranceId: "utterance-shared-other",
      }),
    ).resolves.toEqual({ code: "FORBIDDEN", kind: "failed" });

    const released = await releaseSharedFloor(dependencies, facilitator, input);
    expect(released).toMatchObject({
      kind: "released",
      releasedAt: NOW,
      replayed: false,
    });
    await expect(
      releaseSharedFloor(dependencies, facilitator, input),
    ).resolves.toEqual(
      released.kind === "released" ? { ...released, replayed: true } : released,
    );
    const records = await events.load(ids.meeting);
    expect(records.at(-1)?.event).toMatchObject({
      actor: { kind: "participant", participantId: ids.facilitator },
      eventType: "SharedFloorReleased",
      payload: { participantId: ids.facilitator, reason: "released" },
    });
  });

  it("requires meeting:read authorization for every operation", async () => {
    const { dependencies, participant } = fixture();
    const unauthorized = context(ids.legal, { capabilities: new Set() });
    const wrongMeeting = context(ids.legal, { meetingId: "meeting-other" });

    await expect(
      acquireSharedFloor(dependencies, unauthorized, {
        meetingId: ids.meeting,
        utteranceId: "utterance-1",
      }),
    ).resolves.toEqual({ code: "FORBIDDEN", kind: "failed" });
    await expect(
      releaseSharedFloor(dependencies, wrongMeeting, {
        meetingId: ids.meeting,
        utteranceId: "utterance-1",
      }),
    ).resolves.toEqual({ code: "FORBIDDEN", kind: "failed" });
    await expect(
      captureUtterance(dependencies, unauthorized, privateInput()),
    ).resolves.toEqual({ code: "FORBIDDEN", kind: "failed" });

    expect(participant.capabilities.has("meeting:read")).toBe(true);
  });
});
