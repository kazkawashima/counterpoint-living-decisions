import {
  DomainValueError,
  contentHash,
  correlationId,
  createExternalEvent,
  eventId,
  externalEventId,
  idempotencyKey,
  meetingId,
  meetingPosition,
  monitorRegistrationId,
  nonEmptyText,
  participantId,
  replayMeeting,
  revisionNumber,
  schemaVersion,
  timestamp,
  type DomainEvent,
  type EventOf,
  type ExternalEvent,
  type MeetingProjection,
} from "@counterpoint/domain";
import type {
  Clock,
  EventRecord,
  EventStore,
  IdGenerator,
  ProjectionStore,
} from "@counterpoint/ports";

import { authorize, type UserAuthorizationContext } from "./authorization.js";

export interface ExternalEventDependencies {
  readonly clock: Clock;
  readonly events: EventStore<DomainEvent>;
  readonly ids: IdGenerator;
  readonly projections: ProjectionStore<MeetingProjection>;
}

export interface RegulatoryChangeInput {
  readonly correlationId?: string;
  readonly description: string;
  readonly effectiveAt: string;
  readonly eventId: string;
  readonly eventType: "regulatory_change";
  readonly jurisdiction: string;
  readonly meetingId: string;
  readonly monitorRegistrationId: string;
  readonly payloadHash: string;
  readonly source: string;
  readonly sourceReference: string;
}

export type ExternalEventActor =
  | { readonly kind: "system" }
  | { readonly kind: "participant"; readonly participantId: string };

export type ReceiveRegulatoryChangeResult =
  | {
      readonly correlationId: string;
      readonly event: ExternalEvent;
      readonly kind: "received";
      readonly position: number;
      readonly replayed: boolean;
    }
  | {
      readonly actualPosition?: number;
      readonly code:
        | "CONFLICT"
        | "FORBIDDEN"
        | "IDEMPOTENCY_CONFLICT"
        | "MONITOR_REGISTRATION_NOT_FOUND"
        | "VALIDATION_FAILED";
      readonly kind: "failed";
    };

export interface InjectDemoRegulatoryChangeInput {
  readonly correlationId?: string;
  readonly idempotencyKey: string;
  readonly meetingId: string;
}

function normalizeRecords(
  records: readonly EventRecord<DomainEvent>[],
): readonly DomainEvent[] {
  return records.map(({ event, position }) => ({
    ...event,
    position: meetingPosition(position),
  }));
}

function receivedEvent(
  records: readonly EventRecord<DomainEvent>[],
): EventOf<"ExternalEventReceived"> | undefined {
  return normalizeRecords(records).find(
    (event): event is EventOf<"ExternalEventReceived"> =>
      event.eventType === "ExternalEventReceived",
  );
}

