import {
  DomainValueError,
  correlationId,
  displayTokenId,
  eventId,
  idempotencyKey,
  meetingId,
  meetingPosition,
  participantId,
  schemaVersion,
  timestamp,
  type DomainEvent,
  type EventOf,
} from "@counterpoint/domain";
import type {
  Clock,
  EventRecord,
  EventStore,
  IdGenerator,
  SessionTokenIssuer,
} from "@counterpoint/ports";

import {
  authorize,
  type DisplayAuthorizationContext,
  type UserAuthorizationContext,
} from "./authorization.js";

export const DISPLAY_TOKEN_TTL_MS = 8 * 60 * 60 * 1000;

export interface DisplayTokenDependencies {
  readonly clock: Clock;
  readonly events: EventStore<DomainEvent>;
  readonly ids: IdGenerator;
  readonly tokens: SessionTokenIssuer;
}

export interface IssueDisplayTokenInput {
  readonly correlationId?: string;
  readonly expectedPosition: number;
  readonly meetingId: string;
}

export interface RevokeDisplayTokenInput {
  readonly correlationId?: string;
  readonly displayTokenId: string;
  readonly expectedPosition: number;
  readonly meetingId: string;
}

export type DisplayTokenFailure =
  | {
      readonly code:
        "DISPLAY_TOKEN_EXPIRED" | "FORBIDDEN" | "VALIDATION_FAILED";
      readonly kind: "failed";
    }
  | {
      readonly actualPosition: number;
      readonly code: "CONFLICT";
      readonly expectedPosition: number;
      readonly kind: "failed";
    };

export type IssueDisplayTokenResult =
  | {
      readonly correlationId: string;
      readonly displayToken: string;
      readonly displayTokenId: string;
      readonly expiresAt: string;
      readonly kind: "issued";
      readonly position: number;
    }
  | DisplayTokenFailure;

export type RevokeDisplayTokenResult =
  | {
      readonly correlationId: string;
      readonly displayTokenId: string;
      readonly kind: "revoked";
      readonly position: number;
      readonly revokedAt: string;
    }
  | DisplayTokenFailure;

export type DisplayTokenAuthorizationResult =
  | {
      readonly authorization: DisplayAuthorizationContext;
      readonly expiresAt: string;
      readonly kind: "authorized";
    }
  | {
      readonly code: "DISPLAY_TOKEN_EXPIRED";
      readonly kind: "failed";
    };

interface ActiveDisplayToken {
  readonly displayTokenId: string;
  readonly expiresAt: string;
}

function failed(
  code: Exclude<DisplayTokenFailure["code"], "CONFLICT">,
): DisplayTokenFailure {
  return { code, kind: "failed" };
}

function normalizedEvents(
  records: readonly EventRecord<DomainEvent>[],
): readonly DomainEvent[] {
  return records.map(({ event, position }) => ({
    ...event,
    position: meetingPosition(position),
  }));
}

function activeDisplayTokens(
  records: readonly EventRecord<DomainEvent>[],
): readonly ActiveDisplayToken[] {
  const events = normalizedEvents(records);
  const resetIndex = events.findLastIndex(
    ({ eventType }) => eventType === "DemoResetCompleted",
  );
  const active = new Map<string, ActiveDisplayToken>();
  for (const event of events.slice(resetIndex + 1)) {
    if (event.eventType === "DisplayTokenIssued") {
      active.set(String(event.payload.displayTokenId), {
        displayTokenId: String(event.payload.displayTokenId),
        expiresAt: String(event.payload.expiresAt),
      });
    } else if (event.eventType === "DisplayTokenRevoked") {
      active.delete(String(event.payload.displayTokenId));
    }
  }
  return [...active.values()];
}

function nowMilliseconds(clock: Clock): number {
  const value = Date.parse(clock.now());
  if (!Number.isFinite(value)) {
    throw new DomainValueError("Clock must return a valid UTC timestamp");
  }
  return value;
}

