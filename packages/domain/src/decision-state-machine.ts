import type {
  Action,
  Decision,
  DecisionReadiness,
  DecisionRevision,
  DecisionSnapshot,
  DecisionStatus,
  ReconsiderationTask,
} from "./entities.js";
import {
  createAction,
  createDecision,
  createDecisionRevision,
  createReconsiderationTask,
} from "./entities.js";
import type {
  ActionId,
  DecisionId,
  DecisionRevisionId,
  ExternalEventId,
  NonEmptyText,
  ParticipantId,
  PremiseId,
  ReconsiderationTaskId,
  Timestamp,
} from "./values.js";
import { revisionNumber } from "./values.js";

export type DecisionAuthority =
  | {
      readonly kind: "facilitator";
      readonly participantId: ParticipantId;
    }
  | {
      readonly kind: "system";
    }
  | {
      readonly kind: "ai";
      readonly model: NonEmptyText;
    }
  | {
      readonly kind: "participant";
      readonly participantId: ParticipantId;
    };

export interface DecisionTransitionRequest {
  readonly to: DecisionStatus;
  readonly authority: DecisionAuthority;
  readonly readiness?: DecisionReadiness;
  readonly explicitCommit?: boolean;
  readonly monitorRegistrationSucceeded?: boolean;
  readonly invalidationSuggestionRecorded?: boolean;
  readonly suggestionReferenceIds?: readonly string[];
  readonly affectedPremiseIds?: readonly PremiseId[];
  readonly affectedActionIds?: readonly ActionId[];
  readonly reviewedPremiseIds?: readonly PremiseId[];
  readonly reviewedEvidenceReferenceIds?: readonly string[];
  readonly reviewedActionIds?: readonly ActionId[];
  readonly invalidationConfirmed?: boolean;
  readonly rejectionReason?: NonEmptyText;
  readonly revision?: DecisionRevision;
  readonly replacementDecisionId?: DecisionId;
}

export type TransitionMatrix = Readonly<
  Record<DecisionStatus, Readonly<Record<DecisionStatus, boolean>>>
>;

const statuses: readonly DecisionStatus[] = [
  "DRAFT",
  "DECISION_READY",
  "COMMITTED",
  "MONITORING",
  "AT_RISK",
  "REVIEW_REQUIRED",
  "SUPERSEDED",
  "REJECTED",
];

const validTargets: Readonly<
  Record<DecisionStatus, readonly DecisionStatus[]>
> = {
  DRAFT: ["DECISION_READY"],
  DECISION_READY: ["COMMITTED"],
  COMMITTED: ["MONITORING"],
  MONITORING: ["AT_RISK"],
  AT_RISK: ["MONITORING", "REVIEW_REQUIRED"],
  REVIEW_REQUIRED: ["COMMITTED", "SUPERSEDED", "REJECTED"],
  SUPERSEDED: [],
  REJECTED: [],
};

export const decisionTransitionMatrix: TransitionMatrix = Object.freeze(
  Object.fromEntries(
    statuses.map((from) => [
      from,
      Object.freeze(
        Object.fromEntries(
          statuses.map((to) => [to, validTargets[from].includes(to)]),
        ) as Record<DecisionStatus, boolean>,
      ),
    ]),
  ) as Record<DecisionStatus, Readonly<Record<DecisionStatus, boolean>>>,
);

export class DecisionTransitionError extends Error {
  readonly code:
    | "INVALID_STATE_TRANSITION"
    | "DECISION_AUTHORITY_REQUIRED"
    | "DECISION_CONDITION_REQUIRED";

  constructor(code: DecisionTransitionError["code"], message: string) {
    super(message);
    this.name = "DecisionTransitionError";
    this.code = code;
  }
}

function requireFacilitator(authority: DecisionAuthority): ParticipantId {
  if (authority.kind !== "facilitator") {
    throw new DecisionTransitionError(
      "DECISION_AUTHORITY_REQUIRED",
      "This Decision transition requires facilitator authority",
    );
  }
  return authority.participantId;
}

