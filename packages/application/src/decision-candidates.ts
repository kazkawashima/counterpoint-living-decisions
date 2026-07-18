import {
  DomainValueError,
  actionId,
  correlationId,
  createAction,
  createDissent,
  createPremise,
  dissentId,
  eventId,
  idempotencyKey,
  meetingId,
  meetingPosition,
  nonEmptyText,
  participantId,
  premiseId,
  promptVersion,
  replayMeeting,
  revisionNumber,
  schemaVersion,
  sourceReferenceId,
  suggestionId,
  timestamp,
  type Action,
  type AiSuggestionMetadata,
  type Dissent,
  type DomainEvent,
  type EventOf,
  type MeetingProjection,
  type Premise,
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
const MANUAL_MODEL = "human-authored";
const MANUAL_PROMPT_VERSION = "manual-decision-v1";

export interface SharedDecisionSynthesisInput {
  readonly actions: readonly {
    readonly actionId: string;
    readonly scope: readonly string[];
    readonly status: string;
  }[];
  readonly dissent: readonly {
    readonly dissentId: string;
    readonly reason: string;
    readonly retained: boolean;
  }[];
  readonly evidence: readonly {
    readonly evidenceId: string;
    readonly exactSnippet: string;
  }[];
  readonly meetingId: string;
  readonly participantIds: readonly string[];
  readonly premises: readonly {
    readonly premiseId: string;
    readonly statement: string;
  }[];
}

export interface SharedDecisionSynthesis {
  readonly ai: {
    readonly generatedAt: string;
    readonly inputReferenceIds: readonly string[];
    readonly model: string;
    readonly operation: string;
    readonly promptVersion: string;
    readonly schemaVersion: string;
  };
  readonly draft: {
    readonly action: {
      readonly ownerParticipantId: string;
      readonly scope: string;
    };
    readonly confidence: number;
    readonly dissent: {
      readonly reason: string;
      readonly retained: boolean;
    };
    readonly monitorCondition: string;
    readonly outcome: string;
    readonly premise: {
      readonly evidenceReferenceIds: readonly string[];
      readonly statement: string;
    };
    readonly reason: string;
    readonly title: string;
  };
}

export interface SharedDecisionSynthesizer {
  synthesize(
    input: SharedDecisionSynthesisInput,
  ): Promise<SharedDecisionSynthesis>;
}

export interface DecisionCandidateDependencies {
  readonly clock: Clock;
  readonly events: EventStore<DomainEvent>;
  readonly hash: DecisionHashFunction;
  readonly ids: IdGenerator;
  readonly listParticipantIds: (
    meetingId: string,
  ) => Promise<readonly string[]>;
  readonly projections: ProjectionStore<MeetingProjection>;
  readonly synthesizer?: SharedDecisionSynthesizer;
}

interface CandidateMutationInput {
  readonly correlationId?: string;
  readonly expectedPosition: number;
  readonly idempotencyKey: string;
  readonly meetingId: string;
}

export interface ManualDecisionDraftInput {
  readonly actions: readonly {
    readonly ownerParticipantId: string;
    readonly scope: readonly string[];
  }[];
  readonly dissent: readonly {
    readonly reason: string;
    readonly retained: boolean;
  }[];
  readonly monitorCondition: {
    readonly description: string;
  };
  readonly outcome: string;
  readonly premises: readonly {
    readonly evidenceReferenceIds: readonly string[];
    readonly statement: string;
  }[];
  readonly title: string;
}

export type PrepareSharedDecisionCandidateInput = CandidateMutationInput &
  (
    | {
        readonly assistance: "ai_preferred";
      }
    | {
        readonly assistance: "manual";
        readonly draft: ManualDecisionDraftInput;
      }
  );

export interface DecisionCandidateView {
  readonly candidateId: string;
  readonly draft: {
    readonly actionCandidates: readonly {
      readonly candidateId: string;
      readonly ownerParticipantId: string;
      readonly scope: readonly string[];
    }[];
    readonly dissentCandidates: readonly {
      readonly candidateId: string;
      readonly reason: string;
      readonly retained: boolean;
    }[];
    readonly monitorCondition: {
      readonly description: string;
    };
    readonly outcome: string;
    readonly premiseCandidates: readonly {
      readonly candidateId: string;
      readonly confidence: number;
      readonly evidenceReferenceIds: readonly string[];
      readonly reason: string;
      readonly statement: string;
    }[];
    readonly title: string;
  };
  readonly provenance:
    | {
        readonly confidence: number;
        readonly generatedAt: string;
        readonly inputReferenceIds: readonly string[];
        readonly model: string;
        readonly operation: string;
        readonly origin: "ai_assisted";
        readonly promptVersion: string;
        readonly reason: string;
        readonly schemaVersion: string;
      }
    | {
        readonly origin: "human_authored";
      };
}

export type DecisionCandidateFailure =
  | {
      readonly actualPosition: number;
      readonly code: "CONFLICT";
      readonly expectedPosition: number;
      readonly kind: "failed";
    }
  | {
      readonly code:
        | "CANDIDATE_NOT_FOUND"
        | "FORBIDDEN"
        | "IDEMPOTENCY_CONFLICT"
        | "OPENAI_UNAVAILABLE"
        | "REFERENCED_ENTITY_NOT_FOUND"
        | "VALIDATION_FAILED";
      readonly kind: "failed";
    };

export type PrepareSharedDecisionCandidateResult =
  | {
      readonly candidate: DecisionCandidateView;
      readonly correlationId: string;
      readonly kind: "candidate_prepared";
      readonly position: number;
      readonly replayed: boolean;
    }
  | DecisionCandidateFailure;

export interface PremiseCandidateDispositionInput {
  readonly candidateId: string;
  readonly disposition: "confirmed" | "rejected";
  readonly premise?: {
    readonly evidenceReferenceIds: readonly string[];
    readonly statement: string;
  };
  readonly reason?: string;
}

export interface DispositionDecisionCandidateInput extends CandidateMutationInput {
  readonly actions: readonly {
    readonly ownerParticipantId: string;
    readonly scope: readonly string[];
  }[];
  readonly candidateId: string;
  readonly dissent: readonly {
    readonly reason: string;
    readonly retained: boolean;
  }[];
  readonly premiseDispositions: readonly PremiseCandidateDispositionInput[];
}

export type DispositionDecisionCandidateResult =
  | {
      readonly actions: readonly Action[];
      readonly candidateId: string;
      readonly correlationId: string;
      readonly dissent: readonly Dissent[];
      readonly kind: "candidate_disposed";
      readonly position: number;
      readonly premiseDispositions: readonly {
        readonly candidateId: string;
        readonly disposition: "confirmed" | "rejected";
      }[];
      readonly premises: readonly Premise[];
      readonly replayed: boolean;
    }
  | DecisionCandidateFailure;

interface LoadedState {
  readonly projection: MeetingProjection;
  readonly records: readonly EventRecord<DomainEvent>[];
}

interface CandidateBundle {
  readonly actionEvents: readonly EventOf<"InferenceSuggested">[];
  readonly decisionEvent: EventOf<"InferenceSuggested">;
  readonly dissentEvents: readonly EventOf<"InferenceSuggested">[];
  readonly premiseEvents: readonly EventOf<"InferenceSuggested">[];
}

function failed(
  code: Exclude<DecisionCandidateFailure["code"], "CONFLICT">,
): DecisionCandidateFailure {
  return { code, kind: "failed" };
}

function authorizeFacilitator(
  context: UserAuthorizationContext,
  input: CandidateMutationInput,
): DecisionCandidateFailure | undefined {
  if (context.role !== "facilitator") {
    return failed("FORBIDDEN");
  }
  const authorization = authorize(context, {
    capability: "decision:commit",
    meetingId: input.meetingId,
  });
  return authorization.kind === "authorized" ? undefined : failed("FORBIDDEN");
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
  input: unknown,
): Promise<string> {
  const serialized = stableSerialize(input);
  const value =
    typeof hash === "function"
      ? await hash(serialized)
      : await hash.hash(serialized);
  if (
    value.length === 0 ||
    value.length > 512 ||
    value.trim() !== value ||
    /\s/u.test(value)
  ) {
    throw new DomainValueError(
      "Injected hash must be a non-empty, whitespace-free value",
    );
  }
  return value;
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
  dependencies: DecisionCandidateDependencies,
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
  dependencies: DecisionCandidateDependencies,
  meetingScope: string,
  ownerParticipantId: string,
): Promise<void> {
  const loaded = await loadState(dependencies, meetingScope);
  await dependencies.projections.put(
    {
      meetingId: meetingScope,
      ownerParticipantId,
      projection: MEETING_PROJECTION,
    },
    loaded.projection,
  );
}

function privateSuggestionEvents(
  records: readonly EventRecord<DomainEvent>[],
  ownerParticipantId: string,
): readonly EventOf<"InferenceSuggested">[] {
  return normalizeRecords(records).filter(
    (event): event is EventOf<"InferenceSuggested"> =>
      event.eventType === "InferenceSuggested" &&
      event.visibility === "private" &&
      event.ownerParticipantId === ownerParticipantId,
  );
}

function candidateBundle(
  events: readonly EventOf<"InferenceSuggested">[],
  candidateId: string,
): CandidateBundle | undefined {
  const decisionEvent = events.find(
    (event) =>
      event.payload.candidateKind === "decision" &&
      event.payload.suggestionId === candidateId &&
      event.payload.details !== undefined,
  );
  if (
    decisionEvent?.payload.candidateKind !== "decision" ||
    decisionEvent.payload.details === undefined
  ) {
    return undefined;
  }
  const details = decisionEvent.payload.details;
  const byIds = (
    ids: readonly string[],
    kind: "action" | "dissent" | "premise",
  ) =>
    ids.flatMap((id) => {
      const event = events.find(
        (candidate) =>
          candidate.payload.suggestionId === id &&
          candidate.payload.candidateKind === kind &&
          candidate.payload.details !== undefined,
      );
      return event === undefined ? [] : [event];
    });
  const premiseEvents = byIds(details.premiseSuggestionIds, "premise");
  const dissentEvents = byIds(details.dissentSuggestionIds, "dissent");
  const actionEvents = byIds(details.actionSuggestionIds, "action");
  if (
    premiseEvents.length !== details.premiseSuggestionIds.length ||
    dissentEvents.length !== details.dissentSuggestionIds.length ||
    actionEvents.length !== details.actionSuggestionIds.length
  ) {
    return undefined;
  }
  return { actionEvents, decisionEvent, dissentEvents, premiseEvents };
}

function candidateView(bundle: CandidateBundle): DecisionCandidateView {
  const decision = bundle.decisionEvent.payload;
  if (decision.candidateKind !== "decision" || decision.details === undefined) {
    throw new Error("Decision candidate bundle has no decision details");
  }
  const metadata = decision.metadata;
  const provenance = decision.details.provenance;
  return {
    candidateId: decision.suggestionId,
    draft: {
      actionCandidates: bundle.actionEvents.map(({ payload }) => {
        if (
          payload.candidateKind !== "action" ||
          payload.details === undefined
        ) {
          throw new Error("Decision candidate has invalid Action details");
        }
        return {
          candidateId: payload.suggestionId,
          ownerParticipantId: payload.details.ownerParticipantId,
          scope: payload.details.scope,
        };
      }),
      dissentCandidates: bundle.dissentEvents.map(({ payload }) => {
        if (
          payload.candidateKind !== "dissent" ||
          payload.details === undefined
        ) {
          throw new Error("Decision candidate has invalid dissent details");
        }
        return {
          candidateId: payload.suggestionId,
          reason: payload.statement,
          retained: payload.details.retained,
        };
      }),
      monitorCondition: decision.details.monitorCondition,
      outcome: decision.details.outcome,
      premiseCandidates: bundle.premiseEvents.map(({ payload }) => {
        if (
          payload.candidateKind !== "premise" ||
          payload.details === undefined
        ) {
          throw new Error("Decision candidate has invalid premise details");
        }
        return {
          candidateId: payload.suggestionId,
          confidence: payload.metadata.confidence,
          evidenceReferenceIds: payload.details.evidenceReferenceIds,
          reason: payload.metadata.reason,
          statement: payload.statement,
        };
      }),
      title: decision.details.title,
    },
    provenance:
      provenance?.origin === "ai_assisted"
        ? {
            confidence: metadata.confidence,
            generatedAt: provenance.generatedAt,
            inputReferenceIds: metadata.inputReferenceIds,
            model: metadata.model,
            operation: provenance.operation,
            origin: "ai_assisted",
            promptVersion: metadata.promptVersion,
            reason: metadata.reason,
            schemaVersion: provenance.outputSchemaVersion,
          }
        : { origin: "human_authored" },
  };
}

function inputFingerprint(input: PrepareSharedDecisionCandidateInput): unknown {
  return input.assistance === "manual"
    ? {
        assistance: input.assistance,
        draft: input.draft,
        meetingId: input.meetingId,
      }
    : {
        assistance: input.assistance,
        meetingId: input.meetingId,
      };
}

function candidateMatchesInput(
  candidate: DecisionCandidateView,
  input: PrepareSharedDecisionCandidateInput,
): boolean {
  if (input.assistance === "ai_preferred") {
    return candidate.provenance.origin === "ai_assisted";
  }
  if (candidate.provenance.origin !== "human_authored") {
    return false;
  }
  return (
    stableSerialize({
      actions: candidate.draft.actionCandidates.map(
        ({ ownerParticipantId, scope }) => ({ ownerParticipantId, scope }),
      ),
      dissent: candidate.draft.dissentCandidates.map(
        ({ reason, retained }) => ({ reason, retained }),
      ),
      monitorCondition: candidate.draft.monitorCondition,
      outcome: candidate.draft.outcome,
      premises: candidate.draft.premiseCandidates.map(
        ({ evidenceReferenceIds, statement }) => ({
          evidenceReferenceIds,
          statement,
        }),
      ),
      title: candidate.draft.title,
    }) === stableSerialize(input.draft)
  );
}

function candidateEvents(
  dependencies: DecisionCandidateDependencies,
  context: UserAuthorizationContext,
  input: PrepareSharedDecisionCandidateInput,
  candidate: Omit<DecisionCandidateView, "candidateId">,
  correlation: ReturnType<typeof correlationId>,
  occurredAt: ReturnType<typeof timestamp>,
): readonly EventOf<"InferenceSuggested">[] {
  const premiseIds = candidate.draft.premiseCandidates.map(() =>
    suggestionId(dependencies.ids.next("suggestion")),
  );
  const dissentIds = candidate.draft.dissentCandidates.map(() =>
    suggestionId(dependencies.ids.next("suggestion")),
  );
  const actionIds = candidate.draft.actionCandidates.map(() =>
    suggestionId(dependencies.ids.next("suggestion")),
  );
  const decisionSuggestionId = suggestionId(
    dependencies.ids.next("suggestion"),
  );
  const actor = {
    kind: "participant" as const,
    participantId: participantId(context.participantId),
  };
  const common = {
    actor,
    correlationId: correlation,
    meetingId: meetingId(input.meetingId),
    occurredAt,
    ownerParticipantId: participantId(context.participantId),
    schemaVersion: schemaVersion(1),
    visibility: "private" as const,
  };
  const metadata = (inputMetadata: {
    readonly confidence: number;
    readonly inputReferenceIds: readonly string[];
    readonly model: string;
    readonly promptVersion: string;
    readonly reason: string;
  }): AiSuggestionMetadata => ({
    confidence: inputMetadata.confidence,
    inputReferenceIds: inputMetadata.inputReferenceIds.map(sourceReferenceId),
    model: nonEmptyText(inputMetadata.model),
    promptVersion: promptVersion(inputMetadata.promptVersion),
    reason: nonEmptyText(inputMetadata.reason),
  });
  const premiseEvents = candidate.draft.premiseCandidates.map(
    (premise, index): EventOf<"InferenceSuggested"> => ({
      ...common,
      eventId: eventId(dependencies.ids.next("event")),
      eventType: "InferenceSuggested",
      payload: {
        candidateKind: "premise",
        details: {
          dependencyScope: [nonEmptyText(candidate.draft.title)],
          evidenceReferenceIds:
            premise.evidenceReferenceIds.map(sourceReferenceId),
          monitorCondition: {
            description: nonEmptyText(
              candidate.draft.monitorCondition.description,
            ),
          },
        },
        metadata: metadata({
          confidence: premise.confidence,
          inputReferenceIds: premise.evidenceReferenceIds,
          model:
            candidate.provenance.origin === "ai_assisted"
              ? candidate.provenance.model
              : MANUAL_MODEL,
          promptVersion:
            candidate.provenance.origin === "ai_assisted"
              ? candidate.provenance.promptVersion
              : MANUAL_PROMPT_VERSION,
          reason: premise.reason,
        }),
        statement: nonEmptyText(premise.statement),
        suggestionId: premiseIds[index]!,
      },
      position: meetingPosition(input.expectedPosition + index + 1),
    }),
  );
  const dissentEvents = candidate.draft.dissentCandidates.map(
    (dissent, index): EventOf<"InferenceSuggested"> => ({
      ...common,
      eventId: eventId(dependencies.ids.next("event")),
      eventType: "InferenceSuggested",
      payload: {
        candidateKind: "dissent",
        details: {
          participantId: participantId(context.participantId),
          retained: dissent.retained,
        },
        metadata: metadata({
          confidence:
            candidate.provenance.origin === "ai_assisted"
              ? candidate.provenance.confidence
              : 1,
          inputReferenceIds: candidate.draft.premiseCandidates.flatMap(
            ({ evidenceReferenceIds }) => evidenceReferenceIds,
          ),
          model:
            candidate.provenance.origin === "ai_assisted"
              ? candidate.provenance.model
              : MANUAL_MODEL,
          promptVersion:
            candidate.provenance.origin === "ai_assisted"
              ? candidate.provenance.promptVersion
              : MANUAL_PROMPT_VERSION,
          reason:
            candidate.provenance.origin === "ai_assisted"
              ? candidate.provenance.reason
              : "Facilitator-authored dissent.",
        }),
        statement: nonEmptyText(dissent.reason),
        suggestionId: dissentIds[index]!,
      },
      position: meetingPosition(
        input.expectedPosition + premiseEvents.length + index + 1,
      ),
    }),
  );
  const actionEvents = candidate.draft.actionCandidates.map(
    (action, index): EventOf<"InferenceSuggested"> => ({
      ...common,
      eventId: eventId(dependencies.ids.next("event")),
      eventType: "InferenceSuggested",
      payload: {
        candidateKind: "action",
        details: {
          affectedPremiseSuggestionIds: premiseIds,
          ownerParticipantId: participantId(action.ownerParticipantId),
          scope: action.scope.map(nonEmptyText),
        },
        metadata: metadata({
          confidence:
            candidate.provenance.origin === "ai_assisted"
              ? candidate.provenance.confidence
              : 1,
          inputReferenceIds: candidate.draft.premiseCandidates.flatMap(
            ({ evidenceReferenceIds }) => evidenceReferenceIds,
          ),
          model:
            candidate.provenance.origin === "ai_assisted"
              ? candidate.provenance.model
              : MANUAL_MODEL,
          promptVersion:
            candidate.provenance.origin === "ai_assisted"
              ? candidate.provenance.promptVersion
              : MANUAL_PROMPT_VERSION,
          reason:
            candidate.provenance.origin === "ai_assisted"
              ? candidate.provenance.reason
              : "Facilitator-authored Action.",
        }),
        statement: nonEmptyText(action.scope.join("; ")),
        suggestionId: actionIds[index]!,
      },
      position: meetingPosition(
        input.expectedPosition +
          premiseEvents.length +
          dissentEvents.length +
          index +
          1,
      ),
    }),
  );
  const provenance =
    candidate.provenance.origin === "ai_assisted"
      ? {
          generatedAt: timestamp(candidate.provenance.generatedAt),
          operation: nonEmptyText(candidate.provenance.operation),
          origin: "ai_assisted" as const,
          outputSchemaVersion: nonEmptyText(candidate.provenance.schemaVersion),
        }
      : { origin: "human_authored" as const };
  const decisionEvent: EventOf<"InferenceSuggested"> = {
    ...common,
    eventId: eventId(dependencies.ids.next("event")),
    eventType: "InferenceSuggested",
    idempotencyKey: idempotencyKey(input.idempotencyKey),
    payload: {
      candidateKind: "decision",
      details: {
        actionSuggestionIds: actionIds,
        dissentSuggestionIds: dissentIds,
        monitorCondition: {
          description: nonEmptyText(
            candidate.draft.monitorCondition.description,
          ),
        },
        outcome: nonEmptyText(candidate.draft.outcome),
        premiseSuggestionIds: premiseIds,
        provenance,
        title: nonEmptyText(candidate.draft.title),
      },
      metadata: metadata({
        confidence:
          candidate.provenance.origin === "ai_assisted"
            ? candidate.provenance.confidence
            : 1,
        inputReferenceIds: candidate.draft.premiseCandidates.flatMap(
          ({ evidenceReferenceIds }) => evidenceReferenceIds,
        ),
        model:
          candidate.provenance.origin === "ai_assisted"
            ? candidate.provenance.model
            : MANUAL_MODEL,
        promptVersion:
          candidate.provenance.origin === "ai_assisted"
            ? candidate.provenance.promptVersion
            : MANUAL_PROMPT_VERSION,
        reason:
          candidate.provenance.origin === "ai_assisted"
            ? candidate.provenance.reason
            : "Facilitator-authored Decision candidate.",
      }),
      statement: nonEmptyText(candidate.draft.outcome),
      suggestionId: decisionSuggestionId,
    },
    position: meetingPosition(
      input.expectedPosition +
        premiseEvents.length +
        dissentEvents.length +
        actionEvents.length +
        1,
    ),
  };
  return [...premiseEvents, ...dissentEvents, ...actionEvents, decisionEvent];
}

function manualCandidate(
  draft: ManualDecisionDraftInput,
): Omit<DecisionCandidateView, "candidateId"> {
  return {
    draft: {
      actionCandidates: draft.actions.map((action) => ({
        candidateId: "",
        ownerParticipantId: action.ownerParticipantId,
        scope: action.scope,
      })),
      dissentCandidates: draft.dissent.map((dissent) => ({
        candidateId: "",
        reason: dissent.reason,
        retained: dissent.retained,
      })),
      monitorCondition: draft.monitorCondition,
      outcome: draft.outcome,
      premiseCandidates: draft.premises.map((premise) => ({
        candidateId: "",
        confidence: 1,
        evidenceReferenceIds: premise.evidenceReferenceIds,
        reason: "Facilitator-authored premise.",
        statement: premise.statement,
      })),
      title: draft.title,
    },
    provenance: { origin: "human_authored" },
  };
}

function aiCandidate(
  synthesis: SharedDecisionSynthesis,
): Omit<DecisionCandidateView, "candidateId"> {
  return {
    draft: {
      actionCandidates: [
        {
          candidateId: "",
          ownerParticipantId: synthesis.draft.action.ownerParticipantId,
          scope: [synthesis.draft.action.scope],
        },
      ],
      dissentCandidates: [
        {
          candidateId: "",
          reason: synthesis.draft.dissent.reason,
          retained: synthesis.draft.dissent.retained,
        },
      ],
      monitorCondition: {
        description: synthesis.draft.monitorCondition,
      },
      outcome: synthesis.draft.outcome,
      premiseCandidates: [
        {
          candidateId: "",
          confidence: synthesis.draft.confidence,
          evidenceReferenceIds: synthesis.draft.premise.evidenceReferenceIds,
          reason: synthesis.draft.reason,
          statement: synthesis.draft.premise.statement,
        },
      ],
      title: synthesis.draft.title,
    },
    provenance: {
      confidence: synthesis.draft.confidence,
      generatedAt: synthesis.ai.generatedAt,
      inputReferenceIds: synthesis.ai.inputReferenceIds,
      model: synthesis.ai.model,
      operation: synthesis.ai.operation,
      origin: "ai_assisted",
      promptVersion: synthesis.ai.promptVersion,
      reason: synthesis.draft.reason,
      schemaVersion: synthesis.ai.schemaVersion,
    },
  };
}

function validateCandidateReferences(
  candidate: Omit<DecisionCandidateView, "candidateId">,
  shared: MeetingProjection["shared"],
  participantIds: readonly string[],
): boolean {
  const evidenceIds = new Set<string>(shared.evidence.map(({ id }) => id));
  const participants = new Set(participantIds);
  return (
    candidate.draft.premiseCandidates.length > 0 &&
    candidate.draft.premiseCandidates.every(
      ({ evidenceReferenceIds }) =>
        evidenceReferenceIds.length > 0 &&
        evidenceReferenceIds.every((id) => evidenceIds.has(id)),
    ) &&
    candidate.draft.actionCandidates.every(({ ownerParticipantId }) =>
      participants.has(ownerParticipantId),
    )
  );
}

export async function prepareSharedDecisionCandidate(
  dependencies: DecisionCandidateDependencies,
  context: UserAuthorizationContext,
  input: PrepareSharedDecisionCandidateInput,
): Promise<PrepareSharedDecisionCandidateResult> {
  const authorizationFailure = authorizeFacilitator(context, input);
  if (authorizationFailure !== undefined) {
    return authorizationFailure;
  }
  let fingerprint: string;
  try {
    meetingId(input.meetingId);
    meetingPosition(input.expectedPosition);
    idempotencyKey(input.idempotencyKey);
    fingerprint = await hashValue(dependencies.hash, inputFingerprint(input));
  } catch (error) {
    if (error instanceof DomainValueError) {
      return failed("VALIDATION_FAILED");
    }
    throw error;
  }

  const loaded = await loadState(dependencies, input.meetingId);
  const privateEvents = privateSuggestionEvents(
    loaded.records,
    context.participantId,
  );
  const previousRoot = privateEvents.find(
    (event) =>
      event.payload.candidateKind === "decision" &&
      event.idempotencyKey === input.idempotencyKey,
  );
  if (previousRoot !== undefined) {
    const previousBundle = candidateBundle(
      privateEvents,
      previousRoot.payload.suggestionId,
    );
    if (previousBundle === undefined) {
      return failed("IDEMPOTENCY_CONFLICT");
    }
    const previousCandidate = candidateView(previousBundle);
    if (!candidateMatchesInput(previousCandidate, input)) {
      return failed("IDEMPOTENCY_CONFLICT");
    }
    return {
      candidate: previousCandidate,
      correlationId: previousRoot.correlationId,
      kind: "candidate_prepared",
      position: previousRoot.position,
      replayed: true,
    };
  }

  const participantIds = await dependencies.listParticipantIds(input.meetingId);
  let candidate: Omit<DecisionCandidateView, "candidateId">;
  try {
    if (input.assistance === "manual") {
      candidate = manualCandidate(input.draft);
    } else {
      if (dependencies.synthesizer === undefined) {
        return failed("OPENAI_UNAVAILABLE");
      }
      const synthesis = await dependencies.synthesizer.synthesize({
        actions: loaded.projection.shared.actions.map(
          ({ id, scope, status }) => ({ actionId: id, scope, status }),
        ),
        dissent: loaded.projection.shared.dissent.map(
          ({ id, reason, retained }) => ({
            dissentId: id,
            reason,
            retained,
          }),
        ),
        evidence: loaded.projection.shared.evidence.map(
          ({ exactSnippet, id }) => ({ evidenceId: id, exactSnippet }),
        ),
        meetingId: input.meetingId,
        participantIds,
        premises: loaded.projection.shared.premises.map(
          ({ id, statement }) => ({ premiseId: id, statement }),
        ),
      });
      candidate = aiCandidate(synthesis);
    }
    if (
      !validateCandidateReferences(
        candidate,
        loaded.projection.shared,
        participantIds,
      )
    ) {
      return failed("REFERENCED_ENTITY_NOT_FOUND");
    }
  } catch (error) {
    if (error instanceof DomainValueError) {
      return failed("VALIDATION_FAILED");
    }
    throw error;
  }

  let events: readonly EventOf<"InferenceSuggested">[];
  try {
    const occurredAt = timestamp(dependencies.clock.now());
    const commandCorrelation = correlationId(
      input.correlationId ?? dependencies.ids.next("correlation"),
    );
    events = candidateEvents(
      dependencies,
      context,
      input,
      candidate,
      commandCorrelation,
      occurredAt,
    );
  } catch (error) {
    if (error instanceof DomainValueError) {
      return failed("VALIDATION_FAILED");
    }
    throw error;
  }
  const appended = await dependencies.events.append({
    events,
    expectedPosition: input.expectedPosition,
    idempotencyKey: input.idempotencyKey,
    meetingId: input.meetingId,
    payloadFingerprint: fingerprint,
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
  await refreshProjection(dependencies, input.meetingId, context.participantId);
  const appendedEvents = normalizeRecords(appended.records).filter(
    (event): event is EventOf<"InferenceSuggested"> =>
      event.eventType === "InferenceSuggested",
  );
  const decisionEvent = appendedEvents.find(
    ({ payload }) => payload.candidateKind === "decision",
  );
  if (decisionEvent === undefined) {
    throw new Error("Candidate append returned no decision suggestion");
  }
  const bundle = candidateBundle(
    appendedEvents,
    decisionEvent.payload.suggestionId,
  );
  if (bundle === undefined) {
    throw new Error("Candidate append returned an incomplete bundle");
  }
  return {
    candidate: candidateView(bundle),
    correlationId: decisionEvent.correlationId,
    kind: "candidate_prepared",
    position: decisionEvent.position,
    replayed: appended.kind === "replayed",
  };
}

function materializedEvents(
  dependencies: DecisionCandidateDependencies,
  context: UserAuthorizationContext,
  input: DispositionDecisionCandidateInput,
  bundle: CandidateBundle,
  occurredAt: ReturnType<typeof timestamp>,
  commandCorrelation: ReturnType<typeof correlationId>,
): {
  readonly actions: readonly Action[];
  readonly dissent: readonly Dissent[];
  readonly events: readonly DomainEvent[];
  readonly premises: readonly Premise[];
} {
  const actor = {
    kind: "participant" as const,
    participantId: participantId(context.participantId),
  };
  const common = {
    actor,
    correlationId: commandCorrelation,
    meetingId: meetingId(input.meetingId),
    occurredAt,
    schemaVersion: schemaVersion(1),
    visibility: "shared" as const,
  };
  const premises = input.premiseDispositions.flatMap((disposition) => {
    if (disposition.disposition !== "confirmed") {
      return [];
    }
    if (disposition.premise === undefined) {
      throw new DomainValueError(
        "Confirmed premise disposition requires premise content",
      );
    }
    return [
      createPremise({
        confirmationStatus: "confirmed",
        createdAt: occurredAt,
        createdBy: participantId(context.participantId),
        dependencyScope: [nonEmptyText(bundle.decisionEvent.payload.statement)],
        id: premiseId(dependencies.ids.next("premise")),
        meetingId: meetingId(input.meetingId),
        origin: "human_input",
        revision: revisionNumber(1),
        statement: nonEmptyText(disposition.premise.statement),
        visibility: "shared",
      }),
    ];
  });
  const dissent = input.dissent.map((entry) =>
    createDissent({
      confirmationStatus: "confirmed",
      createdAt: occurredAt,
      createdBy: participantId(context.participantId),
      id: dissentId(dependencies.ids.next("dissent")),
      meetingId: meetingId(input.meetingId),
      origin: "human_input",
      participantId: participantId(context.participantId),
      reason: nonEmptyText(entry.reason),
      retained: entry.retained,
      revision: revisionNumber(1),
      visibility: "shared",
    }),
  );
  const actions = input.actions.map((entry) =>
    createAction({
      affectedPremiseIds: premises.map(({ id }) => id),
      confirmationStatus: "confirmed",
      createdAt: occurredAt,
      createdBy: participantId(context.participantId),
      id: actionId(dependencies.ids.next("action")),
      meetingId: meetingId(input.meetingId),
      origin: "human_input",
      ownerParticipantId: participantId(entry.ownerParticipantId),
      revision: revisionNumber(1),
      scope: entry.scope.map(nonEmptyText),
      status: "planned",
      visibility: "shared",
    }),
  );
  const premiseBySuggestion = new Map<string, Premise>();
  let confirmedIndex = 0;
  for (const disposition of input.premiseDispositions) {
    if (disposition.disposition === "confirmed") {
      premiseBySuggestion.set(
        disposition.candidateId,
        premises[confirmedIndex]!,
      );
      confirmedIndex += 1;
    }
  }
  const events: DomainEvent[] = [];
  for (const disposition of input.premiseDispositions) {
    if (disposition.disposition === "rejected") {
      events.push({
        ...common,
        eventId: eventId(dependencies.ids.next("event")),
        eventType: "InferenceRejected",
        payload: {
          ...(disposition.reason === undefined
            ? {}
            : { reason: nonEmptyText(disposition.reason) }),
          rejectedBy: participantId(context.participantId),
          suggestionId: suggestionId(disposition.candidateId),
        },
        position: meetingPosition(input.expectedPosition + events.length + 1),
      });
      continue;
    }
    const premise = premiseBySuggestion.get(disposition.candidateId);
    if (premise === undefined) {
      throw new DomainValueError("Confirmed premise was not materialized");
    }
    events.push({
      ...common,
      eventId: eventId(dependencies.ids.next("event")),
      eventType: "InferenceConfirmed",
      payload: {
        confirmedBy: participantId(context.participantId),
        result: { entity: premise, kind: "premise" },
        suggestionId: suggestionId(disposition.candidateId),
      },
      position: meetingPosition(input.expectedPosition + events.length + 1),
    });
  }
  dissent.forEach((entity, index) => {
    const suggestion = bundle.dissentEvents[index];
    if (suggestion === undefined) {
      throw new DomainValueError(
        "Dissent disposition count exceeds candidate count",
      );
    }
    events.push({
      ...common,
      eventId: eventId(dependencies.ids.next("event")),
      eventType: "InferenceConfirmed",
      payload: {
        confirmedBy: participantId(context.participantId),
        result: { entity, kind: "dissent" },
        suggestionId: suggestion.payload.suggestionId,
      },
      position: meetingPosition(input.expectedPosition + events.length + 1),
    });
  });
  actions.forEach((entity, index) => {
    const suggestion = bundle.actionEvents[index];
    if (suggestion === undefined) {
      throw new DomainValueError(
        "Action disposition count exceeds candidate count",
      );
    }
    events.push({
      ...common,
      eventId: eventId(dependencies.ids.next("event")),
      eventType: "InferenceConfirmed",
      payload: {
        confirmedBy: participantId(context.participantId),
        result: { entity, kind: "action" },
        suggestionId: suggestion.payload.suggestionId,
      },
      position: meetingPosition(input.expectedPosition + events.length + 1),
    });
  });
  const firstEvent = events[0];
  if (firstEvent !== undefined) {
    events[0] = {
      ...firstEvent,
      idempotencyKey: idempotencyKey(input.idempotencyKey),
    };
  }
  return { actions, dissent, events, premises };
}

export async function dispositionDecisionCandidate(
  dependencies: DecisionCandidateDependencies,
  context: UserAuthorizationContext,
  input: DispositionDecisionCandidateInput,
): Promise<DispositionDecisionCandidateResult> {
  const authorizationFailure = authorizeFacilitator(context, input);
  if (authorizationFailure !== undefined) {
    return authorizationFailure;
  }
  let fingerprint: string;
  try {
    meetingId(input.meetingId);
    meetingPosition(input.expectedPosition);
    idempotencyKey(input.idempotencyKey);
    suggestionId(input.candidateId);
    fingerprint = await hashValue(dependencies.hash, {
      actions: input.actions,
      candidateId: input.candidateId,
      command: "disposition-decision-candidate",
      dissent: input.dissent,
      meetingId: input.meetingId,
      premiseDispositions: input.premiseDispositions,
    });
  } catch (error) {
    if (error instanceof DomainValueError) {
      return failed("VALIDATION_FAILED");
    }
    throw error;
  }
  const loaded = await loadState(dependencies, input.meetingId);
  const bundle = candidateBundle(
    privateSuggestionEvents(loaded.records, context.participantId),
    input.candidateId,
  );
  if (bundle === undefined) {
    return failed("CANDIDATE_NOT_FOUND");
  }
  const expectedPremiseIds = new Set<string>(
    bundle.premiseEvents.map(({ payload }) => payload.suggestionId),
  );
  const actualPremiseIds = input.premiseDispositions.map(
    ({ candidateId }) => candidateId,
  );
  const hasConfirmedPremise = input.premiseDispositions.some(
    ({ disposition }) => disposition === "confirmed",
  );
  if (
    actualPremiseIds.length !== expectedPremiseIds.size ||
    new Set(actualPremiseIds).size !== actualPremiseIds.length ||
    !actualPremiseIds.every((id) => expectedPremiseIds.has(id)) ||
    (hasConfirmedPremise
      ? input.dissent.length !== bundle.dissentEvents.length ||
        input.actions.length !== bundle.actionEvents.length
      : input.dissent.length > 0 || input.actions.length > 0)
  ) {
    return failed("VALIDATION_FAILED");
  }
  const participantIds = new Set(
    await dependencies.listParticipantIds(input.meetingId),
  );
  const evidenceIds = new Set<string>(
    loaded.projection.shared.evidence.map(({ id }) => id),
  );
  if (
    !input.actions.every(({ ownerParticipantId }) =>
      participantIds.has(ownerParticipantId),
    ) ||
    !input.premiseDispositions.every(
      (disposition) =>
        disposition.disposition === "rejected" ||
        (disposition.premise !== undefined &&
          disposition.premise.evidenceReferenceIds.length > 0 &&
          disposition.premise.evidenceReferenceIds.every((id) =>
            evidenceIds.has(id),
          )),
    )
  ) {
    return failed("REFERENCED_ENTITY_NOT_FOUND");
  }
  let materialized: ReturnType<typeof materializedEvents>;
  try {
    materialized = materializedEvents(
      dependencies,
      context,
      input,
      bundle,
      timestamp(dependencies.clock.now()),
      correlationId(
        input.correlationId ?? dependencies.ids.next("correlation"),
      ),
    );
  } catch (error) {
    if (error instanceof DomainValueError) {
      return failed("VALIDATION_FAILED");
    }
    throw error;
  }
  const appended = await dependencies.events.append({
    events: materialized.events,
    expectedPosition: input.expectedPosition,
    idempotencyKey: input.idempotencyKey,
    meetingId: input.meetingId,
    payloadFingerprint: fingerprint,
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
  await refreshProjection(dependencies, input.meetingId, context.participantId);
  const replayedEvents = normalizeRecords(appended.records);
  const premises = replayedEvents.flatMap((event) =>
    event.eventType === "InferenceConfirmed" &&
    event.payload.result.kind === "premise"
      ? [event.payload.result.entity]
      : [],
  );
  const dissent = replayedEvents.flatMap((event) =>
    event.eventType === "InferenceConfirmed" &&
    event.payload.result.kind === "dissent"
      ? [event.payload.result.entity]
      : [],
  );
  const actions = replayedEvents.flatMap((event) =>
    event.eventType === "InferenceConfirmed" &&
    event.payload.result.kind === "action"
      ? [event.payload.result.entity]
      : [],
  );
  return {
    actions,
    candidateId: input.candidateId,
    correlationId:
      replayedEvents[0]?.correlationId ??
      correlationId(input.correlationId ?? "missing-correlation"),
    dissent,
    kind: "candidate_disposed",
    position:
      replayedEvents.at(-1)?.position ??
      meetingPosition(input.expectedPosition),
    premiseDispositions: input.premiseDispositions.map(
      ({ candidateId, disposition }) => ({ candidateId, disposition }),
    ),
    premises,
    replayed: appended.kind === "replayed",
  };
}
