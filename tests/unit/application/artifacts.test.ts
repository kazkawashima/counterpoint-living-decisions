import { describe, expect, it, vi } from "vitest";

import {
  ARTIFACT_MAX_FILE_BYTES,
  ARTIFACT_MAX_MEETING_BYTES,
  getPrivateArtifact,
  registerPrivateUrlArtifact,
  uploadPrivateArtifact,
  type ArtifactIngestionDependencies,
  type UploadPrivateArtifactInput,
  type UrlArtifactIngestionDependencies,
} from "../../../packages/application/src/artifacts.js";
import { userAuthorizationContext } from "../../../packages/application/src/sessions.js";
import {
  artifactId,
  contentHash,
  correlationId,
  createSourceArtifact,
  eventId,
  meetingId,
  meetingPosition,
  nonEmptyText,
  participantId,
  revisionNumber,
  schemaVersion,
  timestamp,
  type DomainEvent,
  type EventOf,
  type MeetingProjection,
} from "../../../packages/domain/src/index.js";
import type {
  ArtifactTextExtractor,
  UrlFetcher,
} from "../../../packages/ports/src/index.js";
import {
  MutableClock,
  SequenceIdGenerator,
} from "../../helpers/application-adapters.js";
import {
  InMemoryArtifactStore,
  InMemoryEventStore,
  InMemoryProjectionStore,
} from "../../helpers/in-memory-ports.js";

const MEETING_ID = "meeting-artifact-ingestion";
const OTHER_MEETING_ID = "meeting-other";
const OWNER_ID = "participant-legal";
const OTHER_OWNER_ID = "participant-product";
const NOW = "2026-07-19T06:07:08.000Z";
const SOURCE_BYTES = new TextEncoder().encode(
  "# Synthetic launch plan\n\nKeep the rollback gate explicit.",
);
const DERIVED_TEXT = "Synthetic launch plan\nKeep the rollback gate explicit.";

function fixtureHash(bytes: Uint8Array): string {
  return `sha256:${Buffer.from(bytes).toString("base64url")}`;
}

function ownerContext(meetingScope = MEETING_ID) {
  return userAuthorizationContext({
    meetingId: meetingScope,
    participantId: OWNER_ID,
    role: "participant",
    sessionId: `session-owner-${meetingScope}`,
    userId: "user-owner",
  });
}

function otherOwnerContext() {
  return userAuthorizationContext({
    meetingId: MEETING_ID,
    participantId: OTHER_OWNER_ID,
    role: "participant",
    sessionId: "session-other-owner",
    userId: "user-other-owner",
  });
}

function fixture(): {
  readonly dependencies: ArtifactIngestionDependencies;
  readonly extractor: ReturnType<
    typeof vi.fn<ArtifactTextExtractor["extract"]>
  >;
} {
  const extractor = vi
    .fn<ArtifactTextExtractor["extract"]>()
    .mockResolvedValue({
      content: DERIVED_TEXT,
      contentType: "text/plain; charset=utf-8",
    });
  return {
    dependencies: {
      artifacts: new InMemoryArtifactStore(),
      clock: new MutableClock(NOW),
      events: new InMemoryEventStore<DomainEvent>(),
      extractor: { extract: extractor },
      hashBytes: fixtureHash,
      ids: new SequenceIdGenerator(),
      projections: new InMemoryProjectionStore<MeetingProjection>(),
    },
    extractor,
  };
}

function urlFixture(): {
  readonly dependencies: UrlArtifactIngestionDependencies;
  readonly fetchUrl: ReturnType<typeof vi.fn<UrlFetcher["fetch"]>>;
} {
  const base = fixture();
  const fetchUrl = vi.fn<UrlFetcher["fetch"]>().mockResolvedValue({
    bytes: SOURCE_BYTES,
    contentType: "text/markdown",
    filename: "synthetic-launch-plan.md",
    kind: "fetched",
  });
  return {
    dependencies: {
      ...base.dependencies,
      urls: { fetch: fetchUrl },
    },
    fetchUrl,
  };
}

function uploadInput(
  overrides: Partial<UploadPrivateArtifactInput> = {},
): UploadPrivateArtifactInput {
  return {
    bytes: SOURCE_BYTES,
    contentType: "text/markdown",
    expectedPosition: 0,
    filename: "synthetic-launch-plan.md",
    idempotencyKey: "upload-synthetic-plan",
    meetingId: MEETING_ID,
    ...overrides,
  };
}

