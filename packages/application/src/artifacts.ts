import {
  DomainValueError,
  artifactId,
  causationId,
  contentHash,
  correlationId,
  createSourceArtifact,
  eventId,
  idempotencyKey,
  meetingId,
  meetingPosition,
  nonEmptyText,
  participantId,
  replayMeeting,
  revisionNumber,
  schemaVersion,
  timestamp,
  type DomainEvent,
  type EventOf,
  type MeetingProjection,
} from "@counterpoint/domain";
import type {
  ArtifactStore,
  ArtifactTextExtractor,
  Clock,
  EventRecord,
  EventStore,
  IdGenerator,
  ProjectionStore,
} from "@counterpoint/ports";

import { authorize, type UserAuthorizationContext } from "./authorization.js";

export const ARTIFACT_MAX_FILE_BYTES = 20 * 1024 * 1024;
export const ARTIFACT_MAX_OWNER_ITEMS = 10;
export const ARTIFACT_MAX_MEETING_BYTES = 100 * 1024 * 1024;

const DERIVED_CONTENT_TYPE = "text/plain; charset=utf-8";
const MEETING_PROJECTION = "meeting";

export type ArtifactByteHashFunction =
  | ((bytes: Uint8Array) => Promise<string> | string)
  | {
      hash(bytes: Uint8Array): Promise<string> | string;
    };

export interface ArtifactIngestionDependencies {
  readonly artifacts: ArtifactStore;
  readonly clock: Clock;
  readonly events: EventStore<DomainEvent>;
  readonly extractor: ArtifactTextExtractor;
  readonly hashBytes: ArtifactByteHashFunction;
  readonly ids: IdGenerator;
  readonly projections: ProjectionStore<MeetingProjection>;
}

export interface UploadPrivateArtifactInput {
  readonly bytes: Uint8Array;
  readonly contentType: string;
  readonly correlationId?: string;
  readonly expectedPosition: number;
  readonly filename: string;
  readonly idempotencyKey: string;
  readonly meetingId: string;
}

export interface PrivateArtifactView {
  readonly contentType: string;
  readonly createdAt: string;
  readonly derivedArtifactId?: string;
  readonly derivedContentHash?: string;
  readonly derivedSizeBytes?: number;
  readonly failureCode?: string;
  readonly filename: string;
  readonly processingState: "failed" | "processed";
  readonly sizeBytes: number;
  readonly sourceArtifactId: string;
  readonly sourceContentHash: string;
}

export type ArtifactIngestionFailure =
  | {
      readonly actualPosition: number;
      readonly code: "CONFLICT";
      readonly expectedPosition: number;
      readonly kind: "failed";
    }
  | {
      readonly code:
        | "ARTIFACT_TOO_LARGE"
        | "ARTIFACT_TYPE_UNSUPPORTED"
        | "FORBIDDEN"
        | "IDEMPOTENCY_CONFLICT"
        | "VALIDATION_FAILED";
      readonly kind: "failed";
    };

export type UploadPrivateArtifactResult =
  | {
      readonly artifact: PrivateArtifactView;
      readonly correlationId: string;
      readonly kind: "registered";
      readonly position: number;
      readonly replayed: boolean;
    }
  | ArtifactIngestionFailure;

export type GetPrivateArtifactResult =
  | {
      readonly bytes: Uint8Array;
      readonly contentType: string;
      readonly filename: string;
      readonly kind: "found";
    }
  | {
      readonly code: "FORBIDDEN";
      readonly kind: "failed";
    };

function failed(
  code: Exclude<ArtifactIngestionFailure["code"], "CONFLICT">,
): ArtifactIngestionFailure {
  return { code, kind: "failed" };
}

function normalizeRecords(
  records: readonly EventRecord<DomainEvent>[],
): readonly DomainEvent[] {
  return records.map(({ event, position }) => ({
    ...event,
    position: meetingPosition(position),
  }));
}

function extensionOf(filename: string): string | undefined {
  const index = filename.lastIndexOf(".");
  return index <= 0 || index === filename.length - 1
    ? undefined
    : filename.slice(index).toLowerCase();
}

function canonicalContentType(
  filename: string,
  claimedContentType: string,
): string | undefined {
  const extension = extensionOf(filename);
  const claimed = claimedContentType.toLowerCase().split(";", 1)[0]?.trim();
  switch (extension) {
    case ".pdf":
      return claimed === "application/pdf" ? "application/pdf" : undefined;
    case ".md":
    case ".markdown":
      return claimed === "text/markdown" || claimed === "text/plain"
        ? "text/markdown"
        : undefined;
    case ".txt":
      return claimed === "text/plain" ? "text/plain" : undefined;
    case ".json":
      return claimed === "application/json" ? "application/json" : undefined;
    default:
      return undefined;
  }
}

