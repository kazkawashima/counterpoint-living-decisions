import type {
  PrivateDisclosureBilling,
  SharedDecisionSynthesisInput,
} from "@counterpoint/adapters-openai";
import { describe, expect, it } from "vitest";

import {
  JUDGE_GLOBAL_USAGE_LIMITS,
  JUDGE_STRUCTURED_INPUT_CANONICALIZATION_VERSION,
  JUDGE_STRUCTURED_AI_DESCRIPTORS,
  ASSUMPTION_INVALIDATION_PRICING_VERSION,
  DECISION_SYNTHESIS_PRICING_VERSION,
  PRIVATE_DISCLOSURE_CLAIM_TTL_SECONDS,
  PRIVATE_DISCLOSURE_MAX_ATTEMPTS,
  PRIVATE_DISCLOSURE_MAX_SOURCE_BYTES,
  PRIVATE_DISCLOSURE_MODEL,
  PRIVATE_DISCLOSURE_OPERATION,
  PRIVATE_DISCLOSURE_PRICING_VERSION,
  PRIVATE_DISCLOSURE_RESERVED_USAGE,
  assertPrivateDisclosureSourceWithinLimit,
  calculateJudgeStructuredAiActualUsage,
  calculatePrivateDisclosureActualUsage,
  canonicalizeJudgeStructuredInput,
  fingerprintJudgeStructuredInput,
  measureJudgeProviderInputBytes,
  priceJudgeStructuredAiUsageMicroUsd,
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
        model: PRIVATE_DISCLOSURE_MODEL,
        outputTokens: index === 0 ? outputTokens : 0,
      })),
    inputTokens,
    outputTokens,
    ...overrides,
  };
}

