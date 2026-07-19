import {
  D1MeetingRepository,
  D1ManagedRealtimeCallOwnershipRepository,
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
import { resolveJudgeIpReservationInput } from "./judge-ip-reservation.js";
import { createJudgeRealtimeUsageLimiter } from "./judge-realtime-call-controller.js";
import { handleJudgeManagedRealtimeHttp } from "./judge-managed-realtime-http.js";
import type { JudgeRealtimeCallController } from "./judge-realtime-call-controller.js";
import {
  createWorkerFlagshipDependencies,
  handleWorkerFlagshipHttp,
} from "./worker-flagship-http.js";

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
  "0008_hosted_flagship_seed.sql",
] as const;

interface JudgeWorkerBindings {
  readonly JUDGE_IP_HMAC_SECRET?: string;
  readonly JUDGE_MANAGED_REALTIME_ROUTE_ENABLED?: string;
  readonly JUDGE_USER_ID?: string;
  readonly OPENAI_API_KEY_JUDGE?: string;
}

export type Env = Readonly<
  Omit<WorkerBindings, "JUDGE_MANAGED_REALTIME_ROUTE_ENABLED"> &
    JudgeWorkerBindings
>;

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

function judgeManagedRealtimeRouteEnabled(env: Env): boolean {
  return (
    String(env.JUDGE_MANAGED_REALTIME_ROUTE_ENABLED) === "enabled" &&
    judgeUserId(env) !== undefined &&
    nonEmptyTrimmed(env.OPENAI_API_KEY_JUDGE) &&
    nonEmptyTrimmed(env.JUDGE_IP_HMAC_SECRET)
  );
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
      if (url.pathname === "/api/v1/health") {
        return healthResponse();
      }
      if (url.pathname === "/api/v1/ready") {
        return readinessResponse(env);
      }
      const flagshipProjectionRoute =
        /^\/api\/v1\/meetings\/([^/]+)\/projection$/u.exec(url.pathname);
      const flagshipCollectionRoute =
        /^\/api\/v1\/meetings\/([^/]+)\/(evidence|decisions|external-events|invalidation-evaluations)$/u.exec(
          url.pathname,
        );
      const flagshipCollectionOperation =
        flagshipCollectionRoute === null
          ? undefined
          : (
              {
                decisions: "decisions",
                evidence: "evidence",
                "external-events": "external-events",
                "invalidation-evaluations": "invalidation-evaluations",
              } as const
            )[
              flagshipCollectionRoute[2] as
                | "decisions"
                | "evidence"
                | "external-events"
                | "invalidation-evaluations"
            ];
      const flagshipOperation =
        request.method === "POST" && url.pathname === "/api/v1/login"
          ? "login"
          : request.method === "POST" && url.pathname === "/api/v1/logout"
            ? "logout"
            : request.method === "POST" &&
                url.pathname === "/api/v1/disclosures/sources/text"
              ? "register-text-source"
              : request.method === "POST" &&
                  url.pathname === "/api/v1/disclosures/proposals"
                ? "propose-disclosure"
                : request.method === "POST" &&
                    url.pathname === "/api/v1/disclosures/preview"
                  ? "preview-disclosure"
                  : request.method === "POST" &&
                      url.pathname === "/api/v1/disclosures/approve"
                    ? "approve-disclosure"
                    : request.method === "POST" &&
                        url.pathname === "/api/v1/disclosures/reject"
                      ? "reject-disclosure"
                      : request.method === "GET" &&
                          url.pathname === "/api/v1/meetings"
                        ? "meetings"
                        : request.method === "GET" &&
                            flagshipProjectionRoute !== null
                          ? "projection"
                          : request.method === "GET" &&
                              flagshipCollectionOperation !== undefined
                            ? flagshipCollectionOperation
                            : undefined;
      if (flagshipOperation !== undefined) {
        const correlationId = crypto.randomUUID();
        let meetingId: string | undefined;
        if (flagshipProjectionRoute !== null) {
          try {
            meetingId = decodeURIComponent(flagshipProjectionRoute[1] ?? "");
          } catch {
            return apiErrorResponse("VALIDATION_FAILED", correlationId);
          }
        }
        if (flagshipCollectionRoute !== null) {
          try {
            meetingId = decodeURIComponent(flagshipCollectionRoute[1] ?? "");
          } catch {
            return apiErrorResponse("VALIDATION_FAILED", correlationId);
          }
        }
        return handleWorkerFlagshipHttp({
          correlationId,
          dependencies: createWorkerFlagshipDependencies(env),
          ...(meetingId === undefined ? {} : { meetingId }),
          operation: flagshipOperation,
          request,
        });
      }
      const realtimeClientSecretRoute =
        /^\/api\/v1\/meetings\/([^/]+)\/realtime\/client-secrets$/u.exec(
          url.pathname,
        );
      const managedRealtimeCallRoute =
        /^\/api\/v1\/meetings\/([^/]+)\/realtime\/calls(?:\/([^/]+)\/(turn|transcript|terminate))?$/u.exec(
          url.pathname,
        );
      if (request.method === "POST" && managedRealtimeCallRoute !== null) {
        const correlationId = crypto.randomUUID();
        if (!judgeManagedRealtimeRouteEnabled(env)) {
          return apiErrorResponse("REALTIME_UNAVAILABLE", correlationId);
        }
        let meetingId: string;
        let managedCallId: string | undefined;
        try {
          meetingId = decodeURIComponent(managedRealtimeCallRoute[1] ?? "");
          managedCallId =
            managedRealtimeCallRoute[2] === undefined
              ? undefined
              : decodeURIComponent(managedRealtimeCallRoute[2]);
        } catch {
          return apiErrorResponse("VALIDATION_FAILED", correlationId);
        }
        const operation = managedRealtimeCallRoute[3] ?? "start";
        if (
          operation !== "start" &&
          operation !== "turn" &&
          operation !== "transcript" &&
          operation !== "terminate"
        ) {
          return apiErrorResponse("VALIDATION_FAILED", correlationId);
        }
        const clock = { now: () => new Date().toISOString() };
        const tokens = new WebCryptoSessionTokenIssuer();
        const ipReservation =
          operation === "start"
            ? await resolveJudgeIpReservationInput(
                request,
                env.JUDGE_IP_HMAC_SECRET,
              )
            : undefined;
        const usage =
          ipReservation === undefined
            ? undefined
            : createJudgeRealtimeUsageLimiter(env.DB, {
                clock: clock.now,
                hashIp: ipReservation.hashIp,
                ids: (namespace) => `${namespace}-${crypto.randomUUID()}`,
              });
        return handleJudgeManagedRealtimeHttp({
          correlationId,
          dependencies: {
            authorizationPolicy: {
              judgeManagedAiUserIds: new Set([judgeUserId(env) ?? ""]),
            },
            clock,
            controllers: (reservationId) =>
              judgeRealtimeCallControllerFor(env, reservationId),
            ipReservation,
            meetings: new D1MeetingRepository(env.DB),
            ownerships: new D1ManagedRealtimeCallOwnershipRepository(env.DB),
            sessions: new D1SessionRepository(env.DB),
            tokens,
            usage,
          },
          managedCallId,
          meetingId,
          operation,
          request,
        });
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
