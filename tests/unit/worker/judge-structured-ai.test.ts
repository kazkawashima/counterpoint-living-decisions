import type { PrivateDisclosureBilling } from "@counterpoint/adapters-openai";
import { describe, expect, it } from "vitest";

import {
  JUDGE_GLOBAL_USAGE_LIMITS,
  PRIVATE_DISCLOSURE_CLAIM_TTL_SECONDS,
  PRIVATE_DISCLOSURE_MAX_ATTEMPTS,
  PRIVATE_DISCLOSURE_MAX_SOURCE_BYTES,
  PRIVATE_DISCLOSURE_MODEL,
  PRIVATE_DISCLOSURE_OPERATION,
  PRIVATE_DISCLOSURE_PRICING_VERSION,
  PRIVATE_DISCLOSURE_RESERVED_USAGE,
  assertPrivateDisclosureSourceWithinLimit,
  calculatePrivateDisclosureActualUsage,
  pricePrivateDisclosureUsageMicroUsd,
} from "../../../apps/worker/src/judge-structured-ai.js";

function billing(
  overrides: Partial<PrivateDisclosureBilling> = {},
): PrivateDisclosureBilling {
  const attemptCount = overrides.attemptCount ?? 1;
  const inputTokens = overrides.inputTokens ?? 1;
  const outputTokens = overrides.outputTokens ?? 1;
  return {
    attemptCount,
    attempts:
      overrides.attempts ??
      Array.from({ length: Math.max(0, attemptCount) }, (_, index) => ({
        inputTokens: index === 0 ? inputTokens : 0,
        outputTokens: index === 0 ? outputTokens : 0,
      })),
    inputTokens,
    outputTokens,
    ...overrides,
  };
}