function facilitatorAuthorized(
  context: UserAuthorizationContext,
  meetingScope: string,
): boolean {
  return (
    context.role === "facilitator" &&
    authorize(context, {
      capability: "meeting:read",
      meetingId: meetingScope,
    }).kind === "authorized"
  );
}

function commandCorrelation(
  dependencies: DisplayTokenDependencies,
  value?: string,
) {
  return correlationId(value ?? dependencies.ids.next("correlation"));
}

function participantActor(context: UserAuthorizationContext) {
  return {
    kind: "participant" as const,
    participantId: participantId(context.participantId),
  };
}

export async function issueDisplayToken(
  dependencies: DisplayTokenDependencies,
  context: UserAuthorizationContext,
  input: IssueDisplayTokenInput,
): Promise<IssueDisplayTokenResult> {
  if (!facilitatorAuthorized(context, input.meetingId)) {
    return failed("FORBIDDEN");
  }

  let expectedPosition: ReturnType<typeof meetingPosition>;
  let meetingScope: ReturnType<typeof meetingId>;
  try {
    expectedPosition = meetingPosition(input.expectedPosition);
    meetingScope = meetingId(input.meetingId);
  } catch (error) {
    if (error instanceof DomainValueError) {
      return failed("VALIDATION_FAILED");
    }
    throw error;
  }

  const records = await dependencies.events.load(input.meetingId);
  const nowMs = nowMilliseconds(dependencies.clock);
  const occurredAt = timestamp(new Date(nowMs).toISOString());
  const issuedToken = await dependencies.tokens.issue();
  const tokenId = displayTokenId(issuedToken.hash);
  const expiresAt = timestamp(
    new Date(nowMs + DISPLAY_TOKEN_TTL_MS).toISOString(),
  );
  const correlation = commandCorrelation(dependencies, input.correlationId);
  const active = activeDisplayTokens(records).filter(
    ({ expiresAt: activeExpiry }) => Date.parse(activeExpiry) > nowMs,
  );
  const revokedEvents: EventOf<"DisplayTokenRevoked">[] = active.map(
    (token, index) => ({
      actor: participantActor(context),
      correlationId: correlation,
      eventId: eventId(dependencies.ids.next("event")),
      eventType: "DisplayTokenRevoked",
      meetingId: meetingScope,
      occurredAt,
      payload: {
        displayTokenId: displayTokenId(token.displayTokenId),
        revokedAt: occurredAt,
      },
      position: meetingPosition(expectedPosition + index + 1),
      schemaVersion: schemaVersion(1),
      visibility: "shared",
    }),
  );
  const issued: EventOf<"DisplayTokenIssued"> = {
    actor: participantActor(context),
    correlationId: correlation,
    eventId: eventId(dependencies.ids.next("event")),
    eventType: "DisplayTokenIssued",
    idempotencyKey: idempotencyKey(`display-token-issue:${String(tokenId)}`),
    meetingId: meetingScope,
    occurredAt,
    payload: {
      displayTokenId: tokenId,
      expiresAt,
    },
    position: meetingPosition(expectedPosition + revokedEvents.length + 1),
    schemaVersion: schemaVersion(1),
    visibility: "shared",
  };
  const append = await dependencies.events.append({
    events: [...revokedEvents, issued],
    expectedPosition: input.expectedPosition,
    idempotencyKey: String(issued.idempotencyKey),
    meetingId: input.meetingId,
  });
  if (append.kind === "position_conflict") {
    return {
      actualPosition: append.actualPosition,
      code: "CONFLICT",
      expectedPosition: append.expectedPosition,
      kind: "failed",
    };
  }
  if (append.kind === "idempotency_conflict" || append.kind === "replayed") {
    return failed("VALIDATION_FAILED");
  }
  return {
    correlationId: String(correlation),
    displayToken: issuedToken.value,
    displayTokenId: String(tokenId),
    expiresAt: String(expiresAt),
    kind: "issued",
    position: Number(issued.position),
  };
}

