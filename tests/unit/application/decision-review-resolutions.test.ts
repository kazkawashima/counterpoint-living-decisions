import { describe, expect, it } from "vitest";

import {
  recommitDecision,
  rejectDecision,
  supersedeDecision,
  type Capability,
  type DecisionReviewResolutionDependencies,
  type RecommitDecisionInput,
  type RejectDecisionInput,
  type SupersedeDecisionInput,
} from "../../../packages/application/src/index.js";
import { userAuthorizationContext } from "../../../packages/application/src/sessions.js";
import {
  artifactId,
  auditReferenceId,
  causationId,
  correlationId,
  createDecision,
  createDecisionRevision,
  createDissent,
  createEvidence,
  createPremise,
  decisionId,
  decisionRevisionId,
  dissentId,
  eventId,
  meetingPosition,
  monitorRegistrationId,
  nonEmptyText,
  replayMeeting,
  revisionNumber,
  schemaVersion,
  sourceReferenceId,
  suggestionId,
  textRange,
  timestamp,
  type DomainEvent,
  type DomainEventPayloads,
  type MeetingProjection,
  type SharedEventEnvelope,
  type SharedEventType,
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
} from "../domain/fixtures.js";

const RESOLUTION_AT = timestamp("2026-07-21T10:30:00.000Z");
const REPLACEMENT_DECISION_ID = decisionId("decision-replacement");
const REPLACEMENT_REVISION_ID = decisionRevisionId("revision-replacement-1");
const REVIEWED_EVENT_ID = eventId("event-facilitator-reviewed");
const REVIEW_REQUIRED_EVENT_ID = eventId("event-review-required");
const REVIEW_CORRELATION_ID = correlationId("correlation-review-required");
const REVIEW_SUGGESTION_ID = suggestionId("suggestion-review-resolution");
const REVIEW_REFERENCE_ID = sourceReferenceId(
  "https://example.invalid/review-resolution",
);
const DISSENT_ID = dissentId("dissent-1");

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

function sharedEvent<Type extends SharedEventType>(
  eventType: Type,
  position: number,
  payload: DomainEventPayloads[Type],
): SharedEventEnvelope<Type> {
  return {
    actor: { kind: "system" },
    correlationId: correlationId(`seed-correlation-${String(position)}`),
    eventId: eventId(`seed-event-${String(position)}`),
    eventType,
    meetingId: ids.meeting,
    occurredAt: timestamp("2026-07-20T09:00:00.000Z"),
    payload,
    position: meetingPosition(position),
    schemaVersion: schemaVersion(1),
    visibility: "shared",
  };
}

interface Fixture {
  readonly current: ReturnType<typeof flagshipDecision>;
  readonly dependencies: DecisionReviewResolutionDependencies;
  readonly events: InMemoryEventStore<DomainEvent>;
  readonly expectedPosition: number;
  readonly initialRevision: ReturnType<typeof firstRevision>;
  readonly projection: InMemoryProjectionStore<MeetingProjection>;
  readonly replacement: ReturnType<typeof createDecision>;
}

