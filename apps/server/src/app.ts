import { createHash } from "node:crypto";

import type { Context } from "hono";
import { Hono } from "hono";
import type { ZodType } from "zod";

import {
  approveDisclosure,
  authenticateSession,
  createMeeting,
  joinMeetingByCode,
  listAssignedMeetings,
  login,
  logout,
  previewDisclosure,
  proposeDisclosure,
  registerPrivateTextSource,
  rejectDisclosure,
  resolveMeetingAuthorization,
  userAuthorizationContext,
  type DisclosureFailure,
} from "@counterpoint/application";
import type {
  IdGenerator,
  MeetingRecord,
  ParticipantAssignment,
  SessionRecord,
} from "@counterpoint/ports";
import {
  ApproveDisclosureRequestSchema,
  ApproveDisclosureResponseSchema,
  CreateMeetingRequestSchema,
  CreateMeetingResponseSchema,
  createErrorEnvelope,
  CURRENT_PROTOCOL_VERSION,
  HealthResponseSchema,
  JoinMeetingByCodeRequestSchema,
  JoinMeetingByCodeResponseSchema,
  ListAssignedMeetingsResponseSchema,
  ListSharedEvidenceResponseSchema,
  LoginRequestSchema,
  LoginResponseSchema,
  LogoutRequestSchema,
  LogoutResponseSchema,
  PreviewDisclosureRequestSchema,
  PreviewDisclosureResponseSchema,
  ProposeDisclosureRequestSchema,
  ProposeDisclosureResponseSchema,
  ReadinessResponseSchema,
  RegisterPrivateTextSourceFixtureRequestSchema,
  RegisterPrivateTextSourceFixtureResponseSchema,
  RejectDisclosureRequestSchema,
  RejectDisclosureResponseSchema,
  RoleProjectionQuerySchema,
  type ErrorCode,
} from "@counterpoint/protocol";

import type { ServerRuntime } from "./runtime.js";

interface AppEnvironment {
  Variables: {
    correlationId: string;
  };
}

type AppContext = Context<AppEnvironment>;

interface MeetingCreationInput {
  readonly idempotencyKey: string;
  readonly purpose: string;
  readonly users: readonly {
    readonly role: "facilitator" | "participant";
    readonly userId: string;
  }[];
}

const STATUS_BY_CODE: Readonly<
  Record<ErrorCode, 400 | 401 | 403 | 404 | 409 | 429 | 500 | 503>
> = {
  API_KEY_REQUIRED: 400,
  ARTIFACT_STORAGE_UNAVAILABLE: 503,
  ARTIFACT_TOO_LARGE: 400,
  ARTIFACT_TYPE_UNSUPPORTED: 400,
  AUTHENTICATION_REQUIRED: 401,
  CONFLICT: 409,
  DISCLOSURE_PREVIEW_MISMATCH: 409,
  DISPLAY_TOKEN_EXPIRED: 401,
  FORBIDDEN: 403,
  IDEMPOTENCY_CONFLICT: 409,
  INVALID_STATE_TRANSITION: 409,
  JUDGE_MODE_FORBIDDEN: 403,
  MEETING_NOT_FOUND: 404,
  OPENAI_UNAVAILABLE: 503,
  REALTIME_UNAVAILABLE: 503,
  SESSION_EXPIRED: 401,
  SHARED_FLOOR_BUSY: 409,
  URL_BLOCKED: 400,
  USAGE_LIMIT_REACHED: 429,
  VALIDATION_FAILED: 400,
  WEBHOOK_SIGNATURE_INVALID: 403,
};

class RequestScopedIdGenerator implements IdGenerator {
  readonly #counts = new Map<string, number>();
  readonly #seed: string;

  constructor(userId: string, idempotencyKey: string) {
    this.#seed = `${userId}\u0000${idempotencyKey}`;
  }

  next(namespace: string): string {
    const index = this.#counts.get(namespace) ?? 0;
    this.#counts.set(namespace, index + 1);
    return this.value(namespace, index);
  }

  value(namespace: string, index: number): string {
    const digest = createHash("sha256")
      .update(`${this.#seed}\u0000${namespace}\u0000${String(index)}`)
      .digest("base64url")
      .slice(0, 24);
    return `${namespace}_${digest}`;
  }
}

