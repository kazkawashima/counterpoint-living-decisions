import { describe, expect, expectTypeOf, it } from "vitest";

import {
  AcquireSharedFloorRequestSchema,
  AcquireSharedFloorResponseSchema,
  ApproveDisclosureRequestSchema,
  AwaitManagedRealtimeTranscriptRequestSchema,
  AwaitManagedRealtimeTranscriptResponseSchema,
  BeginManagedRealtimeTurnRequestSchema,
  BeginManagedRealtimeTurnResponseSchema,
  CaptureUtteranceRequestSchema,
  CaptureUtteranceResponseSchema,
  ClearMeetingByokRequestSchema,
  ClearMeetingByokResponseSchema,
  CommitDecisionRequestSchema,
  ConfigureMeetingByokRequestSchema,
  ConfigureMeetingByokResponseSchema,
  ConfirmInvalidationReviewResponseSchema,
  CreateManagedRealtimeCallRequestSchema,
  CreateManagedRealtimeCallResponseSchema,
  CreateMeetingRequestSchema,
  DecisionJsonExportQuerySchema,
  DecisionJsonExportResponseSchema,
  DownloadPrivateArtifactQuerySchema,
  DispositionConfirmedInferenceRequestSchema,
  FacilitatorDemoResetRequestSchema,
  FacilitatorDemoResetResponseSchema,
  FacilitatorInvalidationReviewRequestSchema,
  HealthRequestSchema,
  HealthResponseSchema,
  HeartbeatMeetingByokRequestSchema,
  HeartbeatMeetingByokResponseSchema,
  HTTP_API_V1_PREFIX,
  InjectDemoRegulatoryChangeRequestSchema,
  InvalidationEvaluationSchema,
  IssueDisplayTokenRequestSchema,
  IssueDisplayTokenResponseSchema,
  IssueRealtimeClientSecretRequestSchema,
  IssueRealtimeClientSecretResponseSchema,
  JudgeUsageSummaryResponseSchema,
  JoinMeetingByCodeRequestSchema,
  ListAssignedMeetingsRequestSchema,
  LoginRequestSchema,
  LoginResponseSchema,
  LogoutRequestSchema,
  ManagedCallIdSchema,
  MarkDecisionReadyRequestSchema,
  PreviewDisclosureRequestSchema,
  ProposeDisclosureRequestSchema,
  ReadinessRequestSchema,
  ReadinessResponseSchema,
  RealtimeAccessModeSchema,
  RealtimeAccessResponseSchema,
  RegulatoryChangeWebhookRequestSchema,
  RegulatoryChangeWebhookResponseSchema,
  RegisterPrivateUrlArtifactRequestSchema,
  RegisterPrivateTextSourceFixtureRequestSchema,
  RejectDecisionRequestSchema,
  RejectDecisionResponseSchema,
  RejectDisclosureRequestSchema,
  RejectInvalidationReviewResponseSchema,
  RecommitDecisionRevisionResponseSchema,
  ReleaseSharedFloorRequestSchema,
  ReleaseSharedFloorResponseSchema,
  ResolveDecisionReviewRequestSchema,
  ResolveDecisionReviewResponseSchema,
  RevokeDisplayTokenRequestSchema,
  RevokeDisplayTokenResponseSchema,
  ReviewInvalidationResponseSchema,
  RoleProjectionResponseSchema,
  RoleProjectionQuerySchema,
  SaveDecisionDraftRequestSchema,
  StartDecisionMonitoringRequestSchema,
  StartDecisionMonitoringResponseSchema,
  SharedDisplayProjectionResponseSchema,
  SupersedeDecisionRequestSchema,
  SupersedeDecisionResponseSchema,
  TerminateManagedRealtimeCallRequestSchema,
  TerminateManagedRealtimeCallResponseSchema,
  UploadPrivateArtifactFieldsSchema,
  UploadPrivateArtifactResponseSchema,
  type AcquireSharedFloorRequest,
  type AcquireSharedFloorResponse,
  type AwaitManagedRealtimeTranscriptRequest,
  type AwaitManagedRealtimeTranscriptResponse,
  type BeginManagedRealtimeTurnRequest,
  type BeginManagedRealtimeTurnResponse,
  type CaptureUtteranceRequest,
  type CaptureUtteranceResponse,
  type ClearMeetingByokRequest,
  type ClearMeetingByokResponse,
  type ConfigureMeetingByokRequest,
  type ConfigureMeetingByokResponse,
  type CreateManagedRealtimeCallRequest,
  type CreateManagedRealtimeCallResponse,
  type DecisionJsonExportResponse,
  type FacilitatorDemoResetRequest,
  type FacilitatorDemoResetResponse,
  type FacilitatorInvalidationReviewRequest,
  type FacilitatorInvalidationReviewResponse,
  type HeartbeatMeetingByokRequest,
  type HeartbeatMeetingByokResponse,
  type IssueDisplayTokenRequest,
  type IssueDisplayTokenResponse,
  type IssueRealtimeClientSecretRequest,
  type IssueRealtimeClientSecretResponse,
  type JudgeUsageSummaryResponse,
  type LoginRequest,
  type ManagedCallId,
  type RealtimeAccessMode,
  type RealtimeAccessResponse,
  type ResolveDecisionReviewRequest,
  type ResolveDecisionReviewResponse,
  type RevokeDisplayTokenRequest,
  type RevokeDisplayTokenResponse,
  type ReleaseSharedFloorRequest,
  type ReleaseSharedFloorResponse,
  type SharedDisplayProjectionResponse,
  type TerminateManagedRealtimeCallRequest,
  type TerminateManagedRealtimeCallResponse,
  type UploadPrivateArtifactFields,
  type UploadPrivateArtifactResponse,
} from "@counterpoint/protocol";

const meetingMutation = {
  meetingId: "meeting-1",
  expectedPosition: 4,
  idempotencyKey: "request-1",
  correlationId: "correlation-1",
};

const sourceRange = { start: 0, end: 12 };
const monitoringDecision = {
  decisionId: "decision-1",
  status: "MONITORING",
  activeRevision: 2,
  activeRevisionId: "decision-revision-2",
  snapshot: {
    title: "Conditional rollout",
    outcome: "Proceed only after the listed controls are complete.",
    status: "MONITORING",
    premiseIds: ["premise-1"],
    evidenceIds: ["evidence-1"],
    dissentIds: ["dissent-1"],
    actionIds: ["action-1"],
    monitorCondition: {
      description: "Watch regulatory changes.",
      registrationId: "monitor-registration-1",
    },
  },
  readiness: {
    outcome: true,
    premiseIds: true,
    evidenceIds: true,
    actionIds: true,
    monitorCondition: true,
  },
  updatedAt: "2026-07-19T12:00:00.000Z",
} as const;
const committedReviewDecision = {
  ...monitoringDecision,
  status: "COMMITTED",
  activeRevision: 3,
  activeRevisionId: "decision-revision-3",
  snapshot: {
    ...monitoringDecision.snapshot,
    status: "COMMITTED",
    title: "Recommitted conditional rollout",
    outcome: "Proceed after the revised control is complete.",
    monitorCondition: {
      description: "Watch the revised regulatory control.",
    },
  },
  updatedAt: "2026-07-19T12:03:00.000Z",
} as const;
const committedReviewRevision = {
  revisionId: "decision-revision-3",
  decisionId: "decision-1",
  version: 3,
  previousRevisionId: "decision-revision-2",
  snapshot: committedReviewDecision.snapshot,
  changeReason: "Address the confirmed regulatory change.",
  createdAt: "2026-07-19T12:03:00.000Z",
  createdBy: "participant-facilitator",
} as const;

