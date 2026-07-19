import { describe, expect, it } from "vitest";

import {
  NodeMeetingRealtimeHub,
  REALTIME_TICKET_TTL_MS,
  RealtimeNotifyingEventStore,
} from "../../../apps/server/src/realtime.js";
import {
  nonEmptyText,
  resetRequestId,
  type DomainEvent,
} from "../../../packages/domain/src/index.js";
import {
  RealtimeRoleProjectionSchema,
  type ApplicationRealtimeMessage,
  type RealtimeRoleProjection,
} from "../../../packages/protocol/src/index.js";
import {
  MutableClock,
  SequenceIdGenerator,
} from "../../helpers/application-adapters.js";
import { InMemoryEventStore } from "../../helpers/in-memory-ports.js";
import { ids, sharedEvent } from "../domain/fixtures.js";

const NOW = "2026-07-19T12:00:00.000Z";

function projection(
  participantId: string,
  correlationId: string,
  position = 0,
): RealtimeRoleProjection {
  return RealtimeRoleProjectionSchema.parse({
    capabilities: ["meeting:read", "private:read-own"],
    correlationId,
    meeting: {
      meetingId: ids.meeting,
      phase: "preparing",
      purpose: "Synthetic realtime test",
    },
    participant: {
      participantId,
      role: "participant",
      userId: `user-${participantId}`,
    },
    privateWorkspace: {
      disclosureCandidates: [],
      inferenceSuggestions: [],
      sources: [],
    },
    shared: {
      actions: [],
      decisions: [],
      dissent: [],
      evidence: [],
      participants: [],
      position,
      premises: [],
    },
  });
}

function ticketInput(participantId: string) {
  return {
    correlationId: `correlation-${participantId}`,
    lastSeenPosition: 0,
    meetingId: ids.meeting,
    participantId,
    role: "participant" as const,
    sessionId: `session-${participantId}`,
    userId: `user-${participantId}`,
  };
}

