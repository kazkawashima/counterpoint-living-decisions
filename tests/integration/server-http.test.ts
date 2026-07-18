import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
  CreateMeetingResponseSchema,
  ErrorEnvelopeSchema,
  JoinMeetingByCodeResponseSchema,
  ListAssignedMeetingsResponseSchema,
  ListSharedEvidenceResponseSchema,
  LoginResponseSchema,
  PreviewDisclosureResponseSchema,
  ProposeDisclosureResponseSchema,
  ReadinessResponseSchema,
  RegisterPrivateTextSourceFixtureResponseSchema,
} from "@counterpoint/protocol";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];
const runtimes: LocalServerRuntime[] = [];

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
});
