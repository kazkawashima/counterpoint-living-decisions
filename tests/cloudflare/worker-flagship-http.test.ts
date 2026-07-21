/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createWorkerHandler, type Env } from "../../apps/worker/src/index.js";
import { fingerprintJudgeStructuredInput } from "../../apps/worker/src/judge-structured-ai.js";
import type {
  AssumptionInvalidationEvaluation,
  AssumptionInvalidationEvaluationInput,
  PrivateDisclosureProposal,
  SharedDecisionSynthesis,
  SharedDecisionSynthesisInput,
} from "@counterpoint/adapters-openai";
import {
  ApproveDisclosureResponseSchema,
  CaptureUtteranceResponseSchema,
  CommitDecisionResponseSchema,
  DispositionSharedDecisionCandidateRequestSchema,
  DispositionSharedDecisionCandidateResponseSchema,
  FacilitatorDemoResetResponseSchema,
  InjectDemoRegulatoryChangeResponseSchema,
  IssueDisplayTokenResponseSchema,
  ListInvalidationEvaluationsResponseSchema,
  ListSharedExternalEventsResponseSchema,
  PreviewDisclosureResponseSchema,
  ProposeDisclosureResponseSchema,
  RegisterPrivateTextSourceFixtureResponseSchema,
  SaveDecisionDraftResponseSchema,
  SynthesizeSharedDecisionResponseSchema,
  MarkDecisionReadyResponseSchema,
  ReviewInvalidationResponseSchema,
  ResolveDecisionReviewResponseSchema,
  RevokeDisplayTokenResponseSchema,
  SharedDisplayProjectionResponseSchema,
  StartDecisionMonitoringResponseSchema,
} from "@counterpoint/protocol";

const FLAGSHIP_MEETING_ID = "meeting-global-ai-rollout";

type WorkerRequest = Parameters<
  NonNullable<ReturnType<typeof createWorkerHandler>["fetch"]>
>[0];

function workerRequest(request: Request): WorkerRequest {
  return request as unknown as WorkerRequest;
}

function workerEnv(): Env {
  return {
    ARTIFACTS: env.ARTIFACTS,
    ASSETS: env.ASSETS,
    DB: env.DB,
    JUDGE_REALTIME_CALLS: env.JUDGE_REALTIME_CALLS,
    MEETINGS: env.MEETINGS,
    OPENAI_MODE: "disabled",
    OPENAI_MODEL: env.OPENAI_MODEL,
    RUNTIME_MODE: env.RUNTIME_MODE,
    JUDGE_MANAGED_REALTIME_ROUTE_ENABLED:
      env.JUDGE_MANAGED_REALTIME_ROUTE_ENABLED,
  };
}

function judgeWorkerEnv(overrides: Partial<Env> = {}): Env {
  return {
    ...workerEnv(),
    JUDGE_IP_HMAC_SECRET: "judge-ip-hmac-secret-material-0001",
    JUDGE_STRUCTURED_AI_ROUTE_ENABLED: "enabled",
    JUDGE_USER_ID: "product",
    OPENAI_API_KEY_JUDGE: "test-only-never-sent",
    OPENAI_MODE: "disabled",
    ...overrides,
  };
}

