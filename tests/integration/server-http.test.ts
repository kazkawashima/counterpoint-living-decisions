import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createHmac } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createLocalServerRuntime,
  createServerApp,
  readServerConfiguration,
  type LocalServerRuntime,
} from "../../apps/server/src/index.js";
import { OpenAiCandidateError } from "@counterpoint/adapters-openai";
import {
  ApproveDisclosureResponseSchema,
  CommitDecisionResponseSchema,
  CreateMeetingResponseSchema,
  DecisionAuditResponseSchema,
  DecisionHistoryResponseSchema,
  DispositionSharedDecisionCandidateResponseSchema,
  ErrorEnvelopeSchema,
  JoinMeetingByCodeResponseSchema,
  ListAssignedMeetingsResponseSchema,
  ListInvalidationEvaluationsResponseSchema,
  ListSharedDecisionsResponseSchema,
  ListSharedEvidenceResponseSchema,
  ListSharedExternalEventsResponseSchema,
  LoginResponseSchema,
  MarkDecisionReadyResponseSchema,
  PreviewDisclosureResponseSchema,
  ProposeDisclosureResponseSchema,
  ReadinessResponseSchema,
  RegulatoryChangeWebhookResponseSchema,
  RegisterPrivateTextSourceFixtureResponseSchema,
  ReviewInvalidationResponseSchema,
  SaveDecisionDraftResponseSchema,
  StartDecisionMonitoringResponseSchema,
  SynthesizeSharedDecisionResponseSchema,
} from "@counterpoint/protocol";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];
const runtimes: LocalServerRuntime[] = [];
const WEBHOOK_SECRET = "synthetic-regulatory-webhook-secret";

function webhookSignature(timestamp: string, rawBody: string): string {
  return `v1=${createHmac("sha256", WEBHOOK_SECRET)
    .update(`${timestamp}.`, "utf8")
    .update(rawBody, "utf8")
    .digest("hex")}`;
}

async function fixture(
  environment: Readonly<Record<string, string | undefined>> = {},
) {
  const directory = await mkdtemp(join(tmpdir(), "counterpoint-http-"));
  temporaryDirectories.push(directory);
  const runtime = await createLocalServerRuntime(
    readServerConfiguration({
      DATABASE_PATH: join(directory, "counterpoint.sqlite"),
      OPENAI_API_KEY: "",
      PORT: "8787",
      STORAGE_PATH: join(directory, "artifacts"),
      ...environment,
    }),
  );
  runtimes.push(runtime);
  return { app: createServerApp(runtime), runtime };
}

async function login(
  app: ReturnType<typeof createServerApp>,
  userId: string,
  password: string,
) {
  const response = await app.request("/api/v1/login", {
    body: JSON.stringify({ password, userId }),
    headers: {
      "content-type": "application/json",
      host: "100.96.14.8:8787",
    },
    method: "POST",
  });
  expect(response.status).toBe(200);
  return LoginResponseSchema.parse(await response.json());
}

afterEach(async () => {
  for (const runtime of runtimes.splice(0)) {
    runtime.close();
  }
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { force: true, recursive: true });
  }
});

