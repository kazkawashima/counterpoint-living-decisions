import {
  DecisionTransitionError,
  DomainValueError,
  causationId,
  correlationId,
  decisionId,
  eventId,
  holdAffectedActions,
  idempotencyKey,
  meetingId,
  meetingPosition,
  newReconsiderationTask,
  nonEmptyText,
  participantId,
  reconsiderationTaskId,
  replayMeeting,
  schemaVersion,
  selectActionsToHold,
  suggestionId,
  timestamp,
  transitionDecision,
  type Action,
  type Decision,
  type DomainEvent,
  type EventOf,
  type MeetingProjection,
  type ReconsiderationTask,
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

export interface InvalidationReviewDependencies {
  readonly clock: Clock;
  readonly events: EventStore<DomainEvent>;
  readonly hash: DecisionHashFunction;
  readonly ids: IdGenerator;
  readonly projections: ProjectionStore<MeetingProjection>;
}

interface InvalidationReviewMutationInput {
  readonly correlationId?: string;
  readonly decisionId: string;
  readonly expectedPosition: number;
  readonly idempotencyKey: string;
  readonly meetingId: string;
  readonly reason: string;
  readonly suggestionId: string;
}

export type ConfirmInvalidationReviewInput = InvalidationReviewMutationInput;

export type RejectInvalidationReviewInput = InvalidationReviewMutationInput;

export interface ReviewInvalidationInput extends InvalidationReviewMutationInput {
  readonly disposition: "confirm_invalidation" | "reject_suggestion";
}

type InvalidationReviewFailureCode =
  | "DECISION_NOT_FOUND"
  | "FORBIDDEN"
  | "IDEMPOTENCY_CONFLICT"
  | "INVALID_STATE_TRANSITION"
  | "REFERENCED_ENTITY_NOT_FOUND"
  | "SUGGESTION_MISMATCH"
  | "SUGGESTION_NOT_FOUND"
  | "VALIDATION_FAILED";

export type InvalidationReviewFailure =
  | {
      readonly actualPosition: number;
      readonly code: "CONFLICT";
      readonly expectedPosition: number;
      readonly kind: "failed";
    }
  | {
      readonly code: InvalidationReviewFailureCode;
      readonly kind: "failed";
    };

export type ConfirmInvalidationReviewResult =
  | {
      readonly correlationId: string;
      readonly decision: Decision;
      readonly disposition: "confirm_invalidation";
      readonly heldActionIds: readonly string[];
      readonly heldActions: readonly Action[];
      readonly kind: "review_required";
      readonly position: number;
      readonly reconsiderationTask: ReconsiderationTask;
      readonly reviewEventId: string;
      readonly reviewReason: string;
      readonly replayed: boolean;
      readonly suggestionId: string;
    }
  | InvalidationReviewFailure;

export type RejectInvalidationReviewResult =
  | {
      readonly correlationId: string;
      readonly decision: Decision;
      readonly disposition: "reject_suggestion";
      readonly kind: "suggestion_rejected";
      readonly position: number;
      readonly reviewEventId: string;
      readonly reviewReason: string;
      readonly replayed: boolean;
      readonly suggestionId: string;
    }
  | InvalidationReviewFailure;

export type ReviewInvalidationResult =
  ConfirmInvalidationReviewResult | RejectInvalidationReviewResult;

type ReviewDisposition =
  EventOf<"FacilitatorReviewed">["payload"]["disposition"];

interface LoadedState {
  readonly projection: MeetingProjection;
  readonly records: readonly EventRecord<DomainEvent>[];
}

interface MatchedSuggestion {
  readonly atRisk: EventOf<"DecisionMarkedAtRisk">;
  readonly suggested: EventOf<"AssumptionInvalidationSuggested">;
}

type AppendResult =
  | {
      readonly kind: "appended" | "replayed";
      readonly records: readonly EventRecord<DomainEvent>[];
    }
  | InvalidationReviewFailure;

function failed(
  code: InvalidationReviewFailureCode,
): InvalidationReviewFailure {
  return { code, kind: "failed" };
}

function isFailure(value: object): value is InvalidationReviewFailure {
  return "kind" in value && value.kind === "failed";
}

function authorizeFacilitatorReview(
  context: UserAuthorizationContext,
  input: InvalidationReviewMutationInput,
): InvalidationReviewFailure | undefined {
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
  dependencies: InvalidationReviewDependencies,
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
  dependencies: InvalidationReviewDependencies,
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
  dependencies: InvalidationReviewDependencies,
  input: InvalidationReviewMutationInput,
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

function sameValues(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function findMatchedSuggestion(
  records: readonly EventRecord<DomainEvent>[],
  current: Decision,
  targetSuggestionId: string,
): MatchedSuggestion | InvalidationReviewFailure {
  const events = normalizeRecords(records);
  const suggested = events.find(
    (event): event is EventOf<"AssumptionInvalidationSuggested"> =>
      event.eventType === "AssumptionInvalidationSuggested" &&
      event.payload.suggestionId === targetSuggestionId,
  );
  if (suggested === undefined) {
    return failed("SUGGESTION_NOT_FOUND");
  }
  const latestAtRisk = events.findLast(
    (event): event is EventOf<"DecisionMarkedAtRisk"> =>
      event.eventType === "DecisionMarkedAtRisk" &&
      event.payload.decision.id === current.id,
  );
  if (
    latestAtRisk?.payload.suggestionId !== suggested.payload.suggestionId ||
    suggested.payload.decisionId !== current.id ||
    suggested.payload.activeRevisionId !== current.activeRevisionId ||
    stableSerialize(latestAtRisk.payload.decision) !==
      stableSerialize(current) ||
    !sameValues(
      suggested.payload.affectedPremiseIds,
      latestAtRisk.payload.affectedPremiseIds,
    ) ||
    !sameValues(
      suggested.payload.affectedActionIds,
      latestAtRisk.payload.affectedActionIds,
    )
  ) {
    return failed("SUGGESTION_MISMATCH");
  }
  return { atRisk: latestAtRisk, suggested };
}

function referencesExist(
  projection: MeetingProjection,
  decision: Decision,
  suggested: EventOf<"AssumptionInvalidationSuggested">,
): boolean {
  const shared = projection.shared;
  return (
    shared.decisionRevisions.some(
      ({ decisionId: ownerId, id }) =>
        ownerId === decision.id && id === decision.activeRevisionId,
    ) &&
    shared.externalEvents.some(
      ({ id }) => id === suggested.payload.externalEventId,
    ) &&
    suggested.payload.affectedPremiseIds.every(
      (id) =>
        decision.premiseIds.includes(id) &&
        shared.premises.some(
          (premise) =>
            premise.id === id &&
            premise.visibility === "shared" &&
            premise.confirmationStatus === "confirmed",
        ),
    ) &&
    suggested.payload.affectedActionIds.every(
      (id) =>
        decision.actionIds.includes(id) &&
        shared.actions.some(
          (action) =>
            action.id === id &&
            action.visibility === "shared" &&
            action.confirmationStatus === "confirmed",
        ),
    )
  );
}

function priorReviewBatch(
  records: readonly EventRecord<DomainEvent>[],
  key: string,
  disposition: ReviewDisposition,
): readonly DomainEvent[] | undefined {
  const events = normalizeRecords(records);
  const reviewed = events.find(
    (event): event is EventOf<"FacilitatorReviewed"> =>
      event.eventType === "FacilitatorReviewed" && event.idempotencyKey === key,
  );
  if (reviewed?.payload.disposition !== disposition) {
    return undefined;
  }
  if (disposition === "reject_suggestion") {
    return [reviewed];
  }
  const reviewRequired = events.find(
    (event): event is EventOf<"DecisionReviewRequired"> =>
      event.eventType === "DecisionReviewRequired" &&
      event.causationId === causationId(reviewed.eventId) &&
      event.payload.suggestionId === reviewed.payload.suggestionId,
  );
  if (reviewRequired === undefined) {
    return undefined;
  }
  const actionHeld = events.find(
    (event): event is EventOf<"ActionHeld"> =>
      event.eventType === "ActionHeld" &&
      event.causationId === causationId(reviewRequired.eventId) &&
      event.payload.suggestionId === reviewed.payload.suggestionId,
  );
  const taskCreated = events.find(
    (event): event is EventOf<"ReconsiderationTaskCreated"> =>
      event.eventType === "ReconsiderationTaskCreated" &&
      event.causationId === causationId(reviewRequired.eventId) &&
      event.payload.task.id === reviewRequired.payload.reconsiderationTaskId,
  );
  return actionHeld === undefined || taskCreated === undefined
    ? undefined
    : [reviewed, reviewRequired, actionHeld, taskCreated];
}

function transitionFailure(
  error: unknown,
): InvalidationReviewFailure | undefined {
  if (error instanceof DecisionTransitionError) {
    return failed("INVALID_STATE_TRANSITION");
  }
  if (error instanceof DomainValueError) {
    return failed("VALIDATION_FAILED");
  }
  return undefined;
}

async function prepareReview(
  dependencies: InvalidationReviewDependencies,
  context: UserAuthorizationContext,
  input: InvalidationReviewMutationInput,
  disposition: ReviewDisposition,
): Promise<
  | {
      readonly fingerprint: string;
      readonly loaded: LoadedState;
      readonly reason: ReturnType<typeof nonEmptyText>;
      readonly targetDecisionId: ReturnType<typeof decisionId>;
      readonly targetSuggestionId: ReturnType<typeof suggestionId>;
    }
  | InvalidationReviewFailure
> {
  const authorizationFailure = authorizeFacilitatorReview(context, input);
  if (authorizationFailure !== undefined) {
    return authorizationFailure;
  }
  try {
    const targetDecisionId = decisionId(input.decisionId);
    const targetSuggestionId = suggestionId(input.suggestionId);
    const reason = nonEmptyText(input.reason);
    idempotencyKey(input.idempotencyKey);
    meetingId(input.meetingId);
    meetingPosition(input.expectedPosition);
    participantId(context.participantId);
    if (input.correlationId !== undefined) {
      correlationId(input.correlationId);
    }
    const fingerprint = await hashValue(
      dependencies.hash,
      stableSerialize({
        command: "review-assumption-invalidation",
        decisionId: targetDecisionId,
        disposition,
        meetingId: input.meetingId,
        reason,
        suggestionId: targetSuggestionId,
      }),
    );
    return {
      fingerprint,
      loaded: await loadState(dependencies, input.meetingId),
      reason,
      targetDecisionId,
      targetSuggestionId,
    };
  } catch (error) {
    if (error instanceof DomainValueError) {
      return failed("VALIDATION_FAILED");
    }
    throw error;
  }
}

export async function confirmInvalidationReview(
  dependencies: InvalidationReviewDependencies,
  context: UserAuthorizationContext,
  input: ConfirmInvalidationReviewInput,
): Promise<ConfirmInvalidationReviewResult> {
  const prepared = await prepareReview(
    dependencies,
    context,
    input,
    "confirm_invalidation",
  );
  if (isFailure(prepared)) {
    return prepared;
  }
  const priorBatch = priorReviewBatch(
    prepared.loaded.records,
    input.idempotencyKey,
    "confirm_invalidation",
  );
  if (priorBatch !== undefined) {
    const replay = await appendMutation(
      dependencies,
      input,
      prepared.fingerprint,
      priorBatch,
      context.participantId,
    );
    if (replay.kind === "failed") {
      return replay;
    }
    const reviewed = eventAt(replay.records, "FacilitatorReviewed");
    const held = eventAt(replay.records, "ActionHeld");
    const taskCreated = eventAt(replay.records, "ReconsiderationTaskCreated");
    if (
      reviewed === undefined ||
      held === undefined ||
      taskCreated === undefined
    ) {
      return failed("IDEMPOTENCY_CONFLICT");
    }
    return {
      correlationId: reviewed.correlationId,
      decision: reviewed.payload.decision,
      disposition: "confirm_invalidation",
      heldActionIds: held.payload.actions.map(({ id }) => id),
      heldActions: held.payload.actions,
      kind: "review_required",
      position: taskCreated.position,
      reconsiderationTask: taskCreated.payload.task,
      reviewEventId: reviewed.eventId,
      reviewReason: reviewed.payload.reason,
      replayed: true,
      suggestionId: reviewed.payload.suggestionId,
    };
  }
  if (
    prepared.loaded.records.some(
      ({ event }) => event.idempotencyKey === input.idempotencyKey,
    )
  ) {
    return failed("IDEMPOTENCY_CONFLICT");
  }

  const current = prepared.loaded.projection.shared.decisions.find(
    ({ id }) => id === prepared.targetDecisionId,
  );
  if (current === undefined) {
    return failed("DECISION_NOT_FOUND");
  }
  if (current.status !== "AT_RISK") {
    return failed("INVALID_STATE_TRANSITION");
  }
  const matched = findMatchedSuggestion(
    prepared.loaded.records,
    current,
    prepared.targetSuggestionId,
  );
  if ("kind" in matched) {
    return matched;
  }
  if (
    !referencesExist(prepared.loaded.projection, current, matched.suggested)
  ) {
    return failed("REFERENCED_ENTITY_NOT_FOUND");
  }

  let reviewRequiredDecision: Decision;
  let heldActions: readonly Action[];
  let task: ReconsiderationTask;
  let occurredAt: ReturnType<typeof timestamp>;
  try {
    const authority = {
      kind: "facilitator" as const,
      participantId: participantId(context.participantId),
    };
    reviewRequiredDecision = transitionDecision(current, {
      affectedActionIds: matched.suggested.payload.affectedActionIds,
      affectedPremiseIds: matched.suggested.payload.affectedPremiseIds,
      authority,
      invalidationConfirmed: true,
      reviewedActionIds: matched.suggested.payload.affectedActionIds,
      reviewedEvidenceReferenceIds:
        matched.suggested.payload.evidenceReferenceIds,
      reviewedPremiseIds: matched.suggested.payload.affectedPremiseIds,
      suggestionReferenceIds: matched.suggested.payload.evidenceReferenceIds,
      to: "REVIEW_REQUIRED",
    });
    occurredAt = timestamp(dependencies.clock.now());
    const selection = {
      affectedPremiseIds: matched.suggested.payload.affectedPremiseIds,
      holdReason: prepared.reason,
      suggestedActionIds: matched.suggested.payload.affectedActionIds,
    };
    const selectedIds = new Set(
      selectActionsToHold(
        prepared.loaded.projection.shared.actions,
        selection,
      ).map(({ id }) => id),
    );
    heldActions = holdAffectedActions(
      prepared.loaded.projection.shared.actions,
      selection,
    ).filter(({ id }) => selectedIds.has(id));
    task = newReconsiderationTask({
      affectedActionIds: matched.suggested.payload.affectedActionIds,
      affectedPremiseIds: matched.suggested.payload.affectedPremiseIds,
      createdAt: occurredAt,
      decisionId: current.id,
      id: reconsiderationTaskId(dependencies.ids.next("reconsideration-task")),
      meetingId: current.meetingId,
      ownerParticipantId: authority.participantId,
      triggerExternalEventId: matched.suggested.payload.externalEventId,
    });
  } catch (error) {
    const failure = transitionFailure(error);
    if (failure !== undefined) {
      return failure;
    }
    throw error;
  }

  const correlation = correlationId(
    input.correlationId ?? dependencies.ids.next("correlation"),
  );
  const actor = {
    kind: "participant" as const,
    participantId: participantId(context.participantId),
  };
  const expectedPosition = meetingPosition(input.expectedPosition);
  const reviewed: EventOf<"FacilitatorReviewed"> = {
    actor,
    causationId: causationId(matched.atRisk.eventId),
    correlationId: correlation,
    eventId: eventId(dependencies.ids.next("event")),
    eventType: "FacilitatorReviewed",
    idempotencyKey: idempotencyKey(input.idempotencyKey),
    meetingId: meetingId(input.meetingId),
    occurredAt,
    payload: {
      decision: reviewRequiredDecision,
      decisionId: current.id,
      disposition: "confirm_invalidation",
      facilitatorParticipantId: actor.participantId,
      reason: prepared.reason,
      reviewedActionIds: matched.suggested.payload.affectedActionIds,
      reviewedEvidenceReferenceIds:
        matched.suggested.payload.evidenceReferenceIds,
      reviewedPremiseIds: matched.suggested.payload.affectedPremiseIds,
      suggestionId: matched.suggested.payload.suggestionId,
    },
    position: meetingPosition(expectedPosition + 1),
    schemaVersion: schemaVersion(1),
    visibility: "shared",
  };
  const reviewRequired: EventOf<"DecisionReviewRequired"> = {
    actor: { kind: "system" },
    causationId: causationId(reviewed.eventId),
    correlationId: correlation,
    eventId: eventId(dependencies.ids.next("event")),
    eventType: "DecisionReviewRequired",
    meetingId: meetingId(input.meetingId),
    occurredAt,
    payload: {
      decision: reviewRequiredDecision,
      heldActionIds: heldActions.map(({ id }) => id),
      reconsiderationTaskId: task.id,
      suggestionId: matched.suggested.payload.suggestionId,
    },
    position: meetingPosition(expectedPosition + 2),
    schemaVersion: schemaVersion(1),
    visibility: "shared",
  };
  const actionHeld: EventOf<"ActionHeld"> = {
    actor: { kind: "system" },
    causationId: causationId(reviewRequired.eventId),
    correlationId: correlation,
    eventId: eventId(dependencies.ids.next("event")),
    eventType: "ActionHeld",
    meetingId: meetingId(input.meetingId),
    occurredAt,
    payload: {
      actions: heldActions,
      decisionId: current.id,
      suggestionId: matched.suggested.payload.suggestionId,
    },
    position: meetingPosition(expectedPosition + 3),
    schemaVersion: schemaVersion(1),
    visibility: "shared",
  };
  const taskCreated: EventOf<"ReconsiderationTaskCreated"> = {
    actor: { kind: "system" },
    causationId: causationId(reviewRequired.eventId),
    correlationId: correlation,
    eventId: eventId(dependencies.ids.next("event")),
    eventType: "ReconsiderationTaskCreated",
    meetingId: meetingId(input.meetingId),
    occurredAt,
    payload: { task },
    position: meetingPosition(expectedPosition + 4),
    schemaVersion: schemaVersion(1),
    visibility: "shared",
  };
  const appended = await appendMutation(
    dependencies,
    input,
    prepared.fingerprint,
    [reviewed, reviewRequired, actionHeld, taskCreated],
    context.participantId,
  );
  if (appended.kind === "failed") {
    return appended;
  }
  const appendedReviewed = eventAt(appended.records, "FacilitatorReviewed");
  const appendedHeld = eventAt(appended.records, "ActionHeld");
  const appendedTask = eventAt(appended.records, "ReconsiderationTaskCreated");
  if (
    appendedReviewed === undefined ||
    appendedHeld === undefined ||
    appendedTask === undefined
  ) {
    throw new Error("Invalidation confirmation append was incomplete");
  }
  return {
    correlationId: appendedReviewed.correlationId,
    decision: appendedReviewed.payload.decision,
    disposition: "confirm_invalidation",
    heldActionIds: appendedHeld.payload.actions.map(({ id }) => id),
    heldActions: appendedHeld.payload.actions,
    kind: "review_required",
    position: appendedTask.position,
    reconsiderationTask: appendedTask.payload.task,
    reviewEventId: appendedReviewed.eventId,
    reviewReason: appendedReviewed.payload.reason,
    replayed: appended.kind === "replayed",
    suggestionId: appendedReviewed.payload.suggestionId,
  };
}

export async function rejectInvalidationReview(
  dependencies: InvalidationReviewDependencies,
  context: UserAuthorizationContext,
  input: RejectInvalidationReviewInput,
): Promise<RejectInvalidationReviewResult> {
  const prepared = await prepareReview(
    dependencies,
    context,
    input,
    "reject_suggestion",
  );
  if (isFailure(prepared)) {
    return prepared;
  }
  const priorBatch = priorReviewBatch(
    prepared.loaded.records,
    input.idempotencyKey,
    "reject_suggestion",
  );
  if (priorBatch !== undefined) {
    const replay = await appendMutation(
      dependencies,
      input,
      prepared.fingerprint,
      priorBatch,
      context.participantId,
    );
    if (replay.kind === "failed") {
      return replay;
    }
    const reviewed = eventAt(replay.records, "FacilitatorReviewed");
    if (reviewed === undefined) {
      return failed("IDEMPOTENCY_CONFLICT");
    }
    return {
      correlationId: reviewed.correlationId,
      decision: reviewed.payload.decision,
      disposition: "reject_suggestion",
      kind: "suggestion_rejected",
      position: reviewed.position,
      reviewEventId: reviewed.eventId,
      reviewReason: reviewed.payload.reason,
      replayed: true,
      suggestionId: reviewed.payload.suggestionId,
    };
  }
  if (
    prepared.loaded.records.some(
      ({ event }) => event.idempotencyKey === input.idempotencyKey,
    )
  ) {
    return failed("IDEMPOTENCY_CONFLICT");
  }

  const current = prepared.loaded.projection.shared.decisions.find(
    ({ id }) => id === prepared.targetDecisionId,
  );
  if (current === undefined) {
    return failed("DECISION_NOT_FOUND");
  }
  if (current.status !== "AT_RISK") {
    return failed("INVALID_STATE_TRANSITION");
  }
  const matched = findMatchedSuggestion(
    prepared.loaded.records,
    current,
    prepared.targetSuggestionId,
  );
  if ("kind" in matched) {
    return matched;
  }
  if (
    !referencesExist(prepared.loaded.projection, current, matched.suggested)
  ) {
    return failed("REFERENCED_ENTITY_NOT_FOUND");
  }

  let monitoringDecision: Decision;
  let occurredAt: ReturnType<typeof timestamp>;
  try {
    monitoringDecision = transitionDecision(current, {
      authority: {
        kind: "facilitator",
        participantId: participantId(context.participantId),
      },
      rejectionReason: prepared.reason,
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

  const correlation = correlationId(
    input.correlationId ?? dependencies.ids.next("correlation"),
  );
  const expectedPosition = meetingPosition(input.expectedPosition);
  const reviewed: EventOf<"FacilitatorReviewed"> = {
    actor: {
      kind: "participant",
      participantId: participantId(context.participantId),
    },
    causationId: causationId(matched.atRisk.eventId),
    correlationId: correlation,
    eventId: eventId(dependencies.ids.next("event")),
    eventType: "FacilitatorReviewed",
    idempotencyKey: idempotencyKey(input.idempotencyKey),
    meetingId: meetingId(input.meetingId),
    occurredAt,
    payload: {
      decision: monitoringDecision,
      decisionId: current.id,
      disposition: "reject_suggestion",
      facilitatorParticipantId: participantId(context.participantId),
      reason: prepared.reason,
      reviewedActionIds: matched.suggested.payload.affectedActionIds,
      reviewedEvidenceReferenceIds:
        matched.suggested.payload.evidenceReferenceIds,
      reviewedPremiseIds: matched.suggested.payload.affectedPremiseIds,
      suggestionId: matched.suggested.payload.suggestionId,
    },
    position: meetingPosition(expectedPosition + 1),
    schemaVersion: schemaVersion(1),
    visibility: "shared",
  };
  const appended = await appendMutation(
    dependencies,
    input,
    prepared.fingerprint,
    [reviewed],
    context.participantId,
  );
  if (appended.kind === "failed") {
    return appended;
  }
  const appendedReviewed = eventAt(appended.records, "FacilitatorReviewed");
  if (appendedReviewed === undefined) {
    throw new Error("Invalidation rejection append returned no review event");
  }
  return {
    correlationId: appendedReviewed.correlationId,
    decision: appendedReviewed.payload.decision,
    disposition: "reject_suggestion",
    kind: "suggestion_rejected",
    position: appendedReviewed.position,
    reviewEventId: appendedReviewed.eventId,
    reviewReason: appendedReviewed.payload.reason,
    replayed: appended.kind === "replayed",
    suggestionId: appendedReviewed.payload.suggestionId,
  };
}

export function reviewInvalidation(
  dependencies: InvalidationReviewDependencies,
  context: UserAuthorizationContext,
  input: ReviewInvalidationInput,
): Promise<ReviewInvalidationResult> {
  const mutationInput: InvalidationReviewMutationInput = input;
  return input.disposition === "confirm_invalidation"
    ? confirmInvalidationReview(dependencies, context, mutationInput)
    : rejectInvalidationReview(dependencies, context, mutationInput);
}
