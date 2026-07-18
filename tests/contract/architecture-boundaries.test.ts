import { describe, expect, it } from "vitest";

import {
  checkArchitecture,
  findArchitectureViolations,
} from "../../scripts/check-architecture.mjs";

describe("architecture dependency boundaries", () => {
  it("accepts the repository dependency graph", async () => {
    await expect(checkArchitecture()).resolves.toEqual([]);
  });

  it("rejects a deliberate domain runtime dependency fixture", () => {
    expect(
      findArchitectureViolations({
        packageName: "domain",
        source: 'import { createServer } from "node:http";',
        sourcePath: "fixture/domain.ts",
      }),
    ).toEqual([
      "fixture/domain.ts: domain cannot import runtime dependency node:http",
    ]);
  });

  it("rejects a deliberate upward internal dependency fixture", () => {
    expect(
      findArchitectureViolations({
        packageName: "ports",
        source: 'import { execute } from "@counterpoint/application";',
        sourcePath: "fixture/ports.ts",
      }),
    ).toEqual([
      "fixture/ports.ts: ports cannot import @counterpoint/application",
    ]);
  });

  it("rejects OpenAI adapter imports from apps or sibling runtime adapters", () => {
    expect(
      findArchitectureViolations({
        packageName: "adapters-openai",
        source: 'import { startServer } from "@counterpoint/adapters-node";',
        sourcePath: "fixture/adapters-openai.ts",
      }),
    ).toEqual([
      "fixture/adapters-openai.ts: adapters-openai cannot import @counterpoint/adapters-node",
    ]);
  });
});
