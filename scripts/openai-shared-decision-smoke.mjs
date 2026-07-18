import { createOpenAiSharedDecisionSynthesizer } from "../packages/adapters-openai/dist/index.js";

const apiKey = process.env.OPENAI_API_KEY;
if (apiKey === undefined || apiKey.length === 0) {
  throw new Error("OPENAI_API_KEY is required for the OpenAI smoke test.");
}

const evidenceId = "synthetic-shared-evidence";
const participantId = "synthetic-facilitator";
const logs = [];
const synthesizer = createOpenAiSharedDecisionSynthesizer({
  apiKey,
  logger: {
    log(entry) {
      logs.push(entry);
    },
  },
  maxAttempts: 2,
  model: process.env.OPENAI_MODEL ?? "gpt-5.6",
});

const result = await synthesizer.synthesize({
  actions: [],
  dissent: [],
  evidence: [
    {
      evidenceId,
      exactSnippet:
        "Synthetic shared fact: regional launch requires a documented approval gate.",
    },
  ],
  meetingId: "synthetic-shared-decision-smoke",
  participantIds: [participantId],
  premises: [],
});
const event = logs.at(-1);

console.log(
  JSON.stringify({
    actionOwnerGrounded:
      result.draft.action.ownerParticipantId === participantId,
    evidenceReferencesGrounded:
      result.draft.premise.evidenceReferenceIds.length > 0 &&
      result.draft.premise.evidenceReferenceIds.every(
        (referenceId) => referenceId === evidenceId,
      ),
    model: result.ai.model,
    operation: result.ai.operation,
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
