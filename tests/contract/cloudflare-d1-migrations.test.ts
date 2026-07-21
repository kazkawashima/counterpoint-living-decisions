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

interface ManagedAiLifecycleRow {
  readonly claim_key_hash: string;
  readonly lease_expires_at_epoch: number | null;
  readonly provider_started_at_epoch: number | null;
  readonly reservation_id: string | null;
  readonly reuse_after_epoch: number | null;
  readonly settled_at_epoch: number | null;
  readonly status: string;
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
  "0006_judge_usage_reservations.sql",
  "0007_judge_managed_realtime_calls.sql",
  "0008_hosted_flagship_seed.sql",
  "0009_judge_managed_realtime_start_claims.sql",
  "0010_judge_managed_ai_operation_claims.sql",
  "0011_judge_managed_ai_operation_lifecycle.sql",
  "0012_judge_usage_active_request_fingerprints.sql",
  "0013_rename_flagship_meeting.sql",
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
  [
    "artifact_metadata",
    "audit_history",
    "decision_revisions",
    "event_appends",
    "events",
    "judge_usage_reservations",
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
    "judge_managed_realtime_calls",
    "judge_usage_reservations",
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
    "judge_managed_realtime_calls",
    "judge_usage_reservations",
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
    "judge_managed_realtime_calls",
    "judge_managed_realtime_start_claims",
    "judge_usage_reservations",
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
    "judge_managed_ai_operation_claims",
    "judge_managed_realtime_calls",
    "judge_managed_realtime_start_claims",
    "judge_usage_reservations",
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
    "judge_managed_ai_operation_claims",
    "judge_managed_ai_operation_lifecycle",
    "judge_managed_realtime_calls",
    "judge_managed_realtime_start_claims",
    "judge_usage_reservations",
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
    "judge_managed_ai_operation_claims",
    "judge_managed_ai_operation_lifecycle",
    "judge_managed_realtime_calls",
    "judge_managed_realtime_start_claims",
    "judge_usage_reservations",
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
    "judge_managed_ai_operation_claims",
    "judge_managed_ai_operation_lifecycle",
    "judge_managed_realtime_calls",
    "judge_managed_realtime_start_claims",
    "judge_usage_reservations",
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
  judge_managed_ai_operation_claims: [
    "claim_key_hash",
    "request_fingerprint",
    "operation",
    "model",
    "pricing_version",
    "created_at_epoch",
    "expires_at_epoch",
  ],
  judge_managed_ai_operation_lifecycle: [
    "claim_key_hash",
    "status",
    "reservation_id",
    "lease_expires_at_epoch",
    "provider_started_at_epoch",
    "settled_at_epoch",
    "reuse_after_epoch",
  ],
  judge_managed_realtime_calls: [
    "managed_call_id",
    "reservation_id",
    "account_id",
    "meeting_id",
    "user_id",
    "session_id",
    "participant_id",
    "channel",
    "status",
    "created_at_epoch",
    "expires_at_epoch",
    "terminated_at_epoch",
  ],
  judge_managed_realtime_start_claims: [
    "start_key_hash",
    "request_fingerprint",
    "managed_call_id",
    "meeting_id",
    "user_id",
    "session_id",
    "participant_id",
    "created_at_epoch",
    "expires_at_epoch",
  ],
  judge_usage_reservations: [
    "reservation_id",
    "request_fingerprint",
    "account_id",
    "ip_hash",
    "meeting_id",
    "operation",
    "model",
    "pricing_version",
    "status",
    "reserved_cost_micro_usd",
    "actual_cost_micro_usd",
    "reserved_input_tokens",
    "actual_input_tokens",
    "reserved_output_tokens",
    "actual_output_tokens",
    "reserved_generation_count",
    "actual_generation_count",
    "reserved_realtime_seconds",
    "actual_realtime_seconds",
    "reserved_at_epoch",
    "active_until_epoch",
    "finalized_at_epoch",
    "released_at_epoch",
  ],
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

  it("renames only the seeded flagship meeting purpose", async () => {
    const migrations = await readMigrations();
    const renameMigration = migrations.find(
      ({ name }) => name === "0013_rename_flagship_meeting.sql",
    );
    const database = createD1CompatibleDatabase();

    try {
      if (renameMigration === undefined) {
        throw new Error("Missing flagship rename migration 0013");
      }
      for (const migration of migrations) {
        if (migration.name === renameMigration.name) {
          break;
        }
        database.exec(migration.sql);
      }
      database.exec(`
        INSERT INTO meetings (
          meeting_id,
          code,
          created_by_user_id,
          facilitator_participant_id,
          purpose
        ) VALUES (
          'meeting-unrelated',
          'UNRELATED',
          'product',
          'participant-product',
          'Work & Productivity — Global AI Product Rollout'
        );
      `);

      database.exec(renameMigration.sql);
      database.exec(renameMigration.sql);

      expect(
        database
          .prepare("SELECT purpose FROM meetings WHERE meeting_id = ?")
          .get("meeting-global-ai-rollout"),
      ).toEqual({ purpose: "Global AI Product Rollout" });
      expect(
        database
          .prepare("SELECT purpose FROM meetings WHERE meeting_id = ?")
          .get("meeting-unrelated"),
      ).toEqual({
        purpose: "Work & Productivity — Global AI Product Rollout",
      });
    } finally {
      database.close();
    }
  });

  it("backfills legacy managed-AI claims once without rewriting lifecycle", async () => {
    const migrations = await readMigrations();
    const lifecycleMigration = migrations.find(
      ({ name }) => name === "0011_judge_managed_ai_operation_lifecycle.sql",
    );
    const database = createD1CompatibleDatabase();
    const claimKeyHash =
      "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    try {
      if (lifecycleMigration === undefined) {
        throw new Error("Missing lifecycle migration 0011");
      }
      for (const migration of migrations) {
        if (migration.name === lifecycleMigration.name) {
          break;
        }
        database.exec(migration.sql);
      }
      database.exec(`
        INSERT INTO judge_managed_ai_operation_claims (
          claim_key_hash,
          request_fingerprint,
          operation,
          model,
          pricing_version,
          created_at_epoch,
          expires_at_epoch
        ) VALUES (
          '${claimKeyHash}',
          'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          'private_disclosure',
          'gpt-5.6-sol',
          'openai-2026-07-20',
          100000,
          100300
        );
      `);

      database.exec(lifecycleMigration.sql);
      expect(
        database
          .prepare(
            `
              SELECT *
              FROM judge_managed_ai_operation_lifecycle
              WHERE claim_key_hash = ?
            `,
          )
          .get(claimKeyHash) as unknown as ManagedAiLifecycleRow,
      ).toEqual({
        claim_key_hash: claimKeyHash,
        lease_expires_at_epoch: null,
        provider_started_at_epoch: null,
        reservation_id: null,
        reuse_after_epoch: null,
        settled_at_epoch: null,
        status: "legacy_blocked",
      });

      database
        .prepare(
          `
            UPDATE judge_managed_ai_operation_lifecycle
            SET
              status = 'reserved',
              reservation_id = 'reservation-preserved',
              lease_expires_at_epoch = 100500
            WHERE claim_key_hash = ?
          `,
        )
        .run(claimKeyHash);
      database.exec(lifecycleMigration.sql);

      expect(
        database
          .prepare(
            `
              SELECT *
              FROM judge_managed_ai_operation_lifecycle
              WHERE claim_key_hash = ?
            `,
          )
          .get(claimKeyHash) as unknown as ManagedAiLifecycleRow,
      ).toEqual({
        claim_key_hash: claimKeyHash,
        lease_expires_at_epoch: 100500,
        provider_started_at_epoch: null,
        reservation_id: "reservation-preserved",
        reuse_after_epoch: null,
        settled_at_epoch: null,
        status: "reserved",
      });

      for (const invalidMutation of [
        "UPDATE judge_managed_ai_operation_lifecycle SET status = 'unknown' WHERE claim_key_hash = ?",
        "UPDATE judge_managed_ai_operation_lifecycle SET status = 'reserved', reservation_id = NULL, lease_expires_at_epoch = NULL WHERE claim_key_hash = ?",
        "UPDATE judge_managed_ai_operation_lifecycle SET status = 'provider_started', provider_started_at_epoch = NULL WHERE claim_key_hash = ?",
        "UPDATE judge_managed_ai_operation_lifecycle SET status = 'settled', settled_at_epoch = NULL, reuse_after_epoch = NULL WHERE claim_key_hash = ?",
        "UPDATE judge_managed_ai_operation_lifecycle SET status = 'settled', settled_at_epoch = 100600, reuse_after_epoch = 100600 WHERE claim_key_hash = ?",
      ]) {
        expect(() =>
          database.prepare(invalidMutation).run(claimKeyHash),
        ).toThrow();
      }

      database.exec(`
        INSERT INTO judge_managed_ai_operation_claims (
          claim_key_hash,
          request_fingerprint,
          operation,
          model,
          pricing_version,
          created_at_epoch,
          expires_at_epoch
        ) VALUES (
          'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
          'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
          'decision_synthesis',
          'gpt-5.6-sol',
          'openai-2026-07-20',
          100000,
          100300
        );
      `);
      expect(() =>
        database
          .prepare(
            `
              UPDATE judge_managed_ai_operation_lifecycle
              SET claim_key_hash =
                'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
              WHERE claim_key_hash = ?
            `,
          )
          .run(claimKeyHash),
      ).toThrow("counterpoint_managed_ai_lifecycle_claim_key_immutable");
      expect(() =>
        database.exec(`
          INSERT INTO judge_managed_ai_operation_lifecycle (
            claim_key_hash,
            status,
            reservation_id,
            lease_expires_at_epoch
          ) VALUES (
            'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
            'reserved',
            'reservation-preserved',
            100500
          );
        `),
      ).toThrow();

      database
        .prepare(
          "DELETE FROM judge_managed_ai_operation_claims WHERE claim_key_hash = ?",
        )
        .run(claimKeyHash);
      expect(
        database
          .prepare(
            `
              SELECT COUNT(*) AS count
              FROM judge_managed_ai_operation_lifecycle
              WHERE claim_key_hash = ?
            `,
          )
          .get(claimKeyHash),
      ).toEqual({ count: 0 });
    } finally {
      database.close();
    }
  });

