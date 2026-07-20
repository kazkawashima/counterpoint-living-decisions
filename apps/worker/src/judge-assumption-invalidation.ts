import {
  ASSUMPTION_INVALIDATION_OPERATION,
  DEFAULT_OPENAI_MODEL,
  type AssumptionInvalidationEvaluation,
} from "@counterpoint/adapters-openai";
import type {
  AssumptionInvalidationEvaluationInput,
  AssumptionInvalidationEvaluator,
  InvalidationEvaluationDependencies,
  UserAuthorizationContext,
} from "@counterpoint/application";
import type { Clock, UsageDecision } from "@counterpoint/ports";

import {
  JudgeManagedStructuredAiError,
  runJudgeManagedStructuredAiOperation,
  type JudgeManagedStructuredAiClaimRepository,
  type JudgeManagedStructuredAiReconcileRequest,
  type JudgeManagedStructuredAiUsageLimiter,
} from "./judge-managed-structured-ai.js";
import {
  ASSUMPTION_INVALIDATION_PRICING_VERSION,
  JUDGE_STRUCTURED_AI_DESCRIPTORS,
  JUDGE_STRUCTURED_INPUT_CANONICALIZATION_VERSION,
  calculateJudgeStructuredAiActualUsage,
  fingerprintJudgeStructuredInput,
  measureJudgeProviderInputBytes,
} from "./judge-structured-ai.js";

type UsageLimit = Extract<UsageDecision, { kind: "denied" }>["limit"];

export type JudgeAssumptionInvalidationErrorCode =
  | "IDEMPOTENCY_CONFLICT"
  | "OPENAI_UNAVAILABLE"
  | "USAGE_LIMIT_REACHED"
  | "VALIDATION_FAILED";

export class JudgeAssumptionInvalidationError extends Error {
  readonly code: JudgeAssumptionInvalidationErrorCode;
  readonly details: Readonly<{ limit?: UsageLimit }>;

  constructor(
    code: JudgeAssumptionInvalidationErrorCode,
    details: Readonly<{ limit?: UsageLimit }> = {},
  ) {
    super(code);
    this.name = "JudgeAssumptionInvalidationError";
    this.code = code;
    this.details =
      code === "USAGE_LIMIT_REACHED" && details.limit !== undefined
        ? { limit: details.limit }
        : {};
  }
}

export interface ConcreteAssumptionInvalidationEvaluator {
  evaluate(
    input: AssumptionInvalidationEvaluationInput,
  ): Promise<AssumptionInvalidationEvaluation>;
}

export interface JudgeAssumptionInvalidationRuntimeDependencies {
  readonly claims: JudgeManagedStructuredAiClaimRepository;
  readonly evaluator: ConcreteAssumptionInvalidationEvaluator;
  readonly ipAddress: string;
  readonly nextReservationId: () => string;
  readonly reconcile: (
    input: JudgeManagedStructuredAiReconcileRequest,
  ) => Promise<void>;
  readonly usage: JudgeManagedStructuredAiUsageLimiter;
}

