import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createLocalServerRuntime,
  createServerApp,
  readServerConfiguration,
  type LocalServerRuntime,
} from "../../apps/server/src/index.js";
import {
  CreateMeetingResponseSchema,
  ErrorEnvelopeSchema,
  JoinMeetingByCodeResponseSchema,
  ListAssignedMeetingsResponseSchema,
  LoginResponseSchema,
} from "@counterpoint/protocol";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];
const runtimes: LocalServerRuntime[] = [];

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "counterpoint-http-"));
  temporaryDirectories.push(directory);
  const runtime = await createLocalServerRuntime(
    readServerConfiguration({
      DATABASE_PATH: join(directory, "counterpoint.sqlite"),
      OPENAI_API_KEY: "",
      PORT: "8787",
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
});
