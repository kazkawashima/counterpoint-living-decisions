import {
  DomainValueError,
  correlationId,
  createUtterance,
  eventId,
  idempotencyKey,
  meetingId,
  meetingPosition,
  nonEmptyText,
  participantId,
  replayMeeting,
  revisionNumber,
  schemaVersion,
  timestamp,
  utteranceId,
  type DomainEvent,
  type EventOf,
  type MeetingProjection,
  type Utterance,
  type UtteranceChannel,
} from "@counterpoint/domain";
import type { Clock, EventRecord, EventStore } from "@counterpoint/ports";

import { authorize, type UserAuthorizationContext } from "./authorization.js";

export const SHARED_FLOOR_LEASE_MS = 15_000;

export interface UtteranceDependencies {
  readonly clock: Clock;
  readonly events: EventStore<DomainEvent>;
}

export interface AcquireSharedFloorInput {
  readonly correlationId?: string;
  readonly meetingId: string;
  readonly utteranceId: string;
}

export interface ReleaseSharedFloorInput {
  readonly meetingId: string;
  readonly utteranceId: string;
}

export interface CaptureUtteranceInput {
  readonly capturedAt: string;
  readonly channel: UtteranceChannel;
  readonly meetingId: string;
  readonly text: string;
  readonly utteranceId: string;
}

export type UtteranceFailure =
  | {
      readonly actualPosition: number;
      readonly code: "CONFLICT";
      readonly expectedPosition: number;
      readonly kind: "failed";
    }
  | {
      readonly code:
        | "FORBIDDEN"
        | "IDEMPOTENCY_CONFLICT"
        | "SHARED_FLOOR_BUSY"
        | "VALIDATION_FAILED";
      readonly kind: "failed";
    };

export type AcquireSharedFloorResult =
  | {
      readonly correlationId: string;
      readonly kind: "acquired";
      readonly leaseExpiresAt: string;
      readonly meetingId: string;
      readonly participantId: string;
      readonly position: number;
      readonly replayed: boolean;
      readonly utteranceId: string;
    }
  | UtteranceFailure;

export type ReleaseSharedFloorResult =
  | {
      readonly correlationId: string;
      readonly kind: "released";
      readonly meetingId: string;
      readonly position: number;
      readonly releasedAt: string;
      readonly replayed: boolean;
      readonly utteranceId: string;
    }
  | UtteranceFailure;

export type CaptureUtteranceResult =
  | {
      readonly correlationId: string;
      readonly kind: "captured";
      readonly meetingId: string;
      readonly position: number;
      readonly replayed: boolean;
      readonly utterance: {
        readonly capturedAt: string;
        readonly channel: UtteranceChannel;
        readonly participantId: string;
        readonly text: string;
        readonly utteranceId: string;
      };
    }
  | UtteranceFailure;

interface LoadedState {
  readonly events: readonly DomainEvent[];
  readonly position: number;
  readonly projection: MeetingProjection;
}

function failed(
  code: Exclude<UtteranceFailure["code"], "CONFLICT">,
): UtteranceFailure {
  return { code, kind: "failed" };
}

function normalizeRecords(
  records: readonly EventRecord<DomainEvent>[],
): readonly DomainEvent[] {
  return records.map(({ event, position }) => ({
    ...event,
    position: meetingPosition(position),
  }));
}

async function loadState(
  dependencies: UtteranceDependencies,
  meetingScope: string,
): Promise<LoadedState> {
  const records = await dependencies.events.load(meetingScope);
  const events = normalizeRecords(records);
  return {
    events,
    position: records.at(-1)?.position ?? 0,
    projection: replayMeeting(meetingId(meetingScope), events),
  };
}

function floorKey(meetingScope: string, utteranceScope: string): string {
  return `shared-floor:${meetingScope}:${utteranceScope}`;
}

function floorReleaseKey(meetingScope: string, utteranceScope: string): string {
  return `shared-floor-release:${meetingScope}:${utteranceScope}`;
}

function utteranceCorrelation(
  meetingScope: string,
  utteranceScope: string,
): string {
  return `utterance:${meetingScope}:${utteranceScope}`;
}

