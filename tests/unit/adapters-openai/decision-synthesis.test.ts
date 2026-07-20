import {
  DeterministicSharedDecisionModel,
  OpenAiSharedDecisionSynthesizer,
  type SharedDecisionModel,
  type SharedDecisionModelRequest,
  type SharedDecisionModelResult,
  type SharedDecisionSynthesisInput,
} from "@counterpoint/adapters-openai";
import type { StructuredLogEntry } from "@counterpoint/ports";
import { PermissionDeniedError } from "openai";
import { describe, expect, it, vi } from "vitest";

const input: SharedDecisionSynthesisInput = {
  actions: [],
  dissent: [],
  evidence: [
    {
      evidenceId: "evidence-shared-1",
      exactSnippet: "Regional launch requires a documented approval gate.",
    },
  ],
  meetingId: "meeting-1",
  participantIds: ["participant-product", "participant-engineering"],
  premises: [],
};

function modelResult(
  overrides: Partial<SharedDecisionModelResult> = {},
): SharedDecisionModelResult {
  return {
    output: {
      action: {
        affectedPremiseIndex: 0,
        ownerParticipantId: "participant-engineering",
        scope: "Document the regional approval gate.",
      },
      confidence: 0.9,
      dissent: {
        reason: "Staffing and rollback ownership remain unresolved.",
        retained: true,
      },
      monitorCondition: "Reopen if the approval gate changes.",
      outcome: "Proceed after the documented approval gate is satisfied.",
      premise: {
        evidenceReferenceIds: ["evidence-shared-1"],
        statement: "Regional launch requires a documented approval gate.",
      },
      reason: "Shared evidence establishes a gating condition.",
      title: "Conditional regional launch",
    },
    responseModel: "gpt-5.6-sol",
    usage: {
      inputTokens: 220,
      outputTokens: 180,
      totalTokens: 400,
    },
    ...overrides,
  };
}

class QueueModel implements SharedDecisionModel {
  readonly requests: SharedDecisionModelRequest[] = [];
  readonly #results: (Error | SharedDecisionModelResult)[];

  constructor(results: (Error | SharedDecisionModelResult)[]) {
    this.#results = results;
  }

  generate(
    request: SharedDecisionModelRequest,
  ): Promise<SharedDecisionModelResult> {
    this.requests.push(request);
    const result = this.#results.shift();
    return result instanceof Error
      ? Promise.reject(result)
      : result === undefined
        ? Promise.reject(new Error("No scripted result."))
        : Promise.resolve(result);
  }
}

