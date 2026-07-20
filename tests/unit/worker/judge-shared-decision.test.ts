import { describe, expect, it, vi } from "vitest";

import type {
  ManagedAiOperationLifecycleClaim,
  ManagedAiOperationReserveClaim,
  ManagedUsageReservation,
} from "@counterpoint/adapters-cloudflare";
import type {
  SharedDecisionSynthesis,
  SharedDecisionSynthesisInput,
} from "@counterpoint/adapters-openai";
import {
  DEFAULT_OPENAI_MODEL,
  DECISION_SYNTHESIS_OPERATION,
} from "@counterpoint/adapters-openai";
import type { DecisionCandidateDependencies } from "@counterpoint/application";
import {
  JudgeSharedDecisionError,
  runJudgeSharedDecision,
  type ConcreteSharedDecisionSynthesizer,
} from "../../../apps/worker/src/judge-shared-decision.js";
import type {
  JudgeManagedStructuredAiClaimRepository,
  JudgeManagedStructuredAiUsageLimiter,
} from "../../../apps/worker/src/judge-managed-structured-ai.js";
import {
  DECISION_SYNTHESIS_PRICING_VERSION,
  JUDGE_STRUCTURED_AI_DESCRIPTORS,
  calculateJudgeStructuredAiActualUsage,
} from "../../../apps/worker/src/judge-structured-ai.js";
import { userAuthorizationContext } from "../../../packages/application/src/sessions.js";
import { MutableClock } from "../../helpers/application-adapters.js";

const MEETING_ID = "meeting-judge-decision";
const FACILITATOR_ID = "participant-facilitator";
const USER_ID = "judge-facilitator";
const IP_ADDRESS = "203.0.113.71";
const NOW = "2026-07-20T12:00:00.000Z";
const NOW_EPOCH = Date.parse(NOW) / 1_000;

const synthesisInput: SharedDecisionSynthesisInput = {
  actions: [
    {
      actionId: "action-beta",
      scope: ["Preserve semantic order", "Then publish"],
      status: "proposed",
    },
    {
      actionId: "action-alpha",
      scope: ["Document the approval gate"],
      status: "proposed",
    },
  ],
  dissent: [
    {
      dissentId: "dissent-shared",
      reason: "Rollback ownership needs review.",
      retained: true,
    },
  ],
  evidence: [
    {
      evidenceId: "evidence-shared",
      exactSnippet: "Synthetic shared evidence.",
    },
  ],
  meetingId: MEETING_ID,
  participantIds: ["participant-operator", FACILITATOR_ID],
  premises: [
    {
      premiseId: "premise-shared",
      statement: "The approval gate is documented.",
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
      sessionId: "session-judge-decision",
      userId: USER_ID,
    },
    options.judge === false
      ? {}
      : { judgeManagedAiUserIds: new Set([USER_ID]) },
  );
}

function synthesis(
  billing: SharedDecisionSynthesis["billing"] = {
    attemptCount: 1,
    attempts: [{ inputTokens: 210, model: "gpt-5.6", outputTokens: 80 }],
    inputTokens: 210,
    outputTokens: 80,
  },
): SharedDecisionSynthesis {
  return {
    ai: {
      candidates: [
        {
          action: {
            affectedPremiseIndex: 0,
            ownerParticipantId: "participant-operator",
            scope: "Document the approval gate.",
          },
          confidence: 0.9,
          dissent: {
            reason: "Rollback ownership needs review.",
            retained: true,
          },
          monitorCondition: "Reopen if the gate changes.",
          outcome: "Proceed after documenting the gate.",
          premise: {
            evidenceReferenceIds: ["evidence-shared"],
            statement: "The approval gate is documented.",
          },
          reason: "The shared evidence supports a bounded decision.",
          title: "Conditional rollout",
        },
      ],
      generatedAt: NOW,
      inputReferenceIds: ["evidence-shared"],
      model: "gpt-5.6",
      operation: DECISION_SYNTHESIS_OPERATION,
      promptVersion: "shared-decision-v1",
      schemaVersion: "1",
    },
    ...(billing === undefined ? {} : { billing }),
    draft: {
      action: {
        affectedPremiseIndex: 0,
        ownerParticipantId: "participant-operator",
        scope: "Document the approval gate.",
      },
      confidence: 0.9,
      dissent: {
        reason: "Rollback ownership needs review.",
        retained: true,
      },
      monitorCondition: "Reopen if the gate changes.",
      outcome: "Proceed after documenting the gate.",
      premise: {
        evidenceReferenceIds: ["evidence-shared"],
        statement: "The approval gate is documented.",
      },
      reason: "The shared evidence supports a bounded decision.",
      title: "Conditional rollout",
    },
  };
}