  it("aligns D1 tables and columns explicitly with the Node schema", async () => {
    const migrations = await readMigrations();
    const d1Database = createD1CompatibleDatabase();
    const nodeDatabase = new NodeSqliteDatabase(":memory:");
    const expectedTableNames = Object.keys(expectedTableColumns).sort();
    const sharedTableNames = expectedTableNames.filter(
      (name) =>
        name !== "judge_managed_ai_operation_claims" &&
        name !== "judge_managed_ai_operation_lifecycle" &&
        name !== "judge_managed_realtime_calls" &&
        name !== "judge_managed_realtime_start_claims" &&
        name !== "judge_usage_reservations",
    );

    try {
      applyMigrationPlanOnce(d1Database, migrations);

      const d1Columns = tableColumnMap(d1Database, expectedTableNames);
      const nodeTableNames = userTableNames(
        nodeDatabase.database,
        new Set(["schema_migrations"]),
      );
      const nodeColumns = tableColumnMap(nodeDatabase.database, nodeTableNames);
      const sharedD1Columns = tableColumnMap(d1Database, sharedTableNames);

      expect(userTableNames(d1Database)).toEqual(expectedTableNames);
      expect(nodeTableNames).toEqual(sharedTableNames);
      expect(d1Columns).toEqual(expectedTableColumns);
      expect(sharedD1Columns).toEqual(nodeColumns);
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
        "judge_managed_ai_operation_claims_expiry",
        "judge_managed_ai_operation_lifecycle_stale",
        "judge_managed_realtime_calls_active_expiry",
        "judge_managed_realtime_calls_owner",
        "judge_managed_realtime_start_claims_expiry",
        "judge_usage_reservations_account_window",
        "judge_usage_reservations_active",
        "judge_usage_reservations_ip_window",
        "judge_usage_reservations_meeting_window",
        "judge_usage_reservations_request",
        "judge_usage_reservations_rolling",
        "participant_assignments_user",
        "sessions_user_activity",
      ]);
      const requestIndex = database
        .prepare(
          `
            SELECT sql
            FROM sqlite_schema
            WHERE type = 'index'
              AND name = 'judge_usage_reservations_request'
          `,
        )
        .get() as { readonly sql: string } | undefined;
      expect(requestIndex?.sql.replaceAll(/\s+/gu, " ").trim()).toContain(
        "WHERE status = 'reserved'",
      );
      expect(triggerNames(database)).toEqual([
        "event_appends_complete_range",
        "events_contiguous_position",
        "judge_managed_ai_operation_claims_key_immutable",
        "judge_managed_ai_operation_lifecycle_key_immutable",
        "judge_managed_realtime_calls_owner_immutable",
        "judge_managed_realtime_calls_reservation_guard",
        "judge_managed_realtime_calls_terminal",
        "judge_managed_realtime_start_claims_scope_immutable",
        "judge_usage_reservations_global_cost_insert",
        "judge_usage_reservations_global_cost_update",
        "judge_usage_reservations_monotonic_insert",
        "judge_usage_reservations_monotonic_update",
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
      database.exec(`
        INSERT INTO judge_managed_ai_operation_claims (
          claim_key_hash,
          request_fingerprint,
          operation,
          model,
          pricing_version,
          created_at_epoch,
          expires_at_epoch
        ) VALUES (
          'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          'private_disclosure',
          'gpt-5.6-sol',
          'openai-2026-07-20',
          100000,
          100300
        );
      `);
      expect(() =>
        database.exec(`
          INSERT INTO judge_managed_ai_operation_claims (
            claim_key_hash,
            request_fingerprint,
            operation,
            model,
            pricing_version,
            created_at_epoch,
            expires_at_epoch
          ) VALUES (
            'sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
            'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
            'private_disclosure',
            'gpt-5.6-sol',
            'openai-2026-07-20',
            100000,
            100300
          );
        `),
      ).toThrow();
      expect(() =>
        database.exec(`
          UPDATE judge_managed_ai_operation_claims
          SET claim_key_hash =
            'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
          WHERE operation = 'private_disclosure';
        `),
      ).toThrow("counterpoint_managed_ai_claim_key_immutable");
      for (const invalidValues of [
        {
          claimKeyHash:
            "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
          createdAtEpoch: "100000",
          expiresAtEpoch: "99999",
          operation: "private disclosure",
          requestFingerprint:
            "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
        },
        {
          claimKeyHash:
            "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
          createdAtEpoch: "'not-an-integer'",
          expiresAtEpoch: "100300",
          operation: "private_disclosure",
          requestFingerprint:
            "sha256:FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF",
        },
        {
          claimKeyHash:
            "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
          createdAtEpoch: "9007199254740992",
          expiresAtEpoch: "9007199254740992",
          operation: "private_disclosure",
          requestFingerprint:
            "sha256:1111111111111111111111111111111111111111111111111111111111111111",
        },
      ]) {
        expect(() =>
          database.exec(`
            INSERT INTO judge_managed_ai_operation_claims (
              claim_key_hash,
              request_fingerprint,
              operation,
              model,
              pricing_version,
              created_at_epoch,
              expires_at_epoch
            ) VALUES (
              '${invalidValues.claimKeyHash}',
              '${invalidValues.requestFingerprint}',
              '${invalidValues.operation}',
              'gpt-5.6-sol',
              'openai-2026-07-20',
              ${invalidValues.createdAtEpoch},
              ${invalidValues.expiresAtEpoch}
            );
          `),
        ).toThrow();
      }

      expect(() =>
        database.exec(`
          INSERT INTO users (user_id, password_hash, active)
          VALUES ('user-invalid', 'hash-invalid', 2);
        `),
      ).toThrow();
      database.exec(`
        INSERT INTO judge_usage_reservations (
          reservation_id,
          request_fingerprint,
          account_id,
          ip_hash,
          meeting_id,
          operation,
          model,
          pricing_version,
          status,
          reserved_cost_micro_usd,
          reserved_input_tokens,
          reserved_output_tokens,
          reserved_generation_count,
          reserved_realtime_seconds,
          reserved_at_epoch,
          active_until_epoch
        ) VALUES (
          'usage-exact-cap',
          'request-exact-cap',
          'user-a',
          'hmac-sha256:0000000000000000000000000000000000000000000000000000000000000000',
          'meeting-a',
          'responses',
          'model-a',
          '2026-07-19',
          'reserved',
          25000000,
          0,
          0,
          0,
          0,
          100000,
          100300
        );
      `);
      database.exec(`
        INSERT INTO participant_assignments (
          meeting_id,
          participant_id,
          user_id,
          role
        ) VALUES ('meeting-a', 'participant-a', 'user-a', 'facilitator');
        INSERT INTO sessions (
          session_id,
          token_hash,
          user_id,
          created_at,
          last_activity_at,
          absolute_expires_at
        ) VALUES (
          'session-a',
          'token-hash-a',
          'user-a',
          '2026-07-19T00:00:00.000Z',
          '2026-07-19T00:00:00.000Z',
          '2026-07-20T00:00:00.000Z'
        );
        INSERT INTO judge_managed_realtime_calls (
          managed_call_id,
          reservation_id,
          account_id,
          meeting_id,
          user_id,
          session_id,
          participant_id,
          channel,
          status,
          created_at_epoch,
          expires_at_epoch
        ) VALUES (
          'managed-call-a',
          'usage-exact-cap',
          'user-a',
          'meeting-a',
          'user-a',
          'session-a',
          'participant-a',
          'private',
          'active',
          100000,
          100060
        );
      `);
      expect(() =>
        database.exec(`
          INSERT INTO judge_managed_realtime_calls (
            managed_call_id,
            reservation_id,
            account_id,
            meeting_id,
            user_id,
            session_id,
            participant_id,
            channel,
            status,
            created_at_epoch,
            expires_at_epoch
          ) VALUES (
            'managed-call-b',
            'usage-exact-cap',
            'account-a',
            'meeting-a',
            'user-a',
            'session-a',
            'participant-a',
            'shared',
            'active',
            100000,
            100060
          );
        `),
      ).toThrow();
      expect(() =>
        database.exec(`
          UPDATE judge_managed_realtime_calls
          SET participant_id = 'participant-mutated'
          WHERE managed_call_id = 'managed-call-a';
        `),
      ).toThrow("counterpoint_managed_call_owner_immutable");
      database.exec(`
        UPDATE judge_managed_realtime_calls
        SET status = 'terminated', terminated_at_epoch = 100030
        WHERE managed_call_id = 'managed-call-a';
      `);
      expect(() =>
        database.exec(`
          UPDATE judge_managed_realtime_calls
          SET status = 'active', terminated_at_epoch = NULL
          WHERE managed_call_id = 'managed-call-a';
        `),
      ).toThrow("counterpoint_managed_call_invalid_transition");
      expect(() =>
        database.exec(`
          INSERT INTO judge_usage_reservations (
            reservation_id,
            request_fingerprint,
            account_id,
            ip_hash,
            meeting_id,
            operation,
            model,
            pricing_version,
            status,
            reserved_cost_micro_usd,
            reserved_input_tokens,
            reserved_output_tokens,
            reserved_generation_count,
            reserved_realtime_seconds,
            reserved_at_epoch,
            active_until_epoch
          ) VALUES (
            'usage-over-cap',
            'request-over-cap',
            'account-b',
            'hmac-sha256:0000000000000000000000000000000000000000000000000000000000000001',
            'meeting-b',
            'responses',
            'model-a',
            '2026-07-19',
            'reserved',
            1,
            0,
            0,
            0,
            0,
            100001,
            100301
          );
        `),
      ).toThrow("counterpoint_judge_usage_global_cost_limit");
      expect(() =>
        database.exec(`
          INSERT INTO judge_usage_reservations (
            reservation_id,
            request_fingerprint,
            account_id,
            ip_hash,
            meeting_id,
            operation,
            model,
            pricing_version,
            status,
            reserved_cost_micro_usd,
            reserved_input_tokens,
            reserved_output_tokens,
            reserved_generation_count,
            reserved_realtime_seconds,
            reserved_at_epoch,
            active_until_epoch
          ) VALUES (
            'usage-out-of-order',
            'request-out-of-order',
            'account-c',
            'hmac-sha256:0000000000000000000000000000000000000000000000000000000000000002',
            'meeting-c',
            'responses',
            'model-a',
            '2026-07-19',
            'reserved',
            0,
            0,
            0,
            0,
            0,
            99999,
            100299
          );
        `),
      ).toThrow("counterpoint_judge_usage_timestamp_regression");
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
            'session-invalid',
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
