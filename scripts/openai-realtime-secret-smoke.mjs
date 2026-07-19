import { createHash } from "node:crypto";

import { OpenAiRealtimeClientSecretIssuer } from "../packages/adapters-openai/dist/index.js";

const apiKey = process.env.OPENAI_API_KEY;
if (apiKey === undefined || apiKey.length === 0) {
  throw new Error(
    "OPENAI_API_KEY is required for the Realtime secret smoke test",
  );
}

const model = process.env.OPENAI_REALTIME_MODEL ?? "gpt-realtime-2.1";
const safetyIdentifier = `sha256:${createHash("sha256")
  .update("counterpoint-local-realtime-smoke", "utf8")
  .digest("base64url")}`;
const issuer = new OpenAiRealtimeClientSecretIssuer({ model });
const issued = await issuer.issue({
  apiKey,
  channel: "private",
  meetingId: "smoke-meeting-not-sent-to-provider",
  ownerParticipantId: "smoke-participant-not-sent-to-provider",
  safetyIdentifier,
  sessionId: "smoke-session-not-sent-to-provider",
});

if (issued.value.length === 0 || Date.parse(issued.expiresAt) <= Date.now()) {
  throw new Error("OpenAI returned an unusable Realtime client secret");
}

console.log(
  JSON.stringify({
    channel: issued.channel,
    expiresAt: issued.expiresAt,
    model: issued.model,
    status: "ok",
  }),
);