async function hashBytes(
  hash: ArtifactByteHashFunction,
  bytes: Uint8Array,
): Promise<string> {
  const result =
    typeof hash === "function" ? await hash(bytes) : await hash.hash(bytes);
  if (
    result.length === 0 ||
    result.length > 512 ||
    result.trim() !== result ||
    /\s/u.test(result)
  ) {
    throw new DomainValueError(
      "Injected artifact hash must be a non-empty, whitespace-free value",
    );
  }
  return result;
}

function processedEventFor(
  events: readonly DomainEvent[],
  sourceArtifactId: string,
): EventOf<"ArtifactProcessed"> | undefined {
  return events.find(
    (event): event is EventOf<"ArtifactProcessed"> =>
      event.eventType === "ArtifactProcessed" &&
      event.payload.artifactId === sourceArtifactId,
  );
}

function artifactView(
  registered: EventOf<"ArtifactRegistered">,
  processed: EventOf<"ArtifactProcessed"> | undefined,
): PrivateArtifactView {
  const artifact = registered.payload.artifact;
  return {
    contentType: artifact.contentType ?? "application/octet-stream",
    createdAt: registered.occurredAt,
    ...(processed?.payload.derivedArtifactId === undefined
      ? {}
      : { derivedArtifactId: processed.payload.derivedArtifactId }),
    ...(processed?.payload.contentHash === undefined
      ? {}
      : { derivedContentHash: processed.payload.contentHash }),
    ...(processed?.payload.derivedSizeBytes === undefined
      ? {}
      : { derivedSizeBytes: processed.payload.derivedSizeBytes }),
    ...(processed?.payload.failureCode === undefined
      ? {}
      : { failureCode: processed.payload.failureCode }),
    filename: artifact.originalFilename ?? "artifact",
    processingState:
      processed?.payload.processingState === "processed"
        ? "processed"
        : "failed",
    sizeBytes: artifact.sizeBytes,
    sourceArtifactId: artifact.id,
    sourceContentHash: artifact.contentHash,
  };
}

async function refreshProjection(
  dependencies: ArtifactIngestionDependencies,
  meetingScope: string,
  ownerParticipantId: string,
): Promise<void> {
  const records = await dependencies.events.load(meetingScope);
  const projection = replayMeeting(
    meetingId(meetingScope),
    normalizeRecords(records),
  );
  await dependencies.projections.put(
    {
      meetingId: meetingScope,
      ownerParticipantId,
      projection: MEETING_PROJECTION,
    },
    projection,
  );
}

