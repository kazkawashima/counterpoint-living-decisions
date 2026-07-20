import { describe, expect, it, vi } from "vitest";

import type {
  ManagedAiOperationLifecycleClaim,
  ManagedAiOperationReserveClaim,
  ManagedUsageReservation,
} from "@counterpoint/adapters-cloudflare";
import {
  ASSUMPTION_INVALIDATION_OPERATION,
  DEFAULT_OPENAI_MODEL,
  type AssumptionInvalidationEvaluation,
} from "@counterpoint/adapters-openai";
import type {
  AssumptionInvalidationEvaluationInput,
  InvalidationEvaluationDependencies,
} from "@counterpoint/application";
import type { UsageDecision } from "@counterpoint/ports";
import {
  JudgeAssumptionInvalidationError,
  runJudgeAssumptionInvalidation,
  type ConcreteAssumptionInvalidationEvaluator,
} from "../../../apps/worker/src/judge-assumption-invalidation.js";
import type {
  JudgeManagedStructuredAiClaimRepository,
  JudgeManagedStructuredAiUsageLimiter,
} from "../../../apps/worker/src/judge-managed-structured-ai.js";
import {
  ASSUMPTION_INVALIDATION_PRICING_VERSION,
  JUDGE_STRUCTURED_AI_DESCRIPTORS,
  calculateJudgeStructuredAiActualUsage,
} from "../../../apps/worker/src/judge-structured-ai.js";
import { userAuthorizationContext } from "../../../packages/application/src/sessions.js";
import { MutableClock } from "../../helpers/application-adapters.js";

const MEETING_ID = "meeting-judge-invalidation";
const FACILITATOR_ID = "participant-facilitator";
const USER_ID = "judge-facilitator";
const IP_ADDRESS = "203.0.113.73";
const NOW = "2026-07-20T12:00:00.000Z";
const NOW_EPOCH = Date.parse(NOW) / 1_000;

const evaluationInput: AssumptionInvalidationEvaluationInput = {
  actions: [
    {
      actionId: "action-rollout",
      affectedPremiseIds: ["premise-regulation"],
      scope: ["Pause the rollout", "Notify owners"],
      status: "active",
    },
  ],
  decision: {
    decisionId: "decision-rollout",
    monitorCondition: "Reopen when regulation changes.",
    outcome: "Proceed with the regional rollout.",
    revision: 3,
    revisionId: "revision-rollout-3",
    title: "Regional rollout",
  },
  evidence: [
    {
      evidenceReferenceId: "evidence-regulation",
      exactSnippet: "Synthetic shared regulatory evidence.",
    },
  ],
  externalEvent: {
    description: "A synthetic regulation changed.",
    effectiveAt: "2026-08-01T00:00:00.000Z",
    eventType: "regulatory_change",
    externalEventId: "external-event-regulation",
    jurisdiction: "European Union",
    source: "Synthetic regulator",
    sourceReference: "demo://regulatory-change",
  },
  meetingId: MEETING_ID,
  premises: [
    {
      confirmationStatus: "confirmed",
      premiseId: "premise-regulation",
      statement: "The rollout remains legally permitted.",
    },
  ],
};

function authorization(
  options: {
    readonly judge?: boolean;
    readonly role?: "facilitator" | "participant";
  } = {},
) {
  return userAuthorizationContext(
    {
      meetingId: MEETING_ID,
      participantId: FACILITATOR_ID,
      role: options.role ?? "facilitator",
      sessionId: "session-judge-invalidation",
      userId: USER_ID,
    },
    options.judge === false
      ? {}
      : { judgeManagedAiUserIds: new Set([USER_ID]) },
  );
}

function evaluation(
  billing: AssumptionInvalidationEvaluation["billing"] = {
    attemptCount: 1,
    attempts: [{ inputTokens: 190, model: "gpt-5.6", outputTokens: 60 }],
    inputTokens: 190,
    outputTokens: 60,
  },
): AssumptionInvalidationEvaluation {
  const suggestion = {
    affectedActionIds: ["action-rollout"],
    affectedPremiseIds: ["premise-regulation"],
    confidence: 0.92,
    evidenceReferenceIds: ["evidence-regulation", "demo://regulatory-change"],
    reason: "The synthetic change invalidates the monitored premise.",
  };
  return {
    ai: {
      candidates: [suggestion],
      generatedAt: NOW,
      inputReferenceIds: [
        "external-event-regulation",
        "revision-rollout-3",
        "premise-regulation",
        "action-rollout",
        "evidence-regulation",
        "demo://regulatory-change",
      ],
      model: "gpt-5.6",
      operation: ASSUMPTION_INVALIDATION_OPERATION,
      promptVersion: "assumption-invalidation-v1",
      schemaVersion: "1",
    },
    ...(billing === undefined ? {} : { billing }),
    suggestion,
  };
}