function currentFloorAcquisition(
  events: readonly DomainEvent[],
): EventOf<"SharedFloorAcquired"> | undefined {
  let acquisition: EventOf<"SharedFloorAcquired"> | undefined;
  for (const event of events) {
    if (event.eventType === "SharedFloorAcquired") {
      acquisition = event;
    } else if (
      event.eventType === "SharedFloorReleased" &&
      acquisition?.payload.participantId === event.payload.participantId
    ) {
      acquisition = undefined;
    }
  }
  return acquisition;
}

function findRelease(
  events: readonly DomainEvent[],
  key: string,
): EventOf<"SharedFloorReleased"> | undefined {
  return events.find(
    (event): event is EventOf<"SharedFloorReleased"> =>
      event.eventType === "SharedFloorReleased" && event.idempotencyKey === key,
  );
}

function findUtterance(
  events: readonly DomainEvent[],
  id: string,
): EventOf<"UtteranceCaptured"> | undefined {
  return events.find(
    (event): event is EventOf<"UtteranceCaptured"> =>
      event.eventType === "UtteranceCaptured" &&
      event.payload.utterance.id === id,
  );
}

function authorized(
  context: UserAuthorizationContext,
  meetingScope: string,
): boolean {
  return (
    authorize(context, {
      capability: "meeting:read",
      meetingId: meetingScope,
    }).kind === "authorized"
  );
}

function conflict(
  actualPosition: number,
  expectedPosition: number,
): UtteranceFailure {
  return {
    actualPosition,
    code: "CONFLICT",
    expectedPosition,
    kind: "failed",
  };
}

function acquiredResult(
  event: EventOf<"SharedFloorAcquired">,
  utteranceScope: string,
  replayed: boolean,
): AcquireSharedFloorResult {
  return {
    correlationId: event.correlationId,
    kind: "acquired",
    leaseExpiresAt: event.payload.leaseExpiresAt,
    meetingId: event.meetingId,
    participantId: event.payload.participantId,
    position: event.position,
    replayed,
    utteranceId: utteranceScope,
  };
}

function releasedResult(
  event: EventOf<"SharedFloorReleased">,
  utteranceScope: string,
  replayed: boolean,
): ReleaseSharedFloorResult {
  return {
    correlationId: event.correlationId,
    kind: "released",
    meetingId: event.meetingId,
    position: event.position,
    releasedAt: event.occurredAt,
    replayed,
    utteranceId: utteranceScope,
  };
}

function capturedResult(
  event: EventOf<"UtteranceCaptured">,
  replayed: boolean,
): CaptureUtteranceResult {
  const utterance = event.payload.utterance;
  return {
    correlationId: event.correlationId,
    kind: "captured",
    meetingId: event.meetingId,
    position: event.position,
    replayed,
    utterance: {
      capturedAt: utterance.capturedAt,
      channel: utterance.channel,
      participantId: utterance.participantId,
      text: utterance.text,
      utteranceId: utterance.id,
    },
  };
}

function prepareScopes(
  context: UserAuthorizationContext,
  input: {
    readonly meetingId: string;
    readonly utteranceId: string;
  },
):
  | {
      readonly meetingScope: ReturnType<typeof meetingId>;
      readonly participantScope: ReturnType<typeof participantId>;
      readonly utteranceScope: ReturnType<typeof utteranceId>;
    }
  | UtteranceFailure {
  try {
    return {
      meetingScope: meetingId(input.meetingId),
      participantScope: participantId(context.participantId),
      utteranceScope: utteranceId(input.utteranceId),
    };
  } catch (error) {
    if (error instanceof DomainValueError) {
      return failed("VALIDATION_FAILED");
    }
    throw error;
  }
}

