import { expect } from "vitest";

import type { ProjectionStore } from "../../packages/ports/src/index.js";

interface FixtureProjection {
  readonly label: string;
}

export async function projectionStoreContract(
  createStore: () => ProjectionStore<FixtureProjection>,
): Promise<void> {
  const store = createStore();
  const shared = {
    meetingId: "meeting-a",
    projection: "shared",
  };
  const ownerA = {
    meetingId: "meeting-a",
    ownerParticipantId: "participant-a",
    projection: "private",
  };
  const ownerB = {
    meetingId: "meeting-a",
    ownerParticipantId: "participant-b",
    projection: "private",
  };

  await store.put(shared, { label: "shared-a" });
  await store.put(ownerA, { label: "private-a" });

  await expect(store.get(shared)).resolves.toEqual({
    label: "shared-a",
  });
  await expect(store.get(ownerA)).resolves.toEqual({
    label: "private-a",
  });
  await expect(store.get(ownerB)).resolves.toBeUndefined();
  await expect(
    store.get({ ...shared, meetingId: "meeting-b" }),
  ).resolves.toBeUndefined();

  await store.put(shared, { label: "shared-a-updated" });
  await expect(store.get(shared)).resolves.toEqual({
    label: "shared-a-updated",
  });
}
