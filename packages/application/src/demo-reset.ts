import {
  DomainValueError,
  causationId,
  correlationId,
  eventId,
  idempotencyKey,
  meetingId,
  meetingPosition,
  nonEmptyText,
  participantId,
  replayMeeting,
  resetRequestId,
  schemaVersion,
  timestamp,
  type DomainEvent,
  type EventOf,
  type MeetingProjection,
} from "@counterpoint/domain";
import type {
  Clock,
  EventRecord,
  EventStore,
  ProjectionStore,
} from "@counterpoint/ports";

import { authorize, type UserAuthorizationContext } from "./authorization.js";

const MEETING_PROJECTION = "meeting";

export type DemoResetHashFunction =
  | ((value: string) => Promise<string> | string)
  | {
      hash(value: string): Promise<string> | string;
    };

export interface DemoResetDependencies {
  readonly clock: Clock;
  readonly events: EventStore<DomainEvent>;
  readonly hash: DemoResetHashFunction;
  readonly projections: ProjectionStore<MeetingProjection>;
}

export interface ResetDemoMeetingInput {
  readonly expectedPosition: number;
  readonly idempotencyKey: string;
  readonly meetingId: string;
  readonly seedName: string;
}

export type DemoResetFailure =
  | {
      readonly actualPosition: number;
      readonly code: "CONFLICT";
      readonly expectedPosition: number;
      readonly kind: "failed";
    }
  | {
      readonly code: "FORBIDDEN" | "IDEMPOTENCY_CONFLICT" | "VALIDATION_FAILED";
      readonly kind: "failed";
    };

export type ResetDemoMeetingResult =
  | {
      readonly completedEventId: string;
      readonly correlationId: string;
      readonly kind: "reset";
      readonly position: number;
      readonly replayed: boolean;
      readonly requestedEventId: string;
      readonly resetRequestId: string;
      readonly seedName: string;
    }
  | DemoResetFailure;

interface PreparedReset {
  readonly fingerprint: string;
  readonly identity: string;
  readonly key: ReturnType<typeof idempotencyKey>;
  readonly meetingScope: ReturnType<typeof meetingId>;
  readonly seed: ReturnType<typeof nonEmptyText>;
}

interface ResetPair {
  readonly completed: EventOf<"DemoResetCompleted">;
  readonly requested: EventOf<"DemoResetRequested">;
}

