import {
  DecisionTransitionError,
  DomainValueError,
  actionId,
  appendDecisionRevision,
  correlationId,
  createDecision,
  createDecisionRevision,
  decisionId,
  decisionRevisionId,
  dissentId,
  eventId,
  evidenceId,
  idempotencyKey,
  meetingId,
  meetingPosition,
  monitorRegistrationId,
  nextDecisionRevision,
  nonEmptyText,
  participantId,
  premiseId,
  replayMeeting,
  revisionNumber,
  schemaVersion,
  timestamp,
  transitionDecision,
  type Decision,
  type DecisionRevision,
  type DecisionSnapshot,
  type DomainEvent,
  type EventOf,
  type MeetingProjection,
  type MonitorCondition,
  type NonEmptyText,
} from "@counterpoint/domain";
import type {
  Clock,
  EventRecord,
  EventStore,
  IdGenerator,
  ProjectionStore,
} from "@counterpoint/ports";

import { authorize, type UserAuthorizationContext } from "./authorization.js";

const MEETING_PROJECTION = "meeting";

export type DecisionHashFunction =
  | ((value: string) => Promise<string> | string)
  | {
      hash(value: string): Promise<string> | string;
    };

export interface DecisionDependencies {
  readonly clock: Clock;
  readonly events: EventStore<DomainEvent>;
  readonly hash: DecisionHashFunction;
  readonly ids: IdGenerator;
  readonly projections: ProjectionStore<MeetingProjection>;
}

interface DecisionMutationInput {
  readonly correlationId?: string;
  readonly expectedPosition: number;
  readonly idempotencyKey: string;
  readonly meetingId: string;
}

export interface DecisionDraftFields {
  readonly actionIds: readonly string[];
  readonly dissentIds: readonly string[];
  readonly evidenceIds: readonly string[];
  readonly monitorCondition: {
    readonly description: string;
    readonly registrationId?: string;
  };
  readonly outcome: string;
  readonly premiseIds: readonly string[];
  readonly title: string;
}

export interface SaveDecisionDraftInput
  extends DecisionMutationInput, DecisionDraftFields {
  readonly changeReason: string;
  /**
   * Omit for a new Decision. Supply an existing DRAFT Decision ID to append a
   * revision without replacing its history.
   */
  readonly decisionId?: string;
}

export interface MarkDecisionReadyInput extends DecisionMutationInput {
  readonly decisionId: string;
}

export interface CommitDecisionInput extends DecisionMutationInput {
  readonly decisionId: string;
  readonly explicitCommit: boolean;
}

export interface StartDecisionMonitoringInput extends DecisionMutationInput {
  readonly decisionId: string;
}

export type DecisionFailure =
  | {
      readonly actualPosition: number;
      readonly code: "CONFLICT";
      readonly expectedPosition: number;
      readonly kind: "failed";
    }
  | {
      readonly code:
        | "DECISION_NOT_FOUND"
        | "EXPLICIT_COMMIT_REQUIRED"
        | "FORBIDDEN"
        | "IDEMPOTENCY_CONFLICT"
        | "INVALID_STATE_TRANSITION"
        | "READINESS_INCOMPLETE"
        | "REFERENCED_ENTITY_NOT_FOUND"
        | "VALIDATION_FAILED";
      readonly kind: "failed";
    };

export type SaveDecisionDraftResult =
  | {
      readonly correlationId: string;
      readonly decision: Decision;
      readonly kind: "draft_saved";
      readonly position: number;
      readonly replayed: boolean;
      readonly revision: DecisionRevision;
    }
  | DecisionFailure;

export type MarkDecisionReadyResult =
  | {
      readonly correlationId: string;
      readonly decision: Decision;
      readonly kind: "ready";
      readonly position: number;
      readonly replayed: boolean;
    }
  | DecisionFailure;

export type CommitDecisionResult =
  | {
      readonly correlationId: string;
      readonly decision: Decision;
      readonly kind: "committed";
      readonly position: number;
      readonly replayed: boolean;
      readonly revision: DecisionRevision;
    }
  | DecisionFailure;

