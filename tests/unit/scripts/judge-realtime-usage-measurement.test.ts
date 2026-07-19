import { describe, expect, it } from "vitest";

import { summarizeJudgeRealtimeUsageJsonl } from "../../../scripts/judge-realtime-usage-measurement.mjs";

function sample(index: number): string {
  return JSON.stringify({
    costMicroUsd: index * 100,
    generationCount: Math.ceil(index / 4),
    inputTokens: index * 10,
    outputTokens: index * 5,
    realtimeSeconds: index,
  });
}

describe("judge Realtime usage measurement", () => {
  it("reports deterministic content-free percentiles", () => {
    const summary = summarizeJudgeRealtimeUsageJsonl(
      Array.from({ length: 20 }, (_, index) => sample(index + 1)).join("\n"),
    );

    expect(summary).toEqual({
      dimensions: {
        costMicroUsd: {
          max: 2_000,
          min: 100,
          p50: 1_000,
          p95: 1_900,
          p99: 2_000,
        },
        generationCount: { max: 5, min: 1, p50: 3, p95: 5, p99: 5 },
        inputTokens: {
          max: 200,
          min: 10,
          p50: 100,
          p95: 190,
          p99: 200,
        },
        outputTokens: {
          max: 100,
          min: 5,
          p50: 50,
          p95: 95,
          p99: 100,
        },
        realtimeSeconds: {
          max: 20,
          min: 1,
          p50: 10,
          p95: 19,
          p99: 20,
        },
      },
      sampleCount: 20,
    });
    expect(JSON.stringify(summary)).not.toContain("private");
  });

  it("rejects identifiers, content, unknown dimensions, and malformed counters", () => {
    for (const unsafe of [
      { ...JSON.parse(sample(1)), accountId: "private-account" },
      { ...JSON.parse(sample(1)), transcript: "private words" },
      { ...JSON.parse(sample(1)), inputTokens: -1 },
      { ...JSON.parse(sample(1)), outputTokens: 1.5 },
      { ...JSON.parse(sample(1)), reservationId: "private-reservation" },
    ]) {
      expect(() =>
        summarizeJudgeRealtimeUsageJsonl(JSON.stringify(unsafe)),
      ).toThrow("only bounded counters");
    }
  });
});