function seededRegistration(
  index: number,
  sizeBytes: number,
): EventOf<"ArtifactRegistered"> {
  const position = index + 1;
  return {
    actor: {
      kind: "participant",
      participantId: participantId(OWNER_ID),
    },
    correlationId: correlationId(`seed-correlation-${String(position)}`),
    eventId: eventId(`seed-artifact-event-${String(position)}`),
    eventType: "ArtifactRegistered",
    meetingId: meetingId(MEETING_ID),
    occurredAt: timestamp(NOW),
    ownerParticipantId: participantId(OWNER_ID),
    payload: {
      artifact: createSourceArtifact({
        artifactType: "document",
        confirmationStatus: "not_applicable",
        contentHash: contentHash(`sha256:c2VlZC0${String(position)}`),
        contentType: nonEmptyText("text/markdown"),
        createdAt: timestamp(NOW),
        createdBy: participantId(OWNER_ID),
        id: artifactId(`seed-artifact-${String(position)}`),
        meetingId: meetingId(MEETING_ID),
        origin: "source_artifact",
        originalFilename: nonEmptyText(`seed-${String(position)}.md`),
        ownerParticipantId: participantId(OWNER_ID),
        processingState: "processed",
        revision: revisionNumber(1),
        sizeBytes,
        storageReference: nonEmptyText(`seed/${String(position)}`),
        visibility: "private",
      }),
    },
    position: meetingPosition(position),
    schemaVersion: schemaVersion(1),
    visibility: "private",
  };
}

async function seedRegistrations(
  dependencies: ArtifactIngestionDependencies,
  sizes: readonly number[],
): Promise<void> {
  const appended = await dependencies.events.append({
    events: sizes.map((size, index) => seededRegistration(index, size)),
    expectedPosition: 0,
    meetingId: MEETING_ID,
  });
  expect(appended.kind).toBe("appended");
}

