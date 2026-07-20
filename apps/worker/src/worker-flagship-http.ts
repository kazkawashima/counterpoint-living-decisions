import {
  approveDisclosure,
  authenticateSession,
  commitDecision,
  dispositionDecisionCandidate,
  evaluateAssumptionInvalidation,
  listAssumptionInvalidationEvaluations,
  listAssignedMeetings,
  login,
  logout,
  previewDisclosure,
  proposeDisclosure,
  registerPrivateTextSource,
  rejectDisclosure,
  resetDemoMeeting,
  markDecisionReady,
  injectDemoRegulatoryChange,
  prepareSharedDecisionCandidate,
  reviewInvalidation,
  saveDecisionDraft,
  startDecisionMonitoring,
  resolveMeetingAuthorization,
  type DisclosureDependencies,
  type DecisionDependencies,
  type DecisionCandidateDependencies,
  type DecisionCandidateFailure,
  type DecisionFailure,
  type ExternalEventDependencies,
  type InvalidationEvaluationDependencies,
  type InvalidationEvaluationView,
  type InvalidationReviewFailure,
  type UserAuthorizationContext,
  type UserAuthorizationPolicy,
} from "@counterpoint/application";
import {
  domainEventTypes,
  meetingId as domainMeetingId,
  meetingPosition,
  replayMeeting,
  type ExternalEvent as DomainExternalEvent,
  type DomainEvent,
  type Decision as DomainDecision,
  type DecisionRevision as DomainDecisionRevision,
  type MeetingProjection,
} from "@counterpoint/domain";
import {
  D1EventStore,
  D1IdentityRepository,
  D1MeetingRepository,
  D1ProjectionStore,
  D1SessionRepository,
  R2ArtifactStore,
  ScryptPasswordVerifier,
  WebCryptoSessionTokenIssuer,
  createJsonCodec,
} from "@counterpoint/adapters-cloudflare";
import {
  DeterministicPrivateDisclosureModel,
  DeterministicAssumptionInvalidationModel,
  DeterministicSharedDecisionModel,
  OpenAiAssumptionInvalidationEvaluator,
  OpenAiCandidateError,
  OpenAiPrivateDisclosureProposer,
  OpenAiSharedDecisionSynthesizer,
} from "@counterpoint/adapters-openai";
import {
  apiErrorResponse,
  apiJsonResponse,
  parseBearerToken,
} from "@counterpoint/http-api";
import type {
  Clock,
  EventStore,
  IdGenerator,
  IdentityRepository,
  MeetingRepository,
  PasswordVerifier,
  SessionRepository,
  SessionTokenIssuer,
} from "@counterpoint/ports";
import {
  JudgePrivateDisclosureError,
  runJudgePrivateDisclosure,
  type JudgePrivateDisclosureRuntimeDependencies,
} from "./judge-private-disclosure.js";
import {
  JudgeSharedDecisionError,
  runJudgeSharedDecision,
  type JudgeSharedDecisionRuntimeDependencies,
} from "./judge-shared-decision.js";
import {
  ApproveDisclosureRequestSchema,
  ApproveDisclosureResponseSchema,
  CommitDecisionRequestSchema,
  CommitDecisionResponseSchema,
  DispositionSharedDecisionCandidateRequestSchema,
  DispositionSharedDecisionCandidateResponseSchema,
  GetRoleProjectionResponseSchema,
  ListInvalidationEvaluationsResponseSchema,
  ListAssignedMeetingsResponseSchema,
  ListSharedDecisionsResponseSchema,
  ListSharedEvidenceResponseSchema,
  ListSharedExternalEventsResponseSchema,
  LoginRequestSchema,
  LoginResponseSchema,
  LogoutRequestSchema,
  LogoutResponseSchema,
  PreviewDisclosureRequestSchema,
  PreviewDisclosureResponseSchema,
  ProposeDisclosureRequestSchema,
  ProposeDisclosureResponseSchema,
  RejectDisclosureRequestSchema,
  RejectDisclosureResponseSchema,
  RegisterPrivateTextSourceFixtureRequestSchema,
  RegisterPrivateTextSourceFixtureResponseSchema,
  RoleProjectionQuerySchema,
  MarkDecisionReadyRequestSchema,
  MarkDecisionReadyResponseSchema,
  SaveDecisionDraftRequestSchema,
  SaveDecisionDraftResponseSchema,
  StartDecisionMonitoringRequestSchema,
  StartDecisionMonitoringResponseSchema,
  SynthesizeSharedDecisionRequestSchema,
  SynthesizeSharedDecisionResponseSchema,
  InjectDemoRegulatoryChangeRequestSchema,
  InjectDemoRegulatoryChangeResponseSchema,
  FacilitatorDemoResetRequestSchema,
  FacilitatorDemoResetResponseSchema,
  ReviewInvalidationRequestSchema,
  ReviewInvalidationResponseSchema,
  type CommitDecisionRequest,
  type DispositionSharedDecisionCandidateRequest,
  type FacilitatorDemoResetRequest,
  type InjectDemoRegulatoryChangeRequest,
  type MarkDecisionReadyRequest,
  type ApproveDisclosureRequest,
  type PreviewDisclosureRequest,
  type ProposeDisclosureRequest,
  type RejectDisclosureRequest,
  type SaveDecisionDraftRequest,
  type StartDecisionMonitoringRequest,
  type SynthesizeSharedDecisionRequest,
  type RegisterPrivateTextSourceFixtureRequest,
  type ReviewInvalidationRequest,
} from "@counterpoint/protocol";

export interface WorkerFlagshipHttpDependencies {
  readonly clock: Clock;
  readonly decisionCandidates: DecisionCandidateDependencies;
  readonly decisions: DecisionDependencies;
  readonly disclosures: DisclosureDependencies;
  readonly externalEvents: ExternalEventDependencies;
  readonly invalidationEvaluations: InvalidationEvaluationDependencies;
  readonly events: EventStore<DomainEvent>;
  readonly identities: IdentityRepository;
  readonly ids: IdGenerator;
  readonly meetings: MeetingRepository;
  readonly passwords: PasswordVerifier;
  readonly sessions: SessionRepository;
  readonly tokens: SessionTokenIssuer;
  readonly authorizationPolicy?: UserAuthorizationPolicy;
  readonly deterministicPrivateDisclosureEnabled?: boolean;
  readonly deterministicSharedDecisionEnabled?: boolean;
  readonly judgePrivateDisclosure?: JudgePrivateDisclosureRuntimeDependencies;
  readonly judgeSharedDecision?: JudgeSharedDecisionRuntimeDependencies;
}

export interface WorkerFlagshipD1Bindings {
  readonly ARTIFACTS: R2Bucket;
  readonly DB: D1Database;
  readonly OPENAI_MODE?: "disabled" | "deterministic";
  readonly OPENAI_MODEL?: string;
}

export type WorkerFlagshipOperation =
  | "approve-disclosure"
  | "commit-decision"
  | "decisions"
  | "disposition-decision-candidate"
  | "evidence"
  | "external-events"
  | "invalidation-evaluations"
  | "login"
  | "logout"
  | "mark-decision-ready"
  | "meetings"
  | "preview-disclosure"
  | "propose-disclosure"
  | "projection"
  | "prepare-decision-candidate"
  | "register-text-source"
  | "reject-disclosure"
  | "save-decision-draft"
  | "start-decision-monitoring"
  | "inject-demo-regulatory-change"
  | "review-invalidation"
  | "reset-demo";

