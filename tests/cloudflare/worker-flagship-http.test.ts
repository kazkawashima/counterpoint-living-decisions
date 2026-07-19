/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { createWorkerHandler, type Env } from "../../apps/worker/src/index.js";
import {
  ApproveDisclosureResponseSchema,
  CommitDecisionResponseSchema,
  DispositionSharedDecisionCandidateResponseSchema,
  FacilitatorDemoResetResponseSchema,
  InjectDemoRegulatoryChangeResponseSchema,
  ListInvalidationEvaluationsResponseSchema,
  ListSharedExternalEventsResponseSchema,
  PreviewDisclosureResponseSchema,
  ProposeDisclosureResponseSchema,
  RegisterPrivateTextSourceFixtureResponseSchema,
  SaveDecisionDraftResponseSchema,
  SynthesizeSharedDecisionResponseSchema,
  MarkDecisionReadyResponseSchema,
  ReviewInvalidationResponseSchema,
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
    OPENAI_MODE: env.OPENAI_MODE,
    OPENAI_MODEL: env.OPENAI_MODEL,
    RUNTIME_MODE: env.RUNTIME_MODE,
    JUDGE_MANAGED_REALTIME_ROUTE_ENABLED:
      env.JUDGE_MANAGED_REALTIME_ROUTE_ENABLED,
  };
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return await response.json();
}

describe("Cloudflare Worker hosted flagship API", () => {
  it("shows the seeded Work & Productivity meeting through an external-host-style URL", async () => {
    const handler = createWorkerHandler();
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

    const resetResponse = await handler.fetch!(
      workerRequest(
        new Request(
          `https://203.0.113.7/api/v1/meetings/${FLAGSHIP_MEETING_ID}/demo/reset`,
          {
            body: JSON.stringify({
              expectedPosition: reviewBody.position,
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

  it("connects deterministic AI-preferred disclosure and Decision paths", async () => {
    const handler = createWorkerHandler();
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