async function login(
  handler: ReturnType<typeof createWorkerHandler>,
  environment: Env,
  userId = "product",
  password = "counterpoint-product",
): Promise<string> {
  const response = await handler.fetch!(
    workerRequest(
      new Request("https://203.0.113.40/api/v1/login", {
        body: JSON.stringify({ password, userId }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    ),
    environment,
    {} as ExecutionContext,
  );
  expect(response.status).toBe(200);
  return String((await json(response)).bearerToken);
}

async function registerSource(input: {
  readonly authorization: string;
  readonly environment: Env;
  readonly handler: ReturnType<typeof createWorkerHandler>;
  readonly idempotencyKey: string;
  readonly text: string;
}): Promise<{
  readonly position: number;
  readonly sourceArtifactId: string;
}> {
  const response = await input.handler.fetch!(
    workerRequest(
      new Request("https://203.0.113.40/api/v1/disclosures/sources/text", {
        body: JSON.stringify({
          expectedPosition: 0,
          idempotencyKey: input.idempotencyKey,
          meetingId: FLAGSHIP_MEETING_ID,
          text: input.text,
          title: "Managed AI integration source",
        }),
        headers: {
          authorization: input.authorization,
          "content-type": "application/json",
        },
        method: "POST",
      }),
    ),
    input.environment,
    {} as ExecutionContext,
  );
  expect(response.status).toBe(201);
  const body = RegisterPrivateTextSourceFixtureResponseSchema.parse(
    await json(response),
  );
  return {
    position: body.position,
    sourceArtifactId: body.source.sourceArtifactId,
  };
}

function proposeRequest(input: {
  readonly authorization: string;
  readonly expectedPosition: number;
  readonly ipAddress?: string;
  readonly idempotencyKey: string;
  readonly sourceArtifactId: string;
  readonly sourceText?: string;
}): Request {
  const exactSnippet = input.sourceText?.slice(0, 12) ?? "placeholder";
  return new Request("https://203.0.113.40/api/v1/disclosures/proposals", {
    body: JSON.stringify({
      assistance: "ai_preferred",
      exactSnippet,
      expectedPosition: input.expectedPosition,
      idempotencyKey: input.idempotencyKey,
      meetingId: FLAGSHIP_MEETING_ID,
      sourceArtifactId: input.sourceArtifactId,
      sourceRange: { end: exactSnippet.length, start: 0 },
    }),
    headers: {
      authorization: input.authorization,
      "CF-Connecting-IP": input.ipAddress ?? "203.0.113.40",
      "content-type": "application/json",
    },
    method: "POST",
  });
}

function meteredProposal(
  sourceArtifactId: string,
  text: string,
): PrivateDisclosureProposal {
  const exactSnippet = text.slice(0, Math.min(text.length, 24));
  return {
    ai: {
      candidates: [
        {
          confidence: 1,
          exactSnippet,
          reason: "Provider-free metered fake.",
          sourceRange: { end: exactSnippet.length, start: 0 },
          sourceReferenceId: sourceArtifactId,
        },
      ],
      confidence: 1,
      generatedAt: "2026-07-20T00:00:00.000Z",
      inputReferenceIds: [sourceArtifactId],
      model: "gpt-5.6",
      operation: "private_evidence_disclosure",
      promptVersion: "private-evidence-v1",
      reason: "Provider-free metered fake.",
      schemaVersion: "1",
    },
    billing: {
      attemptCount: 1,
      attempts: [{ inputTokens: 120, model: "gpt-5.6", outputTokens: 20 }],
      inputTokens: 120,
      outputTokens: 20,
    },
    exactSnippet,
    sourceRange: { end: exactSnippet.length, start: 0 },
  };
}

function meteredDecision(
  input: SharedDecisionSynthesisInput,
): SharedDecisionSynthesis {
  const evidence = input.evidence[0];
  const ownerParticipantId = input.participantIds[0];
  if (evidence === undefined || ownerParticipantId === undefined) {
    throw new Error("Decision fake requires evidence and a participant.");
  }
  const draft = {
    action: {
      affectedPremiseIndex: 0 as const,
      ownerParticipantId,
      scope: "Run the staged pilot.",
    },
    confidence: 0.95,
    dissent: {
      reason: "Retain the rollout-risk concern.",
      retained: true,
    },
    monitorCondition: "Review regulatory changes weekly.",
    outcome: "Run a staged rollout with an explicit stop condition.",
    premise: {
      evidenceReferenceIds: [evidence.evidenceId],
      statement: "A staged pilot limits rollout risk.",
    },
    reason: "Provider-free metered fake.",
    title: "Staged rollout",
  };
  return {
    ai: {
      candidates: [draft],
      generatedAt: "2026-07-20T00:00:00.000Z",
      inputReferenceIds: [evidence.evidenceId],
      model: "gpt-5.6",
      operation: "shared_decision_synthesis",
      promptVersion: "shared-decision-v1",
      schemaVersion: "1",
    },
    billing: {
      attemptCount: 1,
      attempts: [{ inputTokens: 240, model: "gpt-5.6", outputTokens: 40 }],
      inputTokens: 240,
      outputTokens: 40,
    },
    draft,
  };
}

function meteredInvalidation(
  input: AssumptionInvalidationEvaluationInput,
): AssumptionInvalidationEvaluation {
  const action = input.actions[0];
  const evidence = input.evidence[0];
  const premise = input.premises[0];
  if (action === undefined || evidence === undefined || premise === undefined) {
    throw new Error(
      "Invalidation fake requires an Action, evidence, and premise.",
    );
  }
  const suggestion = {
    affectedActionIds: [action.actionId],
    affectedPremiseIds: [premise.premiseId],
    confidence: 0.98,
    evidenceReferenceIds: [
      evidence.evidenceReferenceId,
      input.externalEvent.sourceReference,
    ],
    reason: "The regulatory change invalidates the rollout premise.",
  };
  return {
    ai: {
      candidates: [suggestion],
      generatedAt: "2026-07-20T00:00:00.000Z",
      inputReferenceIds: [
        input.externalEvent.externalEventId,
        input.decision.revisionId,
        premise.premiseId,
        action.actionId,
        ...suggestion.evidenceReferenceIds,
      ],
      model: "gpt-5.6",
      operation: "assumption_invalidation",
      promptVersion: "assumption-invalidation-v1",
      schemaVersion: "1",
    },
    billing: {
      attemptCount: 1,
      attempts: [{ inputTokens: 180, model: "gpt-5.6", outputTokens: 30 }],
      inputTokens: 180,
      outputTokens: 30,
    },
    suggestion,
  };
}

function providerFreeWorkerHandler(): ReturnType<typeof createWorkerHandler> {
  return createWorkerHandler({
    providerFreeAssumptionInvalidationEvaluator: {
      evaluate(input) {
        const { billing: _billing, ...evaluation } = meteredInvalidation(input);
        void _billing;
        return Promise.resolve(evaluation);
      },
    },
    providerFreePrivateDisclosureProposer: {
      propose(input) {
        const { billing: _billing, ...metered } = meteredProposal(
          input.sourceArtifactId,
          input.text,
        );
        void _billing;
        const [candidate] = metered.ai.candidates;
        const sourceRange = { end: input.text.length, start: 0 };
        const proposal: PrivateDisclosureProposal = {
          ...metered,
          ai: {
            ...metered.ai,
            candidates: [
              {
                ...candidate,
                exactSnippet: input.text,
                sourceRange,
              },
            ],
          },
          exactSnippet: input.text,
          sourceRange,
        };
        return Promise.resolve(proposal);
      },
    },
    providerFreeSharedDecisionSynthesizer: {
      synthesize(input) {
        const { billing: _billing, ...decision } = meteredDecision(input);
        void _billing;
        return Promise.resolve(decision);
      },
    },
  });
}

async function resetFlagship(input: {
  readonly authorization: string;
  readonly environment: Env;
  readonly handler: ReturnType<typeof createWorkerHandler>;
  readonly idempotencyKey: string;
}): Promise<void> {
  const response = await input.handler.fetch!(
    workerRequest(
      new Request(
        `https://203.0.113.40/api/v1/meetings/${FLAGSHIP_MEETING_ID}/demo/reset`,
        {
          body: JSON.stringify({
            expectedPosition: 0,
            idempotencyKey: input.idempotencyKey,
            meetingId: FLAGSHIP_MEETING_ID,
          }),
          headers: {
            authorization: input.authorization,
            "content-type": "application/json",
          },
          method: "POST",
        },
      ),
    ),
    input.environment,
    {} as ExecutionContext,
  );
  expect(response.status).toBe(200);
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return await response.json();
}

describe("Cloudflare Worker hosted flagship API", () => {
  it("reports ready after the exact current D1 migration set is applied", async () => {
    const response = await createWorkerHandler().fetch!(
      workerRequest(new Request("https://192.0.2.10/ready")),
      workerEnv(),
      {} as ExecutionContext,
    );

    expect(response.status).toBe(200);
    await expect(json(response)).resolves.toMatchObject({
      migrationsCurrent: true,
      status: "ready",
    });
  });

  it("shows the seeded Work & Productivity meeting through an external-host-style URL", async () => {
    const handler = providerFreeWorkerHandler();
    const loginResponse = await handler.fetch!(
      workerRequest(
        new Request("https://192.0.2.10/api/v1/login", {
          body: JSON.stringify({
            password: "counterpoint-product",
            userId: "product",
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
      ),
      workerEnv(),
      {} as ExecutionContext,
    );
    expect(loginResponse.status).toBe(200);
    const loginBody = await json(loginResponse);
    const bearerToken = loginBody.bearerToken;
    expect(loginBody.userId).toBe("product");
    expect(typeof bearerToken).toBe("string");

    const authorization = { authorization: `Bearer ${String(bearerToken)}` };
    const meetingsResponse = await handler.fetch!(
      workerRequest(
        new Request("https://198.51.100.8/api/v1/meetings", {
          headers: authorization,
          method: "GET",
        }),
      ),
      workerEnv(),
      {} as ExecutionContext,
    );
    expect(meetingsResponse.status).toBe(200);
    const meetingsBody = await json(meetingsResponse);
    expect(meetingsBody.meetings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          meetingId: FLAGSHIP_MEETING_ID,
          purpose: "Work & Productivity — Global AI Product Rollout",
          role: "facilitator",
        }),
      ]),
    );

    const projectionResponse = await handler.fetch!(
      workerRequest(
        new Request(
          `https://203.0.113.7/api/v1/meetings/${FLAGSHIP_MEETING_ID}/projection`,
          { headers: authorization, method: "GET" },
        ),
      ),
      workerEnv(),
      {} as ExecutionContext,
    );
    expect(projectionResponse.status).toBe(200);
    const projectionBody = await json(projectionResponse);
    expect(projectionBody).toMatchObject({
      meeting: {
        meetingId: FLAGSHIP_MEETING_ID,
        phase: "preparing",
      },
      participant: {
        role: "facilitator",
        userId: "product",
      },
    });

    for (const [path, collection] of [
      ["evidence", "evidence"],
      ["decisions", "decisions"],
      ["external-events", "events"],
      ["invalidation-evaluations", "evaluations"],
    ] as const) {
      const response = await handler.fetch!(
        workerRequest(
          new Request(
            `https://203.0.113.7/api/v1/meetings/${FLAGSHIP_MEETING_ID}/${path}`,
            { headers: authorization, method: "GET" },
          ),
        ),
        workerEnv(),
        {} as ExecutionContext,
      );
      expect(response.status).toBe(200);
      await expect(json(response)).resolves.toMatchObject({
        [collection]: [],
        meetingId: FLAGSHIP_MEETING_ID,
        position: 0,
      });
    }

    const sourceText =
      "The rollout needs a staged pilot and an explicit owner.";
    const exactSnippet = "staged pilot";
    const sourceRange = {
      end: sourceText.indexOf(exactSnippet) + exactSnippet.length,
      start: sourceText.indexOf(exactSnippet),
    };
    const sourceResponse = await handler.fetch!(
      workerRequest(
        new Request("https://203.0.113.7/api/v1/disclosures/sources/text", {
          body: JSON.stringify({
            expectedPosition: 0,
            idempotencyKey: "worker-flagship-text-source",
            meetingId: FLAGSHIP_MEETING_ID,
            text: sourceText,
            title: "Rollout pilot note",
          }),
          headers: { ...authorization, "content-type": "application/json" },
          method: "POST",
        }),
      ),
      workerEnv(),
      {} as ExecutionContext,
    );
    expect(sourceResponse.status).toBe(201);
    const sourceBody = RegisterPrivateTextSourceFixtureResponseSchema.parse(
      await json(sourceResponse),
    );
    expect(sourceBody).toMatchObject({
      meetingId: FLAGSHIP_MEETING_ID,
      position: 1,
      source: {
        text: sourceText,
        title: "Rollout pilot note",
      },
    });

    const proposeResponse = await handler.fetch!(
      workerRequest(
        new Request("https://203.0.113.7/api/v1/disclosures/proposals", {
          body: JSON.stringify({
            assistance: "manual",
            exactSnippet,
            expectedPosition: 1,
            idempotencyKey: "worker-flagship-disclosure-proposal",
            meetingId: FLAGSHIP_MEETING_ID,
            sourceArtifactId: sourceBody.source.sourceArtifactId,
            sourceRange,
          }),
          headers: { ...authorization, "content-type": "application/json" },
          method: "POST",
        }),
      ),
      workerEnv(),
      {} as ExecutionContext,
    );
    expect(proposeResponse.status).toBe(201);
    const proposeBody = ProposeDisclosureResponseSchema.parse(
      await json(proposeResponse),
    );
    expect(proposeBody).toMatchObject({
      candidate: {
        outgoingPayload: {
          exactSnippet,
          sourceArtifactId: sourceBody.source.sourceArtifactId,
          sourceRange,
        },
        state: "proposed",
      },
      origin: "human_selected",
      position: 2,
    });

    const previewResponse = await handler.fetch!(
      workerRequest(
        new Request("https://203.0.113.7/api/v1/disclosures/preview", {
          body: JSON.stringify({
            candidateId: proposeBody.candidate.candidateId,
            exactSnippet,
            expectedPosition: 2,
            idempotencyKey: "worker-flagship-disclosure-preview",
            meetingId: FLAGSHIP_MEETING_ID,
            sourceRange,
          }),
          headers: { ...authorization, "content-type": "application/json" },
          method: "POST",
        }),
      ),
      workerEnv(),
      {} as ExecutionContext,
    );
    expect(previewResponse.status).toBe(200);
    const previewBody = PreviewDisclosureResponseSchema.parse(
      await json(previewResponse),
    );
    expect(previewBody).toMatchObject({
      candidateId: proposeBody.candidate.candidateId,
      outgoingPayload: {
        exactSnippet,
        sourceArtifactId: sourceBody.source.sourceArtifactId,
        sourceRange,
      },
      position: 3,
    });
    expect(previewBody.previewHash).toEqual(expect.any(String));

    const approveResponse = await handler.fetch!(
      workerRequest(
        new Request("https://203.0.113.7/api/v1/disclosures/approve", {
          body: JSON.stringify({
            candidateId: proposeBody.candidate.candidateId,
            expectedPosition: 3,
            idempotencyKey: "worker-flagship-disclosure-approval",
            meetingId: FLAGSHIP_MEETING_ID,
            previewHash: previewBody.previewHash,
          }),
          headers: { ...authorization, "content-type": "application/json" },
          method: "POST",
        }),
      ),
      workerEnv(),
      {} as ExecutionContext,
    );
    expect(approveResponse.status).toBe(200);
    const approveBody = ApproveDisclosureResponseSchema.parse(
      await json(approveResponse),
    );
    expect(approveBody).toMatchObject({
      candidateId: proposeBody.candidate.candidateId,
      evidence: {
        exactSnippet,
        sourceArtifactId: sourceBody.source.sourceArtifactId,
        sourceRange,
      },
      position: 5,
      previewHash: previewBody.previewHash,
    });

    const candidateResponse = await handler.fetch!(
      workerRequest(
        new Request("https://203.0.113.7/api/v1/decisions/candidates", {
          body: JSON.stringify({
            assistance: "manual",
            draft: {
              actions: [
                {
                  ownerParticipantId: "participant-product",
                  scope: ["Run the staged pilot"],
                },
              ],
              dissent: [],
              monitorCondition: { description: "Review pilot metrics weekly" },
              outcome: "Run the staged pilot with an explicit owner.",
              premises: [
                {
                  evidenceReferenceIds: [approveBody.evidence.evidenceId],
                  statement: "A staged pilot limits rollout risk.",
                },
              ],
              title: "Staged rollout pilot",
            },
            expectedPosition: 5,
            idempotencyKey: "worker-flagship-decision-candidate",
            meetingId: FLAGSHIP_MEETING_ID,
          }),
          headers: { ...authorization, "content-type": "application/json" },
          method: "POST",
        }),
      ),
      workerEnv(),
      {} as ExecutionContext,
    );
    expect(candidateResponse.status).toBe(201);
    const candidateBody = SynthesizeSharedDecisionResponseSchema.parse(
      await json(candidateResponse),
    );
    expect(candidateBody.candidate.draft.premiseCandidates).toHaveLength(1);
    expect(candidateBody.candidate.draft.actionCandidates).toHaveLength(1);

    const candidatePremise = candidateBody.candidate.draft.premiseCandidates[0];
    const candidateAction = candidateBody.candidate.draft.actionCandidates[0];
    if (candidatePremise === undefined || candidateAction === undefined) {
      throw new Error("Manual candidate did not contain premise and action");
    }
    const dispositionResponse = await handler.fetch!(
      workerRequest(
        new Request(
          "https://203.0.113.7/api/v1/decisions/candidates/disposition",
          {
            body: JSON.stringify({
              actions: [
                {
                  ownerParticipantId: candidateAction.ownerParticipantId,
                  scope: candidateAction.scope,
                },
              ],
              candidateId: candidateBody.candidate.candidateId,
              dissent: [],
              expectedPosition: 8,
              idempotencyKey: "worker-flagship-decision-disposition",
              meetingId: FLAGSHIP_MEETING_ID,
              monitorCondition: { description: "Review pilot metrics weekly" },
              outcome: "Run the staged pilot with an explicit owner.",
              premiseDispositions: [
                {
                  candidateId: candidatePremise.candidateId,
                  disposition: "confirmed",
                  premise: {
                    evidenceReferenceIds: [approveBody.evidence.evidenceId],
                    statement: candidatePremise.statement,
                  },
                },
              ],
              reason: "Facilitator confirmed the staged pilot path.",
              title: "Staged rollout pilot",
            }),
            headers: { ...authorization, "content-type": "application/json" },
            method: "POST",
          },
        ),
      ),
      workerEnv(),
      {} as ExecutionContext,
    );
    expect(dispositionResponse.status).toBe(200);
    const dispositionBody =
      DispositionSharedDecisionCandidateResponseSchema.parse(
        await json(dispositionResponse),
      );
    expect(dispositionBody.premises).toHaveLength(1);
    expect(dispositionBody.actions).toHaveLength(1);
    const premise = dispositionBody.premises[0];
    const action = dispositionBody.actions[0];
    if (premise === undefined || action === undefined) {
      throw new Error("Disposition did not materialize premise and action");
    }

    const draftResponse = await handler.fetch!(
      workerRequest(
        new Request("https://203.0.113.7/api/v1/decisions/drafts", {
          body: JSON.stringify({
            actionIds: [action.actionId],
            changeReason: "Initial facilitator draft",
            dissentIds: [],
            evidenceIds: [approveBody.evidence.evidenceId],
            expectedPosition: 10,
            idempotencyKey: "worker-flagship-decision-draft",
            meetingId: FLAGSHIP_MEETING_ID,
            monitorCondition: { description: "Review pilot metrics weekly" },
            outcome: "Run the staged pilot with an explicit owner.",
            premiseIds: [premise.premiseId],
            title: "Staged rollout pilot",
          }),
          headers: { ...authorization, "content-type": "application/json" },
          method: "POST",
        }),
      ),
      workerEnv(),
      {} as ExecutionContext,
    );
    expect(draftResponse.status).toBe(201);
    const draftBody = SaveDecisionDraftResponseSchema.parse(
      await json(draftResponse),
    );
    expect(draftBody).toMatchObject({
      decision: {
        snapshot: {
          evidenceIds: [approveBody.evidence.evidenceId],
          status: "DRAFT",
          title: "Staged rollout pilot",
        },
        status: "DRAFT",
      },
    });
    expect(draftBody.position).toBeGreaterThan(dispositionBody.position);

    const readyResponse = await handler.fetch!(
      workerRequest(
        new Request("https://203.0.113.7/api/v1/decisions/ready", {
          body: JSON.stringify({
            decisionId: draftBody.decision.decisionId,
            expectedPosition: draftBody.position,
            idempotencyKey: "worker-flagship-decision-ready",
            meetingId: FLAGSHIP_MEETING_ID,
          }),
          headers: { ...authorization, "content-type": "application/json" },
          method: "POST",
        }),
      ),
      workerEnv(),
      {} as ExecutionContext,
    );
    expect(readyResponse.status).toBe(200);
    const readyBody = MarkDecisionReadyResponseSchema.parse(
      await json(readyResponse),
    );
    expect(readyBody.decision.status).toBe("DECISION_READY");

    const commitResponse = await handler.fetch!(
      workerRequest(
        new Request("https://203.0.113.7/api/v1/decisions/commit", {
          body: JSON.stringify({
            decisionId: readyBody.decision.decisionId,
            expectedPosition: readyBody.position,
            idempotencyKey: "worker-flagship-decision-commit",
            meetingId: FLAGSHIP_MEETING_ID,
          }),
          headers: { ...authorization, "content-type": "application/json" },
          method: "POST",
        }),
      ),
      workerEnv(),
      {} as ExecutionContext,
    );
    expect(commitResponse.status).toBe(200);
    const commitBody = CommitDecisionResponseSchema.parse(
      await json(commitResponse),
    );
    expect(commitBody.decision.status).toBe("COMMITTED");

    const monitoringResponse = await handler.fetch!(
      workerRequest(
        new Request("https://203.0.113.7/api/v1/decisions/monitoring", {
          body: JSON.stringify({
            decisionId: commitBody.decision.decisionId,
            expectedPosition: commitBody.position,
            idempotencyKey: "worker-flagship-decision-monitoring",
            meetingId: FLAGSHIP_MEETING_ID,
          }),
          headers: { ...authorization, "content-type": "application/json" },
          method: "POST",
        }),
      ),
      workerEnv(),
      {} as ExecutionContext,
    );
    expect(monitoringResponse.status).toBe(200);
    const monitoringBody = StartDecisionMonitoringResponseSchema.parse(
      await json(monitoringResponse),
    );
    expect(monitoringBody.decision.status).toBe("MONITORING");

    const demoEventResponse = await handler.fetch!(
      workerRequest(
        new Request(
          `https://203.0.113.7/api/v1/meetings/${FLAGSHIP_MEETING_ID}/demo/regulatory-changes`,
          {
            body: JSON.stringify({
              idempotencyKey: "worker-flagship-regulatory-change",
            }),
            headers: { ...authorization, "content-type": "application/json" },
            method: "POST",
          },
        ),
      ),
      workerEnv(),
      {} as ExecutionContext,
    );
    expect(demoEventResponse.status).toBe(202);
    const demoEventBody = InjectDemoRegulatoryChangeResponseSchema.parse(
      await json(demoEventResponse),
    );
    expect(demoEventBody).toMatchObject({
      evaluationStatus: "pending",
      event: {
        eventType: "regulatory_change",
        monitorRegistrationId: monitoringBody.monitorRegistrationId,
      },
      receiptStatus: "received",
    });

    const externalEventsResponse = await handler.fetch!(
      workerRequest(
        new Request(
          `https://203.0.113.7/api/v1/meetings/${FLAGSHIP_MEETING_ID}/external-events`,
          { headers: authorization, method: "GET" },
        ),
      ),
      workerEnv(),
      {} as ExecutionContext,
    );
    expect(externalEventsResponse.status).toBe(200);
    const externalEventsBody = ListSharedExternalEventsResponseSchema.parse(
      await json(externalEventsResponse),
    );
    expect(externalEventsBody.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventId: demoEventBody.event.eventId }),
      ]),
    );

    const evaluationsResponse = await handler.fetch!(
      workerRequest(
        new Request(
          `https://203.0.113.7/api/v1/meetings/${FLAGSHIP_MEETING_ID}/invalidation-evaluations`,
          { headers: authorization, method: "GET" },
        ),
      ),
      workerEnv(),
      {} as ExecutionContext,
    );
    expect(evaluationsResponse.status).toBe(200);
    const evaluationsBody = ListInvalidationEvaluationsResponseSchema.parse(
      await json(evaluationsResponse),
    );
    expect(evaluationsBody.evaluations).toHaveLength(1);
    const evaluation = evaluationsBody.evaluations[0];
    expect(evaluation).toMatchObject({
      decision: { status: "AT_RISK" },
      externalEventId: demoEventBody.event.eventId,
      operation: "assumption_invalidation",
    });
    expect(evaluation?.suggestionId).toEqual(expect.any(String));

    const reviewResponse = await handler.fetch!(
      workerRequest(
        new Request(
          "https://203.0.113.7/api/v1/decisions/invalidation-review",
          {
            body: JSON.stringify({
              decisionId: commitBody.decision.decisionId,
              disposition: "confirm_invalidation",
              expectedPosition: evaluationsBody.position,
              idempotencyKey: "worker-flagship-invalidation-review",
              meetingId: FLAGSHIP_MEETING_ID,
              reason:
                "The staged regulatory change invalidates the rollout premise.",
              suggestionId: evaluation?.suggestionId,
            }),
            headers: { ...authorization, "content-type": "application/json" },
            method: "POST",
          },
        ),
      ),
      workerEnv(),
      {} as ExecutionContext,
    );
    expect(reviewResponse.status).toBe(200);
    const reviewBody = ReviewInvalidationResponseSchema.parse(
      await json(reviewResponse),
    );
    expect(reviewBody).toMatchObject({
      decision: { status: "REVIEW_REQUIRED" },
      disposition: "confirm_invalidation",
      heldActionIds: [expect.any(String)],
      reconsiderationTask: {
        state: "open",
        triggerExternalEventId: demoEventBody.event.eventId,
      },
    });

    const resolutionResponse = await handler.fetch!(
      workerRequest(
        new Request("https://203.0.113.7/api/v1/decisions/review-resolution", {
          body: JSON.stringify({
            changeReason:
              "The staged regulatory change requires a revised approval gate.",
            decisionId: reviewBody.decision.decisionId,
            expectedPosition: reviewBody.position,
            idempotencyKey: "worker-flagship-review-resolution",
            meetingId: FLAGSHIP_MEETING_ID,
            monitorCondition: {
              description:
                "Confirm the revised approval gate before launch resumes.",
            },
            outcome:
              "Pause launch until the revised approval gate is satisfied.",
            resolution: "recommit_revision",
            title: "Revised conditional rollout",
          }),
          headers: { ...authorization, "content-type": "application/json" },
          method: "POST",
        }),
      ),
      workerEnv(),
      {} as ExecutionContext,
    );
    expect(resolutionResponse.status).toBe(200);
    const resolutionBody = ResolveDecisionReviewResponseSchema.parse(
      await json(resolutionResponse),
    );
    expect(resolutionBody).toMatchObject({
      decision: {
        activeRevision: 3,
        status: "COMMITTED",
      },
      resolution: "recommit_revision",
      revision: {
        snapshot: {
          status: "COMMITTED",
          title: "Revised conditional rollout",
        },
        version: 3,
      },
    });

    const resetResponse = await handler.fetch!(
      workerRequest(
        new Request(
          `https://203.0.113.7/api/v1/meetings/${FLAGSHIP_MEETING_ID}/demo/reset`,
          {
            body: JSON.stringify({
              expectedPosition: resolutionBody.position,
              idempotencyKey: "worker-flagship-demo-reset",
              meetingId: FLAGSHIP_MEETING_ID,
            }),
            headers: { ...authorization, "content-type": "application/json" },
            method: "POST",
          },
        ),
      ),
      workerEnv(),
      {} as ExecutionContext,
    );
    expect(resetResponse.status).toBe(200);
    const resetBody = FacilitatorDemoResetResponseSchema.parse(
      await json(resetResponse),
    );
    expect(resetBody.resetStatus).toBe("completed");

    const resetReplayResponse = await handler.fetch!(
      workerRequest(
        new Request(
          `https://203.0.113.7/api/v1/meetings/${FLAGSHIP_MEETING_ID}/demo/reset`,
          {
            body: JSON.stringify({
              expectedPosition: resetBody.position,
              idempotencyKey: "worker-flagship-demo-reset",
              meetingId: FLAGSHIP_MEETING_ID,
            }),
            headers: { ...authorization, "content-type": "application/json" },
            method: "POST",
          },
        ),
      ),
      workerEnv(),
      {} as ExecutionContext,
    );
    expect(resetReplayResponse.status).toBe(200);
    const resetReplayBody = FacilitatorDemoResetResponseSchema.parse(
      await json(resetReplayResponse),
    );
    expect(resetReplayBody.resetRequestId).toBe(resetBody.resetRequestId);

    const externalEventsAfterResetResponse = await handler.fetch!(
      workerRequest(
        new Request(
          `https://203.0.113.7/api/v1/meetings/${FLAGSHIP_MEETING_ID}/external-events`,
          { headers: authorization, method: "GET" },
        ),
      ),
      workerEnv(),
      {} as ExecutionContext,
    );
    expect(externalEventsAfterResetResponse.status).toBe(200);
    expect(
      ListSharedExternalEventsResponseSchema.parse(
        await json(externalEventsAfterResetResponse),
      ).events,
    ).toEqual([]);

    const evaluationsAfterResetResponse = await handler.fetch!(
      workerRequest(
        new Request(
          `https://203.0.113.7/api/v1/meetings/${FLAGSHIP_MEETING_ID}/invalidation-evaluations`,
          { headers: authorization, method: "GET" },
        ),
      ),
      workerEnv(),
      {} as ExecutionContext,
    );
    expect(evaluationsAfterResetResponse.status).toBe(200);
    expect(
      ListInvalidationEvaluationsResponseSchema.parse(
        await json(evaluationsAfterResetResponse),
      ).evaluations,
    ).toEqual([]);

    const projectionAfterSourceResponse = await handler.fetch!(
      workerRequest(
        new Request(
          `https://203.0.113.7/api/v1/meetings/${FLAGSHIP_MEETING_ID}/projection`,
          { headers: authorization, method: "GET" },
        ),
      ),
      workerEnv(),
      {} as ExecutionContext,
    );
    expect(projectionAfterSourceResponse.status).toBe(200);
    await expect(json(projectionAfterSourceResponse)).resolves.toMatchObject({
      meeting: {
        phase: "preparing",
      },
      privateWorkspace: {
        sources: [],
        disclosureCandidates: [],
      },
      shared: {
        decisions: [],
        evidence: [],
      },
    });
  }, 15_000);

  it("keeps the hosted meeting and projection routes authenticated", async () => {
    const handler = createWorkerHandler();
    const response = await handler.fetch!(
      workerRequest(
        new Request("https://192.0.2.10/api/v1/meetings", { method: "GET" }),
      ),
      workerEnv(),
      {} as ExecutionContext,
    );
    expect(response.status).toBe(401);
    await expect(json(response)).resolves.toMatchObject({
      code: "AUTHENTICATION_REQUIRED",
    });

    const participantLoginResponse = await handler.fetch!(
      workerRequest(
        new Request("https://192.0.2.10/api/v1/login", {
          body: JSON.stringify({
            password: "counterpoint-safety",
            userId: "safety",
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
      ),
      workerEnv(),
      {} as ExecutionContext,
    );
    expect(participantLoginResponse.status).toBe(200);
    const participantLoginBody = await json(participantLoginResponse);
    const participantAuthorization = {
      authorization: `Bearer ${String(participantLoginBody.bearerToken)}`,
    };
    const resetResponse = await handler.fetch!(
      workerRequest(
        new Request(
          `https://203.0.113.7/api/v1/meetings/${FLAGSHIP_MEETING_ID}/demo/reset`,
          {
            body: JSON.stringify({
              expectedPosition: 0,
              idempotencyKey: "participant-must-not-reset",
              meetingId: FLAGSHIP_MEETING_ID,
            }),
            headers: {
              ...participantAuthorization,
              "content-type": "application/json",
            },
            method: "POST",
          },
        ),
      ),
      workerEnv(),
      {} as ExecutionContext,
    );
    expect(resetResponse.status).toBe(403);
    await expect(json(resetResponse)).resolves.toMatchObject({
      code: "FORBIDDEN",
    });
  }, 15_000);

  it("keeps hosted display tokens scoped, projected, and revocable", async () => {
    const handler = createWorkerHandler();
    const facilitatorToken = await login(
      handler,
      workerEnv(),
      "product",
      "counterpoint-product",
    );
    const participantToken = await login(
      handler,
      workerEnv(),
      "legal",
      "counterpoint-legal",
    );
    const facilitatorAuthorization = {
      authorization: `Bearer ${facilitatorToken}`,
    };
    const participantAuthorization = {
      authorization: `Bearer ${participantToken}`,
    };

    const reset = await handler.fetch!(
      workerRequest(
        new Request(
          `https://198.51.100.31/api/v1/meetings/${FLAGSHIP_MEETING_ID}/demo/reset`,
          {
            body: JSON.stringify({
              expectedPosition: 0,
              idempotencyKey: "worker-display-token-reset",
              meetingId: FLAGSHIP_MEETING_ID,
            }),
            headers: {
              ...facilitatorAuthorization,
              "content-type": "application/json",
            },
            method: "POST",
          },
        ),
      ),
      workerEnv(),
      {} as ExecutionContext,
    );
    expect(reset.status).toBe(200);

    const projection = await handler.fetch!(
      workerRequest(
        new Request(
          `https://198.51.100.31/api/v1/meetings/${FLAGSHIP_MEETING_ID}/projection`,
          { headers: facilitatorAuthorization, method: "GET" },
        ),
      ),
      workerEnv(),
      {} as ExecutionContext,
    );
    expect(projection.status).toBe(200);
    const projectionBody = await json(projection);
    const expectedPosition = Number(
      (projectionBody.shared as { position: number }).position,
    );
    const participantProjection = await handler.fetch!(
      workerRequest(
        new Request(
          `https://198.51.100.31/api/v1/meetings/${FLAGSHIP_MEETING_ID}/projection`,
          { headers: participantAuthorization, method: "GET" },
        ),
      ),
      workerEnv(),
      {} as ExecutionContext,
    );
    expect(participantProjection.status).toBe(200);
    const participantProjectionBody = await json(participantProjection);
    const participantExpectedPosition = Number(
      (participantProjectionBody.shared as { position: number }).position,
    );

    const forbidden = await handler.fetch!(
      workerRequest(
        new Request(
          `https://198.51.100.31/api/v1/meetings/${FLAGSHIP_MEETING_ID}/display-tokens`,
          {
            body: JSON.stringify({
              expectedPosition: participantExpectedPosition,
              meetingId: FLAGSHIP_MEETING_ID,
            }),
            headers: {
              ...participantAuthorization,
              "content-type": "application/json",
            },
            method: "POST",
          },
        ),
      ),
      workerEnv(),
      {} as ExecutionContext,
    );
    expect(forbidden.status).toBe(403);

    const issuedResponse = await handler.fetch!(
      workerRequest(
        new Request(
          `https://198.51.100.31/api/v1/meetings/${FLAGSHIP_MEETING_ID}/display-tokens`,
          {
            body: JSON.stringify({
              expectedPosition,
              meetingId: FLAGSHIP_MEETING_ID,
            }),
            headers: {
              ...facilitatorAuthorization,
              "content-type": "application/json",
            },
            method: "POST",
          },
        ),
      ),
      workerEnv(),
      {} as ExecutionContext,
    );
    expect(issuedResponse.status).toBe(201);
    const issued = IssueDisplayTokenResponseSchema.parse(
      await json(issuedResponse),
    );

    const displayed = await handler.fetch!(
      workerRequest(
        new Request(
          `https://198.51.100.31/api/v1/meetings/${FLAGSHIP_MEETING_ID}/display?token=${encodeURIComponent(issued.displayToken)}`,
        ),
      ),
      workerEnv(),
      {} as ExecutionContext,
    );
    expect(displayed.status).toBe(200);
    const displayedBody = SharedDisplayProjectionResponseSchema.parse(
      await json(displayed),
    );
    expect(displayedBody.meeting.meetingId).toBe(FLAGSHIP_MEETING_ID);
    expect(JSON.stringify(displayedBody)).not.toContain("privateWorkspace");

    const revoke = await handler.fetch!(
      workerRequest(
        new Request(
          `https://198.51.100.31/api/v1/meetings/${FLAGSHIP_MEETING_ID}/display-tokens/revoke`,
          {
            body: JSON.stringify({
              displayTokenId: issued.displayTokenId,
              expectedPosition: issued.position,
              meetingId: FLAGSHIP_MEETING_ID,
            }),
            headers: {
              ...facilitatorAuthorization,
              "content-type": "application/json",
            },
            method: "POST",
          },
        ),
      ),
      workerEnv(),
      {} as ExecutionContext,
    );
    expect(revoke.status).toBe(200);
    expect(
      RevokeDisplayTokenResponseSchema.parse(await json(revoke)),
    ).toMatchObject({
      displayTokenId: issued.displayTokenId,
    });

    const revoked = await handler.fetch!(
      workerRequest(
        new Request(
          `https://198.51.100.31/api/v1/meetings/${FLAGSHIP_MEETING_ID}/display?token=${encodeURIComponent(issued.displayToken)}`,
        ),
      ),
      workerEnv(),
      {} as ExecutionContext,
    );
    expect(revoked.status).toBe(401);
    await expect(json(revoked)).resolves.toMatchObject({
      code: "DISPLAY_TOKEN_EXPIRED",
    });
  }, 15_000);

  it("connects deterministic AI-preferred disclosure and Decision paths", async () => {
    const handler = providerFreeWorkerHandler();
    const loginResponse = await handler.fetch!(
      workerRequest(
        new Request("https://192.0.2.20/api/v1/login", {
          body: JSON.stringify({
            password: "counterpoint-product",
            userId: "product",
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
      ),
      workerEnv(),
      {} as ExecutionContext,
    );
    const loginBody = await json(loginResponse);
    const authorization = {
      authorization: `Bearer ${String(loginBody.bearerToken)}`,
    };
    const resetResponse = await handler.fetch!(
      workerRequest(
        new Request(
          `https://192.0.2.20/api/v1/meetings/${FLAGSHIP_MEETING_ID}/demo/reset`,
          {
            body: JSON.stringify({
              expectedPosition: 0,
              idempotencyKey: "worker-ai-preferred-reset",
              meetingId: FLAGSHIP_MEETING_ID,
            }),
            headers: { ...authorization, "content-type": "application/json" },
            method: "POST",
          },
        ),
      ),
      workerEnv(),
      {} as ExecutionContext,
    );
    expect(resetResponse.status).toBe(200);

    const sourceText = "The approval gate is required before launch.";
    const sourceResponse = await handler.fetch!(
      workerRequest(
        new Request("https://192.0.2.20/api/v1/disclosures/sources/text", {
          body: JSON.stringify({
            expectedPosition: 0,
            idempotencyKey: "worker-ai-preferred-source",
            meetingId: FLAGSHIP_MEETING_ID,
            text: sourceText,
            title: "AI preferred smoke source",
          }),
          headers: { ...authorization, "content-type": "application/json" },
          method: "POST",
        }),
      ),
      workerEnv(),
      {} as ExecutionContext,
    );
    const sourceBody = RegisterPrivateTextSourceFixtureResponseSchema.parse(
      await json(sourceResponse),
    );
    const proposalResponse = await handler.fetch!(
      workerRequest(
        new Request("https://192.0.2.20/api/v1/disclosures/proposals", {
          body: JSON.stringify({
            assistance: "ai_preferred",
            exactSnippet: "placeholder",
            expectedPosition: sourceBody.position,
            idempotencyKey: "worker-ai-preferred-proposal",
            meetingId: FLAGSHIP_MEETING_ID,
            sourceArtifactId: sourceBody.source.sourceArtifactId,
            sourceRange: { end: 11, start: 0 },
          }),
          headers: { ...authorization, "content-type": "application/json" },
          method: "POST",
        }),
      ),
      workerEnv(),
      {} as ExecutionContext,
    );
    expect(proposalResponse.status).toBe(201);
    const proposalBody = ProposeDisclosureResponseSchema.parse(
      await json(proposalResponse),
    );
    expect(proposalBody.origin).toBe("ai_assisted");
    expect(proposalBody.candidate.outgoingPayload.exactSnippet).toBe(
      sourceText,
    );

    const previewResponse = await handler.fetch!(
      workerRequest(
        new Request("https://192.0.2.20/api/v1/disclosures/preview", {
          body: JSON.stringify({
            candidateId: proposalBody.candidate.candidateId,
            exactSnippet: sourceText,
            expectedPosition: proposalBody.position,
            idempotencyKey: "worker-ai-preferred-preview",
            meetingId: FLAGSHIP_MEETING_ID,
            sourceRange: proposalBody.candidate.outgoingPayload.sourceRange,
          }),
          headers: { ...authorization, "content-type": "application/json" },
          method: "POST",
        }),
      ),
      workerEnv(),
      {} as ExecutionContext,
    );
    const previewBody = PreviewDisclosureResponseSchema.parse(
      await json(previewResponse),
    );
    const approvalResponse = await handler.fetch!(
      workerRequest(
        new Request("https://192.0.2.20/api/v1/disclosures/approve", {
          body: JSON.stringify({
            candidateId: proposalBody.candidate.candidateId,
            expectedPosition: previewBody.position,
            idempotencyKey: "worker-ai-preferred-approval",
            meetingId: FLAGSHIP_MEETING_ID,
            previewHash: previewBody.previewHash,
          }),
          headers: { ...authorization, "content-type": "application/json" },
          method: "POST",
        }),
      ),
      workerEnv(),
      {} as ExecutionContext,
    );
    expect(approvalResponse.status).toBe(200);
    const approvalBody = ApproveDisclosureResponseSchema.parse(
      await json(approvalResponse),
    );

    const candidateResponse = await handler.fetch!(
      workerRequest(
        new Request("https://192.0.2.20/api/v1/decisions/candidates", {
          body: JSON.stringify({
            assistance: "ai_preferred",
            expectedPosition: approvalBody.position,
            idempotencyKey: "worker-ai-preferred-candidate",
            meetingId: FLAGSHIP_MEETING_ID,
          }),
          headers: { ...authorization, "content-type": "application/json" },
          method: "POST",
        }),
      ),
      workerEnv(),
      {} as ExecutionContext,
    );
    expect(candidateResponse.status).toBe(201);
    const candidateBody = SynthesizeSharedDecisionResponseSchema.parse(
      await json(candidateResponse),
    );
    expect(candidateBody.candidate.provenance.origin).toBe("ai_assisted");
    expect(candidateBody.candidate.draft.premiseCandidates[0]).toBeDefined();

    const finalResetResponse = await handler.fetch!(
      workerRequest(
        new Request(
          `https://192.0.2.20/api/v1/meetings/${FLAGSHIP_MEETING_ID}/demo/reset`,
          {
            body: JSON.stringify({
              expectedPosition: candidateBody.position,
              idempotencyKey: "worker-ai-preferred-final-reset",
              meetingId: FLAGSHIP_MEETING_ID,
            }),
            headers: { ...authorization, "content-type": "application/json" },
            method: "POST",
          },
        ),
      ),
      workerEnv(),
      {} as ExecutionContext,
    );
    expect(finalResetResponse.status).toBe(200);
  }, 15_000);

  it("keeps hosted private sources and facilitator mutations owner-scoped", async () => {
    const handler = createWorkerHandler();
    async function login(userId: string, password: string): Promise<string> {
      const response = await handler.fetch!(
        workerRequest(
          new Request("https://198.51.100.20/api/v1/login", {
            body: JSON.stringify({ password, userId }),
            headers: { "content-type": "application/json" },
            method: "POST",
          }),
        ),
        workerEnv(),
        {} as ExecutionContext,
      );
      expect(response.status).toBe(200);
      const body = await json(response);
      return String(body.bearerToken);
    }

    const facilitatorToken = await login("product", "counterpoint-product");
    const participantToken = await login("safety", "counterpoint-safety");
    const facilitatorAuthorization = {
      authorization: `Bearer ${facilitatorToken}`,
    };
    const participantAuthorization = {
      authorization: `Bearer ${participantToken}`,
    };

    const resetResponse = await handler.fetch!(
      workerRequest(
        new Request(
          `https://198.51.100.20/api/v1/meetings/${FLAGSHIP_MEETING_ID}/demo/reset`,
          {
            body: JSON.stringify({
              expectedPosition: 0,
              idempotencyKey: "worker-hosted-c5-reset",
              meetingId: FLAGSHIP_MEETING_ID,
            }),
            headers: {
              ...facilitatorAuthorization,
              "content-type": "application/json",
            },
            method: "POST",
          },
        ),
      ),
      workerEnv(),
      {} as ExecutionContext,
    );
    expect(resetResponse.status).toBe(200);

    const sourceResponse = await handler.fetch!(
      workerRequest(
        new Request("https://198.51.100.20/api/v1/disclosures/sources/text", {
          body: JSON.stringify({
            expectedPosition: 0,
            idempotencyKey: "worker-hosted-c5-private-source",
            meetingId: FLAGSHIP_MEETING_ID,
            text: "Facilitator-private C5 source.",
            title: "Hosted C5 private source",
          }),
          headers: {
            ...facilitatorAuthorization,
            "content-type": "application/json",
          },
          method: "POST",
        }),
      ),
      workerEnv(),
      {} as ExecutionContext,
    );
    expect(sourceResponse.status).toBe(201);
    const sourceBody = RegisterPrivateTextSourceFixtureResponseSchema.parse(
      await json(sourceResponse),
    );

    const participantProjectionResponse = await handler.fetch!(
      workerRequest(
        new Request(
          `https://198.51.100.20/api/v1/meetings/${FLAGSHIP_MEETING_ID}/projection`,
          { headers: participantAuthorization, method: "GET" },
        ),
      ),
      workerEnv(),
      {} as ExecutionContext,
    );
    expect(participantProjectionResponse.status).toBe(200);
    await expect(json(participantProjectionResponse)).resolves.toMatchObject({
      privateWorkspace: { sources: [] },
    });

    const participantProposalResponse = await handler.fetch!(
      workerRequest(
        new Request("https://198.51.100.20/api/v1/disclosures/proposals", {
          body: JSON.stringify({
            assistance: "manual",
            exactSnippet: "Facilitator-private C5 source.",
            expectedPosition: sourceBody.position,
            idempotencyKey: "worker-hosted-c5-cross-owner-proposal",
            meetingId: FLAGSHIP_MEETING_ID,
            sourceArtifactId: sourceBody.source.sourceArtifactId,
            sourceRange: { end: 30, start: 0 },
          }),
          headers: {
            ...participantAuthorization,
            "content-type": "application/json",
          },
          method: "POST",
        }),
      ),
      workerEnv(),
      {} as ExecutionContext,
    );
    expect(participantProposalResponse.status).toBe(403);
    await expect(json(participantProposalResponse)).resolves.toMatchObject({
      code: "FORBIDDEN",
    });

    const participantEventResponse = await handler.fetch!(
      workerRequest(
        new Request(
          `https://198.51.100.20/api/v1/meetings/${FLAGSHIP_MEETING_ID}/demo/regulatory-changes`,
          {
            body: JSON.stringify({
              idempotencyKey: "worker-hosted-c5-participant-event",
            }),
            headers: {
              ...participantAuthorization,
              "content-type": "application/json",
            },
            method: "POST",
          },
        ),
      ),
      workerEnv(),
      {} as ExecutionContext,
    );
    expect(participantEventResponse.status).toBe(403);
    await expect(json(participantEventResponse)).resolves.toMatchObject({
      code: "FORBIDDEN",
    });
  }, 15_000);
});

describe("Cloudflare Worker judge structured-AI gate", () => {
  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM judge_managed_ai_operation_claims").run();
    await env.DB.prepare("DELETE FROM judge_usage_reservations").run();
  });

  it("captures private text through the Worker with replay and owner-only projection semantics", async () => {
    const handler = createWorkerHandler();
    const environment = workerEnv();
    const bearerToken = await login(handler, environment);
    const authorization = `Bearer ${bearerToken}`;
    await resetFlagship({
      authorization,
      environment,
      handler,
      idempotencyKey: `worker-private-utterance-reset-${crypto.randomUUID()}`,
    });

    const utterance = {
      capturedAt: "2026-07-20T12:34:56.000Z",
      channel: "private" as const,
      meetingId: FLAGSHIP_MEETING_ID,
      text: "Private Worker text remains durable without a provider.",
      utteranceId: `utterance-worker-private-${crypto.randomUUID()}`,
    };
    const captureRequest = (body: object, meetingId = FLAGSHIP_MEETING_ID) =>
      handler.fetch!(
        workerRequest(
          new Request(
            `https://203.0.113.40/api/v1/meetings/${meetingId}/utterances`,
            {
              body: JSON.stringify(body),
              headers: {
                authorization,
                "content-type": "application/json",
              },
              method: "POST",
            },
          ),
        ),
        environment,
        {} as ExecutionContext,
      );

    const mismatchResponse = await captureRequest(
      utterance,
      "meeting-path-mismatch",
    );
    expect(mismatchResponse.status).toBe(400);
    await expect(json(mismatchResponse)).resolves.toMatchObject({
      code: "VALIDATION_FAILED",
    });

    const firstResponse = await captureRequest(utterance);
    expect(firstResponse.status).toBe(201);
    const first = CaptureUtteranceResponseSchema.parse(
      await json(firstResponse),
    );
    expect(first).toMatchObject({
      meetingId: FLAGSHIP_MEETING_ID,
      replayed: false,
      utterance: {
        channel: "private",
        participantId: "participant-product",
        text: utterance.text,
        utteranceId: utterance.utteranceId,
      },
    });
    expect(first.position).toBeGreaterThan(0);

    const replayResponse = await captureRequest(utterance);
    expect(replayResponse.status).toBe(200);
    const replay = CaptureUtteranceResponseSchema.parse(
      await json(replayResponse),
    );
    expect(replay).toEqual({ ...first, replayed: true });

    const conflictResponse = await captureRequest({
      ...utterance,
      text: "Changed text cannot reuse the utterance id.",
    });
    expect(conflictResponse.status).toBe(409);
    await expect(json(conflictResponse)).resolves.toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
    });

    const ownerProjectionResponse = await handler.fetch!(
      workerRequest(
        new Request(
          `https://203.0.113.40/api/v1/meetings/${FLAGSHIP_MEETING_ID}/projection`,
          {
            headers: { authorization },
            method: "GET",
          },
        ),
      ),
      environment,
      {} as ExecutionContext,
    );
    expect(ownerProjectionResponse.status).toBe(200);
    const ownerProjection = await json(ownerProjectionResponse);
    expect(ownerProjection).toMatchObject({
      privateWorkspace: {
        utterances: [
          expect.objectContaining({
            text: utterance.text,
            utteranceId: utterance.utteranceId,
          }),
        ],
      },
      shared: { position: first.position, utterances: [] },
    });

    const participantToken = await login(
      handler,
      environment,
      "safety",
      "counterpoint-safety",
    );
    const participantProjectionResponse = await handler.fetch!(
      workerRequest(
        new Request(
          `https://203.0.113.40/api/v1/meetings/${FLAGSHIP_MEETING_ID}/projection`,
          {
            headers: { authorization: `Bearer ${participantToken}` },
            method: "GET",
          },
        ),
      ),
      environment,
      {} as ExecutionContext,
    );
    expect(participantProjectionResponse.status).toBe(200);
    const participantProjection = await json(participantProjectionResponse);
    expect(participantProjection).toMatchObject({
      privateWorkspace: { utterances: [] },
      shared: { utterances: [] },
    });
    expect(
      (participantProjection.shared as { position: number }).position,
    ).toBeLessThan(first.position);
  });

  it("settles metered judge usage without persisting private content", async () => {
    const proposer = {
      propose: vi.fn(
        (input: { readonly sourceArtifactId: string; readonly text: string }) =>
          Promise.resolve(meteredProposal(input.sourceArtifactId, input.text)),
      ),
    };
    const handler = createWorkerHandler({
      judgePrivateDisclosureProposer: proposer,
    });
    const environment = judgeWorkerEnv();
    const bearerToken = await login(handler, environment);
    const authorization = `Bearer ${bearerToken}`;
    await resetFlagship({
      authorization,
      environment,
      handler,
      idempotencyKey: "judge-structured-success-reset",
    });
    const privateText = "Confidential rollout constraint for the judge.";
    const source = await registerSource({
      authorization,
      environment,
      handler,
      idempotencyKey: "judge-structured-success-source",
      text: privateText,
    });

    const response = await handler.fetch!(
      workerRequest(
        proposeRequest({
          authorization,
          expectedPosition: source.position,
          idempotencyKey: "judge-structured-success-proposal",
          sourceArtifactId: source.sourceArtifactId,
        }),
      ),
      environment,
      {} as ExecutionContext,
    );

    const responseBody = await json(response);
    expect({ body: responseBody, status: response.status }).toMatchObject({
      status: 201,
    });
    expect(proposer.propose).toHaveBeenCalledTimes(1);
    const replay = await handler.fetch!(
      workerRequest(
        proposeRequest({
          authorization,
          expectedPosition: source.position,
          idempotencyKey: "judge-structured-success-proposal",
          sourceArtifactId: source.sourceArtifactId,
        }),
      ),
      environment,
      {} as ExecutionContext,
    );
    expect(replay.status).toBe(201);
    await expect(json(replay)).resolves.toMatchObject({
      candidate: responseBody.candidate,
    });
    expect(proposer.propose).toHaveBeenCalledTimes(1);
    await expect(
      env.DB.prepare(
        `
          SELECT COUNT(*) AS count
          FROM judge_usage_reservations
          WHERE operation = 'private_evidence_disclosure'
        `,
      ).first<{ count: number }>(),
    ).resolves.toMatchObject({ count: 1 });
    const reservation = await env.DB.prepare(
      `
        SELECT *
        FROM judge_usage_reservations
        WHERE operation = 'private_evidence_disclosure'
      `,
    ).first<Record<string, unknown>>();
    expect(reservation).toMatchObject({
      actual_cost_micro_usd: 1200,
      actual_generation_count: 1,
      actual_input_tokens: 120,
      actual_output_tokens: 20,
      operation: "private_evidence_disclosure",
      status: "finalized",
    });
    expect(reservation?.ip_hash).toMatch(/^hmac-sha256:[a-f0-9]{64}$/u);
    const lifecycle = await env.DB.prepare(
      `
        SELECT
          provider_started_at_epoch,
          settled_at_epoch,
          status
        FROM judge_managed_ai_operation_lifecycle
      `,
    ).first<Record<string, unknown>>();
    expect(lifecycle).toMatchObject({
      status: "settled",
    });
    expect(lifecycle?.provider_started_at_epoch).toEqual(expect.any(Number));
    expect(lifecycle?.settled_at_epoch).toEqual(expect.any(Number));

    const claims = await env.DB.prepare(
      "SELECT * FROM judge_managed_ai_operation_claims",
    ).all<Record<string, unknown>>();
    const rows = JSON.stringify([...claims.results, reservation]);
    expect(rows).not.toContain(privateText);
    expect(rows).not.toContain(source.sourceArtifactId);
    expect(rows).not.toContain("test-only-never-sent");
  });

  it("shares content-free D1 claims and actual settlement across all three operations", async () => {
    let notifyDecisionStarted!: () => void;
    const decisionStarted = new Promise<void>((resolve) => {
      notifyDecisionStarted = resolve;
    });
    let releaseDecision!: () => void;
    const decisionBlocked = new Promise<void>((resolve) => {
      releaseDecision = resolve;
    });
    let notifyInvalidationStarted!: () => void;
    const invalidationStarted = new Promise<void>((resolve) => {
      notifyInvalidationStarted = resolve;
    });
    let releaseInvalidation!: () => void;
    const invalidationBlocked = new Promise<void>((resolve) => {
      releaseInvalidation = resolve;
    });
    const proposer = {
      propose: vi.fn(
        (input: { readonly sourceArtifactId: string; readonly text: string }) =>
          Promise.resolve(meteredProposal(input.sourceArtifactId, input.text)),
      ),
    };
    const synthesizer = {
      synthesize: vi.fn(async (input: SharedDecisionSynthesisInput) => {
        notifyDecisionStarted();
        await decisionBlocked;
        return meteredDecision(input);
      }),
    };
    const evaluator = {
      evaluate: vi.fn(async (input: AssumptionInvalidationEvaluationInput) => {
        notifyInvalidationStarted();
        await invalidationBlocked;
        const { billing: _billing, ...evaluation } = meteredInvalidation(input);
        void _billing;
        return evaluation;
      }),
    };
    const handler = createWorkerHandler({
      judgeAssumptionInvalidationEvaluator: evaluator,
      judgePrivateDisclosureProposer: proposer,
      judgeSharedDecisionSynthesizer: synthesizer,
    });
    const environment = judgeWorkerEnv();
    const authorization = `Bearer ${await login(handler, environment)}`;
    const post = async (path: string, body: unknown) =>
      handler.fetch!(
        workerRequest(
          new Request(`https://203.0.113.40${path}`, {
            body: JSON.stringify(body),
            headers: {
              authorization,
              "CF-Connecting-IP": "203.0.113.40",
              "content-type": "application/json",
            },
            method: "POST",
          }),
        ),
        environment,
        {} as ExecutionContext,
      );
    await resetFlagship({
      authorization,
      environment,
      handler,
      idempotencyKey: "judge-all-operations-reset",
    });

    const privateText =
      "Confidential staged rollout constraint for all-operation proof.";
    const source = await registerSource({
      authorization,
      environment,
      handler,
      idempotencyKey: "judge-all-operations-source",
      text: privateText,
    });
    const proposalResponse = await handler.fetch!(
      workerRequest(
        proposeRequest({
          authorization,
          expectedPosition: source.position,
          idempotencyKey: "judge-all-operations-proposal",
          sourceArtifactId: source.sourceArtifactId,
          sourceText: privateText,
        }),
      ),
      environment,
      {} as ExecutionContext,
    );
    expect(proposalResponse.status).toBe(201);
    const proposal = ProposeDisclosureResponseSchema.parse(
      await json(proposalResponse),
    );
    const previewResponse = await post("/api/v1/disclosures/preview", {
      candidateId: proposal.candidate.candidateId,
      exactSnippet: proposal.candidate.outgoingPayload.exactSnippet,
      expectedPosition: proposal.position,
      idempotencyKey: "judge-all-operations-preview",
      meetingId: FLAGSHIP_MEETING_ID,
      sourceRange: proposal.candidate.outgoingPayload.sourceRange,
    });
    expect(previewResponse.status).toBe(200);
    const preview = PreviewDisclosureResponseSchema.parse(
      await json(previewResponse),
    );
    const approvalResponse = await post("/api/v1/disclosures/approve", {
      candidateId: proposal.candidate.candidateId,
      expectedPosition: preview.position,
      idempotencyKey: "judge-all-operations-approval",
      meetingId: FLAGSHIP_MEETING_ID,
      previewHash: preview.previewHash,
    });
    expect(approvalResponse.status).toBe(200);
    const approval = ApproveDisclosureResponseSchema.parse(
      await json(approvalResponse),
    );

    const decisionRequest = {
      assistance: "ai_preferred",
      expectedPosition: approval.position,
      idempotencyKey: "judge-all-operations-decision",
      meetingId: FLAGSHIP_MEETING_ID,
    } as const;
    const decisionConflictIdempotencyKey =
      "judge-all-operations-decision-conflict";
    const decisionConflictClaimKey = await fingerprintJudgeStructuredInput({
      idempotencyKey: decisionConflictIdempotencyKey,
      meetingId: FLAGSHIP_MEETING_ID,
      operation: "shared_decision_synthesis",
    });
    const nowEpoch = Math.floor(Date.now() / 1_000);
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO judge_managed_ai_operation_claims (
             claim_key_hash,
             request_fingerprint,
             operation,
             model,
             pricing_version,
             created_at_epoch,
             expires_at_epoch
           ) VALUES (?, ?, 'shared_decision_synthesis', 'gpt-5.6', ?, ?, ?)`,
      ).bind(
        decisionConflictClaimKey,
        `sha256:${"d".repeat(64)}`,
        "conflicting-pricing-v1",
        nowEpoch,
        nowEpoch + 120,
      ),
      env.DB.prepare(
        `INSERT INTO judge_managed_ai_operation_lifecycle (
             claim_key_hash,
             status
           ) VALUES (?, 'legacy_blocked')`,
      ).bind(decisionConflictClaimKey),
    ]);
    const decisionConflict = await post("/api/v1/decisions/candidates", {
      ...decisionRequest,
      idempotencyKey: decisionConflictIdempotencyKey,
    });
    expect(decisionConflict.status).toBe(409);
    await expect(json(decisionConflict)).resolves.toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
    });
    expect(synthesizer.synthesize).not.toHaveBeenCalled();

    const decisionResponsePromise = post(
      "/api/v1/decisions/candidates",
      decisionRequest,
    );
    await decisionStarted;
    const concurrentDecision = await post(
      "/api/v1/decisions/candidates",
      decisionRequest,
    );
    expect(concurrentDecision.status).toBe(503);
    await expect(json(concurrentDecision)).resolves.toMatchObject({
      code: "OPENAI_UNAVAILABLE",
    });
    expect(synthesizer.synthesize).toHaveBeenCalledTimes(1);
    releaseDecision();
    const decisionResponse = await decisionResponsePromise;
    expect(decisionResponse.status).toBe(201);
    const decisionCandidate = SynthesizeSharedDecisionResponseSchema.parse(
      await json(decisionResponse),
    );
    const decisionReplay = await post(
      "/api/v1/decisions/candidates",
      decisionRequest,
    );
    expect(decisionReplay.status).toBe(201);
    await expect(json(decisionReplay)).resolves.toMatchObject({
      candidate: decisionCandidate.candidate,
    });
    expect(synthesizer.synthesize).toHaveBeenCalledTimes(1);

    const premiseCandidate =
      decisionCandidate.candidate.draft.premiseCandidates[0];
    const actionCandidate =
      decisionCandidate.candidate.draft.actionCandidates[0];
    if (premiseCandidate === undefined || actionCandidate === undefined) {
      throw new Error("Managed Decision did not contain premise and Action.");
    }
    const dispositionRequest =
      DispositionSharedDecisionCandidateRequestSchema.parse({
        actions: [
          {
            ownerParticipantId: actionCandidate.ownerParticipantId,
            scope: actionCandidate.scope,
          },
        ],
        candidateId: decisionCandidate.candidate.candidateId,
        dissent: decisionCandidate.candidate.draft.dissentCandidates.map(
          ({ reason, retained }) => ({ reason, retained }),
        ),
        expectedPosition: decisionCandidate.position,
        idempotencyKey: "judge-all-operations-disposition",
        meetingId: FLAGSHIP_MEETING_ID,
        monitorCondition: decisionCandidate.candidate.draft.monitorCondition,
        outcome: decisionCandidate.candidate.draft.outcome,
        premiseDispositions: [
          {
            candidateId: premiseCandidate.candidateId,
            disposition: "confirmed",
            premise: {
              evidenceReferenceIds: [approval.evidence.evidenceId],
              statement: premiseCandidate.statement,
            },
          },
        ],
        reason: "Facilitator accepted the metered Decision candidate.",
        title: decisionCandidate.candidate.draft.title,
      });
    const dispositionResponse = await post(
      "/api/v1/decisions/candidates/disposition",
      dispositionRequest,
    );
    const dispositionJson = await json(dispositionResponse);
    if (dispositionResponse.status !== 200) {
      throw new Error(JSON.stringify(dispositionJson));
    }
    expect({
      body: dispositionJson,
      status: dispositionResponse.status,
    }).toMatchObject({ status: 200 });
    const disposition =
      DispositionSharedDecisionCandidateResponseSchema.parse(dispositionJson);
    const premise = disposition.premises[0];
    const action = disposition.actions[0];
    if (premise === undefined || action === undefined) {
      throw new Error("Decision disposition did not materialize state.");
    }
    const draftResponse = await post("/api/v1/decisions/drafts", {
      actionIds: [action.actionId],
      changeReason: "Create monitored Decision for invalidation proof.",
      dissentIds: [],
      evidenceIds: [approval.evidence.evidenceId],
      expectedPosition: disposition.position,
      idempotencyKey: "judge-all-operations-draft",
      meetingId: FLAGSHIP_MEETING_ID,
      monitorCondition: decisionCandidate.candidate.draft.monitorCondition,
      outcome: decisionCandidate.candidate.draft.outcome,
      premiseIds: [premise.premiseId],
      title: decisionCandidate.candidate.draft.title,
    });
    expect(draftResponse.status).toBe(201);
    const draft = SaveDecisionDraftResponseSchema.parse(
      await json(draftResponse),
    );
    const readyResponse = await post("/api/v1/decisions/ready", {
      decisionId: draft.decision.decisionId,
      expectedPosition: draft.position,
      idempotencyKey: "judge-all-operations-ready",
      meetingId: FLAGSHIP_MEETING_ID,
    });
    expect(readyResponse.status).toBe(200);
    const ready = MarkDecisionReadyResponseSchema.parse(
      await json(readyResponse),
    );
    const commitResponse = await post("/api/v1/decisions/commit", {
      decisionId: ready.decision.decisionId,
      expectedPosition: ready.position,
      idempotencyKey: "judge-all-operations-commit",
      meetingId: FLAGSHIP_MEETING_ID,
    });
    expect(commitResponse.status).toBe(200);
    const commit = CommitDecisionResponseSchema.parse(
      await json(commitResponse),
    );
    const monitoringResponse = await post("/api/v1/decisions/monitoring", {
      decisionId: commit.decision.decisionId,
      expectedPosition: commit.position,
      idempotencyKey: "judge-all-operations-monitoring",
      meetingId: FLAGSHIP_MEETING_ID,
    });
    expect(monitoringResponse.status).toBe(200);

    const invalidationConflictIdempotencyKey =
      "judge-all-operations-event-conflict";
    const invalidationConflictEventId = `demo-regulator:${invalidationConflictIdempotencyKey}`;
    const invalidationConflictClaimKey = await fingerprintJudgeStructuredInput({
      externalEventId: invalidationConflictEventId,
      meetingId: FLAGSHIP_MEETING_ID,
      operation: "assumption_invalidation",
      revisionId: commit.decision.activeRevisionId,
    });
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO judge_managed_ai_operation_claims (
             claim_key_hash,
             request_fingerprint,
             operation,
             model,
             pricing_version,
             created_at_epoch,
             expires_at_epoch
           ) VALUES (?, ?, 'assumption_invalidation', 'gpt-5.6', ?, ?, ?)`,
      ).bind(
        invalidationConflictClaimKey,
        `sha256:${"e".repeat(64)}`,
        "conflicting-pricing-v1",
        nowEpoch,
        nowEpoch + 120,
      ),
      env.DB.prepare(
        `INSERT INTO judge_managed_ai_operation_lifecycle (
             claim_key_hash,
             status
           ) VALUES (?, 'legacy_blocked')`,
      ).bind(invalidationConflictClaimKey),
    ]);
    const eventPath = `/api/v1/meetings/${FLAGSHIP_MEETING_ID}/demo/regulatory-changes`;
    const invalidationConflict = await post(eventPath, {
      idempotencyKey: invalidationConflictIdempotencyKey,
    });
    expect(invalidationConflict.status).toBe(202);
    await expect(json(invalidationConflict)).resolves.toMatchObject({
      evaluationStatus: "pending",
      receiptStatus: "received",
    });
    expect(evaluator.evaluate).not.toHaveBeenCalled();

    const eventRequest = {
      idempotencyKey: "judge-all-operations-event",
    };
    const eventResponsePromise = post(eventPath, eventRequest);
    await invalidationStarted;
    const concurrentEvent = await post(eventPath, eventRequest);
    expect(concurrentEvent.status).toBe(202);
    await expect(json(concurrentEvent)).resolves.toMatchObject({
      evaluationStatus: "pending",
      receiptStatus: "received",
    });
    expect(evaluator.evaluate).toHaveBeenCalledTimes(1);
    releaseInvalidation();
    const eventResponse = await eventResponsePromise;
    expect(eventResponse.status).toBe(202);
    const event = InjectDemoRegulatoryChangeResponseSchema.parse(
      await json(eventResponse),
    );
    expect(evaluator.evaluate).toHaveBeenCalledTimes(1);
    expect(event.evaluationStatus).toBe("pending");
    const evaluationsResponse = await handler.fetch!(
      workerRequest(
        new Request(
          `https://203.0.113.40/api/v1/meetings/${FLAGSHIP_MEETING_ID}/invalidation-evaluations`,
          {
            headers: {
              authorization,
              "CF-Connecting-IP": "203.0.113.40",
            },
            method: "GET",
          },
        ),
      ),
      environment,
      {} as ExecutionContext,
    );
    expect(evaluationsResponse.status).toBe(200);
    const evaluations = ListInvalidationEvaluationsResponseSchema.parse(
      await json(evaluationsResponse),
    );
    expect(evaluations.evaluations).toEqual([
      expect.objectContaining({
        externalEventId: event.event.eventId,
        operation: "assumption_invalidation",
      }),
    ]);
    const eventReplay = await post(eventPath, eventRequest);
    const eventReplayJson = await json(eventReplay);
    expect(eventReplay.status).toBe(202);
    expect(eventReplayJson).toMatchObject({
      event: { eventId: event.event.eventId },
    });
    expect(evaluator.evaluate).toHaveBeenCalledTimes(1);

    const reservations = await env.DB.prepare(
      `
        SELECT *
        FROM judge_usage_reservations
        ORDER BY operation ASC
      `,
    ).all<Record<string, unknown>>();
    expect(
      reservations.results.map((row) => ({
        actualCostMicroUsd: row.actual_cost_micro_usd,
        actualGenerationCount: row.actual_generation_count,
        operation: row.operation,
        status: row.status,
      })),
    ).toEqual([
      {
        actualCostMicroUsd: 5_500_000,
        actualGenerationCount: 2,
        operation: "assumption_invalidation",
        status: "finalized",
      },
      {
        actualCostMicroUsd: 1200,
        actualGenerationCount: 1,
        operation: "private_evidence_disclosure",
        status: "finalized",
      },
      {
        actualCostMicroUsd: 2400,
        actualGenerationCount: 1,
        operation: "shared_decision_synthesis",
        status: "finalized",
      },
    ]);
    await expect(
      env.DB.prepare(
        `
          SELECT COUNT(*) AS count
          FROM judge_managed_ai_operation_lifecycle
          WHERE status = 'settled'
        `,
      ).first<{ count: number }>(),
    ).resolves.toMatchObject({ count: 3 });
    const claims = await env.DB.prepare(
      `
        SELECT claims.*, lifecycle.*
        FROM judge_managed_ai_operation_claims AS claims
        JOIN judge_managed_ai_operation_lifecycle AS lifecycle
          USING (claim_key_hash)
        ORDER BY claims.operation, claims.claim_key_hash
      `,
    ).all<Record<string, unknown>>();
    const claimStates = claims.results.map(({ operation, status }) => ({
      operation,
      status,
    }));
    expect(claimStates).toHaveLength(5);
    expect(claimStates).toEqual(
      expect.arrayContaining([
        { operation: "assumption_invalidation", status: "legacy_blocked" },
        { operation: "assumption_invalidation", status: "settled" },
        { operation: "private_evidence_disclosure", status: "settled" },
        { operation: "shared_decision_synthesis", status: "legacy_blocked" },
        { operation: "shared_decision_synthesis", status: "settled" },
      ]),
    );
    const durableRows = JSON.stringify([
      ...reservations.results,
      ...claims.results,
    ]);
    expect(durableRows).not.toContain(privateText);
    expect(durableRows).not.toContain(source.sourceArtifactId);
    expect(durableRows).not.toContain(
      decisionCandidate.candidate.draft.outcome,
    );
    expect(durableRows).not.toContain("regulatory_change");
    expect(durableRows).not.toContain("test-only-never-sent");
    expect(durableRows).not.toContain("203.0.113.40");
    expect(proposer.propose).toHaveBeenCalledTimes(1);
  }, 20_000);

  it("suppresses a concurrent duplicate and conflicts changed source identity or content", async () => {
    let releaseProvider!: () => void;
    const providerBlocked = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    let markProviderStarted!: () => void;
    const providerStarted = new Promise<void>((resolve) => {
      markProviderStarted = resolve;
    });
    const proposer = {
      propose: vi.fn(
        async (input: {
          readonly sourceArtifactId: string;
          readonly text: string;
        }) => {
          markProviderStarted();
          await providerBlocked;
          return meteredProposal(input.sourceArtifactId, input.text);
        },
      ),
    };
    const handler = createWorkerHandler({
      judgePrivateDisclosureProposer: proposer,
    });
    const environment = judgeWorkerEnv();
    const authorization = `Bearer ${await login(handler, environment)}`;
    await resetFlagship({
      authorization,
      environment,
      handler,
      idempotencyKey: "judge-structured-duplicate-reset",
    });
    const firstSource = await registerSource({
      authorization,
      environment,
      handler,
      idempotencyKey: "judge-structured-duplicate-source",
      text: "First confidential source.",
    });
    const request = () =>
      workerRequest(
        proposeRequest({
          authorization,
          expectedPosition: firstSource.position,
          idempotencyKey: "judge-structured-duplicate-proposal",
          sourceArtifactId: firstSource.sourceArtifactId,
        }),
      );

    const first = handler.fetch!(
      request(),
      environment,
      {} as ExecutionContext,
    );
    try {
      await providerStarted;
      const duplicate = await handler.fetch!(
        request(),
        environment,
        {} as ExecutionContext,
      );
      expect(duplicate.status).toBe(503);
      await expect(json(duplicate)).resolves.toMatchObject({
        code: "OPENAI_UNAVAILABLE",
      });
    } finally {
      releaseProvider();
    }
    const firstResponse = await first;
    expect(firstResponse.status).toBe(201);
    const firstBody = await json(firstResponse);
    expect(proposer.propose).toHaveBeenCalledTimes(1);

    await environment.ARTIFACTS.put(
      `meetings/${FLAGSHIP_MEETING_ID}/private/participant-product/${firstSource.sourceArtifactId}`,
      new TextEncoder().encode("Changed bytes under the same artifact ID."),
    );
    const changedContent = await handler.fetch!(
      request(),
      environment,
      {} as ExecutionContext,
    );
    expect(changedContent.status).toBe(201);
    await expect(json(changedContent)).resolves.toMatchObject({
      candidate: firstBody.candidate,
    });
    expect(proposer.propose).toHaveBeenCalledTimes(1);

    const secondSource = await registerSource({
      authorization,
      environment,
      handler,
      idempotencyKey: "judge-structured-changed-source",
      text: "Second confidential source.",
    });
    const changed = await handler.fetch!(
      workerRequest(
        proposeRequest({
          authorization,
          expectedPosition: secondSource.position,
          idempotencyKey: "judge-structured-duplicate-proposal",
          sourceArtifactId: secondSource.sourceArtifactId,
        }),
      ),
      environment,
      {} as ExecutionContext,
    );
    expect(changed.status).toBe(409);
    await expect(json(changed)).resolves.toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
    });
    expect(proposer.propose).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      costMicroUsd: 25_000_000,
      generationCount: 0,
      label: "cost",
      limit: "cost",
      tokenCount: 0,
    },
    {
      costMicroUsd: 0,
      generationCount: 0,
      label: "tokens",
      limit: "tokens",
      tokenCount: 17_369_601,
    },
    {
      costMicroUsd: 0,
      generationCount: 65,
      label: "generations",
      limit: "generation",
      tokenCount: 0,
    },
  ] as const)(
    "denies exhausted $label managed work before the provider",
    async ({ costMicroUsd, generationCount, limit, tokenCount }) => {
      const proposer = {
        propose: vi.fn(
          (input: {
            readonly sourceArtifactId: string;
            readonly text: string;
          }) =>
            Promise.resolve(
              meteredProposal(input.sourceArtifactId, input.text),
            ),
        ),
      };
      const handler = createWorkerHandler({
        judgePrivateDisclosureProposer: proposer,
      });
      const environment = judgeWorkerEnv();
      const authorization = `Bearer ${await login(handler, environment)}`;
      await resetFlagship({
        authorization,
        environment,
        handler,
        idempotencyKey: "judge-structured-exhausted-reset",
      });
      const source = await registerSource({
        authorization,
        environment,
        handler,
        idempotencyKey: "judge-structured-exhausted-source",
        text: "Budget protected source.",
      });
      await env.DB.prepare(
        `
        INSERT INTO judge_usage_reservations (
          reservation_id,
          request_fingerprint,
          account_id,
          ip_hash,
          meeting_id,
          operation,
          model,
          pricing_version,
          reserved_cost_micro_usd,
          reserved_input_tokens,
          reserved_output_tokens,
          reserved_generation_count,
          reserved_realtime_seconds,
          actual_cost_micro_usd,
          actual_input_tokens,
          actual_output_tokens,
          actual_generation_count,
          actual_realtime_seconds,
          status,
          reserved_at_epoch,
          active_until_epoch,
          finalized_at_epoch
        ) VALUES (
          'exhausted-budget',
          'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          'product',
          'hmac-sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          ?,
          'test_budget',
          'test-model',
          'test-v1',
          ?,
          ?,
          0,
          ?,
          0,
          ?,
          ?,
          0,
          ?,
          0,
          'finalized',
          unixepoch(),
          unixepoch() + 120,
          unixepoch()
        )
      `,
      )
        .bind(
          FLAGSHIP_MEETING_ID,
          costMicroUsd,
          tokenCount,
          generationCount,
          costMicroUsd,
          tokenCount,
          generationCount,
        )
        .run();

      const exhausted = await handler.fetch!(
        workerRequest(
          proposeRequest({
            authorization,
            expectedPosition: source.position,
            idempotencyKey: "judge-structured-exhausted-proposal",
            sourceArtifactId: source.sourceArtifactId,
          }),
        ),
        environment,
        {} as ExecutionContext,
      );
      const exhaustedBody = await json(exhausted);
      expect({ body: exhaustedBody, status: exhausted.status }).toMatchObject({
        status: 429,
      });
      expect(exhaustedBody).toMatchObject({
        code: "USAGE_LIMIT_REACHED",
        details: { limit },
      });
      expect(proposer.propose).not.toHaveBeenCalled();

      if (limit !== "cost") {
        return;
      }
      const ordinaryEnvironment = judgeWorkerEnv({
        JUDGE_USER_ID: "product",
      });
      const ordinaryAuthorization = `Bearer ${await login(
        handler,
        ordinaryEnvironment,
        "safety",
        "counterpoint-safety",
      )}`;
      const ordinary = await handler.fetch!(
        workerRequest(
          proposeRequest({
            authorization: ordinaryAuthorization,
            expectedPosition: source.position,
            idempotencyKey: "judge-structured-ordinary-proposal",
            sourceArtifactId: source.sourceArtifactId,
          }),
        ),
        ordinaryEnvironment,
        {} as ExecutionContext,
      );
      expect(ordinary.status).toBe(403);
      await expect(json(ordinary)).resolves.toMatchObject({
        code: "JUDGE_MODE_FORBIDDEN",
      });
      expect(proposer.propose).not.toHaveBeenCalled();
    },
  );

  it("keeps manual work off the ledger and fails closed when live wiring is unsafe", async () => {
    const proposer = {
      propose: vi.fn(
        (input: { readonly sourceArtifactId: string; readonly text: string }) =>
          Promise.resolve(meteredProposal(input.sourceArtifactId, input.text)),
      ),
    };
    const handler = createWorkerHandler({
      judgePrivateDisclosureProposer: proposer,
    });
    const environment = judgeWorkerEnv();
    const authorization = `Bearer ${await login(handler, environment)}`;
    await resetFlagship({
      authorization,
      environment,
      handler,
      idempotencyKey: "judge-structured-manual-reset",
    });
    const sourceText = "Manual path remains provider-free.";
    const source = await registerSource({
      authorization,
      environment,
      handler,
      idempotencyKey: "judge-structured-manual-source",
      text: sourceText,
    });
    const manual = await handler.fetch!(
      workerRequest(
        new Request("https://203.0.113.40/api/v1/disclosures/proposals", {
          body: JSON.stringify({
            assistance: "manual",
            exactSnippet: sourceText,
            expectedPosition: source.position,
            idempotencyKey: "judge-structured-manual-proposal",
            meetingId: FLAGSHIP_MEETING_ID,
            sourceArtifactId: source.sourceArtifactId,
            sourceRange: { end: sourceText.length, start: 0 },
          }),
          headers: {
            authorization,
            "CF-Connecting-IP": "203.0.113.40",
            "content-type": "application/json",
          },
          method: "POST",
        }),
      ),
      environment,
      {} as ExecutionContext,
    );
    expect(manual.status).toBe(201);
    expect(proposer.propose).not.toHaveBeenCalled();
    await expect(
      env.DB.prepare(
        "SELECT COUNT(*) AS count FROM judge_usage_reservations",
      ).first<{ count: number }>(),
    ).resolves.toMatchObject({ count: 0 });
    await expect(
      env.DB.prepare(
        "SELECT COUNT(*) AS count FROM judge_managed_ai_operation_claims",
      ).first<{ count: number }>(),
    ).resolves.toMatchObject({ count: 0 });

    for (const unsafe of [
      {
        environment: judgeWorkerEnv({
          JUDGE_STRUCTURED_AI_ROUTE_ENABLED: "disabled",
          OPENAI_MODE: "disabled",
        }),
      },
      {
        environment: judgeWorkerEnv({
          JUDGE_STRUCTURED_AI_ROUTE_ENABLED: "disabled",
          OPENAI_MODE: "deterministic",
        }),
      },
      {
        environment: judgeWorkerEnv({
          OPENAI_MODE: "deterministic",
        }),
      },
      {
        environment: judgeWorkerEnv({
          JUDGE_IP_HMAC_SECRET: "short",
          OPENAI_MODE: "disabled",
        }),
      },
      {
        environment: judgeWorkerEnv({
          OPENAI_API_KEY_JUDGE: "",
          OPENAI_MODE: "disabled",
        }),
      },
      {
        environment: judgeWorkerEnv({
          JUDGE_USER_ID: "",
          OPENAI_MODE: "disabled",
        }),
      },
      {
        environment: judgeWorkerEnv({
          JUDGE_IP_HMAC_SECRET: "shared-secret-material",
          OPENAI_API_KEY_JUDGE: "shared-secret-material",
          OPENAI_MODE: "disabled",
        }),
      },
      {
        environment: judgeWorkerEnv({ OPENAI_MODE: "disabled" }),
        ipAddress: "203.0.113.40, 198.51.100.1",
      },
      {
        environment: judgeWorkerEnv({ OPENAI_MODE: "disabled" }),
        ipAddress: "",
      },
    ]) {
      const response = await handler.fetch!(
        workerRequest(
          proposeRequest({
            authorization,
            expectedPosition: source.position + 1,
            ...(unsafe.ipAddress === undefined
              ? {}
              : { ipAddress: unsafe.ipAddress }),
            idempotencyKey: crypto.randomUUID(),
            sourceArtifactId: source.sourceArtifactId,
          }),
        ),
        unsafe.environment,
        {} as ExecutionContext,
      );
      expect(response.status).toBe(503);
      await expect(json(response)).resolves.toMatchObject({
        code: "OPENAI_UNAVAILABLE",
      });
      await expect(
        env.DB.prepare(
          "SELECT COUNT(*) AS count FROM judge_usage_reservations",
        ).first<{ count: number }>(),
      ).resolves.toMatchObject({ count: 0 });
      await expect(
        env.DB.prepare(
          "SELECT COUNT(*) AS count FROM judge_managed_ai_operation_claims",
        ).first<{ count: number }>(),
      ).resolves.toMatchObject({ count: 0 });
    }
    expect(proposer.propose).not.toHaveBeenCalled();
  });
});
