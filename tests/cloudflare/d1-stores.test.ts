/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import {
  createJsonCodec,
  D1EventStore,
  D1EventProjectionStore,
  D1ProjectionStore,
  type JsonCodec,
} from "@counterpoint/adapters-cloudflare";

import {
  type AtomicFixtureEvent,
  type AtomicFixtureProjection,
  eventProjectionStoreContract,
} from "../contract/event-projection-store-contract.js";
import { eventStoreContract } from "../contract/event-store-contract.js";
import { projectionStoreContract } from "../contract/projection-store-contract.js";

interface FixtureEvent {
  readonly type: string;
  readonly value: string;
}

interface FixtureProjection {
  readonly label: string;
}

function fixtureEventCodec(): JsonCodec<FixtureEvent> {
  return createJsonCodec((input) => {
    if (
      typeof input !== "object" ||
      input === null ||
      !("type" in input) ||
      typeof input.type !== "string" ||
      !("value" in input) ||
      typeof input.value !== "string"
    ) {
      throw new TypeError("Invalid fixture event");
    }
    return { type: input.type, value: input.value };
  });
}

function fixtureProjectionCodec(): JsonCodec<FixtureProjection> {
  return createJsonCodec((input) => {
    if (
      typeof input !== "object" ||
      input === null ||
      !("label" in input) ||
      typeof input.label !== "string"
    ) {
      throw new TypeError("Invalid fixture projection");
    }
    return { label: input.label };
  });
}

describe("Cloudflare D1 port adapters", () => {
  it("atomically commits events, receipts, and projections", async () => {
    const eventCodec = fixtureEventCodec();
    const projectionCodec = fixtureProjectionCodec();
    const invalidProjectionCodec: JsonCodec<AtomicFixtureProjection> = {
      decode: (serialized) => projectionCodec.decode(serialized),
      encode(value) {
        return value.label === "invalid"
          ? "not valid json"
          : JSON.stringify(value);
      },
    };
    await eventProjectionStoreContract(
      () =>
        new D1EventProjectionStore<AtomicFixtureEvent, AtomicFixtureProjection>(
          env.DB,
          eventCodec,
          projectionCodec,
        ),
      () =>
        new D1EventProjectionStore<AtomicFixtureEvent, AtomicFixtureProjection>(
          env.DB,
          eventCodec,
          invalidProjectionCodec,
        ),
    );
  });

  it("satisfies the reusable event-store contract", async () => {
    await eventStoreContract(
      () => new D1EventStore(env.DB, fixtureEventCodec()),
    );
  });

  it("satisfies the reusable projection-store contract", async () => {
    await projectionStoreContract(
      () => new D1ProjectionStore(env.DB, fixtureProjectionCodec()),
    );
  });

  it("appends concurrent batches without duplicate positions", async () => {
    const firstStore = new D1EventStore(env.DB, fixtureEventCodec());
    const secondStore = new D1EventStore(env.DB, fixtureEventCodec());

    const results = await Promise.all([
      firstStore.append({
        events: [{ type: "Created", value: "one" }],
        idempotencyKey: "concurrent-1",
        meetingId: "meeting-concurrent",
      }),
      secondStore.append({
        events: [{ type: "Updated", value: "two" }],
        idempotencyKey: "concurrent-2",
        meetingId: "meeting-concurrent",
      }),
    ]);

    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "appended" }),
        expect.objectContaining({ kind: "appended" }),
      ]),
    );
    await expect(firstStore.load("meeting-concurrent")).resolves.toEqual([
      expect.objectContaining({ position: 1 }),
      expect.objectContaining({ position: 2 }),
    ]);
  });

  it("allows only one concurrent append at an explicit expected position", async () => {
    const firstStore = new D1EventStore(env.DB, fixtureEventCodec());
    const secondStore = new D1EventStore(env.DB, fixtureEventCodec());

    const results = await Promise.all([
      firstStore.append({
        events: [{ type: "Created", value: "one" }],
        expectedPosition: 0,
        idempotencyKey: "expected-1",
        meetingId: "meeting-expected",
      }),
      secondStore.append({
        events: [{ type: "Updated", value: "two" }],
        expectedPosition: 0,
        idempotencyKey: "expected-2",
        meetingId: "meeting-expected",
      }),
    ]);

    expect(results.filter(({ kind }) => kind === "appended")).toHaveLength(1);
    expect(results).toContainEqual({
      actualPosition: 1,
      expectedPosition: 0,
      kind: "position_conflict",
    });
    await expect(firstStore.position("meeting-expected")).resolves.toBe(1);
  });

  it("preserves strict and trusted idempotency fingerprint semantics", async () => {
    const store = new D1EventStore(env.DB, fixtureEventCodec());
    const original = await store.append({
      events: [{ type: "Created", value: "one" }],
      idempotencyKey: "fingerprint-1",
      meetingId: "meeting-fingerprint",
      payloadFingerprint: "canonical-fingerprint",
    });
    expect(original).toMatchObject({ kind: "appended" });

    await expect(
      store.append({
        events: [{ type: "Created", value: "different" }],
        idempotencyKey: "fingerprint-1",
        meetingId: "meeting-fingerprint",
        payloadFingerprint: "canonical-fingerprint",
      }),
    ).resolves.toEqual({
      idempotencyKey: "fingerprint-1",
      kind: "idempotency_conflict",
    });

    await expect(
      store.append({
        events: [{ type: "Created", value: "different" }],
        idempotencyKey: "fingerprint-1",
        meetingId: "meeting-fingerprint",
        payloadFingerprint: "canonical-fingerprint",
        trustPayloadFingerprintForReplay: true,
      }),
    ).resolves.toEqual({
      kind: "replayed",
      records:
        original.kind === "appended" || original.kind === "replayed"
          ? original.records
          : [],
    });
  });

  it("resumes strictly after the requested event position", async () => {
    const store = new D1EventStore(env.DB, fixtureEventCodec());
    await store.append({
      events: [
        { type: "Created", value: "one" },
        { type: "Updated", value: "two" },
      ],
      meetingId: "meeting-resume",
    });

    await expect(
      store.load("meeting-resume", { afterPosition: 1 }),
    ).resolves.toEqual([
      {
        event: { type: "Updated", value: "two" },
        position: 2,
      },
    ]);
  });

  it("rolls back an invalid payload batch and its idempotency record", async () => {
    const validCodec = fixtureEventCodec();
    const invalidSecondCodec: JsonCodec<FixtureEvent> = {
      decode: (serialized) => validCodec.decode(serialized),
      encode(value) {
        return value.value === "invalid"
          ? "not valid json"
          : JSON.stringify(value);
      },
    };
    const store = new D1EventStore(env.DB, invalidSecondCodec);

    await expect(
      store.append({
        events: [
          { type: "Created", value: "valid" },
          { type: "Updated", value: "invalid" },
        ],
        idempotencyKey: "rollback-1",
        meetingId: "meeting-rollback",
      }),
    ).rejects.toThrow();
    await expect(store.position("meeting-rollback")).resolves.toBe(0);

    await expect(
      store.append({
        events: [{ type: "Created", value: "recovered" }],
        idempotencyKey: "rollback-1",
        meetingId: "meeting-rollback",
      }),
    ).resolves.toMatchObject({ kind: "appended" });
  });
});