export type StartDecisionMonitoringResult =
  | {
      readonly correlationId: string;
      readonly decision: Decision;
      readonly kind: "monitoring_started";
      readonly monitorRegistrationId: ReturnType<typeof monitorRegistrationId>;
      readonly position: number;
      readonly replayed: boolean;
    }
  | DecisionFailure;

type AppendResult =
  | {
      readonly kind: "appended" | "replayed";
      readonly records: readonly EventRecord<DomainEvent>[];
    }
  | DecisionFailure;

interface PreparedDraft {
  readonly actionIds: Decision["actionIds"];
  readonly dissentIds: Decision["dissentIds"];
  readonly evidenceIds: Decision["evidenceIds"];
  readonly monitorCondition: MonitorCondition;
  readonly outcome: NonEmptyText;
  readonly premiseIds: Decision["premiseIds"];
  readonly title: NonEmptyText;
}

interface LoadedState {
  readonly projection: MeetingProjection;
  readonly records: readonly EventRecord<DomainEvent>[];
}

function failed(
  code: Exclude<DecisionFailure["code"], "CONFLICT">,
): DecisionFailure {
  return { code, kind: "failed" };
}

function authorizeFacilitatorMutation(
  context: UserAuthorizationContext,
  input: DecisionMutationInput,
): DecisionFailure | undefined {
  if (context.role !== "facilitator") {
    return failed("FORBIDDEN");
  }
  const result = authorize(context, {
    capability: "decision:commit",
    meetingId: input.meetingId,
  });
  return result.kind === "authorized" ? undefined : failed("FORBIDDEN");
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
  hash: DecisionHashFunction,
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

function participantActor(context: UserAuthorizationContext): {
  readonly kind: "participant";
  readonly participantId: ReturnType<typeof participantId>;
} {
  return {
    kind: "participant",
    participantId: participantId(context.participantId),
  };
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
  dependencies: DecisionDependencies,
  meetingScope: string,
): Promise<LoadedState> {
  const records = await dependencies.events.load(meetingScope);
  return {
    projection: replayMeeting(
      meetingId(meetingScope),
      normalizeRecords(records),
    ),
    records,
  };
}

async function refreshProjection(
  dependencies: DecisionDependencies,
  meetingScope: string,
  participantScope: string,
): Promise<void> {
  const state = await loadState(dependencies, meetingScope);
  await dependencies.projections.put(
    {
      meetingId: meetingScope,
      ownerParticipantId: participantScope,
      projection: MEETING_PROJECTION,
    },
    state.projection,
  );
}

async function appendMutation(
  dependencies: DecisionDependencies,
  input: DecisionMutationInput,
  fingerprint: string,
  events: readonly DomainEvent[],
  participantScope: string,
): Promise<AppendResult> {
  const result = await dependencies.events.append({
    events,
    expectedPosition: input.expectedPosition,
    idempotencyKey: input.idempotencyKey,
    meetingId: input.meetingId,
    payloadFingerprint: fingerprint,
    trustPayloadFingerprintForReplay: true,
  });
  if (result.kind === "position_conflict") {
    return {
      actualPosition: result.actualPosition,
      code: "CONFLICT",
      expectedPosition: result.expectedPosition,
      kind: "failed",
    };
  }
  if (result.kind === "idempotency_conflict") {
    return failed("IDEMPOTENCY_CONFLICT");
  }
  await refreshProjection(dependencies, input.meetingId, participantScope);
  return result;
}

function eventAt<Type extends DomainEvent["eventType"]>(
  records: readonly EventRecord<DomainEvent>[],
  eventType: Type,
): Extract<DomainEvent, { readonly eventType: Type }> | undefined {
  return normalizeRecords(records).find(
    (event): event is Extract<DomainEvent, { readonly eventType: Type }> =>
      event.eventType === eventType,
  );
}

function idempotentRecord(
  records: readonly EventRecord<DomainEvent>[],
  key: string,
): EventRecord<DomainEvent> | undefined {
  return records.find(({ event }) => event.idempotencyKey === key);
}

function prepareDraft(input: DecisionDraftFields): PreparedDraft {
  return {
    actionIds: input.actionIds.map(actionId),
    dissentIds: input.dissentIds.map(dissentId),
    evidenceIds: input.evidenceIds.map(evidenceId),
    monitorCondition: {
      description: nonEmptyText(input.monitorCondition.description),
      ...(input.monitorCondition.registrationId === undefined
        ? {}
        : {
            registrationId: monitorRegistrationId(
              input.monitorCondition.registrationId,
            ),
          }),
    },
    outcome: nonEmptyText(input.outcome),
    premiseIds: input.premiseIds.map(premiseId),
    title: nonEmptyText(input.title),
  };
}

function draftSnapshot(draft: PreparedDraft): DecisionSnapshot {
  return {
    ...draft,
    status: "DRAFT",
  };
}

function initialRevision(
  context: UserAuthorizationContext,
  decision: Decision,
  changeReason: NonEmptyText,
  occurredAt: ReturnType<typeof timestamp>,
): DecisionRevision {
  return createDecisionRevision({
    changeReason,
    confirmationStatus: "confirmed",
    createdAt: occurredAt,
    createdBy: participantId(context.participantId),
    decisionId: decision.id,
    id: decision.activeRevisionId,
    meetingId: decision.meetingId,
    origin: "human_input",
    revision: revisionNumber(1),
    snapshot: {
      actionIds: decision.actionIds,
      dissentIds: decision.dissentIds,
      evidenceIds: decision.evidenceIds,
      monitorCondition: decision.monitorCondition,
      outcome: decision.outcome,
      premiseIds: decision.premiseIds,
      status: "DRAFT",
      title: decision.title,
    },
    version: revisionNumber(1),
    visibility: "shared",
  });
}

function decisionFromRevision(
  decision: Decision,
  revision: DecisionRevision,
): Decision {
  return createDecision({
    ...decision,
    actionIds: revision.snapshot.actionIds,
    activeRevision: revision.version,
    activeRevisionId: revision.id,
    dissentIds: revision.snapshot.dissentIds,
    evidenceIds: revision.snapshot.evidenceIds,
    monitorCondition: revision.snapshot.monitorCondition,
    outcome: revision.snapshot.outcome,
    premiseIds: revision.snapshot.premiseIds,
    revision: revision.version,
    status: revision.snapshot.status,
    title: revision.snapshot.title,
  });
}

function readinessComplete(readiness: {
  readonly actionIds: boolean;
  readonly evidenceIds: boolean;
  readonly monitorCondition: boolean;
  readonly outcome: boolean;
  readonly premiseIds: boolean;
}): boolean {
  return (
    readiness.outcome &&
    readiness.premiseIds &&
    readiness.evidenceIds &&
    readiness.actionIds &&
    readiness.monitorCondition
  );
}

function deriveCanonicalReadiness(
  projection: MeetingProjection,
  decision: Decision,
): {
  readonly allReferencesExist: boolean;
  readonly readiness: {
    readonly actionIds: boolean;
    readonly evidenceIds: boolean;
    readonly monitorCondition: boolean;
    readonly outcome: boolean;
    readonly premiseIds: boolean;
  };
} {
  const shared = projection.shared;
  const containsAll = <
    Record extends {
      readonly confirmationStatus: string;
      readonly id: string;
      readonly visibility: string;
    },
  >(
    ids: readonly string[],
    records: readonly Record[],
  ): boolean =>
    ids.every((id) =>
      records.some(
        (record) =>
          record.id === id &&
          record.visibility === "shared" &&
          record.confirmationStatus === "confirmed",
      ),
    );

  const premiseReferencesExist = containsAll(
    decision.premiseIds,
    shared.premises,
  );
  const evidenceReferencesExist = containsAll(
    decision.evidenceIds,
    shared.evidence,
  );
  const dissentReferencesExist = containsAll(
    decision.dissentIds,
    shared.dissent,
  );
  const actionReferencesExist = containsAll(decision.actionIds, shared.actions);
  return {
    allReferencesExist:
      premiseReferencesExist &&
      evidenceReferencesExist &&
      dissentReferencesExist &&
      actionReferencesExist,
    readiness: {
      actionIds: decision.actionIds.length > 0 && actionReferencesExist,
      evidenceIds: decision.evidenceIds.length > 0 && evidenceReferencesExist,
      monitorCondition: decision.monitorCondition.description.length > 0,
      outcome: decision.outcome.length > 0,
      premiseIds: decision.premiseIds.length > 0 && premiseReferencesExist,
    },
  };
}

function commandCorrelationId(
  dependencies: DecisionDependencies,
  input: DecisionMutationInput,
): ReturnType<typeof correlationId> {
  return correlationId(
    input.correlationId ?? dependencies.ids.next("correlation"),
  );
}

function transitionFailure(error: unknown): DecisionFailure | undefined {
  if (error instanceof DecisionTransitionError) {
    return failed("INVALID_STATE_TRANSITION");
  }
  if (error instanceof DomainValueError) {
    return failed("VALIDATION_FAILED");
  }
  return undefined;
}

export async function saveDecisionDraft(
  dependencies: DecisionDependencies,
  context: UserAuthorizationContext,
  input: SaveDecisionDraftInput,
): Promise<SaveDecisionDraftResult> {
  const authorizationFailure = authorizeFacilitatorMutation(context, input);
  if (authorizationFailure !== undefined) {
    return authorizationFailure;
  }

  let draft: PreparedDraft;
  let changeReason: NonEmptyText;
  let commandIdempotencyKey: ReturnType<typeof idempotencyKey>;
  let expectedPosition: ReturnType<typeof meetingPosition>;
  let fingerprint: string;
  try {
    draft = prepareDraft(input);
    changeReason = nonEmptyText(input.changeReason);
    commandIdempotencyKey = idempotencyKey(input.idempotencyKey);
    expectedPosition = meetingPosition(input.expectedPosition);
    if (input.decisionId !== undefined) {
      decisionId(input.decisionId);
    }
    fingerprint = await hashValue(
      dependencies.hash,
      stableSerialize({
        actionIds: input.actionIds,
        changeReason: input.changeReason,
        command: "save-decision-draft",
        decisionId: input.decisionId,
        dissentIds: input.dissentIds,
        evidenceIds: input.evidenceIds,
        meetingId: input.meetingId,
        monitorCondition: input.monitorCondition,
        outcome: input.outcome,
        premiseIds: input.premiseIds,
        title: input.title,
      }),
    );
  } catch (error) {
    if (error instanceof DomainValueError) {
      return failed("VALIDATION_FAILED");
    }
    throw error;
  }

  const loaded = await loadState(dependencies, input.meetingId);
  const prior = idempotentRecord(loaded.records, input.idempotencyKey);
  if (prior !== undefined) {
    const replay = await appendMutation(
      dependencies,
      input,
      fingerprint,
      [prior.event],
      context.participantId,
    );
    if (replay.kind === "failed") {
      return replay;
    }
    const saved = eventAt(replay.records, "DecisionDrafted");
    if (saved === undefined) {
      return failed("IDEMPOTENCY_CONFLICT");
    }
    return {
      correlationId: saved.correlationId,
      decision: saved.payload.decision,
      kind: "draft_saved",
      position: saved.position,
      replayed: true,
      revision: saved.payload.revision,
    };
  }

  let decision: Decision;
  let revision: DecisionRevision;
  try {
    const existing =
      input.decisionId === undefined
        ? undefined
        : loaded.projection.shared.decisions.find(
            ({ id }) => id === input.decisionId,
          );
    if (input.decisionId !== undefined && existing === undefined) {
      return failed("DECISION_NOT_FOUND");
    }
    if (existing !== undefined && existing.status !== "DRAFT") {
      return failed("INVALID_STATE_TRANSITION");
    }

    const occurredAt = timestamp(dependencies.clock.now());
    if (existing === undefined) {
      const newDecisionId = decisionId(dependencies.ids.next("decision"));
      if (
        loaded.projection.shared.decisions.some(
          ({ id }) => id === newDecisionId,
        )
      ) {
        return failed("INVALID_STATE_TRANSITION");
      }
      const newRevisionId = decisionRevisionId(
        dependencies.ids.next("decision-revision"),
      );
      decision = createDecision({
        ...draft,
        activeRevision: revisionNumber(1),
        activeRevisionId: newRevisionId,
        confirmationStatus: "confirmed",
        createdAt: occurredAt,
        createdBy: participantId(context.participantId),
        id: newDecisionId,
        meetingId: meetingId(input.meetingId),
        origin: "human_input",
        revision: revisionNumber(1),
        status: "DRAFT",
        visibility: "shared",
      });
      revision = initialRevision(context, decision, changeReason, occurredAt);
    } else {
      revision = nextDecisionRevision(existing, {
        changeReason,
        createdAt: occurredAt,
        createdBy: participantId(context.participantId),
        id: decisionRevisionId(dependencies.ids.next("decision-revision")),
        snapshot: draftSnapshot(draft),
      });
      decision = decisionFromRevision(existing, revision);
    }
    appendDecisionRevision(
      loaded.projection.shared.decisionRevisions,
      revision,
    );
  } catch (error) {
    const failure = transitionFailure(error);
    if (failure !== undefined) {
      return failure;
    }
    throw error;
  }

  const occurredAt = revision.createdAt;
  const correlation = commandCorrelationId(dependencies, input);
  const event: EventOf<"DecisionDrafted"> = {
    actor: participantActor(context),
    correlationId: correlation,
    eventId: eventId(dependencies.ids.next("event")),
    eventType: "DecisionDrafted",
    idempotencyKey: commandIdempotencyKey,
    meetingId: meetingId(input.meetingId),
    occurredAt,
    payload: { decision, revision },
    position: meetingPosition(expectedPosition + 1),
    schemaVersion: schemaVersion(1),
    visibility: "shared",
  };
  const appended = await appendMutation(
    dependencies,
    input,
    fingerprint,
    [event],
    context.participantId,
  );
  if (appended.kind === "failed") {
    return appended;
  }
  const saved = eventAt(appended.records, "DecisionDrafted");
  if (saved === undefined) {
    throw new Error("Decision draft append returned no DecisionDrafted event");
  }
  return {
    correlationId: saved.correlationId,
    decision: saved.payload.decision,
    kind: "draft_saved",
    position: saved.position,
    replayed: appended.kind === "replayed",
    revision: saved.payload.revision,
  };
}

export async function markDecisionReady(
  dependencies: DecisionDependencies,
  context: UserAuthorizationContext,
  input: MarkDecisionReadyInput,
): Promise<MarkDecisionReadyResult> {
  const authorizationFailure = authorizeFacilitatorMutation(context, input);
  if (authorizationFailure !== undefined) {
    return authorizationFailure;
  }

  let targetDecisionId: ReturnType<typeof decisionId>;
  let commandIdempotencyKey: ReturnType<typeof idempotencyKey>;
  let expectedPosition: ReturnType<typeof meetingPosition>;
  let fingerprint: string;
  try {
    targetDecisionId = decisionId(input.decisionId);
    commandIdempotencyKey = idempotencyKey(input.idempotencyKey);
    expectedPosition = meetingPosition(input.expectedPosition);
    fingerprint = await hashValue(
      dependencies.hash,
      stableSerialize({
        command: "mark-decision-ready",
        decisionId: input.decisionId,
        meetingId: input.meetingId,
      }),
    );
  } catch (error) {
    if (error instanceof DomainValueError) {
      return failed("VALIDATION_FAILED");
    }
    throw error;
  }

  const loaded = await loadState(dependencies, input.meetingId);
  const prior = idempotentRecord(loaded.records, input.idempotencyKey);
  if (prior !== undefined) {
    const replay = await appendMutation(
      dependencies,
      input,
      fingerprint,
      [prior.event],
      context.participantId,
    );
    if (replay.kind === "failed") {
      return replay;
    }
    const ready = eventAt(replay.records, "DecisionMarkedReady");
    if (ready === undefined) {
      return failed("IDEMPOTENCY_CONFLICT");
    }
    return {
      correlationId: ready.correlationId,
      decision: ready.payload.decision,
      kind: "ready",
      position: ready.position,
      replayed: true,
    };
  }

  const current = loaded.projection.shared.decisions.find(
    ({ id }) => id === targetDecisionId,
  );
  if (current === undefined) {
    return failed("DECISION_NOT_FOUND");
  }
  const canonical = deriveCanonicalReadiness(loaded.projection, current);
  if (!canonical.allReferencesExist) {
    return failed("REFERENCED_ENTITY_NOT_FOUND");
  }
  if (!readinessComplete(canonical.readiness)) {
    return failed("READINESS_INCOMPLETE");
  }

  let readyDecision: Decision;
  try {
    readyDecision = transitionDecision(current, {
      authority: {
        kind: "facilitator",
        participantId: participantId(context.participantId),
      },
      readiness: canonical.readiness,
      to: "DECISION_READY",
    });
  } catch (error) {
    const failure = transitionFailure(error);
    if (failure !== undefined) {
      return failure;
    }
    throw error;
  }

  let occurredAt: ReturnType<typeof timestamp>;
  try {
    occurredAt = timestamp(dependencies.clock.now());
  } catch (error) {
    if (error instanceof DomainValueError) {
      return failed("VALIDATION_FAILED");
    }
    throw error;
  }
  const correlation = commandCorrelationId(dependencies, input);
  const event: EventOf<"DecisionMarkedReady"> = {
    actor: participantActor(context),
    correlationId: correlation,
    eventId: eventId(dependencies.ids.next("event")),
    eventType: "DecisionMarkedReady",
    idempotencyKey: commandIdempotencyKey,
    meetingId: meetingId(input.meetingId),
    occurredAt,
    payload: { decision: readyDecision },
    position: meetingPosition(expectedPosition + 1),
    schemaVersion: schemaVersion(1),
    visibility: "shared",
  };
  const appended = await appendMutation(
    dependencies,
    input,
    fingerprint,
    [event],
    context.participantId,
  );
  if (appended.kind === "failed") {
    return appended;
  }
  const ready = eventAt(appended.records, "DecisionMarkedReady");
  if (ready === undefined) {
    throw new Error(
      "Decision ready append returned no DecisionMarkedReady event",
    );
  }
  return {
    correlationId: ready.correlationId,
    decision: ready.payload.decision,
    kind: "ready",
    position: ready.position,
    replayed: appended.kind === "replayed",
  };
}

export async function commitDecision(
  dependencies: DecisionDependencies,
  context: UserAuthorizationContext,
  input: CommitDecisionInput,
): Promise<CommitDecisionResult> {
  const authorizationFailure = authorizeFacilitatorMutation(context, input);
  if (authorizationFailure !== undefined) {
    return authorizationFailure;
  }

  let targetDecisionId: ReturnType<typeof decisionId>;
  let commandIdempotencyKey: ReturnType<typeof idempotencyKey>;
  let expectedPosition: ReturnType<typeof meetingPosition>;
  let fingerprint: string;
  try {
    targetDecisionId = decisionId(input.decisionId);
    commandIdempotencyKey = idempotencyKey(input.idempotencyKey);
    expectedPosition = meetingPosition(input.expectedPosition);
    fingerprint = await hashValue(
      dependencies.hash,
      stableSerialize({
        command: "commit-decision",
        decisionId: input.decisionId,
        explicitCommit: input.explicitCommit,
        meetingId: input.meetingId,
      }),
    );
  } catch (error) {
    if (error instanceof DomainValueError) {
      return failed("VALIDATION_FAILED");
    }
    throw error;
  }

  const loaded = await loadState(dependencies, input.meetingId);
  const prior = idempotentRecord(loaded.records, input.idempotencyKey);
  if (prior !== undefined) {
    const replay = await appendMutation(
      dependencies,
      input,
      fingerprint,
      [prior.event],
      context.participantId,
    );
    if (replay.kind === "failed") {
      return replay;
    }
    const committed = eventAt(replay.records, "DecisionCommitted");
    if (committed === undefined) {
      return failed("IDEMPOTENCY_CONFLICT");
    }
    return {
      correlationId: committed.correlationId,
      decision: committed.payload.decision,
      kind: "committed",
      position: committed.position,
      replayed: true,
      revision: committed.payload.revision,
    };
  }

  if (!input.explicitCommit) {
    return failed("EXPLICIT_COMMIT_REQUIRED");
  }
  const current = loaded.projection.shared.decisions.find(
    ({ id }) => id === targetDecisionId,
  );
  if (current === undefined) {
    return failed("DECISION_NOT_FOUND");
  }
  if (
    !loaded.projection.shared.decisionRevisions.some(
      ({ id, version }) =>
        id === current.activeRevisionId && version === current.activeRevision,
    )
  ) {
    return failed("REFERENCED_ENTITY_NOT_FOUND");
  }

  let committedDecision: Decision;
  let committedRevision: DecisionRevision;
  let occurredAt: ReturnType<typeof timestamp>;
  try {
    const transitioned = transitionDecision(current, {
      authority: {
        kind: "facilitator",
        participantId: participantId(context.participantId),
      },
      explicitCommit: true,
      to: "COMMITTED",
    });
    occurredAt = timestamp(dependencies.clock.now());
    committedRevision = nextDecisionRevision(current, {
      changeReason: nonEmptyText("Explicit facilitator commitment"),
      createdAt: occurredAt,
      createdBy: participantId(context.participantId),
      id: decisionRevisionId(dependencies.ids.next("decision-revision")),
      snapshot: {
        actionIds: transitioned.actionIds,
        dissentIds: transitioned.dissentIds,
        evidenceIds: transitioned.evidenceIds,
        monitorCondition: transitioned.monitorCondition,
        outcome: transitioned.outcome,
        premiseIds: transitioned.premiseIds,
        status: "COMMITTED",
        title: transitioned.title,
      },
    });
    appendDecisionRevision(
      loaded.projection.shared.decisionRevisions,
      committedRevision,
    );
    committedDecision = decisionFromRevision(transitioned, committedRevision);
  } catch (error) {
    const failure = transitionFailure(error);
    if (failure !== undefined) {
      return failure;
    }
    throw error;
  }

  const correlation = commandCorrelationId(dependencies, input);
  const event: EventOf<"DecisionCommitted"> = {
    actor: participantActor(context),
    correlationId: correlation,
    eventId: eventId(dependencies.ids.next("event")),
    eventType: "DecisionCommitted",
    idempotencyKey: commandIdempotencyKey,
    meetingId: meetingId(input.meetingId),
    occurredAt,
    payload: {
      decision: committedDecision,
      revision: committedRevision,
    },
    position: meetingPosition(expectedPosition + 1),
    schemaVersion: schemaVersion(1),
    visibility: "shared",
  };
  const appended = await appendMutation(
    dependencies,
    input,
    fingerprint,
    [event],
    context.participantId,
  );
  if (appended.kind === "failed") {
    return appended;
  }
  const committed = eventAt(appended.records, "DecisionCommitted");
  if (committed === undefined) {
    throw new Error("Decision commit append returned no DecisionCommitted");
  }
  return {
    correlationId: committed.correlationId,
    decision: committed.payload.decision,
    kind: "committed",
    position: committed.position,
    replayed: appended.kind === "replayed",
    revision: committed.payload.revision,
  };
}

export async function startDecisionMonitoring(
  dependencies: DecisionDependencies,
  context: UserAuthorizationContext,
  input: StartDecisionMonitoringInput,
): Promise<StartDecisionMonitoringResult> {
  const authorizationFailure = authorizeFacilitatorMutation(context, input);
  if (authorizationFailure !== undefined) {
    return authorizationFailure;
  }

  let targetDecisionId: ReturnType<typeof decisionId>;
  let commandIdempotencyKey: ReturnType<typeof idempotencyKey>;
  let expectedPosition: ReturnType<typeof meetingPosition>;
  let fingerprint: string;
  try {
    targetDecisionId = decisionId(input.decisionId);
    commandIdempotencyKey = idempotencyKey(input.idempotencyKey);
    expectedPosition = meetingPosition(input.expectedPosition);
    fingerprint = await hashValue(
      dependencies.hash,
      stableSerialize({
        command: "start-decision-monitoring",
        decisionId: input.decisionId,
        meetingId: input.meetingId,
      }),
    );
  } catch (error) {
    if (error instanceof DomainValueError) {
      return failed("VALIDATION_FAILED");
    }
    throw error;
  }

  const loaded = await loadState(dependencies, input.meetingId);
  const prior = idempotentRecord(loaded.records, input.idempotencyKey);
  if (prior !== undefined) {
    const replay = await appendMutation(
      dependencies,
      input,
      fingerprint,
      [prior.event],
      context.participantId,
    );
    if (replay.kind === "failed") {
      return replay;
    }
    const started = eventAt(replay.records, "MonitoringStarted");
    if (started === undefined) {
      return failed("IDEMPOTENCY_CONFLICT");
    }
    return {
      correlationId: started.correlationId,
      decision: started.payload.decision,
      kind: "monitoring_started",
      monitorRegistrationId: started.payload.monitorRegistrationId,
      position: started.position,
      replayed: true,
    };
  }

  const current = loaded.projection.shared.decisions.find(
    ({ id }) => id === targetDecisionId,
  );
  if (current === undefined) {
    return failed("DECISION_NOT_FOUND");
  }

  let monitoringDecision: Decision;
  let registrationId: ReturnType<typeof monitorRegistrationId>;
  let occurredAt: ReturnType<typeof timestamp>;
  try {
    registrationId = monitorRegistrationId(
      dependencies.ids.next("monitor-registration"),
    );
    monitoringDecision = transitionDecision(current, {
      authority: { kind: "system" },
      monitorRegistrationId: registrationId,
      to: "MONITORING",
    });
    occurredAt = timestamp(dependencies.clock.now());
  } catch (error) {
    const failure = transitionFailure(error);
    if (failure !== undefined) {
      return failure;
    }
    throw error;
  }

  const correlation = commandCorrelationId(dependencies, input);
  const event: EventOf<"MonitoringStarted"> = {
    actor: { kind: "system" },
    correlationId: correlation,
    eventId: eventId(dependencies.ids.next("event")),
    eventType: "MonitoringStarted",
    idempotencyKey: commandIdempotencyKey,
    meetingId: meetingId(input.meetingId),
    occurredAt,
    payload: {
      decision: monitoringDecision,
      monitorRegistrationId: registrationId,
    },
    position: meetingPosition(expectedPosition + 1),
    schemaVersion: schemaVersion(1),
    visibility: "shared",
  };
  const appended = await appendMutation(
    dependencies,
    input,
    fingerprint,
    [event],
    context.participantId,
  );
  if (appended.kind === "failed") {
    return appended;
  }
  const started = eventAt(appended.records, "MonitoringStarted");
  if (started === undefined) {
    throw new Error("Monitoring start append returned no MonitoringStarted");
  }
  return {
    correlationId: started.correlationId,
    decision: started.payload.decision,
    kind: "monitoring_started",
    monitorRegistrationId: started.payload.monitorRegistrationId,
    position: started.position,
    replayed: appended.kind === "replayed",
  };
}
