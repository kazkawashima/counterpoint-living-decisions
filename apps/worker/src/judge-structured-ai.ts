import {
  D1UsageLimiter,
  JUDGE_USAGE_PRODUCT_CEILING_MICRO_USD,
  type D1UsageLimiterLimits,
} from "@counterpoint/adapters-cloudflare";
import {
  DEFAULT_OPENAI_MODEL,
  PRIVATE_DISCLOSURE_MAX_ATTEMPTS as ADAPTER_PRIVATE_DISCLOSURE_MAX_ATTEMPTS,
  PRIVATE_DISCLOSURE_OPERATION as ADAPTER_PRIVATE_DISCLOSURE_OPERATION,
  type PrivateDisclosureBilling,
} from "@counterpoint/adapters-openai";
import type { UsageRequest } from "@counterpoint/ports";

const MICRO_USD_PER_USD = 1_000_000;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const LONG_CONTEXT_INPUT_TOKEN_THRESHOLD = 272_000;
const PRIVATE_DISCLOSURE_RESERVED_COST_MICRO_USD = 5_500_000;
const JUDGE_MAX_PRIVATE_DISCLOSURE_RESERVATIONS_PER_WINDOW = Math.floor(
  JUDGE_USAGE_PRODUCT_CEILING_MICRO_USD /
    PRIVATE_DISCLOSURE_RESERVED_COST_MICRO_USD,
);

type JudgeGlobalUsageLimits = Omit<
  D1UsageLimiterLimits,
  "reservationTtlSeconds"
>;

interface TokenRates {
  readonly denominator: bigint;
  readonly inputNumerator: bigint;
  readonly outputNumerator: bigint;
}

const GPT_5_6_TOKEN_RATES = {
  "gpt-5.6": {
    denominator: 1n,
    inputNumerator: 5n,
    outputNumerator: 30n,
  },
  "gpt-5.6-luna": {
    denominator: 1n,
    inputNumerator: 1n,
    outputNumerator: 6n,
  },
  "gpt-5.6-sol": {
    denominator: 1n,
    inputNumerator: 5n,
    outputNumerator: 30n,
  },
  "gpt-5.6-terra": {
    denominator: 2n,
    inputNumerator: 5n,
    outputNumerator: 30n,
  },
} as const satisfies Readonly<Record<string, TokenRates>>;

export const JUDGE_GLOBAL_USAGE_LIMITS: JudgeGlobalUsageLimits = {
  accountRequestsPerWindow: 10,
  concurrentReservations: 1,
  costMicroUsdPerWindow: JUDGE_USAGE_PRODUCT_CEILING_MICRO_USD,
  generationsPerWindow:
    JUDGE_MAX_PRIVATE_DISCLOSURE_RESERVATIONS_PER_WINDOW *
    ADAPTER_PRIVATE_DISCLOSURE_MAX_ATTEMPTS,
  ipRequestsPerWindow: 10,
  meetingRequestsPerWindow: 10,
  realtimeSecondsPerWindow: 30,
  tokensPerWindow:
    JUDGE_MAX_PRIVATE_DISCLOSURE_RESERVATIONS_PER_WINDOW * (540_000 + 1_400),
};

export const PRIVATE_DISCLOSURE_OPERATION =
  ADAPTER_PRIVATE_DISCLOSURE_OPERATION;
export const PRIVATE_DISCLOSURE_MODEL = DEFAULT_OPENAI_MODEL;
export const PRIVATE_DISCLOSURE_PRICING_VERSION =
  "openai-gpt-5.6-conservative-2026-07-20";
export const PRIVATE_DISCLOSURE_PROVIDER_TIMEOUT_MS = 20_000;
export const PRIVATE_DISCLOSURE_MAX_OUTPUT_TOKENS = 700;
// Two provider timeouts plus bounded retry/backoff and settlement.
export const PRIVATE_DISCLOSURE_CLAIM_TTL_SECONDS = 120;
export const PRIVATE_DISCLOSURE_MAX_ATTEMPTS =
  ADAPTER_PRIVATE_DISCLOSURE_MAX_ATTEMPTS;
export const PRIVATE_DISCLOSURE_MAX_SOURCE_BYTES = 64 * 1024;
export const PRIVATE_DISCLOSURE_RESERVED_USAGE: UsageRequest = {
  estimatedCostUsd:
    PRIVATE_DISCLOSURE_RESERVED_COST_MICRO_USD / MICRO_USD_PER_USD,
  estimatedInputTokens: 540_000,
  estimatedOutputTokens: 1_400,
  generationCount: PRIVATE_DISCLOSURE_MAX_ATTEMPTS,
  realtimeSeconds: 0,
};

const PRIVATE_DISCLOSURE_MAX_PROVIDER_DURATION_MS =
  PRIVATE_DISCLOSURE_PROVIDER_TIMEOUT_MS * PRIVATE_DISCLOSURE_MAX_ATTEMPTS;
if (
  PRIVATE_DISCLOSURE_CLAIM_TTL_SECONDS * 1_000 <=
  PRIVATE_DISCLOSURE_MAX_PROVIDER_DURATION_MS
) {
  throw new Error(
    "Private disclosure claim TTL must exceed the maximum provider duration.",
  );
}