async function fixture(options?: {
  readonly omitReviewRequired?: boolean;
}): Promise<Fixture> {
  const events = new InMemoryEventStore<DomainEvent>();
  const projection = new InMemoryProjectionStore<MeetingProjection>();
  const dependencies: DecisionReviewResolutionDependencies = {
    clock: new MutableClock(RESOLUTION_AT),
    events,
    hash: stableFixtureHash,
    ids: new SequenceIdGenerator(),
    projections: projection,
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
    origin: "human_input",
    revision: revisionNumber(1),
    statement: nonEmptyText("The rollout remains legally permitted"),
    visibility: "shared",
  });
  const evidence = createEvidence({
    confirmationStatus: "confirmed",
    createdAt: timestamp("2026-07-19T00:02:00.000Z"),
    createdBy: ids.facilitator,
    disclosureAuditReferenceId: auditReferenceId("audit-review-resolution"),
    exactSnippet: nonEmptyText("Synthetic evidence supports the rollout."),
    id: ids.evidence,
    meetingId: ids.meeting,
    origin: "source_artifact",
    revision: revisionNumber(1),
    sourceArtifactId: artifactId("artifact-review-resolution"),
    sourceRange: textRange(0, 12),
    visibility: "shared",
  });
  const dissent = createDissent({
    confirmationStatus: "confirmed",
    createdAt: timestamp("2026-07-19T00:03:00.000Z"),
    createdBy: ids.legal,
    id: DISSENT_ID,
    meetingId: ids.meeting,
    origin: "human_input",
    participantId: ids.legal,
    reason: nonEmptyText("Keep a manual rollback gate"),
    retained: true,
    revision: revisionNumber(1),
    visibility: "shared",
  });
  const actions = [
    action(ids.actionEurope, ids.premiseEurope, "Europe rollout"),
    action(ids.actionUs, ids.premiseEurope, "US rollback preparation"),
  ] as const;
  const current = flagshipDecision("REVIEW_REQUIRED", {
    monitorCondition: {
      description: nonEmptyText("Monitor regulatory changes"),
      registrationId: monitorRegistrationId("monitor-review-resolution"),
    },
  });
  const initialRevision = createDecisionRevision({
    ...firstRevision("COMMITTED"),
    snapshot: {
      ...firstRevision("COMMITTED").snapshot,
      monitorCondition: {
        description: nonEmptyText("Monitor regulatory changes"),
      },
    },
  });
  const replacementRevision = createDecisionRevision({
    ...firstRevision("DRAFT"),
    decisionId: REPLACEMENT_DECISION_ID,
    id: REPLACEMENT_REVISION_ID,
    snapshot: {
      ...firstRevision("DRAFT").snapshot,
      title: nonEmptyText("Replacement rollout"),
    },
  });
  const replacement = createDecision({
    ...flagshipDecision("DRAFT"),
    activeRevisionId: REPLACEMENT_REVISION_ID,
    id: REPLACEMENT_DECISION_ID,
    title: replacementRevision.snapshot.title,
  });

  const seeded: DomainEvent[] = [
    sharedEvent("EvidenceShared", 1, { evidence }),
    sharedEvent("InferenceConfirmed", 2, {
      confirmedBy: ids.facilitator,
      result: { entity: premise, kind: "premise" },
      suggestionId: suggestionId("suggestion-premise-resolution"),
    }),
    sharedEvent("InferenceConfirmed", 3, {
      confirmedBy: ids.facilitator,
      result: { entity: dissent, kind: "dissent" },
      suggestionId: suggestionId("suggestion-dissent-resolution"),
    }),
    ...actions.map((candidate, index) =>
      sharedEvent("InferenceConfirmed", index + 4, {
        confirmedBy: ids.facilitator,
        result: { entity: candidate, kind: "action" },
        suggestionId: suggestionId(`suggestion-action-${String(index)}`),
      }),
    ),
    sharedEvent("DecisionCommitted", 6, {
      decision: flagshipDecision("COMMITTED"),
      revision: initialRevision,
    }),
    sharedEvent("DecisionDrafted", 7, {
      decision: replacement,
      revision: replacementRevision,
    }),
    {
      ...sharedEvent("FacilitatorReviewed", 8, {
        decision: current,
        decisionId: current.id,
        disposition: "confirm_invalidation",
        facilitatorParticipantId: ids.facilitator,
        reason: nonEmptyText("The premise is materially invalidated."),
        reviewedActionIds: current.actionIds,
        reviewedEvidenceReferenceIds: [REVIEW_REFERENCE_ID],
        reviewedPremiseIds: current.premiseIds,
        suggestionId: REVIEW_SUGGESTION_ID,
      }),
      actor: { kind: "participant", participantId: ids.facilitator },
      correlationId: REVIEW_CORRELATION_ID,
      eventId: REVIEWED_EVENT_ID,
    },
  ];
  if (!options?.omitReviewRequired) {
    seeded.push({
      ...sharedEvent("DecisionReviewRequired", 9, {
        decision: current,
        heldActionIds: current.actionIds,
        reconsiderationTaskId: ids.task,
        suggestionId: REVIEW_SUGGESTION_ID,
      }),
      causationId: causationId(REVIEWED_EVENT_ID),
      correlationId: REVIEW_CORRELATION_ID,
      eventId: REVIEW_REQUIRED_EVENT_ID,
    });
  }
  const result = await events.append({
    events: seeded,
    expectedPosition: 0,
    meetingId: ids.meeting,
  });
  if (result.kind !== "appended") {
    throw new Error("Decision review resolution fixture failed");
  }
  return {
    current,
    dependencies,
    events,
    expectedPosition: seeded.length,
    initialRevision,
    projection,
    replacement,
  };
}

