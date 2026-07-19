/// <reference types="@cloudflare/workers-types" />

import type {
  AppendEventsFailure,
  AppendEventsRequest,
  AppendEventsResult,
  EventProjectionCommitRequest,
  EventProjectionStore,
  EventRecord,
  EventStore,
  ProjectionScope,
  ProjectionStore,
} from "@counterpoint/ports";

const MAX_APPEND_ATTEMPTS = 8;

interface EventRow {
  readonly payload_json: string;
  readonly position: number;
}

interface IdempotencyRow {
  readonly event_count: number;
  readonly event_payloads_json: string;
  readonly first_position: number;
  readonly payload_fingerprint: string;
}

interface PositionRow {
  readonly position: number;
}

interface ProjectionRow {
  readonly payload_json: string;
}

interface D1Access {
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
  prepare(query: string): D1PreparedStatement;
}

export interface JsonCodec<T> {
  decode(serialized: string): T;
  encode(value: T): string;
}

export function createJsonCodec<T>(parse: (input: unknown) => T): JsonCodec<T> {
  return {
    decode(serialized) {
      return parse(JSON.parse(serialized) as unknown);
    },
    encode(value) {
      const serialized = JSON.stringify(value);
      if (serialized === undefined) {
        throw new TypeError("Value cannot be represented as JSON");
      }
      return serialized;
    },
  };
}

function requireNonEmpty(value: string, label: string): void {
  if (value.length === 0) {
    throw new TypeError(`${label} must not be empty`);
  }
}

