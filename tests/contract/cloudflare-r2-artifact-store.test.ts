/// <reference types="@cloudflare/workers-types" />

import { describe, it } from "vitest";

import { R2ArtifactStore } from "@counterpoint/adapters-cloudflare";

import { artifactStoreContract } from "./artifact-store-contract.js";

class FakeR2Bucket {
  readonly #objects = new Map<string, Uint8Array>();

  delete(key: string): Promise<void> {
    this.#objects.delete(key);
    return Promise.resolve();
  }

  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null> {
    const bytes = this.#objects.get(key);
    if (bytes === undefined) {
      return Promise.resolve(null);
    }

    return Promise.resolve({
      arrayBuffer: () => Promise.resolve(bytes.slice().buffer),
    });
  }

  put(key: string, value: ArrayBufferView): Promise<void> {
    this.#objects.set(
      key,
      new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice(),
    );
    return Promise.resolve();
  }
}

describe("R2ArtifactStore contract", () => {
  it("satisfies the reusable artifact-store contract", async () => {
    await artifactStoreContract(
      () => new R2ArtifactStore(new FakeR2Bucket() as unknown as R2Bucket),
    );
  });
});
