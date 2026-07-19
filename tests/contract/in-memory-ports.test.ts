import { describe, expect, it } from "vitest";

import {
  CapturingRealtimePublisher,
  InMemoryArtifactStore,
  InMemoryEventStore,
  InMemoryProjectionStore,
  InMemorySessionRepository,
} from "../helpers/in-memory-ports.js";
import { artifactStoreContract } from "./artifact-store-contract.js";
import { eventStoreContract } from "./event-store-contract.js";
import { projectionStoreContract } from "./projection-store-contract.js";
import { realtimePublisherContract } from "./realtime-publisher-contract.js";
import { sessionRepositoryContract } from "./session-repository-contract.js";

describe("in-memory test port adapters", () => {
  it("satisfies the reusable event-store contract", async () => {
    await eventStoreContract(() => new InMemoryEventStore());
  });

  it("satisfies the reusable projection-store contract", async () => {
    await projectionStoreContract(() => new InMemoryProjectionStore());
  });

  it("satisfies the reusable session-repository contract", async () => {
    await sessionRepositoryContract(() => new InMemorySessionRepository());
  });

  it("satisfies the reusable artifact-store contract", async () => {
    await artifactStoreContract(() => new InMemoryArtifactStore());
  });

  it("satisfies the reusable realtime-publisher contract", async () => {
    await realtimePublisherContract({
      createPublisher: () => new CapturingRealtimePublisher(),
      messages: (publisher) =>
        (publisher as CapturingRealtimePublisher).messages,
    });
  });

  it("partitions projections by meeting and owner", async () => {
    const store = new InMemoryProjectionStore<{ readonly text: string }>();
    const ownerA = {
      meetingId: "meeting-a",
      ownerParticipantId: "participant-a",
      projection: "private",
    };
    const ownerB = {
      meetingId: "meeting-a",
      ownerParticipantId: "participant-b",
      projection: "private",
    };

    await store.put(ownerA, { text: "private-a" });

    await expect(store.get(ownerA)).resolves.toEqual({
      text: "private-a",
    });
    await expect(store.get(ownerB)).resolves.toBeUndefined();
  });

  it("captures visibility-scoped realtime projection messages", async () => {
    const publisher = new CapturingRealtimePublisher();

    await publisher.publish({
      correlationId: "correlation-1",
      meetingId: "meeting-a",
      payload: { title: "Shared decision" },
      position: 4,
      schemaVersion: "1.0",
      type: "shared_state.updated",
      visibility: { kind: "shared" },
    });

    expect(publisher.messages).toHaveLength(1);
    expect(publisher.messages[0]?.visibility).toEqual({
      kind: "shared",
    });
  });
});
