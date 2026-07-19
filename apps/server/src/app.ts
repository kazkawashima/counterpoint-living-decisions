import { createHash } from "node:crypto";

import { upgradeWebSocket } from "@hono/node-server";
import type { Context } from "hono";
import { Hono } from "hono";
import type { ZodType } from "zod";

import {
  approveDisclosure,
  authorizeDisplayToken,
  authenticateSession,
  authenticateSessionById,
  acquireSharedFloor,
  captureUtterance,
  commitDecision,
  clearMeetingByok,
  clearMeetingByokLeasesBySession,
  configureMeetingByok,
  createMeeting,
  dispositionDecisionCandidate,
  evaluateAssumptionInvalidation,
  getPrivateArtifact,
  injectDemoRegulatoryChange,
  heartbeatMeetingByok,
  issueDisplayToken,
  issueRealtimeClientSecret,
  joinMeetingByCode,
  listAssignedMeetings,
  listAssumptionInvalidationEvaluations,
  login,
  logout,
  markDecisionReady,
  previewDisclosure,
  prepareSharedDecisionCandidate,
  proposeDisclosure,
  registerPrivateTextSource,
  rejectDisclosure,
  releaseSharedFloor,
  receiveRegulatoryChange,
  recommitDecision,
  rejectDecision,
  resetDemoMeeting,
  revokeDisplayToken,
  resolveMeetingAuthorization,
  reviewInvalidation,
  saveDecisionDraft,
  startDecisionMonitoring,
  supersedeDecision,
  uploadPrivateArtifact,
  userAuthorizationContext,
  type DecisionCandidateFailure,
  type DecisionFailure,
  type DecisionReviewResolutionFailure,
  type ArtifactIngestionFailure,
  type DisclosureFailure,
  type DisclosureDependencies,
  type InvalidationEvaluationView,
  type InvalidationReviewFailure,
  type UtteranceFailure,
} from "@counterpoint/application";
import { OpenAiCandidateError } from "@counterpoint/adapters-openai";
import {
  meetingId as domainMeetingId,
  meetingPosition,
  replayMeeting,
  type Decision as DomainDecision,
  type DecisionRevision as DomainDecisionRevision,
  type DomainEvent,
  type ExternalEvent as DomainExternalEvent,
} from "@counterpoint/domain";
import type {
  EventRecord,
  IdGenerator,
  MeetingRecord,
  ParticipantAssignment,
  SessionRecord,
} from "@counterpoint/ports";
import {
  ApproveDisclosureRequestSchema,
  ApproveDisclosureResponseSchema,
  AcquireSharedFloorRequestSchema,
  AcquireSharedFloorResponseSchema,
  CaptureUtteranceRequestSchema,
  CaptureUtteranceResponseSchema,
  ClearMeetingByokRequestSchema,
  ClearMeetingByokResponseSchema,
  CommitDecisionRequestSchema,
  CommitDecisionResponseSchema,
  ConfigureMeetingByokRequestSchema,
  ConfigureMeetingByokResponseSchema,
  CreateMeetingRequestSchema,
  CreateMeetingResponseSchema,
  createErrorEnvelope,
  CURRENT_PROTOCOL_VERSION,
  DecisionAuditQuerySchema,
  DecisionAuditResponseSchema,
  DecisionHistoryQuerySchema,
  DecisionHistoryResponseSchema,
  DecisionJsonExportQuerySchema,
  DecisionJsonExportResponseSchema,
  DownloadPrivateArtifactQuerySchema,
  DispositionSharedDecisionCandidateRequestSchema,
  DispositionSharedDecisionCandidateResponseSchema,
  FacilitatorDemoResetRequestSchema,
  FacilitatorDemoResetResponseSchema,
  HealthResponseSchema,
  HeartbeatMeetingByokRequestSchema,
  HeartbeatMeetingByokResponseSchema,
  InjectDemoRegulatoryChangeRequestSchema,
  InjectDemoRegulatoryChangeResponseSchema,
  IssueDisplayTokenRequestSchema,
  IssueDisplayTokenResponseSchema,
  IssueRealtimeClientSecretRequestSchema,
  IssueRealtimeClientSecretResponseSchema,
  JoinMeetingByCodeRequestSchema,
  JoinMeetingByCodeResponseSchema,
  ListAssignedMeetingsResponseSchema,
  ListInvalidationEvaluationsResponseSchema,
  ListSharedDecisionsResponseSchema,
  ListSharedEvidenceResponseSchema,
  ListSharedExternalEventsResponseSchema,
  LoginRequestSchema,
  LoginResponseSchema,
  LogoutRequestSchema,
  LogoutResponseSchema,
  MarkDecisionReadyRequestSchema,
  MarkDecisionReadyResponseSchema,
  PreviewDisclosureRequestSchema,
  PreviewDisclosureResponseSchema,
  ProposeDisclosureRequestSchema,
  ProposeDisclosureResponseSchema,
  ReadinessResponseSchema,
  RealtimeTicketRequestSchema,
  RealtimeTicketResponseSchema,
  RealtimeTicketSchema,
  ReleaseSharedFloorRequestSchema,
  ReleaseSharedFloorResponseSchema,
  RevokeDisplayTokenRequestSchema,
  RevokeDisplayTokenResponseSchema,
  RegisterPrivateTextSourceFixtureRequestSchema,
  RegisterPrivateTextSourceFixtureResponseSchema,
  RegulatoryChangeWebhookRequestSchema,
  RegulatoryChangeWebhookResponseSchema,
  RejectDisclosureRequestSchema,
  RejectDisclosureResponseSchema,
  ResolveDecisionReviewRequestSchema,
  ResolveDecisionReviewResponseSchema,
  ReviewInvalidationRequestSchema,
  ReviewInvalidationResponseSchema,
  RoleProjectionQuerySchema,
  RoleProjectionResponseSchema,
  SharedDisplayProjectionResponseSchema,
  SaveDecisionDraftRequestSchema,
  SaveDecisionDraftResponseSchema,
  SynthesizeSharedDecisionRequestSchema,
  SynthesizeSharedDecisionResponseSchema,
  UploadPrivateArtifactFieldsSchema,
  UploadPrivateArtifactResponseSchema,
  StartDecisionMonitoringRequestSchema,
  StartDecisionMonitoringResponseSchema,
  type ErrorCode,
} from "@counterpoint/protocol";

import type { RealtimeTicketRecord } from "./realtime.js";
import type { ServerRuntime } from "./runtime.js";
import {
  realtimeRoleProjectionFor,
  roleProjectionFor,
  sharedDisplayProjectionFor,
} from "./role-projection.js";

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
  return participantVisiblePositionAt(runtime, meetingId, participantId);
}

async function participantVisiblePositionAt(
  runtime: ServerRuntime,
  meetingId: string,
  participantId: string,
  throughGlobalPosition?: number,
): Promise<number> {
  const records = await runtime.disclosures.events.load(meetingId);
  return records.filter(
    ({ event, position }) =>
      (throughGlobalPosition === undefined ||
        position <= throughGlobalPosition) &&
      (event.visibility === "shared" ||
        event.ownerParticipantId === participantId),
  ).length;
}

async function realtimeAuthorization(
  runtime: ServerRuntime,
  ticket: RealtimeTicketRecord,
) {
  const authenticated = await authenticateSessionById(
    runtime,
    ticket.sessionId,
    { touchActivity: false },
  );
  if (
    authenticated.kind !== "authenticated" ||
    authenticated.session.userId !== ticket.userId
  ) {
    return undefined;
  }
  const resolved = await resolveMeetingAuthorization(
    runtime.meetings,
    authenticated.session,
    ticket.meetingId,
  );
  return resolved.kind === "authorized" &&
    resolved.authorization.participantId === ticket.participantId &&
    resolved.authorization.role === ticket.role
    ? resolved.authorization
    : undefined;
}

async function decisionMutationOccurredAt(
  runtime: ServerRuntime,
  meetingScope: string,
  key: string,
): Promise<string> {
  const records = await runtime.decisions.events.load(meetingScope);
  return (
    records.find(({ event }) => event.idempotencyKey === key)?.event
      .occurredAt ?? runtime.clock.now()
  );
}

function disclosureFailureResponse(
  context: AppContext,
  failure: DisclosureFailure,
) {
  return errorResponse(context, failure.code);
}

function decisionFailureResponse(
  context: AppContext,
  failure: DecisionFailure | DecisionCandidateFailure,
) {
  switch (failure.code) {
    case "CONFLICT":
      return errorResponse(context, "CONFLICT", {
        actualPosition: failure.actualPosition,
        expectedPosition: failure.expectedPosition,
      });
    case "FORBIDDEN":
    case "IDEMPOTENCY_CONFLICT":
    case "INVALID_STATE_TRANSITION":
    case "OPENAI_UNAVAILABLE":
      return errorResponse(context, failure.code);
    default:
      return errorResponse(context, "VALIDATION_FAILED");
  }
}

