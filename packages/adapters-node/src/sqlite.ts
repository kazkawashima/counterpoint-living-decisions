import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type {
  AppendEventsFailure,
  AppendEventsRequest,
  AppendEventsResult,
  EventRecord,
  EventStore,
  ProjectionScope,
  ProjectionStore,
} from "@counterpoint/ports";

import type { JsonCodec } from "./json-codec.js";

interface Migration {
  readonly name: string;
  readonly sql: string;
  readonly version: number;
}

interface CountRow {
  readonly count: number;
}

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

interface VersionRow {
  readonly name: string;
  readonly version: number;
}

const migrations: readonly Migration[] = [
  {
    version: 1,
    name: "identity_and_meetings",
    sql: `
      CREATE TABLE users (
        user_id TEXT PRIMARY KEY,
        password_hash TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
      ) STRICT;

      CREATE TABLE meetings (
        meeting_id TEXT PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        created_by_user_id TEXT NOT NULL,
        facilitator_participant_id TEXT NOT NULL,
        purpose TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
        created_at TEXT NOT NULL
          DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        FOREIGN KEY (created_by_user_id) REFERENCES users(user_id)
      ) STRICT;

      CREATE TABLE participant_assignments (
        meeting_id TEXT NOT NULL,
        participant_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('facilitator', 'participant')),
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
        PRIMARY KEY (meeting_id, participant_id),
        UNIQUE (meeting_id, user_id),
        FOREIGN KEY (meeting_id) REFERENCES meetings(meeting_id),
        FOREIGN KEY (user_id) REFERENCES users(user_id)
      ) STRICT;

      CREATE INDEX participant_assignments_user
        ON participant_assignments(user_id, active, meeting_id);
    `,
  },
  {
    version: 2,
    name: "event_ledger_and_projections",
    sql: `
      CREATE TABLE events (
        meeting_id TEXT NOT NULL,
        position INTEGER NOT NULL CHECK (position > 0),
        payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
        appended_at TEXT NOT NULL
          DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        PRIMARY KEY (meeting_id, position)
      ) STRICT;

      CREATE TABLE event_appends (
        meeting_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        payload_fingerprint TEXT NOT NULL,
        event_payloads_json TEXT NOT NULL
          CHECK (json_valid(event_payloads_json)),
        first_position INTEGER NOT NULL CHECK (first_position > 0),
        event_count INTEGER NOT NULL CHECK (event_count >= 0),
        appended_at TEXT NOT NULL
          DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        PRIMARY KEY (meeting_id, idempotency_key)
      ) STRICT;

      CREATE TABLE projections (
        meeting_id TEXT NOT NULL,
        projection TEXT NOT NULL,
        scope_kind TEXT NOT NULL
          CHECK (scope_kind IN ('shared', 'owner_private')),
        owner_participant_id TEXT NOT NULL DEFAULT '',
        payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
        updated_at TEXT NOT NULL
          DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        CHECK (
          (scope_kind = 'shared' AND owner_participant_id = '')
          OR
          (scope_kind = 'owner_private' AND owner_participant_id <> '')
        ),
        PRIMARY KEY (
          meeting_id,
          projection,
          scope_kind,
          owner_participant_id
        )
      ) STRICT;
    `,
  },
  {
    version: 3,
    name: "decisions_audit_and_artifacts",
    sql: `
      CREATE TABLE decision_revisions (
        meeting_id TEXT NOT NULL,
        decision_id TEXT NOT NULL,
        revision INTEGER NOT NULL CHECK (revision > 0),
        payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
        created_at TEXT NOT NULL
          DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        PRIMARY KEY (meeting_id, decision_id, revision)
      ) STRICT;

      CREATE TABLE audit_history (
        meeting_id TEXT NOT NULL,
        audit_id TEXT NOT NULL,
        event_position INTEGER,
        action TEXT NOT NULL,
        payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
        recorded_at TEXT NOT NULL
          DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        PRIMARY KEY (meeting_id, audit_id),
        FOREIGN KEY (meeting_id, event_position)
          REFERENCES events(meeting_id, position)
      ) STRICT;

      CREATE INDEX audit_history_meeting_position
        ON audit_history(meeting_id, event_position);

      CREATE TABLE artifact_metadata (
        meeting_id TEXT NOT NULL,
        artifact_id TEXT NOT NULL,
        visibility TEXT NOT NULL CHECK (visibility IN ('private', 'shared')),
        owner_participant_id TEXT NOT NULL DEFAULT '',
        content_type TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
        storage_reference TEXT NOT NULL,
        created_at TEXT NOT NULL
          DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        CHECK (
          (visibility = 'shared' AND owner_participant_id = '')
          OR
          (visibility = 'private' AND owner_participant_id <> '')
        ),
        PRIMARY KEY (
          meeting_id,
          visibility,
          owner_participant_id,
          artifact_id
        ),
        UNIQUE (storage_reference)
      ) STRICT;
    `,
  },
  {
    version: 4,
    name: "bearer_sessions",
    sql: `
      CREATE TABLE sessions (
        session_id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash) > 0),
        user_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_activity_at TEXT NOT NULL,
        absolute_expires_at TEXT NOT NULL,
        revoked_at TEXT,
        FOREIGN KEY (user_id) REFERENCES users(user_id)
      ) STRICT;

      CREATE INDEX sessions_user_activity
        ON sessions(user_id, revoked_at, last_activity_at);
    `,
  },
];