function normalizedAssignments(
  assignments: readonly Pick<
    ParticipantAssignment,
    "active" | "role" | "userId"
  >[],
): string {
  return JSON.stringify(
    assignments
      .filter(({ active }) => active)
      .map(({ role, userId }) => ({ role, userId }))
      .sort((left, right) => left.userId.localeCompare(right.userId)),
  );
}

function normalizedInputUsers(input: MeetingCreationInput): string {
  return JSON.stringify(
    input.users
      .map(({ role, userId }) => ({ role, userId }))
      .sort((left, right) => left.userId.localeCompare(right.userId)),
  );
}

function meetingCreationBody(
  context: AppContext,
  meeting: MeetingRecord,
  assignments: readonly ParticipantAssignment[],
) {
  return CreateMeetingResponseSchema.parse({
    assignments: assignments.map(({ participantId, role, userId }) => ({
      participantId,
      role,
      userId,
    })),
    code: meeting.code,
    correlationId: context.get("correlationId"),
    meetingId: meeting.meetingId,
    phase: "preparing",
    position: 0,
    purpose: meeting.purpose,
  });
}

async function replayedMeeting(
  runtime: ServerRuntime,
  meetingId: string,
  creatorUserId: string,
  input: MeetingCreationInput,
): Promise<
  | {
      readonly assignments: readonly ParticipantAssignment[];
      readonly kind: "replayed";
      readonly meeting: MeetingRecord;
    }
  | { readonly kind: "conflict" }
  | undefined
> {
  const meeting = await runtime.meetings.findById(meetingId);
  if (meeting === undefined) {
    return undefined;
  }
  const assignments = await runtime.meetings.listAssignments(meetingId);
  if (
    meeting.createdByUserId !== creatorUserId ||
    meeting.purpose !== input.purpose.trim() ||
    normalizedAssignments(assignments) !== normalizedInputUsers(input)
  ) {
    return { kind: "conflict" };
  }
  return { assignments, kind: "replayed", meeting };
}

function errorResponse(
  context: AppContext,
  code: ErrorCode,
  details: unknown = {},
) {
  return context.json(
    createErrorEnvelope({
      code,
      correlationId: context.get("correlationId"),
      details,
    }),
    STATUS_BY_CODE[code],
  );
}

async function parseJson<T>(
  context: AppContext,
  schema: ZodType<T>,
): Promise<
  { readonly kind: "parsed"; readonly value: T } | { readonly kind: "rejected" }
> {
  let input: unknown;
  try {
    input = await context.req.json();
  } catch {
    return { kind: "rejected" };
  }
  const parsed = schema.safeParse(input);
  return parsed.success
    ? { kind: "parsed", value: parsed.data }
    : { kind: "rejected" };
}

function bearerToken(context: AppContext): string | undefined {
  const authorization = context.req.header("authorization");
  const matched = /^Bearer ([A-Za-z0-9_-]{16,4096})$/u.exec(
    authorization ?? "",
  );
  return matched?.[1];
}

async function authenticatedSession(
  context: AppContext,
  runtime: ServerRuntime,
): Promise<
  | {
      readonly bearerToken: string;
      readonly kind: "authenticated";
      readonly session: SessionRecord;
    }
  | {
      readonly code: "AUTHENTICATION_REQUIRED" | "SESSION_EXPIRED";
      readonly kind: "rejected";
    }
> {
  const token = bearerToken(context);
  if (token === undefined) {
    return { code: "AUTHENTICATION_REQUIRED", kind: "rejected" };
  }
  const result = await authenticateSession(runtime, token);
  return result.kind === "authenticated"
    ? {
        bearerToken: token,
        kind: "authenticated",
        session: result.session,
      }
    : result;
}

async function assignedMeeting(
  runtime: ServerRuntime,
  meetingId: string,
  userId: string,
) {
  const assignment = await runtime.meetings.findAssignment(meetingId, userId);
  const meeting = await runtime.meetings.findById(meetingId);
  if (assignment === undefined || meeting === undefined) {
    return undefined;
  }
  const position = await participantVisiblePosition(
    runtime,
    meetingId,
    assignment.participantId,
  );
  return {
    meetingId: meeting.meetingId,
    participantId: assignment.participantId,
    phase: "preparing" as const,
    position,
    purpose: meeting.purpose,
    role: assignment.role,
  };
}