function invalidationReviewFailureResponse(
  context: AppContext,
  failure: InvalidationReviewFailure,
) {
  return failure.code === "CONFLICT"
    ? errorResponse(context, "CONFLICT", {
        actualPosition: failure.actualPosition,
        expectedPosition: failure.expectedPosition,
      })
    : failure.code === "FORBIDDEN" ||
        failure.code === "IDEMPOTENCY_CONFLICT" ||
        failure.code === "INVALID_STATE_TRANSITION"
      ? errorResponse(context, failure.code)
      : errorResponse(context, "VALIDATION_FAILED");
}

function utteranceFailureResponse(
  context: AppContext,
  failure: UtteranceFailure,
) {
  return failure.code === "CONFLICT"
    ? errorResponse(context, "CONFLICT", {
        actualPosition: failure.actualPosition,
        expectedPosition: failure.expectedPosition,
      })
    : errorResponse(context, failure.code);
}

function decisionReviewResolutionFailureResponse(
  context: AppContext,
  failure: DecisionReviewResolutionFailure,
) {
  return failure.code === "CONFLICT"
    ? errorResponse(context, "CONFLICT", {
        actualPosition: failure.actualPosition,
        expectedPosition: failure.expectedPosition,
      })
    : failure.code === "FORBIDDEN" ||
        failure.code === "IDEMPOTENCY_CONFLICT" ||
        failure.code === "INVALID_STATE_TRANSITION"
      ? errorResponse(context, failure.code)
      : errorResponse(context, "VALIDATION_FAILED");
}

function decisionReadiness(decision: DomainDecision) {
  return {
    actionIds: decision.actionIds.length > 0,
    evidenceIds: decision.evidenceIds.length > 0,
    monitorCondition: decision.monitorCondition.description.length > 0,
    outcome: decision.outcome.length > 0,
    premiseIds: decision.premiseIds.length > 0,
  };
}

function decisionView(
  decision: DomainDecision,
  updatedAt: string = decision.createdAt,
) {
  return {
    activeRevision: decision.activeRevision,
    activeRevisionId: decision.activeRevisionId,
    decisionId: decision.id,
    readiness: decisionReadiness(decision),
    snapshot: {
      actionIds: decision.actionIds,
      dissentIds: decision.dissentIds,
      evidenceIds: decision.evidenceIds,
      monitorCondition: decision.monitorCondition,
      outcome: decision.outcome,
      premiseIds: decision.premiseIds,
      status: decision.status,
      title: decision.title,
    },
    status: decision.status,
    ...(decision.supersededByDecisionId === undefined
      ? {}
      : { supersededByDecisionId: decision.supersededByDecisionId }),
    updatedAt,
  };
}

function decisionRevisionView(revision: DomainDecisionRevision) {
  return {
    changeReason: revision.changeReason,
    createdAt: revision.createdAt,
    createdBy: revision.createdBy,
    decisionId: revision.decisionId,
    ...(revision.previousRevisionId === undefined
      ? {}
      : { previousRevisionId: revision.previousRevisionId }),
    revisionId: revision.id,
    snapshot: revision.snapshot,
    version: revision.version,
  };
}

function externalEventReceiptView(event: DomainExternalEvent) {
  return {
    description: event.description,
    effectiveAt: event.effectiveAt,
    eventId: event.id,
    eventType: event.eventType,
    jurisdiction: event.jurisdiction,
    meetingId: event.meetingId,
    monitorRegistrationId: event.monitorRegistrationId,
    payloadHash: event.payloadHash,
    receivedAt: event.receivedAt,
    schemaVersion: event.schemaVersion,
    source: event.source,
    sourceReference: event.sourceReference,
  };
}

function invalidationEvaluationView(evaluation: InvalidationEvaluationView) {
  const review = evaluation.review;
  return {
    affectedActionIds: evaluation.affectedActionIds,
    affectedPremiseIds: evaluation.affectedPremiseIds,
    confidence: evaluation.confidence,
    decision: decisionView(evaluation.decision, evaluation.generatedAt),
    evidenceReferenceIds: evaluation.evidenceReferenceIds,
    externalEventId: evaluation.externalEventId,
    generatedAt: evaluation.generatedAt,
    inputReferenceIds: evaluation.inputReferenceIds,
    model: evaluation.model,
    operation: evaluation.operation,
    outputSchemaVersion: evaluation.outputSchemaVersion,
    promptVersion: evaluation.promptVersion,
    reason: evaluation.reason,
    ...(review === undefined
      ? {}
      : {
          review: {
            disposition: review.disposition,
            facilitatorParticipantId: review.facilitatorParticipantId,
            heldActionIds: review.heldActionIds,
            reason: review.reason,
            ...(review.reconsiderationTask === undefined
              ? {}
              : {
                  reconsiderationTask: {
                    affectedActionIds:
                      review.reconsiderationTask.affectedActionIds,
                    affectedPremiseIds:
                      review.reconsiderationTask.affectedPremiseIds,
                    createdAt: review.reconsiderationTask.createdAt,
                    decisionId: review.reconsiderationTask.decisionId,
                    ownerParticipantId:
                      review.reconsiderationTask.ownerParticipantId,
                    reconsiderationTaskId: review.reconsiderationTask.id,
                    state: review.reconsiderationTask.state,
                    triggerExternalEventId:
                      review.reconsiderationTask.triggerExternalEventId,
                  },
                }),
            reviewedAt: review.reviewedAt,
          },
        }),
    suggestionId: evaluation.suggestionId,
  };
}

function decisionAuditEntries(
  records: readonly EventRecord<DomainEvent>[],
  targetDecisionId?: string,
) {
  return records.flatMap(({ event, position }) => {
    if (
      ![
        "ActionHeld",
        "AssumptionInvalidationSuggested",
        "DecisionCommitted",
        "DecisionDrafted",
        "DecisionMarkedAtRisk",
        "DecisionMarkedReady",
        "DecisionRejected",
        "DecisionReviewRequired",
        "DecisionRevisionCommitted",
        "DecisionSuperseded",
        "FacilitatorReviewed",
        "MonitoringStarted",
        "ReconsiderationTaskCreated",
      ].includes(event.eventType)
    ) {
      return [];
    }
    if (
      targetDecisionId !== undefined &&
      !(
        (event.eventType === "AssumptionInvalidationSuggested" &&
          String(event.payload.decisionId) === String(targetDecisionId)) ||
        (event.eventType === "ActionHeld" &&
          String(event.payload.decisionId) === String(targetDecisionId)) ||
        (event.eventType === "ReconsiderationTaskCreated" &&
          String(event.payload.task.decisionId) === String(targetDecisionId)) ||
        ("decision" in event.payload &&
          String(event.payload.decision.id) === String(targetDecisionId))
      )
    ) {
      return [];
    }
    return [
      {
        actor:
          event.actor.kind === "participant"
            ? event.actor
            : {
                actorId:
                  event.actor.kind === "ai"
                    ? `ai-${event.actor.model}`
                    : "system",
                kind: "system" as const,
              },
        auditId: `audit-${event.eventId}`,
        correlationId: event.correlationId,
        eventId: event.eventId,
        eventType: event.eventType,
        meetingId: event.meetingId,
        occurredAt: event.occurredAt,
        position,
      },
    ];
  });
}

async function attemptInvalidationEvaluation(
  runtime: ServerRuntime,
  input: {
    readonly correlationId: string;
    readonly externalEventId: string;
    readonly meetingId: string;
  },
): Promise<void> {
  try {
    const result = await evaluateAssumptionInvalidation(
      runtime.invalidationEvaluations,
      input,
    );
    if (result.kind === "failed") {
      console.warn(
        JSON.stringify({
          code: result.code,
          event: "assumption_invalidation.evaluation_deferred",
          externalEventId: input.externalEventId,
          meetingId: input.meetingId,
        }),
      );
    }
  } catch {
    console.warn(
      JSON.stringify({
        event: "assumption_invalidation.evaluation_deferred",
        externalEventId: input.externalEventId,
        meetingId: input.meetingId,
      }),
    );
  }
}