export async function uploadPrivateArtifact(
  dependencies: ArtifactIngestionDependencies,
  context: UserAuthorizationContext,
  input: UploadPrivateArtifactInput,
): Promise<UploadPrivateArtifactResult> {
  const authorized = authorize(context, {
    capability: "artifact:create-own",
    meetingId: input.meetingId,
    ownerParticipantId: context.participantId,
  });
  if (authorized.kind !== "authorized") {
    return failed("FORBIDDEN");
  }
  if (
    input.bytes.byteLength === 0 ||
    input.filename.trim() !== input.filename ||
    input.filename.length === 0 ||
    input.filename.length > 255 ||
    input.filename.includes("/") ||
    input.filename.includes("\\") ||
    input.filename.includes("\0")
  ) {
    return failed("VALIDATION_FAILED");
  }
  if (input.bytes.byteLength > ARTIFACT_MAX_FILE_BYTES) {
    return failed("ARTIFACT_TOO_LARGE");
  }
  const normalizedContentType = canonicalContentType(
    input.filename,
    input.contentType,
  );
  if (normalizedContentType === undefined) {
    return failed("ARTIFACT_TYPE_UNSUPPORTED");
  }

  let sourceHash: string;
  let expected: ReturnType<typeof meetingPosition>;
  let commandKey: ReturnType<typeof idempotencyKey>;
  let occurredAt: ReturnType<typeof timestamp>;
  try {
    sourceHash = await hashBytes(dependencies.hashBytes, input.bytes);
    expected = meetingPosition(input.expectedPosition);
    commandKey = idempotencyKey(input.idempotencyKey);
    occurredAt = timestamp(dependencies.clock.now());
    nonEmptyText(input.filename);
    nonEmptyText(normalizedContentType);
  } catch (error) {
    if (error instanceof DomainValueError) {
      return failed("VALIDATION_FAILED");
    }
    throw error;
  }

  const records = await dependencies.events.load(input.meetingId);
  const events = normalizeRecords(records);
  const existing = events.find(
    (event): event is EventOf<"ArtifactRegistered"> =>
      event.eventType === "ArtifactRegistered" &&
      event.idempotencyKey === input.idempotencyKey,
  );
  if (existing !== undefined) {
    const artifact = existing.payload.artifact;
    if (
      existing.visibility !== "private" ||
      existing.ownerParticipantId !== context.participantId ||
      artifact.contentHash !== sourceHash ||
      artifact.contentType !== normalizedContentType ||
      artifact.originalFilename !== input.filename ||
      artifact.sizeBytes !== input.bytes.byteLength
    ) {
      return failed("IDEMPOTENCY_CONFLICT");
    }
    const processed = processedEventFor(events, artifact.id);
    return {
      artifact: artifactView(existing, processed),
      correlationId: existing.correlationId,
      kind: "registered",
      position: processed?.position ?? existing.position,
      replayed: true,
    };
  }

  const projection = replayMeeting(meetingId(input.meetingId), events);
  const ownerWorkspace = projection.privateWorkspaces.find(
    ({ ownerParticipantId }) => ownerParticipantId === context.participantId,
  );
  if (
    (ownerWorkspace?.artifacts.length ?? 0) >= ARTIFACT_MAX_OWNER_ITEMS ||
    [
      ...projection.privateWorkspaces,
      { artifacts: projection.shared.artifacts },
    ]
      .flatMap(({ artifacts }) => artifacts)
      .reduce((total, artifact) => total + artifact.sizeBytes, 0) +
      input.bytes.byteLength >
      ARTIFACT_MAX_MEETING_BYTES
  ) {
    return failed("ARTIFACT_TOO_LARGE");
  }

  const sourceArtifactId = artifactId(dependencies.ids.next("artifact"));
  const sourceScope = {
    artifactId: sourceArtifactId,
    meetingId: input.meetingId,
    ownerParticipantId: context.participantId,
    visibility: "private" as const,
  };
  const sourceMetadata = await dependencies.artifacts.put({
    bytes: input.bytes,
    contentType: normalizedContentType,
    hash: sourceHash,
    scope: sourceScope,
  });

  let derivedArtifactId: ReturnType<typeof artifactId> | undefined;
  let derivedHash: string | undefined;
  let derivedMetadata:
    | {
        readonly size: number;
        readonly storageReference: string;
      }
    | undefined;
  let processingState: "failed" | "processed" = "failed";
  let failureCode: string | undefined;
  try {
    const extracted = await dependencies.extractor.extract({
      bytes: input.bytes,
      contentType: normalizedContentType,
      filename: input.filename,
    });
    const derivedBytes = new TextEncoder().encode(extracted.content);
    if (
      derivedBytes.byteLength === 0 ||
      derivedBytes.byteLength > ARTIFACT_MAX_FILE_BYTES
    ) {
      throw new Error("Derived artifact violates the bounded size policy");
    }
    derivedArtifactId = artifactId(dependencies.ids.next("artifact-derived"));
    derivedHash = await hashBytes(dependencies.hashBytes, derivedBytes);
    derivedMetadata = await dependencies.artifacts.put({
      bytes: derivedBytes,
      contentType: DERIVED_CONTENT_TYPE,
      hash: derivedHash,
      scope: {
        ...sourceScope,
        artifactId: derivedArtifactId,
      },
    });
    processingState = "processed";
  } catch {
    failureCode = "ARTIFACT_PROCESSING_FAILED";
  }

  const correlation = correlationId(
    input.correlationId ?? dependencies.ids.next("correlation"),
  );
  const registeredEvent: EventOf<"ArtifactRegistered"> = {
    actor: {
      kind: "participant",
      participantId: participantId(context.participantId),
    },
    correlationId: correlation,
    eventId: eventId(dependencies.ids.next("event")),
    eventType: "ArtifactRegistered",
    idempotencyKey: commandKey,
    meetingId: meetingId(input.meetingId),
    occurredAt,
    ownerParticipantId: participantId(context.participantId),
    payload: {
      artifact: createSourceArtifact({
        artifactType:
          normalizedContentType === "text/plain" ? "text" : "document",
        confirmationStatus: "not_applicable",
        contentHash: contentHash(sourceHash),
        contentType: nonEmptyText(normalizedContentType),
        createdAt: occurredAt,
        createdBy: participantId(context.participantId),
        id: sourceArtifactId,
        meetingId: meetingId(input.meetingId),
        origin: "source_artifact",
        originalFilename: nonEmptyText(input.filename),
        ownerParticipantId: participantId(context.participantId),
        processingState: "processing",
        revision: revisionNumber(1),
        sizeBytes: sourceMetadata.size,
        storageReference: nonEmptyText(sourceMetadata.storageReference),
        visibility: "private",
      }),
    },
    position: meetingPosition(expected + 1),
    schemaVersion: schemaVersion(1),
    visibility: "private",
  };
  const processedEvent: EventOf<"ArtifactProcessed"> = {
    actor: registeredEvent.actor,
    causationId: causationId(registeredEvent.eventId),
    correlationId: correlation,
    eventId: eventId(dependencies.ids.next("event")),
    eventType: "ArtifactProcessed",
    meetingId: meetingId(input.meetingId),
    occurredAt,
    ownerParticipantId: participantId(context.participantId),
    payload: {
      artifactId: sourceArtifactId,
      processingState,
      ...(derivedArtifactId === undefined ? {} : { derivedArtifactId }),
      ...(derivedHash === undefined
        ? {}
        : { contentHash: contentHash(derivedHash) }),
      ...(derivedMetadata === undefined
        ? {}
        : {
            derivedSizeBytes: derivedMetadata.size,
            derivedStorageReference: nonEmptyText(
              derivedMetadata.storageReference,
            ),
          }),
      ...(failureCode === undefined
        ? {}
        : { failureCode: nonEmptyText(failureCode) }),
    },
    position: meetingPosition(expected + 2),
    schemaVersion: schemaVersion(1),
    visibility: "private",
  };
  const appended = await dependencies.events.append({
    events: [registeredEvent, processedEvent],
    expectedPosition: input.expectedPosition,
    idempotencyKey: input.idempotencyKey,
    meetingId: input.meetingId,
    payloadFingerprint: [
      input.meetingId,
      context.participantId,
      input.filename,
      normalizedContentType,
      sourceHash,
    ].join("\u0000"),
    trustPayloadFingerprintForReplay: true,
  });
  if (
    appended.kind === "position_conflict" ||
    appended.kind === "idempotency_conflict"
  ) {
    await Promise.all([
      dependencies.artifacts.delete(sourceScope),
      derivedArtifactId === undefined
        ? Promise.resolve()
        : dependencies.artifacts.delete({
            ...sourceScope,
            artifactId: derivedArtifactId,
          }),
    ]);
    return appended.kind === "position_conflict"
      ? {
          actualPosition: appended.actualPosition,
          code: "CONFLICT",
          expectedPosition: appended.expectedPosition,
          kind: "failed",
        }
      : failed("IDEMPOTENCY_CONFLICT");
  }
  await refreshProjection(dependencies, input.meetingId, context.participantId);
  const appendedEvents = normalizeRecords(appended.records);
  const persistedRegistration = appendedEvents.find(
    (event): event is EventOf<"ArtifactRegistered"> =>
      event.eventType === "ArtifactRegistered",
  );
  if (persistedRegistration === undefined) {
    throw new Error("Artifact registration append returned no registration");
  }
  const persistedProcessing = processedEventFor(
    appendedEvents,
    persistedRegistration.payload.artifact.id,
  );
  return {
    artifact: artifactView(persistedRegistration, persistedProcessing),
    correlationId: persistedRegistration.correlationId,
    kind: "registered",
    position: persistedProcessing?.position ?? persistedRegistration.position,
    replayed: appended.kind === "replayed",
  };
}