export async function revokeDisplayToken(
  dependencies: DisplayTokenDependencies,
  context: UserAuthorizationContext,
  input: RevokeDisplayTokenInput,
): Promise<RevokeDisplayTokenResult> {
  if (!facilitatorAuthorized(context, input.meetingId)) {
    return failed("FORBIDDEN");
  }

  let expectedPosition: ReturnType<typeof meetingPosition>;
  let meetingScope: ReturnType<typeof meetingId>;
  let tokenId: ReturnType<typeof displayTokenId>;
  try {
    expectedPosition = meetingPosition(input.expectedPosition);
    meetingScope = meetingId(input.meetingId);
    tokenId = displayTokenId(input.displayTokenId);
  } catch (error) {
    if (error instanceof DomainValueError) {
      return failed("VALIDATION_FAILED");
    }
    throw error;
  }

  const records = await dependencies.events.load(input.meetingId);
  const active = activeDisplayTokens(records).find(
    (token) =>
      token.displayTokenId === input.displayTokenId &&
      Date.parse(token.expiresAt) > nowMilliseconds(dependencies.clock),
  );
  if (active === undefined) {
    return failed("DISPLAY_TOKEN_EXPIRED");
  }
  const revokedAt = timestamp(dependencies.clock.now());
  const correlation = commandCorrelation(dependencies, input.correlationId);
  const event: EventOf<"DisplayTokenRevoked"> = {
    actor: participantActor(context),
    correlationId: correlation,
    eventId: eventId(dependencies.ids.next("event")),
    eventType: "DisplayTokenRevoked",
    idempotencyKey: idempotencyKey(
      `display-token-revoke:${String(tokenId)}:${dependencies.ids.next("operation")}`,
    ),
    meetingId: meetingScope,
    occurredAt: revokedAt,
    payload: {
      displayTokenId: tokenId,
      revokedAt,
    },
    position: meetingPosition(expectedPosition + 1),
    schemaVersion: schemaVersion(1),
    visibility: "shared",
  };
  const append = await dependencies.events.append({
    events: [event],
    expectedPosition: input.expectedPosition,
    idempotencyKey: String(event.idempotencyKey),
    meetingId: input.meetingId,
  });
  if (append.kind === "position_conflict") {
    return {
      actualPosition: append.actualPosition,
      code: "CONFLICT",
      expectedPosition: append.expectedPosition,
      kind: "failed",
    };
  }
  if (append.kind === "idempotency_conflict" || append.kind === "replayed") {
    return failed("VALIDATION_FAILED");
  }
  return {
    correlationId: String(correlation),
    displayTokenId: String(tokenId),
    kind: "revoked",
    position: Number(event.position),
    revokedAt: String(revokedAt),
  };
}

export async function authorizeDisplayToken(
  dependencies: Pick<DisplayTokenDependencies, "clock" | "events" | "tokens">,
  input: {
    readonly displayToken: string;
    readonly meetingId: string;
  },
): Promise<DisplayTokenAuthorizationResult> {
  if (input.displayToken.length === 0) {
    return { code: "DISPLAY_TOKEN_EXPIRED", kind: "failed" };
  }
  let digest: string;
  try {
    meetingId(input.meetingId);
    digest = await dependencies.tokens.digest(input.displayToken);
  } catch {
    return { code: "DISPLAY_TOKEN_EXPIRED", kind: "failed" };
  }
  const records = await dependencies.events.load(input.meetingId);
  const active = activeDisplayTokens(records).find(
    (token) =>
      token.displayTokenId === digest &&
      Date.parse(token.expiresAt) > nowMilliseconds(dependencies.clock),
  );
  if (active === undefined) {
    return { code: "DISPLAY_TOKEN_EXPIRED", kind: "failed" };
  }
  return {
    authorization: {
      capabilities: new Set(["meeting:read"]),
      displayTokenId: active.displayTokenId,
      kind: "display",
      meetingId: input.meetingId,
    },
    expiresAt: active.expiresAt,
    kind: "authorized",
  };
}
