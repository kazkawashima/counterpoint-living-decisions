import { expect } from "vitest";

import type { ArtifactStore } from "../../packages/ports/src/index.js";

export async function artifactStoreContract(
  createStore: () => ArtifactStore,
): Promise<void> {
  const store = createStore();
  const privateScope = {
    artifactId: "artifact-a",
    meetingId: "meeting-a",
    ownerParticipantId: "participant-a",
    visibility: "private" as const,
  };
  const bytes = new Uint8Array([1, 2, 3]);
  const metadata = await store.put({
    bytes,
    contentType: "application/pdf",
    hash: "sha256:fixture",
    scope: privateScope,
  });

  expect(metadata).toMatchObject({
    ...privateScope,
    size: 3,
  });
  bytes[0] = 99;
  await expect(store.get(privateScope)).resolves.toEqual(
    new Uint8Array([1, 2, 3]),
  );
  await expect(
    store.get({
      ...privateScope,
      ownerParticipantId: "participant-b",
    }),
  ).resolves.toBeUndefined();
  await expect(
    store.get({ ...privateScope, meetingId: "meeting-b" }),
  ).resolves.toBeUndefined();

  const sharedScope = {
    artifactId: privateScope.artifactId,
    meetingId: privateScope.meetingId,
    visibility: "shared" as const,
  };
  await store.put({
    bytes: new Uint8Array([4, 5, 6]),
    contentType: "application/pdf",
    hash: "sha256:shared-fixture",
    scope: sharedScope,
  });
  await expect(store.get(sharedScope)).resolves.toEqual(
    new Uint8Array([4, 5, 6]),
  );
  await expect(store.get(privateScope)).resolves.toEqual(
    new Uint8Array([1, 2, 3]),
  );

  await store.delete(privateScope);
  await expect(store.get(privateScope)).resolves.toBeUndefined();
  await expect(store.get(sharedScope)).resolves.toEqual(
    new Uint8Array([4, 5, 6]),
  );

  await expect(
    store.put({
      bytes,
      contentType: "application/pdf",
      hash: "sha256:invalid",
      scope: {
        artifactId: "artifact-invalid",
        meetingId: "meeting-a",
        visibility: "private",
      },
    }),
  ).rejects.toThrow("visibility and owner scope");
}
