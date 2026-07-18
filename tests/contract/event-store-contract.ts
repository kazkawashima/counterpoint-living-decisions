import { expect } from "vitest";

import type { EventStore } from "../../packages/ports/src/index.js";

interface FixtureEvent {
  readonly type: string;
  readonly value: string;
}

export async function eventStoreContract(
  createStore: () => EventStore<FixtureEvent>,
): Promise<void> {
  const store = createStore();
  const first = await store.append({
    events: [{ type: "Created", value: "one" }],
    expectedPosition: 0,
    idempotencyKey: "request-1",
    meetingId: "meeting-a",
    payloadFingerprint: "fingerprint-1",
  });

  expect(first.kind).toBe("appended");
  if (first.kind !== "appended") {
    throw new Error("Expected an append result");
  }
  expect(first.records[0]?.position).toBe(1);

  const replay = await store.append({
    events: [{ type: "Created", value: "one" }],
    expectedPosition: 0,
    idempotencyKey: "request-1",
    meetingId: "meeting-a",
    payloadFingerprint: "fingerprint-1",
  });
  expect(replay).toEqual({
    kind: "replayed",
    records: first.records,
  });
  await expect(store.position("meeting-a")).resolves.toBe(1);

  const idempotencyConflict = await store.append({
    events: [{ type: "Created", value: "different" }],
    idempotencyKey: "request-1",
    meetingId: "meeting-a",
    payloadFingerprint: "fingerprint-2",
  });
  expect(idempotencyConflict).toEqual({
    idempotencyKey: "request-1",
    kind: "idempotency_conflict",
  });

  const positionConflict = await store.append({
    events: [{ type: "Updated", value: "two" }],
    expectedPosition: 0,
    meetingId: "meeting-a",
  });
  expect(positionConflict).toEqual({
    actualPosition: 1,
    expectedPosition: 0,
    kind: "position_conflict",
  });

  await expect(store.load("meeting-b")).resolves.toEqual([]);
  await expect(store.position("meeting-b")).resolves.toBe(0);
}
