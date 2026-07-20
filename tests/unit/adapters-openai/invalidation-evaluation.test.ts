import {
  DeterministicAssumptionInvalidationModel,
  OpenAiAssumptionInvalidationEvaluator,
  OpenAiCandidateError,
  type AssumptionInvalidationEvaluationInput,
  type AssumptionInvalidationModel,
  type AssumptionInvalidationModelRequest,
  type AssumptionInvalidationModelResult,
} from "@counterpoint/adapters-openai";
import type { AssumptionInvalidationEvaluator } from "@counterpoint/application";
import type { StructuredLogEntry } from "@counterpoint/ports";
import { AuthenticationError } from "openai";
import { describe, expect, it, vi } from "vitest";

const input: AssumptionInvalidationEvaluationInput = {
  actions: [
    {
      actionId: "action-europe",
      affectedPremiseIds: ["premise-regulatory"],
      scope: ["European Union rollout"],
      status: "active",
    },
    {
      actionId: "action-europe-notice",
      affectedPremiseIds: ["premise-regulatory"],
      scope: ["Notify European Union launch partners"],
      status: "planned",
    },
    {
      actionId: "action-us",
      affectedPremiseIds: ["premise-us"],
      scope: ["United States rollout"],
      status: "active",
    },
  ],
  decision: {
    decisionId: "decision-rollout",
    monitorCondition: "Reopen if the regional approval gate changes.",
    outcome: "Launch after regional approval.",
    revision: 2,
    revisionId: "decision-rollout-revision-2",
    title: "Conditional regional rollout",
  },
  evidence: [
    {
      evidenceReferenceId: "evidence-shared-regulation",
      exactSnippet: "European launch requires the documented approval gate.",
    },
    {
      evidenceReferenceId: "evidence-shared-scope",
      exactSnippet: "The approval condition applies to the European Union.",
    },
  ],
  externalEvent: {
    description:
      "A synthetic regional regulation changes the documented approval gate.",
    effectiveAt: "2026-08-01T00:00:00.000Z",
    eventType: "regulatory_change",
    externalEventId: "external-event-regulation",
    jurisdiction: "European Union",
    source: "Synthetic regulator",
    sourceReference: "demo://regulatory-change/eu-approval-gate",
  },
  meetingId: "meeting-1",
  premises: [
    {
      confirmationStatus: "confirmed",
      premiseId: "premise-regulatory",
      statement: "The existing European approval gate remains valid.",
    },
    {
      confirmationStatus: "confirmed",
      premiseId: "premise-us",
      statement: "The United States launch has a separate approval path.",
    },
  ],
};

function validResult(
  overrides: Partial<AssumptionInvalidationModelResult> = {},
): AssumptionInvalidationModelResult {
  return {
    output: {
      affectedActionIds: ["action-europe", "action-europe-notice"],
      affectedPremiseIds: ["premise-regulatory"],
      confidence: 0.94,
      evidenceReferenceIds: [
        "evidence-shared-regulation",
        "demo://regulatory-change/eu-approval-gate",
      ],
      reason:
        "The event changes the gate required by the confirmed regional premise.",
    },
    responseModel: "gpt-5.6-2026-07-01",
    usage: {
      inputTokens: 240,
      outputTokens: 80,
      totalTokens: 320,
    },
    ...overrides,
  };
}

class QueueModel implements AssumptionInvalidationModel {
  readonly requests: AssumptionInvalidationModelRequest[] = [];
  readonly #results: (AssumptionInvalidationModelResult | Error)[];

  constructor(results: (AssumptionInvalidationModelResult | Error)[]) {
    this.#results = results;
  }

  generate(
    request: AssumptionInvalidationModelRequest,
  ): Promise<AssumptionInvalidationModelResult> {
    this.requests.push(request);
    const result = this.#results.shift();
    if (result === undefined) {
      return Promise.reject(new Error("No scripted model result remains."));
    }
    return result instanceof Error
      ? Promise.reject(result)
      : Promise.resolve(result);
  }
}

