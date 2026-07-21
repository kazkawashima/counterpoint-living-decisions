import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  applySqliteMigrations,
  createJsonCodec,
  LocalArtifactStore,
  NodeSqliteDatabase,
  sqliteMigrationCount,
  SqliteEventStore,
  SqliteProjectionStore,
} from "@counterpoint/adapters-node";
import { afterEach, describe, expect, it } from "vitest";

interface FixtureEvent {
  readonly type: string;
  readonly value: string;
}

interface FixtureProjection {
  readonly label: string;
}

function parseFixtureEvent(input: unknown): FixtureEvent {
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
}

function parseFixtureProjection(input: unknown): FixtureProjection {
  if (
    typeof input !== "object" ||
    input === null ||
    !("label" in input) ||
    typeof input.label !== "string"
  ) {
    throw new TypeError("Invalid fixture projection");
  }
  return { label: input.label };
}

const temporaryDirectories: string[] = [];
const databases: NodeSqliteDatabase[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(
    join(tmpdir(), "counterpoint-sqlite-integration-"),
  );
  temporaryDirectories.push(directory);
  return directory;
}

function track(owner: NodeSqliteDatabase): NodeSqliteDatabase {
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

describe("Node persistence startup and restart", () => {
  it("applies every ordered migration once with safe connection pragmas", async () => {
    const directory = await temporaryDirectory();
    const path = join(directory, "nested", "counterpoint.sqlite");
    const owner = track(new NodeSqliteDatabase(path));

    expect(sqliteMigrationCount(owner.database)).toBe(5);
    expect(owner.database.prepare("PRAGMA foreign_keys").get()).toMatchObject({
      foreign_keys: 1,
    });
    expect(owner.database.prepare("PRAGMA journal_mode").get()).toMatchObject({
      journal_mode: "wal",
    });
    expect(owner.database.prepare("PRAGMA synchronous").get()).toMatchObject({
      synchronous: 1,
    });

    const tableNames = owner.database
      .prepare(
        `
          SELECT name
          FROM sqlite_schema
          WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
          ORDER BY name
        `,
      )
      .all()
      .map((row) => row.name);
    expect(tableNames).toEqual([
      "artifact_metadata",
      "audit_history",
      "decision_revisions",
      "event_appends",
      "events",
      "meetings",
      "participant_assignments",
      "projections",
      "schema_migrations",
      "sessions",
      "users",
    ]);

    applySqliteMigrations(owner.database);
    expect(sqliteMigrationCount(owner.database)).toBe(5);
  });

  it("enforces the fixed identity, meeting, audit, and artifact schema", async () => {
    const directory = await temporaryDirectory();
    const owner = track(
      new NodeSqliteDatabase(join(directory, "counterpoint.sqlite")),
    );
    owner.database
      .prepare(
        `
          INSERT INTO users (user_id, password_hash)
          VALUES (?, ?)
        `,
      )
      .run("user-a", "synthetic-password-hash");
    owner.database
      .prepare(
        `
          INSERT INTO meetings (
            meeting_id,
            code,
            created_by_user_id,
            facilitator_participant_id,
            purpose
          ) VALUES (?, ?, ?, ?, ?)
        `,
      )
      .run(
        "meeting-a",
        "MEET-A",
        "user-a",
        "participant-a",
        "Synthetic decision",
      );
    owner.database
      .prepare(
        `
          INSERT INTO participant_assignments (
            meeting_id,
            participant_id,
            user_id,
            role
          ) VALUES (?, ?, ?, ?)
        `,
      )
      .run("meeting-a", "participant-a", "user-a", "facilitator");

    const events = new SqliteEventStore(
      owner,
      createJsonCodec(parseFixtureEvent),
    );
    await events.append({
      events: [{ type: "Committed", value: "revision-1" }],
      meetingId: "meeting-a",
    });
    owner.database
      .prepare(
        `
          INSERT INTO decision_revisions (
            meeting_id,
            decision_id,
            revision,
            payload_json
          ) VALUES (?, ?, ?, ?)
        `,
      )
      .run("meeting-a", "decision-a", 1, '{"status":"COMMITTED"}');
    owner.database
      .prepare(
        `
          INSERT INTO audit_history (
            meeting_id,
            audit_id,
            event_position,
            action,
            payload_json
          ) VALUES (?, ?, ?, ?, ?)
        `,
      )
      .run("meeting-a", "audit-a", 1, "DecisionCommitted", "{}");
    owner.database
      .prepare(
        `
          INSERT INTO artifact_metadata (
            meeting_id,
            artifact_id,
            visibility,
            owner_participant_id,
            content_type,
            content_hash,
            byte_size,
            storage_reference
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        "meeting-a",
        "artifact-a",
        "private",
        "participant-a",
        "text/plain",
        "sha256:synthetic",
        3,
        "meetings/meeting-a/private/participant-a/artifact-a",
      );

    expect(
      owner.database
        .prepare(
          `
            SELECT
              (SELECT COUNT(*) FROM users) AS users,
              (SELECT COUNT(*) FROM meetings) AS meetings,
              (SELECT COUNT(*) FROM participant_assignments) AS assignments,
              (SELECT COUNT(*) FROM events) AS events,
              (SELECT COUNT(*) FROM decision_revisions) AS revisions,
              (SELECT COUNT(*) FROM audit_history) AS audit_entries,
              (SELECT COUNT(*) FROM artifact_metadata) AS artifacts
          `,
        )
        .get(),
    ).toMatchObject({
      artifacts: 1,
      assignments: 1,
      audit_entries: 1,
      events: 1,
      meetings: 1,
      revisions: 1,
      users: 1,
    });
    expect(() =>
      owner.database
        .prepare(
          `
            INSERT INTO participant_assignments (
              meeting_id,
              participant_id,
              user_id,
              role
            ) VALUES (?, ?, ?, ?)
          `,
        )
        .run("missing-meeting", "participant-b", "user-a", "participant"),
    ).toThrow();
  });

  it("preserves events, projections, and artifacts across a closed restart", async () => {
    const directory = await temporaryDirectory();
    const path = join(directory, "counterpoint.sqlite");
    const artifactRoot = join(directory, "artifacts");
    const eventCodec = createJsonCodec(parseFixtureEvent);
    const projectionCodec = createJsonCodec(parseFixtureProjection);

    const firstOwner = track(new NodeSqliteDatabase(path));
    await new SqliteEventStore(firstOwner, eventCodec).append({
      events: [{ type: "Created", value: "persisted" }],
      expectedPosition: 0,
      idempotencyKey: "restart-request",
      meetingId: "meeting-a",
      payloadFingerprint: "restart-fingerprint",
    });
    await new SqliteProjectionStore(firstOwner, projectionCodec).put(
      {
        meetingId: "meeting-a",
        projection: "shared",
      },
      { label: "persisted" },
    );
    const artifacts = new LocalArtifactStore(artifactRoot);
    await artifacts.put({
      bytes: new Uint8Array([7, 8, 9]),
      contentType: "application/octet-stream",
      hash: "sha256:persisted",
      scope: {
        artifactId: "artifact-a",
        meetingId: "meeting-a",
        visibility: "shared",
      },
    });
    firstOwner.close();

    const secondOwner = track(new NodeSqliteDatabase(path));
    const events = new SqliteEventStore(secondOwner, eventCodec);
    const projections = new SqliteProjectionStore(secondOwner, projectionCodec);
    await expect(events.load("meeting-a")).resolves.toEqual([
      {
        event: { type: "Created", value: "persisted" },
        position: 1,
      },
    ]);
    await expect(
      events.append({
        events: [{ type: "Created", value: "persisted" }],
        expectedPosition: 0,
        idempotencyKey: "restart-request",
        meetingId: "meeting-a",
        payloadFingerprint: "restart-fingerprint",
      }),
    ).resolves.toMatchObject({ kind: "replayed" });
    await expect(
      projections.get({
        meetingId: "meeting-a",
        projection: "shared",
      }),
    ).resolves.toEqual({ label: "persisted" });
    await expect(
      artifacts.get({
        artifactId: "artifact-a",
        meetingId: "meeting-a",
        visibility: "shared",
      }),
    ).resolves.toEqual(new Uint8Array([7, 8, 9]));
  });

  it("rejects an unknown migration history on restart", async () => {
    const directory = await temporaryDirectory();
    const path = join(directory, "counterpoint.sqlite");
    const firstOwner = track(new NodeSqliteDatabase(path));
    firstOwner.database.exec("PRAGMA foreign_keys = OFF");
    firstOwner.database
      .prepare("INSERT INTO schema_migrations (version, name) VALUES (?, ?)")
      .run(99, "future_or_foreign_migration");
    firstOwner.close();

    expect(() => new NodeSqliteDatabase(path)).toThrow(
      "Unsupported SQLite migration history",
    );
  });

  it("closes its DatabaseSync resource idempotently", () => {
    const owner = track(new NodeSqliteDatabase(":memory:"));
    owner.close();
    owner.close();

    expect(() => owner.database).toThrow("SQLite database is closed");
  });
});