function requireSystem(authority: DecisionAuthority): void {
  if (authority.kind !== "system") {
    throw new DecisionTransitionError(
      "DECISION_AUTHORITY_REQUIRED",
      "This Decision transition requires deterministic system authority",
    );
  }
}

function requireCondition(
  condition: boolean,
  message: string,
): asserts condition {
  if (!condition) {
    throw new DecisionTransitionError("DECISION_CONDITION_REQUIRED", message);
  }
}

function readinessComplete(readiness: DecisionReadiness | undefined): boolean {
  return (
    readiness !== undefined &&
    readiness.outcome &&
    readiness.premiseIds &&
    readiness.evidenceIds &&
    readiness.actionIds &&
    readiness.monitorCondition
  );
}

function replaceDecisionStatus(
  decision: Decision,
  status: DecisionStatus,
  extra: Pick<Decision, "supersededByDecisionId"> | object = {},
): Decision {
  return createDecision({
    ...decision,
    ...extra,
    status,
  });
}

export function transitionDecision(
  decision: Decision,
  request: DecisionTransitionRequest,
): Decision {
  const { status: from } = decision;
  const { to } = request;

  if (!decisionTransitionMatrix[from][to]) {
    throw new DecisionTransitionError(
      "INVALID_STATE_TRANSITION",
      `Decision cannot transition from ${from} to ${to}`,
    );
  }

  if (to === "REVIEW_REQUIRED" && request.authority.kind === "ai") {
    throw new DecisionTransitionError(
      "DECISION_AUTHORITY_REQUIRED",
      "AI cannot enter REVIEW_REQUIRED; facilitator confirmation is required",
    );
  }

  if (from === "DRAFT" && to === "DECISION_READY") {
    requireFacilitator(request.authority);
    requireCondition(
      readinessComplete(request.readiness) &&
        decision.outcome.length > 0 &&
        decision.premiseIds.length > 0 &&
        decision.evidenceIds.length > 0 &&
        decision.actionIds.length > 0 &&
        decision.monitorCondition.description.length > 0,
      "Decision readiness requires outcome, premise, evidence, Action, and monitor fields",
    );
  } else if (from === "DECISION_READY" && to === "COMMITTED") {
    requireFacilitator(request.authority);
    requireCondition(
      request.explicitCommit === true,
      "Decision commitment must be explicit",
    );
  } else if (from === "COMMITTED" && to === "MONITORING") {
    requireSystem(request.authority);
    requireCondition(
      request.monitorRegistrationSucceeded === true,
      "Monitoring requires successful monitor registration",
    );
  } else if (from === "MONITORING" && to === "AT_RISK") {
    requireSystem(request.authority);
    requireCondition(
      request.invalidationSuggestionRecorded === true,
      "AT_RISK requires a recorded AI invalidation suggestion with references",
    );
    requireCondition(
      (request.suggestionReferenceIds?.length ?? 0) > 0 &&
        (request.affectedPremiseIds?.length ?? 0) > 0 &&
        (request.affectedActionIds?.length ?? 0) > 0,
      "AT_RISK requires referenced evidence, affected premises, and affected Actions",
    );
  } else if (from === "AT_RISK" && to === "REVIEW_REQUIRED") {
    requireFacilitator(request.authority);
    requireCondition(
      request.invalidationConfirmed === true,
      "REVIEW_REQUIRED requires facilitator confirmation",
    );
    requireCondition(
      (request.reviewedPremiseIds?.length ?? 0) > 0 &&
        (request.reviewedEvidenceReferenceIds?.length ?? 0) > 0 &&
        (request.reviewedActionIds?.length ?? 0) > 0,
      "Facilitator must review affected premises, evidence, and Actions",
    );
  } else if (from === "AT_RISK" && to === "MONITORING") {
    requireFacilitator(request.authority);
    requireCondition(
      request.rejectionReason !== undefined,
      "Rejecting an invalidation suggestion requires an audit reason",
    );
  } else if (from === "REVIEW_REQUIRED" && to === "COMMITTED") {
    const facilitatorId = requireFacilitator(request.authority);
    requireCondition(
      request.explicitCommit === true && request.revision !== undefined,
      "Recommit requires an explicit new Decision revision",
    );
    requireCondition(
      request.revision.decisionId === decision.id &&
        request.revision.version ===
          revisionNumber(decision.activeRevision + 1) &&
        request.revision.createdBy === facilitatorId &&
        request.revision.snapshot.status === "COMMITTED",
      "Recommit revision must be the next version for this Decision and facilitator",
    );
    return createDecision({
      ...decision,
      status: "COMMITTED",
      activeRevision: request.revision.version,
      activeRevisionId: request.revision.id,
      revision: request.revision.version,
      title: request.revision.snapshot.title,
      outcome: request.revision.snapshot.outcome,
      premiseIds: request.revision.snapshot.premiseIds,
      evidenceIds: request.revision.snapshot.evidenceIds,
      dissentIds: request.revision.snapshot.dissentIds,
      actionIds: request.revision.snapshot.actionIds,
      monitorCondition: request.revision.snapshot.monitorCondition,
    });
  } else if (from === "REVIEW_REQUIRED" && to === "SUPERSEDED") {
    requireFacilitator(request.authority);
    requireCondition(
      request.replacementDecisionId !== undefined &&
        request.replacementDecisionId !== decision.id,
      "Superseding requires a different replacement Decision",
    );
    return replaceDecisionStatus(decision, "SUPERSEDED", {
      supersededByDecisionId: request.replacementDecisionId,
    });
  } else if (from === "REVIEW_REQUIRED" && to === "REJECTED") {
    requireFacilitator(request.authority);
    requireCondition(
      request.rejectionReason !== undefined,
      "Rejecting a Decision requires an audit reason",
    );
  }

  return replaceDecisionStatus(decision, to);
}