interface Fixture {
  readonly claims: JudgeManagedStructuredAiClaimRepository;
  readonly dependencies: DecisionCandidateDependencies;
  readonly finalize: ReturnType<typeof vi.fn>;
  readonly provider: ReturnType<
    typeof vi.fn<ConcreteSharedDecisionSynthesizer["synthesize"]>
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
    readonly result?: SharedDecisionSynthesis;
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
        Promise.resolve({
          activeUntilEpoch:
            NOW_EPOCH +
            JUDGE_STRUCTURED_AI_DESCRIPTORS[DECISION_SYNTHESIS_OPERATION]
              .claimLeaseSeconds,
          kind: "allowed" as const,
          reservationId: identity.reservationId,
          reservedAtEpoch: NOW_EPOCH,
        }),
    ),
  };
  const provider = vi.fn<ConcreteSharedDecisionSynthesizer["synthesize"]>(() =>
    options.providerError === undefined
      ? Promise.resolve(options.result ?? synthesis())
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
      events: {} as DecisionCandidateDependencies["events"],
      hash: { hash: vi.fn() },
      ids: {} as DecisionCandidateDependencies["ids"],
      listParticipantIds: vi.fn(),
      projections: {} as DecisionCandidateDependencies["projections"],
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
      dependencies: DecisionCandidateDependencies,
    ) => Promise<unknown>;
    readonly input?: SharedDecisionSynthesisInput;
    readonly requestId?: string;
  } = {},
) {
  return runJudgeSharedDecision({
    authorization: authorization(),
    ...(options.canonicalizationVersion === undefined
      ? {}
      : { canonicalizationVersion: options.canonicalizationVersion }),
    claims: fixtureValue.claims,
    clock: new MutableClock(NOW),
    dependencies: fixtureValue.dependencies,
    execute:
      options.execute ??
      ((dependencies) =>
        dependencies.synthesizer!.synthesize(options.input ?? synthesisInput)),
    ipAddress: IP_ADDRESS,
    nextReservationId: () => "reservation-judge-decision",
    reconcile: vi.fn(() => Promise.resolve()),
    request: {
      assistance: "ai_preferred",
      idempotencyKey: options.requestId ?? "prepare-decision",
      meetingId: MEETING_ID,
    },
    synthesizer: {
      synthesize: fixtureValue.provider,
    },
    usage: fixtureValue.usage,
  });
}

