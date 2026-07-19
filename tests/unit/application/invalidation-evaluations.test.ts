import { describe, expect, it } from "vitest";

import {
  evaluateAssumptionInvalidation,
  type AssumptionInvalidationCandidate,
  type AssumptionInvalidationEvaluation,
  type AssumptionInvalidationEvaluationInput,
  type AssumptionInvalidationEvaluator,
  type InvalidationEvaluationDependencies,
} from "../../../packages/application/src/invalidation-evaluations.js";
import {
  contentHash,
  createDecisionRevision,
  createExternalEvent,
  createPremise,
  externalEventId,
  monitorRegistrationId,
  nonEmptyText,
  revisionNumber,
  suggestionId,
  timestamp,
  transitionDecision,
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
  sharedEvidence,
} from "../domain/fixtures.js";

const EXTERNAL_EVENT_ID = "external-event-eu-regulation";
const EXTERNAL_SOURCE_REFERENCE =
  "https://example.invalid/regulation/eu-change";
const MONITOR_REGISTRATION_ID = "monitor-eu-regulation";
const OCCURRED_AT = timestamp("2026-07-20T09:00:01.000Z");
const GENERATED_AT = "2026-07-20T09:00:00.500Z";

function stableFixtureHash(value: string): string {
  let hash = 2_166_136_261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return `fixture-${(hash >>> 0).toString(16)}`;
}

function validCandidate(
  overrides: Partial<AssumptionInvalidationCandidate> = {},
): AssumptionInvalidationCandidate {
  return {
    affectedActionIds: [ids.actionEurope],
    affectedPremiseIds: [ids.premiseEurope],
    confidence: 0.91,
    evidenceReferenceIds: [ids.evidence, EXTERNAL_SOURCE_REFERENCE],
    reason: "The regulatory change invalidates the monitored premise.",
    ...overrides,
  };
}

class CountingEvaluator implements AssumptionInvalidationEvaluator {
  calls = 0;
  inputs: AssumptionInvalidationEvaluationInput[] = [];

  constructor(
    private readonly candidate: AssumptionInvalidationCandidate = validCandidate(),
    private readonly aiOverrides: Partial<
      AssumptionInvalidationEvaluation["ai"]
    > = {},
  ) {}

  evaluate(
    input: AssumptionInvalidationEvaluationInput,
  ): Promise<AssumptionInvalidationEvaluation> {
    this.calls += 1;
    this.inputs.push(structuredClone(input));
    const suggestion = structuredClone(this.candidate);
    return Promise.resolve({
      ai: {
        candidates: [suggestion],
        generatedAt: GENERATED_AT,
        inputReferenceIds: [ids.evidence, EXTERNAL_SOURCE_REFERENCE],
        model: "gpt-5.6",
        operation: "assumption_invalidation",
        promptVersion: "assumption-invalidation-v1",
        schemaVersion: "1",
        ...this.aiOverrides,
      },
      suggestion,
    });
  }
}

interface Fixture {
  readonly committedRevision: ReturnType<typeof createDecisionRevision>;
  readonly dependencies: InvalidationEvaluationDependencies;
  readonly evaluator: CountingEvaluator;
  readonly events: InMemoryEventStore<DomainEvent>;
  readonly projections: InMemoryProjectionStore<MeetingProjection>;
}

