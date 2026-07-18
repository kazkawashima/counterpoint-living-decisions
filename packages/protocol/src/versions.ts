import { z } from "zod";

export const CURRENT_PROTOCOL_VERSION = 1 as const;
export const CURRENT_EVENT_SCHEMA_VERSION = 1 as const;

export const SUPPORTED_PROTOCOL_VERSIONS = [CURRENT_PROTOCOL_VERSION] as const;
export const SUPPORTED_EVENT_SCHEMA_VERSIONS = [
  CURRENT_EVENT_SCHEMA_VERSION,
] as const;

export const ProtocolVersionSchema = z
  .literal(CURRENT_PROTOCOL_VERSION)
  .brand<"ProtocolVersion">();
export const EventSchemaVersionSchema = z
  .literal(CURRENT_EVENT_SCHEMA_VERSION)
  .brand<"EventSchemaVersion">();

export type ProtocolVersion = z.infer<typeof ProtocolVersionSchema>;
export type EventSchemaVersion = z.infer<typeof EventSchemaVersionSchema>;
export type VersionScope = "protocol" | "event";
export type VersionFailureKind = "malformed" | "unsupported";

export const PROTOCOL_VERSION_POLICY = Object.freeze({
  current: CURRENT_PROTOCOL_VERSION,
  supported: SUPPORTED_PROTOCOL_VERSIONS,
  routePrefix: `v${CURRENT_PROTOCOL_VERSION}`,
  additiveOptionalFieldsWithinVersion: true,
  rejectUnsupportedMajor: true,
});

export const EVENT_SCHEMA_VERSION_POLICY = Object.freeze({
  current: CURRENT_EVENT_SCHEMA_VERSION,
  supported: SUPPORTED_EVENT_SCHEMA_VERSIONS,
  additiveOptionalFieldsWithinVersion: true,
  storedVersionsRequireUpcasters: true,
});

export class VersionParseError extends Error {
  readonly kind: VersionFailureKind;
  readonly scope: VersionScope;
  readonly received: unknown;

  constructor(
    scope: VersionScope,
    kind: VersionFailureKind,
    received: unknown,
  ) {
    const label = kind === "malformed" ? "Malformed" : "Unsupported";
    super(`${label} ${scope} version`);
    this.name = "VersionParseError";
    this.kind = kind;
    this.scope = scope;
    this.received = received;
  }
}

export type VersionParseResult<T> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly error: VersionParseError };

const PositiveVersionSchema = z.number().int().positive();

function normalizeProtocolVersion(input: unknown): unknown {
  if (typeof input === "string") {
    const match = /^v?([1-9]\d*)$/u.exec(input);
    if (match?.[1] !== undefined) {
      return Number(match[1]);
    }
  }

  return input;
}

function parseKnownVersion<const Version extends number>(
  scope: VersionScope,
  input: unknown,
  supported: readonly Version[],
): Version {
  const normalized =
    scope === "protocol" ? normalizeProtocolVersion(input) : input;
  const structural = PositiveVersionSchema.safeParse(normalized);

  if (!structural.success) {
    throw new VersionParseError(scope, "malformed", input);
  }

  if (!supported.includes(structural.data as Version)) {
    throw new VersionParseError(scope, "unsupported", input);
  }

  return structural.data as Version;
}

export function parseProtocolVersion(input: unknown): ProtocolVersion {
  const version = parseKnownVersion(
    "protocol",
    input,
    SUPPORTED_PROTOCOL_VERSIONS,
  );
  return ProtocolVersionSchema.parse(version);
}

export function safeParseProtocolVersion(
  input: unknown,
): VersionParseResult<ProtocolVersion> {
  try {
    return { success: true, data: parseProtocolVersion(input) };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof VersionParseError
          ? error
          : new VersionParseError("protocol", "malformed", input),
    };
  }
}

export function parseEventSchemaVersion(input: unknown): EventSchemaVersion {
  const version = parseKnownVersion(
    "event",
    input,
    SUPPORTED_EVENT_SCHEMA_VERSIONS,
  );
  return EventSchemaVersionSchema.parse(version);
}

export function safeParseEventSchemaVersion(
  input: unknown,
): VersionParseResult<EventSchemaVersion> {
  try {
    return { success: true, data: parseEventSchemaVersion(input) };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof VersionParseError
          ? error
          : new VersionParseError("event", "malformed", input),
    };
  }
}
