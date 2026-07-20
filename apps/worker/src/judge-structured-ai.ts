import {
  D1UsageLimiter,
  JUDGE_USAGE_PRODUCT_CEILING_MICRO_USD,
  type D1UsageLimiterLimits,
} from "@counterpoint/adapters-cloudflare";
import {
  ASSUMPTION_INVALIDATION_OPERATION,
  DECISION_SYNTHESIS_OPERATION,
  DEFAULT_OPENAI_MODEL,
  PRIVATE_DISCLOSURE_MAX_ATTEMPTS as ADAPTER_PRIVATE_DISCLOSURE_MAX_ATTEMPTS,
  PRIVATE_DISCLOSURE_OPERATION as ADAPTER_PRIVATE_DISCLOSURE_OPERATION,
  type PrivateDisclosureBilling,
  type StructuredAiBilling,
} from "@counterpoint/adapters-openai";
import type { UsageRequest } from "@counterpoint/ports";

const MICRO_USD_PER_USD = 1_000_000;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const LONG_CONTEXT_INPUT_TOKEN_THRESHOLD = 272_000;
const PRIVATE_DISCLOSURE_RESERVED_COST_MICRO_USD = 5_500_000;
const JUDGE_STRUCTURED_AI_MAX_GENERATIONS_PER_WINDOW = 8;
const JUDGE_STRUCTURED_AI_MAX_TOKENS_PER_WINDOW = 2_171_200;
const JUDGE_STRUCTURED_AI_INPUT_MAX_BYTES = 64 * 1024;
const JUDGE_STRUCTURED_AI_CLAIM_LEASE_SECONDS = 120;
const JUDGE_STRUCTURED_AI_RETENTION_SECONDS = 25 * 60 * 60;
const JUDGE_STRUCTURED_AI_PROVIDER_TIMEOUT_MS = 20_000;

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
  generationsPerWindow: JUDGE_STRUCTURED_AI_MAX_GENERATIONS_PER_WINDOW,
  ipRequestsPerWindow: 10,
  meetingRequestsPerWindow: 10,
  realtimeSecondsPerWindow: 30,
  tokensPerWindow: JUDGE_STRUCTURED_AI_MAX_TOKENS_PER_WINDOW,
};

export const JUDGE_STRUCTURED_INPUT_CANONICALIZATION_VERSION =
  "judge-structured-input-v1";
export const PRIVATE_DISCLOSURE_OPERATION =
  ADAPTER_PRIVATE_DISCLOSURE_OPERATION;
export const PRIVATE_DISCLOSURE_MODEL = DEFAULT_OPENAI_MODEL;
export const PRIVATE_DISCLOSURE_PRICING_VERSION =
  `openai-gpt-5.6-conservative-2026-07-20+${JUDGE_STRUCTURED_INPUT_CANONICALIZATION_VERSION}`;
export const DECISION_SYNTHESIS_PRICING_VERSION =
  `openai-gpt-5.6-decision-2026-07-20+${JUDGE_STRUCTURED_INPUT_CANONICALIZATION_VERSION}`;
export const ASSUMPTION_INVALIDATION_PRICING_VERSION =
  `openai-gpt-5.6-invalidation-2026-07-20+${JUDGE_STRUCTURED_INPUT_CANONICALIZATION_VERSION}`;
export const PRIVATE_DISCLOSURE_PROVIDER_TIMEOUT_MS =
  JUDGE_STRUCTURED_AI_PROVIDER_TIMEOUT_MS;
export const PRIVATE_DISCLOSURE_MAX_OUTPUT_TOKENS = 700;
// Two provider timeouts plus bounded retry/backoff and settlement.
export const PRIVATE_DISCLOSURE_CLAIM_TTL_SECONDS =
  JUDGE_STRUCTURED_AI_CLAIM_LEASE_SECONDS;
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

export type JudgeStructuredAiOperation =
  | typeof ASSUMPTION_INVALIDATION_OPERATION
  | typeof DECISION_SYNTHESIS_OPERATION
  | typeof PRIVATE_DISCLOSURE_OPERATION;