function requirePosition(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer`);
  }
}

function projectionPartition(scope: ProjectionScope): {
  readonly ownerParticipantId: string;
  readonly scopeKind: "owner_private" | "shared";
} {
  requireNonEmpty(scope.meetingId, "meetingId");
  requireNonEmpty(scope.projection, "projection");
  if (scope.ownerParticipantId === undefined) {
    return {
      ownerParticipantId: "",
      scopeKind: "shared",
    };
  }
  requireNonEmpty(scope.ownerParticipantId, "ownerParticipantId");
  return {
    ownerParticipantId: scope.ownerParticipantId,
    scopeKind: "owner_private",
  };
}

async function readPosition(
  database: D1Access,
  meetingId: string,
): Promise<number> {
  const row = await database
    .prepare(
      `
        SELECT COALESCE(MAX(position), 0) AS position
        FROM events
        WHERE meeting_id = ?
      `,
    )
    .bind(meetingId)
    .first<PositionRow>();
  if (row === null) {
    throw new Error("D1 position query returned no row");
  }
  requirePosition(row.position, "stored event position");
  return row.position;
}

async function readIdempotency(
  database: D1Access,
  meetingId: string,
  idempotencyKey: string,
): Promise<IdempotencyRow | undefined> {
  const row = await database
    .prepare(
      `
        SELECT
          payload_fingerprint,
          event_payloads_json,
          first_position,
          event_count
        FROM event_appends
        WHERE meeting_id = ? AND idempotency_key = ?
      `,
    )
    .bind(meetingId, idempotencyKey)
    .first<IdempotencyRow>();
  return row ?? undefined;
}

async function loadRange<TEvent>(
  database: D1Access,
  codec: JsonCodec<TEvent>,
  meetingId: string,
  firstPosition: number,
  eventCount: number,
): Promise<readonly EventRecord<TEvent>[]> {
  const result = await database
    .prepare(
      `
        SELECT position, payload_json
        FROM events
        WHERE meeting_id = ? AND position >= ? AND position < ?
        ORDER BY position ASC
      `,
    )
    .bind(meetingId, firstPosition, firstPosition + eventCount)
    .all<EventRow>();
  if (result.results.length !== eventCount) {
    throw new Error("Idempotent append points to an incomplete event range");
  }
  return result.results.map((row) => ({
    event: codec.decode(row.payload_json),
    position: row.position,
  }));
}

function projectionUpsert<TProjection>(
  database: D1Access,
  codec: JsonCodec<TProjection>,
  scope: ProjectionScope,
  value: TProjection,
): D1PreparedStatement {
  const partition = projectionPartition(scope);
  return database
    .prepare(
      `
        INSERT INTO projections (
          meeting_id,
          projection,
          scope_kind,
          owner_participant_id,
          payload_json
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (
          meeting_id,
          projection,
          scope_kind,
          owner_participant_id
        ) DO UPDATE SET
          payload_json = excluded.payload_json,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      `,
    )
    .bind(
      scope.meetingId,
      scope.projection,
      partition.scopeKind,
      partition.ownerParticipantId,
      codec.encode(value),
    );
}

async function appendD1<TEvent>(
  database: D1Database,
  codec: JsonCodec<TEvent>,
  request: AppendEventsRequest<TEvent>,
  additionalStatements?: (session: D1Access) => readonly D1PreparedStatement[],
): Promise<AppendEventsFailure | AppendEventsResult<TEvent>> {
  requireNonEmpty(request.meetingId, "meetingId");
  if (request.expectedPosition !== undefined) {
    requirePosition(request.expectedPosition, "expectedPosition");
  }
  if (request.idempotencyKey !== undefined) {
    requireNonEmpty(request.idempotencyKey, "idempotencyKey");
  }

  const serializedEvents = request.events.map((event) => codec.encode(event));
  const serializedPayloads = JSON.stringify(serializedEvents);
  const fingerprint = request.payloadFingerprint ?? serializedPayloads;
  let lastContention: unknown;

  for (let attempt = 0; attempt < MAX_APPEND_ATTEMPTS; attempt += 1) {
    const session = database.withSession("first-primary");
    if (request.idempotencyKey !== undefined) {
      const previous = await readIdempotency(
        session,
        request.meetingId,
        request.idempotencyKey,
      );
      if (previous !== undefined) {
        if (
          previous.payload_fingerprint !== fingerprint ||
          (!request.trustPayloadFingerprintForReplay &&
            previous.event_payloads_json !== serializedPayloads)
        ) {
          return {
            idempotencyKey: request.idempotencyKey,
            kind: "idempotency_conflict",
          };
        }
        return {
          kind: "replayed",
          records: await loadRange(
            session,
            codec,
            request.meetingId,
            previous.first_position,
            previous.event_count,
          ),
        };
      }
    }

    const actualPosition = await readPosition(session, request.meetingId);
    if (
      request.expectedPosition !== undefined &&
      request.expectedPosition !== actualPosition
    ) {
      return {
        actualPosition,
        expectedPosition: request.expectedPosition,
        kind: "position_conflict",
      };
    }

    const records = request.events.map((event, index) => {
      const position = actualPosition + index + 1;
      if (!Number.isSafeInteger(position)) {
        throw new RangeError("Event position exceeds the safe integer range");
      }
      return { event, position };
    });
    const statements = records.map(({ position }, index) =>
      session
        .prepare(
          `
            INSERT INTO events (meeting_id, position, payload_json)
            VALUES (?, ?, ?)
          `,
        )
        .bind(request.meetingId, position, serializedEvents[index] ?? ""),
    );

    if (request.idempotencyKey !== undefined) {
      statements.push(
        session
          .prepare(
            `
              INSERT INTO event_appends (
                meeting_id,
                idempotency_key,
                payload_fingerprint,
                event_payloads_json,
                first_position,
                event_count
              ) VALUES (?, ?, ?, ?, ?, ?)
            `,
          )
          .bind(
            request.meetingId,
            request.idempotencyKey,
            fingerprint,
            serializedPayloads,
            actualPosition + 1,
            records.length,
          ),
      );
    }

    statements.push(...(additionalStatements?.(session) ?? []));
    if (statements.length === 0) {
      return { kind: "appended", records };
    }

    try {
      await session.batch(statements);
      return { kind: "appended", records };
    } catch (error) {
      lastContention = error;
      const currentPosition = await readPosition(session, request.meetingId);
      const previous =
        request.idempotencyKey === undefined
          ? undefined
          : await readIdempotency(
              session,
              request.meetingId,
              request.idempotencyKey,
            );
      if (currentPosition === actualPosition && previous === undefined) {
        throw error;
      }
    }
  }

  throw new Error("D1 append contention did not settle", {
    cause: lastContention,
  });
}

export class D1EventStore<TEvent> implements EventStore<TEvent> {
  readonly #codec: JsonCodec<TEvent>;
  readonly #database: D1Database;

  constructor(database: D1Database, codec: JsonCodec<TEvent>) {
    this.#database = database;
    this.#codec = codec;
  }

  async append(
    request: AppendEventsRequest<TEvent>,
  ): Promise<AppendEventsFailure | AppendEventsResult<TEvent>> {
    return appendD1(this.#database, this.#codec, request);
  }

  async load(
    meetingId: string,
    options?: {
      readonly afterPosition?: number;
    },
  ): Promise<readonly EventRecord<TEvent>[]> {
    requireNonEmpty(meetingId, "meetingId");
    const afterPosition = options?.afterPosition ?? 0;
    requirePosition(afterPosition, "afterPosition");
    const result = await this.#database
      .withSession("first-primary")
      .prepare(
        `
          SELECT position, payload_json
          FROM events
          WHERE meeting_id = ? AND position > ?
          ORDER BY position ASC
        `,
      )
      .bind(meetingId, afterPosition)
      .all<EventRow>();
    return result.results.map((row) => ({
      event: this.#codec.decode(row.payload_json),
      position: row.position,
    }));
  }

  async position(meetingId: string): Promise<number> {
    requireNonEmpty(meetingId, "meetingId");
    return readPosition(this.#database.withSession("first-primary"), meetingId);
  }
}

export class D1ProjectionStore<
  TProjection,
> implements ProjectionStore<TProjection> {
  readonly #codec: JsonCodec<TProjection>;
  readonly #database: D1Database;

  constructor(database: D1Database, codec: JsonCodec<TProjection>) {
    this.#database = database;
    this.#codec = codec;
  }

  async get(scope: ProjectionScope): Promise<TProjection | undefined> {
    const partition = projectionPartition(scope);
    const row = await this.#database
      .withSession("first-primary")
      .prepare(
        `
          SELECT payload_json
          FROM projections
          WHERE meeting_id = ?
            AND projection = ?
            AND scope_kind = ?
            AND owner_participant_id = ?
        `,
      )
      .bind(
        scope.meetingId,
        scope.projection,
        partition.scopeKind,
        partition.ownerParticipantId,
      )
      .first<ProjectionRow>();
    return row === null ? undefined : this.#codec.decode(row.payload_json);
  }

  async put(scope: ProjectionScope, value: TProjection): Promise<void> {
    const session = this.#database.withSession("first-primary");
    await projectionUpsert(session, this.#codec, scope, value).run();
  }
}

export class D1EventProjectionStore<
  TEvent,
  TProjection,
> implements EventProjectionStore<TEvent, TProjection> {
  readonly #database: D1Database;
  readonly #eventCodec: JsonCodec<TEvent>;
  readonly #events: D1EventStore<TEvent>;
  readonly #projectionCodec: JsonCodec<TProjection>;
  readonly #projections: D1ProjectionStore<TProjection>;

  constructor(
    database: D1Database,
    eventCodec: JsonCodec<TEvent>,
    projectionCodec: JsonCodec<TProjection>,
  ) {
    this.#database = database;
    this.#eventCodec = eventCodec;
    this.#projectionCodec = projectionCodec;
    this.#events = new D1EventStore(database, eventCodec);
    this.#projections = new D1ProjectionStore(database, projectionCodec);
  }

  append(
    request: AppendEventsRequest<TEvent>,
  ): Promise<AppendEventsFailure | AppendEventsResult<TEvent>> {
    return this.#events.append(request);
  }

  async commit(
    request: EventProjectionCommitRequest<TEvent, TProjection>,
  ): Promise<AppendEventsFailure | AppendEventsResult<TEvent>> {
    await Promise.resolve();
    if (request.append.events.length === 0) {
      throw new TypeError("Atomic commits require at least one event");
    }
    requirePosition(request.append.expectedPosition, "expectedPosition");
    requireNonEmpty(request.append.idempotencyKey, "idempotencyKey");
    for (const projection of request.projections) {
      if (projection.scope.meetingId !== request.append.meetingId) {
        throw new TypeError(
          "Atomic projection writes must belong to the appended meeting",
        );
      }
    }
    return appendD1(
      this.#database,
      this.#eventCodec,
      request.append,
      (session) =>
        request.projections.map(({ scope, value }) =>
          projectionUpsert(session, this.#projectionCodec, scope, value),
        ),
    );
  }

  get(scope: ProjectionScope): Promise<TProjection | undefined> {
    return this.#projections.get(scope);
  }

  load(
    meetingId: string,
    options?: {
      readonly afterPosition?: number;
    },
  ): Promise<readonly EventRecord<TEvent>[]> {
    return this.#events.load(meetingId, options);
  }

  position(meetingId: string): Promise<number> {
    return this.#events.position(meetingId);
  }

  put(scope: ProjectionScope, value: TProjection): Promise<void> {
    return this.#projections.put(scope, value);
  }
}
