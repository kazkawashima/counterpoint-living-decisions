import { describe, expect, it } from "vitest";

import { R2ArtifactStore } from "@counterpoint/adapters-cloudflare";
import type { ArtifactScope } from "@counterpoint/ports";

interface StoredObject {
  readonly bytes: Uint8Array;
  readonly customMetadata: Record<string, string> | undefined;
  readonly httpMetadata: R2HTTPMetadata | undefined;
}

class FakeR2Bucket {
  readonly objects = new Map<string, StoredObject>();

  delete(key: string): Promise<void> {
    this.objects.delete(key);
    return Promise.resolve();
  }

  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null> {
    const stored = this.objects.get(key);
    if (stored === undefined) {
      return Promise.resolve(null);
    }

    return Promise.resolve({
      arrayBuffer() {
        return Promise.resolve(stored.bytes.slice().buffer);
      },
    });
  }

  put(
    key: string,
    value: ArrayBufferView,
    options?: R2PutOptions,
  ): Promise<void> {
    this.objects.set(key, {
      bytes: new Uint8Array(
        value.buffer,
        value.byteOffset,
        value.byteLength,
      ).slice(),
      customMetadata:
        options?.customMetadata === undefined
          ? undefined
          : { ...options.customMetadata },
      httpMetadata:
        options?.httpMetadata instanceof Headers
          ? undefined
          : options?.httpMetadata === undefined
            ? undefined
            : { ...options.httpMetadata },
    });
    return Promise.resolve();
  }
}

function createStore(): {
  readonly bucket: FakeR2Bucket;
  readonly store: R2ArtifactStore;
} {
  const bucket = new FakeR2Bucket();
  return {
    bucket,
    store: new R2ArtifactStore(bucket as unknown as R2Bucket),
  };
}

const privateScope: ArtifactScope = {
  artifactId: "artifact-a",
  meetingId: "meeting-a",
  ownerParticipantId: "participant-a",
  visibility: "private",
};

describe("R2ArtifactStore", () => {
  it("uses exact meeting, visibility, and owner partitions", async () => {
    const { bucket, store } = createStore();
    const scopes: readonly ArtifactScope[] = [
      privateScope,
      {
        ...privateScope,
        ownerParticipantId: "participant-b",
      },
      {
        ...privateScope,
        meetingId: "meeting-b",
      },
      {
        artifactId: "artifact-a",
        meetingId: "meeting-a",
        visibility: "shared",
      },
    ];

    await Promise.all(
      scopes.map((scope, index) =>
        store.put({
          bytes: new Uint8Array([index]),
          contentType: "application/octet-stream",
          hash: `sha256:${String(index)}`,
          scope,
        }),
      ),
    );

    expect([...bucket.objects.keys()].sort()).toEqual([
      "meetings/meeting-a/private/participant-a/artifact-a",
      "meetings/meeting-a/private/participant-b/artifact-a",
      "meetings/meeting-a/shared/artifact-a",
      "meetings/meeting-b/private/participant-a/artifact-a",
    ]);
    await expect(
      Promise.all(scopes.map((scope) => store.get(scope))),
    ).resolves.toEqual([
      new Uint8Array([0]),
      new Uint8Array([1]),
      new Uint8Array([2]),
      new Uint8Array([3]),
    ]);
  });

  it("rejects unsafe segments and inconsistent visibility scopes", async () => {
    const { store } = createStore();
    const unsafeScopes: readonly ArtifactScope[] = [
      { ...privateScope, meetingId: "../meeting" },
      { ...privateScope, artifactId: "folder/artifact" },
      { ...privateScope, ownerParticipantId: String.raw`participant\owner` },
      { ...privateScope, artifactId: "\0" },
      { ...privateScope, meetingId: "." },
    ];

    for (const scope of unsafeScopes) {
      await expect(
        store.put({
          bytes: new Uint8Array([1]),
          contentType: "text/plain",
          hash: "sha256:unsafe",
          scope,
        }),
      ).rejects.toThrow("safe path segment");
    }

    await expect(
      store.get({
        artifactId: "artifact-a",
        meetingId: "meeting-a",
        visibility: "private",
      }),
    ).rejects.toThrow("visibility and owner scope");
    await expect(
      store.delete({
        ...privateScope,
        visibility: "shared",
      }),
    ).rejects.toThrow("visibility and owner scope");
  });

  it("returns and persists artifact metadata", async () => {
    const { bucket, store } = createStore();
    const bytes = new Uint8Array([1, 2, 3, 4]);

    await expect(
      store.put({
        bytes,
        contentType: "application/pdf",
        hash: "sha256:fixture",
        scope: privateScope,
      }),
    ).resolves.toEqual({
      ...privateScope,
      contentType: "application/pdf",
      hash: "sha256:fixture",
      size: 4,
      storageReference: "meetings/meeting-a/private/participant-a/artifact-a",
    });

    expect(
      bucket.objects.get("meetings/meeting-a/private/participant-a/artifact-a"),
    ).toMatchObject({
      customMetadata: {
        hash: "sha256:fixture",
        size: "4",
        storageReference: "meetings/meeting-a/private/participant-a/artifact-a",
      },
      httpMetadata: {
        contentType: "application/pdf",
      },
    });
  });

  it("isolates stored and returned bytes from caller mutation", async () => {
    const { store } = createStore();
    const source = new Uint8Array([1, 2, 3]);

    await store.put({
      bytes: source,
      contentType: "text/plain",
      hash: "sha256:fixture",
      scope: privateScope,
    });
    source[0] = 99;

    const firstRead = await store.get(privateScope);
    expect(firstRead).toEqual(new Uint8Array([1, 2, 3]));
    if (firstRead === undefined) {
      throw new Error("Expected the stored artifact");
    }
    firstRead[1] = 88;

    await expect(store.get(privateScope)).resolves.toEqual(
      new Uint8Array([1, 2, 3]),
    );
  });

  it("returns undefined for missing objects and makes delete idempotent", async () => {
    const { store } = createStore();

    await expect(store.get(privateScope)).resolves.toBeUndefined();
    await expect(store.delete(privateScope)).resolves.toBeUndefined();

    await store.put({
      bytes: new Uint8Array([1]),
      contentType: "text/plain",
      hash: "sha256:fixture",
      scope: privateScope,
    });
    await store.delete(privateScope);

    await expect(store.get(privateScope)).resolves.toBeUndefined();
    await expect(store.delete(privateScope)).resolves.toBeUndefined();
  });
});