export interface ActionHoldSelection {
  readonly affectedPremiseIds: readonly PremiseId[];
  readonly suggestedActionIds: readonly ActionId[];
  readonly holdReason: NonEmptyText;
}

export function selectActionsToHold(
  actions: readonly Action[],
  selection: ActionHoldSelection,
): readonly Action[] {
  const affectedPremises = new Set(selection.affectedPremiseIds);
  const suggestedActions = new Set(selection.suggestedActionIds);
  return actions.filter(
    (action) =>
      action.status !== "completed" &&
      action.status !== "held" &&
      suggestedActions.has(action.id) &&
      action.affectedPremiseIds.some((id) => affectedPremises.has(id)),
  );
}

export function holdAffectedActions(
  actions: readonly Action[],
  selection: ActionHoldSelection,
): readonly Action[] {
  const selected = new Set(
    selectActionsToHold(actions, selection).map(({ id }) => id),
  );
  return actions.map((action) =>
    selected.has(action.id)
      ? createAction({
          ...action,
          status: "held",
          holdReason: selection.holdReason,
          revision: revisionNumber(action.revision + 1),
        })
      : action,
  );
}

export interface NewDecisionRevisionInput {
  readonly id: DecisionRevisionId;
  readonly changeReason: NonEmptyText;
  readonly createdAt: Timestamp;
  readonly createdBy: ParticipantId;
  readonly snapshot: DecisionSnapshot;
}

export function nextDecisionRevision(
  decision: Decision,
  input: NewDecisionRevisionInput,
): DecisionRevision {
  return createDecisionRevision({
    id: input.id,
    meetingId: decision.meetingId,
    visibility: "shared",
    origin: "human_input",
    confirmationStatus: "confirmed",
    revision: revisionNumber(decision.activeRevision + 1),
    decisionId: decision.id,
    version: revisionNumber(decision.activeRevision + 1),
    previousRevisionId: decision.activeRevisionId,
    snapshot: input.snapshot,
    changeReason: input.changeReason,
    createdAt: input.createdAt,
    createdBy: input.createdBy,
  });
}