interface Fixture {
  readonly claims: JudgeManagedStructuredAiClaimRepository;
  readonly dependencies: InvalidationEvaluationDependencies;
  readonly finalize: ReturnType<typeof vi.fn>;
  readonly provider: ReturnType<
    typeof vi.fn<ConcreteAssumptionInvalidationEvaluator["evaluate"]>
  >;
  readonly reserveClaim: ReturnType<
    typeof vi.fn<JudgeManagedStructuredAiClaimRepository["reserveClaim"]>
  >;
  readonly usage: JudgeManagedStructuredAiUsageLimiter;
}

function lifecycleClaim(
  input: ManagedAiOperationReserveClaim,
): ManagedAiOperationLifecycleClaim {
  return {
    ...input,
    providerStartedAtEpoch: undefined,
    reuseAfterEpoch: undefined,
    settledAtEpoch: undefined,
    status: "reserved",
  };
}

function fixture(
  options: {
    readonly providerError?: unknown;
    readonly result?: AssumptionInvalidationEvaluation;
    readonly usageDenial?: Extract<UsageDecision, { kind: "denied" }>["limit"];
  } = {},
): Fixture {
  const claimsByKey = new Map<string, ManagedAiOperationLifecycleClaim>();
  const reserveClaim = vi.fn<
    JudgeManagedStructuredAiClaimRepository["reserveClaim"]
  >((input: ManagedAiOperationReserveClaim) => {
    const previous = claimsByKey.get(input.claimKeyHash);
    if (previous !== undefined) {
      return Promise.resolve(
        previous.requestFingerprint === input.requestFingerprint
          ? { claim: previous, kind: "replayed" as const }
          : { kind: "conflict" as const },
      );
    }
    const claim = lifecycleClaim(input);
    claimsByKey.set(input.claimKeyHash, claim);
    return Promise.resolve({ claim, kind: "reserved" as const });
  });
  const claims: JudgeManagedStructuredAiClaimRepository = {
    abandonReserved: vi.fn(() => Promise.resolve("abandoned" as const)),
    markProviderStarted: vi.fn(() => Promise.resolve("started" as const)),
    markSettled: vi.fn(() => Promise.resolve("settled" as const)),
    releaseOrphanedReservation: vi.fn(() =>
      Promise.resolve("unavailable" as const),
    ),
    reserveClaim,
    takeOverReserved: vi.fn(() => Promise.resolve("taken_over" as const)),
  };
  const finalize = vi.fn(() => Promise.resolve());
  const usage: JudgeManagedStructuredAiUsageLimiter = {
    finalize,
    findReservation: vi.fn((): Promise<ManagedUsageReservation | undefined> =>
      Promise.resolve(undefined),
    ),
    release: vi.fn(() => Promise.resolve()),
    reserveWithId: vi.fn(
      (identity: {
        readonly requestFingerprint: string;
        readonly reservationId: string;
      }) =>
        options.usageDenial === undefined
          ? Promise.resolve({
              activeUntilEpoch:
                NOW_EPOCH +
                JUDGE_STRUCTURED_AI_DESCRIPTORS[
                  ASSUMPTION_INVALIDATION_OPERATION
                ].claimLeaseSeconds,
              kind: "allowed" as const,
              reservationId: identity.reservationId,
              reservedAtEpoch: NOW_EPOCH,
            })
          : Promise.resolve({
              kind: "denied" as const,
              limit: options.usageDenial,
            }),
    ),
  };
  const provider = vi.fn<ConcreteAssumptionInvalidationEvaluator["evaluate"]>(
    () =>
      options.providerError === undefined
        ? Promise.resolve(options.result ?? evaluation())
        : Promise.reject(
            options.providerError instanceof Error
              ? options.providerError
              : new Error("Synthetic provider failure"),
          ),
  );
  return {
    claims,
    dependencies: {
      clock: new MutableClock(NOW),
      events: {} as InvalidationEvaluationDependencies["events"],
      hash: { hash: vi.fn() },
      ids: {} as InvalidationEvaluationDependencies["ids"],
      projections: {} as InvalidationEvaluationDependencies["projections"],
    },
    finalize,
    provider,
    reserveClaim,
    usage,
  };
}