export interface JudgeStructuredAiDescriptor {
  readonly claimLeaseSeconds: number;
  readonly inputJsonMaxBytes: number;
  readonly operation: JudgeStructuredAiOperation;
  readonly pricingVersion: string;
  readonly providerTimeoutMs: number;
  readonly reservedUsage: UsageRequest;
  readonly retentionSeconds: number;
}

export const JUDGE_STRUCTURED_AI_DESCRIPTORS = {
  [ASSUMPTION_INVALIDATION_OPERATION]: {
    claimLeaseSeconds: JUDGE_STRUCTURED_AI_CLAIM_LEASE_SECONDS,
    inputJsonMaxBytes: JUDGE_STRUCTURED_AI_INPUT_MAX_BYTES,
    operation: ASSUMPTION_INVALIDATION_OPERATION,
    pricingVersion: ASSUMPTION_INVALIDATION_PRICING_VERSION,
    providerTimeoutMs: JUDGE_STRUCTURED_AI_PROVIDER_TIMEOUT_MS,
    reservedUsage: {
      estimatedCostUsd: 5.5,
      estimatedInputTokens: 540_000,
      estimatedOutputTokens: 1_600,
      generationCount: 2,
      realtimeSeconds: 0,
    },
    retentionSeconds: JUDGE_STRUCTURED_AI_RETENTION_SECONDS,
  },
  [PRIVATE_DISCLOSURE_OPERATION]: {
    claimLeaseSeconds: JUDGE_STRUCTURED_AI_CLAIM_LEASE_SECONDS,
    inputJsonMaxBytes: PRIVATE_DISCLOSURE_MAX_SOURCE_BYTES,
    operation: PRIVATE_DISCLOSURE_OPERATION,
    pricingVersion: PRIVATE_DISCLOSURE_PRICING_VERSION,
    providerTimeoutMs: PRIVATE_DISCLOSURE_PROVIDER_TIMEOUT_MS,
    reservedUsage: PRIVATE_DISCLOSURE_RESERVED_USAGE,
    retentionSeconds: JUDGE_STRUCTURED_AI_RETENTION_SECONDS,
  },
  [DECISION_SYNTHESIS_OPERATION]: {
    claimLeaseSeconds: JUDGE_STRUCTURED_AI_CLAIM_LEASE_SECONDS,
    inputJsonMaxBytes: JUDGE_STRUCTURED_AI_INPUT_MAX_BYTES,
    operation: DECISION_SYNTHESIS_OPERATION,
    pricingVersion: DECISION_SYNTHESIS_PRICING_VERSION,
    providerTimeoutMs: JUDGE_STRUCTURED_AI_PROVIDER_TIMEOUT_MS,
    reservedUsage: {
      estimatedCostUsd: 5.75,
      estimatedInputTokens: 540_000,
      estimatedOutputTokens: 2_800,
      generationCount: 2,
      realtimeSeconds: 0,
    },
    retentionSeconds: JUDGE_STRUCTURED_AI_RETENTION_SECONDS,
  },
} as const satisfies Readonly<
  Record<JudgeStructuredAiOperation, JudgeStructuredAiDescriptor>
>;

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

export function measureJudgeProviderInputBytes(
  input: Readonly<Record<string, unknown>>,
): number {
  const providerInput: Record<string, unknown> = { ...input };
  delete providerInput.meetingId;
  const serialized = JSON.stringify(providerInput);
  if (serialized === undefined) {
    throw new TypeError("Structured AI provider input must be serializable.");
  }
  return new TextEncoder().encode(serialized).byteLength;
}

export function canonicalizeJudgeStructuredInput(input: unknown): string {
  const serialized = JSON.stringify(canonicalValue(input));
  if (serialized === undefined) {
    throw new TypeError("Structured AI input must be serializable.");
  }
  return serialized;
}