describe("OpenAiAssumptionInvalidationEvaluator", () => {
  it("returns one grounded suggestion with complete versioned provenance", async () => {
    const logs: StructuredLogEntry[] = [];
    const model = new QueueModel([validResult()]);
    const evaluator = new OpenAiAssumptionInvalidationEvaluator({
      clock: () => new Date("2026-07-19T10:00:00.000Z"),
      logger: { log: (entry) => logs.push(entry) },
      modelAdapter: model,
    });
    const structuralEvaluator: AssumptionInvalidationEvaluator = evaluator;

    const result = await evaluator.evaluate(input);
    expect(structuralEvaluator).toBe(evaluator);

    expect(result).toMatchObject({
      ai: {
        generatedAt: "2026-07-19T10:00:00.000Z",
        inputReferenceIds: [
          "external-event-regulation",
          "decision-rollout-revision-2",
          "premise-regulatory",
          "action-europe",
          "action-europe-notice",
          "evidence-shared-regulation",
          "demo://regulatory-change/eu-approval-gate",
        ],
        model: "gpt-5.6-2026-07-01",
        operation: "assumption_invalidation",
        promptVersion: "assumption-invalidation-v1",
        schemaVersion: "1",
      },
      suggestion: {
        affectedActionIds: ["action-europe", "action-europe-notice"],
        affectedPremiseIds: ["premise-regulatory"],
        confidence: 0.94,
        evidenceReferenceIds: [
          "evidence-shared-regulation",
          "demo://regulatory-change/eu-approval-gate",
        ],
      },
    });
    expect(result.billing).toEqual({
      attemptCount: 1,
      attempts: [
        {
          inputTokens: 240,
          model: "gpt-5.6-2026-07-01",
          outputTokens: 80,
        },
      ],
      inputTokens: 240,
      outputTokens: 80,
    });
    expect(result.ai.candidates).toEqual([result.suggestion]);
    expect(result.ai.candidates[0]).toBe(result.suggestion);
    expect(model.requests).toEqual([
      {
        input: {
          actions: input.actions,
          decision: input.decision,
          evidence: input.evidence,
          externalEvent: input.externalEvent,
          premises: input.premises,
        },
        model: "gpt-5.6",
      },
    ]);
    expect(model.requests[0]).not.toHaveProperty("meetingId");
    expect(logs[0]).toMatchObject({
      event: "openai.assumption_invalidation",
      metadata: {
        inputTokens: 240,
        outcome: "success",
        outputTokens: 80,
        retryCount: 0,
        totalTokens: 320,
      },
    });
    const serializedLogs = JSON.stringify(logs);
    expect(serializedLogs).not.toContain(input.externalEvent.description);
    expect(serializedLogs).not.toContain(input.evidence[0]?.exactSnippet);
    expect(serializedLogs).not.toContain(input.decision.outcome);
  });

  it("meters each response model across an invalid-output retry", async () => {
    const invalid = validResult({
      responseModel: "gpt-5.6-mini",
      usage: {
        inputTokens: 180,
        outputTokens: 60,
        totalTokens: 240,
      },
    });
    const output = structuredClone(invalid.output) as {
      evidenceReferenceIds: string[];
    };
    output.evidenceReferenceIds = ["evidence-invented"];
    const model = new QueueModel([
      { ...invalid, output },
      validResult(),
    ]);
    const evaluator = new OpenAiAssumptionInvalidationEvaluator({
      delay: () => Promise.resolve(),
      modelAdapter: model,
    });

    const result = await evaluator.evaluate(input);

    expect(result.billing).toEqual({
      attemptCount: 2,
      attempts: [
        {
          inputTokens: 180,
          model: "gpt-5.6-mini",
          outputTokens: 60,
        },
        {
          inputTokens: 240,
          model: "gpt-5.6-2026-07-01",
          outputTokens: 80,
        },
      ],
      inputTokens: 420,
      outputTokens: 140,
    });
  });

  it("rejects invented references and missing external-event grounding", async () => {
    const invalidReferences = [
      {
        field: "affectedPremiseIds",
        value: ["premise-invented"],
      },
      {
        field: "affectedActionIds",
        value: ["action-invented"],
      },
      {
        field: "evidenceReferenceIds",
        value: ["evidence-invented"],
      },
      {
        field: "evidenceReferenceIds",
        value: ["evidence-shared-regulation"],
      },
    ] as const;

    for (const { field, value } of invalidReferences) {
      const invalid = validResult();
      const output = structuredClone(invalid.output) as Record<
        (typeof invalidReferences)[number]["field"],
        string[]
      >;
      output[field] = [...value];
      const model = new QueueModel([{ ...invalid, output }]);
      const evaluator = new OpenAiAssumptionInvalidationEvaluator({
        maxAttempts: 1,
        modelAdapter: model,
      });

      await expect(evaluator.evaluate(input)).rejects.toMatchObject({
        code: "INVALID_MODEL_OUTPUT",
        retryable: true,
      });
      expect(model.requests).toHaveLength(1);
    }
  });

  it("caps retryable invalid-output attempts at two with bounded backoff", async () => {
    const invalid = validResult();
    const output = structuredClone(invalid.output) as {
      evidenceReferenceIds: string[];
    };
    output.evidenceReferenceIds = ["evidence-invented"];
    const model = new QueueModel([
      { ...invalid, output },
      { ...invalid, output },
      validResult(),
    ]);
    const delay = vi.fn(() => Promise.resolve());
    const evaluator = new OpenAiAssumptionInvalidationEvaluator({
      delay,
      modelAdapter: model,
    });

    await expect(evaluator.evaluate(input)).rejects.toMatchObject({
      code: "INVALID_MODEL_OUTPUT",
      retryable: true,
    });
    expect(model.requests).toHaveLength(2);
    expect(delay).toHaveBeenCalledOnce();
    expect(delay).toHaveBeenCalledWith(100);
    expect(
      () =>
        new OpenAiAssumptionInvalidationEvaluator({
          maxAttempts: 3,
          modelAdapter: model,
        }),
    ).toThrow("maxAttempts must be an integer from 1 to 2.");
  });

  it("does not retry authentication failures", async () => {
    const authError = new AuthenticationError(
      401,
      undefined,
      "invalid key",
      new Headers(),
    );
    const model = new QueueModel([authError, validResult()]);
    const delay = vi.fn(() => Promise.resolve());
    const evaluator = new OpenAiAssumptionInvalidationEvaluator({
      delay,
      modelAdapter: model,
    });

    await expect(evaluator.evaluate(input)).rejects.toEqual(
      new OpenAiCandidateError(
        "OPENAI_UNAVAILABLE",
        "Assumption invalidation evaluation is currently unavailable.",
        false,
      ),
    );
    expect(model.requests).toHaveLength(1);
    expect(delay).not.toHaveBeenCalled();
  });

  it("deterministically flags the first premise and all coherently linked Actions", async () => {
    const evaluator = new OpenAiAssumptionInvalidationEvaluator({
      modelAdapter: new DeterministicAssumptionInvalidationModel(),
    });

    const result = await evaluator.evaluate(input);

    expect(result.ai.model).toBe("deterministic-assumption-invalidation");
    expect(result.suggestion.affectedPremiseIds).toEqual([
      "premise-regulatory",
    ]);
    expect(result.suggestion.affectedActionIds).toEqual([
      "action-europe",
      "action-europe-notice",
    ]);
    expect(result.suggestion.evidenceReferenceIds).toEqual([
      "evidence-shared-regulation",
      "demo://regulatory-change/eu-approval-gate",
    ]);
    expect(result.suggestion.affectedActionIds).not.toContain("action-us");
  });
});
