import { describe, expect, it } from "vitest";

import {
  confirmInvalidationReview,
  rejectInvalidationReview,
  reviewInvalidation,
  type InvalidationReviewDependencies,
} from "../../../packages/application/src/index.js";
import { userAuthorizationContext } from "../../../packages/application/src/sessions.js";
import {
  actionId,
  contentHash,
  createDecisionRevision,
  createExternalEvent,
  createPremise,
  externalEventId,
  monitorRegistrationId,
  nonEmptyText,
  promptVersion,
  revisionNumber,
  sourceReferenceId,
  suggestionId,
  timestamp,
  transitionDecision,
  type Action,
  type DomainEvent,
  type MeetingProjection,
} from "../../../packages/domain/src/index.js";
import {
  MutableClock,
  SequenceIdGenerator,
} from "../../helpers/application-adapters.js";
import {
  InMemoryEventStore,
  InMemoryProjectionStore,
} from "../../helpers/in-memory-ports.js";
import {
  action,
  firstRevision,
  flagshipDecision,
  ids,
  sharedEvent,
} from "../domain/fixtures.js";

const OCCURRED_AT = timestamp("2026-07-20T09:02:00.000Z");
const EXTERNAL_EVENT_ID = externalEventId("external-event-review");
const EXTERNAL_REFERENCE = sourceReferenceId(
  "https://example.invalid/regulation/review",
);
const SUGGESTION_ID = suggestionId("suggestion-invalidation-review");
const COMPLETED_ACTION_ID = actionId("action-completed");
const HELD_ACTION_ID = actionId("action-already-held");
const UNLINKED_ACTION_ID = actionId("action-unlinked");
const ALL_ACTION_IDS = [
  ids.actionEurope,
  ids.actionUs,
  COMPLETED_ACTION_ID,
  HELD_ACTION_ID,
  UNLINKED_ACTION_ID,
] as const;

function stableFixtureHash(value: string): string {
  let hash = 2_166_136_261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return `fixture-${(hash >>> 0).toString(16)}`;
}

function facilitatorContext(meetingScope: string = ids.meeting) {
  return userAuthorizationContext({
    meetingId: meetingScope,
    participantId: ids.facilitator,
    role: "facilitator",
    sessionId: "session-facilitator",
    userId: "user-facilitator",
  });
}

function participantContext() {
  return userAuthorizationContext({
    meetingId: ids.meeting,
    participantId: ids.legal,
    role: "participant",
    sessionId: "session-participant",
    userId: "user-participant",
  });
}

interface FixtureOptions {
  readonly atRiskActionIds?: readonly Action["id"][];
  readonly omitActionId?: Action["id"];
}

interface Fixture {
  readonly committedRevision: ReturnType<typeof createDecisionRevision>;
  readonly dependencies: InvalidationReviewDependencies;
  readonly events: InMemoryEventStore<DomainEvent>;
  readonly expectedPosition: number;
  readonly projections: InMemoryProjectionStore<MeetingProjection>;
}

