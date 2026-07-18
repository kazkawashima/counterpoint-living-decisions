import { mkdtemp, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createJsonCodec,
  LocalArtifactStore,
  NodeSqliteDatabase,
  SqliteEventStore,
  SqliteProjectionStore,
  type JsonCodec,
} from "@counterpoint/adapters-node";
import { afterEach, describe, expect, it } from "vitest";

import { artifactStoreContract } from "./artifact-store-contract.js";
import { eventStoreContract } from "./event-store-contract.js";
import { projectionStoreContract } from "./projection-store-contract.js";

interface FixtureEvent {
  readonly type: string;
  readonly value: string;
}

interface FixtureProjection {
  readonly label: string;
}

function fixtureEventCodec(): JsonCodec<FixtureEvent> {
  return createJsonCodec((input) => {
    if (
      typeof input !== "object" ||
      input === null ||
      !("type" in input) ||
      typeof input.type !== "string" ||
      !("value" in input) ||
      typeof input.value !== "string"
    ) {
      throw new TypeError("Invalid fixture event");
    }
    return { type: input.type, value: input.value };
  });
}

function fixtureProjectionCodec(): JsonCodec<FixtureProjection> {
  return createJsonCodec((input) => {
    if (
      typeof input !== "object" ||
      input === null ||
      !("label" in input) ||
      typeof input.label !== "string"
    ) {
      throw new TypeError("Invalid fixture projection");
    }
    return { label: input.label };
  });
}

const temporaryDirectories: string[] = [];
const databases: NodeSqliteDatabase[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(
    join(tmpdir(), "counterpoint-sqlite-contract-"),
  );
  temporaryDirectories.push(directory);
  return directory;
}

async function database(): Promise<NodeSqliteDatabase> {
  const directory = await temporaryDirectory();
  const owner = new NodeSqliteDatabase(join(directory, "counterpoint.sqlite"));
  databases.push(owner);
  return owner;
}

afterEach(async () => {
  for (const owner of databases.splice(0)) {
    owner.close();
  }
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { force: true, recursive: true });
  }
});

describe("SQLite and local-file port adapters", () => {
  it("satisfies the reusable event-store contract", async () => {
    const owner = await database();
    await eventStoreContract(
      () => new SqliteEventStore(owner, fixtureEventCodec()),
    );
  });

  it("satisfies the reusable projection-store contract", async () => {
    const owner = await database();
    await projectionStoreContract(
      () => new SqliteProjectionStore(owner, fixtureProjectionCodec()),
    );
  });

  it("satisfies the reusable artifact-store contract", async () => {
    const directory = await temporaryDirectory();
    await artifactStoreContract(
      () => new LocalArtifactStore(join(directory, "artifacts")),
    );
  });

  it("appends batches monotonically and resumes after a position", async () => {
    const owner = await database();
    const store = new SqliteEventStore(owner, fixtureEventCodec());

    await expect(
      store.append({
        events: [
          { type: "Created", value: "one" },
          { type: "Updated", value: "two" },
        ],
        expectedPosition: 0,
        meetingId: "meeting-a",
      }),
    ).resolves.toMatchObject({
      kind: "appended",
      records: [{ position: 1 }, { position: 2 }],
    });

    await expect(
      store.load("meeting-a", { afterPosition: 1 }),
    ).resolves.toEqual([
      {
        event: { type: "Updated", value: "two" },
        position: 2,
      },
    ]);
  });

  it("rejects same-fingerprint idempotency reuse with different payload", async () => {
    const owner = await database();
    const store = new SqliteEventStore(owner, fixtureEventCodec());
    await store.append({
      events: [{ type: "Created", value: "one" }],
      idempotencyKey: "request-1",
      meetingId: "meeting-a",
      payloadFingerprint: "caller-fingerprint",
    });

    await expect(
      store.append({
        events: [{ type: "Created", value: "different" }],
        idempotencyKey: "request-1",
        meetingId: "meeting-a",
        payloadFingerprint: "caller-fingerprint",
      }),
    ).resolves.toEqual({
      idempotencyKey: "request-1",
      kind: "idempotency_conflict",
    });
    await expect(store.position("meeting-a")).resolves.toBe(1);
  });

  it("rolls back a partially inserted batch when SQLite rejects a payload", async () => {
    const owner = await database();
    const validCodec = fixtureEventCodec();
    const invalidSecondCodec: JsonCodec<FixtureEvent> = {
      decode: (serialized) => validCodec.decode(serialized),
      encode(value) {
        return value.value === "invalid"
          ? "not valid json"
          : JSON.stringify(value);
      },
    };
    const store = new SqliteEventStore(owner, invalidSecondCodec);

    await expect(
      store.append({
        events: [
          { type: "Created", value: "valid" },
          { type: "Updated", value: "invalid" },
        ],
        idempotencyKey: "request-rollback",
        meetingId: "meeting-a",
      }),
    ).rejects.toThrow();
    await expect(store.load("meeting-a")).resolves.toEqual([]);
    await expect(store.position("meeting-a")).resolves.toBe(0);
  });

  it("uses exact shared and private artifact partitions with atomic files", async () => {
    const directory = await temporaryDirectory();
    const root = join(directory, "artifacts");
    const store = new LocalArtifactStore(root);

    const privateMetadata = await store.put({
      bytes: new Uint8Array([1]),
      contentType: "text/plain",
      hash: "sha256:private",
      scope: {
        artifactId: "artifact-private",
        meetingId: "meeting-a",
        ownerParticipantId: "participant-a",
        visibility: "private",
      },
    });
    const sharedMetadata = await store.put({
      bytes: new Uint8Array([2]),
      contentType: "text/plain",
      hash: "sha256:shared",
      scope: {
        artifactId: "artifact-shared",
        meetingId: "meeting-a",
        visibility: "shared",
      },
    });

    expect(privateMetadata.storageReference).toBe(
      "meetings/meeting-a/private/participant-a/artifact-private",
    );
    expect(sharedMetadata.storageReference).toBe(
      "meetings/meeting-a/shared/artifact-shared",
    );
    await expect(
      readdir(join(root, "meetings/meeting-a/private/participant-a")),
    ).resolves.toEqual(["artifact-private"]);
  });

  it("rejects traversal segments and symlinked partitions", async () => {
    const directory = await temporaryDirectory();
    const root = join(directory, "artifacts");
    const store = new LocalArtifactStore(root);

    await expect(
      store.put({
        bytes: new Uint8Array([1]),
        contentType: "text/plain",
        hash: "sha256:invalid",
        scope: {
          artifactId: "../outside",
          meetingId: "meeting-a",
          visibility: "shared",
        },
      }),
    ).rejects.toThrow("safe path segment");

    await store.put({
      bytes: new Uint8Array([1]),
      contentType: "text/plain",
      hash: "sha256:fixture",
      scope: {
        artifactId: "fixture",
        meetingId: "meeting-a",
        visibility: "shared",
      },
    });
    await rm(join(root, "meetings/meeting-a/shared"), {
      force: true,
      recursive: true,
    });
    await symlink(directory, join(root, "meetings/meeting-a/shared"));

    await expect(
      store.get({
        artifactId: "outside",
        meetingId: "meeting-a",
        visibility: "shared",
      }),
    ).rejects.toThrow("safe directory");
  });
});