async function fixture(
  candidate: AssumptionInvalidationCandidate = validCandidate(),
): Promise<Fixture> {
  const evaluator = new CountingEvaluator(candidate);
  const events = new InMemoryEventStore<DomainEvent>();
  const projections = new InMemoryProjectionStore<MeetingProjection>();
  const dependencies: InvalidationEvaluationDependencies = {
    clock: new MutableClock(OCCURRED_AT),
    evaluator,
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
  const rolloutAction = action(
    ids.actionEurope,
    ids.premiseEurope,
    "Europe rollout",
  );
  const committedDecision = flagshipDecision("COMMITTED", {
    actionIds: [ids.actionEurope],
    dissentIds: [],
  });
  const monitoringDecision = transitionDecision(committedDecision, {
    authority: { kind: "system" },
    monitorRegistrationId: monitorRegistrationId(MONITOR_REGISTRATION_ID),
    to: "MONITORING",
  });
  const baseRevision = firstRevision("COMMITTED");
  const committedRevision = createDecisionRevision({
    ...baseRevision,
    snapshot: {
      ...baseRevision.snapshot,
      actionIds: [ids.actionEurope],
      dissentIds: [],
    },
  });
  const externalEvent = createExternalEvent({
    confirmationStatus: "not_applicable",
    createdAt: timestamp("2026-07-20T09:00:00.000Z"),
    createdBy: "system",
    description: nonEmptyText(
      "A synthetic regulation changes the regional launch condition.",
    ),
    effectiveAt: timestamp("2026-08-01T00:00:00.000Z"),
    eventType: nonEmptyText("regulatory_change"),
    id: externalEventId(EXTERNAL_EVENT_ID),
    jurisdiction: nonEmptyText("European Union"),
    meetingId: ids.meeting,
    monitorRegistrationId: monitorRegistrationId(MONITOR_REGISTRATION_ID),
    origin: "system",
    payloadHash: contentHash("sha256:synthetic-regulatory-event"),
    receivedAt: timestamp("2026-07-20T09:00:00.000Z"),
    revision: revisionNumber(1),
    schemaVersion: revisionNumber(1),
    signatureResult: "valid",
    source: nonEmptyText("Synthetic regulator feed"),
    sourceReference: nonEmptyText(EXTERNAL_SOURCE_REFERENCE),
    visibility: "shared",
  });
  const seeded = await events.append({
    events: [
      sharedEvent("EvidenceShared", 1, { evidence: sharedEvidence() }),
      sharedEvent("InferenceConfirmed", 2, {
        confirmedBy: ids.facilitator,
        result: { entity: premise, kind: "premise" },
        suggestionId: suggestionId("suggestion-premise"),
      }),
      sharedEvent("InferenceConfirmed", 3, {
        confirmedBy: ids.facilitator,
        result: { entity: rolloutAction, kind: "action" },
        suggestionId: suggestionId("suggestion-action"),
      }),
      sharedEvent("DecisionCommitted", 4, {
        decision: committedDecision,
        revision: committedRevision,
      }),
      sharedEvent("MonitoringStarted", 5, {
        decision: monitoringDecision,
        monitorRegistrationId: monitorRegistrationId(MONITOR_REGISTRATION_ID),
      }),
      sharedEvent("ExternalEventReceived", 6, { externalEvent }),
    ],
    expectedPosition: 0,
    meetingId: ids.meeting,
  });
  if (seeded.kind !== "appended") {
    throw new Error("Invalidation evaluation fixture failed");
  }
  return {
    committedRevision,
    dependencies,
    evaluator,
    events,
    projections,
  };
}

const evaluationInput = {
  correlationId: "correlation-invalidation-command",
  externalEventId: EXTERNAL_EVENT_ID,
  meetingId: ids.meeting,
} as const;

describe("assumption invalidation evaluation application flow", () => {
  it("atomically records AI suggestion provenance and a system AT_RISK transition without revising the Decision", async () => {
    const { committedRevision, dependencies, evaluator, events, projections } =
      await fixture();
    const immutableRevision = structuredClone(committedRevision);

    const result = await evaluateAssumptionInvalidation(
      dependencies,
      evaluationInput,
    );

    expect(result).toMatchObject({
      correlationId: evaluationInput.correlationId,
      evaluation: {
        affectedActionIds: [ids.actionEurope],
        affectedPremiseIds: [ids.premiseEurope],
        confidence: 0.91,
        decision: {
          activeRevision: committedRevision.version,
          activeRevisionId: committedRevision.id,
          status: "AT_RISK",
        },
        evidenceReferenceIds: [ids.evidence, EXTERNAL_SOURCE_REFERENCE],
        externalEventId: EXTERNAL_EVENT_ID,
        generatedAt: GENERATED_AT,
        inputReferenceIds: [ids.evidence, EXTERNAL_SOURCE_REFERENCE],
        model: "gpt-5.6",
        operation: "assumption_invalidation",
        outputSchemaVersion: "1",
        promptVersion: "assumption-invalidation-v1",
        reason: "The regulatory change invalidates the monitored premise.",
      },
      kind: "evaluated",
      position: 8,
      replayed: false,
    });
    expect(evaluator.calls).toBe(1);
    expect(evaluator.inputs).toEqual([
      {
        actions: [
          {
            actionId: ids.actionEurope,
            affectedPremiseIds: [ids.premiseEurope],
            scope: ["Europe rollout"],
            status: "active",
          },
        ],
        decision: {
          decisionId: ids.decision,
          monitorCondition: "Monitor regulatory changes",
          outcome: "Roll out Europe after legal clearance",
          revision: committedRevision.version,
          revisionId: committedRevision.id,
          title: "Global rollout",
        },
        evidence: [
          {
            evidenceReferenceId: ids.evidence,
            exactSnippet: "Approved regulatory excerpt",
          },
        ],
        externalEvent: {
          description:
            "A synthetic regulation changes the regional launch condition.",
          effectiveAt: "2026-08-01T00:00:00.000Z",
          eventType: "regulatory_change",
          externalEventId: EXTERNAL_EVENT_ID,
          jurisdiction: "European Union",
          source: "Synthetic regulator feed",
          sourceReference: EXTERNAL_SOURCE_REFERENCE,
        },
        meetingId: ids.meeting,
        premises: [
          {
            confirmationStatus: "confirmed",
            premiseId: ids.premiseEurope,
            statement: "The current European rollout remains legally permitted",
          },
        ],
      },
    ]);

    const records = await events.load(ids.meeting);
    expect(records).toHaveLength(8);
    expect(records.slice(-2).map(({ event }) => event.eventType)).toEqual([
      "AssumptionInvalidationSuggested",
      "DecisionMarkedAtRisk",
    ]);
    const suggested = records[6]?.event;
    const markedAtRisk = records[7]?.event;
    if (
      suggested?.eventType !== "AssumptionInvalidationSuggested" ||
      markedAtRisk?.eventType !== "DecisionMarkedAtRisk"
    ) {
      throw new Error("Expected the atomic invalidation event pair");
    }
    expect(suggested).toMatchObject({
      actor: { kind: "ai", model: "gpt-5.6" },
      causationId: "ExternalEventReceived-6",
      correlationId: evaluationInput.correlationId,
      idempotencyKey:
        `assumption-invalidation:${EXTERNAL_EVENT_ID}:` +
        `${String(committedRevision.id)}:v1`,
      payload: {
        activeRevisionId: committedRevision.id,
        metadata: {
          confidence: 0.91,
          model: "gpt-5.6",
          promptVersion: "assumption-invalidation-v1",
        },
        provenance: {
          generatedAt: GENERATED_AT,
          operation: "assumption_invalidation",
          outputSchemaVersion: "1",
        },
      },
    });
    expect(markedAtRisk).toMatchObject({
      actor: { kind: "system" },
      causationId: suggested.eventId,
      correlationId: evaluationInput.correlationId,
      payload: {
        decision: {
          activeRevisionId: committedRevision.id,
          status: "AT_RISK",
        },
        suggestionId: suggested.payload.suggestionId,
      },
    });
    expect(markedAtRisk).not.toHaveProperty("idempotencyKey");

    const projection = await projections.get({
      meetingId: ids.meeting,
      projection: "meeting",
    });
    expect(projection?.shared.decisions).toMatchObject([
      {
        activeRevision: committedRevision.version,
        activeRevisionId: committedRevision.id,
        status: "AT_RISK",
      },
    ]);
    expect(projection?.shared.decisionRevisions).toEqual([immutableRevision]);
    expect(committedRevision).toEqual(immutableRevision);
    expect(committedRevision.snapshot.status).toBe("COMMITTED");
  });

  it.each([
    ["foreign premise", { affectedPremiseIds: ["premise-foreign"] }],
    ["foreign action", { affectedActionIds: ["action-foreign"] }],
    [
      "foreign evidence",
      {
        evidenceReferenceIds: [EXTERNAL_SOURCE_REFERENCE, "evidence-foreign"],
      },
    ],
    [
      "missing external-event source reference",
      { evidenceReferenceIds: [ids.evidence] },
    ],
    ["out-of-range confidence", { confidence: 1.01 }],
    [
      "duplicate premise references",
      {
        affectedPremiseIds: [ids.premiseEurope, ids.premiseEurope],
      },
    ],
    [
      "duplicate action references",
      {
        affectedActionIds: [ids.actionEurope, ids.actionEurope],
      },
    ],
    [
      "duplicate evidence references",
      {
        evidenceReferenceIds: [
          EXTERNAL_SOURCE_REFERENCE,
          EXTERNAL_SOURCE_REFERENCE,
        ],
      },
    ],
    ["a blank reason", { reason: "  " }],
  ])(
    "rejects %s from the evaluator without appending",
    async (_, overrides) => {
      const { dependencies, evaluator, events } = await fixture(
        validCandidate(overrides),
      );

      await expect(
        evaluateAssumptionInvalidation(dependencies, evaluationInput),
      ).resolves.toEqual({
        code: "INVALID_MODEL_OUTPUT",
        kind: "failed",
      });
      expect(evaluator.calls).toBe(1);
      expect(await events.position(ids.meeting)).toBe(6);
      expect(
        (await events.load(ids.meeting)).filter(
          ({ event }) =>
            event.eventType === "AssumptionInvalidationSuggested" ||
            event.eventType === "DecisionMarkedAtRisk",
        ),
      ).toEqual([]);
    },
  );

  it.each([
    ["foreign input references", { inputReferenceIds: ["foreign-reference"] }],
    [
      "duplicate input references",
      { inputReferenceIds: [ids.evidence, ids.evidence] },
    ],
    ["an unexpected operation", { operation: "publish_decision" }],
    ["an unexpected prompt version", { promptVersion: "other-prompt" }],
    ["an unexpected schema version", { schemaVersion: "2" }],
  ])("rejects %s in AI provenance", async (_, aiOverrides) => {
    const fixtureState = await fixture();
    const evaluator = new CountingEvaluator(validCandidate(), aiOverrides);
    const dependencies = { ...fixtureState.dependencies, evaluator };

    await expect(
      evaluateAssumptionInvalidation(dependencies, evaluationInput),
    ).resolves.toEqual({
      code: "INVALID_MODEL_OUTPUT",
      kind: "failed",
    });
    expect(evaluator.calls).toBe(1);
    expect(await fixtureState.events.position(ids.meeting)).toBe(6);
  });

  it("replays the exact derived command without a second evaluator call", async () => {
    const { dependencies, evaluator, events } = await fixture();

    const first = await evaluateAssumptionInvalidation(
      dependencies,
      evaluationInput,
    );
    const replayed = await evaluateAssumptionInvalidation(
      dependencies,
      evaluationInput,
    );

    expect(first).toMatchObject({ kind: "evaluated", replayed: false });
    expect(replayed).toEqual(
      first.kind === "evaluated"
        ? {
            ...first,
            replayed: true,
          }
        : first,
    );
    expect(evaluator.calls).toBe(1);
    expect(await events.position(ids.meeting)).toBe(8);
    expect(
      (await events.load(ids.meeting)).filter(
        ({ event }) =>
          event.eventType === "AssumptionInvalidationSuggested" ||
          event.eventType === "DecisionMarkedAtRisk",
      ),
    ).toHaveLength(2);
  });
});