function failed(
  code: Exclude<DemoResetFailure["code"], "CONFLICT">,
): DemoResetFailure {
  return { code, kind: "failed" };
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(",")}]`;
  }
  return `{${Object.entries(value as Readonly<Record<string, unknown>>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`)
    .join(",")}}`;
}

async function hashValue(
  hash: DemoResetHashFunction,
  value: string,
): Promise<string> {
  const result =
    typeof hash === "function" ? await hash(value) : await hash.hash(value);
  if (
    result.length === 0 ||
    result.length > 512 ||
    result.trim() !== result ||
    /\s/u.test(result)
  ) {
    throw new DomainValueError(
      "Injected hash must be a non-empty, whitespace-free value",
    );
  }
  return result;
}

function normalizeRecords(
  records: readonly EventRecord<DomainEvent>[],
): readonly DomainEvent[] {
  return records.map(({ event, position }) => ({
    ...event,
    position: meetingPosition(position),
  }));
}

function resetPair(
  records: readonly EventRecord<DomainEvent>[],
  key: string,
): ResetPair | undefined {
  const events = normalizeRecords(records);
  const requested = events.find(
    (event): event is EventOf<"DemoResetRequested"> =>
      event.eventType === "DemoResetRequested" && event.idempotencyKey === key,
  );
  if (requested === undefined) {
    return undefined;
  }
  const completed = events.find(
    (event): event is EventOf<"DemoResetCompleted"> =>
      event.eventType === "DemoResetCompleted" &&
      event.position === requested.position + 1 &&
      event.causationId === causationId(requested.eventId) &&
      event.correlationId === requested.correlationId &&
      event.payload.resetRequestId === requested.payload.resetRequestId &&
      event.payload.seedName === requested.payload.seedName,
  );
  return completed === undefined ? undefined : { completed, requested };
}

async function refreshProjection(
  dependencies: DemoResetDependencies,
  meetingScope: string,
  participantScope: string,
): Promise<void> {
  const records = await dependencies.events.load(meetingScope);
  await dependencies.projections.put(
    {
      meetingId: meetingScope,
      ownerParticipantId: participantScope,
      projection: MEETING_PROJECTION,
    },
    replayMeeting(meetingId(meetingScope), normalizeRecords(records)),
  );
}

async function prepareReset(
  dependencies: DemoResetDependencies,
  context: UserAuthorizationContext,
  input: ResetDemoMeetingInput,
): Promise<DemoResetFailure | PreparedReset> {
  try {
    const meetingScope = meetingId(input.meetingId);
    const key = idempotencyKey(input.idempotencyKey);
    const seed = nonEmptyText(input.seedName);
    meetingPosition(input.expectedPosition);
    participantId(context.participantId);
    const identity = `demo-reset:${meetingScope}:${key}`;
    resetRequestId(identity);
    correlationId(identity);
    eventId(`${identity}:requested`);
    eventId(`${identity}:completed`);
    return {
      fingerprint: await hashValue(
        dependencies.hash,
        stableSerialize({
          command: "reset-demo-meeting",
          meetingId: meetingScope,
          seedName: seed,
        }),
      ),
      identity,
      key,
      meetingScope,
      seed,
    };
  } catch (error) {
    if (error instanceof DomainValueError) {
      return failed("VALIDATION_FAILED");
    }
    throw error;
  }
}

function resultFromPair(
  pair: ResetPair,
  replayed: boolean,
): ResetDemoMeetingResult {
  return {
    completedEventId: pair.completed.eventId,
    correlationId: pair.requested.correlationId,
    kind: "reset",
    position: pair.completed.position,
    replayed,
    requestedEventId: pair.requested.eventId,
    resetRequestId: pair.requested.payload.resetRequestId,
    seedName: pair.requested.payload.seedName,
  };
}

export async function resetDemoMeeting(
  dependencies: DemoResetDependencies,
  context: UserAuthorizationContext,
  input: ResetDemoMeetingInput,
): Promise<ResetDemoMeetingResult> {
  const authorization = authorize(context, {
    capability: "demo:reset",
    meetingId: input.meetingId,
  });
  if (context.role !== "facilitator" || authorization.kind !== "authorized") {
    return failed("FORBIDDEN");
  }

  const prepared = await prepareReset(dependencies, context, input);
  if ("kind" in prepared) {
    return prepared;
  }

  const records = await dependencies.events.load(input.meetingId);
  const prior = resetPair(records, input.idempotencyKey);
  if (
    prior === undefined &&
    records.some(({ event }) => event.idempotencyKey === input.idempotencyKey)
  ) {
    return failed("IDEMPOTENCY_CONFLICT");
  }

  let events: readonly DomainEvent[];
  if (prior !== undefined) {
    events = [prior.requested, prior.completed];
  } else {
    const occurredAt = timestamp(dependencies.clock.now());
    const correlation = correlationId(prepared.identity);
    const request = resetRequestId(prepared.identity);
    const requested: EventOf<"DemoResetRequested"> = {
      actor: {
        kind: "participant",
        participantId: participantId(context.participantId),
      },
      correlationId: correlation,
      eventId: eventId(`${prepared.identity}:requested`),
      eventType: "DemoResetRequested",
      idempotencyKey: prepared.key,
      meetingId: prepared.meetingScope,
      occurredAt,
      payload: {
        resetRequestId: request,
        seedName: prepared.seed,
      },
      position: meetingPosition(input.expectedPosition + 1),
      schemaVersion: schemaVersion(1),
      visibility: "shared",
    };
    const completed: EventOf<"DemoResetCompleted"> = {
      actor: { kind: "system" },
      causationId: causationId(requested.eventId),
      correlationId: correlation,
      eventId: eventId(`${prepared.identity}:completed`),
      eventType: "DemoResetCompleted",
      meetingId: prepared.meetingScope,
      occurredAt,
      payload: {
        resetRequestId: request,
        seedName: prepared.seed,
      },
      position: meetingPosition(input.expectedPosition + 2),
      schemaVersion: schemaVersion(1),
      visibility: "shared",
    };
    events = [requested, completed];
  }

  const appended = await dependencies.events.append({
    events,
    expectedPosition: input.expectedPosition,
    idempotencyKey: input.idempotencyKey,
    meetingId: input.meetingId,
    payloadFingerprint: prepared.fingerprint,
    trustPayloadFingerprintForReplay: true,
  });
  if (appended.kind === "position_conflict") {
    return {
      actualPosition: appended.actualPosition,
      code: "CONFLICT",
      expectedPosition: appended.expectedPosition,
      kind: "failed",
    };
  }
  if (appended.kind === "idempotency_conflict") {
    return failed("IDEMPOTENCY_CONFLICT");
  }

  const pair = resetPair(appended.records, input.idempotencyKey);
  if (pair === undefined) {
    return failed("IDEMPOTENCY_CONFLICT");
  }
  await refreshProjection(dependencies, input.meetingId, context.participantId);
  return resultFromPair(pair, appended.kind === "replayed");
}
