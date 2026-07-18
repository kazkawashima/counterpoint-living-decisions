import { createOpenAiPrivateDisclosureProposer } from "../packages/adapters-openai/dist/index.js";

const apiKey = process.env.OPENAI_API_KEY;
if (apiKey === undefined || apiKey.length === 0) {
  throw new Error("OPENAI_API_KEY is required for the OpenAI smoke test.");
}

const sourceText =
  "Synthetic demo note: keep the migration reversible through September. Never publish unrelated private notes.";
const logs = [];
const proposer = createOpenAiPrivateDisclosureProposer({
  apiKey,
  logger: {
    log(entry) {
      logs.push(entry);
    },
  },
  maxAttempts: 2,
  model: process.env.OPENAI_MODEL ?? "gpt-5.6",
});

const proposal = await proposer.propose({
  meetingId: "synthetic-smoke-meeting",
  ownerParticipantId: "synthetic-smoke-owner",
  sourceArtifactId: "synthetic-smoke-artifact",
  text: sourceText,
});
const event = logs.at(-1);

console.log(
  JSON.stringify({
    exactSourceMatch:
      sourceText.slice(proposal.sourceRange.start, proposal.sourceRange.end) ===
      proposal.exactSnippet,
    model: proposal.ai.model,
    operation: proposal.ai.operation,
    promptVersion: proposal.ai.promptVersion,
    retryCount: event?.metadata?.retryCount,
    schemaVersion: proposal.ai.schemaVersion,
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