export function appendDecisionRevision(
  history: readonly DecisionRevision[],
  revision: DecisionRevision,
): readonly DecisionRevision[] {
  const existing = history.find(({ id }) => id === revision.id);
  if (existing !== undefined) {
    if (sameDecisionRevision(existing, revision)) {
      return history;
    }
    throw new DecisionTransitionError(
      "DECISION_CONDITION_REQUIRED",
      "Decision revision ID conflicts with existing history",
    );
  }
  const latest = history
    .filter(({ decisionId }) => decisionId === revision.decisionId)
    .at(-1);
  const expectedVersion = revisionNumber((latest?.version ?? 0) + 1);
  requireCondition(
    revision.version === expectedVersion &&
      revision.previousRevisionId === latest?.id,
    "Decision revisions must append in version order without replacing history",
  );
  return [...history, createDecisionRevision(revision)];
}

function sameValues<Value>(
  left: readonly Value[],
  right: readonly Value[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function sameDecisionRevision(
  left: DecisionRevision,
  right: DecisionRevision,
): boolean {
  return (
    left.id === right.id &&
    left.meetingId === right.meetingId &&
    left.decisionId === right.decisionId &&
    left.version === right.version &&
    left.previousRevisionId === right.previousRevisionId &&
    left.snapshot.title === right.snapshot.title &&
    left.snapshot.outcome === right.snapshot.outcome &&
    left.snapshot.status === right.snapshot.status &&
    sameValues(left.snapshot.premiseIds, right.snapshot.premiseIds) &&
    sameValues(left.snapshot.evidenceIds, right.snapshot.evidenceIds) &&
    sameValues(left.snapshot.dissentIds, right.snapshot.dissentIds) &&
    sameValues(left.snapshot.actionIds, right.snapshot.actionIds) &&
    left.snapshot.monitorCondition.description ===
      right.snapshot.monitorCondition.description &&
    left.snapshot.monitorCondition.registrationId ===
      right.snapshot.monitorCondition.registrationId &&
    left.changeReason === right.changeReason &&
    left.createdAt === right.createdAt &&
    left.createdBy === right.createdBy &&
    left.origin === right.origin &&
    left.confirmationStatus === right.confirmationStatus &&
    left.revision === right.revision
  );
}

export interface NewReconsiderationTaskInput {
  readonly id: ReconsiderationTaskId;
  readonly meetingId: Decision["meetingId"];
  readonly decisionId: DecisionId;
  readonly triggerExternalEventId: ExternalEventId;
  readonly ownerParticipantId: ParticipantId;
  readonly affectedPremiseIds: readonly PremiseId[];
  readonly affectedActionIds: readonly ActionId[];
  readonly createdAt: Timestamp;
}

export function newReconsiderationTask(
  input: NewReconsiderationTaskInput,
): ReconsiderationTask {
  return createReconsiderationTask({
    ...input,
    visibility: "shared",
    origin: "system",
    confirmationStatus: "not_applicable",
    createdBy: "system",
    state: "open",
    revision: revisionNumber(1),
  });
}

export function reviseReconsiderationTask(
  task: ReconsiderationTask,
  state: ReconsiderationTask["state"],
): ReconsiderationTask {
  if (task.state === state) {
    return task;
  }
  const allowed =
    (task.state === "open" &&
      (state === "in_progress" || state === "cancelled")) ||
    (task.state === "in_progress" &&
      (state === "completed" || state === "cancelled"));
  if (!allowed) {
    throw new DecisionTransitionError(
      "INVALID_STATE_TRANSITION",
      `ReconsiderationTask cannot transition from ${task.state} to ${state}`,
    );
  }
  return createReconsiderationTask({
    ...task,
    state,
    revision: revisionNumber(task.revision + 1),
  });
}