const mutationExamples = [
  {
    schema: LoginRequestSchema,
    value: {
      userId: "user-1",
      password: "synthetic-password",
      correlationId: "correlation-1",
    },
  },
  {
    schema: LogoutRequestSchema,
    value: { correlationId: "correlation-1" },
  },
  {
    schema: JoinMeetingByCodeRequestSchema,
    value: {
      code: "FLAGSHIP",
      idempotencyKey: "join-1",
      correlationId: "correlation-1",
    },
  },
  {
    schema: CreateMeetingRequestSchema,
    value: {
      purpose: "Synthetic rollout decision",
      users: [
        { userId: "user-facilitator", role: "facilitator" },
        { userId: "user-safety", role: "participant" },
        { userId: "user-legal", role: "participant" },
      ],
      idempotencyKey: "create-1",
      correlationId: "correlation-1",
    },
  },
  {
    schema: RegisterPrivateTextSourceFixtureRequestSchema,
    value: {
      ...meetingMutation,
      title: "Synthetic legal note",
      text: "Synthetic private fixture text.",
    },
  },
  {
    schema: ProposeDisclosureRequestSchema,
    value: {
      ...meetingMutation,
      sourceArtifactId: "source-1",
      exactSnippet: "Synthetic sn",
      sourceRange,
    },
  },
  {
    schema: PreviewDisclosureRequestSchema,
    value: {
      ...meetingMutation,
      candidateId: "candidate-1",
      exactSnippet: "Synthetic sn",
      sourceRange,
    },
  },
  {
    schema: ApproveDisclosureRequestSchema,
    value: {
      ...meetingMutation,
      candidateId: "candidate-1",
      previewHash: "sha256:preview-1",
    },
  },
  {
    schema: RejectDisclosureRequestSchema,
    value: {
      ...meetingMutation,
      candidateId: "candidate-1",
      reason: "Not needed for the shared decision.",
    },
  },
  {
    schema: DispositionConfirmedInferenceRequestSchema,
    value: {
      ...meetingMutation,
      suggestionId: "suggestion-1",
      disposition: "confirmed",
    },
  },
  {
    schema: SaveDecisionDraftRequestSchema,
    value: {
      ...meetingMutation,
      title: "Conditional rollout",
      outcome: "Proceed only after the listed controls are complete.",
      premiseIds: ["premise-1"],
      evidenceIds: ["evidence-1"],
      dissentIds: ["dissent-1"],
      actionIds: ["action-1"],
      monitorCondition: { description: "Watch regulatory changes." },
      changeReason: "Initial deterministic draft.",
    },
  },
  {
    schema: MarkDecisionReadyRequestSchema,
    value: { ...meetingMutation, decisionId: "decision-1" },
  },
  {
    schema: CommitDecisionRequestSchema,
    value: { ...meetingMutation, decisionId: "decision-1" },
  },
  {
    schema: StartDecisionMonitoringRequestSchema,
    value: { ...meetingMutation, decisionId: "decision-1" },
  },
  {
    schema: FacilitatorInvalidationReviewRequestSchema,
    value: {
      ...meetingMutation,
      decisionId: "decision-1",
      suggestionId: "suggestion-1",
      disposition: "confirm_invalidation",
      reason: "The synthetic regulatory evidence is material.",
    },
  },
  {
    schema: ResolveDecisionReviewRequestSchema,
    value: {
      ...meetingMutation,
      decisionId: "decision-1",
      resolution: "recommit_revision",
      changeReason: "Address the confirmed regulatory change.",
      title: "Recommitted conditional rollout",
      outcome: "Proceed after the revised control is complete.",
      monitorCondition: {
        description: "Watch the revised regulatory control.",
      },
    },
  },
  {
    schema: ResolveDecisionReviewRequestSchema,
    value: {
      ...meetingMutation,
      decisionId: "decision-1",
      resolution: "supersede_decision",
      replacementDecisionId: "decision-2",
    },
  },
  {
    schema: ResolveDecisionReviewRequestSchema,
    value: {
      ...meetingMutation,
      decisionId: "decision-1",
      resolution: "reject_decision",
      reason: "The reviewed Decision is no longer viable.",
    },
  },
  {
    schema: FacilitatorDemoResetRequestSchema,
    value: meetingMutation,
  },
] as const;