describe("judge structured AI limits", () => {
  it("defines one product-wide rolling usage ceiling and a bounded disclosure envelope", () => {
    expect(JUDGE_GLOBAL_USAGE_LIMITS).toEqual({
      accountRequestsPerWindow: 10,
      concurrentReservations: 1,
      costMicroUsdPerWindow: 25_000_000,
      generationsPerWindow: 8,
      ipRequestsPerWindow: 10,
      meetingRequestsPerWindow: 10,
      realtimeSecondsPerWindow: 30,
      tokensPerWindow: 2_165_600,
    });
    expect(PRIVATE_DISCLOSURE_OPERATION).toBe("private_evidence_disclosure");
    expect(PRIVATE_DISCLOSURE_MODEL).toBe("gpt-5.6");
    expect(PRIVATE_DISCLOSURE_PRICING_VERSION).toBe(
      "openai-gpt-5.6-conservative-2026-07-20",
    );
    expect(PRIVATE_DISCLOSURE_CLAIM_TTL_SECONDS).toBe(120);
    expect(PRIVATE_DISCLOSURE_MAX_ATTEMPTS).toBe(2);
    expect(PRIVATE_DISCLOSURE_MAX_SOURCE_BYTES).toBe(64 * 1024);
    expect(PRIVATE_DISCLOSURE_RESERVED_USAGE).toEqual({
      estimatedCostUsd: 5.5,
      estimatedInputTokens: 540_000,
      estimatedOutputTokens: 1_400,
      generationCount: 2,
      realtimeSeconds: 0,
    });
  });

  it.each([
    ["gpt-5.6-sol", 35],
    ["gpt-5.6", 35],
    ["gpt-5.6-terra", 18],
    ["gpt-5.6-luna", 7],
  ] as const)(
    "prices one input and output token for %s with safe micro-USD rounding",
    (model, expectedMicroUsd) => {
      expect(pricePrivateDisclosureUsageMicroUsd(model, billing())).toBe(
        expectedMicroUsd,
      );
    },
  );

  it("rounds Terra fractional input pricing upward only after exact accumulation", () => {
    expect(
      pricePrivateDisclosureUsageMicroUsd(
        "gpt-5.6-terra",
        billing({ inputTokens: 3, outputTokens: 0 }),
      ),
    ).toBe(8);
  });

  it("applies long-context multipliers to each attempt independently", () => {
    expect(
      pricePrivateDisclosureUsageMicroUsd(
        "gpt-5.6-sol",
        billing({
          attemptCount: 2,
          attempts: [
            { inputTokens: 270_000, outputTokens: 700 },
            { inputTokens: 270_000, outputTokens: 700 },
          ],
          inputTokens: 540_000,
          outputTokens: 1_400,
        }),
      ),
    ).toBe(2_742_000);
    expect(
      pricePrivateDisclosureUsageMicroUsd(
        "gpt-5.6-sol",
        billing({
          attemptCount: 2,
          attempts: [
            { inputTokens: 300_000, outputTokens: 700 },
            { inputTokens: 240_000, outputTokens: 700 },
          ],
          inputTokens: 540_000,
          outputTokens: 1_400,
        }),
      ),
    ).toBe(4_252_500);
  });

  it.each([
    ["unsupported model", "gpt-5.6-2026-07-01", billing()],
    [
      "negative usage",
      "gpt-5.6-sol",
      billing({ inputTokens: -1, outputTokens: 0 }),
    ],
    [
      "non-safe usage",
      "gpt-5.6-sol",
      billing({ inputTokens: Number.MAX_SAFE_INTEGER + 1, outputTokens: 0 }),
    ],
    [
      "fractional usage",
      "gpt-5.6-sol",
      billing({ inputTokens: 0, outputTokens: 0.5 }),
    ],
    [
      "negative output usage",
      "gpt-5.6-sol",
      billing({ inputTokens: 0, outputTokens: -1 }),
    ],
    ["invalid attempt count", "gpt-5.6-sol", billing({ attemptCount: 0 })],
    [
      "mismatched attempt totals",
      "gpt-5.6-sol",
      billing({
        attempts: [{ inputTokens: 2, outputTokens: 1 }],
        inputTokens: 1,
      }),
    ],
  ] as const)("rejects %s", (_label, model, usage) => {
    expect(() =>
      pricePrivateDisclosureUsageMicroUsd(model, usage),
    ).toThrowError();
  });

  it("rejects a safe token count whose calculated cost exceeds safe integer range", () => {
    expect(() =>
      pricePrivateDisclosureUsageMicroUsd(
        "gpt-5.6-sol",
        billing({ inputTokens: 0, outputTokens: Number.MAX_SAFE_INTEGER }),
      ),
    ).toThrowError(/cost exceeds safe integer/u);
  });

  it("returns exact finalization usage inside the reserved envelope", () => {
    expect(
      calculatePrivateDisclosureActualUsage(
        "gpt-5.6-sol",
        billing({
          attemptCount: 2,
          inputTokens: 540_000,
          outputTokens: 1_400,
        }),
      ),
    ).toEqual({
      estimatedCostUsd: 5.463,
      estimatedInputTokens: 540_000,
      estimatedOutputTokens: 1_400,
      generationCount: 2,
      realtimeSeconds: 0,
    });
  });

  it.each([
    billing({ attemptCount: 3 }),
    billing({ inputTokens: 540_001 }),
    billing({ outputTokens: 1_401 }),
  ])("rejects actual usage outside the reserved envelope", (usage) => {
    expect(() =>
      calculatePrivateDisclosureActualUsage("gpt-5.6-sol", usage),
    ).toThrowError(/reservation/u);
  });

  it("enforces the source cap in UTF-8 bytes before billable work", () => {
    expect(() =>
      assertPrivateDisclosureSourceWithinLimit(
        "a".repeat(PRIVATE_DISCLOSURE_MAX_SOURCE_BYTES),
      ),
    ).not.toThrow();
    expect(() =>
      assertPrivateDisclosureSourceWithinLimit(
        "a".repeat(PRIVATE_DISCLOSURE_MAX_SOURCE_BYTES + 1),
      ),
    ).toThrowError(/64 KiB/u);
    expect(() =>
      assertPrivateDisclosureSourceWithinLimit(
        "界".repeat(Math.floor(PRIVATE_DISCLOSURE_MAX_SOURCE_BYTES / 3) + 1),
      ),
    ).toThrowError(/64 KiB/u);
  });
});