async function resolvedDecisionMutation(
  context: AppContext,
  runtime: ServerRuntime,
  input: {
    readonly expectedPosition: number;
    readonly idempotencyKey: string;
    readonly meetingId: string;
  },
  isExpectedReplayEvent: (event: DomainEvent) => boolean,
) {
  const authenticated = await authenticatedSession(context, runtime);
  if (authenticated.kind === "rejected") {
    return authenticated;
  }
  const resolved = await resolveMeetingAuthorization(
    runtime.meetings,
    authenticated.session,
    input.meetingId,
  );
  if (resolved.kind === "rejected") {
    return resolved;
  }
  const records = await runtime.decisions.events.load(input.meetingId);
  const priorIdempotencyEvent = records.find(
    ({ event }) => event.idempotencyKey === input.idempotencyKey,
  )?.event;
  if (
    priorIdempotencyEvent !== undefined &&
    !isExpectedReplayEvent(priorIdempotencyEvent)
  ) {
    return {
      code: "IDEMPOTENCY_CONFLICT" as const,
      kind: "rejected" as const,
    };
  }
  const visiblePosition = await participantVisiblePosition(
    runtime,
    input.meetingId,
    resolved.authorization.participantId,
  );
  if (
    priorIdempotencyEvent === undefined &&
    visiblePosition !== input.expectedPosition
  ) {
    return {
      actualPosition: visiblePosition,
      code: "CONFLICT" as const,
      expectedPosition: input.expectedPosition,
      kind: "rejected" as const,
    };
  }
  return {
    authorization: resolved.authorization,
    globalPosition: await runtime.decisions.events.position(input.meetingId),
    kind: "resolved" as const,
  };
}

function resolvedDecisionMutationFailure(
  context: AppContext,
  result: Exclude<
    Awaited<ReturnType<typeof resolvedDecisionMutation>>,
    { readonly kind: "resolved" }
  >,
) {
  return result.code === "CONFLICT"
    ? errorResponse(context, "CONFLICT", {
        actualPosition: result.actualPosition,
        expectedPosition: result.expectedPosition,
      })
    : errorResponse(context, result.code);
}

function manualDisclosureDependencies(
  dependencies: DisclosureDependencies,
): DisclosureDependencies {
  return {
    artifacts: dependencies.artifacts,
    clock: dependencies.clock,
    events: dependencies.events,
    hash: dependencies.hash,
    ids: dependencies.ids,
    projections: dependencies.projections,
  };
}

function artifactIngestionFailureResponse(
  context: AppContext,
  failure: ArtifactIngestionFailure,
) {
  return failure.code === "CONFLICT"
    ? errorResponse(context, "CONFLICT", {
        actualPosition: failure.actualPosition,
        expectedPosition: failure.expectedPosition,
      })
    : errorResponse(context, failure.code);
}

function displayTokenDependencies(runtime: ServerRuntime) {
  return {
    clock: runtime.clock,
    events: runtime.decisions.events,
    ids: runtime.ids,
    tokens: runtime.tokens,
  };
}

