import type { EventProjectionStore } from "@counterpoint/ports";
import { expect } from "vitest";

export interface AtomicFixtureEvent {
  readonly type: string;
  readonly value: string;
}

export interface AtomicFixtureProjection {
  readonly label: string;
}

type Factory = () => EventProjectionStore<
  AtomicFixtureEvent,
  AtomicFixtureProjection
>;

const sharedScope = {
  meetingId: "meeting-atomic-contract",
  projection: "display",
} as const;

const privateScope = {
  meetingId: "meeting-atomic-contract",
  ownerParticipantId: "participant-a",
  projection: "role",
} as const;

export async function eventProjectionStoreContract(
  factory: Factory,
  invalidProjectionFactory: Factory,
): Promise<void> {
  const store = factory();
  const originalEvent = { type: "Created", value: "one" };

  await expect(
    store.commit({
      append: {
        events: [originalEvent],
        expectedPosition: 0,
        idempotencyKey: "atomic-request-1",
        meetingId: sharedScope.meetingId,
      },
      projections: [
        { scope: sharedScope, value: { label: "shared-v1" } },
        { scope: privateScope, value: { label: "private-v1" } },
      ],
    }),
  ).resolves.toEqual({
    kind: "appended",
    records: [{ event: originalEvent, position: 1 }],
  });
  await expect(store.get(sharedScope)).resolves.toEqual({
    label: "shared-v1",
  });
  await expect(store.get(privateScope)).resolves.toEqual({
    label: "private-v1",
  });

  await expect(
    store.commit({
      append: {
        events: [originalEvent],
        expectedPosition: 0,
        idempotencyKey: "atomic-request-1",
        meetingId: sharedScope.meetingId,
      },
      projections: [
        { scope: sharedScope, value: { label: "must-not-rewrite" } },
      ],
    }),
  ).resolves.toEqual({
    kind: "replayed",
    records: [{ event: originalEvent, position: 1 }],
  });
  await expect(store.get(sharedScope)).resolves.toEqual({
    label: "shared-v1",
  });

  await expect(
    store.commit({
      append: {
        events: [{ type: "Updated", value: "cross-meeting" }],
        expectedPosition: 1,
        idempotencyKey: "atomic-request-cross-meeting",
        meetingId: sharedScope.meetingId,
      },
      projections: [
        {
          scope: {
            meetingId: "meeting-other",
            projection: "display",
          },
          value: { label: "must-not-write" },
        },
      ],
    }),
  ).rejects.toThrow(
    "Atomic projection writes must belong to the appended meeting",
  );
  await expect(store.position(sharedScope.meetingId)).resolves.toBe(1);

  await expect(
    store.commit({
      append: {
        events: [{ type: "Updated", value: "position-conflict" }],
        expectedPosition: 0,
        idempotencyKey: "atomic-request-position-conflict",
        meetingId: sharedScope.meetingId,
      },
      projections: [{ scope: sharedScope, value: { label: "must-not-write" } }],
    }),
  ).resolves.toEqual({
    actualPosition: 1,
    expectedPosition: 0,
    kind: "position_conflict",
  });
  await expect(store.get(sharedScope)).resolves.toEqual({
    label: "shared-v1",
  });

  await expect(
    store.commit({
      append: {
        events: [{ type: "Created", value: "different" }],
        expectedPosition: 1,
        idempotencyKey: "atomic-request-1",
        meetingId: sharedScope.meetingId,
      },
      projections: [{ scope: sharedScope, value: { label: "must-not-write" } }],
    }),
  ).resolves.toEqual({
    idempotencyKey: "atomic-request-1",
    kind: "idempotency_conflict",
  });
  await expect(store.load(sharedScope.meetingId)).resolves.toEqual([
    { event: originalEvent, position: 1 },
  ]);

  const invalidStore = invalidProjectionFactory();
  const rollbackMeetingId = "meeting-atomic-contract-rollback";
  const rollbackScope = {
    meetingId: rollbackMeetingId,
    projection: "display",
  } as const;
  await expect(
    invalidStore.commit({
      append: {
        events: [{ type: "Created", value: "rollback" }],
        expectedPosition: 0,
        idempotencyKey: "atomic-request-rollback",
        meetingId: rollbackMeetingId,
      },
      projections: [{ scope: rollbackScope, value: { label: "invalid" } }],
    }),
  ).rejects.toThrow();
  await expect(invalidStore.position(rollbackMeetingId)).resolves.toBe(0);
  await expect(invalidStore.get(rollbackScope)).resolves.toBeUndefined();

  const recoveredStore = factory();
  await expect(
    recoveredStore.commit({
      append: {
        events: [{ type: "Created", value: "recovered" }],
        expectedPosition: 0,
        idempotencyKey: "atomic-request-rollback",
        meetingId: rollbackMeetingId,
      },
      projections: [{ scope: rollbackScope, value: { label: "recovered" } }],
    }),
  ).resolves.toMatchObject({ kind: "appended" });
}