describe("strict v1 HTTP protocol", () => {
  it("publishes one explicit API version prefix", () => {
    expect(HTTP_API_V1_PREFIX).toBe("/api/v1");
  });

  it("parses strict request and response DTOs without widening their types", () => {
    const request = LoginRequestSchema.parse({
      userId: "user-1",
      password: "synthetic-password",
    });
    expectTypeOf(request).toEqualTypeOf<LoginRequest>();

    expect(
      LoginRequestSchema.safeParse({
        userId: "user-1",
        password: "synthetic-password",
        unknown: true,
      }).success,
    ).toBe(false);
    expect(
      LoginResponseSchema.safeParse({
        bearerToken: "session-token",
        userId: "user-1",
        expiresAt: "2026-07-19T12:00:00.000Z",
        correlationId: "correlation-1",
        internalSessionId: "must-not-leak",
      }).success,
    ).toBe(false);
  });

  it("rejects client-supplied actor and capability authority on every mutation", () => {
    const forbiddenAuthorityFields = {
      actor: { kind: "participant", participantId: "participant-1" },
      actorId: "actor-1",
      capability: "decision:commit",
      participantId: "participant-1",
      ownerParticipantId: "participant-1",
      capabilities: ["decision:commit"],
    };

    for (const { schema, value } of mutationExamples) {
      expect(schema.safeParse(value).success).toBe(true);
      for (const [field, authority] of Object.entries(
        forbiddenAuthorityFields,
      )) {
        expect(
          schema.safeParse({
            ...value,
            [field]: authority,
          }).success,
        ).toBe(false);
      }
    }

    expect(
      RoleProjectionQuerySchema.safeParse({
        meetingId: "meeting-1",
        participantId: "participant-other",
      }).success,
    ).toBe(false);
    expect(
      RoleProjectionQuerySchema.safeParse({
        meetingId: "meeting-1",
        role: "facilitator",
      }).success,
    ).toBe(false);

    expect(
      StartDecisionMonitoringRequestSchema.safeParse({
        ...meetingMutation,
        decisionId: "decision-1",
        registrationId: "client-chosen-registration",
      }).success,
    ).toBe(false);
  });

  it("returns the server-derived monitor registration in a strict response", () => {
    const response = {
      meetingId: "meeting-1",
      position: 5,
      correlationId: "correlation-1",
      decision: monitoringDecision,
      monitorRegistrationId: "monitor-registration-1",
    };

    expect(
      StartDecisionMonitoringResponseSchema.safeParse(response).success,
    ).toBe(true);
    expect(
      StartDecisionMonitoringResponseSchema.safeParse({
        ...response,
        revision: { version: 3 },
      }).success,
    ).toBe(false);
  });

  it("keeps signed regulatory payloads strict and server-derived receipts explicit", () => {
    const request = {
      description: "A synthetic regulation changes the approval gate.",
      effectiveAt: "2026-08-01T00:00:00.000Z",
      eventId: "regulator:event-1",
      eventType: "regulatory_change",
      jurisdiction: "European Union",
      meetingId: "meeting-1",
      monitorRegistrationId: "monitor-registration-1",
      schemaVersion: 1,
      source: "Synthetic regulator feed",
      sourceReference: "https://example.invalid/regulation/1",
    };
    expect(
      RegulatoryChangeWebhookRequestSchema.safeParse(request).success,
    ).toBe(true);
    expect(
      RegulatoryChangeWebhookRequestSchema.safeParse({
        ...request,
        actor: { kind: "system" },
      }).success,
    ).toBe(false);
    expect(
      RegulatoryChangeWebhookRequestSchema.safeParse({
        ...request,
        schemaVersion: 2,
      }).success,
    ).toBe(false);

    const receipt = {
      correlationId: "correlation-1",
      evaluationStatus: "pending",
      event: {
        ...request,
        payloadHash: "sha256:c3ludGhldGlj",
        receivedAt: "2026-07-19T12:00:00.000Z",
      },
      position: 12,
      receiptStatus: "received",
      replayed: false,
    };
    expect(
      RegulatoryChangeWebhookResponseSchema.safeParse(receipt).success,
    ).toBe(true);
    expect(
      RegulatoryChangeWebhookResponseSchema.safeParse({
        ...receipt,
        evaluationStatus: "complete",
      }).success,
    ).toBe(false);

    expect(
      InjectDemoRegulatoryChangeRequestSchema.safeParse({
        idempotencyKey: "demo-event-1",
      }).success,
    ).toBe(true);
    expect(
      InjectDemoRegulatoryChangeRequestSchema.safeParse({
        idempotencyKey: "demo-event-1",
        actor: { kind: "system" },
        description: request.description,
      }).success,
    ).toBe(false);
  });

  it("keeps facilitator demo reset meeting-scoped and explicitly completed", () => {
    const request = FacilitatorDemoResetRequestSchema.parse(meetingMutation);
    expectTypeOf(request).toEqualTypeOf<FacilitatorDemoResetRequest>();

    expect(
      FacilitatorDemoResetRequestSchema.safeParse({
        ...meetingMutation,
        seedName: "flagship",
      }).success,
    ).toBe(false);

    const response = {
      meetingId: "meeting-1",
      position: 6,
      correlationId: "correlation-1",
      resetRequestId: "reset-request-1",
      resetStatus: "completed",
    } as const;
    const parsed = FacilitatorDemoResetResponseSchema.parse(response);
    expectTypeOf(parsed).toEqualTypeOf<FacilitatorDemoResetResponse>();

    expect(
      FacilitatorDemoResetResponseSchema.safeParse({
        ...response,
        resetStatus: "requested",
      }).success,
    ).toBe(false);
    expect(
      FacilitatorDemoResetResponseSchema.safeParse({
        ...response,
        completedAt: "2026-07-19T12:00:00.000Z",
      }).success,
    ).toBe(false);
  });

  it("keeps invalidation evaluation separate from receipt and human review", () => {
    const response = {
      correlationId: "correlation-1",
      evaluation: {
        affectedActionIds: ["action-1"],
        affectedPremiseIds: ["premise-1"],
        confidence: 0.91,
        decision: {
          ...monitoringDecision,
          status: "AT_RISK",
          snapshot: { ...monitoringDecision.snapshot, status: "AT_RISK" },
        },
        evidenceReferenceIds: ["evidence-1"],
        externalEventId: "external-event-1",
        generatedAt: "2026-07-19T12:01:00.000Z",
        inputReferenceIds: [
          "external-event-1",
          "decision-revision-2",
          "premise-1",
          "action-1",
          "evidence-1",
        ],
        model: "gpt-5.6",
        operation: "assumption_invalidation",
        outputSchemaVersion: "1",
        promptVersion: "assumption-invalidation-v1",
        reason:
          "The synthetic regulatory event may invalidate the confirmed gate.",
        suggestionId: "suggestion-1",
      },
      meetingId: "meeting-1",
      position: 13,
      replayed: false,
    };
    expect(
      InvalidationEvaluationSchema.safeParse(response.evaluation).success,
    ).toBe(true);
    expect(
      InvalidationEvaluationSchema.safeParse({
        ...response.evaluation,
        reviewConfirmed: true,
      }).success,
    ).toBe(false);
  });

  it("requires a bounded reason and strict mutation identity for invalidation review", () => {
    const request = {
      ...meetingMutation,
      decisionId: "decision-1",
      suggestionId: "suggestion-1",
      disposition: "confirm_invalidation",
      reason: "The synthetic regulatory evidence is material.",
    } as const;

    const parsed = FacilitatorInvalidationReviewRequestSchema.parse(request);
    expectTypeOf(parsed).toEqualTypeOf<FacilitatorInvalidationReviewRequest>();
    expect(
      FacilitatorInvalidationReviewRequestSchema.safeParse({
        ...request,
        disposition: "reject_suggestion",
      }).success,
    ).toBe(true);
    expect(
      FacilitatorInvalidationReviewRequestSchema.safeParse({
        ...request,
        reason: "   ",
      }).success,
    ).toBe(false);
    expect(
      FacilitatorInvalidationReviewRequestSchema.safeParse({
        ...request,
        reason: "x".repeat(4097),
      }).success,
    ).toBe(false);
    expect(
      FacilitatorInvalidationReviewRequestSchema.safeParse({
        ...request,
        expectedPosition: undefined,
      }).success,
    ).toBe(false);
    expect(
      FacilitatorInvalidationReviewRequestSchema.safeParse({
        ...request,
        idempotencyKey: undefined,
      }).success,
    ).toBe(false);
    expect(
      FacilitatorInvalidationReviewRequestSchema.safeParse({
        ...request,
        reviewConfirmed: true,
      }).success,
    ).toBe(false);
  });

  it("discriminates confirmed invalidation review from rejected suggestions", () => {
    const reviewReceipt = {
      meetingId: "meeting-1",
      position: 17,
      correlationId: "correlation-1",
      suggestionId: "suggestion-1",
      reviewReason: "The synthetic regulatory evidence is material.",
      reviewEventId: "event-facilitator-reviewed-1",
      reviewAuditId: "audit-event-facilitator-reviewed-1",
    } as const;
    const reviewRequiredDecision = {
      ...monitoringDecision,
      status: "REVIEW_REQUIRED",
      snapshot: {
        ...monitoringDecision.snapshot,
        status: "REVIEW_REQUIRED",
      },
      updatedAt: "2026-07-19T12:02:00.000Z",
    } as const;
    const reconsiderationTask = {
      reconsiderationTaskId: "task-review-1",
      decisionId: "decision-1",
      triggerExternalEventId: "external-event-1",
      ownerParticipantId: "participant-facilitator",
      affectedPremiseIds: ["premise-1"],
      affectedActionIds: ["action-1"],
      state: "open",
      createdAt: "2026-07-19T12:02:00.000Z",
    } as const;
    const confirmed = {
      ...reviewReceipt,
      disposition: "confirm_invalidation",
      decision: reviewRequiredDecision,
      heldActionIds: ["action-1"],
      reconsiderationTask,
    } as const;
    const rejected = {
      ...reviewReceipt,
      disposition: "reject_suggestion",
      decision: monitoringDecision,
    } as const;

    const parsedConfirmed = ReviewInvalidationResponseSchema.parse(confirmed);
    const parsedRejected = ReviewInvalidationResponseSchema.parse(rejected);
    expectTypeOf(
      parsedConfirmed,
    ).toMatchTypeOf<FacilitatorInvalidationReviewResponse>();
    expectTypeOf(
      parsedRejected,
    ).toMatchTypeOf<FacilitatorInvalidationReviewResponse>();
    expect(
      ConfirmInvalidationReviewResponseSchema.safeParse(confirmed).success,
    ).toBe(true);
    expect(
      RejectInvalidationReviewResponseSchema.safeParse(rejected).success,
    ).toBe(true);
    expect(
      ReviewInvalidationResponseSchema.safeParse({
        ...confirmed,
        heldActionIds: [],
      }).success,
    ).toBe(false);
    expect(
      ReviewInvalidationResponseSchema.safeParse({
        ...confirmed,
        reconsiderationTask: undefined,
      }).success,
    ).toBe(false);
    expect(
      ReviewInvalidationResponseSchema.safeParse({
        ...rejected,
        heldActionIds: ["action-1"],
      }).success,
    ).toBe(false);
    expect(
      ReviewInvalidationResponseSchema.safeParse({
        ...rejected,
        reconsiderationTask,
      }).success,
    ).toBe(false);
    expect(
      ReviewInvalidationResponseSchema.safeParse({
        ...confirmed,
        decision: monitoringDecision,
      }).success,
    ).toBe(false);
    expect(
      ReviewInvalidationResponseSchema.safeParse({
        ...rejected,
        decision: reviewRequiredDecision,
      }).success,
    ).toBe(false);
  });

  it("strictly discriminates all Decision review resolution requests", () => {
    const recommit = mutationExamples[15].value;
    const supersede = mutationExamples[16].value;
    const reject = mutationExamples[17].value;

    const parsed = ResolveDecisionReviewRequestSchema.parse(recommit);
    expectTypeOf(parsed).toEqualTypeOf<ResolveDecisionReviewRequest>();
    expect(SupersedeDecisionRequestSchema.safeParse(supersede).success).toBe(
      true,
    );
    expect(RejectDecisionRequestSchema.safeParse(reject).success).toBe(true);

    expect(
      ResolveDecisionReviewRequestSchema.safeParse({
        ...recommit,
        changeReason: " ",
      }).success,
    ).toBe(false);
    expect(
      ResolveDecisionReviewRequestSchema.safeParse({
        ...recommit,
        monitorCondition: {
          description: "Watch the revised regulatory control.",
          registrationId: "client-chosen-registration",
        },
      }).success,
    ).toBe(false);
    expect(
      ResolveDecisionReviewRequestSchema.safeParse({
        ...supersede,
        replacementDecisionId: supersede.decisionId,
      }).success,
    ).toBe(false);
    expect(
      ResolveDecisionReviewRequestSchema.safeParse({
        ...reject,
        reason: " ",
      }).success,
    ).toBe(false);
    expect(
      ResolveDecisionReviewRequestSchema.safeParse({
        ...reject,
        reason: undefined,
      }).success,
    ).toBe(false);
    expect(
      ResolveDecisionReviewRequestSchema.safeParse({
        ...supersede,
        reason: "Fields from another resolution must not be accepted.",
      }).success,
    ).toBe(false);
  });

  it("enforces the status-specific Decision review resolution responses", () => {
    const receipt = {
      meetingId: "meeting-1",
      position: 18,
      correlationId: "correlation-1",
    } as const;
    const recommitted = {
      ...receipt,
      resolution: "recommit_revision",
      decision: committedReviewDecision,
      revision: committedReviewRevision,
    } as const;
    const superseded = {
      ...receipt,
      resolution: "supersede_decision",
      decision: {
        ...monitoringDecision,
        status: "SUPERSEDED",
        snapshot: {
          ...monitoringDecision.snapshot,
          status: "SUPERSEDED",
        },
      },
      replacementDecisionId: "decision-2",
    } as const;
    const rejected = {
      ...receipt,
      resolution: "reject_decision",
      decision: {
        ...monitoringDecision,
        status: "REJECTED",
        snapshot: {
          ...monitoringDecision.snapshot,
          status: "REJECTED",
        },
      },
      reason: "The reviewed Decision is no longer viable.",
    } as const;

    const parsed = ResolveDecisionReviewResponseSchema.parse(recommitted);
    expectTypeOf(parsed).toEqualTypeOf<ResolveDecisionReviewResponse>();
    expect(
      RecommitDecisionRevisionResponseSchema.safeParse(recommitted).success,
    ).toBe(true);
    expect(SupersedeDecisionResponseSchema.safeParse(superseded).success).toBe(
      true,
    );
    expect(RejectDecisionResponseSchema.safeParse(rejected).success).toBe(true);

    expect(
      ResolveDecisionReviewResponseSchema.safeParse({
        ...recommitted,
        decision: monitoringDecision,
      }).success,
    ).toBe(false);
    expect(
      ResolveDecisionReviewResponseSchema.safeParse({
        ...recommitted,
        revision: {
          ...committedReviewRevision,
          previousRevisionId: undefined,
        },
      }).success,
    ).toBe(false);
    expect(
      ResolveDecisionReviewResponseSchema.safeParse({
        ...recommitted,
        revision: {
          ...committedReviewRevision,
          revisionId: "decision-revision-other",
        },
      }).success,
    ).toBe(false);
    expect(
      ResolveDecisionReviewResponseSchema.safeParse({
        ...superseded,
        replacementDecisionId: "decision-1",
      }).success,
    ).toBe(false);
    expect(
      ResolveDecisionReviewResponseSchema.safeParse({
        ...superseded,
        decision: monitoringDecision,
      }).success,
    ).toBe(false);
    expect(
      ResolveDecisionReviewResponseSchema.safeParse({
        ...rejected,
        reason: undefined,
      }).success,
    ).toBe(false);
    expect(
      ResolveDecisionReviewResponseSchema.safeParse({
        ...rejected,
        replacementDecisionId: "decision-2",
      }).success,
    ).toBe(false);
  });

  it("keeps authorized Decision JSON exports complete, strict, and meeting-scoped", () => {
    const query = {
      meetingId: "meeting-1",
      decisionId: "decision-1",
      correlationId: "correlation-1",
    };
    expect(DecisionJsonExportQuerySchema.safeParse(query).success).toBe(true);
    expect(
      DecisionJsonExportQuerySchema.safeParse({
        ...query,
        participantId: "participant-other",
      }).success,
    ).toBe(false);

    const exportResponse = {
      meetingId: "meeting-1",
      decision: committedReviewDecision,
      revisions: [
        {
          ...committedReviewRevision,
          revisionId: "decision-revision-2",
          version: 2,
          previousRevisionId: "decision-revision-1",
          snapshot: monitoringDecision.snapshot,
          changeReason: "Start monitoring the committed Decision.",
          createdAt: "2026-07-19T12:00:00.000Z",
        },
        committedReviewRevision,
      ],
      auditEntries: [
        {
          auditId: "audit-decision-revision-3",
          eventId: "event-decision-revision-3",
          eventType: "DecisionRevisionCommitted",
          meetingId: "meeting-1",
          position: 18,
          actor: {
            kind: "participant",
            participantId: "participant-facilitator",
          },
          occurredAt: "2026-07-19T12:03:00.000Z",
          correlationId: "correlation-1",
        },
      ],
      exportedAt: "2026-07-19T12:04:00.000Z",
      correlationId: "correlation-1",
    } as const;

    const parsed = DecisionJsonExportResponseSchema.parse(exportResponse);
    expectTypeOf(parsed).toEqualTypeOf<DecisionJsonExportResponse>();
    expect(
      DecisionJsonExportResponseSchema.safeParse({
        ...exportResponse,
        privateWorkspace: {},
      }).success,
    ).toBe(false);
    expect(
      DecisionJsonExportResponseSchema.safeParse({
        ...exportResponse,
        revisions: [exportResponse.revisions[0]],
      }).success,
    ).toBe(false);
    expect(
      DecisionJsonExportResponseSchema.safeParse({
        ...exportResponse,
        revisions: [
          exportResponse.revisions[0],
          {
            ...committedReviewRevision,
            decisionId: "decision-other",
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      DecisionJsonExportResponseSchema.safeParse({
        ...exportResponse,
        auditEntries: [
          {
            ...exportResponse.auditEntries[0],
            meetingId: "meeting-other",
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      DecisionJsonExportResponseSchema.safeParse({
        ...exportResponse,
        exportedAt: undefined,
      }).success,
    ).toBe(false);
  });

  it("enforces the fixed 3–8 user meeting boundary", () => {
    const user = (index: number) => ({
      userId: `user-${String(index)}`,
      role: index === 0 ? ("facilitator" as const) : ("participant" as const),
    });
    const request = (count: number) => ({
      purpose: "Synthetic meeting",
      users: Array.from({ length: count }, (_, index) => user(index)),
      idempotencyKey: "create-1",
    });

    expect(CreateMeetingRequestSchema.safeParse(request(2)).success).toBe(
      false,
    );
    expect(CreateMeetingRequestSchema.safeParse(request(3)).success).toBe(true);
    expect(CreateMeetingRequestSchema.safeParse(request(8)).success).toBe(true);
    expect(CreateMeetingRequestSchema.safeParse(request(9)).success).toBe(
      false,
    );
    expect(
      CreateMeetingRequestSchema.safeParse({
        ...request(3),
        users: [user(0), { userId: "user-1", role: "facilitator" }, user(2)],
      }).success,
    ).toBe(false);
  });

  it("requires retry identity, optimistic position, and the approved preview hash", () => {
    const approval = {
      ...meetingMutation,
      candidateId: "candidate-1",
      previewHash: "sha256:preview-1",
    };

    expect(ApproveDisclosureRequestSchema.safeParse(approval).success).toBe(
      true,
    );
    expect(
      ApproveDisclosureRequestSchema.safeParse({
        ...approval,
        previewHash: undefined,
      }).success,
    ).toBe(false);
    expect(
      ApproveDisclosureRequestSchema.safeParse({
        ...approval,
        idempotencyKey: undefined,
      }).success,
    ).toBe(false);
    expect(
      ApproveDisclosureRequestSchema.safeParse({
        ...approval,
        expectedPosition: undefined,
      }).success,
    ).toBe(false);
    expect(
      PreviewDisclosureRequestSchema.safeParse({
        ...mutationExamples[6].value,
        idempotencyKey: undefined,
      }).success,
    ).toBe(false);
  });

  it("keeps health and readiness secret-free and strict", () => {
    expect(HealthRequestSchema.safeParse({}).success).toBe(true);
    expect(HealthRequestSchema.safeParse({ verbose: true }).success).toBe(
      false,
    );
    expect(ReadinessRequestSchema.safeParse({}).success).toBe(true);

    expect(
      HealthResponseSchema.safeParse({
        status: "ok",
        checkedAt: "2026-07-19T12:00:00.000Z",
        protocolVersion: 1,
      }).success,
    ).toBe(true);
    expect(
      ReadinessResponseSchema.safeParse({
        status: "ready",
        checkedAt: "2026-07-19T12:00:00.000Z",
        protocolVersion: 1,
        migrationsCurrent: true,
        dependencies: [
          { name: "database", status: "available" },
          { name: "openai", status: "not_configured" },
        ],
      }).success,
    ).toBe(true);
    expect(
      ReadinessResponseSchema.safeParse({
        status: "ready",
        checkedAt: "2026-07-19T12:00:00.000Z",
        protocolVersion: 1,
        migrationsCurrent: true,
        dependencies: [],
        apiKey: "must-not-appear",
      }).success,
    ).toBe(false);
  });

  it("keeps read DTOs strict as well", () => {
    expect(ListAssignedMeetingsRequestSchema.safeParse({}).success).toBe(true);
    expect(
      ListAssignedMeetingsRequestSchema.safeParse({ userId: "user-other" })
        .success,
    ).toBe(false);
  });

  it("configures, heartbeats, and clears meeting-scoped BYOK without echoing the key", () => {
    const configureRequest = {
      meetingId: "meeting-1",
      apiKey: "sk-synthetic-at-least-twenty-characters",
      correlationId: "correlation-1",
    } as const;
    const parsedConfigureRequest =
      ConfigureMeetingByokRequestSchema.parse(configureRequest);
    expectTypeOf(
      parsedConfigureRequest,
    ).toEqualTypeOf<ConfigureMeetingByokRequest>();
    expect(
      ConfigureMeetingByokRequestSchema.safeParse({
        ...configureRequest,
        participantId: "participant-1",
      }).success,
    ).toBe(false);
    expect(
      ConfigureMeetingByokRequestSchema.safeParse({
        ...configureRequest,
        apiKey: "fewer-than-twenty",
      }).success,
    ).toBe(false);
    expect(
      ConfigureMeetingByokRequestSchema.safeParse({
        ...configureRequest,
        apiKey: "x".repeat(4097),
      }).success,
    ).toBe(false);

    const configureResponse = {
      meetingId: "meeting-1",
      configured: true,
      keySource: "byok",
      correlationId: "correlation-1",
    } as const;
    const parsedConfigureResponse =
      ConfigureMeetingByokResponseSchema.parse(configureResponse);
    expectTypeOf(
      parsedConfigureResponse,
    ).toEqualTypeOf<ConfigureMeetingByokResponse>();
    expect(
      ConfigureMeetingByokResponseSchema.safeParse({
        ...configureResponse,
        apiKey: configureRequest.apiKey,
      }).success,
    ).toBe(false);

    const heartbeatRequest = {
      meetingId: "meeting-1",
      correlationId: "correlation-2",
    } as const;
    const parsedHeartbeatRequest =
      HeartbeatMeetingByokRequestSchema.parse(heartbeatRequest);
    expectTypeOf(
      parsedHeartbeatRequest,
    ).toEqualTypeOf<HeartbeatMeetingByokRequest>();
    expect(
      HeartbeatMeetingByokRequestSchema.safeParse({
        ...heartbeatRequest,
        apiKey: configureRequest.apiKey,
      }).success,
    ).toBe(false);

    const heartbeatResponse = {
      meetingId: "meeting-1",
      active: true,
      correlationId: "correlation-2",
    } as const;
    const parsedHeartbeatResponse =
      HeartbeatMeetingByokResponseSchema.parse(heartbeatResponse);
    expectTypeOf(
      parsedHeartbeatResponse,
    ).toEqualTypeOf<HeartbeatMeetingByokResponse>();
    expect(
      HeartbeatMeetingByokResponseSchema.safeParse({
        ...heartbeatResponse,
        expiresAt: "2026-07-19T12:05:00.000Z",
      }).success,
    ).toBe(false);

    const clearRequest = {
      meetingId: "meeting-1",
      correlationId: "correlation-3",
    } as const;
    const parsedClearRequest =
      ClearMeetingByokRequestSchema.parse(clearRequest);
    expectTypeOf(parsedClearRequest).toEqualTypeOf<ClearMeetingByokRequest>();
    expect(
      ClearMeetingByokRequestSchema.safeParse({
        ...clearRequest,
        keySource: "byok",
      }).success,
    ).toBe(false);

    const clearResponse = {
      meetingId: "meeting-1",
      cleared: true,
      correlationId: "correlation-3",
    } as const;
    const parsedClearResponse =
      ClearMeetingByokResponseSchema.parse(clearResponse);
    expectTypeOf(parsedClearResponse).toEqualTypeOf<ClearMeetingByokResponse>();
    expect(
      ClearMeetingByokResponseSchema.safeParse({
        ...clearResponse,
        apiKey: configureRequest.apiKey,
      }).success,
    ).toBe(false);
  });

  it("issues only channel-scoped short-lived realtime client secrets", () => {
    const request = {
      meetingId: "meeting-1",
      channel: "private",
      correlationId: "correlation-1",
    } as const;
    const parsedRequest = IssueRealtimeClientSecretRequestSchema.parse(request);
    expectTypeOf(
      parsedRequest,
    ).toEqualTypeOf<IssueRealtimeClientSecretRequest>();
    expect(
      IssueRealtimeClientSecretRequestSchema.safeParse({
        ...request,
        channel: "participant-private",
      }).success,
    ).toBe(false);
    expect(
      IssueRealtimeClientSecretRequestSchema.safeParse({
        ...request,
        participantId: "participant-1",
      }).success,
    ).toBe(false);
    expect(
      IssueRealtimeClientSecretRequestSchema.safeParse({
        ...request,
        judgeMode: true,
      }).success,
    ).toBe(false);
    expect(
      IssueRealtimeClientSecretRequestSchema.safeParse({
        ...request,
        keySource: "judgeManaged",
      }).success,
    ).toBe(false);

    const response = {
      meetingId: "meeting-1",
      channel: "private",
      clientSecret: "ek_synthetic-short-lived-client-secret",
      expiresAt: "2026-07-19T12:01:00.000Z",
      keySource: "facilitatorProvided",
      model: "gpt-realtime-2.1",
      correlationId: "correlation-1",
    } as const;
    const parsedResponse =
      IssueRealtimeClientSecretResponseSchema.parse(response);
    expectTypeOf(
      parsedResponse,
    ).toEqualTypeOf<IssueRealtimeClientSecretResponse>();
    expect(
      IssueRealtimeClientSecretResponseSchema.safeParse({
        ...response,
        apiKey: "sk-standard-key-must-never-appear",
      }).success,
    ).toBe(false);
    expect(
      IssueRealtimeClientSecretResponseSchema.safeParse({
        ...response,
        expiresAt: "2026-07-19 12:01:00",
      }).success,
    ).toBe(false);
    expect(
      IssueRealtimeClientSecretResponseSchema.safeParse({
        ...response,
        keySource: "byok",
      }).success,
    ).toBe(false);
    expect(
      IssueRealtimeClientSecretResponseSchema.safeParse({
        ...response,
        privateWorkspace: {},
      }).success,
    ).toBe(false);
    expect(
      IssueRealtimeClientSecretResponseSchema.safeParse({
        ...response,
        channel: "shared",
      }).success,
    ).toBe(true);
  });

  it("exposes only the server-resolved realtime access mode", () => {
    const modes = RealtimeAccessModeSchema.options;
    expect(modes).toEqual([
      "facilitatorProvided",
      "judgeManaged",
      "unavailable",
    ]);
    expectTypeOf<RealtimeAccessMode>().toEqualTypeOf<(typeof modes)[number]>();

    const response = {
      correlationId: "correlation-1",
      mode: "judgeManaged",
      usageSummary: "available",
    } as const;
    const parsed = RealtimeAccessResponseSchema.parse(response);
    expectTypeOf(parsed).toEqualTypeOf<RealtimeAccessResponse>();
    for (const forbiddenField of [
      "apiKey",
      "accountId",
      "capability",
      "ipAddress",
      "judgeManagedAvailable",
      "keySource",
      "lease",
      "meetingId",
      "participantId",
      "reservationId",
      "sessionId",
      "unknownField",
      "userId",
    ]) {
      expect(
        RealtimeAccessResponseSchema.safeParse({
          ...response,
          [forbiddenField]: "synthetic-private-value",
        }).success,
      ).toBe(false);
    }
    expect(
      RealtimeAccessResponseSchema.safeParse({
        ...response,
        mode: "byok",
      }).success,
    ).toBe(false);
    expect(
      RealtimeAccessResponseSchema.safeParse({
        ...response,
        usageSummary: "enabled",
      }).success,
    ).toBe(false);
  });

  it("exposes only an app-owned opaque handle for managed realtime calls", () => {
    const request = {
      channel: "shared",
      correlationId: "correlation-1",
      idempotencyKey: "managed-call-start-1",
      meetingId: "meeting-1",
      sdpOffer: "v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\n",
    } as const;
    const parsedRequest = CreateManagedRealtimeCallRequestSchema.parse(request);
    expectTypeOf(
      parsedRequest,
    ).toEqualTypeOf<CreateManagedRealtimeCallRequest>();
    expect(
      CreateManagedRealtimeCallRequestSchema.safeParse({
        ...request,
        idempotencyKey: undefined,
      }).success,
    ).toBe(false);
    expect(
      CreateManagedRealtimeCallRequestSchema.safeParse({
        ...request,
        callId: "rtc_private-provider-id",
      }).success,
    ).toBe(false);
    expect(
      CreateManagedRealtimeCallRequestSchema.safeParse({
        ...request,
        sdpOffer: "",
      }).success,
    ).toBe(false);
    expect(
      CreateManagedRealtimeCallRequestSchema.safeParse({
        ...request,
        sdpOffer: "x".repeat(64 * 1024 + 1),
      }).success,
    ).toBe(false);

    const response = {
      channel: "shared",
      correlationId: "correlation-1",
      managedCallId: "managed-call-1",
      meetingId: "meeting-1",
      model: "gpt-realtime-2.1",
      sdpAnswer: "v=0\r\no=- 2 2 IN IP4 0.0.0.0\r\n",
    } as const;
    const parsedResponse =
      CreateManagedRealtimeCallResponseSchema.parse(response);
    expectTypeOf(
      parsedResponse,
    ).toEqualTypeOf<CreateManagedRealtimeCallResponse>();
    expect(
      CreateManagedRealtimeCallResponseSchema.safeParse({
        ...response,
        providerCallId: "rtc_private-provider-id",
      }).success,
    ).toBe(false);
    expect(
      CreateManagedRealtimeCallResponseSchema.safeParse({
        ...response,
        clientSecret: "ek_provider-secret",
      }).success,
    ).toBe(false);
    expect(
      CreateManagedRealtimeCallResponseSchema.safeParse({
        ...response,
        apiKey: "sk-standard-key-must-never-appear",
      }).success,
    ).toBe(false);

    const parsedManagedCallId = ManagedCallIdSchema.parse(
      response.managedCallId,
    );
    expectTypeOf(parsedManagedCallId).toEqualTypeOf<ManagedCallId>();
    expect(ManagedCallIdSchema.safeParse("").success).toBe(false);
    expect(ManagedCallIdSchema.safeParse("managed call 1").success).toBe(false);
    expect(ManagedCallIdSchema.safeParse("x".repeat(257)).success).toBe(false);
  });

  it("exposes only content-free judge usage dimensions", () => {
    const response = {
      correlationId: "correlation-judge-usage",
      dimensions: {
        account: { limit: 10, remaining: 9, used: 1 },
        concurrency: { limit: 1, remaining: 0, used: 1 },
        costMicroUsd: { limit: 25_000_000, remaining: 0, used: 25_000_000 },
        generation: { limit: 3, remaining: 0, used: 3 },
        ip: { limit: 10, remaining: 9, used: 1 },
        meeting: { limit: 10, remaining: 9, used: 1 },
        realtimeSeconds: { limit: 30, remaining: 0, used: 30 },
        tokens: { limit: 1_200_000, remaining: 0, used: 1_200_000 },
      },
      rollingWindowSeconds: 86_400,
    } as const;
    const parsed = JudgeUsageSummaryResponseSchema.parse(response);
    expectTypeOf(parsed).toEqualTypeOf<JudgeUsageSummaryResponse>();
    expect(
      JudgeUsageSummaryResponseSchema.safeParse({
        ...response,
        accountId: "private-account",
      }).success,
    ).toBe(false);
    expect(
      JudgeUsageSummaryResponseSchema.safeParse({
        ...response,
        ipHash: `hmac-sha256:${"a".repeat(64)}`,
      }).success,
    ).toBe(false);
    expect(
      JudgeUsageSummaryResponseSchema.safeParse({
        ...response,
        reservationId: "private-reservation",
      }).success,
    ).toBe(false);
  });

  it("binds one opaque utterance to each managed realtime speech turn", () => {
    const request = {
      meetingId: "meeting-1",
      managedCallId: "managed-call-1",
      utteranceId: "utterance-1",
      correlationId: "correlation-1",
    } as const;
    const parsedRequest = BeginManagedRealtimeTurnRequestSchema.parse(request);
    expectTypeOf(
      parsedRequest,
    ).toEqualTypeOf<BeginManagedRealtimeTurnRequest>();

    for (const privateProviderField of [
      { providerCallId: "rtc_private-provider-id" },
      { callId: "rtc_private-provider-id" },
      { apiKey: "sk-standard-key-must-never-appear" },
      { providerMetadata: { itemId: "provider-item-1" } },
    ]) {
      expect(
        BeginManagedRealtimeTurnRequestSchema.safeParse({
          ...request,
          ...privateProviderField,
        }).success,
      ).toBe(false);
    }
    expect(
      BeginManagedRealtimeTurnRequestSchema.safeParse({
        ...request,
        utteranceId: "",
      }).success,
    ).toBe(false);
    expect(
      BeginManagedRealtimeTurnRequestSchema.safeParse({
        ...request,
        utteranceId: "x".repeat(257),
      }).success,
    ).toBe(false);

    const response = {
      meetingId: "meeting-1",
      managedCallId: "managed-call-1",
      utteranceId: "utterance-1",
      correlationId: "correlation-1",
    } as const;
    const parsedResponse =
      BeginManagedRealtimeTurnResponseSchema.parse(response);
    expectTypeOf(
      parsedResponse,
    ).toEqualTypeOf<BeginManagedRealtimeTurnResponse>();
    expect(
      BeginManagedRealtimeTurnResponseSchema.safeParse({
        ...response,
        participantId: "participant-1",
      }).success,
    ).toBe(false);
  });

  it("returns only the bounded transcript for the owned managed turn", () => {
    const request = {
      meetingId: "meeting-1",
      managedCallId: "managed-call-1",
      utteranceId: "utterance-1",
      correlationId: "correlation-2",
    } as const;
    const parsedRequest =
      AwaitManagedRealtimeTranscriptRequestSchema.parse(request);
    expectTypeOf(
      parsedRequest,
    ).toEqualTypeOf<AwaitManagedRealtimeTranscriptRequest>();
    expect(
      AwaitManagedRealtimeTranscriptRequestSchema.safeParse({
        ...request,
        providerResponseId: "provider-response-1",
      }).success,
    ).toBe(false);

    const response = {
      ...request,
      transcript: "Synthetic managed transcript.",
    } as const;
    const parsedResponse =
      AwaitManagedRealtimeTranscriptResponseSchema.parse(response);
    expectTypeOf(
      parsedResponse,
    ).toEqualTypeOf<AwaitManagedRealtimeTranscriptResponse>();
    expect(
      AwaitManagedRealtimeTranscriptResponseSchema.safeParse({
        ...response,
        transcript: "",
      }).success,
    ).toBe(false);
    expect(
      AwaitManagedRealtimeTranscriptResponseSchema.safeParse({
        ...response,
        transcript: "x".repeat(4001),
      }).success,
    ).toBe(false);
    expect(
      AwaitManagedRealtimeTranscriptResponseSchema.safeParse({
        ...response,
        providerMetadata: {
          callId: "rtc_private-provider-id",
          itemId: "provider-item-1",
        },
      }).success,
    ).toBe(false);
  });

  it("terminates managed calls by app-owned handle without provider metadata", () => {
    const request = {
      meetingId: "meeting-1",
      managedCallId: "managed-call-1",
      correlationId: "correlation-3",
    } as const;
    const parsedRequest =
      TerminateManagedRealtimeCallRequestSchema.parse(request);
    expectTypeOf(
      parsedRequest,
    ).toEqualTypeOf<TerminateManagedRealtimeCallRequest>();
    expect(
      TerminateManagedRealtimeCallRequestSchema.safeParse({
        ...request,
        providerCallId: "rtc_private-provider-id",
      }).success,
    ).toBe(false);

    const response = {
      ...request,
      terminated: true,
    } as const;
    const parsedResponse =
      TerminateManagedRealtimeCallResponseSchema.parse(response);
    expectTypeOf(
      parsedResponse,
    ).toEqualTypeOf<TerminateManagedRealtimeCallResponse>();
    expect(
      TerminateManagedRealtimeCallResponseSchema.safeParse({
        ...response,
        apiKey: "sk-standard-key-must-never-appear",
      }).success,
    ).toBe(false);
    expect(
      TerminateManagedRealtimeCallResponseSchema.safeParse({
        ...response,
        terminated: false,
      }).success,
    ).toBe(false);
  });

  it("acquires and releases the shared floor with server-derived ownership", () => {
    const acquireRequest = {
      meetingId: "meeting-1",
      utteranceId: "utterance-1",
      correlationId: "correlation-1",
    } as const;
    const parsedAcquireRequest =
      AcquireSharedFloorRequestSchema.parse(acquireRequest);
    expectTypeOf(
      parsedAcquireRequest,
    ).toEqualTypeOf<AcquireSharedFloorRequest>();
    expect(
      AcquireSharedFloorRequestSchema.safeParse({
        ...acquireRequest,
        participantId: "participant-1",
      }).success,
    ).toBe(false);
    expect(
      AcquireSharedFloorRequestSchema.safeParse({
        ...acquireRequest,
        ownerParticipantId: "participant-1",
      }).success,
    ).toBe(false);
    expect(
      AcquireSharedFloorRequestSchema.safeParse({
        meetingId: "meeting-1",
        utteranceId: "utterance-1",
      }).success,
    ).toBe(true);

    const acquireResponse = {
      meetingId: "meeting-1",
      utteranceId: "utterance-1",
      participantId: "participant-1",
      leaseExpiresAt: "2026-07-19T12:01:00.000Z",
      correlationId: "correlation-1",
    } as const;
    const parsedAcquireResponse =
      AcquireSharedFloorResponseSchema.parse(acquireResponse);
    expectTypeOf(
      parsedAcquireResponse,
    ).toEqualTypeOf<AcquireSharedFloorResponse>();
    expect(
      AcquireSharedFloorResponseSchema.safeParse({
        ...acquireResponse,
        leaseExpiresAt: "2026-07-19 12:01:00",
      }).success,
    ).toBe(false);

    const releaseRequest = {
      meetingId: "meeting-1",
      utteranceId: "utterance-1",
    } as const;
    const parsedReleaseRequest =
      ReleaseSharedFloorRequestSchema.parse(releaseRequest);
    expectTypeOf(
      parsedReleaseRequest,
    ).toEqualTypeOf<ReleaseSharedFloorRequest>();
    expect(
      ReleaseSharedFloorRequestSchema.safeParse({
        ...releaseRequest,
        visibility: "shared",
      }).success,
    ).toBe(false);
    expect(
      ReleaseSharedFloorRequestSchema.safeParse({
        ...releaseRequest,
        correlationId: "correlation-2",
      }).success,
    ).toBe(false);

    const releaseResponse = {
      meetingId: "meeting-1",
      utteranceId: "utterance-1",
      releasedAt: "2026-07-19T12:00:30.000Z",
      correlationId: "correlation-2",
    } as const;
    const parsedReleaseResponse =
      ReleaseSharedFloorResponseSchema.parse(releaseResponse);
    expectTypeOf(
      parsedReleaseResponse,
    ).toEqualTypeOf<ReleaseSharedFloorResponse>();
    expect(
      ReleaseSharedFloorResponseSchema.safeParse({
        ...releaseResponse,
        releasedAt: "2026-07-19T12:00:30+09:00",
      }).success,
    ).toBe(false);
  });

  it("captures bounded private or shared utterances without client-selected ownership", () => {
    const request = {
      meetingId: "meeting-1",
      utteranceId: "utterance-1",
      channel: "private",
      text: "A synthetic private concern.",
      capturedAt: "2026-07-19T12:00:00.000Z",
    } as const;
    const parsedRequest = CaptureUtteranceRequestSchema.parse(request);
    expectTypeOf(parsedRequest).toEqualTypeOf<CaptureUtteranceRequest>();

    for (const forbidden of [
      { participantId: "participant-1" },
      { ownerParticipantId: "participant-1" },
      { visibility: "private" },
    ]) {
      expect(
        CaptureUtteranceRequestSchema.safeParse({
          ...request,
          ...forbidden,
        }).success,
      ).toBe(false);
    }
    expect(
      CaptureUtteranceRequestSchema.safeParse({
        ...request,
        channel: "participant-private",
      }).success,
    ).toBe(false);
    expect(
      CaptureUtteranceRequestSchema.safeParse({
        ...request,
        channel: "shared",
      }).success,
    ).toBe(true);
    expect(
      CaptureUtteranceRequestSchema.safeParse({
        ...request,
        capturedAt: "2026-07-19 12:00:00",
      }).success,
    ).toBe(false);
    expect(
      CaptureUtteranceRequestSchema.safeParse({
        ...request,
        text: "",
      }).success,
    ).toBe(false);
    expect(
      CaptureUtteranceRequestSchema.safeParse({
        ...request,
        text: "x".repeat(4000),
      }).success,
    ).toBe(true);
    expect(
      CaptureUtteranceRequestSchema.safeParse({
        ...request,
        text: "x".repeat(4001),
      }).success,
    ).toBe(false);

    const response = {
      meetingId: "meeting-1",
      utterance: {
        utteranceId: "utterance-1",
        participantId: "participant-1",
        channel: "private",
        text: "A synthetic private concern.",
        capturedAt: "2026-07-19T12:00:00.000Z",
      },
      replayed: false,
      position: 5,
      correlationId: "correlation-1",
    } as const;
    const parsedResponse = CaptureUtteranceResponseSchema.parse(response);
    expectTypeOf(parsedResponse).toEqualTypeOf<CaptureUtteranceResponse>();
    expect(
      CaptureUtteranceResponseSchema.safeParse({
        ...response,
        utterance: {
          ...response.utterance,
          visibility: "private",
        },
      }).success,
    ).toBe(false);
    expect(
      CaptureUtteranceResponseSchema.safeParse({
        ...response,
        channel: "private",
      }).success,
    ).toBe(false);
  });

  it("issues and revokes display tokens with strict meeting-scoped DTOs", () => {
    const issueRequest = {
      meetingId: "meeting-1",
      expectedPosition: 4,
      correlationId: "correlation-1",
    } as const;
    const parsedIssueRequest =
      IssueDisplayTokenRequestSchema.parse(issueRequest);
    expectTypeOf(parsedIssueRequest).toEqualTypeOf<IssueDisplayTokenRequest>();
    expect(
      IssueDisplayTokenRequestSchema.safeParse({
        ...issueRequest,
        idempotencyKey: "not-part-of-this-contract",
      }).success,
    ).toBe(false);

    const issueResponse = {
      meetingId: "meeting-1",
      displayTokenId: "display-token-1",
      displayToken: "raw-opaque-display-token",
      expiresAt: "2026-07-19T12:05:00.000Z",
      position: 5,
      correlationId: "correlation-1",
    } as const;
    const parsedIssueResponse =
      IssueDisplayTokenResponseSchema.parse(issueResponse);
    expectTypeOf(
      parsedIssueResponse,
    ).toEqualTypeOf<IssueDisplayTokenResponse>();
    expect(
      IssueDisplayTokenResponseSchema.safeParse({
        ...issueResponse,
        participantId: "participant-1",
      }).success,
    ).toBe(false);

    const revokeRequest = {
      meetingId: "meeting-1",
      displayTokenId: "display-token-1",
      expectedPosition: 5,
      correlationId: "correlation-2",
    } as const;
    const parsedRevokeRequest =
      RevokeDisplayTokenRequestSchema.parse(revokeRequest);
    expectTypeOf(
      parsedRevokeRequest,
    ).toEqualTypeOf<RevokeDisplayTokenRequest>();
    expect(
      RevokeDisplayTokenRequestSchema.safeParse({
        ...revokeRequest,
        actor: { kind: "participant", participantId: "participant-1" },
      }).success,
    ).toBe(false);

    const revokeResponse = {
      meetingId: "meeting-1",
      displayTokenId: "display-token-1",
      revokedAt: "2026-07-19T12:04:00.000Z",
      position: 6,
      correlationId: "correlation-2",
    } as const;
    const parsedRevokeResponse =
      RevokeDisplayTokenResponseSchema.parse(revokeResponse);
    expectTypeOf(
      parsedRevokeResponse,
    ).toEqualTypeOf<RevokeDisplayTokenResponse>();
    expect(
      RevokeDisplayTokenResponseSchema.safeParse({
        ...revokeResponse,
        privateWorkspace: {},
      }).success,
    ).toBe(false);
  });

  it("exposes only the strict read-only shared display projection", () => {
    const response = {
      meeting: {
        meetingId: "meeting-1",
        purpose: "Synthetic rollout decision",
        phase: "deciding",
      },
      shared: {
        position: 5,
        evidence: [
          {
            evidenceId: "evidence-1",
            exactSnippet: "Synthetic approved evidence.",
            sourceArtifactId: "source-1",
            sourceRange: { start: 0, end: 28 },
            createdAt: "2026-07-19T12:00:00.000Z",
          },
        ],
        premises: [
          {
            premiseId: "premise-1",
            statement: "The listed controls are complete.",
            confirmationStatus: "confirmed",
          },
        ],
        dissent: [
          {
            dissentId: "dissent-1",
            reason: "The rollout remains reversible.",
            retained: true,
          },
        ],
        actions: [
          {
            actionId: "action-1",
            ownerParticipantId: "participant-1",
            scope: ["Complete the listed controls."],
            status: "active",
          },
        ],
        decisions: [monitoringDecision],
      },
      expiresAt: "2026-07-19T12:05:00.000Z",
      correlationId: "correlation-1",
    } as const;

    const parsed = SharedDisplayProjectionResponseSchema.parse(response);
    expectTypeOf(parsed).toEqualTypeOf<SharedDisplayProjectionResponse>();
    expect(
      SharedDisplayProjectionResponseSchema.safeParse({
        ...response,
        participant: {
          participantId: "participant-1",
          userId: "user-1",
          role: "participant",
        },
      }).success,
    ).toBe(false);
    expect(
      SharedDisplayProjectionResponseSchema.safeParse({
        ...response,
        privateWorkspace: {
          sources: [],
          disclosureCandidates: [],
          inferenceSuggestions: [],
        },
      }).success,
    ).toBe(false);
    expect(
      SharedDisplayProjectionResponseSchema.safeParse({
        ...response,
        shared: {
          ...response.shared,
          participants: [],
        },
      }).success,
    ).toBe(false);
  });

  it("contracts owner-private artifact upload, retrieval, and projection metadata", () => {
    const fields = {
      meetingId: "meeting-1",
      idempotencyKey: "artifact-upload-1",
      correlationId: "correlation-artifact-1",
    } as const;
    const parsedFields = UploadPrivateArtifactFieldsSchema.parse(fields);
    expectTypeOf(parsedFields).toEqualTypeOf<UploadPrivateArtifactFields>();
    expect(
      RegisterPrivateUrlArtifactRequestSchema.parse({
        ...fields,
        url: "https://public.example/synthetic-readiness.md",
      }),
    ).toMatchObject({
      meetingId: "meeting-1",
      url: "https://public.example/synthetic-readiness.md",
    });
    expect(
      RegisterPrivateUrlArtifactRequestSchema.safeParse({
        ...fields,
        url: "not-a-url",
      }).success,
    ).toBe(false);

    const artifact = {
      sourceArtifactId: "artifact-source-1",
      derivedArtifactId: "artifact-derived-1",
      filename: "synthetic-readiness.md",
      contentType: "text/markdown",
      sourceContentHash: `sha256:${"1".repeat(64)}`,
      derivedContentHash: `sha256:${"2".repeat(64)}`,
      sizeBytes: 128,
      derivedSizeBytes: 112,
      ingestionMethod: "upload",
      processingState: "processed",
      createdAt: "2026-07-19T12:00:00.000Z",
    } as const;
    const response = {
      meetingId: "meeting-1",
      position: 3,
      correlationId: "correlation-artifact-1",
      artifact,
    } as const;
    const parsedResponse = UploadPrivateArtifactResponseSchema.parse(response);
    expectTypeOf(parsedResponse).toEqualTypeOf<UploadPrivateArtifactResponse>();

    expect(
      UploadPrivateArtifactResponseSchema.safeParse({
        ...response,
        artifact: {
          ...artifact,
          sourceText: "private content must not enter metadata responses",
        },
      }).success,
    ).toBe(false);
    expect(
      UploadPrivateArtifactResponseSchema.safeParse({
        ...response,
        artifact: {
          ...artifact,
          sizeBytes: 20 * 1024 * 1024 + 1,
        },
      }).success,
    ).toBe(false);
    expect(
      DownloadPrivateArtifactQuerySchema.parse({
        artifactId: artifact.sourceArtifactId,
        meetingId: "meeting-1",
      }).representation,
    ).toBe("source");
    expect(
      DownloadPrivateArtifactQuerySchema.safeParse({
        artifactId: artifact.sourceArtifactId,
        meetingId: "meeting-1",
        representation: "raw",
      }).success,
    ).toBe(false);

    const roleProjection = {
      meeting: {
        meetingId: "meeting-1",
        purpose: "Synthetic rollout decision",
        phase: "deliberating",
      },
      participant: {
        participantId: "participant-1",
        userId: "user-1",
        role: "participant",
      },
      capabilities: ["meeting:read", "artifact:create-own"],
      shared: {
        position: 3,
        participants: [],
        evidence: [],
        premises: [],
        dissent: [],
        actions: [],
        decisions: [],
        utterances: [],
        sharedFloor: null,
      },
      privateWorkspace: {
        artifacts: [artifact],
        sources: [],
        disclosureCandidates: [],
        inferenceSuggestions: [],
        utterances: [],
      },
      correlationId: "correlation-artifact-1",
    } as const;
    expect(RoleProjectionResponseSchema.parse(roleProjection)).toMatchObject({
      privateWorkspace: { artifacts: [artifact] },
    });
  });
});
