import type {
  AssumptionInvalidationEvaluation,
  AssumptionInvalidationEvaluationInput,
} from "@counterpoint/adapters-openai";

import type { ConcreteAssumptionInvalidationEvaluator } from "./judge-assumption-invalidation.js";

export const PREVIEW_DEMO_INVALIDATION_MODEL = "staged-demo-rule-v1";

/**
 * A provider-free, preview-only story rule. It is deliberately narrow: the
 * staged synthetic event is matched to the first monitored premise, evidence,
 * and Action already present in the Flagship projection. It never reads a
 * secret, reserves usage, or calls a model provider.
 */
export function createPreviewDemoInvalidationEvaluator(): ConcreteAssumptionInvalidationEvaluator {
  return {
    evaluate(
      input: AssumptionInvalidationEvaluationInput,
    ): Promise<AssumptionInvalidationEvaluation> {
      const action = input.actions[0];
      const evidence = input.evidence[0];
      const premise = input.premises[0];
      if (
        action === undefined ||
        evidence === undefined ||
        premise === undefined
      ) {
        throw new Error(
          "Preview demo rule requires a monitored Flagship decision.",
        );
      }

      const suggestion = {
        affectedActionIds: [action.actionId],
        affectedPremiseIds: [premise.premiseId],
        confidence: 0.98,
        evidenceReferenceIds: [
          evidence.evidenceReferenceId,
          input.externalEvent.sourceReference,
        ],
        reason:
          "The staged demo rule matches the synthetic event to the monitored rollout premise.",
      };
      return Promise.resolve({
        ai: {
          candidates: [suggestion],
          generatedAt: input.externalEvent.effectiveAt,
          inputReferenceIds: [
            input.externalEvent.externalEventId,
            input.decision.revisionId,
            premise.premiseId,
            action.actionId,
            ...suggestion.evidenceReferenceIds,
          ],
          model: PREVIEW_DEMO_INVALIDATION_MODEL,
          operation: "assumption_invalidation",
          promptVersion: "assumption-invalidation-v1",
          schemaVersion: "1",
        },
        suggestion,
      });
    },
  };
}
