import {
  DispositionSharedDecisionCandidateRequestSchema,
  SynthesizeSharedDecisionRequestSchema,
  SynthesizeSharedDecisionResponseSchema,
  type DispositionSharedDecisionCandidateRequest,
  type SynthesizeSharedDecisionResponse,
} from "@counterpoint/protocol";
import { describe, expect, expectTypeOf, it } from "vitest";

const meetingMutation = {
  meetingId: "meeting-1",
  expectedPosition: 7,
  idempotencyKey: "synthesis-1",
  correlationId: "correlation-1",
};

const candidateDraft = {
  title: "Conditional regional launch",
  outcome: "Proceed after the documented approval gate is satisfied.",
  premiseCandidates: [
    {
      candidateId: "premise-candidate-1",
      statement: "Regional launch requires a documented approval gate.",
      evidenceReferenceIds: ["evidence-shared-1"],
      confidence: 0.9,
      reason: "The shared evidence explicitly establishes the gate.",
    },
  ],
  dissentCandidates: [
    {
      candidateId: "dissent-candidate-1",
      reason: "Staffing and rollback ownership remain unresolved.",
      retained: true,
    },
  ],
  actionCandidates: [
    {
      candidateId: "action-candidate-1",
      ownerParticipantId: "participant-engineering",
      scope: ["Document the regional approval gate."],
    },
  ],
  monitorCondition: {
    description: "Reopen if the approval gate changes.",
  },
};

const manualDraft = {
  title: candidateDraft.title,
  outcome: candidateDraft.outcome,
  premises: [
    {
      statement: candidateDraft.premiseCandidates[0]?.statement,
      evidenceReferenceIds: ["evidence-shared-1"],
    },
  ],
  dissent: [
    {
      reason: "Staffing and rollback ownership remain unresolved.",
      retained: true,
    },
  ],
  actions: [
    {
      ownerParticipantId: "participant-engineering",
      scope: ["Document the regional approval gate."],
    },
  ],
  monitorCondition: candidateDraft.monitorCondition,
};