export function createJudgePrivateDisclosureUsageLimiter(
  database: D1Database,
  options: {
    readonly clock: () => string;
    readonly hashIp: (ipAddress: string) => Promise<string>;
    readonly ids: (namespace: string) => string;
  },
): D1UsageLimiter {
  return new D1UsageLimiter(database, {
    clock: options.clock,
    hashIp: options.hashIp,
    ids: options.ids,
    limits: {
      ...JUDGE_GLOBAL_USAGE_LIMITS,
      reservationTtlSeconds: PRIVATE_DISCLOSURE_CLAIM_TTL_SECONDS,
    },
    model: PRIVATE_DISCLOSURE_MODEL,
    operation: PRIVATE_DISCLOSURE_OPERATION,
    pricingVersion: PRIVATE_DISCLOSURE_PRICING_VERSION,
  });
}

export function assertPrivateDisclosureSourceWithinLimit(
  sourceText: string,
): void {
  if (
    new TextEncoder().encode(sourceText).byteLength >
    PRIVATE_DISCLOSURE_MAX_SOURCE_BYTES
  ) {
    throw new RangeError("Private disclosure source must not exceed 64 KiB.");
  }
}

export function pricePrivateDisclosureUsageMicroUsd(
  model: string,
  billing: PrivateDisclosureBilling,
): number {
  const rates = tokenRates(model);
  assertBilling(billing);
  // Cached-input details are intentionally billed at the uncached rate. This
  // can only reduce the available judge budget; it cannot overspend the cap.
  const denominator = rates.denominator * 2n;
  const numerator = billing.attempts.reduce((sum, attempt) => {
    const longContext =
      attempt.inputTokens > LONG_CONTEXT_INPUT_TOKEN_THRESHOLD;
    const inputMultiplier = longContext ? 4n : 2n;
    const outputMultiplier = longContext ? 3n : 2n;
    return (
      sum +
      BigInt(attempt.inputTokens) * rates.inputNumerator * inputMultiplier +
      BigInt(attempt.outputTokens) * rates.outputNumerator * outputMultiplier
    );
  }, 0n);
  const microUsd = (numerator + denominator - 1n) / denominator;
  if (microUsd > MAX_SAFE_INTEGER_BIGINT) {
    throw new RangeError("Private disclosure cost exceeds safe integer range.");
  }
  return Number(microUsd);
}

export function calculatePrivateDisclosureActualUsage(
  model: string,
  billing: PrivateDisclosureBilling,
): UsageRequest {
  assertWithinReservation(billing);
  const costMicroUsd = pricePrivateDisclosureUsageMicroUsd(model, billing);
  const reservedCostMicroUsd = Math.round(
    PRIVATE_DISCLOSURE_RESERVED_USAGE.estimatedCostUsd * MICRO_USD_PER_USD,
  );
  if (costMicroUsd > reservedCostMicroUsd) {
    throw new RangeError(
      "Private disclosure actual cost exceeds its reservation.",
    );
  }
  return {
    estimatedCostUsd: costMicroUsd / MICRO_USD_PER_USD,
    estimatedInputTokens: billing.inputTokens,
    estimatedOutputTokens: billing.outputTokens,
    generationCount: billing.attemptCount,
    realtimeSeconds: 0,
  };
}

function tokenRates(model: string): TokenRates {
  if (!Object.hasOwn(GPT_5_6_TOKEN_RATES, model)) {
    throw new RangeError(`Unsupported private disclosure model: ${model}`);
  }
  return GPT_5_6_TOKEN_RATES[model as keyof typeof GPT_5_6_TOKEN_RATES];
}

function assertBilling(billing: PrivateDisclosureBilling): void {
  assertSafeNonnegativeInteger(billing.inputTokens, "inputTokens");
  assertSafeNonnegativeInteger(billing.outputTokens, "outputTokens");
  if (!Number.isSafeInteger(billing.attemptCount) || billing.attemptCount < 1) {
    throw new RangeError(
      "Private disclosure attemptCount must be a positive safe integer.",
    );
  }
  if (
    billing.attempts.length !== billing.attemptCount ||
    billing.attempts.some((attempt) => {
      try {
        assertSafeNonnegativeInteger(
          attempt.inputTokens,
          "attempt inputTokens",
        );
        assertSafeNonnegativeInteger(
          attempt.outputTokens,
          "attempt outputTokens",
        );
        return false;
      } catch {
        return true;
      }
    })
  ) {
    throw new RangeError(
      "Private disclosure attempts must match the trustworthy attempt count.",
    );
  }
  const attemptInputTokens = billing.attempts.reduce(
    (sum, attempt) => sum + attempt.inputTokens,
    0,
  );
  const attemptOutputTokens = billing.attempts.reduce(
    (sum, attempt) => sum + attempt.outputTokens,
    0,
  );
  if (
    !Number.isSafeInteger(attemptInputTokens) ||
    !Number.isSafeInteger(attemptOutputTokens) ||
    attemptInputTokens !== billing.inputTokens ||
    attemptOutputTokens !== billing.outputTokens
  ) {
    throw new RangeError(
      "Private disclosure aggregate usage must match its attempts.",
    );
  }
}

function assertSafeNonnegativeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(
      `Private disclosure ${label} must be a nonnegative safe integer.`,
    );
  }
}

function assertWithinReservation(billing: PrivateDisclosureBilling): void {
  assertBilling(billing);
  if (
    billing.attemptCount > PRIVATE_DISCLOSURE_RESERVED_USAGE.generationCount ||
    billing.inputTokens >
      PRIVATE_DISCLOSURE_RESERVED_USAGE.estimatedInputTokens ||
    billing.outputTokens >
      PRIVATE_DISCLOSURE_RESERVED_USAGE.estimatedOutputTokens
  ) {
    throw new RangeError(
      "Private disclosure actual usage exceeds its reservation.",
    );
  }
}