export async function receiveRegulatoryChange(
  dependencies: ExternalEventDependencies,
  actor: ExternalEventActor,
  input: RegulatoryChangeInput,
): Promise<ReceiveRegulatoryChangeResult> {
  let key: ReturnType<typeof idempotencyKey>;
  let scope: ReturnType<typeof meetingId>;
  try {
    key = idempotencyKey(input.eventId);
    scope = meetingId(input.meetingId);
  } catch (error) {
    if (error instanceof DomainValueError) {
      return { code: "VALIDATION_FAILED", kind: "failed" };
    }
    throw error;
  }

  const records = await dependencies.events.load(input.meetingId);
  const prior = records.find(
    ({ event }) => event.idempotencyKey === input.eventId,
  );
  if (prior !== undefined) {
    const replay = await dependencies.events.append({
      events: [prior.event],
      expectedPosition: prior.position - 1,
      idempotencyKey: input.eventId,
      meetingId: input.meetingId,
      payloadFingerprint: input.payloadHash,
      trustPayloadFingerprintForReplay: true,
    });
    if (replay.kind === "idempotency_conflict") {
      return { code: "IDEMPOTENCY_CONFLICT", kind: "failed" };
    }
    if (replay.kind === "position_conflict") {
      return {
        actualPosition: replay.actualPosition,
        code: "CONFLICT",
        kind: "failed",
      };
    }
    const event = receivedEvent(replay.records);
    return event === undefined
      ? { code: "IDEMPOTENCY_CONFLICT", kind: "failed" }
      : {
          correlationId: event.correlationId,
          event: event.payload.externalEvent,
          kind: "received",
          position: event.position,
          replayed: true,
        };
  }

  const currentPosition = records.at(-1)?.position ?? 0;
  const projection = replayMeeting(scope, normalizeRecords(records));
  const registration = monitorRegistrationId(input.monitorRegistrationId);
  const monitoredDecision = projection.shared.decisions.find(
    (decision) =>
      decision.status === "MONITORING" &&
      decision.monitorCondition.registrationId === registration,
  );
  if (monitoredDecision === undefined) {
    return { code: "MONITOR_REGISTRATION_NOT_FOUND", kind: "failed" };
  }

  let externalEvent: ExternalEvent;
  let envelope: EventOf<"ExternalEventReceived">;
  try {
    const receivedAt = timestamp(dependencies.clock.now());
    const eventActor =
      actor.kind === "system"
        ? ({ kind: "system" } as const)
        : ({
            kind: "participant",
            participantId: participantId(actor.participantId),
          } as const);
    externalEvent = createExternalEvent({
      confirmationStatus: "not_applicable",
      createdAt: receivedAt,
      createdBy:
        actor.kind === "system" ? "system" : participantId(actor.participantId),
      description: nonEmptyText(input.description),
      effectiveAt: timestamp(input.effectiveAt),
      eventType: nonEmptyText(input.eventType),
      id: externalEventId(input.eventId),
      jurisdiction: nonEmptyText(input.jurisdiction),
      meetingId: scope,
      monitorRegistrationId: registration,
      origin: actor.kind === "system" ? "system" : "human_input",
      payloadHash: contentHash(input.payloadHash),
      receivedAt,
      revision: revisionNumber(1),
      schemaVersion: revisionNumber(1),
      signatureResult: actor.kind === "system" ? "valid" : "not_applicable",
      source: nonEmptyText(input.source),
      sourceReference: nonEmptyText(input.sourceReference),
      visibility: "shared",
    });
    envelope = {
      actor: eventActor,
      correlationId: correlationId(
        input.correlationId ?? dependencies.ids.next("correlation"),
      ),
      eventId: eventId(dependencies.ids.next("event")),
      eventType: "ExternalEventReceived",
      idempotencyKey: key,
      meetingId: scope,
      occurredAt: receivedAt,
      payload: { externalEvent },
      position: meetingPosition(currentPosition + 1),
      schemaVersion: schemaVersion(1),
      visibility: "shared",
    };
  } catch (error) {
    if (error instanceof DomainValueError) {
      return { code: "VALIDATION_FAILED", kind: "failed" };
    }
    throw error;
  }

  const appended = await dependencies.events.append({
    events: [envelope],
    expectedPosition: currentPosition,
    idempotencyKey: input.eventId,
    meetingId: input.meetingId,
    payloadFingerprint: input.payloadHash,
    trustPayloadFingerprintForReplay: true,
  });
  if (appended.kind === "idempotency_conflict") {
    return { code: "IDEMPOTENCY_CONFLICT", kind: "failed" };
  }
  if (appended.kind === "position_conflict") {
    return {
      actualPosition: appended.actualPosition,
      code: "CONFLICT",
      kind: "failed",
    };
  }
  const received = receivedEvent(appended.records);
  if (received === undefined) {
    throw new Error("External event append returned no receipt");
  }
  const refreshed = replayMeeting(
    scope,
    normalizeRecords(await dependencies.events.load(input.meetingId)),
  );
  await dependencies.projections.put(
    {
      meetingId: input.meetingId,
      projection: "meeting",
    },
    refreshed,
  );
  return {
    correlationId: received.correlationId,
    event: received.payload.externalEvent,
    kind: "received",
    position: received.position,
    replayed: appended.kind === "replayed",
  };
}

export async function injectDemoRegulatoryChange(
  dependencies: ExternalEventDependencies,
  context: UserAuthorizationContext,
  input: InjectDemoRegulatoryChangeInput,
): Promise<ReceiveRegulatoryChangeResult> {
  const authorization = authorize(context, {
    capability: "demo:event-inject",
    meetingId: input.meetingId,
  });
  if (authorization.kind !== "authorized" || context.role !== "facilitator") {
    return { code: "FORBIDDEN", kind: "failed" };
  }
  const records = await dependencies.events.load(input.meetingId);
  const projection = replayMeeting(
    meetingId(input.meetingId),
    normalizeRecords(records),
  );
  const monitoredDecision = projection.shared.decisions.find(
    (decision) =>
      decision.status === "MONITORING" &&
      decision.monitorCondition.registrationId !== undefined,
  );
  if (monitoredDecision?.monitorCondition.registrationId === undefined) {
    return { code: "MONITOR_REGISTRATION_NOT_FOUND", kind: "failed" };
  }
  return receiveRegulatoryChange(
    dependencies,
    { kind: "participant", participantId: context.participantId },
    {
      ...(input.correlationId === undefined
        ? {}
        : { correlationId: input.correlationId }),
      description:
        "Staged demo event: a synthetic regional regulation changes the approval gate.",
      effectiveAt: "2026-08-01T00:00:00.000Z",
      eventId: `demo-regulator:${input.idempotencyKey}`,
      eventType: "regulatory_change",
      jurisdiction: "European Union",
      meetingId: input.meetingId,
      monitorRegistrationId: monitoredDecision.monitorCondition.registrationId,
      payloadHash: "sha256:c3RhZ2VkLWRlbW8tcmVndWxhdG9yeS1ldmVudA",
      source: "Counterpoint staged synthetic regulator",
      sourceReference: "demo://regulatory-change/eu-approval-gate",
    },
  );
}