function recommitInput(expectedPosition: number): RecommitDecisionInput {
  return {
    changeReason: "Revised after facilitator review",
    correlationId: "correlation-recommit-review",
    decisionId: ids.decision,
    expectedPosition,
    explicitCommit: true,
    idempotencyKey: "recommit-decision-review",
    meetingId: ids.meeting,
    monitorCondition: {
      description: "Monitor the revised rollout and rollback threshold",
    },
    outcome: "Proceed only after the revised legal gate is met",
    title: "Revised global rollout",
  };
}

function supersedeInput(expectedPosition: number): SupersedeDecisionInput {
  return {
    correlationId: "correlation-supersede-review",
    decisionId: ids.decision,
    expectedPosition,
    idempotencyKey: "supersede-decision-review",
    meetingId: ids.meeting,
    replacementDecisionId: REPLACEMENT_DECISION_ID,
  };
}

function rejectInput(expectedPosition: number): RejectDecisionInput {
  return {
    correlationId: "correlation-reject-decision",
    decisionId: ids.decision,
    expectedPosition,
    idempotencyKey: "reject-decision-review",
    meetingId: ids.meeting,
    reason: "The invalidated premise leaves no responsible recommit path.",
  };
}

async function storedProjection(
  value: Fixture,
): Promise<MeetingProjection | undefined> {
  return value.projection.get({
    meetingId: ids.meeting,
    ownerParticipantId: ids.facilitator,
    projection: "meeting",
  });
}