describe("OpenAiSharedDecisionSynthesizer", () => {
  it("uses injected full jitter for retry delay", async () => {
    const invalid = modelResult();
    const output = structuredClone(invalid.output) as {
      action: { ownerParticipantId: string };
    };
    output.action.ownerParticipantId = "participant-outsider";
    const delay = vi.fn(() => Promise.resolve());
    const synthesizer = new OpenAiSharedDecisionSynthesizer({
      delay,
      modelAdapter: new QueueModel([{ ...invalid, output }, modelResult()]),
      random: () => 0.5,
    });

    await synthesizer.synthesize(input);

    expect(delay).toHaveBeenCalledExactlyOnceWith(50);
  });

  it("does not delay or retry permission failures", async () => {
    const delay = vi.fn(() => Promise.resolve());
    const model = new QueueModel([
      new PermissionDeniedError(
        403,
        undefined,
        "permission denied",
        new Headers(),
      ),
      modelResult(),
    ]);
    const synthesizer = new OpenAiSharedDecisionSynthesizer({
      delay,
      modelAdapter: model,
      random: () => 0.5,
    });

    await expect(synthesizer.synthesize(input)).rejects.toMatchObject({
      code: "OPENAI_UNAVAILABLE",
      retryable: false,
    });
    expect(model.requests).toHaveLength(1);
    expect(delay).not.toHaveBeenCalled();
  });

  it("returns a versioned candidate grounded only in shared references", async () => {
    const logs: StructuredLogEntry[] = [];
    const model = new QueueModel([modelResult()]);
    const synthesizer = new OpenAiSharedDecisionSynthesizer({
      clock: () => new Date("2026-07-19T08:00:00.000Z"),
      logger: { log: (entry) => logs.push(entry) },
      modelAdapter: model,
    });

    const result = await synthesizer.synthesize(input);

    expect(result).toMatchObject({
      ai: {
        generatedAt: "2026-07-19T08:00:00.000Z",
        inputReferenceIds: ["evidence-shared-1"],
        model: "gpt-5.6-sol",
        operation: "shared_decision_synthesis",
        promptVersion: "shared-decision-v1",
        schemaVersion: "1",
      },
      draft: {
        action: { ownerParticipantId: "participant-engineering" },
        premise: { evidenceReferenceIds: ["evidence-shared-1"] },
      },
    });
    expect(result.billing).toEqual({
      attemptCount: 1,
      attempts: [
        {
          inputTokens: 220,
          model: "gpt-5.6-sol",
          outputTokens: 180,
        },
      ],
      inputTokens: 220,
      outputTokens: 180,
    });
    expect(model.requests[0]).not.toHaveProperty("meetingId");
    expect(JSON.stringify(model.requests)).not.toContain("meeting-1");
    expect(logs[0]?.metadata).toMatchObject({
      inputTokens: 220,
      outputTokens: 180,
      totalTokens: 400,
    });
    expect(JSON.stringify(logs)).not.toContain(input.evidence[0]?.exactSnippet);
  });

  it("meters each response model across an invalid-output retry", async () => {
    const invalid = modelResult({
      responseModel: "gpt-5.6-mini",
      usage: {
        inputTokens: 100,
        outputTokens: 20,
        totalTokens: 120,
      },
    });
    const output = structuredClone(invalid.output) as {
      action: { ownerParticipantId: string };
    };
    output.action.ownerParticipantId = "participant-outsider";
    const model = new QueueModel([{ ...invalid, output }, modelResult()]);
    const synthesizer = new OpenAiSharedDecisionSynthesizer({
      delay: () => Promise.resolve(),
      modelAdapter: model,
    });

    const result = await synthesizer.synthesize(input);

    expect(result.billing).toEqual({
      attemptCount: 2,
      attempts: [
        {
          inputTokens: 100,
          model: "gpt-5.6-mini",
          outputTokens: 20,
        },
        {
          inputTokens: 220,
          model: "gpt-5.6-sol",
          outputTokens: 180,
        },
      ],
      inputTokens: 320,
      outputTokens: 200,
    });
  });

  it("rejects invented evidence and participant references after capped retries", async () => {
    const invalid = modelResult();
    const output = structuredClone(invalid.output) as {
      action: { ownerParticipantId: string };
      premise: { evidenceReferenceIds: string[] };
    };
    output.action.ownerParticipantId = "participant-outsider";
    output.premise.evidenceReferenceIds = ["evidence-private-or-invented"];
    const model = new QueueModel([
      { ...invalid, output },
      { ...invalid, output },
    ]);
    const synthesizer = new OpenAiSharedDecisionSynthesizer({
      delay: () => Promise.resolve(),
      modelAdapter: model,
    });

    await expect(synthesizer.synthesize(input)).rejects.toMatchObject({
      code: "INVALID_MODEL_OUTPUT",
      retryable: true,
    });
    expect(model.requests).toHaveLength(2);
  });

  it("provides a deterministic no-network candidate for integration and E2E", async () => {
    const synthesizer = new OpenAiSharedDecisionSynthesizer({
      modelAdapter: new DeterministicSharedDecisionModel(),
    });

    const result = await synthesizer.synthesize(input);

    expect(result.ai.model).toBe("deterministic-shared-decision");
    expect(result.draft.premise.evidenceReferenceIds).toEqual([
      "evidence-shared-1",
    ]);
    expect(result.draft.action.ownerParticipantId).toBe("participant-product");
  });

  it("fails before model work when shared evidence or participants are absent", async () => {
    const model = new QueueModel([modelResult()]);
    const synthesizer = new OpenAiSharedDecisionSynthesizer({
      modelAdapter: model,
    });

    await expect(
      synthesizer.synthesize({
        ...input,
        evidence: [],
      }),
    ).rejects.toMatchObject({
      code: "INVALID_MODEL_OUTPUT",
      retryable: false,
    });
    expect(model.requests).toHaveLength(0);
  });
});