describe("shared Decision synthesis HTTP protocol", () => {
  it("accepts a strict facilitator request and AI-assisted candidate envelope", () => {
    expect(
      SynthesizeSharedDecisionRequestSchema.safeParse({
        ...meetingMutation,
        assistance: "ai_preferred",
      }).success,
    ).toBe(true);

    const response = SynthesizeSharedDecisionResponseSchema.parse({
      meetingId: "meeting-1",
      position: 8,
      correlationId: "correlation-1",
      candidate: {
        candidateId: "decision-candidate-1",
        provenance: {
          origin: "ai_assisted",
          model: "gpt-5.6",
          operation: "shared_decision_synthesis",
          promptVersion: "shared-decision-v1",
          schemaVersion: "1",
          inputReferenceIds: ["evidence-shared-1"],
          generatedAt: "2026-07-19T08:00:00.000Z",
          confidence: 0.88,
          reason: "Shared evidence supports a conditional launch draft.",
        },
        draft: candidateDraft,
      },
    });

    expectTypeOf(response).toEqualTypeOf<SynthesizeSharedDecisionResponse>();
    expect(response.candidate.provenance.origin).toBe("ai_assisted");
  });

  it("accepts a manual request and human-authored envelope without AI provenance", () => {
    expect(
      SynthesizeSharedDecisionRequestSchema.safeParse({
        ...meetingMutation,
        assistance: "manual",
        draft: manualDraft,
      }).success,
    ).toBe(true);

    expect(
      SynthesizeSharedDecisionResponseSchema.safeParse({
        meetingId: "meeting-1",
        position: 8,
        correlationId: "correlation-1",
        candidate: {
          candidateId: "decision-candidate-manual-1",
          provenance: { origin: "human_authored" },
          draft: candidateDraft,
        },
      }).success,
    ).toBe(true);
  });

  it("requires the complete AI envelope and forbids AI-only human provenance", () => {
    const envelope = {
      meetingId: "meeting-1",
      position: 8,
      correlationId: "correlation-1",
      candidate: {
        candidateId: "decision-candidate-1",
        provenance: {
          origin: "ai_assisted",
          model: "gpt-5.6",
          operation: "shared_decision_synthesis",
          promptVersion: "shared-decision-v1",
          schemaVersion: "1",
          inputReferenceIds: ["evidence-shared-1"],
          generatedAt: "2026-07-19T08:00:00.000Z",
          confidence: 0.88,
          reason: "Shared evidence supports a conditional launch draft.",
        },
        draft: candidateDraft,
      },
    } as const;

    for (const requiredField of [
      "generatedAt",
      "inputReferenceIds",
      "confidence",
      "reason",
    ] as const) {
      const incompleteProvenance: Record<string, unknown> = {
        ...envelope.candidate.provenance,
      };
      delete incompleteProvenance[requiredField];
      expect(
        SynthesizeSharedDecisionResponseSchema.safeParse({
          ...envelope,
          candidate: {
            ...envelope.candidate,
            provenance: incompleteProvenance,
          },
        }).success,
      ).toBe(false);
    }
    expect(
      SynthesizeSharedDecisionResponseSchema.safeParse({
        ...envelope,
        candidate: {
          ...envelope.candidate,
          provenance: {
            origin: "human_authored",
            model: "must-not-be-present",
          },
        },
      }).success,
    ).toBe(false);
  });

  it("requires human content only for the manual synthesis branch", () => {
    expect(
      SynthesizeSharedDecisionRequestSchema.safeParse({
        ...meetingMutation,
        assistance: "manual",
      }).success,
    ).toBe(false);
    expect(
      SynthesizeSharedDecisionRequestSchema.safeParse({
        ...meetingMutation,
        assistance: "ai_preferred",
        draft: manualDraft,
      }).success,
    ).toBe(false);
  });

  it("limits premise sources to strict EvidenceId reference arrays", () => {
    expect(
      SynthesizeSharedDecisionResponseSchema.safeParse({
        meetingId: "meeting-1",
        position: 8,
        correlationId: "correlation-1",
        candidate: {
          candidateId: "decision-candidate-1",
          provenance: { origin: "human_authored" },
          draft: {
            ...candidateDraft,
            premiseCandidates: [
              {
                ...candidateDraft.premiseCandidates[0],
                evidenceReferenceIds: [
                  {
                    evidenceId: "evidence-shared-1",
                    sourceArtifactId: "source-private-1",
                  },
                ],
              },
            ],
          },
        },
      }).success,
    ).toBe(false);
    expect(
      SynthesizeSharedDecisionResponseSchema.safeParse({
        meetingId: "meeting-1",
        position: 8,
        correlationId: "correlation-1",
        candidate: {
          candidateId: "decision-candidate-1",
          provenance: {
            origin: "ai_assisted",
            model: "gpt-5.6",
            operation: "shared_decision_synthesis",
            promptVersion: "shared-decision-v1",
            schemaVersion: "1",
            inputReferenceIds: [{ sourceArtifactId: "source-private-1" }],
            generatedAt: "2026-07-19T08:00:00.000Z",
            confidence: 0.88,
            reason: "Shared evidence supports a conditional launch draft.",
          },
          draft: candidateDraft,
        },
      }).success,
    ).toBe(false);
  });

  it("materializes human-confirmed inputs without accepting a commit command", () => {
    const request = DispositionSharedDecisionCandidateRequestSchema.parse({
      ...meetingMutation,
      candidateId: "decision-candidate-1",
      title: candidateDraft.title,
      outcome: candidateDraft.outcome,
      premiseDispositions: [
        {
          candidateId: "premise-candidate-1",
          disposition: "confirmed",
          premise: {
            statement: candidateDraft.premiseCandidates[0]?.statement,
            evidenceReferenceIds: ["evidence-shared-1"],
          },
        },
        {
          candidateId: "premise-candidate-2",
          disposition: "rejected",
          reason: "Not supported by the shared evidence.",
        },
      ],
      dissent: [
        {
          reason: "Staffing and rollback ownership remain unresolved.",
          retained: true,
        },
      ],
      actions: [
        {
          ownerParticipantId: "participant-engineering",
          scope: ["Document the regional approval gate."],
        },
      ],
      monitorCondition: candidateDraft.monitorCondition,
      reason: "Facilitator reviewed every premise candidate.",
    });

    expectTypeOf(
      request,
    ).toEqualTypeOf<DispositionSharedDecisionCandidateRequest>();
    expect(request.premiseDispositions).toHaveLength(2);
    expect(request).not.toHaveProperty("decisionId");
    expect(request).not.toHaveProperty("commit");
    expect(
      DispositionSharedDecisionCandidateRequestSchema.safeParse({
        ...request,
        commit: true,
      }).success,
    ).toBe(false);
  });

  it("rejects missing, contradictory, and duplicate premise confirmations", () => {
    const valid = {
      ...meetingMutation,
      candidateId: "decision-candidate-1",
      title: candidateDraft.title,
      outcome: candidateDraft.outcome,
      premiseDispositions: [
        {
          candidateId: "premise-candidate-1",
          disposition: "confirmed",
          premise: {
            statement: candidateDraft.premiseCandidates[0]?.statement,
            evidenceReferenceIds: ["evidence-shared-1"],
          },
        },
      ],
      dissent: [],
      actions: [],
      monitorCondition: candidateDraft.monitorCondition,
    } as const;

    const confirmationWithoutInput = {
      candidateId: "premise-candidate-1",
      disposition: "confirmed",
    } as const;
    expect(
      DispositionSharedDecisionCandidateRequestSchema.safeParse({
        ...valid,
        premiseDispositions: [confirmationWithoutInput],
      }).success,
    ).toBe(false);
    expect(
      DispositionSharedDecisionCandidateRequestSchema.safeParse({
        ...valid,
        premiseDispositions: [
          {
            ...valid.premiseDispositions[0],
            disposition: "rejected",
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      DispositionSharedDecisionCandidateRequestSchema.safeParse({
        ...valid,
        premiseDispositions: [
          valid.premiseDispositions[0],
          valid.premiseDispositions[0],
        ],
      }).success,
    ).toBe(false);
    expect(
      DispositionSharedDecisionCandidateRequestSchema.safeParse({
        ...valid,
        premiseDispositions: [],
      }).success,
    ).toBe(false);
  });
});
