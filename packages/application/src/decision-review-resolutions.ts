import {
  DecisionTransitionError,
  DomainValueError,
  appendDecisionRevision,
  causationId,
  correlationId,
  decisionId,
  decisionRevisionId,
  eventId,
  idempotencyKey,
  meetingId,
  meetingPosition,
  nextDecisionRevision,
  nonEmptyText,
  participantId,
  replayMeeting,
  schemaVersion,
  timestamp,
  transitionDecision,
  type Decision,
  type DecisionRevision,
  type DomainEvent,
  type EventOf,
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
import type { DecisionHashFunction } from "./decisions.js";

const MEETING_PROJECTION = "meeting";

export interface DecisionReviewResolutionDependencies {
  readonly clock: Clock;
  readonly events: EventStore<DomainEvent>;
  readonly hash: DecisionHashFunction;
  readonly ids: IdGenerator;
  readonly projections: ProjectionStore<MeetingProjection>;
}

interface DecisionReviewResolutionMutationInput {
  readonly correlationId?: string;
  readonly decisionId: string;
  readonly expectedPosition: number;
  readonly idempotencyKey: string;
  readonly meetingId: string;
}

export interface RecommitDecisionInput extends DecisionReviewResolutionMutationInput {
  readonly changeReason: string;
  readonly explicitCommit: boolean;
  readonly monitorCondition: {
    readonly description: string;
  };
  readonly outcome: string;
  readonly title: string;
}

export interface SupersedeDecisionInput extends DecisionReviewResolutionMutationInput {
  readonly replacementDecisionId: string;
}

export interface RejectDecisionInput extends DecisionReviewResolutionMutationInput {
  readonly reason: string;
}

type DecisionReviewResolutionFailureCode =
  | "DECISION_NOT_FOUND"
  | "EXPLICIT_COMMIT_REQUIRED"
  | "FORBIDDEN"
  | "IDEMPOTENCY_CONFLICT"
  | "INVALID_STATE_TRANSITION"
  | "REFERENCED_ENTITY_NOT_FOUND"
  | "VALIDATION_FAILED";

export type DecisionReviewResolutionFailure =
  | {
      readonly actualPosition: number;
      readonly code: "CONFLICT";
      readonly expectedPosition: number;
      readonly kind: "failed";
    }
  | {
      readonly code: DecisionReviewResolutionFailureCode;
      readonly kind: "failed";
    };

interface ResolutionResult {
  readonly correlationId: string;
  readonly decision: Decision;
  readonly position: number;
  readonly replayed: boolean;
  readonly resolutionEventId: string;
}

export type RecommitDecisionResult =
  | (ResolutionResult & {
      readonly kind: "recommitted";
      readonly revision: DecisionRevision;
    })
  | DecisionReviewResolutionFailure;

export type SupersedeDecisionResult =
  | (ResolutionResult & {
      readonly kind: "superseded";
      readonly replacementDecisionId: string;
    })
  | DecisionReviewResolutionFailure;

export type RejectDecisionResult =
  | (ResolutionResult & {
      readonly kind: "rejected";
      readonly reason: string;
    })
  | DecisionReviewResolutionFailure;

interface LoadedState {
  readonly projection: MeetingProjection;
  readonly records: readonly EventRecord<DomainEvent>[];
}

type AppendResult =
  | {
      readonly kind: "appended" | "replayed";
      readonly records: readonly EventRecord<DomainEvent>[];
    }
  | DecisionReviewResolutionFailure;

type ResolutionEvent =
  | EventOf<"DecisionRevisionCommitted">
  | EventOf<"DecisionSuperseded">
  | EventOf<"DecisionRejected">;

function failed(
  code: DecisionReviewResolutionFailureCode,
): DecisionReviewResolutionFailure {
  return { code, kind: "failed" };
}

function authorizeFacilitatorResolution(
  context: UserAuthorizationContext,
  input: DecisionReviewResolutionMutationInput,
): DecisionReviewResolutionFailure | undefined {
  if (context.role !== "facilitator") {
    return failed("FORBIDDEN");
  }
  const result = authorize(context, {
    capability: "decision:review-confirm",
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

function normalizeRecords(
  records: readonly EventRecord<DomainEvent>[],
): readonly DomainEvent[] {
  return records.map(({ event, position }) => ({
    ...event,
    position: meetingPosition(position),
  }));
}

async function loadState(
  dependencies: DecisionReviewResolutionDependencies,
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
  dependencies: DecisionReviewResolutionDependencies,
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
  dependencies: DecisionReviewResolutionDependencies,
  input: DecisionReviewResolutionMutationInput,
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

function eventAt<Type extends ResolutionEvent["eventType"]>(
  records: readonly EventRecord<DomainEvent>[],
  eventType: Type,
): Extract<ResolutionEvent, { readonly eventType: Type }> | undefined {
  return normalizeRecords(records).find(
    (event): event is Extract<ResolutionEvent, { readonly eventType: Type }> =>
      event.eventType === eventType,
  );
}

function priorResolution(
  records: readonly EventRecord<DomainEvent>[],
  key: string,
  eventType: ResolutionEvent["eventType"],
): ResolutionEvent | undefined {
  const prior = normalizeRecords(records).find(
    (event): event is ResolutionEvent =>
      (event.eventType === "DecisionRevisionCommitted" ||
        event.eventType === "DecisionSuperseded" ||
        event.eventType === "DecisionRejected") &&
      event.idempotencyKey === key,
  );
  return prior?.eventType === eventType ? prior : undefined;
}

function hasIdempotencyKey(
  records: readonly EventRecord<DomainEvent>[],
  key: string,
): boolean {
  return records.some(({ event }) => event.idempotencyKey === key);
}

function findCurrentReviewRequired(
  records: readonly EventRecord<DomainEvent>[],
  current: Decision,
): EventOf<"DecisionReviewRequired"> | undefined {
  const events = normalizeRecords(records);
  const required = events.findLast(
    (event): event is EventOf<"DecisionReviewRequired"> =>
      event.eventType === "DecisionReviewRequired" &&
      event.payload.decision.id === current.id,
  );
  if (
    required === undefined ||
    stableSerialize(required.payload.decision) !== stableSerialize(current)
  ) {
    return undefined;
  }
  const reviewed = events.find(
    (event): event is EventOf<"FacilitatorReviewed"> =>
      event.eventType === "FacilitatorReviewed" &&
      String(event.eventId) === String(required.causationId),
  );
  return reviewed?.payload.disposition === "confirm_invalidation" &&
    reviewed.payload.decisionId === current.id &&
    stableSerialize(reviewed.payload.decision) === stableSerialize(current) &&
    reviewed.correlationId === required.correlationId
    ? required
    : undefined;
}

function hasActiveRevision(
  projection: MeetingProjection,
  decision: Decision,
): boolean {
  return projection.shared.decisionRevisions.some(
    ({ decisionId: ownerId, id, version }) =>
      ownerId === decision.id &&
      id === decision.activeRevisionId &&
      version === decision.activeRevision,
  );
}

function hasCanonicalReferences(
  projection: MeetingProjection,
  decision: Decision,
): boolean {
  const shared = projection.shared;
  const confirmed = (
    ids: readonly string[],
    records: readonly {
      readonly confirmationStatus: string;
      readonly id: string;
      readonly visibility: string;
    }[],
  ): boolean =>
    ids.every((id) =>
      records.some(
        (record) =>
          record.id === id &&
          record.visibility === "shared" &&
          record.confirmationStatus === "confirmed",
      ),
    );
  return (
    hasActiveRevision(projection, decision) &&
    confirmed(decision.premiseIds, shared.premises) &&
    confirmed(decision.evidenceIds, shared.evidence) &&
    confirmed(decision.dissentIds, shared.dissent) &&
    confirmed(decision.actionIds, shared.actions)
  );
}

function transitionFailure(
  error: unknown,
): DecisionReviewResolutionFailure | undefined {
  if (error instanceof DecisionTransitionError) {
    return failed("INVALID_STATE_TRANSITION");
  }
  if (error instanceof DomainValueError) {
    return failed("VALIDATION_FAILED");
  }
  return undefined;
}

function currentDecision(
  loaded: LoadedState,
  targetDecisionId: ReturnType<typeof decisionId>,
):
  | {
      readonly current: Decision;
      readonly reviewRequired: EventOf<"DecisionReviewRequired">;
    }
  | DecisionReviewResolutionFailure {
  const current = loaded.projection.shared.decisions.find(
    ({ id }) => id === targetDecisionId,
  );
  if (current === undefined) {
    return failed("DECISION_NOT_FOUND");
  }
  if (current.status !== "REVIEW_REQUIRED") {
    return failed("INVALID_STATE_TRANSITION");
  }
  const reviewRequired = findCurrentReviewRequired(loaded.records, current);
  if (
    reviewRequired === undefined ||
    !hasActiveRevision(loaded.projection, current)
  ) {
    return failed("REFERENCED_ENTITY_NOT_FOUND");
  }
  return { current, reviewRequired };
}

function isFailure(
  value:
    | object
    | {
        readonly current: Decision;
        readonly reviewRequired: EventOf<"DecisionReviewRequired">;
      },
): value is DecisionReviewResolutionFailure {
  return "kind" in value && value.kind === "failed";
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

export async function recommitDecision(
  dependencies: DecisionReviewResolutionDependencies,
  context: UserAuthorizationContext,
  input: RecommitDecisionInput,
): Promise<RecommitDecisionResult> {
  const authorizationFailure = authorizeFacilitatorResolution(context, input);
  if (authorizationFailure !== undefined) {
    return authorizationFailure;
  }

  let targetDecisionId: ReturnType<typeof decisionId>;
  let title: ReturnType<typeof nonEmptyText>;
  let outcome: ReturnType<typeof nonEmptyText>;
  let monitorDescription: ReturnType<typeof nonEmptyText>;
  let changeReason: ReturnType<typeof nonEmptyText>;
  let fingerprint: string;
  try {
    targetDecisionId = decisionId(input.decisionId);
    title = nonEmptyText(input.title);
    outcome = nonEmptyText(input.outcome);
    monitorDescription = nonEmptyText(input.monitorCondition.description);
    changeReason = nonEmptyText(input.changeReason);
    idempotencyKey(input.idempotencyKey);
    meetingId(input.meetingId);
    meetingPosition(input.expectedPosition);
    participantId(context.participantId);
    if (input.correlationId !== undefined) {
      correlationId(input.correlationId);
    }
    fingerprint = await hashValue(
      dependencies.hash,
      stableSerialize({
        changeReason,
        command: "recommit-decision-review",
        decisionId: targetDecisionId,
        explicitCommit: input.explicitCommit,
        meetingId: input.meetingId,
        monitorCondition: { description: monitorDescription },
        outcome,
        title,
      }),
    );
  } catch (error) {
    if (error instanceof DomainValueError) {
      return failed("VALIDATION_FAILED");
    }
    throw error;
  }

  const loaded = await loadState(dependencies, input.meetingId);
  const prior = priorResolution(
    loaded.records,
    input.idempotencyKey,
    "DecisionRevisionCommitted",
  );
  if (prior !== undefined) {
    const replay = await appendMutation(
      dependencies,
      input,
      fingerprint,
      [prior],
      context.participantId,
    );
    if (replay.kind === "failed") {
      return replay;
    }
    const committed = eventAt(replay.records, "DecisionRevisionCommitted");
    if (committed === undefined) {
      return failed("IDEMPOTENCY_CONFLICT");
    }
    return {
      correlationId: committed.correlationId,
      decision: committed.payload.decision,
      kind: "recommitted",
      position: committed.position,
      replayed: true,
      resolutionEventId: committed.eventId,
      revision: committed.payload.revision,
    };
  }
  if (hasIdempotencyKey(loaded.records, input.idempotencyKey)) {
    return failed("IDEMPOTENCY_CONFLICT");
  }
  if (!input.explicitCommit) {
    return failed("EXPLICIT_COMMIT_REQUIRED");
  }

  const resolvedCurrent = currentDecision(loaded, targetDecisionId);
  if (isFailure(resolvedCurrent)) {
    return resolvedCurrent;
  }
  if (!hasCanonicalReferences(loaded.projection, resolvedCurrent.current)) {
    return failed("REFERENCED_ENTITY_NOT_FOUND");
  }

  let decision: Decision;
  let revision: DecisionRevision;
  let occurredAt: ReturnType<typeof timestamp>;
  try {
    occurredAt = timestamp(dependencies.clock.now());
    revision = nextDecisionRevision(resolvedCurrent.current, {
      changeReason,
      createdAt: occurredAt,
      createdBy: participantId(context.participantId),
      id: decisionRevisionId(dependencies.ids.next("decision-revision")),
      snapshot: {
        actionIds: resolvedCurrent.current.actionIds,
        dissentIds: resolvedCurrent.current.dissentIds,
        evidenceIds: resolvedCurrent.current.evidenceIds,
        monitorCondition: {
          description: monitorDescription,
        },
        outcome,
        premiseIds: resolvedCurrent.current.premiseIds,
        status: "COMMITTED",
        title,
      },
    });
    appendDecisionRevision(
      loaded.projection.shared.decisionRevisions,
      revision,
    );
    decision = transitionDecision(resolvedCurrent.current, {
      authority: {
        kind: "facilitator",
        participantId: participantId(context.participantId),
      },
      explicitCommit: true,
      revision,
      to: "COMMITTED",
    });
  } catch (error) {
    const failure = transitionFailure(error);
    if (failure !== undefined) {
      return failure;
    }
    throw error;
  }

  const event: EventOf<"DecisionRevisionCommitted"> = {
    actor: participantActor(context),
    causationId: causationId(resolvedCurrent.reviewRequired.eventId),
    correlationId: correlationId(
      input.correlationId ?? dependencies.ids.next("correlation"),
    ),
    eventId: eventId(dependencies.ids.next("event")),
    eventType: "DecisionRevisionCommitted",
    idempotencyKey: idempotencyKey(input.idempotencyKey),
    meetingId: meetingId(input.meetingId),
    occurredAt,
    payload: { decision, revision },
    position: meetingPosition(input.expectedPosition + 1),
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
  const committed = eventAt(appended.records, "DecisionRevisionCommitted");
  if (committed === undefined) {
    throw new Error(
      "Decision review recommit append returned no DecisionRevisionCommitted",
    );
  }
  return {
    correlationId: committed.correlationId,
    decision: committed.payload.decision,
    kind: "recommitted",
    position: committed.position,
    replayed: appended.kind === "replayed",
    resolutionEventId: committed.eventId,
    revision: committed.payload.revision,
  };
}

export async function supersedeDecision(
  dependencies: DecisionReviewResolutionDependencies,
  context: UserAuthorizationContext,
  input: SupersedeDecisionInput,
): Promise<SupersedeDecisionResult> {
  const authorizationFailure = authorizeFacilitatorResolution(context, input);
  if (authorizationFailure !== undefined) {
    return authorizationFailure;
  }

  let targetDecisionId: ReturnType<typeof decisionId>;
  let replacementDecisionId: ReturnType<typeof decisionId>;
  let fingerprint: string;
  try {
    targetDecisionId = decisionId(input.decisionId);
    replacementDecisionId = decisionId(input.replacementDecisionId);
    idempotencyKey(input.idempotencyKey);
    meetingId(input.meetingId);
    meetingPosition(input.expectedPosition);
    participantId(context.participantId);
    if (input.correlationId !== undefined) {
      correlationId(input.correlationId);
    }
    fingerprint = await hashValue(
      dependencies.hash,
      stableSerialize({
        command: "supersede-decision-review",
        decisionId: targetDecisionId,
        meetingId: input.meetingId,
        replacementDecisionId,
      }),
    );
  } catch (error) {
    if (error instanceof DomainValueError) {
      return failed("VALIDATION_FAILED");
    }
    throw error;
  }

  const loaded = await loadState(dependencies, input.meetingId);
  const prior = priorResolution(
    loaded.records,
    input.idempotencyKey,
    "DecisionSuperseded",
  );
  if (prior !== undefined) {
    const replay = await appendMutation(
      dependencies,
      input,
      fingerprint,
      [prior],
      context.participantId,
    );
    if (replay.kind === "failed") {
      return replay;
    }
    const superseded = eventAt(replay.records, "DecisionSuperseded");
    if (superseded === undefined) {
      return failed("IDEMPOTENCY_CONFLICT");
    }
    return {
      correlationId: superseded.correlationId,
      decision: superseded.payload.decision,
      kind: "superseded",
      position: superseded.position,
      replacementDecisionId: superseded.payload.replacementDecisionId,
      replayed: true,
      resolutionEventId: superseded.eventId,
    };
  }
  if (hasIdempotencyKey(loaded.records, input.idempotencyKey)) {
    return failed("IDEMPOTENCY_CONFLICT");
  }

  const resolvedCurrent = currentDecision(loaded, targetDecisionId);
  if (isFailure(resolvedCurrent)) {
    return resolvedCurrent;
  }
  const replacement = loaded.projection.shared.decisions.find(
    ({ id }) => id === replacementDecisionId,
  );
  if (
    replacement === undefined ||
    replacement.id === resolvedCurrent.current.id ||
    !hasActiveRevision(loaded.projection, replacement)
  ) {
    return failed(
      replacement === undefined
        ? "DECISION_NOT_FOUND"
        : replacement.id === resolvedCurrent.current.id
          ? "INVALID_STATE_TRANSITION"
          : "REFERENCED_ENTITY_NOT_FOUND",
    );
  }

  let decision: Decision;
  let occurredAt: ReturnType<typeof timestamp>;
  try {
    decision = transitionDecision(resolvedCurrent.current, {
      authority: {
        kind: "facilitator",
        participantId: participantId(context.participantId),
      },
      replacementDecisionId,
      to: "SUPERSEDED",
    });
    occurredAt = timestamp(dependencies.clock.now());
  } catch (error) {
    const failure = transitionFailure(error);
    if (failure !== undefined) {
      return failure;
    }
    throw error;
  }

  const event: EventOf<"DecisionSuperseded"> = {
    actor: participantActor(context),
    causationId: causationId(resolvedCurrent.reviewRequired.eventId),
    correlationId: correlationId(
      input.correlationId ?? dependencies.ids.next("correlation"),
    ),
    eventId: eventId(dependencies.ids.next("event")),
    eventType: "DecisionSuperseded",
    idempotencyKey: idempotencyKey(input.idempotencyKey),
    meetingId: meetingId(input.meetingId),
    occurredAt,
    payload: { decision, replacementDecisionId },
    position: meetingPosition(input.expectedPosition + 1),
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
  const superseded = eventAt(appended.records, "DecisionSuperseded");
  if (superseded === undefined) {
    throw new Error(
      "Decision review supersede append returned no DecisionSuperseded",
    );
  }
  return {
    correlationId: superseded.correlationId,
    decision: superseded.payload.decision,
    kind: "superseded",
    position: superseded.position,
    replacementDecisionId: superseded.payload.replacementDecisionId,
    replayed: appended.kind === "replayed",
    resolutionEventId: superseded.eventId,
  };
}

export async function rejectDecision(
  dependencies: DecisionReviewResolutionDependencies,
  context: UserAuthorizationContext,
  input: RejectDecisionInput,
): Promise<RejectDecisionResult> {
  const authorizationFailure = authorizeFacilitatorResolution(context, input);
  if (authorizationFailure !== undefined) {
    return authorizationFailure;
  }

  let targetDecisionId: ReturnType<typeof decisionId>;
  let reason: ReturnType<typeof nonEmptyText>;
  let fingerprint: string;
  try {
    targetDecisionId = decisionId(input.decisionId);
    reason = nonEmptyText(input.reason);
    idempotencyKey(input.idempotencyKey);
    meetingId(input.meetingId);
    meetingPosition(input.expectedPosition);
    participantId(context.participantId);
    if (input.correlationId !== undefined) {
      correlationId(input.correlationId);
    }
    fingerprint = await hashValue(
      dependencies.hash,
      stableSerialize({
        command: "reject-decision-review",
        decisionId: targetDecisionId,
        meetingId: input.meetingId,
        reason,
      }),
    );
  } catch (error) {
    if (error instanceof DomainValueError) {
      return failed("VALIDATION_FAILED");
    }
    throw error;
  }

  const loaded = await loadState(dependencies, input.meetingId);
  const prior = priorResolution(
    loaded.records,
    input.idempotencyKey,
    "DecisionRejected",
  );
  if (prior !== undefined) {
    const replay = await appendMutation(
      dependencies,
      input,
      fingerprint,
      [prior],
      context.participantId,
    );
    if (replay.kind === "failed") {
      return replay;
    }
    const rejected = eventAt(replay.records, "DecisionRejected");
    if (rejected === undefined) {
      return failed("IDEMPOTENCY_CONFLICT");
    }
    return {
      correlationId: rejected.correlationId,
      decision: rejected.payload.decision,
      kind: "rejected",
      position: rejected.position,
      reason: rejected.payload.reason,
      replayed: true,
      resolutionEventId: rejected.eventId,
    };
  }
  if (hasIdempotencyKey(loaded.records, input.idempotencyKey)) {
    return failed("IDEMPOTENCY_CONFLICT");
  }

  const resolvedCurrent = currentDecision(loaded, targetDecisionId);
  if (isFailure(resolvedCurrent)) {
    return resolvedCurrent;
  }

  let decision: Decision;
  let occurredAt: ReturnType<typeof timestamp>;
  try {
    decision = transitionDecision(resolvedCurrent.current, {
      authority: {
        kind: "facilitator",
        participantId: participantId(context.participantId),
      },
      rejectionReason: reason,
      to: "REJECTED",
    });
    occurredAt = timestamp(dependencies.clock.now());
  } catch (error) {
    const failure = transitionFailure(error);
    if (failure !== undefined) {
      return failure;
    }
    throw error;
  }

  const event: EventOf<"DecisionRejected"> = {
    actor: participantActor(context),
    causationId: causationId(resolvedCurrent.reviewRequired.eventId),
    correlationId: correlationId(
      input.correlationId ?? dependencies.ids.next("correlation"),
    ),
    eventId: eventId(dependencies.ids.next("event")),
    eventType: "DecisionRejected",
    idempotencyKey: idempotencyKey(input.idempotencyKey),
    meetingId: meetingId(input.meetingId),
    occurredAt,
    payload: { decision, reason },
    position: meetingPosition(input.expectedPosition + 1),
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
  const rejected = eventAt(appended.records, "DecisionRejected");
  if (rejected === undefined) {
    throw new Error(
      "Decision review rejection append returned no DecisionRejected",
    );
  }
  return {
    correlationId: rejected.correlationId,
    decision: rejected.payload.decision,
    kind: "rejected",
    position: rejected.position,
    reason: rejected.payload.reason,
    replayed: appended.kind === "replayed",
    resolutionEventId: rejected.eventId,
  };
}

export const recommitDecisionReview = recommitDecision;
export const supersedeDecisionReview = supersedeDecision;
export const rejectDecisionReview = rejectDecision;