export async function getPrivateArtifact(
  dependencies: Pick<ArtifactIngestionDependencies, "artifacts" | "events">,
  context: UserAuthorizationContext,
  input: {
    readonly artifactId: string;
    readonly meetingId: string;
    readonly representation: "derived" | "source";
  },
): Promise<GetPrivateArtifactResult> {
  const authorized = authorize(context, {
    capability: "private:read-own",
    meetingId: input.meetingId,
    ownerParticipantId: context.participantId,
  });
  if (authorized.kind !== "authorized") {
    return { code: "FORBIDDEN", kind: "failed" };
  }
  const events = normalizeRecords(
    await dependencies.events.load(input.meetingId),
  );
  const registered = events.find(
    (event): event is EventOf<"ArtifactRegistered"> =>
      event.eventType === "ArtifactRegistered" &&
      event.visibility === "private" &&
      event.ownerParticipantId === context.participantId &&
      event.payload.artifact.id === input.artifactId,
  );
  if (registered === undefined) {
    return { code: "FORBIDDEN", kind: "failed" };
  }
  const processed = processedEventFor(events, input.artifactId);
  const selectedArtifactId =
    input.representation === "source"
      ? registered.payload.artifact.id
      : processed?.payload.derivedArtifactId;
  if (selectedArtifactId === undefined) {
    return { code: "FORBIDDEN", kind: "failed" };
  }
  const bytes = await dependencies.artifacts.get({
    artifactId: selectedArtifactId,
    meetingId: input.meetingId,
    ownerParticipantId: context.participantId,
    visibility: "private",
  });
  if (bytes === undefined) {
    return { code: "FORBIDDEN", kind: "failed" };
  }
  return {
    bytes,
    contentType:
      input.representation === "source"
        ? (registered.payload.artifact.contentType ??
          "application/octet-stream")
        : DERIVED_CONTENT_TYPE,
    filename:
      input.representation === "source"
        ? (registered.payload.artifact.originalFilename ?? "artifact")
        : `${registered.payload.artifact.originalFilename ?? "artifact"}.txt`,
    kind: "found",
  };
}
