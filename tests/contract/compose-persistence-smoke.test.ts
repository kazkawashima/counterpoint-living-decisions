import { describe, expect, it } from "vitest";

import {
  assertPersistedComposeProjection,
  composeSmokeEnvironment,
} from "../../scripts/compose-persistence-smoke.mjs";

describe("Compose persistence smoke safety", () => {
  it("uses an isolated project and clears locally configured credentials", () => {
    expect(
      composeSmokeEnvironment(
        {
          COMPOSE_PROJECT_NAME: "counterpoint-smoke-123",
          OPENAI_API_KEY: "must-not-enter-compose",
          REGULATORY_WEBHOOK_SECRET: "must-not-enter-compose",
        },
        { port: 18_123, projectName: "counterpoint-smoke-123" },
      ),
    ).toMatchObject({
      COMPOSE_PORT: "18123",
      COMPOSE_PROJECT_NAME: "counterpoint-smoke-123",
      OPENAI_API_KEY: "",
      PUBLIC_HOST: "127.0.0.2",
      REGULATORY_WEBHOOK_SECRET: "",
    });
    expect(() => {
      composeSmokeEnvironment(
        {},
        { port: 18_123, projectName: "counterpoint" },
      );
    }).toThrow("isolated counterpoint-smoke- project name");
  });

  it("requires the same authenticated private source after recreation", () => {
    expect(() =>
      assertPersistedComposeProjection(
        {
          privateWorkspace: {
            sources: [{ sourceArtifactId: "artifact-compose-marker" }],
          },
        },
        "artifact-compose-marker",
      ),
    ).not.toThrow();
    expect(() =>
      assertPersistedComposeProjection(
        { privateWorkspace: { sources: [] } },
        "artifact-compose-marker",
      ),
    ).toThrow("private source did not survive container recreation");
  });
});