export const CURRENT_SQLITE_MIGRATION_COUNT = migrations.length;

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

function runTransaction<T>(database: DatabaseSync, work: () => T): T {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    if (database.isTransaction) {
      database.exec("ROLLBACK");
    }
    throw error;
  }
}

function readAppliedMigrations(database: DatabaseSync): readonly VersionRow[] {
  return database
    .prepare("SELECT version, name FROM schema_migrations ORDER BY version ASC")
    .all() as unknown as VersionRow[];
}

export function applySqliteMigrations(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL
        DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    ) STRICT;
  `);

  const applied = readAppliedMigrations(database);
  for (const [index, row] of applied.entries()) {
    const expected = migrations[index];
    if (expected?.version !== row.version || row.name !== expected.name) {
      throw new Error(
        `Unsupported SQLite migration history at version ${String(row.version)}`,
      );
    }
  }

  for (const migration of migrations.slice(applied.length)) {
    runTransaction(database, () => {
      database.exec(migration.sql);
      database
        .prepare("INSERT INTO schema_migrations (version, name) VALUES (?, ?)")
        .run(migration.version, migration.name);
    });
  }
}

export class NodeSqliteDatabase implements Disposable {
  readonly #database: DatabaseSync;

  constructor(path: string) {
    requireNonEmpty(path, "SQLite path");
    if (path !== ":memory:") {
      mkdirSync(dirname(path), { recursive: true });
    }

    this.#database = new DatabaseSync(path, {
      allowExtension: false,
      enableDoubleQuotedStringLiterals: false,
      enableForeignKeyConstraints: true,
      readOnly: false,
      timeout: 5_000,
    });
    try {
      this.#database.exec(`
        PRAGMA foreign_keys = ON;
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        PRAGMA busy_timeout = 5000;
        PRAGMA trusted_schema = OFF;
      `);
      applySqliteMigrations(this.#database);
    } catch (error) {
      this.#database.close();
      throw error;
    }
  }

  get database(): DatabaseSync {
    if (!this.#database.isOpen) {
      throw new Error("SQLite database is closed");
    }
    return this.#database;
  }

  close(): void {
    if (this.#database.isOpen) {
      this.#database.close();
    }
  }

  [Symbol.dispose](): void {
    this.close();
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

export class SqliteEventStore<TEvent> implements EventStore<TEvent> {
  readonly #codec: JsonCodec<TEvent>;
  readonly #owner: NodeSqliteDatabase;

  constructor(owner: NodeSqliteDatabase, codec: JsonCodec<TEvent>) {
    this.#owner = owner;
    this.#codec = codec;
  }

  async append(
    request: AppendEventsRequest<TEvent>,
  ): Promise<AppendEventsFailure | AppendEventsResult<TEvent>> {
    await Promise.resolve();
    requireNonEmpty(request.meetingId, "meetingId");
    if (request.expectedPosition !== undefined) {
      requirePosition(request.expectedPosition, "expectedPosition");
    }
    if (request.idempotencyKey !== undefined) {
      requireNonEmpty(request.idempotencyKey, "idempotencyKey");
    }

    const serializedEvents = request.events.map((event) =>
      this.#codec.encode(event),
    );
    const serializedPayloads = JSON.stringify(serializedEvents);
    const fingerprint = request.payloadFingerprint ?? serializedPayloads;
    const database = this.#owner.database;

    return runTransaction(database, () => {
      if (request.idempotencyKey !== undefined) {
        const previous = database
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
          .get(request.meetingId, request.idempotencyKey) as unknown as
          IdempotencyRow | undefined;

        if (previous !== undefined) {
          if (
            previous.payload_fingerprint !== fingerprint ||
            (!request.trustPayloadFingerprintForReplay &&
              previous.event_payloads_json !== serializedPayloads)
          ) {
            return {
              idempotencyKey: request.idempotencyKey,
              kind: "idempotency_conflict" as const,
            };
          }
          return {
            kind: "replayed" as const,
            records: this.#loadRange(
              request.meetingId,
              previous.first_position,
              previous.event_count,
            ),
          };
        }
      }

      const actualPosition = this.#readPosition(request.meetingId);
      if (
        request.expectedPosition !== undefined &&
        request.expectedPosition !== actualPosition
      ) {
        return {
          actualPosition,
          expectedPosition: request.expectedPosition,
          kind: "position_conflict" as const,
        };
      }

      const insertEvent = database.prepare(
        `
          INSERT INTO events (meeting_id, position, payload_json)
          VALUES (?, ?, ?)
        `,
      );
      const records = request.events.map((event, index) => {
        const position = actualPosition + index + 1;
        if (!Number.isSafeInteger(position)) {
          throw new RangeError("Event position exceeds the safe integer range");
        }
        insertEvent.run(
          request.meetingId,
          position,
          serializedEvents[index] ?? "",
        );
        return { event, position };
      });

      if (request.idempotencyKey !== undefined) {
        database
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
          .run(
            request.meetingId,
            request.idempotencyKey,
            fingerprint,
            serializedPayloads,
            actualPosition + 1,
            records.length,
          );
      }

      return {
        kind: "appended" as const,
        records,
      };
    });
  }

  async load(
    meetingId: string,
    options?: {
      readonly afterPosition?: number;
    },
  ): Promise<readonly EventRecord<TEvent>[]> {
    await Promise.resolve();
    requireNonEmpty(meetingId, "meetingId");
    const afterPosition = options?.afterPosition ?? 0;
    requirePosition(afterPosition, "afterPosition");
    const rows = this.#owner.database
      .prepare(
        `
          SELECT position, payload_json
          FROM events
          WHERE meeting_id = ? AND position > ?
          ORDER BY position ASC
        `,
      )
      .all(meetingId, afterPosition) as unknown as EventRow[];
    return rows.map((row) => ({
      event: this.#codec.decode(row.payload_json),
      position: row.position,
    }));
  }

  async position(meetingId: string): Promise<number> {
    await Promise.resolve();
    requireNonEmpty(meetingId, "meetingId");
    return this.#readPosition(meetingId);
  }

  #loadRange(
    meetingId: string,
    firstPosition: number,
    eventCount: number,
  ): readonly EventRecord<TEvent>[] {
    const rows = this.#owner.database
      .prepare(
        `
          SELECT position, payload_json
          FROM events
          WHERE meeting_id = ? AND position >= ? AND position < ?
          ORDER BY position ASC
        `,
      )
      .all(
        meetingId,
        firstPosition,
        firstPosition + eventCount,
      ) as unknown as EventRow[];
    if (rows.length !== eventCount) {
      throw new Error("Idempotent append points to an incomplete event range");
    }
    return rows.map((row) => ({
      event: this.#codec.decode(row.payload_json),
      position: row.position,
    }));
  }

  #readPosition(meetingId: string): number {
    const row = this.#owner.database
      .prepare(
        `
          SELECT COALESCE(MAX(position), 0) AS position
          FROM events
          WHERE meeting_id = ?
        `,
      )
      .get(meetingId) as unknown as PositionRow;
    return row.position;
  }
}

export class SqliteProjectionStore<
  TProjection,
> implements ProjectionStore<TProjection> {
  readonly #codec: JsonCodec<TProjection>;
  readonly #owner: NodeSqliteDatabase;

  constructor(owner: NodeSqliteDatabase, codec: JsonCodec<TProjection>) {
    this.#owner = owner;
    this.#codec = codec;
  }

  async get(scope: ProjectionScope): Promise<TProjection | undefined> {
    await Promise.resolve();
    const partition = projectionPartition(scope);
    const row = this.#owner.database
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
      .get(
        scope.meetingId,
        scope.projection,
        partition.scopeKind,
        partition.ownerParticipantId,
      ) as unknown as ProjectionRow | undefined;
    return row === undefined ? undefined : this.#codec.decode(row.payload_json);
  }

  async put(scope: ProjectionScope, value: TProjection): Promise<void> {
    await Promise.resolve();
    const partition = projectionPartition(scope);
    const serialized = this.#codec.encode(value);
    this.#owner.database
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
      .run(
        scope.meetingId,
        scope.projection,
        partition.scopeKind,
        partition.ownerParticipantId,
        serialized,
      );
  }
}

export function sqliteMigrationCount(database: DatabaseSync): number {
  const row = database
    .prepare("SELECT COUNT(*) AS count FROM schema_migrations")
    .get() as unknown as CountRow;
  return row.count;
}