export async function acquireSharedFloor(
  dependencies: UtteranceDependencies,
  context: UserAuthorizationContext,
  input: AcquireSharedFloorInput,
): Promise<AcquireSharedFloorResult> {
  if (!authorized(context, input.meetingId)) {
    return failed("FORBIDDEN");
  }
  const scopes = prepareScopes(context, input);
  if ("kind" in scopes) {
    return scopes;
  }

  let now: ReturnType<typeof timestamp>;
  let correlation: ReturnType<typeof correlationId>;
  try {
    now = timestamp(dependencies.clock.now());
    correlation = correlationId(
      input.correlationId ??
        floorKey(scopes.meetingScope, scopes.utteranceScope),
    );
  } catch (error) {
    if (error instanceof DomainValueError) {
      return failed("VALIDATION_FAILED");
    }
    throw error;
  }

  const state = await loadState(dependencies, scopes.meetingScope);
  const projectedFloor = state.projection.shared.sharedFloor;
  const acquisition = currentFloorAcquisition(state.events);
  const key = floorKey(scopes.meetingScope, scopes.utteranceScope);
  const active =
    projectedFloor !== undefined &&
    Date.parse(projectedFloor.leaseExpiresAt) > Date.parse(now);

  if (active) {
    if (
      projectedFloor.participantId === scopes.participantScope &&
      acquisition?.idempotencyKey === key
    ) {
      return acquiredResult(acquisition, scopes.utteranceScope, true);
    }
    return failed("SHARED_FLOOR_BUSY");
  }

  const leaseExpiresAt = timestamp(
    new Date(Date.parse(now) + SHARED_FLOOR_LEASE_MS).toISOString(),
  );
  const events: DomainEvent[] = [];
  if (projectedFloor !== undefined) {
    events.push({
      actor: { kind: "system" },
      correlationId: correlation,
      eventId: eventId(`${key}:expired`),
      eventType: "SharedFloorReleased",
      meetingId: scopes.meetingScope,
      occurredAt: now,
      payload: {
        participantId: projectedFloor.participantId,
        reason: "expired",
      },
      position: meetingPosition(state.position + 1),
      schemaVersion: schemaVersion(1),
      visibility: "shared",
    });
  }
  const acquired: EventOf<"SharedFloorAcquired"> = {
    actor: {
      kind: "participant",
      participantId: scopes.participantScope,
    },
    correlationId: correlation,
    eventId: eventId(`${key}:acquired`),
    eventType: "SharedFloorAcquired",
    idempotencyKey: idempotencyKey(key),
    meetingId: scopes.meetingScope,
    occurredAt: now,
    payload: {
      leaseExpiresAt,
      participantId: scopes.participantScope,
    },
    position: meetingPosition(state.position + events.length + 1),
    schemaVersion: schemaVersion(1),
    visibility: "shared",
  };
  events.push(acquired);

  const appended = await dependencies.events.append({
    events,
    expectedPosition: state.position,
    idempotencyKey: key,
    meetingId: scopes.meetingScope,
  });
  if (appended.kind === "position_conflict") {
    const latest = await loadState(dependencies, scopes.meetingScope);
    const latestFloor = latest.projection.shared.sharedFloor;
    const latestAcquisition = currentFloorAcquisition(latest.events);
    if (
      latestFloor !== undefined &&
      Date.parse(latestFloor.leaseExpiresAt) > Date.parse(now)
    ) {
      if (
        latestFloor.participantId === scopes.participantScope &&
        latestAcquisition?.idempotencyKey === key
      ) {
        return acquiredResult(latestAcquisition, scopes.utteranceScope, true);
      }
      return failed("SHARED_FLOOR_BUSY");
    }
    return conflict(appended.actualPosition, appended.expectedPosition);
  }
  if (appended.kind === "idempotency_conflict") {
    return failed("IDEMPOTENCY_CONFLICT");
  }
  const result = normalizeRecords(appended.records).find(
    (event): event is EventOf<"SharedFloorAcquired"> =>
      event.eventType === "SharedFloorAcquired" && event.idempotencyKey === key,
  );
  return result === undefined
    ? failed("IDEMPOTENCY_CONFLICT")
    : acquiredResult(
        result,
        scopes.utteranceScope,
        appended.kind === "replayed",
      );
}