describe("judge shared Decision decorator", () => {
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
        runJudgeSharedDecision({
          authorization: currentAuthorization,
          claims: fixtureValue.claims,
          clock: new MutableClock(NOW),
          dependencies: fixtureValue.dependencies,
          execute: (dependencies) =>
            dependencies.synthesizer!.synthesize(synthesisInput),
          ipAddress: IP_ADDRESS,
          nextReservationId: () => "reservation-unauthorized",
          reconcile: vi.fn(() => Promise.resolve()),
          request: {
            assistance: "ai_preferred",
            idempotencyKey: "prepare-unauthorized",
            meetingId: MEETING_ID,
          },
          synthesizer: { synthesize: fixtureValue.provider },
          usage: fixtureValue.usage,
        }),
      ).rejects.toMatchObject({
        code: "OPENAI_UNAVAILABLE",
        name: "JudgeSharedDecisionError",
      });
      expect(fixtureValue.reserveClaim).not.toHaveBeenCalled();
      expect(fixtureValue.provider).not.toHaveBeenCalled();
    },
  );

  it("claims the exact idempotency key and canonical full snapshot", async () => {
    const left = fixture();
    const right = fixture();
    const reordered: SharedDecisionSynthesisInput = {
      ...synthesisInput,
      actions: synthesisInput.actions.toReversed(),
      participantIds: synthesisInput.participantIds.toReversed(),
    };

    await run(left);
    await run(right, { input: reordered });

    const first = left.reserveClaim.mock.calls[0]?.[0];
    const second = right.reserveClaim.mock.calls[0]?.[0];
    expect(first?.claimKeyHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(first?.requestFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(second?.claimKeyHash).toBe(first?.claimKeyHash);
    expect(second?.requestFingerprint).toBe(first?.requestFingerprint);

    const changed = fixture();
    await run(changed, {
      input: {
        ...synthesisInput,
        evidence: [
          {
            ...synthesisInput.evidence[0]!,
            exactSnippet: "Changed authorized snapshot.",
          },
        ],
      },
    });
    expect(changed.reserveClaim.mock.calls[0]?.[0]).toMatchObject({
      claimKeyHash: first?.claimKeyHash,
    });
    expect(
      changed.reserveClaim.mock.calls[0]?.[0]?.requestFingerprint,
    ).not.toBe(first?.requestFingerprint);
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

  it("maps a changed snapshot on the same claim to conflict", async () => {
    const fixtureValue = fixture();
    await run(fixtureValue);

    await expect(
      run(fixtureValue, {
        input: {
          ...synthesisInput,
          premises: [
            {
              premiseId: "premise-shared",
              statement: "The approval gate changed.",
            },
          ],
        },
      }),
    ).rejects.toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
      name: "JudgeSharedDecisionError",
    });
    expect(fixtureValue.provider).toHaveBeenCalledTimes(1);
  });

  it("settles trustworthy actual usage and full usage when billing is absent", async () => {
    const actualFixture = fixture();
    await run(actualFixture);
    expect(actualFixture.finalize).toHaveBeenCalledWith(
      "reservation-judge-decision",
      calculateJudgeStructuredAiActualUsage(
        DECISION_SYNTHESIS_OPERATION,
        synthesis().billing!,
      ),
    );

    const metered = synthesis();
    const unmetered: SharedDecisionSynthesis = {
      ai: metered.ai,
      draft: metered.draft,
    };
    const fullFixture = fixture({ result: unmetered });
    await run(fullFixture);
    expect(fullFixture.finalize).toHaveBeenCalledWith(
      "reservation-judge-decision",
      JUDGE_STRUCTURED_AI_DESCRIPTORS[DECISION_SYNTHESIS_OPERATION]
        .reservedUsage,
    );
  });

  it("full-settles provider failure and redacts its details", async () => {
    const fixtureValue = fixture({
      providerError: new Error("sensitive provider failure"),
    });

    await expect(run(fixtureValue)).rejects.toEqual(
      new JudgeSharedDecisionError("OPENAI_UNAVAILABLE"),
    );
    expect(fixtureValue.finalize).toHaveBeenCalledWith(
      "reservation-judge-decision",
      JUDGE_STRUCTURED_AI_DESCRIPTORS[DECISION_SYNTHESIS_OPERATION]
        .reservedUsage,
    );
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
    expect(DECISION_SYNTHESIS_PRICING_VERSION).toContain(
      "judge-structured-input-v1",
    );
    expect(first?.pricingVersion).toMatch(/^(?:hex:|[0-9A-Za-z._:/-])/u);
    expect(second?.pricingVersion).not.toBe(first?.pricingVersion);
    expect(second?.requestFingerprint).not.toBe(first?.requestFingerprint);
  });
});
