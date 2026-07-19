/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { createWorkerHandler, type Env } from "../../apps/worker/src/index.js";

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
  });

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
  });
});