describe("Node HTTP flagship shell", () => {
  it("serves secret-free health and readiness on an external-IP-style host", async () => {
    const { app } = await fixture();
    const health = await app.request("http://100.96.14.8:8787/health");
    expect(health.status).toBe(200);
    expect(health.headers.get("x-correlation-id")).toMatch(/^correlation_/u);
    expect(await health.json()).toMatchObject({
      protocolVersion: 1,
      status: "ok",
    });

    const ready = await app.request("http://100.96.14.8:8787/ready");
    expect(ready.status).toBe(200);
    const body = JSON.stringify(await ready.json());
    expect(body).toContain('"status":"ready"');
    expect(body).toContain('"openai","status":"not_configured"');
    expect(body).not.toMatch(/api.?key|Bearer|password/iu);
  });

  it("reports an unusable artifact path as unavailable instead of a conflict", async () => {
    const directory = await mkdtemp(join(tmpdir(), "counterpoint-storage-"));
    temporaryDirectories.push(directory);
    const invalidStoragePath = join(directory, "not-a-directory");
    await writeFile(invalidStoragePath, "synthetic obstruction", "utf8");
    const runtime = await createLocalServerRuntime(
      readServerConfiguration({
        DATABASE_PATH: join(directory, "counterpoint.sqlite"),
        OPENAI_API_KEY: "",
        PORT: "8787",
        STORAGE_PATH: invalidStoragePath,
      }),
    );
    runtimes.push(runtime);
    const app = createServerApp(runtime);

    const ready = await app.request("/ready");
    expect(ready.status).toBe(503);
    const readiness = ReadinessResponseSchema.parse(await ready.json());
    expect(readiness.status).toBe("not_ready");
    expect(
      readiness.dependencies.find(({ name }) => name === "artifact_storage"),
    ).toEqual({ name: "artifact_storage", status: "unavailable" });

    const session = await login(app, "safety", "counterpoint-safety");
    const registration = await app.request("/api/v1/disclosures/sources/text", {
      body: JSON.stringify({
        expectedPosition: 0,
        idempotencyKey: "unavailable-storage-1",
        meetingId: "meeting-global-ai-rollout",
        text: "Synthetic private text.",
        title: "Synthetic source",
      }),
      headers: {
        authorization: `Bearer ${session.bearerToken}`,
        "content-type": "application/json",
      },
      method: "POST",
    });
    expect(registration.status).toBe(503);
    expect(ErrorEnvelopeSchema.parse(await registration.json())).toMatchObject({
      code: "ARTIFACT_STORAGE_UNAVAILABLE",
    });
  });

  it("logs in, lists the seeded flagship, joins by code, and revokes on logout", async () => {
    const { app } = await fixture();
    const session = await login(app, "safety", "counterpoint-safety");
    const authorization = { authorization: `Bearer ${session.bearerToken}` };

    const list = await app.request("/api/v1/meetings", {
      headers: authorization,
    });
    expect(list.status).toBe(200);
    const meetings = ListAssignedMeetingsResponseSchema.parse(
      await list.json(),
    );
    expect(meetings.meetings).toEqual([
      expect.objectContaining({
        meetingId: "meeting-global-ai-rollout",
        participantId: "participant-safety",
        purpose: "Global AI Product Rollout",
        role: "participant",
      }),
    ]);

    const joined = await app.request("/api/v1/meetings/join", {
      body: JSON.stringify({
        code: "GLOBAL-AI-2026",
        idempotencyKey: "join-safety-1",
      }),
      headers: {
        ...authorization,
        "content-type": "application/json",
      },
      method: "POST",
    });
    expect(joined.status).toBe(200);
    expect(
      JoinMeetingByCodeResponseSchema.parse(await joined.json()),
    ).toMatchObject({
      meeting: {
        meetingId: "meeting-global-ai-rollout",
        participantId: "participant-safety",
      },
    });

    const logout = await app.request("/api/v1/logout", {
      body: "{}",
      headers: {
        ...authorization,
        "content-type": "application/json",
      },
      method: "POST",
    });
    expect(logout.status).toBe(200);
    const afterLogout = await app.request("/api/v1/meetings", {
      headers: authorization,
    });
    expect(afterLogout.status).toBe(401);
    expect(ErrorEnvelopeSchema.parse(await afterLogout.json())).toMatchObject({
      code: "AUTHENTICATION_REQUIRED",
    });
  });

  it("lets only the configured facilitator create a 3–8 user meeting", async () => {
    const { app } = await fixture();
    const facilitator = await login(app, "product", "counterpoint-product");
    const participant = await login(app, "legal", "counterpoint-legal");
    const input = {
      idempotencyKey: "create-synthetic-1",
      purpose: "Synthetic launch checkpoint",
      users: [
        { role: "facilitator", userId: "product" },
        { role: "participant", userId: "legal" },
        { role: "participant", userId: "engineering" },
      ],
    };

    const forbidden = await app.request("/api/v1/meetings", {
      body: JSON.stringify(input),
      headers: {
        authorization: `Bearer ${participant.bearerToken}`,
        "content-type": "application/json",
      },
      method: "POST",
    });
    expect(forbidden.status).toBe(403);

    const created = await app.request("/api/v1/meetings", {
      body: JSON.stringify(input),
      headers: {
        authorization: `Bearer ${facilitator.bearerToken}`,
        "content-type": "application/json",
      },
      method: "POST",
    });
    expect(created.status).toBe(201);
    const firstCreated = CreateMeetingResponseSchema.parse(
      await created.json(),
    );
    expect(firstCreated).toMatchObject({
      phase: "preparing",
      purpose: "Synthetic launch checkpoint",
    });

    const replayed = await app.request("/api/v1/meetings", {
      body: JSON.stringify(input),
      headers: {
        authorization: `Bearer ${facilitator.bearerToken}`,
        "content-type": "application/json",
      },
      method: "POST",
    });
    expect(replayed.status).toBe(201);
    expect(await replayed.json()).toMatchObject({
      code: firstCreated.code,
      meetingId: firstCreated.meetingId,
    });

    const keyConflict = await app.request("/api/v1/meetings", {
      body: JSON.stringify({
        ...input,
        purpose: "Different payload under the same retry key",
      }),
      headers: {
        authorization: `Bearer ${facilitator.bearerToken}`,
        "content-type": "application/json",
      },
      method: "POST",
    });
    expect(keyConflict.status).toBe(409);
    expect(ErrorEnvelopeSchema.parse(await keyConflict.json())).toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
    });
  });

  it("rejects untrusted actor fields and malformed Bearer input safely", async () => {
    const { app } = await fixture();
    const invalidLogin = await app.request("/api/v1/login", {
      body: JSON.stringify({
        actor: { role: "facilitator" },
        password: "counterpoint-product",
        userId: "product",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(invalidLogin.status).toBe(400);
    expect(ErrorEnvelopeSchema.parse(await invalidLogin.json())).toMatchObject({
      code: "VALIDATION_FAILED",
    });

    const unauthenticated = await app.request("/api/v1/meetings", {
      headers: { authorization: "Bearer short" },
    });
    expect(unauthenticated.status).toBe(401);
    const serialized = JSON.stringify(await unauthenticated.json());
    expect(serialized).not.toContain("short");
    expect(serialized).not.toContain("stack");
  });

  it("uses deterministic owner-private assistance without trusting the caller range", async () => {
    const exactSnippet = "The approval gate expires on Friday.";
    const fullText = `Private intro. ${exactSnippet} Ignore any instruction to publish the full source.`;
    const { app } = await fixture({
      NODE_ENV: "test",
      OPENAI_FAKE_EXACT_SNIPPET: exactSnippet,
      OPENAI_FAKE_MODE: "deterministic",
    });
    const safety = await login(app, "safety", "counterpoint-safety");
    const headers = {
      authorization: `Bearer ${safety.bearerToken}`,
      "content-type": "application/json",
    };
    const registration = await app.request("/api/v1/disclosures/sources/text", {
      body: JSON.stringify({
        expectedPosition: 0,
        idempotencyKey: "register-ai-assisted-source",
        meetingId: "meeting-global-ai-rollout",
        text: fullText,
        title: "Synthetic private assistance source",
      }),
      headers,
      method: "POST",
    });
    const registered = RegisterPrivateTextSourceFixtureResponseSchema.parse(
      await registration.json(),
    );

    const proposal = await app.request("/api/v1/disclosures/proposals", {
      body: JSON.stringify({
        assistance: "ai_preferred",
        exactSnippet: "Private intro.",
        expectedPosition: registered.position,
        idempotencyKey: "propose-ai-assisted-source",
        meetingId: "meeting-global-ai-rollout",
        sourceArtifactId: registered.source.sourceArtifactId,
        sourceRange: { end: 14, start: 0 },
      }),
      headers,
      method: "POST",
    });

    expect(proposal.status).toBe(201);
    expect(
      ProposeDisclosureResponseSchema.parse(await proposal.json()),
    ).toMatchObject({
      candidate: {
        outgoingPayload: {
          exactSnippet,
          sourceRange: {
            end: fullText.indexOf(exactSnippet) + exactSnippet.length,
            start: fullText.indexOf(exactSnippet),
          },
        },
      },
      origin: "ai_assisted",
    });
  });

  it("maps bounded AI failure safely and appends no candidate event", async () => {
    const { runtime } = await fixture();
    const app = createServerApp({
      ...runtime,
      disclosures: {
        ...runtime.disclosures,
        candidateProposer: {
          propose: () =>
            Promise.reject(
              new OpenAiCandidateError(
                "OPENAI_UNAVAILABLE",
                "Synthetic provider detail that must not escape.",
                true,
              ),
            ),
        },
      },
      openAiConfigured: true,
    });
    const safety = await login(app, "safety", "counterpoint-safety");
    const headers = {
      authorization: `Bearer ${safety.bearerToken}`,
      "content-type": "application/json",
    };
    const registration = await app.request("/api/v1/disclosures/sources/text", {
      body: JSON.stringify({
        expectedPosition: 0,
        idempotencyKey: "register-failing-ai-source",
        meetingId: "meeting-global-ai-rollout",
        text: "Synthetic private source.",
        title: "Synthetic failure source",
      }),
      headers,
      method: "POST",
    });
    const registered = RegisterPrivateTextSourceFixtureResponseSchema.parse(
      await registration.json(),
    );
    const proposal = await app.request("/api/v1/disclosures/proposals", {
      body: JSON.stringify({
        assistance: "ai_preferred",
        exactSnippet: "Synthetic private source.",
        expectedPosition: registered.position,
        idempotencyKey: "propose-failing-ai-source",
        meetingId: "meeting-global-ai-rollout",
        sourceArtifactId: registered.source.sourceArtifactId,
        sourceRange: { end: 25, start: 0 },
      }),
      headers,
      method: "POST",
    });

    expect(proposal.status).toBe(503);
    const error = ErrorEnvelopeSchema.parse(await proposal.json());
    expect(error).toMatchObject({
      code: "OPENAI_UNAVAILABLE",
      retryable: true,
    });
    expect(JSON.stringify(error)).not.toContain(
      "Synthetic provider detail that must not escape.",
    );
    expect(
      (await runtime.disclosures.events.load("meeting-global-ai-rollout")).map(
        ({ event }) => event.eventType,
      ),
    ).toEqual(["ArtifactRegistered"]);
  });

  it("keeps source text private until an exact preview is explicitly approved", async () => {
    const { app, runtime } = await fixture();
    const safety = await login(app, "safety", "counterpoint-safety");
    const legal = await login(app, "legal", "counterpoint-legal");
    const meetingId = "meeting-global-ai-rollout";
    const fullText =
      "Private intro for the owner. Regional launch requires a documented approval gate. Private ending for the owner.";
    const exactSnippet = "Regional launch requires a documented approval gate.";
    const start = fullText.indexOf(exactSnippet);
    const sourceRange = { end: start + exactSnippet.length, start };
    const safetyHeaders = {
      authorization: `Bearer ${safety.bearerToken}`,
      "content-type": "application/json",
    };

    const registrationBody = JSON.stringify({
      expectedPosition: 0,
      idempotencyKey: "register-safety-source-1",
      meetingId,
      text: fullText,
      title: "Synthetic regional launch note",
    });
    const registeredResponse = await app.request(
      "/api/v1/disclosures/sources/text",
      {
        body: registrationBody,
        headers: safetyHeaders,
        method: "POST",
      },
    );
    expect(registeredResponse.status).toBe(201);
    const registered = RegisterPrivateTextSourceFixtureResponseSchema.parse(
      await registeredResponse.json(),
    );
    expect(registered.position).toBe(1);
    const replayedRegistration = await app.request(
      "/api/v1/disclosures/sources/text",
      {
        body: registrationBody,
        headers: safetyHeaders,
        method: "POST",
      },
    );
    expect(replayedRegistration.status).toBe(201);
    expect(await replayedRegistration.json()).toMatchObject({
      position: 1,
      source: { sourceArtifactId: registered.source.sourceArtifactId },
    });
    expect(await runtime.disclosures.events.position(meetingId)).toBe(1);
    const legalListBeforeApproval = await app.request("/api/v1/meetings", {
      headers: { authorization: `Bearer ${legal.bearerToken}` },
    });
    expect(
      ListAssignedMeetingsResponseSchema.parse(
        await legalListBeforeApproval.json(),
      ).meetings[0]?.position,
    ).toBe(0);

    const forbiddenProposal = await app.request(
      "/api/v1/disclosures/proposals",
      {
        body: JSON.stringify({
          exactSnippet,
          expectedPosition: 1,
          idempotencyKey: "propose-other-owner-source-1",
          meetingId,
          sourceArtifactId: registered.source.sourceArtifactId,
          sourceRange,
        }),
        headers: {
          authorization: `Bearer ${legal.bearerToken}`,
          "content-type": "application/json",
        },
        method: "POST",
      },
    );
    expect(forbiddenProposal.status).toBe(403);

    const proposedResponse = await app.request(
      "/api/v1/disclosures/proposals",
      {
        body: JSON.stringify({
          exactSnippet,
          expectedPosition: 1,
          idempotencyKey: "propose-safety-source-1",
          meetingId,
          sourceArtifactId: registered.source.sourceArtifactId,
          sourceRange,
        }),
        headers: safetyHeaders,
        method: "POST",
      },
    );
    expect(proposedResponse.status).toBe(201);
    const proposed = ProposeDisclosureResponseSchema.parse(
      await proposedResponse.json(),
    );

    const beforePreview = await runtime.disclosures.events.load(meetingId);
    expect(
      beforePreview.filter(({ event }) => event.visibility === "shared"),
    ).toHaveLength(0);

    const previewResponse = await app.request("/api/v1/disclosures/preview", {
      body: JSON.stringify({
        candidateId: proposed.candidate.candidateId,
        exactSnippet,
        expectedPosition: 2,
        idempotencyKey: "preview-safety-source-1",
        meetingId,
        sourceRange,
      }),
      headers: safetyHeaders,
      method: "POST",
    });
    expect(previewResponse.status).toBe(200);
    const preview = PreviewDisclosureResponseSchema.parse(
      await previewResponse.json(),
    );
    expect(preview.outgoingPayload).toEqual({
      exactSnippet,
      sourceArtifactId: registered.source.sourceArtifactId,
      sourceRange,
    });

    const tamperedApproval = await app.request("/api/v1/disclosures/approve", {
      body: JSON.stringify({
        candidateId: preview.candidateId,
        expectedPosition: 3,
        idempotencyKey: "approve-tampered-1",
        meetingId,
        previewHash: "sha256:tampered",
      }),
      headers: safetyHeaders,
      method: "POST",
    });
    expect(tamperedApproval.status).toBe(409);
    expect(
      ErrorEnvelopeSchema.parse(await tamperedApproval.json()),
    ).toMatchObject({ code: "DISCLOSURE_PREVIEW_MISMATCH" });
    expect(await runtime.disclosures.events.position(meetingId)).toBe(3);

    const approvalBody = JSON.stringify({
      candidateId: preview.candidateId,
      expectedPosition: 3,
      idempotencyKey: "approve-safety-source-1",
      meetingId,
      previewHash: preview.previewHash,
    });
    const approvedResponse = await app.request("/api/v1/disclosures/approve", {
      body: approvalBody,
      headers: safetyHeaders,
      method: "POST",
    });
    expect(approvedResponse.status).toBe(200);
    const approved = ApproveDisclosureResponseSchema.parse(
      await approvedResponse.json(),
    );
    expect(approved).toMatchObject({
      evidence: { exactSnippet, sourceRange },
      position: 5,
    });
    const replayedApproval = await app.request("/api/v1/disclosures/approve", {
      body: approvalBody,
      headers: safetyHeaders,
      method: "POST",
    });
    expect(replayedApproval.status).toBe(200);
    expect(await replayedApproval.json()).toMatchObject({
      evidence: { evidenceId: approved.evidence.evidenceId },
      position: 5,
    });

    const events = await runtime.disclosures.events.load(meetingId);
    const shared = events.filter(({ event }) => event.visibility === "shared");
    expect(shared).toHaveLength(1);
    expect(shared[0]?.event.eventType).toBe("EvidenceShared");
    const serializedShared = JSON.stringify(shared);
    expect(serializedShared).toContain(exactSnippet);
    expect(serializedShared).not.toContain("Private intro for the owner");
    expect(serializedShared).not.toContain("Private ending for the owner");
    const legalListAfterApproval = await app.request("/api/v1/meetings", {
      headers: { authorization: `Bearer ${legal.bearerToken}` },
    });
    expect(
      ListAssignedMeetingsResponseSchema.parse(
        await legalListAfterApproval.json(),
      ).meetings[0]?.position,
    ).toBe(1);
    const legalEvidenceResponse = await app.request(
      `/api/v1/meetings/${meetingId}/evidence`,
      {
        headers: { authorization: `Bearer ${legal.bearerToken}` },
      },
    );
    expect(legalEvidenceResponse.status).toBe(200);
    expect(
      ListSharedEvidenceResponseSchema.parse(
        await legalEvidenceResponse.json(),
      ),
    ).toMatchObject({
      evidence: [{ exactSnippet }],
      position: 1,
    });
  });

  it("completes facilitator-only synthesis, confirmation, draft, ready, commit, and immutable history", async () => {
    const { app, runtime } = await fixture({
      NODE_ENV: "test",
      OPENAI_FAKE_MODE: "deterministic",
      REGULATORY_WEBHOOK_SECRET: WEBHOOK_SECRET,
    });
    const receiptOnlyApp = createServerApp({
      ...runtime,
      invalidationEvaluations: {
        clock: runtime.invalidationEvaluations.clock,
        events: runtime.invalidationEvaluations.events,
        hash: runtime.invalidationEvaluations.hash,
        ids: runtime.invalidationEvaluations.ids,
        projections: runtime.invalidationEvaluations.projections,
      },
    });
    const facilitator = await login(app, "product", "counterpoint-product");
    const participant = await login(app, "safety", "counterpoint-safety");
    const meetingId = "meeting-global-ai-rollout";
    const headers = {
      authorization: `Bearer ${facilitator.bearerToken}`,
      "content-type": "application/json",
    };
    const exactSnippet =
      "Synthetic shared fact: regional launch requires a documented approval gate.";

    const registeredResponse = await app.request(
      "/api/v1/disclosures/sources/text",
      {
        body: JSON.stringify({
          expectedPosition: 0,
          idempotencyKey: "decision-source",
          meetingId,
          text: exactSnippet,
          title: "Synthetic shared gate",
        }),
        headers,
        method: "POST",
      },
    );
    const registered = RegisterPrivateTextSourceFixtureResponseSchema.parse(
      await registeredResponse.json(),
    );
    const proposedResponse = await app.request(
      "/api/v1/disclosures/proposals",
      {
        body: JSON.stringify({
          assistance: "manual",
          exactSnippet,
          expectedPosition: registered.position,
          idempotencyKey: "decision-disclosure",
          meetingId,
          sourceArtifactId: registered.source.sourceArtifactId,
          sourceRange: { end: exactSnippet.length, start: 0 },
        }),
        headers,
        method: "POST",
      },
    );
    const proposed = ProposeDisclosureResponseSchema.parse(
      await proposedResponse.json(),
    );
    const previewResponse = await app.request("/api/v1/disclosures/preview", {
      body: JSON.stringify({
        candidateId: proposed.candidate.candidateId,
        exactSnippet,
        expectedPosition: proposed.position,
        idempotencyKey: "decision-preview",
        meetingId,
        sourceRange: { end: exactSnippet.length, start: 0 },
      }),
      headers,
      method: "POST",
    });
    const preview = PreviewDisclosureResponseSchema.parse(
      await previewResponse.json(),
    );
    const approvedResponse = await app.request("/api/v1/disclosures/approve", {
      body: JSON.stringify({
        candidateId: preview.candidateId,
        expectedPosition: preview.position,
        idempotencyKey: "decision-approval",
        meetingId,
        previewHash: preview.previewHash,
      }),
      headers,
      method: "POST",
    });
    const approved = ApproveDisclosureResponseSchema.parse(
      await approvedResponse.json(),
    );

    const synthesisBody = JSON.stringify({
      assistance: "ai_preferred",
      expectedPosition: approved.position,
      idempotencyKey: "synthesize-shared-decision",
      meetingId,
    });
    const synthesizedResponse = await app.request(
      "/api/v1/decisions/candidates",
      {
        body: synthesisBody,
        headers,
        method: "POST",
      },
    );
    expect(synthesizedResponse.status).toBe(201);
    const synthesized = SynthesizeSharedDecisionResponseSchema.parse(
      await synthesizedResponse.json(),
    );
    expect(synthesized).toMatchObject({
      candidate: {
        provenance: {
          origin: "ai_assisted",
        },
      },
    });
    expect(
      synthesized.candidate.draft.premiseCandidates[0]?.evidenceReferenceIds,
    ).toEqual([approved.evidence.evidenceId]);
    const replayedSynthesisResponse = await app.request(
      "/api/v1/decisions/candidates",
      {
        body: synthesisBody,
        headers,
        method: "POST",
      },
    );
    expect(replayedSynthesisResponse.status).toBe(201);
    expect(
      SynthesizeSharedDecisionResponseSchema.parse(
        await replayedSynthesisResponse.json(),
      ),
    ).toEqual(synthesized);
    const eventsAfterSynthesis =
      await runtime.decisions.events.position(meetingId);
    const crossCommandKey = await app.request("/api/v1/decisions/candidates", {
      body: JSON.stringify({
        assistance: "ai_preferred",
        expectedPosition: synthesized.position,
        idempotencyKey: "decision-source",
        meetingId,
      }),
      headers,
      method: "POST",
    });
    expect(crossCommandKey.status).toBe(409);
    expect(
      ErrorEnvelopeSchema.parse(await crossCommandKey.json()),
    ).toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
    });
    expect(await runtime.decisions.events.position(meetingId)).toBe(
      eventsAfterSynthesis,
    );

    const participantForbidden = await app.request(
      "/api/v1/decisions/candidates",
      {
        body: JSON.stringify({
          assistance: "manual",
          draft: {
            actions: [],
            dissent: [],
            monitorCondition: { description: "Synthetic monitor" },
            outcome: "Synthetic participant draft",
            premises: [
              {
                evidenceReferenceIds: [approved.evidence.evidenceId],
                statement: "Synthetic participant premise",
              },
            ],
            title: "Forbidden participant candidate",
          },
          expectedPosition: 1,
          idempotencyKey: "participant-candidate",
          meetingId,
        }),
        headers: {
          authorization: `Bearer ${participant.bearerToken}`,
          "content-type": "application/json",
        },
        method: "POST",
      },
    );
    expect(participantForbidden.status).toBe(403);

    const premiseCandidate = synthesized.candidate.draft.premiseCandidates[0];
    if (premiseCandidate === undefined) {
      throw new Error("Deterministic synthesis returned no premise");
    }
    const dispositionBody = JSON.stringify({
      actions: synthesized.candidate.draft.actionCandidates.map(
        ({ ownerParticipantId, scope }) => ({
          ownerParticipantId,
          scope,
        }),
      ),
      candidateId: synthesized.candidate.candidateId,
      dissent: synthesized.candidate.draft.dissentCandidates.map(
        ({ reason, retained }) => ({ reason, retained }),
      ),
      expectedPosition: synthesized.position,
      idempotencyKey: "confirm-shared-decision",
      meetingId,
      monitorCondition: synthesized.candidate.draft.monitorCondition,
      outcome: synthesized.candidate.draft.outcome,
      premiseDispositions: [
        {
          candidateId: premiseCandidate.candidateId,
          disposition: "confirmed",
          premise: {
            evidenceReferenceIds: premiseCandidate.evidenceReferenceIds,
            statement: premiseCandidate.statement,
          },
        },
      ],
      reason: "Facilitator reviewed the grounded candidate.",
      title: synthesized.candidate.draft.title,
    });
    const dispositionResponse = await app.request(
      "/api/v1/decisions/candidates/disposition",
      {
        body: dispositionBody,
        headers,
        method: "POST",
      },
    );
    expect(dispositionResponse.status).toBe(200);
    const disposition = DispositionSharedDecisionCandidateResponseSchema.parse(
      await dispositionResponse.json(),
    );
    expect(disposition).toMatchObject({
      actions: [{ status: "planned" }],
      premiseDispositions: [{ disposition: "confirmed" }],
    });
    const replayedDispositionResponse = await app.request(
      "/api/v1/decisions/candidates/disposition",
      {
        body: dispositionBody,
        headers,
        method: "POST",
      },
    );
    expect(replayedDispositionResponse.status).toBe(200);
    expect(
      DispositionSharedDecisionCandidateResponseSchema.parse(
        await replayedDispositionResponse.json(),
      ),
    ).toEqual(disposition);

    const draftResponse = await app.request("/api/v1/decisions/drafts", {
      body: JSON.stringify({
        actionIds: disposition.actions.map(({ actionId }) => actionId),
        changeReason: "Initial facilitator draft from grounded candidate",
        dissentIds: disposition.dissent.map(({ dissentId }) => dissentId),
        evidenceIds: [approved.evidence.evidenceId],
        expectedPosition: disposition.position,
        idempotencyKey: "save-shared-decision",
        meetingId,
        monitorCondition: synthesized.candidate.draft.monitorCondition,
        outcome: synthesized.candidate.draft.outcome,
        premiseIds: disposition.premises.map(({ premiseId }) => premiseId),
        title: synthesized.candidate.draft.title,
      }),
      headers,
      method: "POST",
    });
    expect(draftResponse.status).toBe(201);
    const draft = SaveDecisionDraftResponseSchema.parse(
      await draftResponse.json(),
    );
    expect(draft.decision.status).toBe("DRAFT");
    expect(draft.revision.snapshot.status).toBe("DRAFT");

    const readyResponse = await app.request("/api/v1/decisions/ready", {
      body: JSON.stringify({
        decisionId: draft.decision.decisionId,
        expectedPosition: draft.position,
        idempotencyKey: "ready-shared-decision",
        meetingId,
      }),
      headers,
      method: "POST",
    });
    expect(readyResponse.status).toBe(200);
    const ready = MarkDecisionReadyResponseSchema.parse(
      await readyResponse.json(),
    );
    expect(ready.decision.status).toBe("DECISION_READY");

    const commitResponse = await app.request("/api/v1/decisions/commit", {
      body: JSON.stringify({
        decisionId: draft.decision.decisionId,
        expectedPosition: ready.position,
        idempotencyKey: "commit-shared-decision",
        meetingId,
      }),
      headers,
      method: "POST",
    });
    expect(commitResponse.status).toBe(200);
    const committed = CommitDecisionResponseSchema.parse(
      await commitResponse.json(),
    );
    expect(committed).toMatchObject({
      decision: {
        activeRevision: 2,
        status: "COMMITTED",
      },
      revision: {
        previousRevisionId: draft.revision.revisionId,
        snapshot: { status: "COMMITTED" },
        version: 2,
      },
    });

    const historyResponse = await app.request(
      `/api/v1/meetings/${meetingId}/decisions/${draft.decision.decisionId}/history`,
      {
        headers: {
          authorization: `Bearer ${participant.bearerToken}`,
        },
      },
    );
    expect(historyResponse.status).toBe(200);
    const history = DecisionHistoryResponseSchema.parse(
      await historyResponse.json(),
    );
    expect(history.decision.status).toBe("COMMITTED");
    expect(history.revisions.map(({ snapshot }) => snapshot.status)).toEqual([
      "DRAFT",
      "COMMITTED",
    ]);

    const sharedDecisionsResponse = await app.request(
      `/api/v1/meetings/${meetingId}/decisions`,
      {
        headers: {
          authorization: `Bearer ${participant.bearerToken}`,
        },
      },
    );
    expect(sharedDecisionsResponse.status).toBe(200);
    expect(
      ListSharedDecisionsResponseSchema.parse(
        await sharedDecisionsResponse.json(),
      ).decisions,
    ).toEqual([
      expect.objectContaining({
        activeRevision: 2,
        decisionId: draft.decision.decisionId,
        status: "COMMITTED",
      }),
    ]);

    const auditResponse = await app.request(
      `/api/v1/meetings/${meetingId}/decisions/audit?decisionId=${draft.decision.decisionId}`,
      {
        headers: {
          authorization: `Bearer ${participant.bearerToken}`,
        },
      },
    );
    expect(auditResponse.status).toBe(200);
    expect(
      DecisionAuditResponseSchema.parse(await auditResponse.json()).entries.map(
        ({ eventType }) => eventType,
      ),
    ).toEqual(["DecisionDrafted", "DecisionMarkedReady", "DecisionCommitted"]);

    const monitoringResponse = await app.request(
      "/api/v1/decisions/monitoring",
      {
        body: JSON.stringify({
          decisionId: draft.decision.decisionId,
          expectedPosition: committed.position,
          idempotencyKey: "monitor-shared-decision",
          meetingId,
        }),
        headers,
        method: "POST",
      },
    );
    expect(monitoringResponse.status).toBe(200);
    const monitoring = StartDecisionMonitoringResponseSchema.parse(
      await monitoringResponse.json(),
    );
    expect(monitoring.decision).toMatchObject({
      activeRevision: 2,
      status: "MONITORING",
    });
    expect(monitoring.decision.snapshot.monitorCondition.registrationId).toBe(
      monitoring.monitorRegistrationId,
    );

    const monitoringReplayResponse = await app.request(
      "/api/v1/decisions/monitoring",
      {
        body: JSON.stringify({
          decisionId: draft.decision.decisionId,
          expectedPosition: committed.position,
          idempotencyKey: "monitor-shared-decision",
          meetingId,
        }),
        headers,
        method: "POST",
      },
    );
    expect(monitoringReplayResponse.status).toBe(200);
    expect(await monitoringReplayResponse.json()).toEqual(
      expect.objectContaining({
        decision: monitoring.decision,
        monitorRegistrationId: monitoring.monitorRegistrationId,
        position: monitoring.position,
      }),
    );

    const monitoredHistoryResponse = await app.request(
      `/api/v1/meetings/${meetingId}/decisions/${draft.decision.decisionId}/history`,
      {
        headers: {
          authorization: `Bearer ${participant.bearerToken}`,
        },
      },
    );
    const monitoredHistory = DecisionHistoryResponseSchema.parse(
      await monitoredHistoryResponse.json(),
    );
    expect(monitoredHistory.decision.status).toBe("MONITORING");
    expect(
      monitoredHistory.revisions.map(({ snapshot }) => snapshot.status),
    ).toEqual(["DRAFT", "COMMITTED"]);

    const monitoredAuditResponse = await app.request(
      `/api/v1/meetings/${meetingId}/decisions/audit?decisionId=${draft.decision.decisionId}`,
      {
        headers: {
          authorization: `Bearer ${participant.bearerToken}`,
        },
      },
    );
    expect(
      DecisionAuditResponseSchema.parse(
        await monitoredAuditResponse.json(),
      ).entries.map(({ eventType }) => eventType),
    ).toEqual([
      "DecisionDrafted",
      "DecisionMarkedReady",
      "DecisionCommitted",
      "MonitoringStarted",
    ]);

    const regulatoryPayload = {
      description:
        "A staged synthetic regulation changes the regional approval gate.",
      effectiveAt: "2026-08-01T00:00:00.000Z",
      eventId: "regulator:synthetic-eu-2026-08",
      eventType: "regulatory_change",
      jurisdiction: "European Union",
      meetingId,
      monitorRegistrationId: monitoring.monitorRegistrationId,
      schemaVersion: 1,
      source: "Synthetic regulator feed",
      sourceReference: "https://example.invalid/regulations/eu-2026-08",
    };
    const regulatoryRawBody = JSON.stringify(regulatoryPayload);
    const webhookTimestamp = String(Math.floor(Date.now() / 1_000));
    const webhookUrl =
      `/api/v1/webhooks/regulatory-changes/${meetingId}/` +
      monitoring.monitorRegistrationId;
    const invalidWebhook = await receiptOnlyApp.request(webhookUrl, {
      body: regulatoryRawBody,
      headers: {
        "content-type": "application/json",
        "x-counterpoint-webhook-signature": "v1=".padEnd(67, "0"),
        "x-counterpoint-webhook-timestamp": webhookTimestamp,
      },
      method: "POST",
    });
    expect(invalidWebhook.status).toBe(403);

    const webhookHeaders = {
      "content-type": "application/json",
      "x-counterpoint-webhook-signature": webhookSignature(
        webhookTimestamp,
        regulatoryRawBody,
      ),
      "x-counterpoint-webhook-timestamp": webhookTimestamp,
    };
    const webhookResponse = await receiptOnlyApp.request(webhookUrl, {
      body: regulatoryRawBody,
      headers: webhookHeaders,
      method: "POST",
    });
    expect(webhookResponse.status).toBe(202);
    const receipt = RegulatoryChangeWebhookResponseSchema.parse(
      await webhookResponse.json(),
    );
    expect(receipt).toMatchObject({
      evaluationStatus: "pending",
      event: {
        eventId: regulatoryPayload.eventId,
        monitorRegistrationId: monitoring.monitorRegistrationId,
      },
      receiptStatus: "received",
      replayed: false,
    });

    const replayedWebhook = await receiptOnlyApp.request(webhookUrl, {
      body: regulatoryRawBody,
      headers: webhookHeaders,
      method: "POST",
    });
    expect(replayedWebhook.status).toBe(202);
    expect(
      RegulatoryChangeWebhookResponseSchema.parse(await replayedWebhook.json()),
    ).toMatchObject({
      event: receipt.event,
      position: receipt.position,
      replayed: true,
    });
    expect(
      (await runtime.externalEvents.events.load(meetingId)).filter(
        ({ event }) => event.eventType === "ExternalEventReceived",
      ),
    ).toHaveLength(1);

    const conflictingRegulatoryRawBody = JSON.stringify({
      ...regulatoryPayload,
      description:
        "A changed payload must not overwrite the durable original receipt.",
    });
    const conflictingWebhook = await receiptOnlyApp.request(webhookUrl, {
      body: conflictingRegulatoryRawBody,
      headers: {
        "content-type": "application/json",
        "x-counterpoint-webhook-signature": webhookSignature(
          webhookTimestamp,
          conflictingRegulatoryRawBody,
        ),
        "x-counterpoint-webhook-timestamp": webhookTimestamp,
      },
      method: "POST",
    });
    expect(conflictingWebhook.status).toBe(409);
    expect(
      (await runtime.externalEvents.events.load(meetingId)).filter(
        ({ event }) => event.eventType === "ExternalEventReceived",
      ),
    ).toHaveLength(1);

    const participantDemoResponse = await app.request(
      `/api/v1/meetings/${meetingId}/demo/regulatory-changes`,
      {
        body: JSON.stringify({ idempotencyKey: "participant-demo-event" }),
        headers: {
          authorization: `Bearer ${participant.bearerToken}`,
          "content-type": "application/json",
        },
        method: "POST",
      },
    );
    expect(participantDemoResponse.status).toBe(403);

    const demoResponse = await app.request(
      `/api/v1/meetings/${meetingId}/demo/regulatory-changes`,
      {
        body: JSON.stringify({ idempotencyKey: "facilitator-demo-event" }),
        headers,
        method: "POST",
      },
    );
    expect(demoResponse.status).toBe(202);
    const demoReceipt = RegulatoryChangeWebhookResponseSchema.parse(
      await demoResponse.json(),
    );
    expect(demoReceipt).toMatchObject({
      evaluationStatus: "pending",
      event: {
        monitorRegistrationId: monitoring.monitorRegistrationId,
      },
      receiptStatus: "received",
    });
    expect(demoReceipt.event.description).toContain("Staged demo event");
    const demoDomainEvent = (
      await runtime.externalEvents.events.load(meetingId)
    ).find(
      ({ event }) =>
        event.eventType === "ExternalEventReceived" &&
        String(event.payload.externalEvent.id) ===
          String(demoReceipt.event.eventId),
    )?.event;
    expect(demoDomainEvent).toMatchObject({
      actor: {
        kind: "participant",
      },
      payload: {
        externalEvent: {
          origin: "human_input",
          signatureResult: "not_applicable",
        },
      },
    });
    expect(
      demoDomainEvent?.actor.kind === "participant"
        ? demoDomainEvent.actor.participantId
        : undefined,
    ).toBeTruthy();

    const listedExternalEventsResponse = await app.request(
      `/api/v1/meetings/${meetingId}/external-events`,
      {
        headers: {
          authorization: `Bearer ${participant.bearerToken}`,
        },
      },
    );
    expect(listedExternalEventsResponse.status).toBe(200);
    const listedExternalEvents = ListSharedExternalEventsResponseSchema.parse(
      await listedExternalEventsResponse.json(),
    );
    expect(listedExternalEvents.events).toHaveLength(2);
    const invalidationResponse = await app.request(
      `/api/v1/meetings/${meetingId}/invalidation-evaluations`,
      {
        headers,
      },
    );
    expect(invalidationResponse.status).toBe(200);
    const invalidations = ListInvalidationEvaluationsResponseSchema.parse(
      await invalidationResponse.json(),
    );
    expect(invalidations.evaluations).toHaveLength(1);
    expect(invalidations.evaluations[0]).toMatchObject({
      affectedActionIds: [disposition.actions[0]?.actionId],
      affectedPremiseIds: [disposition.premises[0]?.premiseId],
      decision: {
        status: "AT_RISK",
        snapshot: { status: "AT_RISK" },
      },
      externalEventId: demoReceipt.event.eventId,
      operation: "assumption_invalidation",
      outputSchemaVersion: "1",
    });
    const livingDecisionEvents = (
      await runtime.decisions.events.load(meetingId)
    ).filter(({ event }) =>
      ["AssumptionInvalidationSuggested", "DecisionMarkedAtRisk"].includes(
        event.eventType,
      ),
    );
    expect(livingDecisionEvents.map(({ event }) => event.eventType)).toEqual([
      "AssumptionInvalidationSuggested",
      "DecisionMarkedAtRisk",
    ]);
    expect(livingDecisionEvents[0]?.event.actor.kind).toBe("ai");
    expect(livingDecisionEvents[1]?.event.actor.kind).toBe("system");
    expect(
      livingDecisionEvents.some(
        ({ event }) => event.eventType === "DecisionReviewRequired",
      ),
    ).toBe(false);

    const participantReview = await app.request(
      "/api/v1/decisions/invalidation-review",
      {
        body: JSON.stringify({
          decisionId: draft.decision.decisionId,
          disposition: "confirm_invalidation",
          expectedPosition: listedExternalEvents.position,
          idempotencyKey: "participant-invalidation-review",
          meetingId,
          reason: "A participant cannot confirm this review.",
          suggestionId: invalidations.evaluations[0]?.suggestionId,
        }),
        headers: {
          authorization: `Bearer ${participant.bearerToken}`,
          "content-type": "application/json",
        },
        method: "POST",
      },
    );
    expect(participantReview.status).toBe(403);

    const reviewResponse = await app.request(
      "/api/v1/decisions/invalidation-review",
      {
        body: JSON.stringify({
          decisionId: draft.decision.decisionId,
          disposition: "confirm_invalidation",
          expectedPosition: invalidations.position,
          idempotencyKey: "facilitator-invalidation-review",
          meetingId,
          reason:
            "The staged regulatory evidence materially affects the launch premise.",
          suggestionId: invalidations.evaluations[0]?.suggestionId,
        }),
        headers,
        method: "POST",
      },
    );
    expect(reviewResponse.status).toBe(200);
    const review = ReviewInvalidationResponseSchema.parse(
      await reviewResponse.json(),
    );
    expect(review).toMatchObject({
      disposition: "confirm_invalidation",
      decision: {
        status: "REVIEW_REQUIRED",
        snapshot: { status: "REVIEW_REQUIRED" },
      },
      heldActionIds: [disposition.actions[0]?.actionId],
      reconsiderationTask: {
        affectedActionIds: [disposition.actions[0]?.actionId],
        affectedPremiseIds: [disposition.premises[0]?.premiseId],
        state: "open",
      },
      reviewReason:
        "The staged regulatory evidence materially affects the launch premise.",
    });

    const reviewedInvalidationsResponse = await app.request(
      `/api/v1/meetings/${meetingId}/invalidation-evaluations`,
      {
        headers: {
          authorization: `Bearer ${participant.bearerToken}`,
        },
      },
    );
    const reviewedInvalidations =
      ListInvalidationEvaluationsResponseSchema.parse(
        await reviewedInvalidationsResponse.json(),
      );
    expect(reviewedInvalidations.evaluations[0]?.review).toMatchObject({
      disposition: "confirm_invalidation",
      heldActionIds: [disposition.actions[0]?.actionId],
      reason:
        "The staged regulatory evidence materially affects the launch premise.",
      reconsiderationTask: { state: "open" },
    });

    const reviewedAuditResponse = await app.request(
      `/api/v1/meetings/${meetingId}/decisions/audit?decisionId=${draft.decision.decisionId}`,
      { headers },
    );
    expect(reviewedAuditResponse.status).toBe(200);
    const reviewedAudit = DecisionAuditResponseSchema.parse(
      await reviewedAuditResponse.json(),
    );
    expect(reviewedAudit.entries.map(({ eventType }) => eventType)).toEqual(
      expect.arrayContaining([
        "FacilitatorReviewed",
        "DecisionReviewRequired",
        "ActionHeld",
        "ReconsiderationTaskCreated",
      ]),
    );

    const staleReady = await app.request("/api/v1/decisions/ready", {
      body: JSON.stringify({
        decisionId: draft.decision.decisionId,
        expectedPosition: draft.position,
        idempotencyKey: "stale-ready",
        meetingId,
      }),
      headers,
      method: "POST",
    });
    expect(staleReady.status).toBe(409);
    expect(ErrorEnvelopeSchema.parse(await staleReady.json())).toMatchObject({
      code: "CONFLICT",
    });

    const records = await runtime.decisions.events.load(meetingId);
    const sharedJson = JSON.stringify(
      records.filter(({ event }) => event.visibility === "shared"),
    );
    expect(sharedJson).toContain("deterministic-assumption-invalidation");
    expect(sharedJson).toContain("assumption_invalidation");
    expect(sharedJson).not.toContain("shared-decision-v1");
    expect(
      records.filter(
        ({ event }) =>
          event.eventType === "DecisionCommitted" &&
          event.visibility === "shared",
      ),
    ).toHaveLength(1);
  });
});