describe("Node meeting realtime hub", () => {
  it("issues expiring one-time tickets", () => {
    const clock = new MutableClock(NOW);
    const hub = new NodeMeetingRealtimeHub(clock, new SequenceIdGenerator());
    const issued = hub.issueTicket(ticketInput(ids.legal));

    expect(Date.parse(issued.expiresAt) - Date.parse(NOW)).toBe(
      REALTIME_TICKET_TTL_MS,
    );
    expect(hub.consumeTicket(issued.ticket)).toEqual(issued);
    expect(hub.consumeTicket(issued.ticket)).toBeUndefined();

    const expired = hub.issueTicket(ticketInput(ids.facilitator));
    clock.advance(REALTIME_TICKET_TTL_MS);
    expect(hub.consumeTicket(expired.ticket)).toBeUndefined();
  });

  it("publishes owner-private changes only to the owner and shared changes to both", async () => {
    const hub = new NodeMeetingRealtimeHub(
      new MutableClock(NOW),
      new SequenceIdGenerator(),
    );
    const legalMessages: ApplicationRealtimeMessage[] = [];
    const engineeringMessages: ApplicationRealtimeMessage[] = [];
    let legalPosition = 0;
    let facilitatorPosition = 0;
    const legalTicket = hub.issueTicket(ticketInput(ids.legal));
    const engineeringTicket = hub.issueTicket(ticketInput(ids.facilitator));

    await hub.subscribe({
      close: () => undefined,
      currentPosition: 0,
      revalidate: () => Promise.resolve(true),
      send: (message) => legalMessages.push(message),
      snapshot: (correlationId) =>
        Promise.resolve(projection(ids.legal, correlationId, legalPosition)),
      ticket: legalTicket,
    });
    await hub.subscribe({
      close: () => undefined,
      currentPosition: 0,
      revalidate: () => Promise.resolve(true),
      send: (message) => engineeringMessages.push(message),
      snapshot: (correlationId) =>
        Promise.resolve(
          projection(ids.facilitator, correlationId, facilitatorPosition),
        ),
      ticket: engineeringTicket,
    });

    legalPosition = 1;
    await hub.publish([
      {
        correlationId: "correlation-private",
        meetingId: ids.meeting,
        sourcePosition: 1,
        visibility: {
          kind: "owner_private",
          ownerParticipantId: ids.legal,
        },
      },
    ]);
    expect(legalMessages.map(({ type }) => type)).toEqual([
      "connection.ready",
      "role_projection.updated",
    ]);
    expect(engineeringMessages.map(({ type }) => type)).toEqual([
      "connection.ready",
    ]);

    legalPosition = 2;
    facilitatorPosition = 1;
    await hub.publish([
      {
        correlationId: "correlation-shared",
        meetingId: ids.meeting,
        sourcePosition: 2,
        visibility: { kind: "shared" },
      },
    ]);
    expect(legalMessages.at(-1)).toMatchObject({
      position: 2,
      type: "role_projection.updated",
    });
    expect(engineeringMessages.at(-1)).toMatchObject({
      position: 1,
      type: "role_projection.updated",
    });
  });

  it("closes a connection when access revalidation fails", async () => {
    const hub = new NodeMeetingRealtimeHub(
      new MutableClock(NOW),
      new SequenceIdGenerator(),
    );
    const closes: { code: number; reason: string }[] = [];
    const ticket = hub.issueTicket(ticketInput(ids.legal));
    await hub.subscribe({
      close: (code, reason) => closes.push({ code, reason }),
      currentPosition: 0,
      revalidate: () => Promise.resolve(false),
      send: () => undefined,
      snapshot: (correlationId) =>
        Promise.resolve(projection(ids.legal, correlationId)),
      ticket,
    });

    await hub.publish([
      {
        correlationId: "correlation-expired",
        meetingId: ids.meeting,
        sourcePosition: 1,
        visibility: { kind: "shared" },
      },
    ]);
    expect(closes).toEqual([
      { code: 4401, reason: "Session or meeting access expired" },
    ]);
  });

  it("sends a catch-up projection before ready and resumes at its visible position", async () => {
    const hub = new NodeMeetingRealtimeHub(
      new MutableClock(NOW),
      new SequenceIdGenerator(),
    );
    const messages: ApplicationRealtimeMessage[] = [];
    const ticket = hub.issueTicket(ticketInput(ids.legal));

    await hub.subscribe({
      close: () => undefined,
      currentPosition: 1,
      revalidate: () => Promise.resolve(true),
      send: (message) => messages.push(message),
      snapshot: (correlationId) =>
        Promise.resolve(projection(ids.legal, correlationId, 1)),
      ticket,
    });

    expect(messages.map(({ type }) => type)).toEqual([
      "role_projection.updated",
      "connection.ready",
    ]);
    expect(messages.map(({ position }) => position)).toEqual([1, 1]);
  });

  it("publishes only newly appended event batches", async () => {
    const published: number[][] = [];
    const delegate = new InMemoryEventStore<DomainEvent>();
    const store = new RealtimeNotifyingEventStore(delegate, (publications) => {
      published.push(publications.map(({ sourcePosition }) => sourcePosition));
      return Promise.resolve();
    });
    const event = sharedEvent("DemoResetRequested", 1, {
      resetRequestId: resetRequestId("reset-store-notification"),
      seedName: nonEmptyText("flagship"),
    });
    const request = {
      events: [event],
      expectedPosition: 0,
      idempotencyKey: "notify-once",
      meetingId: ids.meeting,
    };

    await store.append(request);
    await store.append(request);
    await Promise.resolve();

    expect(published).toEqual([[1]]);
  });

  it("keeps a successful durable append successful when publication fails", async () => {
    const delegate = new InMemoryEventStore<DomainEvent>();
    const store = new RealtimeNotifyingEventStore(delegate, () =>
      Promise.reject(new Error("Synthetic publication failure")),
    );
    const event = sharedEvent("DemoResetRequested", 1, {
      resetRequestId: resetRequestId("reset-durable-success"),
      seedName: nonEmptyText("flagship"),
    });

    const result = await store.append({
      events: [event],
      expectedPosition: 0,
      idempotencyKey: "durable-success",
      meetingId: ids.meeting,
    });
    await Promise.resolve();

    expect(result.kind).toBe("appended");
    await expect(delegate.position(ids.meeting)).resolves.toBe(1);
  });
});
