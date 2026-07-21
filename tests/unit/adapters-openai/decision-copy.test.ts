import {
  OpenAiSharedDecisionModel,
  OpenAiSharedDecisionSynthesizer,
  normalizeDecisionCandidateCopy,
  type DecisionCandidateCopy,
  type SharedDecisionModel,
  type SharedDecisionModelRequest,
  type SharedDecisionModelResult,
  type SharedDecisionSynthesisInput,
} from "@counterpoint/adapters-openai";
import type OpenAI from "openai";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

const synthesisInput: SharedDecisionSynthesisInput = {
  actions: [],
  dissent: [],
  evidence: [
    {
      evidenceId: "evidence-shared-1",
      exactSnippet: "Regional launch requires a documented approval gate.",
    },
  ],
  meetingId: "meeting-1",
  participantIds: ["participant-product"],
  premises: [],
};

const wrappedModelOutput = {
  action: {
    affectedPremiseIndex: 0 as const,
    ownerParticipantId: "participant-product",
    scope: "Document the regional approval gate.",
  },
  confidence: 0.9,
  dissent: {
    reason: "Staffing remains unresolved.",
    retained: true,
  },
  monitorCondition: "Reopen if the approval gate changes.",
  outcome:
    "AI‑proposed outcome pending facilitator confirmation: regional launch proceeds only through a documented approval gate.",
  premise: {
    evidenceReferenceIds: ["evidence-shared-1"],
    statement: "Regional launch requires a documented approval gate.",
  },
  reason: "Shared evidence establishes a gating condition.",
  title: "AI‑Proposed: Establish Regional Launch Approval Gate",
};

class WrappedDecisionModel implements SharedDecisionModel {
  generate(
    _request: SharedDecisionModelRequest,
  ): Promise<SharedDecisionModelResult> {
    return Promise.resolve({
      output: wrappedModelOutput,
      responseModel: "gpt-5.6-sol",
    });
  }
}

describe("normalizeDecisionCandidateCopy", () => {
  it("removes the observed leading workflow wrappers and restores capitalization", () => {
    expect(
      normalizeDecisionCandidateCopy({
        outcome:
          "AI-proposed outcome pending facilitator confirmation: regional launch proceeds only through a documented approval gate.",
        title: "AI-Proposed: Establish Regional Launch Approval Gate",
      }),
    ).toEqual({
      outcome:
        "Regional launch proceeds only through a documented approval gate.",
      title: "Establish Regional Launch Approval Gate",
    });
  });

  it("leaves ordinary prose and non-leading workflow phrases unchanged", () => {
    const copy = {
      outcome:
        "Proceed with the AI rollout; pending facilitator confirmation remains an audit note.",
      title: "Regional AI rollout",
    };

    expect(normalizeDecisionCandidateCopy(copy)).toBe(copy);
  });

  it("accepts Unicode hyphen and non-breaking hyphen variants in the known wrapper", () => {
    expect(
      normalizeDecisionCandidateCopy({
        outcome:
          "AI‑proposed outcome pending facilitator confirmation: regional launch proceeds only through a documented approval gate.",
        title: "AI‐Proposed: establish regional launch approval gate",
      }),
    ).toEqual({
      outcome:
        "Regional launch proceeds only through a documented approval gate.",
      title: "Establish regional launch approval gate",
    });
  });

  it.each(["eBay launch", "iPhone rollout", "eIDAS compliance"])(
    "preserves the substantive camel-case name in %s",
    (substantive) => {
      expect(
        normalizeDecisionCandidateCopy({
          outcome: `AI-proposed outcome pending facilitator confirmation: ${substantive}`,
          title: `AI-Proposed: ${substantive}`,
        }),
      ).toEqual({
        outcome: substantive,
        title: substantive,
      });
    },
  );

  it("retains the original field when removing a wrapper would empty it", () => {
    expect(
      normalizeDecisionCandidateCopy({
        outcome: "AI-proposed outcome pending facilitator confirmation:   ",
        title: "AI-Proposed:   ",
      }),
    ).toEqual({
      outcome: "AI-proposed outcome pending facilitator confirmation:   ",
      title: "AI-Proposed:   ",
    });
  });

  it("preserves other candidate fields", () => {
    const candidate = {
      confidence: 0.78,
      outcome:
        "AI-proposed outcome pending facilitator confirmation: launch after approval.",
      title: "AI-Proposed: launch gate",
    };

    expect(normalizeDecisionCandidateCopy(candidate)).toEqual({
      confidence: 0.78,
      outcome: "Launch after approval.",
      title: "Launch gate",
    });
  });

  it("widens normalized copy fields while preserving the remaining candidate type", () => {
    const candidate = {
      confidence: 0.78 as const,
      outcome:
        "AI-proposed outcome pending facilitator confirmation: launch after approval." as const,
      title: "AI-Proposed: launch gate" as const,
    };

    const normalized = normalizeDecisionCandidateCopy(candidate);

    expectTypeOf(normalized).toEqualTypeOf<
      Omit<typeof candidate, "title" | "outcome"> & DecisionCandidateCopy
    >();
  });
});

describe("Decision synthesis copy boundary", () => {
  it("normalizes parsed model output before returning it to the browser", async () => {
    const synthesizer = new OpenAiSharedDecisionSynthesizer({
      modelAdapter: new WrappedDecisionModel(),
    });

    const result = await synthesizer.synthesize(synthesisInput);

    expect(result.draft.title).toBe("Establish Regional Launch Approval Gate");
    expect(result.draft.outcome).toBe(
      "Regional launch proceeds only through a documented approval gate.",
    );
    expect(result.ai.candidates[0]).toBe(result.draft);
  });

  it("instructs the model to keep workflow status out of substantive copy", async () => {
    const parse = vi.fn().mockResolvedValue({
      model: "gpt-5.6-sol",
      output_parsed: wrappedModelOutput,
    });
    const model = new OpenAiSharedDecisionModel({
      apiKey: "test-key",
      client: { responses: { parse } } as unknown as OpenAI,
    });

    await model.generate({
      input: {
        actions: synthesisInput.actions,
        dissent: synthesisInput.dissent,
        evidence: synthesisInput.evidence,
        participantIds: synthesisInput.participantIds,
        premises: synthesisInput.premises,
      },
      model: "gpt-5.6-sol",
    });

    const request = parse.mock.calls[0]?.[0] as { instructions?: string };
    expect(request.instructions).toContain(
      "Do not put provenance or workflow status phrases such as AI-Proposed or pending facilitator confirmation inside title or outcome; the UI labels provenance separately.",
    );
  });
});
