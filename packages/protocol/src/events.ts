import { z } from "zod";

import {
  ActorSchema,
  CausationIdSchema,
  CorrelationIdSchema,
  EventIdSchema,
  IdempotencyKeySchema,
  MeetingIdSchema,
  ParticipantIdSchema,
  UtcIsoTimestampSchema,
  VisibilitySchema,
} from "./primitives.js";
import {
  CURRENT_EVENT_SCHEMA_VERSION,
  VersionParseError,
  parseEventSchemaVersion,
} from "./versions.js";

export const EventTypeSchema = z
  .string()
  .regex(
    /^[A-Z][A-Za-z0-9]*$/u,
    "eventType must be a stable PascalCase event name",
  )
  .brand<"EventType">();
export type EventType = z.infer<typeof EventTypeSchema>;

const eventEnvelopeMetadataShape = {
  eventId: EventIdSchema,
  meetingId: MeetingIdSchema,
  actor: ActorSchema,
  occurredAt: UtcIsoTimestampSchema,
  correlationId: CorrelationIdSchema,
  causationId: CausationIdSchema,
  idempotencyKey: IdempotencyKeySchema.optional(),
  visibility: VisibilitySchema,
  ownerParticipantId: ParticipantIdSchema.optional(),
} as const;

interface VisibilityScopedValue {
  readonly ownerParticipantId?: string | undefined;
  readonly visibility: "private" | "shared";
}

interface RefinementContext {
  addIssue(issue: {
    readonly code: "custom";
    readonly message: string;
    readonly path: PropertyKey[];
  }): void;
}

function validateVisibilityScope(
  value: VisibilityScopedValue,
  context: RefinementContext,
): void {
  if (
    value.visibility === "private" &&
    value.ownerParticipantId === undefined
  ) {
    context.addIssue({
      code: "custom",
      message: "private events require ownerParticipantId",
      path: ["ownerParticipantId"],
    });
  }

  if (value.visibility === "shared" && value.ownerParticipantId !== undefined) {
    context.addIssue({
      code: "custom",
      message: "shared events must not carry private owner scope",
      path: ["ownerParticipantId"],
    });
  }
}

export const EventEnvelopeMetadataSchema = z
  .strictObject(eventEnvelopeMetadataShape)
  .superRefine(validateVisibilityScope);

export const ExternalEventEnvelopeMetadataSchema = z
  .strictObject({
    ...eventEnvelopeMetadataShape,
    idempotencyKey: IdempotencyKeySchema,
  })
  .superRefine(validateVisibilityScope);

export type EventEnvelopeMetadata = z.infer<typeof EventEnvelopeMetadataSchema>;
export type EventEnvelopeMetadataInput = z.input<
  typeof EventEnvelopeMetadataSchema
>;

export function createEventEnvelopeSchema<
  const TEventType extends string,
  TPayloadSchema extends z.ZodType,
>(
  eventType: TEventType,
  payloadSchema: TPayloadSchema,
  schemaVersion: number = CURRENT_EVENT_SCHEMA_VERSION,
) {
  EventTypeSchema.parse(eventType);
  parseEventSchemaVersion(schemaVersion);

  return z
    .strictObject({
      ...eventEnvelopeMetadataShape,
      eventType: z.literal(eventType),
      schemaVersion: z.literal(schemaVersion),
      payload: payloadSchema,
    })
    .superRefine(validateVisibilityScope);
}

export function createExternalEventEnvelopeSchema<
  const TEventType extends string,
  TPayloadSchema extends z.ZodType,
>(
  eventType: TEventType,
  payloadSchema: TPayloadSchema,
  schemaVersion: number = CURRENT_EVENT_SCHEMA_VERSION,
) {
  EventTypeSchema.parse(eventType);
  parseEventSchemaVersion(schemaVersion);

  return z
    .strictObject({
      ...eventEnvelopeMetadataShape,
      eventType: z.literal(eventType),
      idempotencyKey: IdempotencyKeySchema,
      schemaVersion: z.literal(schemaVersion),
      payload: payloadSchema,
    })
    .superRefine(validateVisibilityScope);
}