async function fixture(options: FixtureOptions = {}): Promise<Fixture> {
  const events = new InMemoryEventStore<DomainEvent>();
  const projections = new InMemoryProjectionStore<MeetingProjection>();
  const dependencies: InvalidationReviewDependencies = {
    clock: new MutableClock(OCCURRED_AT),
    events,
    hash: stableFixtureHash,
    ids: new SequenceIdGenerator(),
    projections,
  };
  const premise = createPremise({
    confirmationStatus: "confirmed",
    createdAt: timestamp("2026-07-19T00:01:00.000Z"),
    createdBy: ids.facilitator,
    dependencyScope: [nonEmptyText("Europe rollout")],
    id: ids.premiseEurope,
    meetingId: ids.meeting,
    monitorCondition: {
      description: nonEmptyText("Monitor European regulatory changes"),
    },
    origin: "ai_inference",
    revision: revisionNumber(1),
    statement: nonEmptyText(
      "The current European rollout remains legally permitted",
    ),
    visibility: "shared",
  });
  const actions = [
    action(ids.actionEurope, ids.premiseEurope, "Europe active"),
    action(ids.actionUs, ids.premiseEurope, "Europe planned", {
      status: "planned",
    }),
    action(COMPLETED_ACTION_ID, ids.premiseEurope, "Already completed", {
      status: "completed",
    }),
    action(HELD_ACTION_ID, ids.premiseEurope, "Already held", {
      holdReason: nonEmptyText("Earlier hold"),
      revision: revisionNumber(2),
      status: "held",
    }),
    action(UNLINKED_ACTION_ID, ids.premiseUs, "Unlinked active"),
  ] as const;
  const committedDecision = flagshipDecision("COMMITTED", {
    actionIds: ALL_ACTION_IDS,
    dissentIds: [],
  });
  const monitoringDecision = transitionDecision(committedDecision, {
    authority: { kind: "system" },
    monitorRegistrationId: monitorRegistrationId("monitor-review"),
    to: "MONITORING",
  });
  const baseRevision = firstRevision("COMMITTED");
  const committedRevision = createDecisionRevision({
    ...baseRevision,
    snapshot: {
      ...baseRevision.snapshot,
      actionIds: ALL_ACTION_IDS,
      dissentIds: [],
    },
  });
  const externalEvent = createExternalEvent({
    confirmationStatus: "not_applicable",
    createdAt: timestamp("2026-07-20T09:00:00.000Z"),
    createdBy: "system",
    description: nonEmptyText("A synthetic regulation changes the rollout."),
    effectiveAt: timestamp("2026-08-01T00:00:00.000Z"),
    eventType: nonEmptyText("regulatory_change"),
    id: EXTERNAL_EVENT_ID,
    jurisdiction: nonEmptyText("European Union"),
    meetingId: ids.meeting,
    monitorRegistrationId: monitorRegistrationId("monitor-review"),
    origin: "system",
    payloadHash: contentHash("sha256:review-event"),
    receivedAt: timestamp("2026-07-20T09:00:00.000Z"),
    revision: revisionNumber(1),
    schemaVersion: revisionNumber(1),
    signatureResult: "valid",
    source: nonEmptyText("Synthetic regulator feed"),
    sourceReference: nonEmptyText(EXTERNAL_REFERENCE),
    visibility: "shared",
  });
  const affectedActionIds = [...ALL_ACTION_IDS];
  const atRiskActionIds = options.atRiskActionIds ?? affectedActionIds;
  const atRiskDecision = transitionDecision(monitoringDecision, {
    affectedActionIds: atRiskActionIds,
    affectedPremiseIds: [ids.premiseEurope],
    authority: { kind: "system" },
    invalidationSuggestionRecorded: true,
    suggestionReferenceIds: [EXTERNAL_REFERENCE],
    to: "AT_RISK",
  });
  const seededEvents: DomainEvent[] = [
    sharedEvent("InferenceConfirmed", 1, {
      confirmedBy: ids.facilitator,
      result: { entity: premise, kind: "premise" },
      suggestionId: suggestionId("suggestion-premise-review"),
    }),
    ...actions
      .filter(({ id }) => id !== options.omitActionId)
      .map((candidate, index) =>
        sharedEvent("InferenceConfirmed", index + 2, {
          confirmedBy: ids.facilitator,
          result: { entity: candidate, kind: "action" },
          suggestionId: suggestionId(
            `suggestion-action-review-${String(index)}`,
          ),
        }),
      ),
  ];
  let position = seededEvents.length;
  seededEvents.push(
    sharedEvent("DecisionCommitted", ++position, {
      decision: committedDecision,
      revision: committedRevision,
    }),
    sharedEvent("MonitoringStarted", ++position, {
      decision: monitoringDecision,
      monitorRegistrationId: monitorRegistrationId("monitor-review"),
    }),
    sharedEvent("ExternalEventReceived", ++position, { externalEvent }),
    sharedEvent("AssumptionInvalidationSuggested", ++position, {
      activeRevisionId: monitoringDecision.activeRevisionId,
      affectedActionIds,
      affectedPremiseIds: [ids.premiseEurope],
      decisionId: monitoringDecision.id,
      evidenceReferenceIds: [EXTERNAL_REFERENCE],
      externalEventId: externalEvent.id,
      metadata: {
        confidence: 0.94,
        inputReferenceIds: [EXTERNAL_REFERENCE],
        model: nonEmptyText("gpt-5.6"),
        promptVersion: promptVersion("assumption-invalidation-v1"),
        reason: nonEmptyText("The monitored legal premise may no longer hold."),
      },
      provenance: {
        generatedAt: timestamp("2026-07-20T09:00:01.000Z"),
        operation: nonEmptyText("assumption_invalidation"),
        outputSchemaVersion: nonEmptyText("1"),
      },
      suggestionId: SUGGESTION_ID,
    }),
    sharedEvent("DecisionMarkedAtRisk", ++position, {
      affectedActionIds: atRiskActionIds,
      affectedPremiseIds: [ids.premiseEurope],
      decision: atRiskDecision,
      suggestionId: SUGGESTION_ID,
    }),
  );
  const seeded = await events.append({
    events: seededEvents,
    expectedPosition: 0,
    meetingId: ids.meeting,
  });
  if (seeded.kind !== "appended") {
    throw new Error("Invalidation review fixture failed");
  }
  return {
    committedRevision,
    dependencies,
    events,
    expectedPosition: position,
    projections,
  };
}

