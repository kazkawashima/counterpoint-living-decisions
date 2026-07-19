/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { meetingCoordinatorFor } from "../../apps/worker/src/index.js";
import { meetingCoordinatorContract } from "../contract/meeting-coordinator-contract.js";

describe("Cloudflare meeting Durable Object coordination", () => {
  it("satisfies ordering, resume, idempotency, revocation, and reset parity", async () => {
    const coordinator = meetingCoordinatorFor(
      env,
      "meeting-coordination-contract",
    );
    await meetingCoordinatorContract(async (path, body) => {
      const response = await coordinator.fetch(
        `https://meeting-coordinator.internal${path}`,
        {
          body: JSON.stringify(body),
          headers: { "content-type": "application/json" },
          method: "POST",
        },
      );
      return {
        body: await response.json(),
        status: response.status,
      };
    });

    const health = await coordinator.fetch(
      "https://meeting-coordinator.internal/health",
    );
    await expect(health.json()).resolves.toEqual({
      durableTruth: "d1",
      publications: 4,
      status: "ok",
      tickets: 0,
    });
  });
});
