import { describe, expect, it } from "vitest";

import { deploymentRecord } from "../../scripts/record-cloudflare-deployment.mjs";

interface DeploymentRecord {
  readonly commitSha: string;
  readonly configSha256: string;
  readonly deploymentStatusSha256: string;
  readonly originHost: string;
  readonly recordedAt: string;
  readonly target: string;
  readonly workerName: string;
}

describe("Cloudflare deployment record", () => {
  it("records reproducible hashes without remote IDs or response bodies", () => {
    const databaseId = "a".repeat(32);
    const deploymentVersion = "deployment-version-private-id";
    const record = deploymentRecord({
      commitSha: "b".repeat(40),
      configText: JSON.stringify({ database_id: databaseId }),
      deploymentStatusText: JSON.stringify({ id: deploymentVersion }),
      origin: "https://counterpoint-preview.example.workers.dev",
      recordedAt: "2026-07-19T10:00:00.000Z",
      target: "preview",
      workerName: "counterpoint-living-decisions-preview",
    }) as unknown as DeploymentRecord;

    expect(record).toMatchObject({
      commitSha: "b".repeat(40),
      originHost: "counterpoint-preview.example.workers.dev",
      recordedAt: "2026-07-19T10:00:00.000Z",
      target: "preview",
      workerName: "counterpoint-living-decisions-preview",
    });
    expect(record.configSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(record.deploymentStatusSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(record)).not.toContain(databaseId);
    expect(JSON.stringify(record)).not.toContain(deploymentVersion);
  });

  it.each([
    ["unknown target", { target: "staging" }],
    ["short commit", { commitSha: "abc" }],
    ["unsafe Worker name", { workerName: "unsafe/name" }],
    ["unsafe origin", { origin: "http://worker.example.com" }],
  ])("rejects %s", (_label, override) => {
    expect(() =>
      deploymentRecord({
        commitSha: "b".repeat(40),
        configText: "{}",
        deploymentStatusText: "{}",
        origin: "https://worker.example.com",
        recordedAt: "2026-07-19T10:00:00.000Z",
        target: "preview",
        workerName: "counterpoint-preview",
        ...override,
      }),
    ).toThrow();
  });
});
