import { describe, expect, it } from "vitest";

import {
  assertPersistedComposeProjection,
  composeSmokeEnvironment,
  composeSmokeTerminalFailure,
  runComposePersistenceSmoke,
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

  it("requires the uploaded artifact and committed revision after recreation", () => {
    const persisted = {
      meeting: {
        meetingId: "meeting-compose-persisted",
        purpose: "Compose restart survival check",
      },
      privateWorkspace: {
        artifacts: [
          {
            derivedArtifactId: "artifact-compose-derived",
            filename: "compose-persistence.md",
            processingState: "processed",
            sourceArtifactId: "artifact-compose-upload",
          },
        ],
        sources: [{ sourceArtifactId: "artifact-compose-marker" }],
      },
      shared: {
        decisions: [
          {
            activeRevision: 2,
            decisionId: "decision-compose-persisted",
            status: "COMMITTED",
          },
        ],
      },
    };
    const expected = {
      artifactId: "artifact-compose-upload",
      derivedArtifactId: "artifact-compose-derived",
      filename: "compose-persistence.md",
      decisionId: "decision-compose-persisted",
      meetingId: "meeting-compose-persisted",
      processingState: "processed",
      purpose: "Compose restart survival check",
      revision: 2,
    };

    expect(() =>
      assertPersistedComposeProjection(
        persisted,
        "artifact-compose-marker",
        expected,
      ),
    ).not.toThrow();
    expect(() =>
      assertPersistedComposeProjection(
        {
          ...persisted,
          privateWorkspace: { ...persisted.privateWorkspace, artifacts: [] },
        },
        "artifact-compose-marker",
        expected,
      ),
    ).toThrow("uploaded artifact did not survive");
    expect(() =>
      assertPersistedComposeProjection(
        {
          ...persisted,
          privateWorkspace: {
            ...persisted.privateWorkspace,
            artifacts: [
              {
                ...persisted.privateWorkspace.artifacts[0],
                filename: "corrupted-after-restart.md",
              },
            ],
          },
        },
        "artifact-compose-marker",
        expected,
      ),
    ).toThrow("uploaded artifact metadata did not survive");
    for (const artifact of [
      {
        ...persisted.privateWorkspace.artifacts[0],
        derivedArtifactId: "artifact-wrong-derived",
      },
      {
        ...persisted.privateWorkspace.artifacts[0],
        processingState: "failed",
      },
    ]) {
      expect(() =>
        assertPersistedComposeProjection(
          {
            ...persisted,
            privateWorkspace: {
              ...persisted.privateWorkspace,
              artifacts: [artifact],
            },
          },
          "artifact-compose-marker",
          expected,
        ),
      ).toThrow("uploaded artifact metadata did not survive");
    }
    expect(() =>
      assertPersistedComposeProjection(
        {
          ...persisted,
          shared: { decisions: [] },
        },
        "artifact-compose-marker",
        expected,
      ),
    ).toThrow("committed Decision did not survive");
    for (const decision of [
      {
        ...persisted.shared.decisions[0],
        activeRevision: 1,
      },
      {
        ...persisted.shared.decisions[0],
        status: "DRAFT",
      },
    ]) {
      expect(() =>
        assertPersistedComposeProjection(
          {
            ...persisted,
            shared: { decisions: [decision] },
          },
          "artifact-compose-marker",
          expected,
        ),
      ).toThrow("committed Decision did not survive");
    }
    expect(() =>
      assertPersistedComposeProjection(
        {
          ...persisted,
          meeting: {
            ...persisted.meeting,
            purpose: "Wrong meeting after restart",
          },
        },
        "artifact-compose-marker",
        expected,
      ),
    ).toThrow("created meeting did not survive");
  });

  it("preserves the primary Compose failure when cleanup also fails", async () => {
    const execFile = (
      _file: string,
      args: readonly string[],
    ): Promise<never> => {
      if (args.includes("up")) {
        return Promise.reject(
          Object.assign(new Error("primary command failed"), {
            stderr: "primary compose stderr",
          }),
        );
      }
      return Promise.reject(
        Object.assign(new Error("cleanup command failed"), {
          stderr: "cleanup compose stderr",
        }),
      );
    };

    try {
      await runComposePersistenceSmoke({
        environment: {},
        execFile,
        port: 18_765,
        projectName: "counterpoint-smoke-cleanup-proof",
        root: "/tmp/counterpoint-smoke-cleanup-proof",
      });
      throw new Error("expected Compose smoke failure");
    } catch (cause) {
      expect(cause).toBeInstanceOf(AggregateError);
      const failures = (cause as AggregateError).errors as readonly Error[];
      expect(failures[0]?.message).toContain("primary compose stderr");
      expect(failures[1]?.message).toContain("cleanup compose stderr");
    }
  });

  it("does not swallow an interrupt received outside a Docker command", () => {
    const interruption = new Error("Compose smoke interrupted by SIGTERM");
    expect(
      composeSmokeTerminalFailure(undefined, interruption, undefined),
    ).toBe(interruption);
    expect(
      composeSmokeTerminalFailure(
        new Error("active command aborted"),
        interruption,
        undefined,
      ),
    ).toBeUndefined();
  });
});
