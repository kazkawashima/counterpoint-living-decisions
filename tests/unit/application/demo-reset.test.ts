import { describe, expect, it } from "vitest";

import {
  resetDemoMeeting,
  type DemoResetDependencies,
  type ResetDemoMeetingInput,
} from "../../../packages/application/src/index.js";
import { userAuthorizationContext } from "../../../packages/application/src/sessions.js";
import {
  idempotencyKey,
  suggestionId,
  type DomainEvent,
  type MeetingProjection,
} from "../../../packages/domain/src/index.js";
import type {
  AppendEventsRequest,
  EventStore,
} from "../../../packages/ports/src/index.js";
import { MutableClock } from "../../helpers/application-adapters.js";
import {
  InMemoryEventStore,
  InMemoryProjectionStore,
} from "../../helpers/in-memory-ports.js";
import {
  action,
  facilitatorParticipant,
  flagshipMeeting,
  ids,
  privateArtifact,
  privateEvent,
  sharedEvent,
  sharedEvidence,
} from "../domain/fixtures.js";

const RESET_TIME = "2026-07-20T10:00:00.000Z";

function stableFixtureHash(value: string): string {
  let hash = 2_166_136_261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return `fixture-${(hash >>> 0).toString(16)}`;
}

class CapturingEventStore
  extends InMemoryEventStore<DomainEvent>
  implements EventStore<DomainEvent>
{
  readonly requests: AppendEventsRequest<DomainEvent>[] = [];

  override append(
    request: AppendEventsRequest<DomainEvent>,
  ): ReturnType<EventStore<DomainEvent>["append"]> {
    this.requests.push(request);
    return super.append(request);
  }
}

function facilitatorContext(meetingScope: string = ids.meeting) {
  return userAuthorizationContext({
    meetingId: meetingScope,
    participantId: ids.facilitator,
    role: "facilitator",
    sessionId: "session-facilitator",
    userId: "user-facilitator",
  });
}

function participantContext() {
  return userAuthorizationContext({
    meetingId: ids.meeting,
    participantId: ids.legal,
    role: "participant",
    sessionId: "session-participant",
    userId: "user-participant",
  });
}

const input: ResetDemoMeetingInput = {
  expectedPosition: 5,
  idempotencyKey: "reset-flagship",
  meetingId: ids.meeting,
  seedName: "flagship",
};

async function fixture() {
  const events = new CapturingEventStore();
  const projections = new InMemoryProjectionStore<MeetingProjection>();
  const dependencies: DemoResetDependencies = {
    clock: new MutableClock(RESET_TIME),
    events,
    hash: stableFixtureHash,
    projections,
  };
  const seeded = await events.append({
    events: [
      sharedEvent("MeetingCreated", 1, { meeting: flagshipMeeting() }),
      sharedEvent("ParticipantAssigned", 2, {
        participant: facilitatorParticipant(),
      }),
      privateEvent(
        "ArtifactRegistered",
        3,
        { artifact: privateArtifact() },
        ids.legal,
        idempotencyKey("private-artifact"),
      ),
      sharedEvent("EvidenceShared", 4, { evidence: sharedEvidence() }),
      sharedEvent("InferenceConfirmed", 5, {
        confirmedBy: ids.facilitator,
        result: {
          entity: action(ids.actionEurope, ids.premiseEurope, "Europe rollout"),
          kind: "action",
        },
        suggestionId: suggestionId("suggestion-reset-action"),
      }),
    ],
    expectedPosition: 0,
    meetingId: ids.meeting,
  });
  if (seeded.kind !== "appended") {
    throw new Error("Demo reset fixture failed");
  }
  events.requests.length = 0;
  return { dependencies, events, projections };
}