export type EventEnvelope<
  TEventType extends string = string,
  TPayload = unknown,
  TSchemaVersion extends number = number,
> = EventEnvelopeMetadata & {
  readonly eventType: TEventType;
  readonly schemaVersion: TSchemaVersion;
  readonly payload: TPayload;
};

export type CreateEventEnvelopeInput<TPayload> = EventEnvelopeMetadataInput & {
  readonly payload: TPayload;
};

export function createEventEnvelope<
  const TEventType extends string,
  TPayloadSchema extends z.ZodType,
  const TSchemaVersion extends number = typeof CURRENT_EVENT_SCHEMA_VERSION,
>(
  eventType: TEventType,
  payloadSchema: TPayloadSchema,
  input: CreateEventEnvelopeInput<z.input<TPayloadSchema>>,
  schemaVersion: TSchemaVersion = CURRENT_EVENT_SCHEMA_VERSION as TSchemaVersion,
): EventEnvelope<TEventType, z.output<TPayloadSchema>, TSchemaVersion> {
  const schema = createEventEnvelopeSchema(
    eventType,
    payloadSchema,
    schemaVersion,
  );
  return schema.parse({
    ...input,
    eventType,
    schemaVersion,
  }) as EventEnvelope<TEventType, z.output<TPayloadSchema>, TSchemaVersion>;
}

export type EventUpcaster = (storedEvent: unknown) => unknown;

export interface EventVersionDefinition {
  readonly schema: z.ZodType;
  /**
   * Converts this version to the next integer version. It is omitted only for
   * the parser's current version.
   */
  readonly upcast?: EventUpcaster;
}

export interface EventVersionParserOptions<TCurrentSchema extends z.ZodType> {
  readonly currentVersion: number;
  readonly versions: Readonly<Record<number, EventVersionDefinition>>;
  readonly currentSchema: TCurrentSchema;
}

export type EventVersionParseResult<T> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly error: Error };

function readStoredSchemaVersion(input: unknown): number {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new VersionParseError("event", "malformed", undefined);
  }

  const version: unknown = (input as Record<string, unknown>).schemaVersion;
  if (!Number.isSafeInteger(version) || (version as number) < 1) {
    throw new VersionParseError("event", "malformed", version);
  }

  return version as number;
}

/**
 * Builds a parser for one event type. Every stored version is validated before
 * its upcaster runs, and every upcast step must advance exactly one version.
 */
export function createEventVersionParser<TCurrentSchema extends z.ZodType>(
  options: EventVersionParserOptions<TCurrentSchema>,
) {
  const { currentSchema, currentVersion, versions } = options;

  if (!Number.isSafeInteger(currentVersion) || currentVersion < 1) {
    throw new VersionParseError("event", "malformed", currentVersion);
  }

  const parse = (input: unknown): z.output<TCurrentSchema> => {
    let version = readStoredSchemaVersion(input);

    if (version > currentVersion || versions[version] === undefined) {
      throw new VersionParseError("event", "unsupported", version);
    }

    let event: unknown = input;

    while (version < currentVersion) {
      const definition = versions[version];
      if (definition === undefined) {
        throw new VersionParseError("event", "unsupported", version);
      }

      const parsed = definition.schema.parse(event);
      if (definition.upcast === undefined) {
        throw new VersionParseError("event", "unsupported", version);
      }

      event = definition.upcast(parsed);
      const nextVersion = readStoredSchemaVersion(event);
      if (nextVersion !== version + 1) {
        throw new VersionParseError("event", "malformed", nextVersion);
      }
      version = nextVersion;
    }

    return currentSchema.parse(event);
  };

  const safeParse = (
    input: unknown,
  ): EventVersionParseResult<z.output<TCurrentSchema>> => {
    try {
      return { success: true, data: parse(input) };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error("Event parse failed"),
      };
    }
  };

  return Object.freeze({ parse, safeParse });
}
