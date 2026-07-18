import { z } from "zod";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  CURRENT_EVENT_SCHEMA_VERSION,
  EVENT_SCHEMA_VERSION_POLICY,
  PROTOCOL_VERSION_POLICY,
  VersionParseError,
  createEventEnvelope,
  createEventEnvelopeSchema,
  createExternalEventEnvelopeSchema,
  createEventVersionParser,
  parseEventSchemaVersion,
  parseProtocolVersion,
  safeParseEventSchemaVersion,
  safeParseProtocolVersion,
  type EventEnvelope,
} from "@counterpoint/protocol";

const metadata = {
  eventId: "event-1",
  meetingId: "meeting-1",
  actor: { kind: "participant", participantId: "participant-1" } as const,
  occurredAt: "2026-07-19T05:04:03.000Z",
  correlationId: "correlation-1",
  causationId: "command-1",
  visibility: "shared" as const,
};

describe("protocol and event version policy", () => {
  it("keeps protocol and event versions independent", () => {
    expect(PROTOCOL_VERSION_POLICY.current).toBe(1);
    expect(EVENT_SCHEMA_VERSION_POLICY.current).toBe(1);
    expect(PROTOCOL_VERSION_POLICY).not.toBe(EVENT_SCHEMA_VERSION_POLICY);
    expect(parseProtocolVersion("v1")).toBe(1);
    expect(parseProtocolVersion(1)).toBe(1);
    expect(parseEventSchemaVersion(1)).toBe(1);
  });

  it("distinguishes malformed versions from unknown versions", () => {
    const malformedProtocol = safeParseProtocolVersion("version-one");
    const unknownProtocol = safeParseProtocolVersion("v2");
    const malformedEvent = safeParseEventSchemaVersion(1.5);
    const unknownEvent = safeParseEventSchemaVersion(2);

    expect(malformedProtocol.success).toBe(false);
    expect(unknownProtocol.success).toBe(false);
    expect(malformedEvent.success).toBe(false);
    expect(unknownEvent.success).toBe(false);

    if (
      !malformedProtocol.success &&
      !unknownProtocol.success &&
      !malformedEvent.success &&
      !unknownEvent.success
    ) {
      expect(malformedProtocol.error.kind).toBe("malformed");
      expect(unknownProtocol.error.kind).toBe("unsupported");
      expect(malformedEvent.error.kind).toBe("malformed");
      expect(unknownEvent.error.kind).toBe("unsupported");
    }

    expect(() => parseEventSchemaVersion(99)).toThrow(VersionParseError);
    expect(() =>
      createEventEnvelopeSchema("FutureEvent", z.unknown(), 99),
    ).toThrow(VersionParseError);
    expect(() =>
      createEventEnvelopeSchema("not a stable event", z.unknown()),
    ).toThrow();
  });
});

