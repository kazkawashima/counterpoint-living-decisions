import {
  D1MeetingRepository,
  D1SessionRepository,
  WebCryptoSessionTokenIssuer,
} from "@counterpoint/adapters-cloudflare";
import { OpenAiRealtimeClientSecretIssuer } from "@counterpoint/adapters-openai";
import {
  apiErrorResponse,
  handleIssueRealtimeClientSecretHttp,
} from "@counterpoint/http-api";
import type {
  MeetingApiKeyLease,
  MeetingApiKeyLeaseConfigureResult,
  MeetingApiKeyLeaseMutationResult,
  MeetingApiKeyLeaseStore,
} from "@counterpoint/ports";
import {
  CURRENT_PROTOCOL_VERSION,
  HealthResponseSchema,
  ReadinessResponseSchema,
  createErrorEnvelope,
} from "@counterpoint/protocol";

import type { MeetingCoordinator } from "./meeting-coordinator.js";
import type { JudgeRealtimeCallController } from "./judge-realtime-call-controller.js";

export { JudgeRealtimeCallController } from "./judge-realtime-call-controller.js";
export { MeetingCoordinator } from "./meeting-coordinator.js";

const JSON_HEADERS = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
} as const;
const EXPECTED_D1_MIGRATIONS = [
  "0001_identity_and_meetings.sql",
  "0002_event_ledger_and_projections.sql",
  "0003_decisions_audit_and_artifacts.sql",
  "0004_bearer_sessions.sql",
  "0005_d1_append_guards.sql",
  "0006_judge_usage_reservations.sql",
  "0007_judge_managed_realtime_calls.sql",
] as const;

interface JudgeWorkerBindings {
  readonly JUDGE_IP_HMAC_SECRET?: string;
  readonly JUDGE_USER_ID?: string;
  readonly OPENAI_API_KEY_JUDGE?: string;
}

export type Env = Readonly<WorkerBindings & JudgeWorkerBindings>;

interface DependencyProbe {
  readonly available: boolean;
  readonly migrationsCurrent?: boolean;
}

interface MigrationRow {
  readonly name: string;
}

const unavailableLeases: MeetingApiKeyLeaseStore = {
  clear(): Promise<MeetingApiKeyLeaseMutationResult> {
    return Promise.resolve({ kind: "missing" });
  },
  clearBySession(): Promise<void> {
    return Promise.resolve();
  },
  configure(): Promise<MeetingApiKeyLeaseConfigureResult> {
    return Promise.reject(
      new Error("Worker BYOK configuration route is not available"),
    );
  },
  findByMeeting(): Promise<MeetingApiKeyLease | undefined> {
    return Promise.resolve(undefined);
  },
  heartbeat(): Promise<MeetingApiKeyLeaseMutationResult> {
    return Promise.resolve({ kind: "missing" });
  },
};

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, {
    headers: JSON_HEADERS,
    status,
  });
}

function nonEmptyTrimmed(value: string | undefined): value is string {
  return value !== undefined && value.length > 0 && value.trim() === value;
}

function judgeUserId(env: Env): string | undefined {
  return nonEmptyTrimmed(env.JUDGE_USER_ID) ? env.JUDGE_USER_ID : undefined;
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

export function judgeRealtimeCallControllerFor(
  env: Env,
  reservationId: string,
): DurableObjectStub<JudgeRealtimeCallController> {
  if (reservationId.trim().length === 0) {
    throw new TypeError("reservationId must not be empty");
  }
  return env.JUDGE_REALTIME_CALLS.get(
    env.JUDGE_REALTIME_CALLS.idFromName(reservationId),
  ) as DurableObjectStub<JudgeRealtimeCallController>;
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
  const judgeOpenAiConfigured =
    judgeUserId(env) !== undefined && nonEmptyTrimmed(env.OPENAI_API_KEY_JUDGE);
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
      {
        name: "openai",
        status: judgeOpenAiConfigured ? "available" : "not_configured",
      },
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
      const realtimeClientSecretRoute =
        /^\/api\/v1\/meetings\/([^/]+)\/realtime\/client-secrets$/u.exec(
          url.pathname,
        );
      const managedRealtimeCallRoute =
        /^\/api\/v1\/meetings\/[^/]+\/realtime\/calls$/u.test(url.pathname);
      if (request.method === "POST" && managedRealtimeCallRoute) {
        return apiErrorResponse("REALTIME_UNAVAILABLE", crypto.randomUUID());
      }
      if (
        request.method === "POST" &&
        realtimeClientSecretRoute?.[1] !== undefined
      ) {
        const correlationId = crypto.randomUUID();
        const tokens = new WebCryptoSessionTokenIssuer();
        const allowlistedJudgeUserId = judgeUserId(env);
        let meetingId: string;
        try {
          meetingId = decodeURIComponent(realtimeClientSecretRoute[1]);
        } catch {
          return apiErrorResponse("VALIDATION_FAILED", correlationId);
        }
        return handleIssueRealtimeClientSecretHttp({
          correlationId,
          dependencies: {
            authorizationPolicy:
              allowlistedJudgeUserId === undefined
                ? {}
                : {
                    judgeManagedAiUserIds: new Set([allowlistedJudgeUserId]),
                  },
            clock: { now: () => new Date().toISOString() },
            meetings: new D1MeetingRepository(env.DB),
            realtimeSecrets: {
              clock: { now: () => new Date().toISOString() },
              hashSafetyIdentifier: (value) => tokens.digest(value),
              issuer: new OpenAiRealtimeClientSecretIssuer(),
              leases: unavailableLeases,
            },
            sessions: new D1SessionRepository(env.DB),
            tokens,
          },
          meetingId,
          request,
        });
      }
      if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
        return apiParityPendingResponse();
      }
      return env.ASSETS.fetch(request);
    },
  };
}

export default createWorkerHandler();