export async function releaseSharedFloor(
  dependencies: UtteranceDependencies,
  context: UserAuthorizationContext,
  input: ReleaseSharedFloorInput,
): Promise<ReleaseSharedFloorResult> {
  if (!authorized(context, input.meetingId)) {
    return failed("FORBIDDEN");
  }
  const scopes = prepareScopes(context, input);
  if ("kind" in scopes) {
    return scopes;
  }

  const key = floorReleaseKey(scopes.meetingScope, scopes.utteranceScope);
  const acquisitionKey = floorKey(scopes.meetingScope, scopes.utteranceScope);
  const state = await loadState(dependencies, scopes.meetingScope);
  const prior = findRelease(state.events, key);
  if (
    prior?.payload.participantId === scopes.participantScope &&
    prior.actor.kind === "participant" &&
    prior.actor.participantId === scopes.participantScope
  ) {
    return releasedResult(prior, scopes.utteranceScope, true);
  }

  const projectedFloor = state.projection.shared.sharedFloor;
  const acquisition = currentFloorAcquisition(state.events);
  if (
    projectedFloor?.participantId !== scopes.participantScope ||
    acquisition?.idempotencyKey !== acquisitionKey
  ) {
    return failed("FORBIDDEN");
  }

  let releasedAt: ReturnType<typeof timestamp>;
  try {
    releasedAt = timestamp(dependencies.clock.now());
  } catch (error) {
    if (error instanceof DomainValueError) {
      return failed("VALIDATION_FAILED");
    }
    throw error;
  }
  const correlation = correlationId(key);
  const released: EventOf<"SharedFloorReleased"> = {
    actor: {
      kind: "participant",
      participantId: scopes.participantScope,
    },
    correlationId: correlation,
    eventId: eventId(`${key}:released`),
    eventType: "SharedFloorReleased",
    idempotencyKey: idempotencyKey(key),
    meetingId: scopes.meetingScope,
    occurredAt: releasedAt,
    payload: {
      participantId: scopes.participantScope,
      reason: "released",
    },
    position: meetingPosition(state.position + 1),
    schemaVersion: schemaVersion(1),
    visibility: "shared",
  };
  const appended = await dependencies.events.append({
    events: [released],
    expectedPosition: state.position,
    idempotencyKey: key,
    meetingId: scopes.meetingScope,
  });
  if (appended.kind === "position_conflict") {
    return conflict(appended.actualPosition, appended.expectedPosition);
  }
  if (appended.kind === "idempotency_conflict") {
    return failed("IDEMPOTENCY_CONFLICT");
  }
  const result = normalizeRecords(appended.records).find(
    (event): event is EventOf<"SharedFloorReleased"> =>
      event.eventType === "SharedFloorReleased" && event.idempotencyKey === key,
  );
  return result === undefined
    ? failed("IDEMPOTENCY_CONFLICT")
    : releasedResult(
        result,
        scopes.utteranceScope,
        appended.kind === "replayed",
      );
}

function sameUtterance(
  event: EventOf<"UtteranceCaptured">,
  participantScope: string,
  input: CaptureUtteranceInput,
  canonicalText: string,
): boolean {
  const utterance = event.payload.utterance;
  return (
    utterance.participantId === participantScope &&
    utterance.channel === input.channel &&
    utterance.text === canonicalText &&
    utterance.capturedAt === input.capturedAt
  );
}

function buildUtterance(
  meetingScope: ReturnType<typeof meetingId>,
  participantScope: ReturnType<typeof participantId>,
  utteranceScope: ReturnType<typeof utteranceId>,
  channel: UtteranceChannel,
  text: ReturnType<typeof nonEmptyText>,
  capturedAt: ReturnType<typeof timestamp>,
): Utterance {
  const common = {
    capturedAt,
    channel,
    confirmationStatus: "not_applicable" as const,
    createdAt: capturedAt,
    createdBy: participantScope,
    id: utteranceScope,
    idempotencyKey: idempotencyKey(utteranceScope),
    meetingId: meetingScope,
    origin: "human_utterance" as const,
    participantId: participantScope,
    revision: revisionNumber(1),
    text,
  };
  return channel === "private"
    ? createUtterance({
        ...common,
        channel: "private",
        ownerParticipantId: participantScope,
        visibility: "private",
      })
    : createUtterance({
        ...common,
        channel: "shared",
        visibility: "shared",
      });
}

