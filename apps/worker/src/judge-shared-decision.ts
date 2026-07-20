import {
  DEFAULT_OPENAI_MODEL,
  DECISION_SYNTHESIS_OPERATION,
  type SharedDecisionSynthesis,
} from "@counterpoint/adapters-openai";
import type {
  DecisionCandidateDependencies,
  SharedDecisionSynthesisInput,
  SharedDecisionSynthesizer,
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
  DECISION_SYNTHESIS_PRICING_VERSION,
  JUDGE_STRUCTURED_AI_DESCRIPTORS,
  JUDGE_STRUCTURED_INPUT_CANONICALIZATION_VERSION,
  calculateJudgeStructuredAiActualUsage,
  fingerprintJudgeStructuredInput,
  measureJudgeProviderInputBytes,
} from "./judge-structured-ai.js";

type UsageLimit = Extract<UsageDecision, { kind: "denied" }>["limit"];

export type JudgeSharedDecisionErrorCode =
  | "IDEMPOTENCY_CONFLICT"
  | "OPENAI_UNAVAILABLE"
  | "USAGE_LIMIT_REACHED"
  | "VALIDATION_FAILED";

export class JudgeSharedDecisionError extends Error {
  readonly code: JudgeSharedDecisionErrorCode;
  readonly details: Readonly<{ limit?: UsageLimit }>;

  constructor(
    code: JudgeSharedDecisionErrorCode,
    details: Readonly<{ limit?: UsageLimit }> = {},
  ) {
    super(code);
    this.name = "JudgeSharedDecisionError";
    this.code = code;
    this.details =
      code === "USAGE_LIMIT_REACHED" && details.limit !== undefined
        ? { limit: details.limit }
        : {};
  }
}

export interface ConcreteSharedDecisionSynthesizer {
  synthesize(
    input: SharedDecisionSynthesisInput,
  ): Promise<SharedDecisionSynthesis>;
}

export interface JudgeSharedDecisionRuntimeDependencies {
  readonly claims: JudgeManagedStructuredAiClaimRepository;
  readonly ipAddress: string;
  readonly nextReservationId: () => string;
  readonly reconcile: (
    input: JudgeManagedStructuredAiReconcileRequest,
  ) => Promise<void>;
  readonly synthesizer: ConcreteSharedDecisionSynthesizer;
  readonly usage: JudgeManagedStructuredAiUsageLimiter;
}

export interface JudgeSharedDecisionRequest {
  readonly assistance: "ai_preferred";
  readonly idempotencyKey: string;
  readonly meetingId: string;
}

export async function runJudgeSharedDecision<T>(input: {
  readonly authorization: UserAuthorizationContext;
  readonly canonicalizationVersion?: string;
  readonly claims: JudgeManagedStructuredAiClaimRepository;
  readonly clock: Clock;
  readonly dependencies: DecisionCandidateDependencies;
  readonly execute: (
    dependencies: DecisionCandidateDependencies,
  ) => Promise<T> | T;
  readonly ipAddress: string;
  readonly nextReservationId: () => string;
  readonly reconcile: (
    input: JudgeManagedStructuredAiReconcileRequest,
  ) => Promise<void>;
  readonly request: JudgeSharedDecisionRequest;
  readonly synthesizer: ConcreteSharedDecisionSynthesizer;
  readonly usage: JudgeManagedStructuredAiUsageLimiter;
}): Promise<T> {
  if (
    input.authorization.role !== "facilitator" ||
    !input.authorization.capabilities.has("judge:managed-ai")
  ) {
    throw new JudgeSharedDecisionError("OPENAI_UNAVAILABLE");
  }

  let providerStarted = false;
  const synthesizer: SharedDecisionSynthesizer = {
    async synthesize(synthesisInput) {
      if (providerStarted) {
        throw new JudgeSharedDecisionError("OPENAI_UNAVAILABLE");
      }
      providerStarted = true;
      const canonicalizationVersion =
        input.canonicalizationVersion ??
        JUDGE_STRUCTURED_INPUT_CANONICALIZATION_VERSION;
      const descriptor = decisionDescriptor(canonicalizationVersion);
      try {
        return await runJudgeManagedStructuredAiOperation({
          actualUsage: (result) =>
            result.billing === undefined
              ? descriptor.reservedUsage
              : calculateJudgeStructuredAiActualUsage(
                  DECISION_SYNTHESIS_OPERATION,
                  result.billing,
                ),
          claimKeyHash: await fingerprintJudgeStructuredInput({
            idempotencyKey: input.request.idempotencyKey,
            meetingId: input.request.meetingId,
            operation: DECISION_SYNTHESIS_OPERATION,
          }),
          claims: input.claims,
          descriptor,
          model: DEFAULT_OPENAI_MODEL,
          nextReservationId: input.nextReservationId,
          nowEpoch: () => epochSeconds(input.clock.now()),
          provider: () => input.synthesizer.synthesize(synthesisInput),
          providerInputBytes: measureJudgeProviderInputBytes(
            synthesisInput as unknown as Readonly<Record<string, unknown>>,
          ),
          reconcile: input.reconcile,
          requestFingerprint: await fingerprintJudgeStructuredInput(
            {
              idempotencyKey: input.request.idempotencyKey,
              input: synthesisInput,
              meetingId: input.request.meetingId,
              model: DEFAULT_OPENAI_MODEL,
              operation: DECISION_SYNTHESIS_OPERATION,
              participantId: input.authorization.participantId,
              pricingVersion: descriptor.pricingVersion,
              userId: input.authorization.userId,
            },
            canonicalizationVersion,
          ),
          subject: {
            accountId: input.authorization.userId,
            ipAddress: input.ipAddress,
            meetingId: input.request.meetingId,
          },
          usage: input.usage,
        });
      } catch (error) {
        if (error instanceof JudgeManagedStructuredAiError) {
          throw sharedDecisionError(error);
        }
        throw error;
      }
    },
  };

  return input.execute({
    ...input.dependencies,
    synthesizer,
  });
}

function decisionDescriptor(canonicalizationVersion: string) {
  const descriptor =
    JUDGE_STRUCTURED_AI_DESCRIPTORS[DECISION_SYNTHESIS_OPERATION];
  const suffix = `+${JUDGE_STRUCTURED_INPUT_CANONICALIZATION_VERSION}`;
  if (!descriptor.pricingVersion.endsWith(suffix)) {
    throw new JudgeSharedDecisionError("OPENAI_UNAVAILABLE");
  }
  return {
    ...descriptor,
    pricingVersion:
      canonicalizationVersion ===
      JUDGE_STRUCTURED_INPUT_CANONICALIZATION_VERSION
        ? DECISION_SYNTHESIS_PRICING_VERSION
        : `${descriptor.pricingVersion.slice(0, -suffix.length)}+${canonicalizationVersion}`,
  };
}

function sharedDecisionError(
  error: JudgeManagedStructuredAiError,
): JudgeSharedDecisionError {
  return new JudgeSharedDecisionError(
    error.code,
    error.code === "USAGE_LIMIT_REACHED" ? error.details : {},
  );
}

function epochSeconds(value: string): number {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || milliseconds % 1_000 !== 0) {
    throw new JudgeSharedDecisionError("OPENAI_UNAVAILABLE");
  }
  return milliseconds / 1_000;
}
