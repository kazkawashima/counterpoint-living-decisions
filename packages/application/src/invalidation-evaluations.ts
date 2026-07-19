import {
  DecisionTransitionError,
  DomainValueError,
  actionId,
  causationId,
  correlationId,
  eventId,
  externalEventId,
  idempotencyKey,
  meetingId,
  meetingPosition,
  nonEmptyText,
  premiseId,
  promptVersion,
  replayMeeting,
  schemaVersion,
  sourceReferenceId,
  suggestionId,
  timestamp,
  transitionDecision,
  type Decision,
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

import type { DecisionHashFunction } from "./decisions.js";

const MEETING_PROJECTION = "meeting";
const ASSUMPTION_INVALIDATION_OPERATION = "assumption_invalidation";
const ASSUMPTION_INVALIDATION_PROMPT_VERSION = "assumption-invalidation-v1";
const ASSUMPTION_INVALIDATION_SCHEMA_VERSION = "1";

export interface AssumptionInvalidationEvaluationInput {
  readonly actions: readonly {
    readonly actionId: string;
    readonly affectedPremiseIds: readonly string[];
    readonly scope: readonly string[];
    readonly status: string;
  }[];
  readonly decision: {
    readonly decisionId: string;
    readonly monitorCondition: string;
    readonly outcome: string;
    readonly revision: number;
    readonly revisionId: string;
    readonly title: string;
  };
  readonly evidence: readonly {
    readonly evidenceReferenceId: string;
    readonly exactSnippet: string;
  }[];
  readonly externalEvent: {
    readonly description: string;
    readonly effectiveAt: string;
    readonly eventType: string;
    readonly externalEventId: string;
    readonly jurisdiction: string;
    readonly source: string;
    readonly sourceReference: string;
  };
  readonly meetingId: string;
  readonly premises: readonly {
    readonly confirmationStatus: string;
    readonly premiseId: string;
    readonly statement: string;
  }[];
}

export interface AssumptionInvalidationCandidate {
  readonly affectedActionIds: readonly string[];
  readonly affectedPremiseIds: readonly string[];
  readonly confidence: number;
  readonly evidenceReferenceIds: readonly string[];
  readonly reason: string;
}

export interface AssumptionInvalidationEvaluation {
  readonly ai: {
    readonly candidates: readonly [AssumptionInvalidationCandidate];
    readonly generatedAt: string;
    readonly inputReferenceIds: readonly string[];
    readonly model: string;
    readonly operation: string;
    readonly promptVersion: string;
    readonly schemaVersion: string;
  };
  readonly suggestion: AssumptionInvalidationCandidate;
}

export interface AssumptionInvalidationEvaluator {
  evaluate(
    input: AssumptionInvalidationEvaluationInput,
  ): Promise<AssumptionInvalidationEvaluation>;
}

export interface InvalidationEvaluationDependencies {
  readonly clock: Clock;
  readonly evaluator?: AssumptionInvalidationEvaluator;
  readonly events: EventStore<DomainEvent>;
  readonly hash: DecisionHashFunction;
  readonly ids: IdGenerator;
  readonly projections: ProjectionStore<MeetingProjection>;
}

export interface EvaluateAssumptionInvalidationInput {
  readonly correlationId?: string;
  readonly externalEventId: string;
  readonly meetingId: string;
}

export interface InvalidationEvaluationView {
  readonly affectedActionIds: readonly string[];
  readonly affectedPremiseIds: readonly string[];
  readonly confidence: number;
  readonly decision: Decision;
  readonly evidenceReferenceIds: readonly string[];
  readonly externalEventId: string;
  readonly generatedAt: string;
  readonly inputReferenceIds: readonly string[];
  readonly model: string;
  readonly operation: string;
  readonly outputSchemaVersion: string;
  readonly promptVersion: string;
  readonly reason: string;
  readonly suggestionId: string;
}

type EvaluationFailureCode =
  | "CONFLICT"
  | "DECISION_NOT_FOUND"
  | "EXTERNAL_EVENT_NOT_FOUND"
  | "FORBIDDEN"
  | "IDEMPOTENCY_CONFLICT"
  | "INVALID_MODEL_OUTPUT"
  | "INVALID_STATE_TRANSITION"
  | "OPENAI_UNAVAILABLE"
  | "REFERENCED_ENTITY_NOT_FOUND"
  | "VALIDATION_FAILED";

export type EvaluateAssumptionInvalidationResult =
  | {
      readonly correlationId: string;
      readonly evaluation: InvalidationEvaluationView;
      readonly kind: "evaluated";
      readonly position: number;
      readonly replayed: boolean;
    }
  | {
      readonly actualPosition?: number;
      readonly code: EvaluationFailureCode;
      readonly kind: "failed";
    };

function normalizeRecords(
  records: readonly EventRecord<DomainEvent>[],
): readonly DomainEvent[] {
  return records.map(({ event, position }) => ({
    ...event,
    position: meetingPosition(position),
  }));
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(
        ([key, nested]) => `${JSON.stringify(key)}:${stableSerialize(nested)}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

async function hashValue(
  hash: DecisionHashFunction,
  value: unknown,
): Promise<string> {
  const serialized = stableSerialize(value);
  return typeof hash === "function"
    ? await hash(serialized)
    : await hash.hash(serialized);
}

function failed(
  code: EvaluationFailureCode,
): EvaluateAssumptionInvalidationResult {
  return { code, kind: "failed" };
}

function evaluationView(
  suggested: EventOf<"AssumptionInvalidationSuggested">,
  markedAtRisk: EventOf<"DecisionMarkedAtRisk">,
): InvalidationEvaluationView {
  return {
    affectedActionIds: suggested.payload.affectedActionIds,
    affectedPremiseIds: suggested.payload.affectedPremiseIds,
    confidence: suggested.payload.metadata.confidence,
    decision: markedAtRisk.payload.decision,
    evidenceReferenceIds: suggested.payload.evidenceReferenceIds,
    externalEventId: suggested.payload.externalEventId,
    generatedAt: suggested.payload.provenance.generatedAt,
    inputReferenceIds: suggested.payload.metadata.inputReferenceIds,
    model: suggested.payload.metadata.model,
    operation: suggested.payload.provenance.operation,
    outputSchemaVersion: suggested.payload.provenance.outputSchemaVersion,
    promptVersion: suggested.payload.metadata.promptVersion,
    reason: suggested.payload.metadata.reason,
    suggestionId: suggested.payload.suggestionId,
  };
}

function evaluationFromEvents(events: readonly DomainEvent[]):
  | {
      readonly correlationId: string;
      readonly position: number;
      readonly view: InvalidationEvaluationView;
    }
  | undefined {
  const suggested = events.find(
    (event): event is EventOf<"AssumptionInvalidationSuggested"> =>
      event.eventType === "AssumptionInvalidationSuggested",
  );
  if (suggested === undefined) {
    return undefined;
  }
  const markedAtRisk = events.find(
    (event): event is EventOf<"DecisionMarkedAtRisk"> =>
      event.eventType === "DecisionMarkedAtRisk" &&
      event.payload.suggestionId === suggested.payload.suggestionId,
  );
  return markedAtRisk === undefined
    ? undefined
    : {
        correlationId: suggested.correlationId,
        position: markedAtRisk.position,
        view: evaluationView(suggested, markedAtRisk),
      };
}

function referencesAreValid(
  candidate: AssumptionInvalidationCandidate,
  input: AssumptionInvalidationEvaluationInput,
): boolean {
  const premises = new Set(input.premises.map(({ premiseId: id }) => id));
  const actions = new Map(
    input.actions.map((action) => [action.actionId, action]),
  );
  const evidence = new Set(
    input.evidence.map(({ evidenceReferenceId: id }) => id),
  );
  evidence.add(input.externalEvent.sourceReference);
  const affectedPremises = new Set(candidate.affectedPremiseIds);
  const hasUniqueValues = (values: readonly string[]): boolean =>
    new Set(values).size === values.length;
  return (
    candidate.affectedPremiseIds.length > 0 &&
    candidate.affectedActionIds.length > 0 &&
    candidate.evidenceReferenceIds.length > 0 &&
    hasUniqueValues(candidate.affectedPremiseIds) &&
    hasUniqueValues(candidate.affectedActionIds) &&
    hasUniqueValues(candidate.evidenceReferenceIds) &&
    candidate.evidenceReferenceIds.includes(
      input.externalEvent.sourceReference,
    ) &&
    candidate.confidence >= 0 &&
    candidate.confidence <= 1 &&
    candidate.reason.trim().length > 0 &&
    candidate.reason.length <= 1_000 &&
    candidate.affectedPremiseIds.every((id) => premises.has(id)) &&
    candidate.evidenceReferenceIds.every((id) => evidence.has(id)) &&
    candidate.affectedActionIds.every((id) => {
      const action = actions.get(id);
      return (
        action?.affectedPremiseIds.some((premise) =>
          affectedPremises.has(premise),
        ) === true
      );
    })
  );
}

function evaluationIsValid(
  evaluation: AssumptionInvalidationEvaluation,
  input: AssumptionInvalidationEvaluationInput,
): boolean {
  const authorizedInputReferences = new Set([
    input.externalEvent.externalEventId,
    input.externalEvent.sourceReference,
    input.decision.decisionId,
    input.decision.revisionId,
    ...input.premises.map(({ premiseId: id }) => id),
    ...input.actions.map(({ actionId: id }) => id),
    ...input.evidence.map(({ evidenceReferenceId: id }) => id),
  ]);
  return (
    evaluation.ai.operation === ASSUMPTION_INVALIDATION_OPERATION &&
    evaluation.ai.promptVersion === ASSUMPTION_INVALIDATION_PROMPT_VERSION &&
    evaluation.ai.schemaVersion === ASSUMPTION_INVALIDATION_SCHEMA_VERSION &&
    evaluation.ai.candidates.length === 1 &&
    stableSerialize(evaluation.ai.candidates[0]) ===
      stableSerialize(evaluation.suggestion) &&
    evaluation.ai.inputReferenceIds.length > 0 &&
    new Set(evaluation.ai.inputReferenceIds).size ===
      evaluation.ai.inputReferenceIds.length &&
    evaluation.ai.inputReferenceIds.every(
      (reference) =>
        reference.trim().length > 0 && authorizedInputReferences.has(reference),
    ) &&
    referencesAreValid(evaluation.suggestion, input)
  );
}

function buildEvaluationInput(
  projection: MeetingProjection["shared"],
  decision: Decision,
  targetExternalEventId: string,
): AssumptionInvalidationEvaluationInput | undefined {
  const externalEvent = projection.externalEvents.find(
    ({ id }) => id === targetExternalEventId,
  );
  if (decision.status !== "MONITORING") {
    return undefined;
  }
  if (externalEvent === undefined) {
    return undefined;
  }
  if (
    decision.monitorCondition.registrationId !==
    externalEvent.monitorRegistrationId
  ) {
    return undefined;
  }
  const revision = projection.decisionRevisions.find(
    ({ id }) => id === decision.activeRevisionId,
  );
  if (
    revision?.decisionId !== decision.id ||
    revision.version !== decision.activeRevision ||
    revision.snapshot.status !== "COMMITTED"
  ) {
    return undefined;
  }
  const premises = projection.premises.filter(
    ({ confirmationStatus, id }) =>
      confirmationStatus === "confirmed" &&
      revision.snapshot.premiseIds.includes(id),
  );
  const actions = projection.actions.filter(({ id }) =>
    revision.snapshot.actionIds.includes(id),
  );
  const evidence = projection.evidence.filter(({ id }) =>
    revision.snapshot.evidenceIds.includes(id),
  );
  if (
    premises.length !== revision.snapshot.premiseIds.length ||
    actions.length !== revision.snapshot.actionIds.length ||
    evidence.length !== revision.snapshot.evidenceIds.length ||
    actions.some(({ status }) => status === "completed" || status === "held")
  ) {
    return undefined;
  }
  return {
    actions: actions.map(({ affectedPremiseIds, id, scope, status }) => ({
      actionId: id,
      affectedPremiseIds,
      scope,
      status,
    })),
    decision: {
      decisionId: decision.id,
      monitorCondition: revision.snapshot.monitorCondition.description,
      outcome: revision.snapshot.outcome,
      revision: revision.version,
      revisionId: revision.id,
      title: revision.snapshot.title,
    },
    evidence: evidence.map(({ exactSnippet, id }) => ({
      evidenceReferenceId: id,
      exactSnippet,
    })),
    externalEvent: {
      description: externalEvent.description,
      effectiveAt: externalEvent.effectiveAt,
      eventType: externalEvent.eventType,
      externalEventId: externalEvent.id,
      jurisdiction: externalEvent.jurisdiction,
      source: externalEvent.source,
      sourceReference: externalEvent.sourceReference,
    },
    meetingId: projection.meetingId,
    premises: premises.map(({ confirmationStatus, id, statement }) => ({
      confirmationStatus,
      premiseId: id,
      statement,
    })),
  };
}

async function refreshProjection(
  dependencies: InvalidationEvaluationDependencies,
  scope: string,
): Promise<void> {
  const records = await dependencies.events.load(scope);
  await dependencies.projections.put(
    { meetingId: scope, projection: MEETING_PROJECTION },
    replayMeeting(meetingId(scope), normalizeRecords(records)),
  );
}

export function listAssumptionInvalidationEvaluations(
  records: readonly EventRecord<DomainEvent>[],
): readonly InvalidationEvaluationView[] {
  const events = normalizeRecords(records);
  return events
    .filter(
      (event): event is EventOf<"AssumptionInvalidationSuggested"> =>
        event.eventType === "AssumptionInvalidationSuggested",
    )
    .flatMap((suggested) => {
      const markedAtRisk = events.find(
        (event): event is EventOf<"DecisionMarkedAtRisk"> =>
          event.eventType === "DecisionMarkedAtRisk" &&
          event.payload.suggestionId === suggested.payload.suggestionId,
      );
      return markedAtRisk === undefined
        ? []
        : [evaluationView(suggested, markedAtRisk)];
    });
}

export async function evaluateAssumptionInvalidation(
  dependencies: InvalidationEvaluationDependencies,
  input: EvaluateAssumptionInvalidationInput,
): Promise<EvaluateAssumptionInvalidationResult> {
  try {
    meetingId(input.meetingId);
    externalEventId(input.externalEventId);
  } catch (error) {
    if (error instanceof DomainValueError) {
      return failed("VALIDATION_FAILED");
    }
    throw error;
  }

  const records = await dependencies.events.load(input.meetingId);
  const receivedRecord = records.find(
    (record): record is EventRecord<EventOf<"ExternalEventReceived">> =>
      record.event.eventType === "ExternalEventReceived" &&
      record.event.payload.externalEvent.id === input.externalEventId,
  );
  if (receivedRecord === undefined) {
    return failed("EXTERNAL_EVENT_NOT_FOUND");
  }
  const receivedEvent = receivedRecord.event;
  const existingSuggested = records.find(
    (
      record,
    ): record is EventRecord<EventOf<"AssumptionInvalidationSuggested">> =>
      record.event.eventType === "AssumptionInvalidationSuggested" &&
      record.event.payload.externalEventId === input.externalEventId,
  );
  if (existingSuggested !== undefined) {
    const existingSuggestedEvent = existingSuggested.event;
    const existingAtRisk = records.find(
      (record): record is EventRecord<EventOf<"DecisionMarkedAtRisk">> =>
        record.event.eventType === "DecisionMarkedAtRisk" &&
        record.event.payload.suggestionId ===
          existingSuggestedEvent.payload.suggestionId,
    );
    if (existingAtRisk === undefined) {
      return failed("IDEMPOTENCY_CONFLICT");
    }
    return {
      correlationId: existingSuggestedEvent.correlationId,
      evaluation: evaluationView(existingSuggestedEvent, existingAtRisk.event),
      kind: "evaluated",
      position: existingAtRisk.position,
      replayed: true,
    };
  }

  const projection = replayMeeting(
    meetingId(input.meetingId),
    normalizeRecords(records),
  );
  const targetDecision = projection.shared.decisions.find(
    ({ monitorCondition, status }) =>
      status === "MONITORING" &&
      monitorCondition.registrationId ===
        receivedEvent.payload.externalEvent.monitorRegistrationId,
  );
  if (targetDecision === undefined) {
    return failed("INVALID_STATE_TRANSITION");
  }
  const evaluatorInput = buildEvaluationInput(
    projection.shared,
    targetDecision,
    input.externalEventId,
  );
  if (evaluatorInput === undefined) {
    return failed("REFERENCED_ENTITY_NOT_FOUND");
  }
  const commandKeyValue =
    `assumption-invalidation:${input.externalEventId}:` +
    `${targetDecision.activeRevisionId}:v1`;
  const fingerprint = await hashValue(dependencies.hash, {
    actionIds: evaluatorInput.actions.map(({ actionId: id }) => id).sort(),
    decisionId: evaluatorInput.decision.decisionId,
    evidenceReferenceIds: evaluatorInput.evidence
      .map(({ evidenceReferenceId: id }) => id)
      .sort(),
    externalEventId: input.externalEventId,
    externalEventPayloadHash: receivedEvent.payload.externalEvent.payloadHash,
    operation: "assumption_invalidation",
    outputSchemaVersion: "1",
    premiseIds: evaluatorInput.premises.map(({ premiseId: id }) => id).sort(),
    promptVersion: "assumption-invalidation-v1",
    revision: evaluatorInput.decision.revision,
    revisionId: evaluatorInput.decision.revisionId,
  });
  const priorSuggested = records.find(
    (
      record,
    ): record is EventRecord<EventOf<"AssumptionInvalidationSuggested">> =>
      record.event.idempotencyKey === commandKeyValue &&
      record.event.eventType === "AssumptionInvalidationSuggested",
  );
  if (priorSuggested !== undefined) {
    const priorSuggestedEvent = priorSuggested.event;
    const priorAtRisk = records.find(
      (record): record is EventRecord<EventOf<"DecisionMarkedAtRisk">> =>
        record.event.eventType === "DecisionMarkedAtRisk" &&
        record.event.payload.suggestionId ===
          priorSuggestedEvent.payload.suggestionId,
    );
    if (priorAtRisk === undefined) {
      return failed("IDEMPOTENCY_CONFLICT");
    }
    const replay = await dependencies.events.append({
      events: [priorSuggestedEvent, priorAtRisk.event],
      expectedPosition: priorSuggested.position - 1,
      idempotencyKey: commandKeyValue,
      meetingId: input.meetingId,
      payloadFingerprint: fingerprint,
      trustPayloadFingerprintForReplay: true,
    });
    if (replay.kind === "idempotency_conflict") {
      return failed("IDEMPOTENCY_CONFLICT");
    }
    if (replay.kind === "position_conflict") {
      return {
        actualPosition: replay.actualPosition,
        code: "CONFLICT",
        kind: "failed",
      };
    }
    const receipt = evaluationFromEvents(normalizeRecords(replay.records));
    return receipt === undefined
      ? failed("IDEMPOTENCY_CONFLICT")
      : {
          correlationId: receipt.correlationId,
          evaluation: receipt.view,
          kind: "evaluated",
          position: receipt.position,
          replayed: true,
        };
  }
  if (dependencies.evaluator === undefined) {
    return failed("OPENAI_UNAVAILABLE");
  }

  const evaluation = await dependencies.evaluator.evaluate(evaluatorInput);
  if (!evaluationIsValid(evaluation, evaluatorInput)) {
    return failed("INVALID_MODEL_OUTPUT");
  }

  let markedAtRisk: Decision;
  let occurredAt: ReturnType<typeof timestamp>;
  let generatedAt: ReturnType<typeof timestamp>;
  let invalidationSuggestionId: ReturnType<typeof suggestionId>;
  try {
    occurredAt = timestamp(dependencies.clock.now());
    generatedAt = timestamp(evaluation.ai.generatedAt);
    invalidationSuggestionId = suggestionId(
      dependencies.ids.next("suggestion"),
    );
    markedAtRisk = transitionDecision(targetDecision, {
      affectedActionIds: evaluation.suggestion.affectedActionIds.map(actionId),
      affectedPremiseIds:
        evaluation.suggestion.affectedPremiseIds.map(premiseId),
      authority: { kind: "system" },
      invalidationSuggestionRecorded: true,
      suggestionReferenceIds: evaluation.suggestion.evidenceReferenceIds,
      to: "AT_RISK",
    });
  } catch (error) {
    if (error instanceof DecisionTransitionError) {
      return failed("INVALID_STATE_TRANSITION");
    }
    if (error instanceof DomainValueError) {
      return failed("VALIDATION_FAILED");
    }
    throw error;
  }

  const correlation = correlationId(
    input.correlationId ?? receivedEvent.correlationId,
  );
  const commandKey = idempotencyKey(commandKeyValue);
  const scope = meetingId(input.meetingId);
  const expectedPosition = records.at(-1)?.position ?? 0;
  const affectedPremiseIds =
    evaluation.suggestion.affectedPremiseIds.map(premiseId);
  const affectedActionIds =
    evaluation.suggestion.affectedActionIds.map(actionId);
  const suggested: EventOf<"AssumptionInvalidationSuggested"> = {
    actor: { kind: "ai", model: nonEmptyText(evaluation.ai.model) },
    causationId: causationId(receivedEvent.eventId),
    correlationId: correlation,
    eventId: eventId(dependencies.ids.next("event")),
    eventType: "AssumptionInvalidationSuggested",
    idempotencyKey: commandKey,
    meetingId: scope,
    occurredAt,
    payload: {
      affectedActionIds,
      affectedPremiseIds,
      activeRevisionId: targetDecision.activeRevisionId,
      decisionId: targetDecision.id,
      evidenceReferenceIds:
        evaluation.suggestion.evidenceReferenceIds.map(sourceReferenceId),
      externalEventId: externalEventId(input.externalEventId),
      metadata: {
        confidence: evaluation.suggestion.confidence,
        inputReferenceIds:
          evaluation.ai.inputReferenceIds.map(sourceReferenceId),
        model: nonEmptyText(evaluation.ai.model),
        promptVersion: promptVersion(evaluation.ai.promptVersion),
        reason: nonEmptyText(evaluation.suggestion.reason),
      },
      provenance: {
        generatedAt,
        operation: nonEmptyText(evaluation.ai.operation),
        outputSchemaVersion: nonEmptyText(evaluation.ai.schemaVersion),
      },
      suggestionId: invalidationSuggestionId,
    },
    position: meetingPosition(expectedPosition + 1),
    schemaVersion: schemaVersion(1),
    visibility: "shared",
  };
  const atRisk: EventOf<"DecisionMarkedAtRisk"> = {
    actor: { kind: "system" },
    causationId: causationId(suggested.eventId),
    correlationId: correlation,
    eventId: eventId(dependencies.ids.next("event")),
    eventType: "DecisionMarkedAtRisk",
    meetingId: scope,
    occurredAt,
    payload: {
      affectedActionIds,
      affectedPremiseIds,
      decision: markedAtRisk,
      suggestionId: invalidationSuggestionId,
    },
    position: meetingPosition(expectedPosition + 2),
    schemaVersion: schemaVersion(1),
    visibility: "shared",
  };
  const appended = await dependencies.events.append({
    events: [suggested, atRisk],
    expectedPosition,
    idempotencyKey: commandKeyValue,
    meetingId: input.meetingId,
    payloadFingerprint: fingerprint,
    trustPayloadFingerprintForReplay: true,
  });
  if (appended.kind === "idempotency_conflict") {
    return failed("IDEMPOTENCY_CONFLICT");
  }
  if (appended.kind === "position_conflict") {
    return {
      actualPosition: appended.actualPosition,
      code: "CONFLICT",
      kind: "failed",
    };
  }
  await refreshProjection(dependencies, input.meetingId);
  const receipt = evaluationFromEvents(normalizeRecords(appended.records));
  if (receipt === undefined) {
    throw new Error("Invalidation append returned no complete evaluation");
  }
  return {
    correlationId: receipt.correlationId,
    evaluation: receipt.view,
    kind: "evaluated",
    position: receipt.position,
    replayed: appended.kind === "replayed",
  };
}