export function createServerApp(runtime: ServerRuntime): Hono<AppEnvironment> {
  const app = new Hono<AppEnvironment>();

  app.use("*", async (context, next) => {
    const correlationId = runtime.ids.next("correlation");
    context.set("correlationId", correlationId);
    await next();
    if (context.req.header("upgrade")?.toLowerCase() !== "websocket") {
      context.header("x-correlation-id", correlationId);
      context.header("cache-control", "no-store");
    }
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
        { name: "realtime", status: "available" },
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
    await clearMeetingByokLeasesBySession(
      runtime.realtimeSecrets,
      authenticated.session.sessionId,
    );
    runtime.realtime.closeSession(authenticated.session.sessionId);
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

  app.get("/api/v1/meetings/:meetingId/projection", async (context) => {
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
    const projection = await roleProjectionFor(
      runtime,
      resolved.authorization,
      context.get("correlationId"),
    );
    return projection === undefined
      ? errorResponse(context, "FORBIDDEN")
      : context.json(RoleProjectionResponseSchema.parse(projection));
  });

  app.post("/api/v1/meetings/:meetingId/realtime/tickets", async (context) => {
    const request = await parseJson(context, RealtimeTicketRequestSchema);
    if (
      request.kind === "rejected" ||
      request.value.meetingId !== context.req.param("meetingId")
    ) {
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
    const currentPosition = await participantVisiblePosition(
      runtime,
      request.value.meetingId,
      resolved.authorization.participantId,
    );
    if (request.value.lastSeenPosition > currentPosition) {
      return errorResponse(context, "CONFLICT", {
        actualPosition: currentPosition,
        expectedPosition: request.value.lastSeenPosition,
      });
    }
    const ticket = runtime.realtime.issueTicket({
      correlationId: context.get("correlationId"),
      lastSeenPosition: request.value.lastSeenPosition,
      meetingId: request.value.meetingId,
      participantId: resolved.authorization.participantId,
      role: resolved.authorization.role,
      sessionId: authenticated.session.sessionId,
      userId: authenticated.session.userId,
    });
    return context.json(
      RealtimeTicketResponseSchema.parse({
        correlationId: ticket.correlationId,
        expiresAt: ticket.expiresAt,
        meetingId: ticket.meetingId,
        ticket: ticket.ticket,
      }),
      201,
    );
  });

  app.put("/api/v1/meetings/:meetingId/byok", async (context) => {
    const request = await parseJson(context, ConfigureMeetingByokRequestSchema);
    if (
      request.kind === "rejected" ||
      request.value.meetingId !== context.req.param("meetingId")
    ) {
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
    const result = await configureMeetingByok(
      runtime.realtimeSecrets,
      resolved.authorization,
      request.value,
    );
    if (result.kind === "failed") {
      return errorResponse(context, result.code);
    }
    return context.json(
      ConfigureMeetingByokResponseSchema.parse({
        configured: true,
        correlationId: context.get("correlationId"),
        keySource: "byok",
        meetingId: result.meetingId,
      }),
      201,
    );
  });

  app.post("/api/v1/meetings/:meetingId/byok/heartbeat", async (context) => {
    const request = await parseJson(context, HeartbeatMeetingByokRequestSchema);
    if (
      request.kind === "rejected" ||
      request.value.meetingId !== context.req.param("meetingId")
    ) {
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
    const result = await heartbeatMeetingByok(
      runtime.realtimeSecrets,
      resolved.authorization,
      request.value,
    );
    if (result.kind === "failed") {
      return errorResponse(context, result.code);
    }
    return context.json(
      HeartbeatMeetingByokResponseSchema.parse({
        active: true,
        correlationId: context.get("correlationId"),
        meetingId: result.meetingId,
      }),
    );
  });

  app.delete("/api/v1/meetings/:meetingId/byok", async (context) => {
    const request = await parseJson(context, ClearMeetingByokRequestSchema);
    if (
      request.kind === "rejected" ||
      request.value.meetingId !== context.req.param("meetingId")
    ) {
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
    const result = await clearMeetingByok(
      runtime.realtimeSecrets,
      resolved.authorization,
      request.value,
    );
    if (result.kind === "failed") {
      return errorResponse(context, result.code);
    }
    return context.json(
      ClearMeetingByokResponseSchema.parse({
        cleared: true,
        correlationId: context.get("correlationId"),
        meetingId: result.meetingId,
      }),
    );
  });

  app.post(
    "/api/v1/meetings/:meetingId/realtime/client-secrets",
    async (context) => {
      const request = await parseJson(
        context,
        IssueRealtimeClientSecretRequestSchema,
      );
      if (
        request.kind === "rejected" ||
        request.value.meetingId !== context.req.param("meetingId")
      ) {
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
      const result = await issueRealtimeClientSecret(
        runtime.realtimeSecrets,
        resolved.authorization,
        request.value,
      );
      if (result.kind === "failed") {
        return errorResponse(context, result.code);
      }
      return context.json(
        IssueRealtimeClientSecretResponseSchema.parse({
          channel: result.channel,
          clientSecret: result.clientSecret,
          correlationId: context.get("correlationId"),
          expiresAt: result.expiresAt,
          meetingId: result.meetingId,
          model: result.model,
        }),
        201,
      );
    },
  );

  app.post(
    "/api/v1/meetings/:meetingId/realtime/shared-floor",
    async (context) => {
      const request = await parseJson(context, AcquireSharedFloorRequestSchema);
      if (
        request.kind === "rejected" ||
        request.value.meetingId !== context.req.param("meetingId")
      ) {
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
      const result = await acquireSharedFloor(
        runtime.decisions,
        resolved.authorization,
        {
          correlationId: context.get("correlationId"),
          meetingId: request.value.meetingId,
          utteranceId: request.value.utteranceId,
        },
      );
      if (result.kind === "failed") {
        return utteranceFailureResponse(context, result);
      }
      return context.json(
        AcquireSharedFloorResponseSchema.parse({
          correlationId: result.correlationId,
          leaseExpiresAt: result.leaseExpiresAt,
          meetingId: result.meetingId,
          participantId: result.participantId,
          utteranceId: result.utteranceId,
        }),
        201,
      );
    },
  );

  app.delete(
    "/api/v1/meetings/:meetingId/realtime/shared-floor",
    async (context) => {
      const request = await parseJson(context, ReleaseSharedFloorRequestSchema);
      if (
        request.kind === "rejected" ||
        request.value.meetingId !== context.req.param("meetingId")
      ) {
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
      const result = await releaseSharedFloor(
        runtime.decisions,
        resolved.authorization,
        request.value,
      );
      if (result.kind === "failed") {
        return utteranceFailureResponse(context, result);
      }
      return context.json(
        ReleaseSharedFloorResponseSchema.parse({
          correlationId: result.correlationId,
          meetingId: result.meetingId,
          releasedAt: result.releasedAt,
          utteranceId: result.utteranceId,
        }),
      );
    },
  );

  app.post("/api/v1/meetings/:meetingId/utterances", async (context) => {
    const request = await parseJson(context, CaptureUtteranceRequestSchema);
    if (
      request.kind === "rejected" ||
      request.value.meetingId !== context.req.param("meetingId")
    ) {
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
    const result = await captureUtterance(
      runtime.decisions,
      resolved.authorization,
      request.value,
    );
    if (result.kind === "failed") {
      return utteranceFailureResponse(context, result);
    }
    return context.json(
      CaptureUtteranceResponseSchema.parse({
        correlationId: result.correlationId,
        meetingId: result.meetingId,
        position: await participantVisiblePositionAt(
          runtime,
          result.meetingId,
          resolved.authorization.participantId,
          result.position,
        ),
        replayed: result.replayed,
        utterance: result.utterance,
      }),
      result.replayed ? 200 : 201,
    );
  });

  app.post("/api/v1/meetings/:meetingId/display-tokens", async (context) => {
    const request = await parseJson(context, IssueDisplayTokenRequestSchema);
    if (
      request.kind === "rejected" ||
      request.value.meetingId !== context.req.param("meetingId")
    ) {
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
    const visiblePosition = await participantVisiblePosition(
      runtime,
      request.value.meetingId,
      resolved.authorization.participantId,
    );
    if (visiblePosition !== request.value.expectedPosition) {
      return errorResponse(context, "CONFLICT", {
        actualPosition: visiblePosition,
        expectedPosition: request.value.expectedPosition,
      });
    }
    const result = await issueDisplayToken(
      displayTokenDependencies(runtime),
      resolved.authorization,
      {
        correlationId: context.get("correlationId"),
        expectedPosition: await runtime.decisions.events.position(
          request.value.meetingId,
        ),
        meetingId: request.value.meetingId,
      },
    );
    if (result.kind === "failed") {
      return result.code === "CONFLICT"
        ? errorResponse(context, "CONFLICT", {
            actualPosition: result.actualPosition,
            expectedPosition: result.expectedPosition,
          })
        : errorResponse(context, result.code);
    }
    return context.json(
      IssueDisplayTokenResponseSchema.parse({
        correlationId: result.correlationId,
        displayToken: result.displayToken,
        displayTokenId: result.displayTokenId,
        expiresAt: result.expiresAt,
        meetingId: request.value.meetingId,
        position: await participantVisiblePositionAt(
          runtime,
          request.value.meetingId,
          resolved.authorization.participantId,
          result.position,
        ),
      }),
      201,
    );
  });

  app.post(
    "/api/v1/meetings/:meetingId/display-tokens/revoke",
    async (context) => {
      const request = await parseJson(context, RevokeDisplayTokenRequestSchema);
      if (
        request.kind === "rejected" ||
        request.value.meetingId !== context.req.param("meetingId")
      ) {
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
      const visiblePosition = await participantVisiblePosition(
        runtime,
        request.value.meetingId,
        resolved.authorization.participantId,
      );
      if (visiblePosition !== request.value.expectedPosition) {
        return errorResponse(context, "CONFLICT", {
          actualPosition: visiblePosition,
          expectedPosition: request.value.expectedPosition,
        });
      }
      const result = await revokeDisplayToken(
        displayTokenDependencies(runtime),
        resolved.authorization,
        {
          correlationId: context.get("correlationId"),
          displayTokenId: request.value.displayTokenId,
          expectedPosition: await runtime.decisions.events.position(
            request.value.meetingId,
          ),
          meetingId: request.value.meetingId,
        },
      );
      if (result.kind === "failed") {
        return result.code === "CONFLICT"
          ? errorResponse(context, "CONFLICT", {
              actualPosition: result.actualPosition,
              expectedPosition: result.expectedPosition,
            })
          : errorResponse(context, result.code);
      }
      return context.json(
        RevokeDisplayTokenResponseSchema.parse({
          correlationId: result.correlationId,
          displayTokenId: result.displayTokenId,
          meetingId: request.value.meetingId,
          position: await participantVisiblePositionAt(
            runtime,
            request.value.meetingId,
            resolved.authorization.participantId,
            result.position,
          ),
          revokedAt: result.revokedAt,
        }),
      );
    },
  );

  app.get("/api/v1/meetings/:meetingId/display", async (context) => {
    const query = RoleProjectionQuerySchema.safeParse({
      meetingId: context.req.param("meetingId"),
    });
    const displayToken = context.req.query("token");
    if (!query.success || displayToken === undefined) {
      return errorResponse(context, "DISPLAY_TOKEN_EXPIRED");
    }
    const authorized = await authorizeDisplayToken(
      displayTokenDependencies(runtime),
      {
        displayToken,
        meetingId: query.data.meetingId,
      },
    );
    if (authorized.kind === "failed") {
      return errorResponse(context, authorized.code);
    }
    const projection = await sharedDisplayProjectionFor(
      runtime,
      query.data.meetingId,
      authorized.expiresAt,
      context.get("correlationId"),
    );
    return projection === undefined
      ? errorResponse(context, "DISPLAY_TOKEN_EXPIRED")
      : context.json(SharedDisplayProjectionResponseSchema.parse(projection));
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

  app.get("/api/v1/meetings/:meetingId/decisions", async (context) => {
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
    const records = await runtime.decisions.events.load(query.data.meetingId);
    const projection = replayMeeting(
      domainMeetingId(query.data.meetingId),
      records.map(({ event, position }) => ({
        ...event,
        position: meetingPosition(position),
      })),
    );
    return context.json(
      ListSharedDecisionsResponseSchema.parse({
        correlationId: context.get("correlationId"),
        decisions: projection.shared.decisions.map((decision) => {
          const activeRevision = projection.shared.decisionRevisions.find(
            ({ id }) => String(id) === String(decision.activeRevisionId),
          );
          return decisionView(
            decision,
            activeRevision?.createdAt ?? decision.createdAt,
          );
        }),
        meetingId: query.data.meetingId,
        position: await participantVisiblePosition(
          runtime,
          query.data.meetingId,
          resolved.authorization.participantId,
        ),
      }),
    );
  });

  app.get("/api/v1/meetings/:meetingId/external-events", async (context) => {
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
    const records = await runtime.externalEvents.events.load(
      query.data.meetingId,
    );
    const projection = replayMeeting(
      domainMeetingId(query.data.meetingId),
      records.map(({ event, position }) => ({
        ...event,
        position: meetingPosition(position),
      })),
    );
    return context.json(
      ListSharedExternalEventsResponseSchema.parse({
        correlationId: context.get("correlationId"),
        events: projection.shared.externalEvents.map(externalEventReceiptView),
        meetingId: query.data.meetingId,
        position: await participantVisiblePosition(
          runtime,
          query.data.meetingId,
          resolved.authorization.participantId,
        ),
      }),
    );
  });

  app.get(
    "/api/v1/meetings/:meetingId/invalidation-evaluations",
    async (context) => {
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
      const records = await runtime.invalidationEvaluations.events.load(
        query.data.meetingId,
      );
      return context.json(
        ListInvalidationEvaluationsResponseSchema.parse({
          correlationId: context.get("correlationId"),
          evaluations: listAssumptionInvalidationEvaluations(records).map(
            invalidationEvaluationView,
          ),
          meetingId: query.data.meetingId,
          position: await participantVisiblePosition(
            runtime,
            query.data.meetingId,
            resolved.authorization.participantId,
          ),
        }),
      );
    },
  );

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
        position: await participantVisiblePositionAt(
          runtime,
          request.value.meetingId,
          resolved.authorization.participantId,
          result.position,
        ),
        source: result.source,
      }),
      201,
    );
  });

  app.post("/api/v1/artifacts", async (context) => {
    const contentLength = Number(context.req.header("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > 21 * 1024 * 1024) {
      return errorResponse(context, "ARTIFACT_TOO_LARGE");
    }
    let body: Record<string, File | string>;
    try {
      body = await context.req.parseBody();
    } catch {
      return errorResponse(context, "VALIDATION_FAILED");
    }
    const file = body.file;
    const fields = UploadPrivateArtifactFieldsSchema.safeParse({
      correlationId:
        typeof body.correlationId === "string" ? body.correlationId : undefined,
      idempotencyKey: body.idempotencyKey,
      meetingId: body.meetingId,
    });
    if (!fields.success || !(file instanceof File)) {
      return errorResponse(context, "VALIDATION_FAILED");
    }
    const authenticated = await authenticatedSession(context, runtime);
    if (authenticated.kind === "rejected") {
      return errorResponse(context, authenticated.code);
    }
    const resolved = await resolveMeetingAuthorization(
      runtime.meetings,
      authenticated.session,
      fields.data.meetingId,
    );
    if (resolved.kind === "rejected") {
      return errorResponse(context, resolved.code);
    }
    if (!runtime.artifactStorageAvailable) {
      return errorResponse(context, "ARTIFACT_STORAGE_UNAVAILABLE");
    }
    if (file.size > 20 * 1024 * 1024) {
      return errorResponse(context, "ARTIFACT_TOO_LARGE");
    }
    const result = await uploadPrivateArtifact(
      runtime.artifactIngestion,
      resolved.authorization,
      {
        bytes: new Uint8Array(await file.arrayBuffer()),
        contentType: file.type,
        correlationId: context.get("correlationId"),
        expectedPosition: await runtime.artifactIngestion.events.position(
          fields.data.meetingId,
        ),
        filename: file.name,
        idempotencyKey: fields.data.idempotencyKey,
        meetingId: fields.data.meetingId,
      },
    );
    if (result.kind === "failed") {
      return artifactIngestionFailureResponse(context, result);
    }
    return context.json(
      UploadPrivateArtifactResponseSchema.parse({
        artifact: result.artifact,
        correlationId: result.correlationId,
        meetingId: fields.data.meetingId,
        position: await participantVisiblePositionAt(
          runtime,
          fields.data.meetingId,
          resolved.authorization.participantId,
          result.position,
        ),
      }),
      201,
    );
  });

  app.get(
    "/api/v1/meetings/:meetingId/artifacts/:artifactId",
    async (context) => {
      const query = DownloadPrivateArtifactQuerySchema.safeParse({
        artifactId: context.req.param("artifactId"),
        meetingId: context.req.param("meetingId"),
        representation: context.req.query("representation"),
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
      const result = await getPrivateArtifact(
        runtime.artifactIngestion,
        resolved.authorization,
        query.data,
      );
      if (result.kind === "failed") {
        return errorResponse(context, result.code);
      }
      context.header(
        "Content-Disposition",
        `attachment; filename*=UTF-8''${encodeURIComponent(result.filename)}`,
      );
      context.header("Content-Type", result.contentType);
      context.header("Cache-Control", "private, no-store");
      context.header("X-Content-Type-Options", "nosniff");
      return context.body(Uint8Array.from(result.bytes).buffer);
    },
  );

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
    const aiAssisted =
      request.value.assistance === "ai_preferred" &&
      runtime.disclosures.candidateProposer !== undefined;
    let result: Awaited<ReturnType<typeof proposeDisclosure>>;
    try {
      result = await proposeDisclosure(
        aiAssisted
          ? runtime.disclosures
          : manualDisclosureDependencies(runtime.disclosures),
        resolved.authorization,
        {
          ...request.value,
          correlationId: context.get("correlationId"),
          expectedPosition: await runtime.disclosures.events.position(
            request.value.meetingId,
          ),
        },
      );
    } catch (error) {
      if (error instanceof OpenAiCandidateError) {
        return errorResponse(context, "OPENAI_UNAVAILABLE");
      }
      throw error;
    }
    if (result.kind === "failed") {
      return disclosureFailureResponse(context, result);
    }
    return context.json(
      ProposeDisclosureResponseSchema.parse({
        candidate: result.candidate,
        correlationId: result.correlationId,
        meetingId: request.value.meetingId,
        origin: aiAssisted ? "ai_assisted" : "human_selected",
        position: await participantVisiblePositionAt(
          runtime,
          request.value.meetingId,
          resolved.authorization.participantId,
          result.position,
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
        position: await participantVisiblePositionAt(
          runtime,
          request.value.meetingId,
          resolved.authorization.participantId,
          result.position,
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
        position: await participantVisiblePositionAt(
          runtime,
          request.value.meetingId,
          resolved.authorization.participantId,
          result.position,
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
        position: await participantVisiblePositionAt(
          runtime,
          request.value.meetingId,
          resolved.authorization.participantId,
          result.position,
        ),
        state: result.state,
      }),
    );
  });

  app.post("/api/v1/decisions/candidates", async (context) => {
    const request = await parseJson(
      context,
      SynthesizeSharedDecisionRequestSchema,
    );
    if (request.kind === "rejected") {
      return errorResponse(context, "VALIDATION_FAILED");
    }
    const resolved = await resolvedDecisionMutation(
      context,
      runtime,
      request.value,
      (event) =>
        event.eventType === "InferenceSuggested" &&
        event.payload.candidateKind === "decision",
    );
    if (resolved.kind !== "resolved") {
      return resolvedDecisionMutationFailure(context, resolved);
    }
    let result: Awaited<ReturnType<typeof prepareSharedDecisionCandidate>>;
    try {
      result = await prepareSharedDecisionCandidate(
        runtime.decisionCandidates,
        resolved.authorization,
        request.value.assistance === "manual"
          ? {
              assistance: "manual",
              correlationId: context.get("correlationId"),
              draft: request.value.draft,
              expectedPosition: resolved.globalPosition,
              idempotencyKey: request.value.idempotencyKey,
              meetingId: request.value.meetingId,
            }
          : {
              assistance: "ai_preferred",
              correlationId: context.get("correlationId"),
              expectedPosition: resolved.globalPosition,
              idempotencyKey: request.value.idempotencyKey,
              meetingId: request.value.meetingId,
            },
      );
    } catch (error) {
      if (error instanceof OpenAiCandidateError) {
        return errorResponse(context, "OPENAI_UNAVAILABLE");
      }
      throw error;
    }
    if (result.kind === "failed") {
      return decisionFailureResponse(context, result);
    }
    return context.json(
      SynthesizeSharedDecisionResponseSchema.parse({
        candidate: result.candidate,
        correlationId: result.correlationId,
        meetingId: request.value.meetingId,
        position: await participantVisiblePositionAt(
          runtime,
          request.value.meetingId,
          resolved.authorization.participantId,
          result.position,
        ),
      }),
      201,
    );
  });

  app.post("/api/v1/decisions/candidates/disposition", async (context) => {
    const request = await parseJson(
      context,
      DispositionSharedDecisionCandidateRequestSchema,
    );
    if (request.kind === "rejected") {
      return errorResponse(context, "VALIDATION_FAILED");
    }
    const resolved = await resolvedDecisionMutation(
      context,
      runtime,
      request.value,
      (event) =>
        event.eventType === "InferenceConfirmed" ||
        event.eventType === "InferenceRejected",
    );
    if (resolved.kind !== "resolved") {
      return resolvedDecisionMutationFailure(context, resolved);
    }
    const result = await dispositionDecisionCandidate(
      runtime.decisionCandidates,
      resolved.authorization,
      {
        actions: request.value.actions,
        candidateId: request.value.candidateId,
        correlationId: context.get("correlationId"),
        dissent: request.value.dissent,
        expectedPosition: resolved.globalPosition,
        idempotencyKey: request.value.idempotencyKey,
        meetingId: request.value.meetingId,
        premiseDispositions: request.value.premiseDispositions.map(
          (disposition) =>
            disposition.disposition === "confirmed"
              ? {
                  candidateId: disposition.candidateId,
                  disposition: disposition.disposition,
                  premise: disposition.premise,
                }
              : {
                  candidateId: disposition.candidateId,
                  disposition: disposition.disposition,
                  ...(disposition.reason === undefined
                    ? {}
                    : { reason: disposition.reason }),
                },
        ),
      },
    );
    if (result.kind === "failed") {
      return decisionFailureResponse(context, result);
    }
    return context.json(
      DispositionSharedDecisionCandidateResponseSchema.parse({
        actions: result.actions.map(
          ({ id, ownerParticipantId, scope, status }) => ({
            actionId: id,
            ownerParticipantId,
            scope,
            status,
          }),
        ),
        candidateId: result.candidateId,
        correlationId: result.correlationId,
        dissent: result.dissent.map(({ id, reason, retained }) => ({
          dissentId: id,
          reason,
          retained,
        })),
        meetingId: request.value.meetingId,
        position: await participantVisiblePositionAt(
          runtime,
          request.value.meetingId,
          resolved.authorization.participantId,
          result.position,
        ),
        premiseDispositions: result.premiseDispositions,
        premises: result.premises.map(
          ({ confirmationStatus, id, statement }) => ({
            confirmationStatus,
            premiseId: id,
            statement,
          }),
        ),
      }),
    );
  });

  app.post("/api/v1/decisions/drafts", async (context) => {
    const request = await parseJson(context, SaveDecisionDraftRequestSchema);
    if (request.kind === "rejected") {
      return errorResponse(context, "VALIDATION_FAILED");
    }
    const resolved = await resolvedDecisionMutation(
      context,
      runtime,
      request.value,
      (event) => event.eventType === "DecisionDrafted",
    );
    if (resolved.kind !== "resolved") {
      return resolvedDecisionMutationFailure(context, resolved);
    }
    const result = await saveDecisionDraft(
      runtime.decisions,
      resolved.authorization,
      {
        actionIds: request.value.actionIds,
        changeReason: request.value.changeReason,
        correlationId: context.get("correlationId"),
        ...(request.value.decisionId === undefined
          ? {}
          : { decisionId: request.value.decisionId }),
        dissentIds: request.value.dissentIds,
        evidenceIds: request.value.evidenceIds,
        expectedPosition: resolved.globalPosition,
        idempotencyKey: request.value.idempotencyKey,
        meetingId: request.value.meetingId,
        monitorCondition: {
          description: request.value.monitorCondition.description,
        },
        outcome: request.value.outcome,
        premiseIds: request.value.premiseIds,
        title: request.value.title,
      },
    );
    if (result.kind === "failed") {
      return decisionFailureResponse(context, result);
    }
    return context.json(
      SaveDecisionDraftResponseSchema.parse({
        correlationId: result.correlationId,
        decision: decisionView(result.decision, result.revision.createdAt),
        meetingId: request.value.meetingId,
        position: await participantVisiblePositionAt(
          runtime,
          request.value.meetingId,
          resolved.authorization.participantId,
          result.position,
        ),
        revision: decisionRevisionView(result.revision),
      }),
      201,
    );
  });

  app.post("/api/v1/decisions/ready", async (context) => {
    const request = await parseJson(context, MarkDecisionReadyRequestSchema);
    if (request.kind === "rejected") {
      return errorResponse(context, "VALIDATION_FAILED");
    }
    const resolved = await resolvedDecisionMutation(
      context,
      runtime,
      request.value,
      (event) => event.eventType === "DecisionMarkedReady",
    );
    if (resolved.kind !== "resolved") {
      return resolvedDecisionMutationFailure(context, resolved);
    }
    const result = await markDecisionReady(
      runtime.decisions,
      resolved.authorization,
      {
        correlationId: context.get("correlationId"),
        decisionId: request.value.decisionId,
        expectedPosition: resolved.globalPosition,
        idempotencyKey: request.value.idempotencyKey,
        meetingId: request.value.meetingId,
      },
    );
    if (result.kind === "failed") {
      return decisionFailureResponse(context, result);
    }
    return context.json(
      MarkDecisionReadyResponseSchema.parse({
        correlationId: result.correlationId,
        decision: decisionView(result.decision, runtime.clock.now()),
        meetingId: request.value.meetingId,
        position: await participantVisiblePositionAt(
          runtime,
          request.value.meetingId,
          resolved.authorization.participantId,
          result.position,
        ),
      }),
    );
  });

  app.post("/api/v1/decisions/commit", async (context) => {
    const request = await parseJson(context, CommitDecisionRequestSchema);
    if (request.kind === "rejected") {
      return errorResponse(context, "VALIDATION_FAILED");
    }
    const resolved = await resolvedDecisionMutation(
      context,
      runtime,
      request.value,
      (event) => event.eventType === "DecisionCommitted",
    );
    if (resolved.kind !== "resolved") {
      return resolvedDecisionMutationFailure(context, resolved);
    }
    const result = await commitDecision(
      runtime.decisions,
      resolved.authorization,
      {
        correlationId: context.get("correlationId"),
        decisionId: request.value.decisionId,
        expectedPosition: resolved.globalPosition,
        explicitCommit: true,
        idempotencyKey: request.value.idempotencyKey,
        meetingId: request.value.meetingId,
      },
    );
    if (result.kind === "failed") {
      return decisionFailureResponse(context, result);
    }
    return context.json(
      CommitDecisionResponseSchema.parse({
        correlationId: result.correlationId,
        decision: decisionView(result.decision, result.revision.createdAt),
        meetingId: request.value.meetingId,
        position: await participantVisiblePositionAt(
          runtime,
          request.value.meetingId,
          resolved.authorization.participantId,
          result.position,
        ),
        revision: decisionRevisionView(result.revision),
      }),
    );
  });

  app.post("/api/v1/decisions/monitoring", async (context) => {
    const request = await parseJson(
      context,
      StartDecisionMonitoringRequestSchema,
    );
    if (request.kind === "rejected") {
      return errorResponse(context, "VALIDATION_FAILED");
    }
    const resolved = await resolvedDecisionMutation(
      context,
      runtime,
      request.value,
      (event) => event.eventType === "MonitoringStarted",
    );
    if (resolved.kind !== "resolved") {
      return resolvedDecisionMutationFailure(context, resolved);
    }
    const result = await startDecisionMonitoring(
      runtime.decisions,
      resolved.authorization,
      {
        correlationId: context.get("correlationId"),
        decisionId: request.value.decisionId,
        expectedPosition: resolved.globalPosition,
        idempotencyKey: request.value.idempotencyKey,
        meetingId: request.value.meetingId,
      },
    );
    if (result.kind === "failed") {
      return decisionFailureResponse(context, result);
    }
    return context.json(
      StartDecisionMonitoringResponseSchema.parse({
        correlationId: result.correlationId,
        decision: decisionView(
          result.decision,
          await decisionMutationOccurredAt(
            runtime,
            request.value.meetingId,
            request.value.idempotencyKey,
          ),
        ),
        meetingId: request.value.meetingId,
        monitorRegistrationId: result.monitorRegistrationId,
        position: await participantVisiblePositionAt(
          runtime,
          request.value.meetingId,
          resolved.authorization.participantId,
          result.position,
        ),
      }),
    );
  });

  app.post("/api/v1/decisions/invalidation-review", async (context) => {
    const request = await parseJson(context, ReviewInvalidationRequestSchema);
    if (request.kind === "rejected") {
      return errorResponse(context, "VALIDATION_FAILED");
    }
    const resolved = await resolvedDecisionMutation(
      context,
      runtime,
      request.value,
      (event) => event.eventType === "FacilitatorReviewed",
    );
    if (resolved.kind !== "resolved") {
      return resolvedDecisionMutationFailure(context, resolved);
    }
    const result = await reviewInvalidation(
      runtime.decisions,
      resolved.authorization,
      {
        correlationId: context.get("correlationId"),
        decisionId: request.value.decisionId,
        disposition: request.value.disposition,
        expectedPosition: resolved.globalPosition,
        idempotencyKey: request.value.idempotencyKey,
        meetingId: request.value.meetingId,
        reason: request.value.reason,
        suggestionId: request.value.suggestionId,
      },
    );
    if (result.kind === "failed") {
      return invalidationReviewFailureResponse(context, result);
    }
    const common = {
      correlationId: result.correlationId,
      decision: decisionView(
        result.decision,
        await decisionMutationOccurredAt(
          runtime,
          request.value.meetingId,
          request.value.idempotencyKey,
        ),
      ),
      disposition: result.disposition,
      meetingId: request.value.meetingId,
      position: await participantVisiblePositionAt(
        runtime,
        request.value.meetingId,
        resolved.authorization.participantId,
        result.position,
      ),
      reviewAuditId: `audit-${result.reviewEventId}`,
      reviewEventId: result.reviewEventId,
      reviewReason: result.reviewReason,
      suggestionId: result.suggestionId,
    };
    return context.json(
      ReviewInvalidationResponseSchema.parse(
        result.kind === "suggestion_rejected"
          ? common
          : {
              ...common,
              heldActionIds: result.heldActionIds,
              reconsiderationTask: {
                affectedActionIds: result.reconsiderationTask.affectedActionIds,
                affectedPremiseIds:
                  result.reconsiderationTask.affectedPremiseIds,
                createdAt: result.reconsiderationTask.createdAt,
                decisionId: result.reconsiderationTask.decisionId,
                ownerParticipantId:
                  result.reconsiderationTask.ownerParticipantId,
                reconsiderationTaskId: result.reconsiderationTask.id,
                state: result.reconsiderationTask.state,
                triggerExternalEventId:
                  result.reconsiderationTask.triggerExternalEventId,
              },
            },
      ),
    );
  });

  app.post("/api/v1/decisions/review-resolution", async (context) => {
    const request = await parseJson(
      context,
      ResolveDecisionReviewRequestSchema,
    );
    if (request.kind === "rejected") {
      return errorResponse(context, "VALIDATION_FAILED");
    }
    const expectedEventType =
      request.value.resolution === "recommit_revision"
        ? "DecisionRevisionCommitted"
        : request.value.resolution === "supersede_decision"
          ? "DecisionSuperseded"
          : "DecisionRejected";
    const resolved = await resolvedDecisionMutation(
      context,
      runtime,
      request.value,
      (event) => event.eventType === expectedEventType,
    );
    if (resolved.kind !== "resolved") {
      return resolvedDecisionMutationFailure(context, resolved);
    }
    const commonInput = {
      correlationId: context.get("correlationId"),
      decisionId: request.value.decisionId,
      expectedPosition: resolved.globalPosition,
      idempotencyKey: request.value.idempotencyKey,
      meetingId: request.value.meetingId,
    };
    const occurredAt = () =>
      decisionMutationOccurredAt(
        runtime,
        request.value.meetingId,
        request.value.idempotencyKey,
      );
    const visiblePosition = (position: number) =>
      participantVisiblePositionAt(
        runtime,
        request.value.meetingId,
        resolved.authorization.participantId,
        position,
      );

    if (request.value.resolution === "recommit_revision") {
      const result = await recommitDecision(
        runtime.decisions,
        resolved.authorization,
        {
          ...commonInput,
          changeReason: request.value.changeReason,
          explicitCommit: true,
          monitorCondition: request.value.monitorCondition,
          outcome: request.value.outcome,
          title: request.value.title,
        },
      );
      if (result.kind === "failed") {
        return decisionReviewResolutionFailureResponse(context, result);
      }
      return context.json(
        ResolveDecisionReviewResponseSchema.parse({
          correlationId: result.correlationId,
          decision: decisionView(result.decision, await occurredAt()),
          meetingId: request.value.meetingId,
          position: await visiblePosition(result.position),
          resolution: "recommit_revision",
          revision: decisionRevisionView(result.revision),
        }),
      );
    }

    if (request.value.resolution === "supersede_decision") {
      const result = await supersedeDecision(
        runtime.decisions,
        resolved.authorization,
        {
          ...commonInput,
          replacementDecisionId: request.value.replacementDecisionId,
        },
      );
      if (result.kind === "failed") {
        return decisionReviewResolutionFailureResponse(context, result);
      }
      return context.json(
        ResolveDecisionReviewResponseSchema.parse({
          correlationId: result.correlationId,
          decision: decisionView(result.decision, await occurredAt()),
          meetingId: request.value.meetingId,
          position: await visiblePosition(result.position),
          replacementDecisionId: result.replacementDecisionId,
          resolution: "supersede_decision",
        }),
      );
    }

    const result = await rejectDecision(
      runtime.decisions,
      resolved.authorization,
      {
        ...commonInput,
        reason: request.value.reason,
      },
    );
    if (result.kind === "failed") {
      return decisionReviewResolutionFailureResponse(context, result);
    }
    return context.json(
      ResolveDecisionReviewResponseSchema.parse({
        correlationId: result.correlationId,
        decision: decisionView(result.decision, await occurredAt()),
        meetingId: request.value.meetingId,
        position: await visiblePosition(result.position),
        reason: result.reason,
        resolution: "reject_decision",
      }),
    );
  });

  app.post(
    "/api/v1/webhooks/regulatory-changes/:meetingId/:monitorRegistrationId",
    async (context) => {
      const contentType = context.req.header("content-type") ?? "";
      const signature =
        context.req.header("x-counterpoint-webhook-signature") ?? "";
      const signedAt =
        context.req.header("x-counterpoint-webhook-timestamp") ?? "";
      if (
        !contentType.toLowerCase().startsWith("application/json") ||
        runtime.webhookVerifier === undefined
      ) {
        return errorResponse(context, "WEBHOOK_SIGNATURE_INVALID");
      }
      const rawBody = new Uint8Array(await context.req.raw.arrayBuffer());
      if (rawBody.byteLength === 0 || rawBody.byteLength > 64 * 1024) {
        return errorResponse(context, "VALIDATION_FAILED");
      }
      const verification = await runtime.webhookVerifier.verify({
        rawBody,
        signature,
        timestamp: signedAt,
      });
      if (verification.kind === "invalid") {
        return errorResponse(context, "WEBHOOK_SIGNATURE_INVALID");
      }
      let parsedBody: unknown;
      try {
        parsedBody = JSON.parse(new TextDecoder().decode(rawBody));
      } catch {
        return errorResponse(context, "VALIDATION_FAILED");
      }
      const request =
        RegulatoryChangeWebhookRequestSchema.safeParse(parsedBody);
      if (
        !request.success ||
        String(request.data.meetingId) !== context.req.param("meetingId") ||
        String(request.data.monitorRegistrationId) !==
          context.req.param("monitorRegistrationId")
      ) {
        return errorResponse(context, "VALIDATION_FAILED");
      }
      const result = await receiveRegulatoryChange(
        runtime.externalEvents,
        { kind: "system" },
        {
          correlationId: context.get("correlationId"),
          description: request.data.description,
          effectiveAt: request.data.effectiveAt,
          eventId: request.data.eventId,
          eventType: request.data.eventType,
          jurisdiction: request.data.jurisdiction,
          meetingId: request.data.meetingId,
          monitorRegistrationId: request.data.monitorRegistrationId,
          payloadHash: verification.payloadHash,
          source: request.data.source,
          sourceReference: request.data.sourceReference,
        },
      );
      if (result.kind === "failed") {
        if (result.code === "MONITOR_REGISTRATION_NOT_FOUND") {
          return errorResponse(context, "MEETING_NOT_FOUND");
        }
        if (result.code === "IDEMPOTENCY_CONFLICT") {
          return errorResponse(context, "IDEMPOTENCY_CONFLICT");
        }
        if (result.code === "CONFLICT") {
          return errorResponse(context, "CONFLICT");
        }
        return errorResponse(context, "VALIDATION_FAILED");
      }
      await attemptInvalidationEvaluation(runtime, {
        correlationId: result.correlationId,
        externalEventId: result.event.id,
        meetingId: request.data.meetingId,
      });
      return context.json(
        RegulatoryChangeWebhookResponseSchema.parse({
          correlationId: result.correlationId,
          evaluationStatus: "pending",
          event: {
            description: result.event.description,
            effectiveAt: result.event.effectiveAt,
            eventId: result.event.id,
            eventType: result.event.eventType,
            jurisdiction: result.event.jurisdiction,
            meetingId: result.event.meetingId,
            monitorRegistrationId: result.event.monitorRegistrationId,
            payloadHash: result.event.payloadHash,
            receivedAt: result.event.receivedAt,
            schemaVersion: result.event.schemaVersion,
            source: result.event.source,
            sourceReference: result.event.sourceReference,
          },
          position: result.position,
          receiptStatus: "received",
          replayed: result.replayed,
        }),
        202,
      );
    },
  );

  app.post(
    "/api/v1/meetings/:meetingId/demo/regulatory-changes",
    async (context) => {
      const request = await parseJson(
        context,
        InjectDemoRegulatoryChangeRequestSchema,
      );
      if (request.kind === "rejected") {
        return errorResponse(context, "VALIDATION_FAILED");
      }
      const authenticated = await authenticatedSession(context, runtime);
      if (authenticated.kind === "rejected") {
        return errorResponse(context, authenticated.code);
      }
      const meetingScope = context.req.param("meetingId");
      const resolved = await resolveMeetingAuthorization(
        runtime.meetings,
        authenticated.session,
        meetingScope,
      );
      if (resolved.kind === "rejected") {
        return errorResponse(context, resolved.code);
      }
      const result = await injectDemoRegulatoryChange(
        runtime.externalEvents,
        resolved.authorization,
        {
          correlationId: context.get("correlationId"),
          idempotencyKey: request.value.idempotencyKey,
          meetingId: meetingScope,
        },
      );
      if (result.kind === "failed") {
        if (result.code === "FORBIDDEN") {
          return errorResponse(context, "FORBIDDEN");
        }
        if (result.code === "MONITOR_REGISTRATION_NOT_FOUND") {
          return errorResponse(context, "INVALID_STATE_TRANSITION");
        }
        if (result.code === "IDEMPOTENCY_CONFLICT") {
          return errorResponse(context, "IDEMPOTENCY_CONFLICT");
        }
        if (result.code === "CONFLICT") {
          return errorResponse(context, "CONFLICT");
        }
        return errorResponse(context, "VALIDATION_FAILED");
      }
      await attemptInvalidationEvaluation(runtime, {
        correlationId: result.correlationId,
        externalEventId: result.event.id,
        meetingId: meetingScope,
      });
      return context.json(
        InjectDemoRegulatoryChangeResponseSchema.parse({
          correlationId: result.correlationId,
          evaluationStatus: "pending",
          event: {
            description: result.event.description,
            effectiveAt: result.event.effectiveAt,
            eventId: result.event.id,
            eventType: result.event.eventType,
            jurisdiction: result.event.jurisdiction,
            meetingId: result.event.meetingId,
            monitorRegistrationId: result.event.monitorRegistrationId,
            payloadHash: result.event.payloadHash,
            receivedAt: result.event.receivedAt,
            schemaVersion: result.event.schemaVersion,
            source: result.event.source,
            sourceReference: result.event.sourceReference,
          },
          position: result.position,
          receiptStatus: "received",
          replayed: result.replayed,
        }),
        202,
      );
    },
  );

  app.post("/api/v1/meetings/:meetingId/demo/reset", async (context) => {
    const request = await parseJson(context, FacilitatorDemoResetRequestSchema);
    if (
      request.kind === "rejected" ||
      request.value.meetingId !== context.req.param("meetingId")
    ) {
      return errorResponse(context, "VALIDATION_FAILED");
    }
    const resolved = await resolvedDecisionMutation(
      context,
      runtime,
      request.value,
      (event) => event.eventType === "DemoResetRequested",
    );
    if (resolved.kind !== "resolved") {
      return resolvedDecisionMutationFailure(context, resolved);
    }
    const priorResetRequest = (
      await runtime.decisions.events.load(request.value.meetingId)
    ).find(
      ({ event }) =>
        event.eventType === "DemoResetRequested" &&
        String(event.idempotencyKey) === String(request.value.idempotencyKey),
    );
    const result = await resetDemoMeeting(
      runtime.decisions,
      resolved.authorization,
      {
        expectedPosition:
          priorResetRequest === undefined
            ? resolved.globalPosition
            : priorResetRequest.position - 1,
        idempotencyKey: request.value.idempotencyKey,
        meetingId: request.value.meetingId,
        seedName: "flagship",
      },
    );
    if (result.kind === "failed") {
      if (result.code === "CONFLICT") {
        return errorResponse(context, "CONFLICT", {
          actualPosition: result.actualPosition,
          expectedPosition: result.expectedPosition,
        });
      }
      return errorResponse(context, result.code);
    }
    return context.json(
      FacilitatorDemoResetResponseSchema.parse({
        correlationId: result.correlationId,
        meetingId: request.value.meetingId,
        position: await participantVisiblePositionAt(
          runtime,
          request.value.meetingId,
          resolved.authorization.participantId,
          result.position,
        ),
        resetRequestId: result.resetRequestId,
        resetStatus: "completed",
      }),
    );
  });

  app.get(
    "/api/v1/meetings/:meetingId/decisions/:decisionId/history",
    async (context) => {
      const query = DecisionHistoryQuerySchema.safeParse({
        decisionId: context.req.param("decisionId"),
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
      const records = await runtime.decisions.events.load(query.data.meetingId);
      const projection = replayMeeting(
        domainMeetingId(query.data.meetingId),
        records.map(({ event, position }) => ({
          ...event,
          position: meetingPosition(position),
        })),
      );
      const decision = projection.shared.decisions.find(
        ({ id }) => String(id) === String(query.data.decisionId),
      );
      if (decision === undefined) {
        return errorResponse(context, "VALIDATION_FAILED");
      }
      const revisions = projection.shared.decisionRevisions.filter(
        ({ decisionId }) => decisionId === decision.id,
      );
      return context.json(
        DecisionHistoryResponseSchema.parse({
          correlationId: context.get("correlationId"),
          decision: decisionView(
            decision,
            revisions.at(-1)?.createdAt ?? decision.createdAt,
          ),
          meetingId: query.data.meetingId,
          revisions: revisions.map(decisionRevisionView),
        }),
      );
    },
  );

  app.get(
    "/api/v1/meetings/:meetingId/decisions/:decisionId/export",
    async (context) => {
      const query = DecisionJsonExportQuerySchema.safeParse({
        decisionId: context.req.param("decisionId"),
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
      const records = await runtime.decisions.events.load(query.data.meetingId);
      const projection = replayMeeting(
        domainMeetingId(query.data.meetingId),
        records.map(({ event, position }) => ({
          ...event,
          position: meetingPosition(position),
        })),
      );
      const decision = projection.shared.decisions.find(
        ({ id }) => String(id) === String(query.data.decisionId),
      );
      if (decision === undefined) {
        return errorResponse(context, "VALIDATION_FAILED");
      }
      const revisions = projection.shared.decisionRevisions.filter(
        ({ decisionId }) => decisionId === decision.id,
      );
      return context.json(
        DecisionJsonExportResponseSchema.parse({
          auditEntries: decisionAuditEntries(records, query.data.decisionId),
          correlationId: context.get("correlationId"),
          decision: decisionView(
            decision,
            revisions.at(-1)?.createdAt ?? decision.createdAt,
          ),
          exportedAt: runtime.clock.now(),
          meetingId: query.data.meetingId,
          revisions: revisions.map(decisionRevisionView),
        }),
      );
    },
  );

  app.get("/api/v1/meetings/:meetingId/decisions/audit", async (context) => {
    const query = DecisionAuditQuerySchema.safeParse({
      meetingId: context.req.param("meetingId"),
      ...(context.req.query("decisionId") === undefined
        ? {}
        : { decisionId: context.req.query("decisionId") }),
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
    const records = await runtime.decisions.events.load(query.data.meetingId);
    const entries = decisionAuditEntries(records, query.data.decisionId);
    const response = DecisionAuditResponseSchema.safeParse({
      correlationId: context.get("correlationId"),
      entries,
      meetingId: query.data.meetingId,
    });
    return response.success
      ? context.json(response.data)
      : errorResponse(context, "VALIDATION_FAILED");
  });

  app.get(
    "/api/v1/realtime",
    upgradeWebSocket((context) => {
      const parsedTicket = RealtimeTicketSchema.safeParse(
        context.req.query("ticket"),
      );
      const ticket = parsedTicket.success
        ? runtime.realtime.consumeTicket(parsedTicket.data)
        : undefined;
      let unsubscribe: (() => void) | undefined;
      return {
        onOpen(_event, socket) {
          void (async () => {
            if (ticket === undefined) {
              socket.close(4401, "Invalid or expired realtime ticket");
              return;
            }
            const authorization = await realtimeAuthorization(runtime, ticket);
            if (authorization === undefined) {
              socket.close(4401, "Session or meeting access expired");
              return;
            }
            const records = await runtime.decisions.events.load(
              ticket.meetingId,
            );
            const currentPosition = records.filter(
              ({ event }) =>
                event.visibility === "shared" ||
                event.ownerParticipantId === ticket.participantId,
            ).length;
            if (ticket.lastSeenPosition > currentPosition) {
              socket.close(4409, "Resume position is ahead of the meeting");
              return;
            }
            unsubscribe = await runtime.realtime.subscribe({
              close: (code, reason) => socket.close(code, reason),
              currentPosition,
              revalidate: async () =>
                (await realtimeAuthorization(runtime, ticket)) !== undefined,
              send: (message) => socket.send(JSON.stringify(message)),
              snapshot: async (correlationId) => {
                const currentAuthorization = await realtimeAuthorization(
                  runtime,
                  ticket,
                );
                return currentAuthorization === undefined
                  ? undefined
                  : realtimeRoleProjectionFor(
                      runtime,
                      currentAuthorization,
                      correlationId,
                    );
              },
              ticket,
            });
          })().catch(() => {
            socket.close(1011, "Realtime connection failed");
          });
        },
        onClose() {
          unsubscribe?.();
        },
        onError() {
          unsubscribe?.();
        },
        onMessage(_event, socket) {
          socket.close(4400, "Client messages are not supported");
        },
      };
    }),
  );

  app.notFound((context) => errorResponse(context, "MEETING_NOT_FOUND"));
  app.onError((_error, context) => errorResponse(context, "CONFLICT"));
  return app;
}