describe("typed event envelopes", () => {
  const payloadSchema = z.strictObject({
    title: z.string().min(1),
    summary: z.string().optional(),
  });
  const schema = createEventEnvelopeSchema("DecisionDrafted", payloadSchema);

  it("creates and parses a strict envelope with an arbitrary typed payload", () => {
    const event = createEventEnvelope("DecisionDrafted", payloadSchema, {
      ...metadata,
      idempotencyKey: "draft-request-1",
      payload: { title: "Conditional rollout", summary: "Synthetic demo" },
    });

    expect(event.eventType).toBe("DecisionDrafted");
    expect(event.schemaVersion).toBe(CURRENT_EVENT_SCHEMA_VERSION);
    expect(event.payload.title).toBe("Conditional rollout");
    expectTypeOf(event).toMatchTypeOf<
      EventEnvelope<
        "DecisionDrafted",
        { title: string; summary?: string | undefined },
        1
      >
    >();
    expect(schema.parse(event)).toEqual(event);
  });

  it("allows declared additive optional fields without weakening strictness", () => {
    const original = schema.safeParse({
      ...metadata,
      eventType: "DecisionDrafted",
      schemaVersion: 1,
      payload: { title: "Original producer" },
    });
    const additive = schema.safeParse({
      ...metadata,
      eventType: "DecisionDrafted",
      schemaVersion: 1,
      payload: { title: "New producer", summary: "Optional addition" },
    });
    const undeclared = schema.safeParse({
      ...metadata,
      eventType: "DecisionDrafted",
      schemaVersion: 1,
      payload: { title: "Invalid producer", hiddenMeaningChange: true },
    });

    expect(original.success).toBe(true);
    expect(additive.success).toBe(true);
    expect(undeclared.success).toBe(false);
  });

  it("returns safeParse failures for malformed metadata and unknown fields", () => {
    expect(
      schema.safeParse({
        ...metadata,
        occurredAt: "2026-07-19T14:04:03+09:00",
        eventType: "DecisionDrafted",
        schemaVersion: 1,
        payload: { title: "Bad timestamp" },
      }).success,
    ).toBe(false);

    expect(
      schema.safeParse({
        ...metadata,
        eventType: "DecisionDrafted",
        schemaVersion: 1,
        payload: { title: "Strict envelope" },
        clientActorRole: "facilitator",
      }).success,
    ).toBe(false);
  });

  it("requires owner scope for private events and forbids it on shared events", () => {
    expect(
      schema.safeParse({
        ...metadata,
        eventType: "DecisionDrafted",
        schemaVersion: 1,
        payload: { title: "Missing owner" },
        visibility: "private",
      }).success,
    ).toBe(false);

    expect(
      schema.safeParse({
        ...metadata,
        eventType: "DecisionDrafted",
        ownerParticipantId: "participant-1",
        schemaVersion: 1,
        payload: { title: "Owner private" },
        visibility: "private",
      }).success,
    ).toBe(true);

    expect(
      schema.safeParse({
        ...metadata,
        eventType: "DecisionDrafted",
        ownerParticipantId: "participant-1",
        schemaVersion: 1,
        payload: { title: "Shared leak" },
      }).success,
    ).toBe(false);
  });

  it("requires idempotency keys for externally initiated events", () => {
    const externalSchema = createExternalEventEnvelopeSchema(
      "ExternalEventReceived",
      z.strictObject({ providerEventId: z.string() }),
    );
    const event = {
      ...metadata,
      eventType: "ExternalEventReceived",
      schemaVersion: 1,
      payload: { providerEventId: "provider-event-1" },
    };

    expect(externalSchema.safeParse(event).success).toBe(false);
    expect(
      externalSchema.safeParse({
        ...event,
        idempotencyKey: "provider-event-1:payload-hash",
      }).success,
    ).toBe(true);
  });
});

describe("stored event upcasting", () => {
  const versionOneSchema = z.strictObject({
    eventType: z.literal("ExampleChanged"),
    schemaVersion: z.literal(1),
    payload: z.strictObject({ label: z.string() }),
  });
  const versionTwoSchema = z.strictObject({
    eventType: z.literal("ExampleChanged"),
    schemaVersion: z.literal(2),
    payload: z.strictObject({
      title: z.string(),
      note: z.string().optional(),
    }),
  });
  const parser = createEventVersionParser({
    currentVersion: 2,
    currentSchema: versionTwoSchema,
    versions: {
      1: {
        schema: versionOneSchema,
        upcast: (stored) => {
          const event = versionOneSchema.parse(stored);
          return {
            eventType: event.eventType,
            schemaVersion: 2,
            payload: { title: event.payload.label },
          };
        },
      },
      2: { schema: versionTwoSchema },
    },
  });

  it("validates a stored version before upcasting to the current schema", () => {
    expect(
      parser.parse({
        eventType: "ExampleChanged",
        schemaVersion: 1,
        payload: { label: "legacy title" },
      }),
    ).toEqual({
      eventType: "ExampleChanged",
      schemaVersion: 2,
      payload: { title: "legacy title" },
    });
  });

  it("rejects malformed and unknown stored versions without throwing from safeParse", () => {
    const malformed = parser.safeParse({
      eventType: "ExampleChanged",
      schemaVersion: "1",
      payload: { label: "legacy title" },
    });
    const unknown = parser.safeParse({
      eventType: "ExampleChanged",
      schemaVersion: 3,
      payload: { title: "future title" },
    });

    expect(malformed.success).toBe(false);
    expect(unknown.success).toBe(false);
    if (!malformed.success && !unknown.success) {
      expect(malformed.error).toMatchObject({ kind: "malformed" });
      expect(unknown.error).toMatchObject({ kind: "unsupported" });
    }
  });
});