const domainEventTypeSet = new Set<string>(domainEventTypes);

function parseStoredDomainEvent(input: unknown): DomainEvent {
  if (
    typeof input !== "object" ||
    input === null ||
    !("eventType" in input) ||
    typeof input.eventType !== "string" ||
    !domainEventTypeSet.has(input.eventType) ||
    !("eventId" in input) ||
    typeof input.eventId !== "string" ||
    !("meetingId" in input) ||
    typeof input.meetingId !== "string" ||
    !("position" in input) ||
    typeof input.position !== "number" ||
    !("schemaVersion" in input) ||
    typeof input.schemaVersion !== "number" ||
    !("visibility" in input) ||
    (input.visibility !== "private" && input.visibility !== "shared") ||
    !("payload" in input) ||
    typeof input.payload !== "object" ||
    input.payload === null
  ) {
    throw new TypeError("Stored domain event is invalid");
  }
  if (
    (input.visibility === "private" &&
      (!("ownerParticipantId" in input) ||
        typeof input.ownerParticipantId !== "string")) ||
    (input.visibility === "shared" && "ownerParticipantId" in input)
  ) {
    throw new TypeError("Stored domain event visibility scope is invalid");
  }
  return input as DomainEvent;
}

function nowClock(): Clock {
  return { now: () => new Date().toISOString() };
}