export async function fingerprintJudgeStructuredInput(
  input: unknown,
  canonicalizationVersion = JUDGE_STRUCTURED_INPUT_CANONICALIZATION_VERSION,
): Promise<string> {
  if (canonicalizationVersion.length === 0) {
    throw new TypeError("Canonicalization version must not be empty.");
  }
  const payload = canonicalizeJudgeStructuredInput({
    canonicalizationVersion,
    input,
  });
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(payload),
  );
  return `sha256:${Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")}`;
}

export function pricePrivateDisclosureUsageMicroUsd(
  model: string,
  billing: PrivateDisclosureBilling,
): number {
  tokenRates(model);
  return priceJudgeStructuredAiUsageMicroUsd(billing);
}

export function priceJudgeStructuredAiUsageMicroUsd(
  billing: StructuredAiBilling,
): number {
  assertBilling(billing);
  // Cached-input details are intentionally billed at the uncached rate. This
  // can only reduce the available judge budget; it cannot overspend the cap.
  const microUsd = billing.attempts.reduce((sum, attempt) => {
    const rates = tokenRates(attempt.model);
    const longContext =
      attempt.inputTokens > LONG_CONTEXT_INPUT_TOKEN_THRESHOLD;
    const inputMultiplier = longContext ? 4n : 2n;
    const outputMultiplier = longContext ? 3n : 2n;
    const denominator = rates.denominator * 2n;
    const numerator =
      BigInt(attempt.inputTokens) * rates.inputNumerator * inputMultiplier +
      BigInt(attempt.outputTokens) * rates.outputNumerator * outputMultiplier;
    return sum + (numerator + denominator - 1n) / denominator;
  }, 0n);
  if (microUsd > MAX_SAFE_INTEGER_BIGINT) {
    throw new RangeError("Structured AI cost exceeds safe integer range.");
  }
  return Number(microUsd);
}

export function calculatePrivateDisclosureActualUsage(
  model: string,
  billing: PrivateDisclosureBilling,
): UsageRequest {
  tokenRates(model);
  return calculateJudgeStructuredAiActualUsage(
    PRIVATE_DISCLOSURE_OPERATION,
    billing,
  );
}

export function calculateJudgeStructuredAiActualUsage(
  operation: JudgeStructuredAiOperation,
  billing: StructuredAiBilling,
): UsageRequest {
  const descriptor = JUDGE_STRUCTURED_AI_DESCRIPTORS[operation];
  assertWithinReservation(billing, descriptor);
  const costMicroUsd = priceJudgeStructuredAiUsageMicroUsd(billing);
  const reservedCostMicroUsd = Math.round(
    descriptor.reservedUsage.estimatedCostUsd * MICRO_USD_PER_USD,
  );
  if (costMicroUsd > reservedCostMicroUsd) {
    throw new RangeError("Structured AI actual cost exceeds its reservation.");
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
    throw new RangeError(
      `Unsupported structured AI response model: ${model}`,
    );
  }
  return GPT_5_6_TOKEN_RATES[model as keyof typeof GPT_5_6_TOKEN_RATES];
}

function assertBilling(billing: StructuredAiBilling): void {
  assertSafeNonnegativeInteger(billing.inputTokens, "inputTokens");
  assertSafeNonnegativeInteger(billing.outputTokens, "outputTokens");
  if (!Number.isSafeInteger(billing.attemptCount) || billing.attemptCount < 1) {
    throw new RangeError(
      "Structured AI attemptCount must be a positive safe integer.",
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
      "Structured AI attempts must match the trustworthy attempt count.",
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
      "Structured AI aggregate usage must match its attempts.",
    );
  }
}

function assertSafeNonnegativeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(
      `Structured AI ${label} must be a nonnegative safe integer.`,
    );
  }
}

function assertWithinReservation(
  billing: StructuredAiBilling,
  descriptor: JudgeStructuredAiDescriptor,
): void {
  assertBilling(billing);
  if (
    billing.attemptCount > descriptor.reservedUsage.generationCount ||
    billing.inputTokens >
      descriptor.reservedUsage.estimatedInputTokens ||
    billing.outputTokens >
      descriptor.reservedUsage.estimatedOutputTokens
  ) {
    throw new RangeError("Structured AI actual usage exceeds its reservation.");
  }
}