function confirmInput(expectedPosition: number) {
  return {
    correlationId: "correlation-confirm-review",
    decisionId: ids.decision,
    expectedPosition,
    idempotencyKey: "confirm-invalidation-review",
    meetingId: ids.meeting,
    reason: "The new regulation materially invalidates the premise.",
    suggestionId: SUGGESTION_ID,
  } as const;
}

function rejectInput(expectedPosition: number) {
  return {
    correlationId: "correlation-reject-review",
    decisionId: ids.decision,
    expectedPosition,
    idempotencyKey: "reject-invalidation-review",
    meetingId: ids.meeting,
    reason: "The cited change does not apply to this rollout.",
    suggestionId: SUGGESTION_ID,
  } as const;
}

describe("invalidation review application flow", () => {
  it("atomically confirms the exact suggestion, holds only linked active/planned Actions, and creates a task", async () => {
    const {
      committedRevision,
      dependencies,
      events,
      expectedPosition,
      projections,
    } = await fixture();
    const immutableRevision = structuredClone(committedRevision);

    const result = await confirmInvalidationReview(
      dependencies,
      facilitatorContext(),
      confirmInput(expectedPosition),
    );

    expect(result).toMatchObject({
      correlationId: "correlation-confirm-review",
      decision: {
        activeRevision: committedRevision.version,
        activeRevisionId: committedRevision.id,
        status: "REVIEW_REQUIRED",
      },
      disposition: "confirm_invalidation",
      heldActionIds: [ids.actionEurope, ids.actionUs],
      heldActions: [
        {
          holdReason: "The new regulation materially invalidates the premise.",
          id: ids.actionEurope,
          revision: 2,
          status: "held",
        },
        {
          holdReason: "The new regulation materially invalidates the premise.",
          id: ids.actionUs,
          revision: 2,
          status: "held",
        },
      ],
      kind: "review_required",
      position: expectedPosition + 4,
      reconsiderationTask: {
        affectedActionIds: ALL_ACTION_IDS,
        affectedPremiseIds: [ids.premiseEurope],
        decisionId: ids.decision,
        id: "reconsideration-task-1",
        ownerParticipantId: ids.facilitator,
        state: "open",
        triggerExternalEventId: EXTERNAL_EVENT_ID,
      },
      replayed: false,
      reviewEventId: "event-1",
      reviewReason: "The new regulation materially invalidates the premise.",
      suggestionId: SUGGESTION_ID,
    });

    const records = await events.load(ids.meeting);
    const appended = records.slice(expectedPosition);
    expect(appended.map(({ event }) => event.eventType)).toEqual([
      "FacilitatorReviewed",
      "DecisionReviewRequired",
      "ActionHeld",
      "ReconsiderationTaskCreated",
    ]);
    const [reviewedRecord, requiredRecord, heldRecord, taskRecord] = appended;
    expect(reviewedRecord?.event).toMatchObject({
      actor: { kind: "participant", participantId: ids.facilitator },
      causationId: `DecisionMarkedAtRisk-${String(expectedPosition)}`,
      correlationId: "correlation-confirm-review",
      idempotencyKey: "confirm-invalidation-review",
      payload: {
        decision: { status: "REVIEW_REQUIRED" },
        disposition: "confirm_invalidation",
        facilitatorParticipantId: ids.facilitator,
        reviewedActionIds: ALL_ACTION_IDS,
        reviewedEvidenceReferenceIds: [EXTERNAL_REFERENCE],
        reviewedPremiseIds: [ids.premiseEurope],
      },
    });
    expect(requiredRecord?.event).toMatchObject({
      actor: { kind: "system" },
      causationId: reviewedRecord?.event.eventId,
      payload: {
        heldActionIds: [ids.actionEurope, ids.actionUs],
        reconsiderationTaskId: "reconsideration-task-1",
      },
    });
    expect(heldRecord?.event).toMatchObject({
      causationId: requiredRecord?.event.eventId,
      payload: {
        actions: [
          { id: ids.actionEurope, status: "held" },
          { id: ids.actionUs, status: "held" },
        ],
      },
    });
    expect(taskRecord?.event).toMatchObject({
      causationId: requiredRecord?.event.eventId,
      payload: { task: { id: "reconsideration-task-1" } },
    });

    const projection = await projections.get({
      meetingId: ids.meeting,
      ownerParticipantId: ids.facilitator,
      projection: "meeting",
    });
    expect(projection?.shared.decisions[0]?.status).toBe("REVIEW_REQUIRED");
    expect(
      projection?.shared.actions.map(({ id, status }) => ({ id, status })),
    ).toEqual([
      { id: ids.actionEurope, status: "held" },
      { id: ids.actionUs, status: "held" },
      { id: COMPLETED_ACTION_ID, status: "completed" },
      { id: HELD_ACTION_ID, status: "held" },
      { id: UNLINKED_ACTION_ID, status: "active" },
    ]);
    expect(projection?.shared.reconsiderationTasks).toHaveLength(1);
    expect(projection?.shared.decisionRevisions).toEqual([immutableRevision]);
    expect(committedRevision).toEqual(immutableRevision);
  });

  it("rejects with a required audit reason and returns the Decision to MONITORING through FacilitatorReviewed", async () => {
    const { dependencies, events, expectedPosition, projections } =
      await fixture();

    const result = await rejectInvalidationReview(
      dependencies,
      facilitatorContext(),
      rejectInput(expectedPosition),
    );

    expect(result).toMatchObject({
      correlationId: "correlation-reject-review",
      decision: { status: "MONITORING" },
      disposition: "reject_suggestion",
      kind: "suggestion_rejected",
      position: expectedPosition + 1,
      replayed: false,
      reviewReason: "The cited change does not apply to this rollout.",
      suggestionId: SUGGESTION_ID,
    });
    const appended = (await events.load(ids.meeting)).slice(expectedPosition);
    expect(appended).toHaveLength(1);
    expect(appended[0]?.event).toMatchObject({
      actor: { kind: "participant", participantId: ids.facilitator },
      eventType: "FacilitatorReviewed",
      payload: {
        decision: { status: "MONITORING" },
        disposition: "reject_suggestion",
        reason: "The cited change does not apply to this rollout.",
        reviewedActionIds: ALL_ACTION_IDS,
        reviewedEvidenceReferenceIds: [EXTERNAL_REFERENCE],
        reviewedPremiseIds: [ids.premiseEurope],
      },
    });
    expect(
      appended.some(
        ({ event }) =>
          event.eventType === "DecisionReviewRequired" ||
          event.eventType === "ActionHeld" ||
          event.eventType === "ReconsiderationTaskCreated",
      ),
    ).toBe(false);
    const projection = await projections.get({
      meetingId: ids.meeting,
      ownerParticipantId: ids.facilitator,
      projection: "meeting",
    });
    expect(projection?.shared.decisions[0]?.status).toBe("MONITORING");
    expect(
      projection?.shared.actions.every(({ status }) => status !== "held"),
    ).toBe(false);
    expect(projection?.shared.reconsiderationTasks).toEqual([]);
  });

  it("exposes a disposition-based facade without weakening the command semantics", async () => {
    const { dependencies, expectedPosition } = await fixture();

    await expect(
      reviewInvalidation(dependencies, facilitatorContext(), {
        ...rejectInput(expectedPosition),
        disposition: "reject_suggestion",
      }),
    ).resolves.toMatchObject({
      decision: { status: "MONITORING" },
      disposition: "reject_suggestion",
      kind: "suggestion_rejected",
    });
  });

  it("requires facilitator role, capability, and matching meeting scope before loading or appending", async () => {
    const { dependencies, events, expectedPosition } = await fixture();
    const input = confirmInput(expectedPosition);
    const missingCapability = {
      ...facilitatorContext(),
      capabilities: new Set(["meeting:read"] as const),
    };

    await expect(
      confirmInvalidationReview(dependencies, participantContext(), input),
    ).resolves.toEqual({ code: "FORBIDDEN", kind: "failed" });
    await expect(
      confirmInvalidationReview(dependencies, missingCapability, input),
    ).resolves.toEqual({ code: "FORBIDDEN", kind: "failed" });
    await expect(
      confirmInvalidationReview(
        dependencies,
        facilitatorContext("meeting-other"),
        input,
      ),
    ).resolves.toEqual({ code: "FORBIDDEN", kind: "failed" });
    expect(await events.position(ids.meeting)).toBe(expectedPosition);
  });

  it("rejects missing, stale, or structurally mismatched suggestions without appending", async () => {
    const missing = await fixture();
    await expect(
      confirmInvalidationReview(missing.dependencies, facilitatorContext(), {
        ...confirmInput(missing.expectedPosition),
        suggestionId: "suggestion-missing",
      }),
    ).resolves.toEqual({
      code: "SUGGESTION_NOT_FOUND",
      kind: "failed",
    });

    const mismatched = await fixture({
      atRiskActionIds: [ids.actionEurope],
    });
    await expect(
      confirmInvalidationReview(
        mismatched.dependencies,
        facilitatorContext(),
        confirmInput(mismatched.expectedPosition),
      ),
    ).resolves.toEqual({
      code: "SUGGESTION_MISMATCH",
      kind: "failed",
    });
    expect(await missing.events.position(ids.meeting)).toBe(
      missing.expectedPosition,
    );
    expect(await mismatched.events.position(ids.meeting)).toBe(
      mismatched.expectedPosition,
    );
  });

  it("rejects a suggestion whose current Decision references cannot be rebuilt", async () => {
    const state = await fixture({ omitActionId: COMPLETED_ACTION_ID });

    await expect(
      confirmInvalidationReview(
        state.dependencies,
        facilitatorContext(),
        confirmInput(state.expectedPosition),
      ),
    ).resolves.toEqual({
      code: "REFERENCED_ENTITY_NOT_FOUND",
      kind: "failed",
    });
    expect(await state.events.position(ids.meeting)).toBe(
      state.expectedPosition,
    );
  });

  it("validates IDs and nonempty reject reasons before mutation", async () => {
    const { dependencies, events, expectedPosition } = await fixture();

    await expect(
      rejectInvalidationReview(dependencies, facilitatorContext(), {
        ...rejectInput(expectedPosition),
        reason: "   ",
      }),
    ).resolves.toEqual({ code: "VALIDATION_FAILED", kind: "failed" });
    await expect(
      rejectInvalidationReview(dependencies, facilitatorContext(), {
        ...rejectInput(expectedPosition),
        decisionId: " ",
      }),
    ).resolves.toEqual({ code: "VALIDATION_FAILED", kind: "failed" });
    expect(await events.position(ids.meeting)).toBe(expectedPosition);
  });

  it("reports optimistic concurrency conflicts without a partial append", async () => {
    const { dependencies, events, expectedPosition } = await fixture();

    await expect(
      confirmInvalidationReview(
        dependencies,
        facilitatorContext(),
        confirmInput(expectedPosition - 1),
      ),
    ).resolves.toEqual({
      actualPosition: expectedPosition,
      code: "CONFLICT",
      expectedPosition: expectedPosition - 1,
      kind: "failed",
    });
    expect(await events.position(ids.meeting)).toBe(expectedPosition);
  });

  it("replays the exact atomic command and rejects fingerprint or disposition reuse", async () => {
    const { dependencies, events, expectedPosition } = await fixture();
    const input = confirmInput(expectedPosition);

    const first = await confirmInvalidationReview(
      dependencies,
      facilitatorContext(),
      input,
    );
    const replayed = await confirmInvalidationReview(
      dependencies,
      facilitatorContext(),
      input,
    );
    expect(first).toMatchObject({ kind: "review_required", replayed: false });
    expect(replayed).toEqual(
      first.kind === "review_required" ? { ...first, replayed: true } : first,
    );
    expect(await events.position(ids.meeting)).toBe(expectedPosition + 4);

    await expect(
      confirmInvalidationReview(dependencies, facilitatorContext(), {
        ...input,
        reason: "A different semantic review reason.",
      }),
    ).resolves.toEqual({
      code: "IDEMPOTENCY_CONFLICT",
      kind: "failed",
    });
    await expect(
      rejectInvalidationReview(dependencies, facilitatorContext(), {
        ...input,
        reason: "Reject instead.",
      }),
    ).resolves.toEqual({
      code: "IDEMPOTENCY_CONFLICT",
      kind: "failed",
    });
    expect(await events.position(ids.meeting)).toBe(expectedPosition + 4);
  });
});
