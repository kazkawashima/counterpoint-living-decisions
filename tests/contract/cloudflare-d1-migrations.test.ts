import { readdir, readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { NodeSqliteDatabase } from "@counterpoint/adapters-node";
import { describe, expect, it } from "vitest";

interface MigrationFile {
  readonly name: string;
  readonly sql: string;
}

interface NameRow {
  readonly name: string;
}

interface TableInfoRow {
  readonly name: string;
}

const migrationsDirectory = fileURLToPath(
  new URL("../../apps/worker/migrations/", import.meta.url),
);

const expectedMigrationNames = [
  "0001_identity_and_meetings.sql",
  "0002_event_ledger_and_projections.sql",
  "0003_decisions_audit_and_artifacts.sql",
  "0004_bearer_sessions.sql",
  "0005_d1_append_guards.sql",
] as const;

const expectedTablesAfterMigration = [
  ["meetings", "participant_assignments", "users"],
  [
    "event_appends",
    "events",
    "meetings",
    "participant_assignments",
    "projections",
    "users",
  ],
  [
    "artifact_metadata",
    "audit_history",
    "decision_revisions",
    "event_appends",
    "events",
    "meetings",
    "participant_assignments",
    "projections",
    "users",
  ],
  [
    "artifact_metadata",
    "audit_history",
    "decision_revisions",
    "event_appends",
    "events",
    "meetings",
    "participant_assignments",
    "projections",
    "sessions",
    "users",
  ],
  [
    "artifact_metadata",
    "audit_history",
    "decision_revisions",
    "event_appends",
    "events",
    "meetings",
    "participant_assignments",
    "projections",
    "sessions",
    "users",
  ],
] as const;

const expectedTableColumns = {
  artifact_metadata: [
    "meeting_id",
    "artifact_id",
    "visibility",
    "owner_participant_id",
    "content_type",
    "content_hash",
    "byte_size",
    "storage_reference",
    "created_at",
  ],
  audit_history: [
    "meeting_id",
    "audit_id",
    "event_position",
    "action",
    "payload_json",
    "recorded_at",
  ],
  decision_revisions: [
    "meeting_id",
    "decision_id",
    "revision",
    "payload_json",
    "created_at",
  ],
  event_appends: [
    "meeting_id",
    "idempotency_key",
    "payload_fingerprint",
    "event_payloads_json",
    "first_position",
    "event_count",
    "appended_at",
  ],
  events: ["meeting_id", "position", "payload_json", "appended_at"],
  meetings: [
    "meeting_id",
    "code",
    "created_by_user_id",
    "facilitator_participant_id",
    "purpose",
    "active",
    "created_at",
  ],
  participant_assignments: [
    "meeting_id",
    "participant_id",
    "user_id",
    "role",
    "active",
  ],
  projections: [
    "meeting_id",
    "projection",
    "scope_kind",
    "owner_participant_id",
    "payload_json",
    "updated_at",
  ],
  sessions: [
    "session_id",
    "token_hash",
    "user_id",
    "created_at",
    "last_activity_at",
    "absolute_expires_at",
    "revoked_at",
  ],
  users: ["user_id", "password_hash", "active"],
} as const;

async function readMigrations(): Promise<readonly MigrationFile[]> {
  const names = (await readdir(migrationsDirectory))
    .filter((name) => name.endsWith(".sql"))
    .sort();

  return Promise.all(
    names.map(async (name) => ({
      name,
      sql: await readFile(`${migrationsDirectory}/${name}`, "utf8"),
    })),
  );
}

function createD1CompatibleDatabase(): DatabaseSync {
  const database = new DatabaseSync(":memory:", {
    enableForeignKeyConstraints: true,
  });
  database.exec("PRAGMA foreign_keys = ON;");
  return database;
}

function userTableNames(
  database: DatabaseSync,
  excludedNames: ReadonlySet<string> = new Set(),
): readonly string[] {
  const rows = database
    .prepare(
      `
        SELECT name
        FROM sqlite_schema
        WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
        ORDER BY name
      `,
    )
    .all() as unknown as NameRow[];

  return rows.map((row) => row.name).filter((name) => !excludedNames.has(name));
}

function explicitIndexNames(database: DatabaseSync): readonly string[] {
  const rows = database
    .prepare(
      `
        SELECT name
        FROM sqlite_schema
        WHERE type = 'index' AND sql IS NOT NULL
        ORDER BY name
      `,
    )
    .all() as unknown as NameRow[];

  return rows.map((row) => row.name);
}

function triggerNames(database: DatabaseSync): readonly string[] {
  const rows = database
    .prepare(
      `
        SELECT name
        FROM sqlite_schema
        WHERE type = 'trigger'
        ORDER BY name
      `,
    )
    .all() as unknown as NameRow[];

  return rows.map((row) => row.name);
}

function tableColumnMap(
  database: DatabaseSync,
  tableNames: readonly string[],
): Readonly<Record<string, readonly string[]>> {
  return Object.fromEntries(
    tableNames.map((tableName) => {
      const rows = database
        .prepare(`PRAGMA table_info("${tableName}")`)
        .all() as unknown as TableInfoRow[];
      return [tableName, rows.map((row) => row.name)];
    }),
  );
}

function applyMigrationPlanOnce(
  database: DatabaseSync,
  migrations: readonly MigrationFile[],
): readonly string[] {
  const appliedNames = new Set<string>();

  for (const migration of migrations) {
    if (appliedNames.has(migration.name)) {
      throw new Error(`Refusing duplicate migration: ${migration.name}`);
    }
    database.exec(migration.sql);
    appliedNames.add(migration.name);
  }

  return [...appliedNames];
}

describe("Cloudflare D1 migrations", () => {
  it("uses the exact ordered Wrangler migration set", async () => {
    const migrations = await readMigrations();

    expect(migrations.map((migration) => migration.name)).toEqual(
      expectedMigrationNames,
    );
    for (const migration of migrations) {
      expect(migration.sql).not.toMatch(
        /\b(?:d1_migrations|schema_migrations)\b/i,
      );
      expect(migration.sql).not.toMatch(/\bCREATE TABLE (?!IF NOT EXISTS\b)/i);
      expect(migration.sql).not.toMatch(/\bCREATE INDEX (?!IF NOT EXISTS\b)/i);
      expect(migration.sql).not.toMatch(
        /\bCREATE TRIGGER (?!IF NOT EXISTS\b)/i,
      );
    }
  });

  it("applies every numbered migration once and in order", async () => {
    const migrations = await readMigrations();
    const database = createD1CompatibleDatabase();

    try {
      for (const [index, migration] of migrations.entries()) {
        database.exec(migration.sql);
        expect(userTableNames(database)).toEqual(
          expectedTablesAfterMigration[index],
        );
      }
    } finally {
      database.close();
    }
  });

  it("applies repeat-safe DDL to a fresh SQLite database", async () => {
    const migrations = await readMigrations();
    const database = createD1CompatibleDatabase();

    try {
      for (const migration of migrations) {
        database.exec(migration.sql);
        database.exec(migration.sql);
      }

      expect(userTableNames(database)).toEqual(
        expectedTablesAfterMigration.at(-1),
      );
    } finally {
      database.close();
    }
  });

  it("aligns D1 tables and columns explicitly with the Node schema", async () => {
    const migrations = await readMigrations();
    const d1Database = createD1CompatibleDatabase();
    const nodeDatabase = new NodeSqliteDatabase(":memory:");
    const expectedTableNames = Object.keys(expectedTableColumns).sort();

    try {
      applyMigrationPlanOnce(d1Database, migrations);

      const d1Columns = tableColumnMap(d1Database, expectedTableNames);
      const nodeTableNames = userTableNames(
        nodeDatabase.database,
        new Set(["schema_migrations"]),
      );
      const nodeColumns = tableColumnMap(nodeDatabase.database, nodeTableNames);

      expect(userTableNames(d1Database)).toEqual(expectedTableNames);
      expect(nodeTableNames).toEqual(expectedTableNames);
      expect(d1Columns).toEqual(expectedTableColumns);
      expect(nodeColumns).toEqual(expectedTableColumns);
      expect(d1Columns).toEqual(nodeColumns);
    } finally {
      d1Database.close();
      nodeDatabase.close();
    }
  });

  it("preserves expected indexes and critical constraints", async () => {
    const migrations = await readMigrations();
    const database = createD1CompatibleDatabase();

    try {
      applyMigrationPlanOnce(database, migrations);

      expect(explicitIndexNames(database)).toEqual([
        "audit_history_meeting_position",
        "participant_assignments_user",
        "sessions_user_activity",
      ]);
      expect(triggerNames(database)).toEqual([
        "event_appends_complete_range",
        "events_contiguous_position",
      ]);

      database.exec(`
        INSERT INTO users (user_id, password_hash)
        VALUES ('user-a', 'hash-a');
        INSERT INTO meetings (
          meeting_id,
          code,
          created_by_user_id,
          facilitator_participant_id,
          purpose
        ) VALUES (
          'meeting-a',
          'MEETING-A',
          'user-a',
          'participant-a',
          'Synthetic migration contract'
        );
      `);

      expect(() =>
        database.exec(`
          INSERT INTO users (user_id, password_hash, active)
          VALUES ('user-invalid', 'hash-invalid', 2);
        `),
      ).toThrow();
      expect(() =>
        database.exec(`
          INSERT INTO participant_assignments (
            meeting_id,
            participant_id,
            user_id,
            role
          ) VALUES ('meeting-a', 'participant-invalid', 'user-a', 'observer');
        `),
      ).toThrow();
      expect(() =>
        database.exec(`
          INSERT INTO events (meeting_id, position, payload_json)
          VALUES ('meeting-a', 0, '{}');
        `),
      ).toThrow();
      expect(() =>
        database.exec(`
          INSERT INTO events (meeting_id, position, payload_json)
          VALUES ('meeting-a', 2, '{}');
        `),
      ).toThrow("counterpoint_event_position_conflict");
      expect(() =>
        database.exec(`
          INSERT INTO events (meeting_id, position, payload_json)
          VALUES ('meeting-a', 1, 'not-json');
        `),
      ).toThrow();
      expect(() =>
        database.exec(`
          INSERT INTO projections (
            meeting_id,
            projection,
            scope_kind,
            owner_participant_id,
            payload_json
          ) VALUES (
            'meeting-a',
            'decision',
            'shared',
            'participant-a',
            '{}'
          );
        `),
      ).toThrow();
      expect(() =>
        database.exec(`
          INSERT INTO decision_revisions (
            meeting_id,
            decision_id,
            revision,
            payload_json
          ) VALUES ('meeting-a', 'decision-a', 0, '{}');
        `),
      ).toThrow();
      expect(() =>
        database.exec(`
          INSERT INTO audit_history (
            meeting_id,
            audit_id,
            event_position,
            action,
            payload_json
          ) VALUES ('meeting-a', 'audit-a', 99, 'updated', '{}');
        `),
      ).toThrow();
      expect(() =>
        database.exec(`
          INSERT INTO artifact_metadata (
            meeting_id,
            artifact_id,
            visibility,
            content_type,
            content_hash,
            byte_size,
            storage_reference
          ) VALUES (
            'meeting-a',
            'artifact-a',
            'private',
            'text/plain',
            'sha256:synthetic',
            1,
            'synthetic/artifact-a'
          );
        `),
      ).toThrow();
      expect(() =>
        database.exec(`
          INSERT INTO event_appends (
            meeting_id,
            idempotency_key,
            payload_fingerprint,
            event_payloads_json,
            first_position,
            event_count
          ) VALUES (
            'meeting-a',
            'incomplete-range',
            'fingerprint',
            '[]',
            2,
            1
          );
        `),
      ).toThrow("counterpoint_event_append_range_incomplete");
      expect(() =>
        database.exec(`
          INSERT INTO sessions (
            session_id,
            token_hash,
            user_id,
            created_at,
            last_activity_at,
            absolute_expires_at
          ) VALUES (
            'session-a',
            '',
            'user-a',
            '2026-07-19T00:00:00.000Z',
            '2026-07-19T00:00:00.000Z',
            '2026-07-20T00:00:00.000Z'
          );
        `),
      ).toThrow();
    } finally {
      database.close();
    }
  });

  it("rejects duplicate execution plans before relying on repeat-safe SQL", async () => {
    const migrations = await readMigrations();
    const database = createD1CompatibleDatabase();
    const firstMigration = migrations[0];

    try {
      expect(firstMigration).toBeDefined();
      expect(() =>
        applyMigrationPlanOnce(database, [...migrations, firstMigration!]),
      ).toThrow(`Refusing duplicate migration: ${expectedMigrationNames[0]}`);
      expect(userTableNames(database)).not.toContain("d1_migrations");
      expect(userTableNames(database)).not.toContain("schema_migrations");
    } finally {
      database.close();
    }
  });
});
