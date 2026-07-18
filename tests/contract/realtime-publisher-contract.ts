import { expect } from "vitest";

import type {
  RealtimeMessage,
  RealtimePublisher,
} from "../../packages/ports/src/index.js";

export async function realtimePublisherContract(input: {
  readonly createPublisher: () => RealtimePublisher;
  readonly messages: (
    publisher: RealtimePublisher,
  ) => readonly RealtimeMessage[];
}): Promise<void> {
  const publisher = input.createPublisher();
  const shared: RealtimeMessage = {
    correlationId: "correlation-shared",
    meetingId: "meeting-a",
    payload: { status: "COMMITTED" },
    position: 4,
    schemaVersion: "1",
    type: "decision.updated",
    visibility: { kind: "shared" },
  };
  const privateMessage: RealtimeMessage = {
    correlationId: "correlation-private",
    meetingId: "meeting-a",
    payload: { candidateId: "candidate-a" },
    position: 5,
    schemaVersion: "1",
    type: "private_workspace.updated",
    visibility: {
      kind: "owner_private",
      ownerParticipantId: "participant-a",
    },
  };

  await publisher.publish(shared);
  await publisher.publish(privateMessage);

  expect(input.messages(publisher)).toEqual([shared, privateMessage]);
}
