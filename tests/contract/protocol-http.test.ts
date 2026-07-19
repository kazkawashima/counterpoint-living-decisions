import { describe, expect, expectTypeOf, it } from "vitest";

import {
  ApproveDisclosureRequestSchema,
  CommitDecisionRequestSchema,
  ConfirmInvalidationReviewResponseSchema,
  CreateMeetingRequestSchema,
  DispositionConfirmedInferenceRequestSchema,
  FacilitatorInvalidationReviewRequestSchema,
  HealthRequestSchema,
  HealthResponseSchema,
  HTTP_API_V1_PREFIX,
  InjectDemoRegulatoryChangeRequestSchema,
  InvalidationEvaluationSchema,
  JoinMeetingByCodeRequestSchema,
  ListAssignedMeetingsRequestSchema,
  LoginRequestSchema,
  LoginResponseSchema,
  LogoutRequestSchema,
  MarkDecisionReadyRequestSchema,
  PreviewDisclosureRequestSchema,
  ProposeDisclosureRequestSchema,
  ReadinessRequestSchema,
  ReadinessResponseSchema,
  RegulatoryChangeWebhookRequestSchema,
  RegulatoryChangeWebhookResponseSchema,
  RegisterPrivateTextSourceFixtureRequestSchema,
  RejectDisclosureRequestSchema,
  RejectInvalidationReviewResponseSchema,
  ReviewInvalidationResponseSchema,
  RoleProjectionQuerySchema,
  SaveDecisionDraftRequestSchema,
  StartDecisionMonitoringRequestSchema,
  StartDecisionMonitoringResponseSchema,
  type FacilitatorInvalidationReviewRequest,
  type FacilitatorInvalidationReviewResponse,
  type LoginRequest,
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
});
