import { DurableObject } from "cloudflare:workers";

import {
  CURRENT_PROTOCOL_VERSION,
  HealthResponseSchema,
  ReadinessResponseSchema,
  createErrorEnvelope,
} from "@counterpoint/protocol";

const JSON_HEADERS = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
} as const;
const EXPECTED_D1_MIGRATIONS = [
  "0001_identity_and_meetings.sql",
  "0002_event_ledger_and_projections.sql",
  "0003_decisions_audit_and_artifacts.sql",
  "0004_bearer_sessions.sql",
] as const;

export type Env = Readonly<WorkerBindings>;

interface DependencyProbe {
  readonly available: boolean;
  readonly migrationsCurrent?: boolean;
}

interface MigrationRow {
  readonly name: string;
}

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, {
    headers: JSON_HEADERS,
    status,
  });
}

async function probeDatabase(database: D1Database): Promise<DependencyProbe> {
  try {
    const result = await database
      .prepare("SELECT name FROM d1_migrations ORDER BY id ASC")
      .all<MigrationRow>();
    const appliedNames = result.results.map(({ name }) => name);
    return {
      available: true,
      migrationsCurrent:
        appliedNames.length === EXPECTED_D1_MIGRATIONS.length &&
        EXPECTED_D1_MIGRATIONS.every(
          (name, index) => appliedNames[index] === name,
        ),
    };
  } catch {
    return { available: false, migrationsCurrent: false };
  }
}

async function probeArtifactStorage(bucket: R2Bucket): Promise<boolean> {
  try {
    await bucket.list({ limit: 1 });
    return true;
  } catch {
    return false;
  }
}

export function meetingCoordinatorFor(
  env: Env,
  meetingId: string,
): DurableObjectStub<MeetingCoordinator> {
  if (meetingId.trim().length === 0) {
    throw new TypeError("meetingId must not be empty");
  }
  return env.MEETINGS.get(
    env.MEETINGS.idFromName(meetingId),
  ) as DurableObjectStub<MeetingCoordinator>;
}

function healthResponse(): Response {
  return jsonResponse(
    HealthResponseSchema.parse({
      checkedAt: new Date().toISOString(),
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      status: "ok",
    }),
  );
}

async function readinessResponse(env: Env): Promise<Response> {
  const [database, artifactStorage] = await Promise.all([
    probeDatabase(env.DB),
    probeArtifactStorage(env.ARTIFACTS),
  ]);
  const realtime = env.MEETINGS !== undefined;
  const migrationsCurrent = database.migrationsCurrent === true;
  const ready =
    database.available && migrationsCurrent && artifactStorage && realtime;
  const body = ReadinessResponseSchema.parse({
    checkedAt: new Date().toISOString(),
    dependencies: [
      {
        name: "database",
        status: database.available ? "available" : "unavailable",
      },
      {
        name: "artifact_storage",
        status: artifactStorage ? "available" : "unavailable",
      },
      {
        name: "realtime",
        status: realtime ? "available" : "unavailable",
      },
      { name: "openai", status: "not_configured" },
    ],
    migrationsCurrent,
    protocolVersion: CURRENT_PROTOCOL_VERSION,
    status: ready ? "ready" : "not_ready",
  });
  return jsonResponse(body, ready ? 200 : 503);
}

function apiParityPendingResponse(): Response {
  const correlationId = crypto.randomUUID();
  return Response.json(
    createErrorEnvelope({
      code: "ARTIFACT_STORAGE_UNAVAILABLE",
      correlationId,
    }),
    {
      headers: {
        ...JSON_HEADERS,
        "x-correlation-id": correlationId,
      },
      status: 503,
    },
  );
}

export function createWorkerHandler(): ExportedHandler<Env> {
  return {
    async fetch(request, env) {
      const url = new URL(request.url);
      if (url.pathname === "/health") {
        return healthResponse();
      }
      if (url.pathname === "/ready") {
        return readinessResponse(env);
      }
      if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
        return apiParityPendingResponse();
      }
      return env.ASSETS.fetch(request);
    },
  };
}

export class MeetingCoordinator extends DurableObject<Env> {
  override fetch(request: Request): Response {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return jsonResponse({
        durableTruth: "d1",
        status: "ok",
      });
    }
    return jsonResponse(
      {
        code: "NOT_FOUND",
        message: "The meeting coordinator route was not found.",
      },
      404,
    );
  }
}

export default createWorkerHandler();
