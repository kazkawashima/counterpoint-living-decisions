import type {
  AppendEventsRequest,
  AppendEventsResult,
  ArtifactMetadata,
  ArtifactScope,
  ArtifactStore,
  ArtifactWrite,
  EventRecord,
  EventStore,
  ProjectionScope,
  ProjectionStore,
  RealtimeMessage,
  RealtimePublisher,
} from "../../packages/ports/src/index.js";

function projectionKey(scope: ProjectionScope): string {
  return [
    scope.meetingId,
    scope.projection,
    scope.ownerParticipantId ?? "shared",
  ].join(":");
}

function artifactKey(scope: ArtifactScope): string {
  return [
    scope.meetingId,
    scope.visibility,
    scope.ownerParticipantId ?? "shared",
    scope.artifactId,
  ].join(":");
}

export class InMemoryEventStore<TEvent> implements EventStore<TEvent> {
  readonly #events = new Map<string, EventRecord<TEvent>[]>();
  readonly #idempotency = new Map<
    string,
    {
      readonly fingerprint: string;
      readonly result: AppendEventsResult<TEvent>;
    }
  >();

  append(
    request: AppendEventsRequest<TEvent>,
  ): ReturnType<EventStore<TEvent>["append"]> {
    const current = this.#events.get(request.meetingId) ?? [];
    const actualPosition = current.at(-1)?.position ?? 0;

    if (request.idempotencyKey !== undefined) {
      const idempotencyScope = `${request.meetingId}:${request.idempotencyKey}`;
      const previous = this.#idempotency.get(idempotencyScope);
      const fingerprint =
        request.payloadFingerprint ?? JSON.stringify(request.events);

      if (previous !== undefined) {
        if (previous.fingerprint !== fingerprint) {
          return Promise.resolve({
            idempotencyKey: request.idempotencyKey,
            kind: "idempotency_conflict",
          });
        }
        return Promise.resolve({
          kind: "replayed",
          records: previous.result.records,
        });
      }
    }

    if (
      request.expectedPosition !== undefined &&
      request.expectedPosition !== actualPosition
    ) {
      return Promise.resolve({
        actualPosition,
        expectedPosition: request.expectedPosition,
        kind: "position_conflict",
      });
    }

    const records = request.events.map((event, index) => ({
      event,
      position: actualPosition + index + 1,
    }));
    current.push(...records);
    this.#events.set(request.meetingId, current);

    const result = {
      kind: "appended" as const,
      records,
    };

    if (request.idempotencyKey !== undefined) {
      this.#idempotency.set(`${request.meetingId}:${request.idempotencyKey}`, {
        fingerprint:
          request.payloadFingerprint ?? JSON.stringify(request.events),
        result,
      });
    }

    return Promise.resolve(result);
  }

  load(
    meetingId: string,
    options?: {
      readonly afterPosition?: number;
    },
  ): Promise<readonly EventRecord<TEvent>[]> {
    const afterPosition = options?.afterPosition ?? 0;
    return Promise.resolve(
      (this.#events.get(meetingId) ?? []).filter(
        ({ position }) => position > afterPosition,
      ),
    );
  }

  position(meetingId: string): Promise<number> {
    return Promise.resolve(this.#events.get(meetingId)?.at(-1)?.position ?? 0);
  }
}

export class InMemoryProjectionStore<
  TProjection,
> implements ProjectionStore<TProjection> {
  readonly #projections = new Map<string, TProjection>();

  get(scope: ProjectionScope): Promise<TProjection | undefined> {
    return Promise.resolve(this.#projections.get(projectionKey(scope)));
  }

  put(scope: ProjectionScope, value: TProjection): Promise<void> {
    this.#projections.set(projectionKey(scope), value);
    return Promise.resolve();
  }
}

export class InMemoryArtifactStore implements ArtifactStore {
  readonly #artifacts = new Map<
    string,
    {
      readonly bytes: Uint8Array;
      readonly metadata: ArtifactMetadata;
    }
  >();

  delete(scope: ArtifactScope): Promise<void> {
    this.#artifacts.delete(artifactKey(scope));
    return Promise.resolve();
  }

  get(scope: ArtifactScope): Promise<Uint8Array | undefined> {
    const stored = this.#artifacts.get(artifactKey(scope));
    return Promise.resolve(
      stored === undefined ? undefined : stored.bytes.slice(),
    );
  }

  put(write: ArtifactWrite): Promise<ArtifactMetadata> {
    if (
      (write.scope.visibility === "private" &&
        write.scope.ownerParticipantId === undefined) ||
      (write.scope.visibility === "shared" &&
        write.scope.ownerParticipantId !== undefined)
    ) {
      return Promise.reject(
        new Error("Artifact visibility and owner scope do not agree"),
      );
    }

    const metadata = {
      ...write.scope,
      contentType: write.contentType,
      hash: write.hash,
      size: write.bytes.byteLength,
      storageReference: artifactKey(write.scope),
    };
    this.#artifacts.set(artifactKey(write.scope), {
      bytes: write.bytes.slice(),
      metadata,
    });
    return Promise.resolve(metadata);
  }
}

export class CapturingRealtimePublisher implements RealtimePublisher {
  readonly messages: RealtimeMessage[] = [];

  publish<TPayload>(message: RealtimeMessage<TPayload>): Promise<void> {
    this.messages.push(message);
    return Promise.resolve();
  }
}