async function participantVisiblePosition(
  runtime: ServerRuntime,
  meetingId: string,
  participantId: string,
): Promise<number> {
  const records = await runtime.disclosures.events.load(meetingId);
  return records.filter(
    ({ event }) =>
      event.visibility === "shared" ||
      event.ownerParticipantId === participantId,
  ).length;
}

function disclosureFailureResponse(
  context: AppContext,
  failure: DisclosureFailure,
) {
  return errorResponse(context, failure.code);
}

export function createServerApp(runtime: ServerRuntime): Hono<AppEnvironment> {
  const app = new Hono<AppEnvironment>();

  app.use("*", async (context, next) => {
    const correlationId = runtime.ids.next("correlation");
    context.set("correlationId", correlationId);
    await next();
    context.header("x-correlation-id", correlationId);
    context.header("cache-control", "no-store");
  });

  const health = (context: AppContext) =>
    context.json(
      HealthResponseSchema.parse({
        checkedAt: runtime.clock.now(),
        protocolVersion: CURRENT_PROTOCOL_VERSION,
        status: "ok",
      }),
    );
  const readiness = (context: AppContext) => {
    const response = ReadinessResponseSchema.parse({
      checkedAt: runtime.clock.now(),
      dependencies: [
        { name: "database", status: "available" },
        {
          name: "artifact_storage",
          status: runtime.artifactStorageAvailable
            ? "available"
            : "unavailable",
        },
        { name: "realtime", status: "degraded", message: "Not started in M2." },
        {
          name: "openai",
          status: runtime.openAiConfigured ? "available" : "not_configured",
        },
      ],
      migrationsCurrent: runtime.migrationsCurrent,
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      status:
        runtime.migrationsCurrent && runtime.artifactStorageAvailable
          ? "ready"
          : "not_ready",
    });
    return context.json(response, response.status === "ready" ? 200 : 503);
  };

  app.get("/health", health);
  app.get("/ready", readiness);
  app.get("/api/v1/health", health);
  app.get("/api/v1/ready", readiness);

  app.post("/api/v1/login", async (context) => {
    const request = await parseJson(context, LoginRequestSchema);
    if (request.kind === "rejected") {
      return errorResponse(context, "VALIDATION_FAILED");
    }
    const result = await login(runtime, request.value);
    if (result.kind === "rejected") {
      return errorResponse(context, result.code);
    }
    return context.json(
      LoginResponseSchema.parse({
        bearerToken: result.bearerToken,
        correlationId: context.get("correlationId"),
        expiresAt: result.expiresAt,
        userId: result.userId,
      }),
    );
  });

  app.post("/api/v1/logout", async (context) => {
    const request = await parseJson(context, LogoutRequestSchema);
    if (request.kind === "rejected") {
      return errorResponse(context, "VALIDATION_FAILED");
    }
    const authenticated = await authenticatedSession(context, runtime);
    if (authenticated.kind === "rejected") {
      return errorResponse(context, authenticated.code);
    }
    await logout(runtime, authenticated.bearerToken);
    return context.json(
      LogoutResponseSchema.parse({
        correlationId: context.get("correlationId"),
        loggedOutAt: runtime.clock.now(),
      }),
    );
  });

  app.get("/api/v1/meetings", async (context) => {
    const authenticated = await authenticatedSession(context, runtime);
    if (authenticated.kind === "rejected") {
      return errorResponse(context, authenticated.code);
    }
    const meetings = await listAssignedMeetings(
      runtime.meetings,
      authenticated.session.userId,
    );
    const assigned = await Promise.all(
      meetings.map(({ meetingId }) =>
        assignedMeeting(runtime, meetingId, authenticated.session.userId),
      ),
    );
    return context.json(
      ListAssignedMeetingsResponseSchema.parse({
        correlationId: context.get("correlationId"),
        meetings: assigned.filter(
          (meeting): meeting is NonNullable<typeof meeting> =>
            meeting !== undefined,
        ),
      }),
    );
  });

  app.post("/api/v1/meetings", async (context) => {
    const authenticated = await authenticatedSession(context, runtime);
    if (authenticated.kind === "rejected") {
      return errorResponse(context, authenticated.code);
    }
    const request = await parseJson(context, CreateMeetingRequestSchema);
    if (request.kind === "rejected") {
      return errorResponse(context, "VALIDATION_FAILED");
    }
    if (!runtime.facilitatorUserIds.has(authenticated.session.userId)) {
      return errorResponse(context, "FORBIDDEN");
    }
    const requestIds = new RequestScopedIdGenerator(
      authenticated.session.userId,
      request.value.idempotencyKey,
    );
    const deterministicMeetingId = requestIds.value("meeting", 0);
    const previous = await replayedMeeting(
      runtime,
      deterministicMeetingId,
      authenticated.session.userId,
      request.value,
    );
    if (previous?.kind === "conflict") {
      return errorResponse(context, "IDEMPOTENCY_CONFLICT");
    }
    if (previous?.kind === "replayed") {
      return context.json(
        meetingCreationBody(context, previous.meeting, previous.assignments),
        201,
      );
    }
    const contextForCreation = userAuthorizationContext({
      meetingId: "meeting-bootstrap",
      participantId: `participant-${authenticated.session.userId}`,
      role: "facilitator",
      sessionId: authenticated.session.sessionId,
      userId: authenticated.session.userId,
    });
    let result: Awaited<ReturnType<typeof createMeeting>>;
    try {
      result = await createMeeting(
        { ids: requestIds, meetings: runtime.meetings },
        contextForCreation,
        request.value,
      );
    } catch {
      const raced = await replayedMeeting(
        runtime,
        deterministicMeetingId,
        authenticated.session.userId,
        request.value,
      );
      if (raced?.kind === "replayed") {
        return context.json(
          meetingCreationBody(context, raced.meeting, raced.assignments),
          201,
        );
      }
      return errorResponse(
        context,
        raced?.kind === "conflict" ? "IDEMPOTENCY_CONFLICT" : "CONFLICT",
      );
    }
    if (result.kind === "rejected") {
      return errorResponse(context, result.code, {
        ...(result.code === "VALIDATION_FAILED"
          ? { reason: result.reason }
          : {}),
      });
    }
    return context.json(
      meetingCreationBody(context, result.meeting, result.assignments),
      201,
    );
  });

  app.post("/api/v1/meetings/join", async (context) => {
    const authenticated = await authenticatedSession(context, runtime);
    if (authenticated.kind === "rejected") {
      return errorResponse(context, authenticated.code);
    }
    const request = await parseJson(context, JoinMeetingByCodeRequestSchema);
    if (request.kind === "rejected") {
      return errorResponse(context, "VALIDATION_FAILED");
    }
    const result = await joinMeetingByCode(runtime.meetings, {
      code: request.value.code,
      sessionId: authenticated.session.sessionId,
      userId: authenticated.session.userId,
    });
    if (result.kind === "rejected") {
      return errorResponse(context, result.code);
    }
    const position = await participantVisiblePosition(
      runtime,
      result.meeting.meetingId,
      result.authorization.participantId,
    );
    return context.json(
      JoinMeetingByCodeResponseSchema.parse({
        capabilities: [...result.authorization.capabilities],
        correlationId: context.get("correlationId"),
        meeting: {
          meetingId: result.meeting.meetingId,
          participantId: result.authorization.participantId,
          phase: "preparing",
          position,
          purpose: result.meeting.purpose,
          role: result.authorization.role,
        },
        position,
      }),
    );
  });

  app.get("/api/v1/meetings/:meetingId/evidence", async (context) => {
    const query = RoleProjectionQuerySchema.safeParse({
      meetingId: context.req.param("meetingId"),
    });
    if (!query.success) {
      return errorResponse(context, "VALIDATION_FAILED");
    }
    const authenticated = await authenticatedSession(context, runtime);
    if (authenticated.kind === "rejected") {
      return errorResponse(context, authenticated.code);
    }
    const resolved = await resolveMeetingAuthorization(
      runtime.meetings,
      authenticated.session,
      query.data.meetingId,
    );
    if (resolved.kind === "rejected") {
      return errorResponse(context, resolved.code);
    }
    const records = await runtime.disclosures.events.load(query.data.meetingId);
    const evidence = records.flatMap(({ event }) =>
      event.eventType === "EvidenceShared" && event.visibility === "shared"
        ? [
            {
              createdAt: event.payload.evidence.createdAt,
              evidenceId: event.payload.evidence.id,
              exactSnippet: event.payload.evidence.exactSnippet,
              sourceArtifactId: event.payload.evidence.sourceArtifactId,
              sourceRange: event.payload.evidence.sourceRange,
            },
          ]
        : [],
    );
    return context.json(
      ListSharedEvidenceResponseSchema.parse({
        correlationId: context.get("correlationId"),
        evidence,
        meetingId: query.data.meetingId,
        position: await participantVisiblePosition(
          runtime,
          query.data.meetingId,
          resolved.authorization.participantId,
        ),
      }),
    );
  });

  app.post("/api/v1/disclosures/sources/text", async (context) => {
    const request = await parseJson(
      context,
      RegisterPrivateTextSourceFixtureRequestSchema,
    );
    if (request.kind === "rejected") {
      return errorResponse(context, "VALIDATION_FAILED");
    }
    const authenticated = await authenticatedSession(context, runtime);
    if (authenticated.kind === "rejected") {
      return errorResponse(context, authenticated.code);
    }
    const resolved = await resolveMeetingAuthorization(
      runtime.meetings,
      authenticated.session,
      request.value.meetingId,
    );
    if (resolved.kind === "rejected") {
      return errorResponse(context, resolved.code);
    }
    if (!runtime.artifactStorageAvailable) {
      return errorResponse(context, "ARTIFACT_STORAGE_UNAVAILABLE");
    }
    const result = await registerPrivateTextSource(
      runtime.disclosures,
      resolved.authorization,
      {
        ...request.value,
        correlationId: context.get("correlationId"),
        expectedPosition: await runtime.disclosures.events.position(
          request.value.meetingId,
        ),
      },
    );
    if (result.kind === "failed") {
      return disclosureFailureResponse(context, result);
    }
    return context.json(
      RegisterPrivateTextSourceFixtureResponseSchema.parse({
        correlationId: result.correlationId,
        meetingId: request.value.meetingId,
        position: await participantVisiblePosition(
          runtime,
          request.value.meetingId,
          resolved.authorization.participantId,
        ),
        source: result.source,
      }),
      201,
    );
  });

  app.post("/api/v1/disclosures/proposals", async (context) => {
    const request = await parseJson(context, ProposeDisclosureRequestSchema);
    if (request.kind === "rejected") {
      return errorResponse(context, "VALIDATION_FAILED");
    }
    const authenticated = await authenticatedSession(context, runtime);
    if (authenticated.kind === "rejected") {
      return errorResponse(context, authenticated.code);
    }
    const resolved = await resolveMeetingAuthorization(
      runtime.meetings,
      authenticated.session,
      request.value.meetingId,
    );
    if (resolved.kind === "rejected") {
      return errorResponse(context, resolved.code);
    }
    const result = await proposeDisclosure(
      runtime.disclosures,
      resolved.authorization,
      {
        ...request.value,
        correlationId: context.get("correlationId"),
        expectedPosition: await runtime.disclosures.events.position(
          request.value.meetingId,
        ),
      },
    );
    if (result.kind === "failed") {
      return disclosureFailureResponse(context, result);
    }
    return context.json(
      ProposeDisclosureResponseSchema.parse({
        candidate: result.candidate,
        correlationId: result.correlationId,
        meetingId: request.value.meetingId,
        position: await participantVisiblePosition(
          runtime,
          request.value.meetingId,
          resolved.authorization.participantId,
        ),
      }),
      201,
    );
  });

  app.post("/api/v1/disclosures/preview", async (context) => {
    const request = await parseJson(context, PreviewDisclosureRequestSchema);
    if (request.kind === "rejected") {
      return errorResponse(context, "VALIDATION_FAILED");
    }
    const authenticated = await authenticatedSession(context, runtime);
    if (authenticated.kind === "rejected") {
      return errorResponse(context, authenticated.code);
    }
    const resolved = await resolveMeetingAuthorization(
      runtime.meetings,
      authenticated.session,
      request.value.meetingId,
    );
    if (resolved.kind === "rejected") {
      return errorResponse(context, resolved.code);
    }
    const result = await previewDisclosure(
      runtime.disclosures,
      resolved.authorization,
      {
        ...request.value,
        correlationId: context.get("correlationId"),
        expectedPosition: await runtime.disclosures.events.position(
          request.value.meetingId,
        ),
      },
    );
    if (result.kind === "failed") {
      return disclosureFailureResponse(context, result);
    }
    return context.json(
      PreviewDisclosureResponseSchema.parse({
        candidateId: result.candidateId,
        correlationId: result.correlationId,
        meetingId: request.value.meetingId,
        outgoingPayload: result.outgoingPayload,
        position: await participantVisiblePosition(
          runtime,
          request.value.meetingId,
          resolved.authorization.participantId,
        ),
        previewHash: result.previewHash,
      }),
    );
  });

  app.post("/api/v1/disclosures/approve", async (context) => {
    const request = await parseJson(context, ApproveDisclosureRequestSchema);
    if (request.kind === "rejected") {
      return errorResponse(context, "VALIDATION_FAILED");
    }
    const authenticated = await authenticatedSession(context, runtime);
    if (authenticated.kind === "rejected") {
      return errorResponse(context, authenticated.code);
    }
    const resolved = await resolveMeetingAuthorization(
      runtime.meetings,
      authenticated.session,
      request.value.meetingId,
    );
    if (resolved.kind === "rejected") {
      return errorResponse(context, resolved.code);
    }
    const result = await approveDisclosure(
      runtime.disclosures,
      resolved.authorization,
      {
        ...request.value,
        correlationId: context.get("correlationId"),
        expectedPosition: await runtime.disclosures.events.position(
          request.value.meetingId,
        ),
      },
    );
    if (result.kind === "failed") {
      return disclosureFailureResponse(context, result);
    }
    return context.json(
      ApproveDisclosureResponseSchema.parse({
        candidateId: result.candidateId,
        correlationId: result.correlationId,
        evidence: result.evidence,
        meetingId: request.value.meetingId,
        position: await participantVisiblePosition(
          runtime,
          request.value.meetingId,
          resolved.authorization.participantId,
        ),
        previewHash: result.previewHash,
      }),
    );
  });

  app.post("/api/v1/disclosures/reject", async (context) => {
    const request = await parseJson(context, RejectDisclosureRequestSchema);
    if (request.kind === "rejected") {
      return errorResponse(context, "VALIDATION_FAILED");
    }
    const authenticated = await authenticatedSession(context, runtime);
    if (authenticated.kind === "rejected") {
      return errorResponse(context, authenticated.code);
    }
    const resolved = await resolveMeetingAuthorization(
      runtime.meetings,
      authenticated.session,
      request.value.meetingId,
    );
    if (resolved.kind === "rejected") {
      return errorResponse(context, resolved.code);
    }
    const result = await rejectDisclosure(
      runtime.disclosures,
      resolved.authorization,
      {
        candidateId: request.value.candidateId,
        correlationId: context.get("correlationId"),
        expectedPosition: await runtime.disclosures.events.position(
          request.value.meetingId,
        ),
        idempotencyKey: request.value.idempotencyKey,
        meetingId: request.value.meetingId,
        ...(request.value.reason === undefined
          ? {}
          : { reason: request.value.reason }),
      },
    );
    if (result.kind === "failed") {
      return disclosureFailureResponse(context, result);
    }
    return context.json(
      RejectDisclosureResponseSchema.parse({
        candidateId: result.candidateId,
        correlationId: result.correlationId,
        meetingId: request.value.meetingId,
        position: await participantVisiblePosition(
          runtime,
          request.value.meetingId,
          resolved.authorization.participantId,
        ),
        state: result.state,
      }),
    );
  });

  app.notFound((context) => errorResponse(context, "MEETING_NOT_FOUND"));
  app.onError((_error, context) => errorResponse(context, "CONFLICT"));
  return app;
}