describe("demo reset application command", () => {
  it("atomically appends deterministic reset lineage and refreshes only the meeting projection", async () => {
    const { dependencies, events, projections } = await fixture();

    const result = await resetDemoMeeting(
      dependencies,
      facilitatorContext(),
      input,
    );

    expect(result).toEqual({
      completedEventId: "demo-reset:meeting-flagship:reset-flagship:completed",
      correlationId: "demo-reset:meeting-flagship:reset-flagship",
      kind: "reset",
      position: 7,
      replayed: false,
      requestedEventId: "demo-reset:meeting-flagship:reset-flagship:requested",
      resetRequestId: "demo-reset:meeting-flagship:reset-flagship",
      seedName: "flagship",
    });
    expect(events.requests).toHaveLength(1);
    expect(events.requests[0]).toMatchObject({
      expectedPosition: 5,
      idempotencyKey: "reset-flagship",
      meetingId: ids.meeting,
      trustPayloadFingerprintForReplay: true,
    });
    expect(events.requests[0]?.payloadFingerprint).toMatch(/^fixture-/u);
    expect(events.requests[0]?.events).toMatchObject([
      {
        actor: { kind: "participant", participantId: ids.facilitator },
        correlationId: "demo-reset:meeting-flagship:reset-flagship",
        eventType: "DemoResetRequested",
        idempotencyKey: "reset-flagship",
        payload: {
          resetRequestId: "demo-reset:meeting-flagship:reset-flagship",
          seedName: "flagship",
        },
        position: 6,
      },
      {
        actor: { kind: "system" },
        causationId: "demo-reset:meeting-flagship:reset-flagship:requested",
        correlationId: "demo-reset:meeting-flagship:reset-flagship",
        eventType: "DemoResetCompleted",
        payload: {
          resetRequestId: "demo-reset:meeting-flagship:reset-flagship",
          seedName: "flagship",
        },
        position: 7,
      },
    ]);

    const projection = await projections.get({
      meetingId: ids.meeting,
      ownerParticipantId: ids.facilitator,
      projection: "meeting",
    });
    expect(projection?.position).toBe(7);
    expect(projection?.shared.meeting?.phase).toBe("preparing");
    expect(projection?.shared.evidence).toEqual([]);
    expect(projection?.privateWorkspaces).toEqual([]);
    expect(projection?.shared.participants).toHaveLength(1);
  });

  it("replays the same reset without adding events and rejects semantic key reuse", async () => {
    const { dependencies, events } = await fixture();
    const first = await resetDemoMeeting(
      dependencies,
      facilitatorContext(),
      input,
    );
    const firstRecords = await events.load(ids.meeting);
    const replayed = await resetDemoMeeting(
      dependencies,
      facilitatorContext(),
      input,
    );

    expect(first).toMatchObject({ kind: "reset", replayed: false });
    expect(replayed).toEqual(
      first.kind === "reset" ? { ...first, replayed: true } : first,
    );
    expect(await events.load(ids.meeting)).toEqual(firstRecords);
    expect(await events.position(ids.meeting)).toBe(7);

    await expect(
      resetDemoMeeting(dependencies, facilitatorContext(), {
        ...input,
        seedName: "different-seed",
      }),
    ).resolves.toEqual({
      code: "IDEMPOTENCY_CONFLICT",
      kind: "failed",
    });
    expect(await events.position(ids.meeting)).toBe(7);
  });

  it("rejects participant authority, missing capability, cross-meeting scope, and stale position", async () => {
    const { dependencies, events } = await fixture();
    const missingCapability = {
      ...facilitatorContext(),
      capabilities: new Set(["meeting:read"] as const),
    };

    await expect(
      resetDemoMeeting(dependencies, participantContext(), input),
    ).resolves.toEqual({ code: "FORBIDDEN", kind: "failed" });
    await expect(
      resetDemoMeeting(dependencies, missingCapability, input),
    ).resolves.toEqual({ code: "FORBIDDEN", kind: "failed" });
    await expect(
      resetDemoMeeting(
        dependencies,
        facilitatorContext("meeting-other"),
        input,
      ),
    ).resolves.toEqual({ code: "FORBIDDEN", kind: "failed" });
    await expect(
      resetDemoMeeting(dependencies, facilitatorContext(), {
        ...input,
        expectedPosition: 4,
      }),
    ).resolves.toEqual({
      actualPosition: 5,
      code: "CONFLICT",
      expectedPosition: 4,
      kind: "failed",
    });
    expect(await events.position(ids.meeting)).toBe(5);
  });
});