function run(
  fixtureValue: Fixture,
  options: {
    readonly canonicalizationVersion?: string;
    readonly execute?: (
      dependencies: InvalidationEvaluationDependencies,
    ) => Promise<unknown>;
    readonly input?: AssumptionInvalidationEvaluationInput;
  } = {},
) {
  return runJudgeAssumptionInvalidation({
    authorization: authorization(),
    ...(options.canonicalizationVersion === undefined
      ? {}
      : { canonicalizationVersion: options.canonicalizationVersion }),
    claims: fixtureValue.claims,
    clock: new MutableClock(NOW),
    dependencies: fixtureValue.dependencies,
    evaluator: { evaluate: fixtureValue.provider },
    execute:
      options.execute ??
      ((dependencies) =>
        dependencies.evaluator!.evaluate(options.input ?? evaluationInput)),
    ipAddress: IP_ADDRESS,
    nextReservationId: () => "reservation-judge-invalidation",
    reconcile: vi.fn(() => Promise.resolve()),
    usage: fixtureValue.usage,
  });
}

describe("judge assumption invalidation decorator", () => {
  it("returns completed application replay before claim or provider work", async () => {
    const fixtureValue = fixture();

    await expect(
      run(fixtureValue, {
        execute: () => Promise.resolve({ replayed: true }),
      }),
    ).resolves.toEqual({ replayed: true });

    expect(fixtureValue.reserveClaim).not.toHaveBeenCalled();
    expect(fixtureValue.provider).not.toHaveBeenCalled();
  });

  it.each([
    ["ordinary facilitator", authorization({ judge: false })],
    ["judge participant", authorization({ role: "participant" })],
  ])(
    "requires current facilitator and judge authorization for %s",
    async (_label, currentAuthorization) => {
      const fixtureValue = fixture();

      await expect(
        runJudgeAssumptionInvalidation({
          authorization: currentAuthorization,
          claims: fixtureValue.claims,
          clock: new MutableClock(NOW),
          dependencies: fixtureValue.dependencies,
          evaluator: { evaluate: fixtureValue.provider },
          execute: (dependencies) =>
            dependencies.evaluator!.evaluate(evaluationInput),
          ipAddress: IP_ADDRESS,
          nextReservationId: () => "reservation-unauthorized",
          reconcile: vi.fn(() => Promise.resolve()),
          usage: fixtureValue.usage,
        }),
      ).rejects.toMatchObject({
        code: "OPENAI_UNAVAILABLE",
        name: "JudgeAssumptionInvalidationError",
      });
      expect(fixtureValue.reserveClaim).not.toHaveBeenCalled();
      expect(fixtureValue.provider).not.toHaveBeenCalled();
    },
  );

  it("claims the original event and revision identity with a canonical complete evaluator fingerprint", async () => {
    const left = fixture();
    const right = fixture();
    const reordered: AssumptionInvalidationEvaluationInput = {
      ...evaluationInput,
      actions: evaluationInput.actions.toReversed(),
      evidence: evaluationInput.evidence.toReversed(),
      premises: evaluationInput.premises.toReversed(),
    };

    await run(left);
    await run(right, { input: reordered });

    const first = left.reserveClaim.mock.calls[0]?.[0];
    const second = right.reserveClaim.mock.calls[0]?.[0];
    expect(first?.claimKeyHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(first?.requestFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(second?.claimKeyHash).toBe(first?.claimKeyHash);
    expect(second?.requestFingerprint).toBe(first?.requestFingerprint);

    const changedEvent = fixture();
    await run(changedEvent, {
      input: {
        ...evaluationInput,
        externalEvent: {
          ...evaluationInput.externalEvent,
          externalEventId: "external-event-regulation-received-again",
        },
      },
    });
    expect(changedEvent.reserveClaim.mock.calls[0]?.[0]?.claimKeyHash).not.toBe(
      first?.claimKeyHash,
    );

    const changedRevisionIdentity = fixture();
    await run(changedRevisionIdentity, {
      input: {
        ...evaluationInput,
        decision: {
          ...evaluationInput.decision,
          revisionId: "revision-rollout-4",
        },
      },
    });
    expect(
      changedRevisionIdentity.reserveClaim.mock.calls[0]?.[0]?.claimKeyHash,
    ).not.toBe(first?.claimKeyHash);
  });

  it("suppresses concurrent exact requests after one provider start", async () => {
    const fixtureValue = fixture();

    const settled = await Promise.allSettled([
      run(fixtureValue),
      run(fixtureValue),
    ]);

    expect(settled.filter(({ status }) => status === "fulfilled")).toHaveLength(
      1,
    );
    expect(settled.filter(({ status }) => status === "rejected")).toHaveLength(
      1,
    );
    expect(fixtureValue.provider).toHaveBeenCalledTimes(1);
  });

  it("maps changed immutable revision content on the same identity to conflict", async () => {
    const fixtureValue = fixture();
    await run(fixtureValue);

    await expect(
      run(fixtureValue, {
        input: {
          ...evaluationInput,
          decision: {
            ...evaluationInput.decision,
            outcome: "The immutable revision was unexpectedly changed.",
          },
        },
      }),
    ).rejects.toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
      name: "JudgeAssumptionInvalidationError",
    });
    expect(fixtureValue.provider).toHaveBeenCalledTimes(1);
  });

  it("settles trustworthy actual usage and full usage when billing is absent", async () => {
    const actualFixture = fixture();
    await run(actualFixture);
    expect(actualFixture.finalize).toHaveBeenCalledWith(
      "reservation-judge-invalidation",
      calculateJudgeStructuredAiActualUsage(
        ASSUMPTION_INVALIDATION_OPERATION,
        evaluation().billing!,
      ),
    );

    const metered = evaluation();
    const unmetered: AssumptionInvalidationEvaluation = {
      ai: metered.ai,
      suggestion: metered.suggestion,
    };
    const fullFixture = fixture({ result: unmetered });
    await run(fullFixture);
    expect(fullFixture.finalize).toHaveBeenCalledWith(
      "reservation-judge-invalidation",
      JUDGE_STRUCTURED_AI_DESCRIPTORS[ASSUMPTION_INVALIDATION_OPERATION]
        .reservedUsage,
    );
  });

  it("full-settles provider failure and redacts its details", async () => {
    const fixtureValue = fixture({
      providerError: new Error("sensitive provider failure"),
    });

    await expect(run(fixtureValue)).rejects.toEqual(
      new JudgeAssumptionInvalidationError("OPENAI_UNAVAILABLE"),
    );
    expect(fixtureValue.finalize).toHaveBeenCalledWith(
      "reservation-judge-invalidation",
      JUDGE_STRUCTURED_AI_DESCRIPTORS[ASSUMPTION_INVALIDATION_OPERATION]
        .reservedUsage,
    );
  });

  it("preserves only the typed managed usage denial detail", async () => {
    const fixtureValue = fixture({ usageDenial: "cost" });

    await expect(run(fixtureValue)).rejects.toEqual(
      new JudgeAssumptionInvalidationError("USAGE_LIMIT_REACHED", {
        limit: "cost",
      }),
    );
    expect(fixtureValue.provider).not.toHaveBeenCalled();
  });

  it("changes stored pricing and fingerprint with only canonicalization version", async () => {
    const firstFixture = fixture();
    const secondFixture = fixture();

    await run(firstFixture);
    await run(secondFixture, {
      canonicalizationVersion: "judge-structured-input-v2",
    });

    const first = firstFixture.reserveClaim.mock.calls[0]?.[0];
    const second = secondFixture.reserveClaim.mock.calls[0]?.[0];
    expect(first?.model).toBe(DEFAULT_OPENAI_MODEL);
    expect(ASSUMPTION_INVALIDATION_PRICING_VERSION).toContain(
      "judge-structured-input-v1",
    );
    expect(first?.pricingVersion).toMatch(/^(?:hex:|[0-9A-Za-z._:/-])/u);
    expect(second?.pricingVersion).not.toBe(first?.pricingVersion);
    expect(second?.requestFingerprint).not.toBe(first?.requestFingerprint);
  });
});