describe("private artifact application invariants", () => {
  it("fetches a normalized URL into the same owner-private source and derived pipeline", async () => {
    const { dependencies, fetchUrl } = urlFixture();

    const result = await registerPrivateUrlArtifact(
      dependencies,
      ownerContext(),
      {
        idempotencyKey: "register-synthetic-url",
        meetingId: MEETING_ID,
        url: "https://public.example/synthetic-launch-plan.md#private-view",
      },
    );

    expect(result).toMatchObject({
      artifact: {
        filename: "synthetic-launch-plan.md",
        ingestionMethod: "url",
        processingState: "processed",
      },
      kind: "registered",
      position: 2,
      replayed: false,
    });
    expect(fetchUrl).toHaveBeenCalledWith({
      url: "https://public.example/synthetic-launch-plan.md",
    });
    const records = await dependencies.events.load(MEETING_ID);
    expect(records[0]?.event).toMatchObject({
      eventType: "ArtifactRegistered",
      payload: {
        artifact: {
          artifactType: "url",
          sourceLocatorHash: fixtureHash(
            new TextEncoder().encode(
              "https://public.example/synthetic-launch-plan.md",
            ),
          ),
        },
      },
    });
    const serialized = JSON.stringify(records);
    expect(serialized).not.toContain("public.example");
    expect(serialized).not.toContain("private-view");
  });

  it("replays the same URL without a second network fetch and rejects a changed locator", async () => {
    const { dependencies, fetchUrl } = urlFixture();
    const input = {
      idempotencyKey: "register-synthetic-url-replay",
      meetingId: MEETING_ID,
      url: "https://public.example/synthetic-launch-plan.md",
    } as const;

    const first = await registerPrivateUrlArtifact(
      dependencies,
      ownerContext(),
      input,
    );
    const replay = await registerPrivateUrlArtifact(
      dependencies,
      ownerContext(),
      input,
    );
    const conflict = await registerPrivateUrlArtifact(
      dependencies,
      ownerContext(),
      {
        ...input,
        url: "https://other.example/synthetic-launch-plan.md",
      },
    );

    expect(first.kind).toBe("registered");
    expect(replay).toMatchObject({
      kind: "registered",
      replayed: true,
    });
    expect(conflict).toEqual({
      code: "IDEMPOTENCY_CONFLICT",
      kind: "failed",
    });
    expect(fetchUrl).toHaveBeenCalledOnce();
  });

  it("maps every safe-fetch refusal to one content-free URL_BLOCKED result", async () => {
    const { dependencies, fetchUrl } = urlFixture();
    fetchUrl.mockResolvedValue({
      kind: "failed",
      reason: "unsafe_destination",
    });
    const put = vi.spyOn(dependencies.artifacts, "put");

    const result = await registerPrivateUrlArtifact(
      dependencies,
      ownerContext(),
      {
        idempotencyKey: "register-blocked-url",
        meetingId: MEETING_ID,
        url: "http://metadata.invalid/latest",
      },
    );

    expect(result).toEqual({ code: "URL_BLOCKED", kind: "failed" });
    expect(JSON.stringify(result)).not.toContain("metadata");
    expect(put).not.toHaveBeenCalled();
    expect(await dependencies.events.load(MEETING_ID)).toEqual([]);
  });

  it("checks authorization and owner capacity before any outbound URL request", async () => {
    const { dependencies, fetchUrl } = urlFixture();
    const input = {
      idempotencyKey: "register-prefetch-gate-url",
      meetingId: MEETING_ID,
      url: "https://public.example/synthetic-launch-plan.md",
    } as const;

    expect(
      await registerPrivateUrlArtifact(
        dependencies,
        ownerContext(OTHER_MEETING_ID),
        input,
      ),
    ).toEqual({ code: "FORBIDDEN", kind: "failed" });
    await seedRegistrations(
      dependencies,
      Array.from({ length: 10 }, () => 1),
    );
    expect(
      await registerPrivateUrlArtifact(dependencies, ownerContext(), input),
    ).toEqual({ code: "ARTIFACT_TOO_LARGE", kind: "failed" });
    expect(fetchUrl).not.toHaveBeenCalled();
  });

  it("stores distinct source and derived markdown artifacts and projects their metadata", async () => {
    const { dependencies, extractor } = fixture();

    const result = await uploadPrivateArtifact(
      dependencies,
      ownerContext(),
      uploadInput(),
    );

    expect(result).toMatchObject({
      kind: "registered",
      position: 2,
      replayed: false,
      artifact: {
        contentType: "text/markdown",
        derivedContentHash: fixtureHash(new TextEncoder().encode(DERIVED_TEXT)),
        derivedSizeBytes: new TextEncoder().encode(DERIVED_TEXT).byteLength,
        filename: "synthetic-launch-plan.md",
        ingestionMethod: "upload",
        processingState: "processed",
        sizeBytes: SOURCE_BYTES.byteLength,
        sourceContentHash: fixtureHash(SOURCE_BYTES),
      },
    });
    if (result.kind !== "registered") {
      throw new Error(`Upload fixture failed: ${result.code}`);
    }
    expect(result.artifact.derivedArtifactId).toBeDefined();
    expect(result.artifact.derivedArtifactId).not.toBe(
      result.artifact.sourceArtifactId,
    );
    expect(extractor).toHaveBeenCalledOnce();

    const records = await dependencies.events.load(MEETING_ID);
    expect(records.map(({ event }) => event.eventType)).toEqual([
      "ArtifactRegistered",
      "ArtifactProcessed",
    ]);
    expect(records[0]?.event).toMatchObject({
      eventType: "ArtifactRegistered",
      payload: {
        artifact: {
          contentHash: fixtureHash(SOURCE_BYTES),
          processingState: "processing",
        },
      },
    });
    expect(records[1]?.event).toMatchObject({
      eventType: "ArtifactProcessed",
      payload: {
        artifactId: result.artifact.sourceArtifactId,
        contentHash: result.artifact.derivedContentHash,
        derivedArtifactId: result.artifact.derivedArtifactId,
        derivedSizeBytes: result.artifact.derivedSizeBytes,
        processingState: "processed",
      },
    });

    const projection = await dependencies.projections.get({
      meetingId: MEETING_ID,
      ownerParticipantId: OWNER_ID,
      projection: "meeting",
    });
    expect(projection?.privateWorkspaces[0]?.artifacts).toEqual([
      expect.objectContaining({
        contentHash: fixtureHash(SOURCE_BYTES),
        derivedArtifactId: result.artifact.derivedArtifactId,
        derivedContentHash: result.artifact.derivedContentHash,
        derivedSizeBytes: result.artifact.derivedSizeBytes,
        processingState: "processed",
      }),
    ]);

    const source = await getPrivateArtifact(dependencies, ownerContext(), {
      artifactId: result.artifact.sourceArtifactId,
      meetingId: MEETING_ID,
      representation: "source",
    });
    const derived = await getPrivateArtifact(dependencies, ownerContext(), {
      artifactId: result.artifact.sourceArtifactId,
      meetingId: MEETING_ID,
      representation: "derived",
    });
    expect(source).toMatchObject({
      contentType: "text/markdown",
      filename: "synthetic-launch-plan.md",
      kind: "found",
    });
    expect(derived).toMatchObject({
      contentType: "text/plain; charset=utf-8",
      filename: "synthetic-launch-plan.md.txt",
      kind: "found",
    });
    expect(source.kind === "found" ? source.bytes : undefined).toEqual(
      SOURCE_BYTES,
    );
    expect(derived.kind === "found" ? derived.bytes : undefined).toEqual(
      new TextEncoder().encode(DERIVED_TEXT),
    );
  });

  it("replays the exact command without extracting again and conflicts on changed bytes", async () => {
    const { dependencies, extractor } = fixture();
    const input = uploadInput();
    const first = await uploadPrivateArtifact(
      dependencies,
      ownerContext(),
      input,
    );
    const replay = await uploadPrivateArtifact(
      dependencies,
      ownerContext(),
      input,
    );

    expect(first.kind).toBe("registered");
    expect(replay.kind).toBe("registered");
    if (first.kind !== "registered" || replay.kind !== "registered") {
      throw new Error("Expected successful artifact registration and replay");
    }
    expect(replay).toMatchObject({
      artifact: {
        derivedArtifactId: first.artifact.derivedArtifactId,
        sourceArtifactId: first.artifact.sourceArtifactId,
      },
      correlationId: first.correlationId,
      position: first.position,
      replayed: true,
    });
    expect(extractor).toHaveBeenCalledOnce();
    expect(await dependencies.events.load(MEETING_ID)).toHaveLength(2);

    const conflict = await uploadPrivateArtifact(
      dependencies,
      ownerContext(),
      uploadInput({
        bytes: new TextEncoder().encode("# Changed payload"),
      }),
    );
    expect(conflict).toEqual({
      code: "IDEMPOTENCY_CONFLICT",
      kind: "failed",
    });
    expect(extractor).toHaveBeenCalledOnce();
    expect(await dependencies.events.load(MEETING_ID)).toHaveLength(2);
  });

  it.each([
    {
      expectedCode: "ARTIFACT_TYPE_UNSUPPORTED",
      input: uploadInput({
        contentType: "text/csv",
        filename: "synthetic-plan.csv",
      }),
      label: "unsupported type",
    },
    {
      expectedCode: "ARTIFACT_TOO_LARGE",
      input: uploadInput({
        bytes: new Uint8Array(ARTIFACT_MAX_FILE_BYTES + 1),
      }),
      label: "file over 20 MB",
    },
  ] as const)(
    "rejects $label before extraction, event append, or artifact storage",
    async ({ expectedCode, input }) => {
      const { dependencies, extractor } = fixture();
      const put = vi.spyOn(dependencies.artifacts, "put");

      expect(
        await uploadPrivateArtifact(dependencies, ownerContext(), input),
      ).toEqual({
        code: expectedCode,
        kind: "failed",
      });
      expect(extractor).not.toHaveBeenCalled();
      expect(put).not.toHaveBeenCalled();
      expect(await dependencies.events.load(MEETING_ID)).toEqual([]);
    },
  );

  it("enforces the 10-item owner cap without writing the rejected item", async () => {
    const { dependencies, extractor } = fixture();
    await seedRegistrations(
      dependencies,
      Array.from({ length: 10 }, () => 1),
    );
    const put = vi.spyOn(dependencies.artifacts, "put");

    expect(
      await uploadPrivateArtifact(
        dependencies,
        ownerContext(),
        uploadInput({
          expectedPosition: 10,
          idempotencyKey: "upload-owner-item-11",
        }),
      ),
    ).toEqual({
      code: "ARTIFACT_TOO_LARGE",
      kind: "failed",
    });
    expect(extractor).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
    expect(await dependencies.events.load(MEETING_ID)).toHaveLength(10);
  });

  it("enforces the 100 MB meeting aggregate cap using event-only fixtures", async () => {
    const { dependencies, extractor } = fixture();
    await seedRegistrations(
      dependencies,
      Array.from({ length: 5 }, () => ARTIFACT_MAX_FILE_BYTES),
    );
    expect(5 * ARTIFACT_MAX_FILE_BYTES).toBe(ARTIFACT_MAX_MEETING_BYTES);
    const put = vi.spyOn(dependencies.artifacts, "put");

    expect(
      await uploadPrivateArtifact(
        dependencies,
        ownerContext(),
        uploadInput({
          bytes: new Uint8Array([1]),
          expectedPosition: 5,
          idempotencyKey: "upload-meeting-byte-over-cap",
        }),
      ),
    ).toEqual({
      code: "ARTIFACT_TOO_LARGE",
      kind: "failed",
    });
    expect(extractor).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
    expect(await dependencies.events.load(MEETING_ID)).toHaveLength(5);
  });

  it("records a safe failed state and retains only the source when extraction fails", async () => {
    const { dependencies, extractor } = fixture();
    extractor.mockRejectedValue(
      new Error("Sensitive parser detail: /tmp/private-upload.md"),
    );
    const put = vi.spyOn(dependencies.artifacts, "put");

    const result = await uploadPrivateArtifact(
      dependencies,
      ownerContext(),
      uploadInput(),
    );

    expect(result).toMatchObject({
      artifact: {
        failureCode: "ARTIFACT_PROCESSING_FAILED",
        processingState: "failed",
      },
      kind: "registered",
    });
    if (result.kind !== "registered") {
      throw new Error(`Upload fixture failed: ${result.code}`);
    }
    expect(result.artifact.derivedArtifactId).toBeUndefined();
    expect(put).toHaveBeenCalledOnce();
    const records = await dependencies.events.load(MEETING_ID);
    expect(records.map(({ event }) => event.eventType)).toEqual([
      "ArtifactRegistered",
      "ArtifactProcessed",
    ]);
    expect(records[1]?.event).toMatchObject({
      eventType: "ArtifactProcessed",
      payload: {
        artifactId: result.artifact.sourceArtifactId,
        failureCode: "ARTIFACT_PROCESSING_FAILED",
        processingState: "failed",
      },
    });
    expect(JSON.stringify(records)).not.toContain("Sensitive parser detail");
    expect(
      await getPrivateArtifact(dependencies, ownerContext(), {
        artifactId: result.artifact.sourceArtifactId,
        meetingId: MEETING_ID,
        representation: "source",
      }),
    ).toMatchObject({ kind: "found" });
    expect(
      await getPrivateArtifact(dependencies, ownerContext(), {
        artifactId: result.artifact.sourceArtifactId,
        meetingId: MEETING_ID,
        representation: "derived",
      }),
    ).toEqual({ code: "FORBIDDEN", kind: "failed" });
  });

  it("fails closed for another owner and cross-meeting reads while preserving owner downloads", async () => {
    const { dependencies } = fixture();
    const result = await uploadPrivateArtifact(
      dependencies,
      ownerContext(),
      uploadInput(),
    );
    if (result.kind !== "registered") {
      throw new Error(`Upload fixture failed: ${result.code}`);
    }

    for (const representation of ["source", "derived"] as const) {
      const ownerRead = await getPrivateArtifact(dependencies, ownerContext(), {
        artifactId: result.artifact.sourceArtifactId,
        meetingId: MEETING_ID,
        representation,
      });
      expect(ownerRead.kind).toBe("found");

      expect(
        await getPrivateArtifact(dependencies, otherOwnerContext(), {
          artifactId: result.artifact.sourceArtifactId,
          meetingId: MEETING_ID,
          representation,
        }),
      ).toEqual({ code: "FORBIDDEN", kind: "failed" });
      expect(
        await getPrivateArtifact(dependencies, ownerContext(OTHER_MEETING_ID), {
          artifactId: result.artifact.sourceArtifactId,
          meetingId: OTHER_MEETING_ID,
          representation,
        }),
      ).toEqual({ code: "FORBIDDEN", kind: "failed" });
    }
  });
});