describe("Decision review resolution application flow", () => {
  it("recommits an explicit next revision while preserving canonical references and immutable history", async () => {
    const value = await fixture();
    const immutableCurrent = structuredClone(value.current);
    const immutableInitialRevision = structuredClone(value.initialRevision);

    const result = await recommitDecision(
      value.dependencies,
      facilitatorContext(),
      recommitInput(value.expectedPosition),
    );

    expect(result).toMatchObject({
      correlationId: "correlation-recommit-review",
      decision: {
        activeRevision: 2,
        actionIds: immutableCurrent.actionIds,
        dissentIds: immutableCurrent.dissentIds,
        evidenceIds: immutableCurrent.evidenceIds,
        monitorCondition: {
          description: "Monitor the revised rollout and rollback threshold",
        },
        outcome: "Proceed only after the revised legal gate is met",
        premiseIds: immutableCurrent.premiseIds,
        status: "COMMITTED",
        title: "Revised global rollout",
      },
      kind: "recommitted",
      position: value.expectedPosition + 1,
      replayed: false,
      resolutionEventId: "event-1",
      revision: {
        changeReason: "Revised after facilitator review",
        createdBy: ids.facilitator,
        decisionId: ids.decision,
        id: "decision-revision-1",
        previousRevisionId: ids.revision1,
        snapshot: {
          actionIds: immutableCurrent.actionIds,
          dissentIds: immutableCurrent.dissentIds,
          evidenceIds: immutableCurrent.evidenceIds,
          premiseIds: immutableCurrent.premiseIds,
          status: "COMMITTED",
        },
        version: 2,
      },
    });
    expect(value.current).toEqual(immutableCurrent);
    expect(value.initialRevision).toEqual(immutableInitialRevision);

    const records = await value.events.load(ids.meeting);
    expect(records.at(-1)?.event).toMatchObject({
      actor: { kind: "participant", participantId: ids.facilitator },
      causationId: REVIEW_REQUIRED_EVENT_ID,
      correlationId: "correlation-recommit-review",
      eventType: "DecisionRevisionCommitted",
      idempotencyKey: "recommit-decision-review",
    });
    const projection = await storedProjection(value);
    expect(projection?.shared.decisionRevisions.map(({ id }) => id)).toEqual([
      ids.revision1,
      REPLACEMENT_REVISION_ID,
      "decision-revision-1",
    ]);
    expect(
      projection?.shared.decisionRevisions.find(
        ({ id }) => id === "decision-revision-1",
      ),
    ).toMatchObject({
      previousRevisionId: ids.revision1,
      version: 2,
    });
    expect(
      projection?.shared.decisionRevisions.find(
        ({ id }) => id === ids.revision1,
      ),
    ).toEqual(immutableInitialRevision);
    expect(projection).toEqual(
      replayMeeting(
        ids.meeting,
        records.map(({ event, position }) => ({
          ...event,
          position: meetingPosition(position),
        })),
      ),
    );
  });

  it("supersedes only with a different canonical Decision and preserves both revision histories", async () => {
    const value = await fixture();
    const before = structuredClone(
      replayMeeting(
        ids.meeting,
        (await value.events.load(ids.meeting)).map(({ event, position }) => ({
          ...event,
          position: meetingPosition(position),
        })),
      ).shared.decisionRevisions,
    );

    const result = await supersedeDecision(
      value.dependencies,
      facilitatorContext(),
      supersedeInput(value.expectedPosition),
    );

    expect(result).toMatchObject({
      correlationId: "correlation-supersede-review",
      decision: {
        activeRevision: 1,
        activeRevisionId: ids.revision1,
        status: "SUPERSEDED",
        supersededByDecisionId: REPLACEMENT_DECISION_ID,
      },
      kind: "superseded",
      position: value.expectedPosition + 1,
      replacementDecisionId: REPLACEMENT_DECISION_ID,
      replayed: false,
      resolutionEventId: "event-1",
    });
    const records = await value.events.load(ids.meeting);
    expect(records.at(-1)?.event).toMatchObject({
      causationId: REVIEW_REQUIRED_EVENT_ID,
      eventType: "DecisionSuperseded",
      payload: {
        replacementDecisionId: REPLACEMENT_DECISION_ID,
      },
    });
    const projection = await storedProjection(value);
    expect(projection?.shared.decisionRevisions).toEqual(before);
    expect(
      projection?.shared.decisions.find(
        ({ id }) => id === REPLACEMENT_DECISION_ID,
      ),
    ).toEqual(value.replacement);
  });

  it("rejects only with a required audit reason and leaves the active revision immutable", async () => {
    const value = await fixture();
    const immutableInitialRevision = structuredClone(value.initialRevision);

    const result = await rejectDecision(
      value.dependencies,
      facilitatorContext(),
      rejectInput(value.expectedPosition),
    );

    expect(result).toMatchObject({
      correlationId: "correlation-reject-decision",
      decision: {
        activeRevision: 1,
        activeRevisionId: ids.revision1,
        status: "REJECTED",
      },
      kind: "rejected",
      position: value.expectedPosition + 1,
      reason: "The invalidated premise leaves no responsible recommit path.",
      replayed: false,
      resolutionEventId: "event-1",
    });
    const records = await value.events.load(ids.meeting);
    expect(records.at(-1)?.event).toMatchObject({
      causationId: REVIEW_REQUIRED_EVENT_ID,
      eventType: "DecisionRejected",
      payload: {
        reason: "The invalidated premise leaves no responsible recommit path.",
      },
    });
    expect(
      (await storedProjection(value))?.shared.decisionRevisions.find(
        ({ id }) => id === ids.revision1,
      ),
    ).toEqual(immutableInitialRevision);
  });

  it("replays every exact command without adding events and rejects fingerprint reuse", async () => {
    const cases = [
      {
        change: (input: RecommitDecisionInput) => ({
          ...input,
          title: "A different title",
        }),
        input: recommitInput,
        run: recommitDecision,
      },
      {
        change: (input: SupersedeDecisionInput) => ({
          ...input,
          replacementDecisionId: "another-replacement",
        }),
        input: supersedeInput,
        run: supersedeDecision,
      },
      {
        change: (input: RejectDecisionInput) => ({
          ...input,
          reason: "A different rejection reason",
        }),
        input: rejectInput,
        run: rejectDecision,
      },
    ] as const;

    for (const candidate of cases) {
      const value = await fixture();
      const input = candidate.input(value.expectedPosition);
      const first = await candidate.run(
        value.dependencies,
        facilitatorContext(),
        input as never,
      );
      const afterFirst = await value.events.load(ids.meeting);
      const replayed = await candidate.run(
        value.dependencies,
        facilitatorContext(),
        input as never,
      );
      expect(first.kind).not.toBe("failed");
      expect(replayed).toMatchObject({ replayed: true });
      expect(await value.events.load(ids.meeting)).toEqual(afterFirst);
      await expect(
        candidate.run(
          value.dependencies,
          facilitatorContext(),
          candidate.change(input as never) as never,
        ),
      ).resolves.toEqual({
        code: "IDEMPOTENCY_CONFLICT",
        kind: "failed",
      });
    }
  });

  it("enforces facilitator role, decision:review-confirm, meeting scope, and optimistic concurrency before append", async () => {
    const value = await fixture();
    const missingCapability = {
      ...facilitatorContext(),
      capabilities: new Set<Capability>(["meeting:read"]),
    };
    const initialRecords = await value.events.load(ids.meeting);

    await expect(
      recommitDecision(
        value.dependencies,
        participantContext(),
        recommitInput(value.expectedPosition),
      ),
    ).resolves.toEqual({ code: "FORBIDDEN", kind: "failed" });
    await expect(
      supersedeDecision(
        value.dependencies,
        missingCapability,
        supersedeInput(value.expectedPosition),
      ),
    ).resolves.toEqual({ code: "FORBIDDEN", kind: "failed" });
    await expect(
      rejectDecision(
        value.dependencies,
        facilitatorContext("meeting-other"),
        rejectInput(value.expectedPosition),
      ),
    ).resolves.toEqual({ code: "FORBIDDEN", kind: "failed" });
    await expect(
      recommitDecision(
        value.dependencies,
        facilitatorContext(),
        recommitInput(value.expectedPosition - 1),
      ),
    ).resolves.toEqual({
      actualPosition: value.expectedPosition,
      code: "CONFLICT",
      expectedPosition: value.expectedPosition - 1,
      kind: "failed",
    });
    expect(await value.events.load(ids.meeting)).toEqual(initialRecords);
  });

  it("validates explicit recommit, replacement identity, rejection reason, and exact review lineage", async () => {
    const recommitValue = await fixture();
    await expect(
      recommitDecision(recommitValue.dependencies, facilitatorContext(), {
        ...recommitInput(recommitValue.expectedPosition),
        explicitCommit: false,
      }),
    ).resolves.toEqual({
      code: "EXPLICIT_COMMIT_REQUIRED",
      kind: "failed",
    });

    const sameReplacement = await fixture();
    await expect(
      supersedeDecision(sameReplacement.dependencies, facilitatorContext(), {
        ...supersedeInput(sameReplacement.expectedPosition),
        replacementDecisionId: ids.decision,
      }),
    ).resolves.toEqual({
      code: "INVALID_STATE_TRANSITION",
      kind: "failed",
    });

    const missingReplacement = await fixture();
    await expect(
      supersedeDecision(missingReplacement.dependencies, facilitatorContext(), {
        ...supersedeInput(missingReplacement.expectedPosition),
        replacementDecisionId: "missing-replacement",
      }),
    ).resolves.toEqual({
      code: "DECISION_NOT_FOUND",
      kind: "failed",
    });

    const emptyReason = await fixture();
    await expect(
      rejectDecision(emptyReason.dependencies, facilitatorContext(), {
        ...rejectInput(emptyReason.expectedPosition),
        reason: " ",
      }),
    ).resolves.toEqual({ code: "VALIDATION_FAILED", kind: "failed" });

    const missingLineage = await fixture({ omitReviewRequired: true });
    await expect(
      rejectDecision(
        missingLineage.dependencies,
        facilitatorContext(),
        rejectInput(missingLineage.expectedPosition),
      ),
    ).resolves.toEqual({
      code: "REFERENCED_ENTITY_NOT_FOUND",
      kind: "failed",
    });
  });
});