const ENTITY_ID_KEYS = [
  "actionId",
  "decisionId",
  "dissentId",
  "evidenceId",
  "evidenceReferenceId",
  "externalEventId",
  "premiseId",
  "revisionId",
] as const;

const UNORDERED_STRING_ARRAY_KEYS = new Set([
  "affectedActionIds",
  "affectedPremiseIds",
  "evidenceReferenceIds",
  "participantIds",
]);

function isEnumerableDataProperty(
  descriptor: PropertyDescriptor | undefined,
): descriptor is PropertyDescriptor & { value: unknown } {
  return descriptor?.enumerable === true && Object.hasOwn(descriptor, "value");
}

function canonicalValue(value: unknown, parentKey?: string): unknown {
  if (Array.isArray(value)) {
    const prototype = Object.getPrototypeOf(value) as unknown;
    const ownKeys = Reflect.ownKeys(value);
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    const indexDescriptors = Array.from({ length: value.length }, (_, index) =>
      Object.getOwnPropertyDescriptor(value, String(index)),
    );
    if (
      prototype !== Array.prototype ||
      ownKeys.length !== value.length + 1 ||
      ownKeys.some((key) => typeof key === "symbol") ||
      lengthDescriptor === undefined ||
      !Object.hasOwn(lengthDescriptor, "value") ||
      lengthDescriptor.enumerable === true ||
      !indexDescriptors.every(isEnumerableDataProperty)
    ) {
      throw new TypeError("Structured AI input contains a non-JSON value.");
    }
    const values = indexDescriptors.map((descriptor) =>
      canonicalValue(descriptor.value),
    );
    if (
      parentKey !== undefined &&
      UNORDERED_STRING_ARRAY_KEYS.has(parentKey) &&
      values.every((item) => typeof item === "string")
    ) {
      return values.toSorted((left, right) =>
        compareStrings(String(left), String(right)),
      );
    }
    const entityIdKey = commonEntityIdKey(values);
    if (entityIdKey !== undefined) {
      return values.toSorted((left, right) =>
        compareCanonicalEntities(left, right, entityIdKey),
      );
    }
    return values;
  }
  if (value !== null && typeof value === "object") {
    const prototype = Object.getPrototypeOf(value) as unknown;
    const ownKeys = Reflect.ownKeys(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (
      (prototype !== Object.prototype && prototype !== null) ||
      ownKeys.some((key) => typeof key === "symbol") ||
      ownKeys.some(
        (key) => !isEnumerableDataProperty(descriptors[String(key)]),
      )
    ) {
      throw new TypeError("Structured AI input contains a non-JSON value.");
    }
    return Object.fromEntries(
      ownKeys
        .map(String)
        .toSorted(compareStrings)
        .map((key) => [
          key,
          canonicalValue(descriptors[key]!.value, key),
        ]),
    );
  }
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  throw new TypeError("Structured AI input contains a non-JSON value.");
}

function commonEntityIdKey(values: readonly unknown[]): string | undefined {
  if (values.length === 0) {
    return undefined;
  }
  return ENTITY_ID_KEYS.find((key) =>
    values.every(
      (value) =>
        value !== null &&
        typeof value === "object" &&
        typeof (value as Readonly<Record<string, unknown>>)[key] === "string",
    ),
  );
}

function entityId(value: unknown, key: string): string {
  return String((value as Readonly<Record<string, unknown>>)[key]);
}

function compareCanonicalEntities(
  left: unknown,
  right: unknown,
  idKey: string,
): number {
  const idComparison = compareStrings(
    entityId(left, idKey),
    entityId(right, idKey),
  );
  if (idComparison !== 0) {
    return idComparison;
  }
  return compareStrings(
    JSON.stringify(left) ?? "",
    JSON.stringify(right) ?? "",
  );
}

function compareStrings(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  return left > right ? 1 : 0;
}