describe("judge structured AI limits", () => {
  it("defines one product-wide rolling usage ceiling and all operation descriptors", () => {
    expect(JUDGE_GLOBAL_USAGE_LIMITS).toEqual({
      accountRequestsPerWindow: 100,
      concurrentReservations: 1,
      costMicroUsdPerWindow: 25_000_000,
      generationsPerWindow: 64,
      ipRequestsPerWindow: 100,
      meetingRequestsPerWindow: 100,
      realtimeSecondsPerWindow: 600,
      tokensPerWindow: 17_369_600,
    });
    expect(PRIVATE_DISCLOSURE_OPERATION).toBe("private_evidence_disclosure");
    expect(PRIVATE_DISCLOSURE_MODEL).toBe("gpt-5.6");
    expect(PRIVATE_DISCLOSURE_PRICING_VERSION).toBe(
      JUDGE_STRUCTURED_AI_DESCRIPTORS[PRIVATE_DISCLOSURE_OPERATION]
        .pricingVersion,
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
    expect(JUDGE_STRUCTURED_INPUT_CANONICALIZATION_VERSION).toBe(
      "judge-structured-input-v1",
    );
    expect(DECISION_SYNTHESIS_PRICING_VERSION).toContain(
      JUDGE_STRUCTURED_INPUT_CANONICALIZATION_VERSION,
    );
    expect(ASSUMPTION_INVALIDATION_PRICING_VERSION).toContain(
      JUDGE_STRUCTURED_INPUT_CANONICALIZATION_VERSION,
    );
    expect(JUDGE_STRUCTURED_AI_DESCRIPTORS).toEqual({
      assumption_invalidation: {
        claimLeaseSeconds: 120,
        inputJsonMaxBytes: 65_536,
        operation: "assumption_invalidation",
        pricingVersion: ASSUMPTION_INVALIDATION_PRICING_VERSION,
        providerTimeoutMs: 20_000,
        retentionSeconds: 25 * 60 * 60,
        reservedUsage: {
          estimatedCostUsd: 5.5,
          estimatedInputTokens: 540_000,
          estimatedOutputTokens: 1_600,
          generationCount: 2,
          realtimeSeconds: 0,
        },
      },
      private_evidence_disclosure: {
        claimLeaseSeconds: 120,
        inputJsonMaxBytes: 65_536,
        operation: "private_evidence_disclosure",
        pricingVersion: PRIVATE_DISCLOSURE_PRICING_VERSION,
        providerTimeoutMs: 20_000,
        retentionSeconds: 25 * 60 * 60,
        reservedUsage: PRIVATE_DISCLOSURE_RESERVED_USAGE,
      },
      shared_decision_synthesis: {
        claimLeaseSeconds: 120,
        inputJsonMaxBytes: 65_536,
        operation: "shared_decision_synthesis",
        pricingVersion: DECISION_SYNTHESIS_PRICING_VERSION,
        providerTimeoutMs: 20_000,
        retentionSeconds: 25 * 60 * 60,
        reservedUsage: {
          estimatedCostUsd: 5.75,
          estimatedInputTokens: 540_000,
          estimatedOutputTokens: 2_800,
          generationCount: 2,
          realtimeSeconds: 0,
        },
      },
    });
  });

  it("prices mixed GPT-5.6 response models per attempt", () => {
    expect(
      priceJudgeStructuredAiUsageMicroUsd(
        billing({
          attemptCount: 2,
          attempts: [
            { inputTokens: 1, model: "gpt-5.6-luna", outputTokens: 1 },
            { inputTokens: 1, model: "gpt-5.6-sol", outputTokens: 1 },
          ],
          inputTokens: 2,
          outputTokens: 2,
        }),
      ),
    ).toBe(42);
  });

  it("applies long-context pricing to each response attempt independently", () => {
    expect(
      priceJudgeStructuredAiUsageMicroUsd(
        billing({
          attemptCount: 2,
          attempts: [
            {
              inputTokens: 272_001,
              model: "gpt-5.6-sol",
              outputTokens: 1,
            },
            { inputTokens: 1, model: "gpt-5.6-luna", outputTokens: 1 },
          ],
          inputTokens: 272_002,
          outputTokens: 2,
        }),
      ),
    ).toBe(2_720_062);
  });

  it.each(["gpt-5.6-2026-07-01", "gpt-5.6-mini"])(
    "rejects unknown or versioned response model %s",
    (model) => {
      expect(() =>
        priceJudgeStructuredAiUsageMicroUsd(
          billing({
            attempts: [{ inputTokens: 1, model, outputTokens: 1 }],
          }),
        ),
      ).toThrowError(/Unsupported structured AI response model/u);
    },
  );

  it("rejects unsafe pricing arithmetic", () => {
    expect(() =>
      priceJudgeStructuredAiUsageMicroUsd(
        billing({
          attempts: [
            {
              inputTokens: 0,
              model: "gpt-5.6-sol",
              outputTokens: Number.MAX_SAFE_INTEGER,
            },
          ],
          inputTokens: 0,
          outputTokens: Number.MAX_SAFE_INTEGER,
        }),
      ),
    ).toThrowError(/safe integer/u);
  });

  it.each([
    ["private_evidence_disclosure", billing({ outputTokens: 1_401 })],
    ["shared_decision_synthesis", billing({ outputTokens: 2_801 })],
    ["assumption_invalidation", billing({ outputTokens: 1_601 })],
  ] as const)("rejects %s usage outside its envelope", (operation, usage) => {
    expect(() =>
      calculateJudgeStructuredAiActualUsage(operation, usage),
    ).toThrowError(/reservation/u);
  });

  it("measures the exact UTF-8 provider JSON without meetingId", () => {
    const input = {
      evidence: [{ evidenceId: "evidence-界", exactSnippet: "界" }],
      meetingId: "must-not-be-sent",
      participantIds: ["participant-2", "participant-1"],
    };
    const providerInput = {
      evidence: input.evidence,
      participantIds: input.participantIds,
    };

    expect(measureJudgeProviderInputBytes(input)).toBe(
      new TextEncoder().encode(JSON.stringify(providerInput)).byteLength,
    );
  });

  it("canonicalizes entity sets but preserves Action scope order", () => {
    const first: SharedDecisionSynthesisInput = {
      actions: [
        { actionId: "b", scope: ["first", "second"], status: "active" },
        { actionId: "a", scope: ["third"], status: "planned" },
      ],
      dissent: [
        { dissentId: "d2", reason: "second", retained: true },
        { dissentId: "d1", reason: "first", retained: false },
      ],
      evidence: [
        { evidenceId: "e2", exactSnippet: "second" },
        { evidenceId: "e1", exactSnippet: "first" },
      ],
      meetingId: "meeting-1",
      participantIds: ["participant-2", "participant-1"],
      premises: [
        { premiseId: "p2", statement: "second" },
        { premiseId: "p1", statement: "first" },
      ],
    };
    const reordered = {
      ...first,
      actions: [first.actions[1]!, first.actions[0]!],
      dissent: [first.dissent[1]!, first.dissent[0]!],
      evidence: [first.evidence[1]!, first.evidence[0]!],
      participantIds: ["participant-1", "participant-2"],
      premises: [first.premises[1]!, first.premises[0]!],
    };
    const changedScope = {
      ...first,
      actions: [
        { ...first.actions[0]!, scope: ["second", "first"] },
        first.actions[1]!,
      ],
    };

    expect(canonicalizeJudgeStructuredInput(first)).toBe(
      canonicalizeJudgeStructuredInput(reordered),
    );
    expect(canonicalizeJudgeStructuredInput(first)).not.toBe(
      canonicalizeJudgeStructuredInput(changedScope),
    );
  });

  it.each([
    ["Date", new Date("2026-07-20T00:00:00.000Z")],
    ["Map", new Map([["key", "value"]])],
    ["Set", new Set(["value"])],
    ["non-plain prototype", Object.create({ inherited: true })],
  ])("rejects non-JSON %s objects", (_label, value) => {
    expect(() => canonicalizeJudgeStructuredInput(value)).toThrowError(
      /non-JSON/u,
    );
  });

  it("rejects symbol-keyed plain objects", () => {
    expect(() =>
      canonicalizeJudgeStructuredInput({
        [Symbol("hidden")]: "value",
        visible: "value",
      }),
    ).toThrowError(/non-JSON/u);
  });

  it("accepts JSON objects with a null prototype", () => {
    const value = Object.assign(
      Object.create(null) as Record<string, unknown>,
      {
        first: true,
        second: "value",
      },
    );

    expect(canonicalizeJudgeStructuredInput(value)).toBe(
      '{"first":true,"second":"value"}',
    );
  });

  it("rejects sparse arrays instead of colliding with explicit null", () => {
    const sparse: unknown[] = [];
    sparse.length = 1;

    expect(() => canonicalizeJudgeStructuredInput(sparse)).toThrowError(
      /non-JSON/u,
    );
    expect(canonicalizeJudgeStructuredInput([null])).toBe("[null]");
  });

  it("rejects arrays with non-index own properties", () => {
    const value = ["visible"];
    Object.defineProperty(value, "hidden", {
      enumerable: true,
      value: "value",
    });

    expect(() => canonicalizeJudgeStructuredInput(value)).toThrowError(
      /non-JSON/u,
    );
  });

  it("rejects object accessors before executing getters", () => {
    let getterExecutions = 0;
    let setterExecutions = 0;
    const withGetter = {};
    Object.defineProperty(withGetter, "value", {
      enumerable: true,
      get() {
        getterExecutions += 1;
        return "must-not-be-read";
      },
    });
    const withSetter = {};
    Object.defineProperty(withSetter, "value", {
      enumerable: true,
      set(_value: unknown) {
        void _value;
        setterExecutions += 1;
      },
    });

    expect(() => canonicalizeJudgeStructuredInput(withGetter)).toThrowError(
      /non-JSON/u,
    );
    expect(getterExecutions).toBe(0);
    expect(() => canonicalizeJudgeStructuredInput(withSetter)).toThrowError(
      /non-JSON/u,
    );
    expect(setterExecutions).toBe(0);
  });

  it("rejects array accessors before executing getters", () => {
    let getterExecutions = 0;
    let setterExecutions = 0;
    const withGetter = ["placeholder"];
    Object.defineProperty(withGetter, "0", {
      enumerable: true,
      get() {
        getterExecutions += 1;
        return "must-not-be-read";
      },
    });
    const withSetter = ["placeholder"];
    Object.defineProperty(withSetter, "0", {
      enumerable: true,
      set(_value: unknown) {
        void _value;
        setterExecutions += 1;
      },
    });

    expect(() => canonicalizeJudgeStructuredInput(withGetter)).toThrowError(
      /non-JSON/u,
    );
    expect(getterExecutions).toBe(0);
    expect(() => canonicalizeJudgeStructuredInput(withSetter)).toThrowError(
      /non-JSON/u,
    );
    expect(setterExecutions).toBe(0);
  });

  it("rejects Array subclasses and arrays with custom prototypes", () => {
    class DerivedArray<T> extends Array<T> {}

    const customPrototype = ["value"];
    Object.setPrototypeOf(customPrototype, {
      custom: true,
    });

    expect(() =>
      canonicalizeJudgeStructuredInput(DerivedArray.of("value")),
    ).toThrowError(/non-JSON/u);
    expect(() =>
      canonicalizeJudgeStructuredInput(customPrototype),
    ).toThrowError(/non-JSON/u);
  });

  it("fingerprints canonical content and canonicalization version", async () => {
    const left = {
      actions: [{ actionId: "b" }, { actionId: "a" }],
      participantIds: ["p2", "p1"],
    };
    const right = {
      participantIds: ["p1", "p2"],
      actions: [{ actionId: "a" }, { actionId: "b" }],
    };

    const first = await fingerprintJudgeStructuredInput(left);
    expect(first).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(await fingerprintJudgeStructuredInput(right)).toBe(first);
    expect(
      await fingerprintJudgeStructuredInput({
        ...right,
        actions: [{ actionId: "changed" }],
      }),
    ).not.toBe(first);
    expect(
      await fingerprintJudgeStructuredInput(right, "judge-structured-input-v2"),
    ).not.toBe(first);
  });

  it.each([
    ["gpt-5.6-sol", 35],
    ["gpt-5.6", 35],
    ["gpt-5.6-terra", 18],
    ["gpt-5.6-luna", 7],
  ] as const)(
    "prices one input and output token for %s with safe micro-USD rounding",
    (model, expectedMicroUsd) => {
      expect(
        pricePrivateDisclosureUsageMicroUsd(
          model,
          billing({
            attempts: [{ inputTokens: 1, model, outputTokens: 1 }],
          }),
        ),
      ).toBe(expectedMicroUsd);
    },
  );

  it("rounds Terra fractional input pricing upward only after exact accumulation", () => {
    expect(
      pricePrivateDisclosureUsageMicroUsd(
        "gpt-5.6-terra",
        billing({
          attempts: [
            { inputTokens: 3, model: "gpt-5.6-terra", outputTokens: 0 },
          ],
          inputTokens: 3,
          outputTokens: 0,
        }),
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
            {
              inputTokens: 270_000,
              model: "gpt-5.6-sol",
              outputTokens: 700,
            },
            {
              inputTokens: 270_000,
              model: "gpt-5.6-sol",
              outputTokens: 700,
            },
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
            {
              inputTokens: 300_000,
              model: "gpt-5.6-sol",
              outputTokens: 700,
            },
            {
              inputTokens: 240_000,
              model: "gpt-5.6-sol",
              outputTokens: 700,
            },
          ],
          inputTokens: 540_000,
          outputTokens: 1_400,
        }),
      ),
    ).toBe(4_252_500);
  });

  it.each([
    [
      "unsupported model",
      "gpt-5.6-2026-07-01",
      billing({
        attempts: [
          {
            inputTokens: 1,
            model: "gpt-5.6-2026-07-01",
            outputTokens: 1,
          },
        ],
      }),
    ],
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
        attempts: [{ inputTokens: 2, model: "gpt-5.6-sol", outputTokens: 1 }],
        inputTokens: 1,
      }),
    ],
  ] as const)("rejects %s", (_label, model, usage) => {
    expect(() =>
      pricePrivateDisclosureUsageMicroUsd(model, usage),
    ).toThrowError();
  });

  it("rejects an unsupported configured private pricing model even with supported attempt models", () => {
    expect(() =>
      pricePrivateDisclosureUsageMicroUsd(
        "gpt-5.6-unsupported",
        billing({
          attempts: [{ inputTokens: 1, model: "gpt-5.6-sol", outputTokens: 1 }],
        }),
      ),
    ).toThrowError(/Unsupported structured AI response model/u);
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

  it("rejects an unsupported configured private calculation model even with supported attempt models", () => {
    expect(() =>
      calculatePrivateDisclosureActualUsage(
        "gpt-5.6-unsupported",
        billing({
          attempts: [{ inputTokens: 1, model: "gpt-5.6-sol", outputTokens: 1 }],
        }),
      ),
    ).toThrowError(/Unsupported structured AI response model/u);
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