function randomIds(): IdGenerator {
  return { next: (namespace) => `${namespace}-${crypto.randomUUID()}` };
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

export function createWorkerFlagshipDependencies(
  bindings: WorkerFlagshipD1Bindings,
  options: { readonly clock?: Clock } = {},
): WorkerFlagshipHttpDependencies {
  const clock = options.clock ?? nowClock();
  const events = new D1EventStore(
    bindings.DB,
    createJsonCodec(parseStoredDomainEvent),
  );
  const projections = new D1ProjectionStore<MeetingProjection>(
    bindings.DB,
    createJsonCodec((input) => input as MeetingProjection),
  );
  const ids = randomIds();
  const hash = {
    async hash(value: string): Promise<string> {
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(value),
      );
      return `sha256:${toBase64Url(new Uint8Array(digest))}`;
    },
  };
  const decisions: DecisionDependencies = {
    clock,
    events,
    hash,
    ids,
    projections,
  };
  const meetings = new D1MeetingRepository(bindings.DB);
  const decisionCandidates: DecisionCandidateDependencies = {
    ...decisions,
    listParticipantIds: async (meetingId) =>
      (await meetings.listAssignments(meetingId))
        .filter(({ active }) => active)
        .map(({ participantId }) => participantId),
    ...(bindings.OPENAI_MODE === "deterministic"
      ? {
          synthesizer: new OpenAiSharedDecisionSynthesizer({
            model: bindings.OPENAI_MODEL ?? "gpt-5.6",
            modelAdapter: new DeterministicSharedDecisionModel(),
          }),
        }
      : {}),
  };
  const disclosures: DisclosureDependencies = {
    artifacts: new R2ArtifactStore(bindings.ARTIFACTS),
    clock,
    events,
    hash,
    ids,
    projections,
    ...(bindings.OPENAI_MODE === "deterministic"
      ? {
          candidateProposer: new OpenAiPrivateDisclosureProposer({
            model: bindings.OPENAI_MODEL ?? "gpt-5.6",
            modelAdapter: new DeterministicPrivateDisclosureModel(),
          }),
        }
      : {}),
  };
  const externalEvents: ExternalEventDependencies = {
    clock,
    events,
    ids,
    projections,
  };
  const invalidationEvaluator =
    bindings.OPENAI_MODE === "deterministic"
      ? new OpenAiAssumptionInvalidationEvaluator({
          model: bindings.OPENAI_MODEL ?? "gpt-5.6",
          modelAdapter: new DeterministicAssumptionInvalidationModel(),
        })
      : undefined;
  const invalidationEvaluations: InvalidationEvaluationDependencies = {
    clock,
    events,
    hash,
    ids,
    projections,
    ...(invalidationEvaluator === undefined
      ? {}
      : { evaluator: invalidationEvaluator }),
  };
  return {
    clock,
    decisionCandidates,
    decisions,
    disclosures,
    externalEvents,
    invalidationEvaluations,
    events,
    identities: new D1IdentityRepository(bindings.DB),
    ids,
    meetings,
    passwords: new ScryptPasswordVerifier(),
    sessions: new D1SessionRepository(bindings.DB),
    tokens: new WebCryptoSessionTokenIssuer(),
    ...(bindings.OPENAI_MODE === "deterministic"
      ? {
          deterministicPrivateDisclosureEnabled: true,
          deterministicSharedDecisionEnabled: true,
        }
      : {}),
  };
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

function publicCapabilities(
  capabilities: ReadonlySet<string>,
): readonly string[] {
  return [...capabilities].filter(
    (capability) => capability !== "judge:managed-ai",
  );
}

async function authenticatedSession(
  request: Request,
  dependencies: WorkerFlagshipHttpDependencies,
) {
  const bearerToken = parseBearerToken(request);
  if (bearerToken === undefined) {
    return {
      code: "AUTHENTICATION_REQUIRED" as const,
      kind: "rejected" as const,
    };
  }
  const result = await authenticateSession(dependencies, bearerToken);
  return result.kind === "rejected"
    ? result
    : { bearerToken, kind: "authenticated" as const, session: result.session };
}

function visiblePosition(
  events: readonly DomainEvent[],
  participantId: string,
  throughPosition?: number,
): number {
  return events.filter(
    (event) =>
      (throughPosition === undefined || event.position <= throughPosition) &&
      (event.visibility === "shared" ||
        event.ownerParticipantId === participantId),
  ).length;
}

function utteranceView(utterance: {
  readonly capturedAt: string;
  readonly channel: "private" | "shared";
  readonly id: string;
  readonly participantId: string;
  readonly text: string;
}) {
  return {
    capturedAt: utterance.capturedAt,
    channel: utterance.channel,
    participantId: utterance.participantId,
    text: utterance.text,
    utteranceId: utterance.id,
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
    decision: {
      activeRevision: evaluation.decision.activeRevision,
      activeRevisionId: evaluation.decision.activeRevisionId,
      decisionId: evaluation.decision.id,
      readiness: {
        actionIds: evaluation.decision.actionIds.length > 0,
        evidenceIds: evaluation.decision.evidenceIds.length > 0,
        monitorCondition:
          evaluation.decision.monitorCondition.description.length > 0,
        outcome: evaluation.decision.outcome.length > 0,
        premiseIds: evaluation.decision.premiseIds.length > 0,
      },
      snapshot: {
        actionIds: evaluation.decision.actionIds,
        dissentIds: evaluation.decision.dissentIds,
        evidenceIds: evaluation.decision.evidenceIds,
        monitorCondition: evaluation.decision.monitorCondition,
        outcome: evaluation.decision.outcome,
        premiseIds: evaluation.decision.premiseIds,
        status: evaluation.decision.status,
        title: evaluation.decision.title,
      },
      status: evaluation.decision.status,
      ...(evaluation.decision.supersededByDecisionId === undefined
        ? {}
        : {
            supersededByDecisionId: evaluation.decision.supersededByDecisionId,
          }),
      updatedAt: evaluation.generatedAt,
    },
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

function privateDisclosureCandidates(
  events: readonly DomainEvent[],
  participantId: string,
) {
  const candidates = new Map<
    string,
    {
      candidateId: string;
      outgoingPayload: {
        exactSnippet: string;
        sourceArtifactId: string;
        sourceRange: { end: number; start: number };
      };
      previewHash?: string;
      state: "approved" | "previewed" | "proposed" | "rejected";
    }
  >();
  for (const event of events) {
    if (
      event.visibility !== "private" ||
      event.ownerParticipantId !== participantId
    ) {
      continue;
    }
    switch (event.eventType) {
      case "DisclosureProposed":
        candidates.set(String(event.payload.disclosureId), {
          candidateId: String(event.payload.disclosureId),
          outgoingPayload: event.payload.outgoingPayload,
          state: "proposed",
        });
        break;
      case "DisclosurePreviewed": {
        const candidateId = String(event.payload.disclosureId);
        const prior = candidates.get(candidateId);
        if (prior !== undefined) {
          candidates.set(candidateId, {
            ...prior,
            outgoingPayload: event.payload.outgoingPayload,
            previewHash: event.payload.previewHash,
            state: "previewed",
          });
        }
        break;
      }
      case "DisclosureApproved": {
        const candidateId = String(event.payload.disclosureId);
        const prior = candidates.get(candidateId);
        if (prior !== undefined) {
          candidates.set(candidateId, {
            ...prior,
            previewHash: event.payload.previewHash,
            state: "approved",
          });
        }
        break;
      }
      case "DisclosureRejected": {
        const candidateId = String(event.payload.disclosureId);
        const prior = candidates.get(candidateId);
        if (prior !== undefined) {
          candidates.set(candidateId, { ...prior, state: "rejected" });
        }
        break;
      }
      default:
        break;
    }
  }
  return [...candidates.values()];
}

function eventsAfterLatestDemoReset(
  events: readonly DomainEvent[],
): readonly DomainEvent[] {
  const resetIndex = events.findLastIndex(
    (event) => event.eventType === "DemoResetCompleted",
  );
  return resetIndex < 0 ? events : events.slice(resetIndex + 1);
}

function decisionView(
  decision: DomainDecision,
  updatedAt: string = decision.createdAt,
) {
  return {
    activeRevision: decision.activeRevision,
    activeRevisionId: decision.activeRevisionId,
    decisionId: decision.id,
    readiness: {
      actionIds: decision.actionIds.length > 0,
      evidenceIds: decision.evidenceIds.length > 0,
      monitorCondition: decision.monitorCondition.description.length > 0,
      outcome: decision.outcome.length > 0,
      premiseIds: decision.premiseIds.length > 0,
    },
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

function decisionFailureResponse(
  correlationId: string,
  failure: DecisionFailure | DecisionCandidateFailure,
) {
  if (failure.code === "CONFLICT") {
    return apiErrorResponse("CONFLICT", correlationId, {
      actualPosition: failure.actualPosition,
      expectedPosition: failure.expectedPosition,
    });
  }
  return failure.code === "FORBIDDEN" ||
    failure.code === "IDEMPOTENCY_CONFLICT" ||
    failure.code === "INVALID_STATE_TRANSITION" ||
    failure.code === "OPENAI_UNAVAILABLE"
    ? apiErrorResponse(failure.code, correlationId)
    : apiErrorResponse("VALIDATION_FAILED", correlationId);
}

function invalidationReviewFailureResponse(
  correlationId: string,
  failure: InvalidationReviewFailure,
) {
  return failure.code === "CONFLICT"
    ? apiErrorResponse("CONFLICT", correlationId, {
        actualPosition: failure.actualPosition,
        expectedPosition: failure.expectedPosition,
      })
    : failure.code === "FORBIDDEN" ||
        failure.code === "IDEMPOTENCY_CONFLICT" ||
        failure.code === "INVALID_STATE_TRANSITION"
      ? apiErrorResponse(failure.code, correlationId)
      : apiErrorResponse("VALIDATION_FAILED", correlationId);
}

async function attemptInvalidationEvaluation(
  dependencies: WorkerFlagshipHttpDependencies,
  correlationId: string,
  externalEventId: string,
  meetingId: string,
): Promise<void> {
  try {
    await evaluateAssumptionInvalidation(dependencies.invalidationEvaluations, {
      correlationId,
      externalEventId,
      meetingId,
    });
  } catch {
    // The receipt is durable even when a provider is unavailable or fails.
    // The shared read model remains in MONITORING/pending until retried.
  }
}

async function assignedMeeting(
  dependencies: WorkerFlagshipHttpDependencies,
  meetingId: string,
  userId: string,
) {
  const [meeting, assignment, records] = await Promise.all([
    dependencies.meetings.findById(meetingId),
    dependencies.meetings.findAssignment(meetingId, userId),
    dependencies.events.load(meetingId),
  ]);
  if (meeting?.active !== true || assignment?.active !== true) {
    return undefined;
  }
  const events = records.map(({ event, position }) => ({
    ...event,
    position: meetingPosition(position),
  }));
  const projection = replayMeeting(domainMeetingId(meetingId), events);
  return {
    meetingId,
    participantId: assignment.participantId,
    phase: projection.shared.meeting?.phase ?? "preparing",
    position: visiblePosition(events, assignment.participantId),
    purpose: meeting.purpose,
    role: assignment.role,
  };
}

async function roleProjection(
  dependencies: WorkerFlagshipHttpDependencies,
  authorization: UserAuthorizationContext,
  correlationId: string,
) {
  const meeting = await dependencies.meetings.findById(authorization.meetingId);
  const assignment = await dependencies.meetings.findAssignment(
    authorization.meetingId,
    authorization.userId,
  );
  if (meeting?.active !== true || assignment?.active !== true) {
    return undefined;
  }
  const [records, assignments] = await Promise.all([
    dependencies.events.load(authorization.meetingId),
    dependencies.meetings.listAssignments(authorization.meetingId),
  ]);
  const events = records.map(({ event, position }) => ({
    ...event,
    position: meetingPosition(position),
  }));
  const activeEvents = eventsAfterLatestDemoReset(events);
  const projection = replayMeeting(
    domainMeetingId(authorization.meetingId),
    events,
  );
  const privateWorkspace = projection.privateWorkspaces.find(
    ({ ownerParticipantId }) =>
      ownerParticipantId === authorization.participantId,
  );
  const privateSources = await Promise.all(
    activeEvents.flatMap((event) =>
      event.eventType === "ArtifactRegistered" &&
      event.visibility === "private" &&
      event.ownerParticipantId === authorization.participantId &&
      event.payload.artifact.artifactType === "text"
        ? [
            dependencies.disclosures.artifacts
              .get({
                artifactId: event.payload.artifact.id,
                meetingId: authorization.meetingId,
                ownerParticipantId: authorization.participantId,
                visibility: "private",
              })
              .then((bytes) =>
                bytes === undefined
                  ? undefined
                  : {
                      createdAt: event.occurredAt,
                      sourceArtifactId: event.payload.artifact.id,
                      text: new TextDecoder().decode(bytes),
                      title: "Registered private text source",
                    },
              ),
          ]
        : [],
    ),
  ).then((sources) =>
    sources.filter(
      (source): source is NonNullable<typeof source> => source !== undefined,
    ),
  );

  return GetRoleProjectionResponseSchema.parse({
    capabilities: publicCapabilities(authorization.capabilities),
    correlationId,
    meeting: {
      meetingId: meeting.meetingId,
      phase: projection.shared.meeting?.phase ?? "preparing",
      purpose: meeting.purpose,
    },
    participant: {
      participantId: assignment.participantId,
      role: assignment.role,
      userId: assignment.userId,
    },
    privateWorkspace: {
      artifacts: [],
      disclosureCandidates: privateDisclosureCandidates(
        activeEvents,
        authorization.participantId,
      ),
      inferenceSuggestions: [],
      sources: privateSources,
      utterances: (privateWorkspace?.utterances ?? []).map(utteranceView),
    },
    shared: {
      actions: projection.shared.actions.map(
        ({ id, ownerParticipantId, scope, status }) => ({
          actionId: id,
          ownerParticipantId,
          scope,
          status,
        }),
      ),
      decisions: projection.shared.decisions.map((decision) => {
        const revision = projection.shared.decisionRevisions.find(
          ({ id }) => id === decision.activeRevisionId,
        );
        return {
          activeRevision: decision.activeRevision,
          activeRevisionId: decision.activeRevisionId,
          decisionId: decision.id,
          readiness: {
            actionIds: decision.actionIds.length > 0,
            evidenceIds: decision.evidenceIds.length > 0,
            monitorCondition: decision.monitorCondition.description.length > 0,
            outcome: decision.outcome.length > 0,
            premiseIds: decision.premiseIds.length > 0,
          },
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
          updatedAt: revision?.createdAt ?? decision.createdAt,
        };
      }),
      dissent: projection.shared.dissent.map(({ id, reason, retained }) => ({
        dissentId: id,
        reason,
        retained,
      })),
      evidence: projection.shared.evidence.map(
        ({ createdAt, exactSnippet, id, sourceArtifactId, sourceRange }) => ({
          createdAt,
          evidenceId: id,
          exactSnippet,
          sourceArtifactId,
          sourceRange,
        }),
      ),
      participants: assignments
        .filter(({ active }) => active)
        .map(({ active, participantId, role, userId }) => ({
          active,
          participantId,
          role,
          userId,
        })),
      position: visiblePosition(events, authorization.participantId),
      premises: projection.shared.premises.map(
        ({ confirmationStatus, id, statement }) => ({
          confirmationStatus,
          premiseId: id,
          statement,
        }),
      ),
      sharedFloor: projection.shared.sharedFloor ?? null,
      utterances: projection.shared.utterances.map(utteranceView),
    },
  });
}

export async function handleWorkerFlagshipHttp(input: {
  readonly correlationId: string;
  readonly dependencies: WorkerFlagshipHttpDependencies;
  readonly meetingId?: string;
  readonly operation: WorkerFlagshipOperation;
  readonly request: Request;
}): Promise<Response> {
  const {
    correlationId,
    dependencies,
    meetingId: requestedMeetingId,
    operation,
    request,
  } = input;
  let meetingId = requestedMeetingId;
  let approveDisclosureRequest: ApproveDisclosureRequest | undefined;
  let previewDisclosureRequest: PreviewDisclosureRequest | undefined;
  let proposeDisclosureRequest: ProposeDisclosureRequest | undefined;
  let rejectDisclosureRequest: RejectDisclosureRequest | undefined;
  let saveDecisionDraftRequest: SaveDecisionDraftRequest | undefined;
  let markDecisionReadyRequest: MarkDecisionReadyRequest | undefined;
  let commitDecisionRequest: CommitDecisionRequest | undefined;
  let startDecisionMonitoringRequest:
    StartDecisionMonitoringRequest | undefined;
  let prepareDecisionCandidateRequest:
    SynthesizeSharedDecisionRequest | undefined;
  let dispositionDecisionCandidateRequest:
    DispositionSharedDecisionCandidateRequest | undefined;
  let injectDemoRegulatoryChangeRequest:
    InjectDemoRegulatoryChangeRequest | undefined;
  let reviewInvalidationRequest: ReviewInvalidationRequest | undefined;
  let resetDemoRequest: FacilitatorDemoResetRequest | undefined;
  let registerTextSourceRequest:
    RegisterPrivateTextSourceFixtureRequest | undefined;

  if (operation === "login") {
    const parsed = LoginRequestSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      return apiErrorResponse("VALIDATION_FAILED", correlationId);
    }
    const result = await login(dependencies, parsed.data);
    if (result.kind === "rejected") {
      return apiErrorResponse(result.code, correlationId);
    }
    return apiJsonResponse(
      LoginResponseSchema.parse({
        bearerToken: result.bearerToken,
        correlationId,
        expiresAt: result.expiresAt,
        userId: result.userId,
      }),
      200,
      correlationId,
    );
  }

  const authenticated = await authenticatedSession(request, dependencies);
  if (authenticated.kind === "rejected") {
    return apiErrorResponse(authenticated.code, correlationId);
  }

  if (operation === "logout") {
    const parsed = LogoutRequestSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      return apiErrorResponse("VALIDATION_FAILED", correlationId);
    }
    await logout(dependencies, authenticated.bearerToken);
    return apiJsonResponse(
      LogoutResponseSchema.parse({
        correlationId,
        loggedOutAt: dependencies.clock.now(),
      }),
      200,
      correlationId,
    );
  }

  if (operation === "meetings") {
    const assigned = await listAssignedMeetings(
      dependencies.meetings,
      authenticated.session.userId,
    );
    const meetings = await Promise.all(
      assigned.map(({ meetingId: assignedMeetingId }) =>
        assignedMeeting(
          dependencies,
          assignedMeetingId,
          authenticated.session.userId,
        ),
      ),
    );
    return apiJsonResponse(
      ListAssignedMeetingsResponseSchema.parse({
        correlationId,
        meetings: meetings.filter(
          (meeting): meeting is NonNullable<typeof meeting> =>
            meeting !== undefined,
        ),
      }),
      200,
      correlationId,
    );
  }

  if (operation === "register-text-source") {
    const parsed = RegisterPrivateTextSourceFixtureRequestSchema.safeParse(
      await readJson(request),
    );
    if (!parsed.success) {
      return apiErrorResponse("VALIDATION_FAILED", correlationId);
    }
    registerTextSourceRequest = parsed.data;
    meetingId = parsed.data.meetingId;
  }
  if (operation === "propose-disclosure") {
    const parsed = ProposeDisclosureRequestSchema.safeParse(
      await readJson(request),
    );
    if (!parsed.success) {
      return apiErrorResponse("VALIDATION_FAILED", correlationId);
    }
    proposeDisclosureRequest = parsed.data;
    meetingId = parsed.data.meetingId;
  }
  if (operation === "preview-disclosure") {
    const parsed = PreviewDisclosureRequestSchema.safeParse(
      await readJson(request),
    );
    if (!parsed.success) {
      return apiErrorResponse("VALIDATION_FAILED", correlationId);
    }
    previewDisclosureRequest = parsed.data;
    meetingId = parsed.data.meetingId;
  }
  if (operation === "approve-disclosure") {
    const parsed = ApproveDisclosureRequestSchema.safeParse(
      await readJson(request),
    );
    if (!parsed.success) {
      return apiErrorResponse("VALIDATION_FAILED", correlationId);
    }
    approveDisclosureRequest = parsed.data;
    meetingId = parsed.data.meetingId;
  }
  if (operation === "reject-disclosure") {
    const parsed = RejectDisclosureRequestSchema.safeParse(
      await readJson(request),
    );
    if (!parsed.success) {
      return apiErrorResponse("VALIDATION_FAILED", correlationId);
    }
    rejectDisclosureRequest = parsed.data;
    meetingId = parsed.data.meetingId;
  }
  if (operation === "save-decision-draft") {
    const parsed = SaveDecisionDraftRequestSchema.safeParse(
      await readJson(request),
    );
    if (!parsed.success) {
      return apiErrorResponse("VALIDATION_FAILED", correlationId);
    }
    saveDecisionDraftRequest = parsed.data;
    meetingId = parsed.data.meetingId;
  }
  if (operation === "mark-decision-ready") {
    const parsed = MarkDecisionReadyRequestSchema.safeParse(
      await readJson(request),
    );
    if (!parsed.success) {
      return apiErrorResponse("VALIDATION_FAILED", correlationId);
    }
    markDecisionReadyRequest = parsed.data;
    meetingId = parsed.data.meetingId;
  }
  if (operation === "commit-decision") {
    const parsed = CommitDecisionRequestSchema.safeParse(
      await readJson(request),
    );
    if (!parsed.success) {
      return apiErrorResponse("VALIDATION_FAILED", correlationId);
    }
    commitDecisionRequest = parsed.data;
    meetingId = parsed.data.meetingId;
  }
  if (operation === "start-decision-monitoring") {
    const parsed = StartDecisionMonitoringRequestSchema.safeParse(
      await readJson(request),
    );
    if (!parsed.success) {
      return apiErrorResponse("VALIDATION_FAILED", correlationId);
    }
    startDecisionMonitoringRequest = parsed.data;
    meetingId = parsed.data.meetingId;
  }
  if (operation === "prepare-decision-candidate") {
    const parsed = SynthesizeSharedDecisionRequestSchema.safeParse(
      await readJson(request),
    );
    if (!parsed.success) {
      return apiErrorResponse("VALIDATION_FAILED", correlationId);
    }
    prepareDecisionCandidateRequest = parsed.data;
    meetingId = parsed.data.meetingId;
  }
  if (operation === "disposition-decision-candidate") {
    const parsed = DispositionSharedDecisionCandidateRequestSchema.safeParse(
      await readJson(request),
    );
    if (!parsed.success) {
      return apiErrorResponse("VALIDATION_FAILED", correlationId);
    }
    dispositionDecisionCandidateRequest = parsed.data;
    meetingId = parsed.data.meetingId;
  }
  if (operation === "inject-demo-regulatory-change") {
    const parsed = InjectDemoRegulatoryChangeRequestSchema.safeParse(
      await readJson(request),
    );
    if (!parsed.success) {
      return apiErrorResponse("VALIDATION_FAILED", correlationId);
    }
    injectDemoRegulatoryChangeRequest = parsed.data;
  }
  if (operation === "review-invalidation") {
    const parsed = ReviewInvalidationRequestSchema.safeParse(
      await readJson(request),
    );
    if (!parsed.success) {
      return apiErrorResponse("VALIDATION_FAILED", correlationId);
    }
    reviewInvalidationRequest = parsed.data;
    meetingId = parsed.data.meetingId;
  }
  if (operation === "reset-demo") {
    const parsed = FacilitatorDemoResetRequestSchema.safeParse(
      await readJson(request),
    );
    if (!parsed.success) {
      return apiErrorResponse("VALIDATION_FAILED", correlationId);
    }
    resetDemoRequest = parsed.data;
    meetingId = parsed.data.meetingId;
  }

  if (meetingId === undefined) {
    return apiErrorResponse("VALIDATION_FAILED", correlationId);
  }
  const query = RoleProjectionQuerySchema.safeParse({ meetingId });
  if (!query.success) {
    return apiErrorResponse("VALIDATION_FAILED", correlationId);
  }
  const resolved = await resolveMeetingAuthorization(
    dependencies.meetings,
    authenticated.session,
    query.data.meetingId,
    dependencies.authorizationPolicy,
  );
  if (resolved.kind === "rejected") {
    return apiErrorResponse(resolved.code, correlationId);
  }

  if (operation === "register-text-source") {
    if (registerTextSourceRequest === undefined) {
      return apiErrorResponse("VALIDATION_FAILED", correlationId);
    }
    const result = await registerPrivateTextSource(
      dependencies.disclosures,
      resolved.authorization,
      {
        ...registerTextSourceRequest,
        correlationId,
        expectedPosition: await dependencies.events.position(meetingId),
      },
    );
    if (result.kind === "failed") {
      return result.code === "CONFLICT"
        ? apiErrorResponse("CONFLICT", correlationId, {
            actualPosition: result.actualPosition,
            expectedPosition: result.expectedPosition,
          })
        : apiErrorResponse(result.code, correlationId);
    }
    const records = await dependencies.events.load(meetingId);
    const events = records.map(({ event, position }) => ({
      ...event,
      position: meetingPosition(position),
    }));
    return apiJsonResponse(
      RegisterPrivateTextSourceFixtureResponseSchema.parse({
        correlationId: result.correlationId,
        meetingId,
        position: visiblePosition(
          events,
          resolved.authorization.participantId,
          result.position,
        ),
        source: result.source,
      }),
      201,
      correlationId,
    );
  }

  if (operation === "propose-disclosure") {
    if (proposeDisclosureRequest === undefined) {
      return apiErrorResponse("VALIDATION_FAILED", correlationId);
    }
    const manualDisclosureDependencies = (): DisclosureDependencies => {
      const { artifacts, clock, events, hash, ids, projections } =
        dependencies.disclosures;
      return { artifacts, clock, events, hash, ids, projections };
    };
    const expectedPosition = await dependencies.events.position(meetingId);
    let result: Awaited<ReturnType<typeof proposeDisclosure>>;
    try {
      if (proposeDisclosureRequest.assistance === "ai_preferred") {
        const aiRequest = {
          ...proposeDisclosureRequest,
          assistance: "ai_preferred" as const,
        };
        const managed = dependencies.judgePrivateDisclosure;
        if (
          managed === undefined &&
          (dependencies.deterministicPrivateDisclosureEnabled !== true ||
            dependencies.disclosures.candidateProposer === undefined)
        ) {
          return apiErrorResponse("OPENAI_UNAVAILABLE", correlationId);
        }
        if (managed === undefined) {
          result = await proposeDisclosure(
            dependencies.disclosures,
            resolved.authorization,
            {
              ...aiRequest,
              correlationId,
              expectedPosition,
            },
          );
        } else {
          if (!resolved.authorization.capabilities.has("judge:managed-ai")) {
            return apiErrorResponse("JUDGE_MODE_FORBIDDEN", correlationId);
          }
          result = await runJudgePrivateDisclosure({
            authorization: resolved.authorization,
            claims: managed.claims,
            clock: dependencies.clock,
            dependencies: manualDisclosureDependencies(),
            execute: (disclosureDependencies) =>
              proposeDisclosure(
                disclosureDependencies,
                resolved.authorization,
                {
                  ...aiRequest,
                  correlationId,
                  expectedPosition,
                },
              ),
            ipAddress: managed.ipAddress,
            nextReservationId: managed.nextReservationId,
            proposer: managed.proposer,
            reconcile: managed.reconcile,
            request: aiRequest,
            usage: managed.usage,
          });
        }
      } else {
        result = await proposeDisclosure(
          manualDisclosureDependencies(),
          resolved.authorization,
          {
            ...proposeDisclosureRequest,
            correlationId,
            expectedPosition,
          },
        );
      }
    } catch (error) {
      if (error instanceof JudgePrivateDisclosureError) {
        return apiErrorResponse(error.code, correlationId, error.details);
      }
      if (error instanceof OpenAiCandidateError) {
        return apiErrorResponse("OPENAI_UNAVAILABLE", correlationId);
      }
      throw error;
    }
    if (result.kind === "failed") {
      return result.code === "CONFLICT"
        ? apiErrorResponse("CONFLICT", correlationId, {
            actualPosition: result.actualPosition,
            expectedPosition: result.expectedPosition,
          })
        : apiErrorResponse(result.code, correlationId);
    }
    const records = await dependencies.events.load(meetingId);
    const events = records.map(({ event, position }) => ({
      ...event,
      position: meetingPosition(position),
    }));
    return apiJsonResponse(
      ProposeDisclosureResponseSchema.parse({
        candidate: result.candidate,
        correlationId: result.correlationId,
        meetingId,
        origin:
          proposeDisclosureRequest.assistance === "ai_preferred"
            ? "ai_assisted"
            : "human_selected",
        position: visiblePosition(
          events,
          resolved.authorization.participantId,
          result.position,
        ),
      }),
      201,
      correlationId,
    );
  }

  if (operation === "preview-disclosure") {
    if (previewDisclosureRequest === undefined) {
      return apiErrorResponse("VALIDATION_FAILED", correlationId);
    }
    const result = await previewDisclosure(
      dependencies.disclosures,
      resolved.authorization,
      {
        ...previewDisclosureRequest,
        correlationId,
        expectedPosition: await dependencies.events.position(meetingId),
      },
    );
    if (result.kind === "failed") {
      return result.code === "CONFLICT"
        ? apiErrorResponse("CONFLICT", correlationId, {
            actualPosition: result.actualPosition,
            expectedPosition: result.expectedPosition,
          })
        : apiErrorResponse(result.code, correlationId);
    }
    const records = await dependencies.events.load(meetingId);
    const events = records.map(({ event, position }) => ({
      ...event,
      position: meetingPosition(position),
    }));
    return apiJsonResponse(
      PreviewDisclosureResponseSchema.parse({
        candidateId: result.candidateId,
        correlationId: result.correlationId,
        meetingId,
        outgoingPayload: result.outgoingPayload,
        position: visiblePosition(
          events,
          resolved.authorization.participantId,
          result.position,
        ),
        previewHash: result.previewHash,
      }),
      200,
      correlationId,
    );
  }

  if (operation === "approve-disclosure") {
    if (approveDisclosureRequest === undefined) {
      return apiErrorResponse("VALIDATION_FAILED", correlationId);
    }
    const result = await approveDisclosure(
      dependencies.disclosures,
      resolved.authorization,
      {
        ...approveDisclosureRequest,
        correlationId,
        expectedPosition: await dependencies.events.position(meetingId),
      },
    );
    if (result.kind === "failed") {
      return result.code === "CONFLICT"
        ? apiErrorResponse("CONFLICT", correlationId, {
            actualPosition: result.actualPosition,
            expectedPosition: result.expectedPosition,
          })
        : apiErrorResponse(result.code, correlationId);
    }
    const records = await dependencies.events.load(meetingId);
    const events = records.map(({ event, position }) => ({
      ...event,
      position: meetingPosition(position),
    }));
    return apiJsonResponse(
      ApproveDisclosureResponseSchema.parse({
        candidateId: result.candidateId,
        correlationId: result.correlationId,
        evidence: result.evidence,
        meetingId,
        position: visiblePosition(
          events,
          resolved.authorization.participantId,
          result.position,
        ),
        previewHash: result.previewHash,
      }),
      200,
      correlationId,
    );
  }

  if (operation === "reject-disclosure") {
    if (rejectDisclosureRequest === undefined) {
      return apiErrorResponse("VALIDATION_FAILED", correlationId);
    }
    const result = await rejectDisclosure(
      dependencies.disclosures,
      resolved.authorization,
      {
        candidateId: rejectDisclosureRequest.candidateId,
        correlationId,
        expectedPosition: await dependencies.events.position(meetingId),
        idempotencyKey: rejectDisclosureRequest.idempotencyKey,
        meetingId: rejectDisclosureRequest.meetingId,
        ...(rejectDisclosureRequest.reason === undefined
          ? {}
          : { reason: rejectDisclosureRequest.reason }),
      },
    );
    if (result.kind === "failed") {
      return result.code === "CONFLICT"
        ? apiErrorResponse("CONFLICT", correlationId, {
            actualPosition: result.actualPosition,
            expectedPosition: result.expectedPosition,
          })
        : apiErrorResponse(result.code, correlationId);
    }
    const records = await dependencies.events.load(meetingId);
    const events = records.map(({ event, position }) => ({
      ...event,
      position: meetingPosition(position),
    }));
    return apiJsonResponse(
      RejectDisclosureResponseSchema.parse({
        candidateId: result.candidateId,
        correlationId: result.correlationId,
        meetingId,
        position: visiblePosition(
          events,
          resolved.authorization.participantId,
          result.position,
        ),
        state: result.state,
      }),
      200,
      correlationId,
    );
  }

  if (operation === "start-decision-monitoring") {
    if (startDecisionMonitoringRequest === undefined) {
      return apiErrorResponse("VALIDATION_FAILED", correlationId);
    }
    const result = await startDecisionMonitoring(
      dependencies.decisions,
      resolved.authorization,
      {
        ...startDecisionMonitoringRequest,
        correlationId,
        expectedPosition: await dependencies.events.position(meetingId),
      },
    );
    if (result.kind === "failed") {
      return decisionFailureResponse(correlationId, result);
    }
    const records = await dependencies.events.load(meetingId);
    const events = records.map(({ event, position }) => ({
      ...event,
      position: meetingPosition(position),
    }));
    return apiJsonResponse(
      StartDecisionMonitoringResponseSchema.parse({
        correlationId: result.correlationId,
        decision: decisionView(result.decision, dependencies.clock.now()),
        meetingId,
        monitorRegistrationId: result.monitorRegistrationId,
        position: visiblePosition(
          events,
          resolved.authorization.participantId,
          result.position,
        ),
      }),
      200,
      correlationId,
    );
  }

  if (operation === "inject-demo-regulatory-change") {
    if (injectDemoRegulatoryChangeRequest === undefined) {
      return apiErrorResponse("VALIDATION_FAILED", correlationId);
    }
    const result = await injectDemoRegulatoryChange(
      dependencies.externalEvents,
      resolved.authorization,
      {
        correlationId,
        idempotencyKey: injectDemoRegulatoryChangeRequest.idempotencyKey,
        meetingId,
      },
    );
    if (result.kind === "failed") {
      if (result.code === "FORBIDDEN") {
        return apiErrorResponse("FORBIDDEN", correlationId);
      }
      if (result.code === "MONITOR_REGISTRATION_NOT_FOUND") {
        return apiErrorResponse("INVALID_STATE_TRANSITION", correlationId);
      }
      return result.code === "CONFLICT"
        ? apiErrorResponse("CONFLICT", correlationId)
        : result.code === "IDEMPOTENCY_CONFLICT"
          ? apiErrorResponse("IDEMPOTENCY_CONFLICT", correlationId)
          : apiErrorResponse("VALIDATION_FAILED", correlationId);
    }
    await attemptInvalidationEvaluation(
      dependencies,
      result.correlationId,
      result.event.id,
      meetingId,
    );
    const records = await dependencies.events.load(meetingId);
    const events = records.map(({ event, position }) => ({
      ...event,
      position: meetingPosition(position),
    }));
    return apiJsonResponse(
      InjectDemoRegulatoryChangeResponseSchema.parse({
        correlationId: result.correlationId,
        evaluationStatus: "pending",
        event: externalEventReceiptView(result.event),
        position: visiblePosition(
          events,
          resolved.authorization.participantId,
          result.position,
        ),
        receiptStatus: "received",
        replayed: result.replayed,
      }),
      202,
      correlationId,
    );
  }

  if (operation === "review-invalidation") {
    if (reviewInvalidationRequest === undefined) {
      return apiErrorResponse("VALIDATION_FAILED", correlationId);
    }
    const result = await reviewInvalidation(
      dependencies.decisions,
      resolved.authorization,
      {
        ...reviewInvalidationRequest,
        correlationId,
        expectedPosition: await dependencies.events.position(meetingId),
      },
    );
    if (result.kind === "failed") {
      return invalidationReviewFailureResponse(correlationId, result);
    }
    const records = await dependencies.events.load(meetingId);
    const events = records.map(({ event, position }) => ({
      ...event,
      position: meetingPosition(position),
    }));
    const common = {
      correlationId: result.correlationId,
      disposition: result.disposition,
      meetingId,
      position: visiblePosition(
        events,
        resolved.authorization.participantId,
        result.position,
      ),
      reviewAuditId: `audit-${result.reviewEventId}`,
      reviewEventId: result.reviewEventId,
      reviewReason: result.reviewReason,
      suggestionId: result.suggestionId,
    };
    return apiJsonResponse(
      ReviewInvalidationResponseSchema.parse(
        result.kind === "suggestion_rejected"
          ? {
              ...common,
              decision: decisionView(result.decision, dependencies.clock.now()),
            }
          : {
              ...common,
              decision: decisionView(result.decision, dependencies.clock.now()),
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
      200,
      correlationId,
    );
  }

  if (operation === "reset-demo") {
    if (resetDemoRequest === undefined) {
      return apiErrorResponse("VALIDATION_FAILED", correlationId);
    }
    const records = await dependencies.events.load(meetingId);
    const priorResetRequest = records.find(
      ({ event }) =>
        event.eventType === "DemoResetRequested" &&
        String(event.idempotencyKey) ===
          String(resetDemoRequest.idempotencyKey),
    );
    const result = await resetDemoMeeting(
      dependencies.decisions,
      resolved.authorization,
      {
        expectedPosition:
          priorResetRequest === undefined
            ? await dependencies.events.position(meetingId)
            : priorResetRequest.position - 1,
        idempotencyKey: resetDemoRequest.idempotencyKey,
        meetingId,
        seedName: "flagship",
      },
    );
    if (result.kind === "failed") {
      return result.code === "CONFLICT"
        ? apiErrorResponse("CONFLICT", correlationId, {
            actualPosition: result.actualPosition,
            expectedPosition: result.expectedPosition,
          })
        : apiErrorResponse(result.code, correlationId);
    }
    const nextRecords = await dependencies.events.load(meetingId);
    const nextEvents = nextRecords.map(({ event, position }) => ({
      ...event,
      position: meetingPosition(position),
    }));
    return apiJsonResponse(
      FacilitatorDemoResetResponseSchema.parse({
        correlationId: result.correlationId,
        meetingId,
        position: visiblePosition(
          nextEvents,
          resolved.authorization.participantId,
          result.position,
        ),
        resetRequestId: result.resetRequestId,
        resetStatus: "completed",
      }),
      200,
      correlationId,
    );
  }

  if (operation === "prepare-decision-candidate") {
    if (prepareDecisionCandidateRequest === undefined) {
      return apiErrorResponse("VALIDATION_FAILED", correlationId);
    }
    const decisionDependenciesWithoutSynthesizer =
      (): DecisionCandidateDependencies => {
        const { clock, events, hash, ids, listParticipantIds, projections } =
          dependencies.decisionCandidates;
        return {
          clock,
          events,
          hash,
          ids,
          listParticipantIds,
          projections,
        };
      };
    const expectedPosition = await dependencies.events.position(meetingId);
    let result: Awaited<ReturnType<typeof prepareSharedDecisionCandidate>>;
    try {
      if (prepareDecisionCandidateRequest.assistance === "manual") {
        result = await prepareSharedDecisionCandidate(
          decisionDependenciesWithoutSynthesizer(),
          resolved.authorization,
          {
            assistance: "manual",
            correlationId,
            draft: prepareDecisionCandidateRequest.draft,
            expectedPosition,
            idempotencyKey: prepareDecisionCandidateRequest.idempotencyKey,
            meetingId: prepareDecisionCandidateRequest.meetingId,
          },
        );
      } else {
        const aiRequest = {
          assistance: "ai_preferred" as const,
          correlationId,
          expectedPosition,
          idempotencyKey: prepareDecisionCandidateRequest.idempotencyKey,
          meetingId: prepareDecisionCandidateRequest.meetingId,
        };
        const managed = dependencies.judgeSharedDecision;
        if (managed === undefined) {
          const decisionDependencies =
            dependencies.deterministicSharedDecisionEnabled === true &&
            dependencies.decisionCandidates.synthesizer !== undefined
              ? dependencies.decisionCandidates
              : decisionDependenciesWithoutSynthesizer();
          result = await prepareSharedDecisionCandidate(
            decisionDependencies,
            resolved.authorization,
            aiRequest,
          );
        } else {
          if (resolved.authorization.role !== "facilitator") {
            return apiErrorResponse("FORBIDDEN", correlationId);
          }
          if (!resolved.authorization.capabilities.has("judge:managed-ai")) {
            return apiErrorResponse("JUDGE_MODE_FORBIDDEN", correlationId);
          }
          result = await runJudgeSharedDecision({
            authorization: resolved.authorization,
            claims: managed.claims,
            clock: dependencies.clock,
            dependencies: decisionDependenciesWithoutSynthesizer(),
            execute: (decisionDependencies) =>
              prepareSharedDecisionCandidate(
                decisionDependencies,
                resolved.authorization,
                aiRequest,
              ),
            ipAddress: managed.ipAddress,
            nextReservationId: managed.nextReservationId,
            reconcile: managed.reconcile,
            request: aiRequest,
            synthesizer: managed.synthesizer,
            usage: managed.usage,
          });
        }
      }
    } catch (error) {
      if (error instanceof JudgeSharedDecisionError) {
        return apiErrorResponse(error.code, correlationId, error.details);
      }
      if (error instanceof OpenAiCandidateError) {
        return apiErrorResponse("OPENAI_UNAVAILABLE", correlationId);
      }
      throw error;
    }
    if (result.kind === "failed") {
      return decisionFailureResponse(correlationId, result);
    }
    const records = await dependencies.events.load(meetingId);
    const events = records.map(({ event, position }) => ({
      ...event,
      position: meetingPosition(position),
    }));
    return apiJsonResponse(
      SynthesizeSharedDecisionResponseSchema.parse({
        candidate: result.candidate,
        correlationId: result.correlationId,
        meetingId,
        position: visiblePosition(
          events,
          resolved.authorization.participantId,
          result.position,
        ),
      }),
      201,
      correlationId,
    );
  }

  if (operation === "disposition-decision-candidate") {
    if (dispositionDecisionCandidateRequest === undefined) {
      return apiErrorResponse("VALIDATION_FAILED", correlationId);
    }
    const result = await dispositionDecisionCandidate(
      dependencies.decisionCandidates,
      resolved.authorization,
      {
        actions: dispositionDecisionCandidateRequest.actions,
        candidateId: dispositionDecisionCandidateRequest.candidateId,
        correlationId,
        dissent: dispositionDecisionCandidateRequest.dissent,
        expectedPosition: await dependencies.events.position(meetingId),
        idempotencyKey: dispositionDecisionCandidateRequest.idempotencyKey,
        meetingId: dispositionDecisionCandidateRequest.meetingId,
        premiseDispositions:
          dispositionDecisionCandidateRequest.premiseDispositions.map(
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
      return decisionFailureResponse(correlationId, result);
    }
    const records = await dependencies.events.load(meetingId);
    const events = records.map(({ event, position }) => ({
      ...event,
      position: meetingPosition(position),
    }));
    return apiJsonResponse(
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
        meetingId,
        position: visiblePosition(
          events,
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
      200,
      correlationId,
    );
  }

  if (operation === "save-decision-draft") {
    if (saveDecisionDraftRequest === undefined) {
      return apiErrorResponse("VALIDATION_FAILED", correlationId);
    }
    const result = await saveDecisionDraft(
      dependencies.decisions,
      resolved.authorization,
      {
        actionIds: saveDecisionDraftRequest.actionIds,
        changeReason: saveDecisionDraftRequest.changeReason,
        correlationId,
        ...(saveDecisionDraftRequest.decisionId === undefined
          ? {}
          : { decisionId: saveDecisionDraftRequest.decisionId }),
        dissentIds: saveDecisionDraftRequest.dissentIds,
        evidenceIds: saveDecisionDraftRequest.evidenceIds,
        expectedPosition: await dependencies.events.position(meetingId),
        idempotencyKey: saveDecisionDraftRequest.idempotencyKey,
        meetingId: saveDecisionDraftRequest.meetingId,
        monitorCondition: {
          description: saveDecisionDraftRequest.monitorCondition.description,
          ...(saveDecisionDraftRequest.monitorCondition.registrationId ===
          undefined
            ? {}
            : {
                registrationId:
                  saveDecisionDraftRequest.monitorCondition.registrationId,
              }),
        },
        outcome: saveDecisionDraftRequest.outcome,
        premiseIds: saveDecisionDraftRequest.premiseIds,
        title: saveDecisionDraftRequest.title,
      },
    );
    if (result.kind === "failed") {
      return decisionFailureResponse(correlationId, result);
    }
    const records = await dependencies.events.load(meetingId);
    const events = records.map(({ event, position }) => ({
      ...event,
      position: meetingPosition(position),
    }));
    return apiJsonResponse(
      SaveDecisionDraftResponseSchema.parse({
        correlationId: result.correlationId,
        decision: decisionView(result.decision, result.revision.createdAt),
        meetingId,
        position: visiblePosition(
          events,
          resolved.authorization.participantId,
          result.position,
        ),
        revision: decisionRevisionView(result.revision),
      }),
      201,
      correlationId,
    );
  }

  if (operation === "mark-decision-ready") {
    if (markDecisionReadyRequest === undefined) {
      return apiErrorResponse("VALIDATION_FAILED", correlationId);
    }
    const result = await markDecisionReady(
      dependencies.decisions,
      resolved.authorization,
      {
        ...markDecisionReadyRequest,
        correlationId,
        expectedPosition: await dependencies.events.position(meetingId),
      },
    );
    if (result.kind === "failed") {
      return decisionFailureResponse(correlationId, result);
    }
    const records = await dependencies.events.load(meetingId);
    const events = records.map(({ event, position }) => ({
      ...event,
      position: meetingPosition(position),
    }));
    return apiJsonResponse(
      MarkDecisionReadyResponseSchema.parse({
        correlationId: result.correlationId,
        decision: decisionView(result.decision, dependencies.clock.now()),
        meetingId,
        position: visiblePosition(
          events,
          resolved.authorization.participantId,
          result.position,
        ),
      }),
      200,
      correlationId,
    );
  }

  if (operation === "commit-decision") {
    if (commitDecisionRequest === undefined) {
      return apiErrorResponse("VALIDATION_FAILED", correlationId);
    }
    const result = await commitDecision(
      dependencies.decisions,
      resolved.authorization,
      {
        ...commitDecisionRequest,
        correlationId,
        expectedPosition: await dependencies.events.position(meetingId),
        explicitCommit: true,
      },
    );
    if (result.kind === "failed") {
      return decisionFailureResponse(correlationId, result);
    }
    const records = await dependencies.events.load(meetingId);
    const events = records.map(({ event, position }) => ({
      ...event,
      position: meetingPosition(position),
    }));
    return apiJsonResponse(
      CommitDecisionResponseSchema.parse({
        correlationId: result.correlationId,
        decision: decisionView(result.decision, result.revision.createdAt),
        meetingId,
        position: visiblePosition(
          events,
          resolved.authorization.participantId,
          result.position,
        ),
        revision: decisionRevisionView(result.revision),
      }),
      200,
      correlationId,
    );
  }

  if (operation === "evidence" || operation === "decisions") {
    const projection = await roleProjection(
      dependencies,
      resolved.authorization,
      correlationId,
    );
    if (projection === undefined) {
      return apiErrorResponse("FORBIDDEN", correlationId);
    }
    if (operation === "evidence") {
      return apiJsonResponse(
        ListSharedEvidenceResponseSchema.parse({
          correlationId,
          evidence: projection.shared.evidence,
          meetingId,
          position: projection.shared.position,
        }),
        200,
        correlationId,
      );
    }
    return apiJsonResponse(
      ListSharedDecisionsResponseSchema.parse({
        correlationId,
        decisions: projection.shared.decisions,
        meetingId,
        position: projection.shared.position,
      }),
      200,
      correlationId,
    );
  }

  if (operation === "external-events") {
    const records = await dependencies.events.load(meetingId);
    const events = records.map(({ event, position }) => ({
      ...event,
      position: meetingPosition(position),
    }));
    const projection = replayMeeting(domainMeetingId(meetingId), events);
    return apiJsonResponse(
      ListSharedExternalEventsResponseSchema.parse({
        correlationId,
        events: projection.shared.externalEvents.map(externalEventReceiptView),
        meetingId,
        position: visiblePosition(events, resolved.authorization.participantId),
      }),
      200,
      correlationId,
    );
  }

  if (operation === "invalidation-evaluations") {
    const records = await dependencies.events.load(meetingId);
    return apiJsonResponse(
      ListInvalidationEvaluationsResponseSchema.parse({
        correlationId,
        evaluations: listAssumptionInvalidationEvaluations(records).map(
          invalidationEvaluationView,
        ),
        meetingId,
        position: visiblePosition(
          records.map(({ event, position }) => ({
            ...event,
            position: meetingPosition(position),
          })),
          resolved.authorization.participantId,
        ),
      }),
      200,
      correlationId,
    );
  }

  const projection = await roleProjection(
    dependencies,
    resolved.authorization,
    correlationId,
  );
  return projection === undefined
    ? apiErrorResponse("FORBIDDEN", correlationId)
    : apiJsonResponse(projection, 200, correlationId);
}