export async function runJudgeAssumptionInvalidation<T>(input: {
  readonly authorization: UserAuthorizationContext;
  readonly canonicalizationVersion?: string;
  readonly claims: JudgeManagedStructuredAiClaimRepository;
  readonly clock: Clock;
  readonly dependencies: InvalidationEvaluationDependencies;
  readonly evaluator: ConcreteAssumptionInvalidationEvaluator;
  readonly execute: (
    dependencies: InvalidationEvaluationDependencies,
  ) => Promise<T> | T;
  readonly ipAddress: string;
  readonly nextReservationId: () => string;
  readonly reconcile: (
    input: JudgeManagedStructuredAiReconcileRequest,
  ) => Promise<void>;
  readonly usage: JudgeManagedStructuredAiUsageLimiter;
}): Promise<T> {
  if (
    input.authorization.role !== "facilitator" ||
    !input.authorization.capabilities.has("judge:managed-ai")
  ) {
    throw new JudgeAssumptionInvalidationError("OPENAI_UNAVAILABLE");
  }

  let providerStarted = false;
  const evaluator: AssumptionInvalidationEvaluator = {
    async evaluate(evaluationInput) {
      if (providerStarted) {
        throw new JudgeAssumptionInvalidationError("OPENAI_UNAVAILABLE");
      }
      providerStarted = true;
      const canonicalizationVersion =
        input.canonicalizationVersion ??
        JUDGE_STRUCTURED_INPUT_CANONICALIZATION_VERSION;
      const descriptor = invalidationDescriptor(canonicalizationVersion);
      try {
        return await runJudgeManagedStructuredAiOperation({
          actualUsage: (result) =>
            result.billing === undefined
              ? descriptor.reservedUsage
              : calculateJudgeStructuredAiActualUsage(
                  ASSUMPTION_INVALIDATION_OPERATION,
                  result.billing,
                ),
          claimKeyHash: await fingerprintJudgeStructuredInput({
            externalEventId:
              evaluationInput.externalEvent.externalEventId,
            meetingId: evaluationInput.meetingId,
            operation: ASSUMPTION_INVALIDATION_OPERATION,
            revisionId: evaluationInput.decision.revisionId,
          }),
          claims: input.claims,
          descriptor,
          model: DEFAULT_OPENAI_MODEL,
          nextReservationId: input.nextReservationId,
          nowEpoch: () => epochSeconds(input.clock.now()),
          provider: () => input.evaluator.evaluate(evaluationInput),
          providerInputBytes: measureJudgeProviderInputBytes(
            evaluationInput as unknown as Readonly<Record<string, unknown>>,
          ),
          reconcile: input.reconcile,
          requestFingerprint: await fingerprintJudgeStructuredInput(
            {
              input: evaluationInput,
              model: DEFAULT_OPENAI_MODEL,
              operation: ASSUMPTION_INVALIDATION_OPERATION,
              participantId: input.authorization.participantId,
              pricingVersion: descriptor.pricingVersion,
              userId: input.authorization.userId,
            },
            canonicalizationVersion,
          ),
          subject: {
            accountId: input.authorization.userId,
            ipAddress: input.ipAddress,
            meetingId: evaluationInput.meetingId,
          },
          usage: input.usage,
        });
      } catch (error) {
        if (error instanceof JudgeManagedStructuredAiError) {
          throw invalidationError(error);
        }
        throw error;
      }
    },
  };

  return input.execute({
    ...input.dependencies,
    evaluator,
  });
}

function invalidationDescriptor(canonicalizationVersion: string) {
  const descriptor =
    JUDGE_STRUCTURED_AI_DESCRIPTORS[ASSUMPTION_INVALIDATION_OPERATION];
  const suffix = `+${JUDGE_STRUCTURED_INPUT_CANONICALIZATION_VERSION}`;
  if (!descriptor.pricingVersion.endsWith(suffix)) {
    throw new JudgeAssumptionInvalidationError("OPENAI_UNAVAILABLE");
  }
  return {
    ...descriptor,
    pricingVersion:
      canonicalizationVersion ===
      JUDGE_STRUCTURED_INPUT_CANONICALIZATION_VERSION
        ? ASSUMPTION_INVALIDATION_PRICING_VERSION
        : `${descriptor.pricingVersion.slice(0, -suffix.length)}+${canonicalizationVersion}`,
  };
}

function invalidationError(
  error: JudgeManagedStructuredAiError,
): JudgeAssumptionInvalidationError {
  return new JudgeAssumptionInvalidationError(
    error.code,
    error.code === "USAGE_LIMIT_REACHED" ? error.details : {},
  );
}

function epochSeconds(value: string): number {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || milliseconds % 1_000 !== 0) {
    throw new JudgeAssumptionInvalidationError("OPENAI_UNAVAILABLE");
  }
  return milliseconds / 1_000;
}
