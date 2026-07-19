/// <reference types="@cloudflare/workers-types" />

import type {
  ArtifactMetadata,
  ArtifactScope,
  ArtifactStore,
  ArtifactWrite,
} from "@counterpoint/ports";

function validateSegment(value: string, label: string): void {
  if (
    value.length === 0 ||
    value === "." ||
    value === ".." ||
    value.includes("/") ||
    value.includes("\\") ||
    value.includes("\0")
  ) {
    throw new TypeError(`${label} is not a safe path segment`);
  }
}

function artifactKey(scope: ArtifactScope): string {
  validateSegment(scope.meetingId, "meetingId");
  validateSegment(scope.artifactId, "artifactId");

  if (scope.visibility === "shared") {
    if (scope.ownerParticipantId !== undefined) {
      throw new Error("Artifact visibility and owner scope do not agree");
    }
    return `meetings/${scope.meetingId}/shared/${scope.artifactId}`;
  }

  if (scope.ownerParticipantId === undefined) {
    throw new Error("Artifact visibility and owner scope do not agree");
  }
  validateSegment(scope.ownerParticipantId, "ownerParticipantId");
  return `meetings/${scope.meetingId}/private/${scope.ownerParticipantId}/${scope.artifactId}`;
}

export class R2ArtifactStore implements ArtifactStore {
  readonly #bucket: R2Bucket;

  constructor(bucket: R2Bucket) {
    this.#bucket = bucket;
  }

  async delete(scope: ArtifactScope): Promise<void> {
    await this.#bucket.delete(artifactKey(scope));
  }

  async get(scope: ArtifactScope): Promise<Uint8Array | undefined> {
    const object = await this.#bucket.get(artifactKey(scope));
    if (object === null) {
      return undefined;
    }

    return new Uint8Array(await object.arrayBuffer()).slice();
  }

  async put(write: ArtifactWrite): Promise<ArtifactMetadata> {
    const storageReference = artifactKey(write.scope);
    const bytes = write.bytes.slice();
    const size = bytes.byteLength;

    await this.#bucket.put(storageReference, bytes, {
      customMetadata: {
        hash: write.hash,
        size: String(size),
        storageReference,
      },
      httpMetadata: {
        contentType: write.contentType,
      },
    });

    return {
      ...write.scope,
      contentType: write.contentType,
      hash: write.hash,
      size,
      storageReference,
    };
  }
}
