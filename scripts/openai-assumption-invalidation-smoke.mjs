import { createOpenAiAssumptionInvalidationEvaluator } from "../packages/adapters-openai/dist/index.js";

const apiKey = process.env.OPENAI_API_KEY;
if (apiKey === undefined || apiKey.length === 0) {
  throw new Error("OPENAI_API_KEY is required for the OpenAI smoke test.");
}

const premiseId = "synthetic-premise-approval-gate";
const actionId = "synthetic-action-document-gate";
const evidenceReferenceId = "synthetic-evidence-approval-gate";
const sourceReference = "synthetic://regulator/eu-approval-change";
const logs = [];
const evaluator = createOpenAiAssumptionInvalidationEvaluator({
  apiKey,
  logger: {
    log(entry) {
      logs.push(entry);
    },
  },
  maxAttempts: 2,
  model: process.env.OPENAI_MODEL ?? "gpt-5.6",
});

const result = await evaluator.evaluate({
  actions: [
    {
      actionId,
      affectedPremiseIds: [premiseId],
      scope: ["Document the approval gate before regional launch."],
      status: "planned",
    },
  ],
  decision: {
    decisionId: "synthetic-decision-regional-launch",
    monitorCondition:
      "Reopen if the approval gate or applicable regulation changes.",
    outcome:
      "Proceed only after the documented regional approval gate is satisfied.",
    revision: 2,
    revisionId: "synthetic-decision-revision-2",
    title: "Conditional regional launch",
  },
  evidence: [
    {
      evidenceReferenceId,
      exactSnippet:
        "Synthetic shared fact: regional launch requires a documented approval gate.",
    },
  ],
  externalEvent: {
    description:
      "Synthetic regulation changes the required regional approval gate.",
    effectiveAt: "2026-08-01T00:00:00.000Z",
    eventType: "regulatory_change",
    externalEventId: "synthetic-regulatory-event-1",
    jurisdiction: "European Union",
    source: "Synthetic regulator feed",
    sourceReference,
  },
  meetingId: "synthetic-assumption-invalidation-smoke",
  premises: [
    {
      confirmationStatus: "confirmed",
      premiseId,
      statement: "Regional launch requires a documented approval gate.",
    },
  ],
});
const event = logs.at(-1);

console.log(
  JSON.stringify({
    actionReferencesGrounded: result.suggestion.affectedActionIds.every(
      (referenceId) => referenceId === actionId,
    ),
    externalSourceGrounded:
      result.suggestion.evidenceReferenceIds.includes(sourceReference),
    model: result.ai.model,
    operation: result.ai.operation,
    premiseReferencesGrounded: result.suggestion.affectedPremiseIds.every(
      (referenceId) => referenceId === premiseId,
    ),
    promptVersion: result.ai.promptVersion,
    retryCount: event?.metadata?.retryCount,
    schemaVersion: result.ai.schemaVersion,
    usage:
      event === undefined
        ? undefined
        : {
            inputTokens: event.metadata?.inputTokens,
            outputTokens: event.metadata?.outputTokens,
            totalTokens: event.metadata?.totalTokens,
          },
  }),
);