export async function captureUtterance(
  dependencies: UtteranceDependencies,
  context: UserAuthorizationContext,
  input: CaptureUtteranceInput,
): Promise<CaptureUtteranceResult> {
  if (!authorized(context, input.meetingId)) {
    return failed("FORBIDDEN");
  }
  const scopes = prepareScopes(context, input);
  if ("kind" in scopes) {
    return scopes;
  }

  let capturedAt: ReturnType<typeof timestamp>;
  let text: ReturnType<typeof nonEmptyText>;
  let now: ReturnType<typeof timestamp>;
  try {
    if (input.text.length > 4_000) {
      return failed("VALIDATION_FAILED");
    }
    capturedAt = timestamp(input.capturedAt);
    text = nonEmptyText(input.text);
    now = timestamp(dependencies.clock.now());
  } catch (error) {
    if (error instanceof DomainValueError) {
      return failed("VALIDATION_FAILED");
    }
    throw error;
  }
  if (input.channel !== "private" && input.channel !== "shared") {
    return failed("VALIDATION_FAILED");
  }

  const state = await loadState(dependencies, scopes.meetingScope);
  const prior = findUtterance(state.events, scopes.utteranceScope);
  if (prior !== undefined) {
    return sameUtterance(prior, scopes.participantScope, input, text)
      ? capturedResult(prior, true)
      : failed("IDEMPOTENCY_CONFLICT");
  }

  if (input.channel === "shared") {
    const projectedFloor = state.projection.shared.sharedFloor;
    const acquisition = currentFloorAcquisition(state.events);
    const active =
      projectedFloor !== undefined &&
      Date.parse(projectedFloor.leaseExpiresAt) > Date.parse(now);
    if (active && projectedFloor.participantId !== scopes.participantScope) {
      return failed("SHARED_FLOOR_BUSY");
    }
    if (
      !active ||
      acquisition?.payload.participantId !== scopes.participantScope ||
      acquisition.idempotencyKey !==
        floorKey(scopes.meetingScope, scopes.utteranceScope)
    ) {
      return failed("FORBIDDEN");
    }
  }

  let utterance: Utterance;
  try {
    utterance = buildUtterance(
      scopes.meetingScope,
      scopes.participantScope,
      scopes.utteranceScope,
      input.channel,
      text,
      capturedAt,
    );
  } catch (error) {
    if (error instanceof DomainValueError) {
      return failed("VALIDATION_FAILED");
    }
    throw error;
  }

  const correlation = correlationId(
    utteranceCorrelation(scopes.meetingScope, scopes.utteranceScope),
  );
  const common = {
    actor: {
      kind: "participant" as const,
      participantId: scopes.participantScope,
    },
    correlationId: correlation,
    eventId: eventId(
      `${utteranceCorrelation(scopes.meetingScope, scopes.utteranceScope)}:captured`,
    ),
    eventType: "UtteranceCaptured" as const,
    idempotencyKey: idempotencyKey(scopes.utteranceScope),
    meetingId: scopes.meetingScope,
    occurredAt: now,
    payload: { utterance },
    position: meetingPosition(state.position + 1),
    schemaVersion: schemaVersion(1),
  };
  const captured: EventOf<"UtteranceCaptured"> =
    utterance.visibility === "private"
      ? {
          ...common,
          ownerParticipantId: scopes.participantScope,
          visibility: "private",
        }
      : {
          ...common,
          visibility: "shared",
        };
  const appended = await dependencies.events.append({
    events: [captured],
    expectedPosition: state.position,
    idempotencyKey: scopes.utteranceScope,
    meetingId: scopes.meetingScope,
  });
  if (appended.kind === "position_conflict") {
    return conflict(appended.actualPosition, appended.expectedPosition);
  }
  if (appended.kind === "idempotency_conflict") {
    return failed("IDEMPOTENCY_CONFLICT");
  }
  const result = normalizeRecords(appended.records).find(
    (event): event is EventOf<"UtteranceCaptured"> =>
      event.eventType === "UtteranceCaptured" &&
      event.payload.utterance.id === scopes.utteranceScope,
  );
  return result === undefined
    ? failed("IDEMPOTENCY_CONFLICT")
    : capturedResult(result, appended.kind === "replayed");
}
