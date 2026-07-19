export const GPT_REALTIME_2_1_PRICING_VERSION = "gpt-realtime-2.1-2026-07-19";

// Official per-million-token prices checked on 2026-07-19. Deci-micro-USD
// keeps the $0.40 and $0.50 cached rates exact before conservative rounding.
const MAX_PROVIDER_IDENTIFIER_LENGTH = 255;
const DECI_MICRO_USD_PER_TOKEN = {
  cachedAudioInput: 4,
  cachedImageInput: 5,
  cachedTextInput: 4,
  uncachedAudioInput: 320,
  uncachedImageInput: 50,
  uncachedTextInput: 40,
  audioOutput: 640,
  textOutput: 240,
} as const;

export interface OpenAiRealtimeResponseUsage {
  readonly eventId: string;
  readonly responseId: string;
  readonly input: {
    readonly audioTokens: number;
    readonly cachedAudioTokens: number;
    readonly cachedImageTokens: number;
    readonly cachedTextTokens: number;
    readonly imageTokens: number;
    readonly textTokens: number;
    readonly totalTokens: number;
  };
  readonly output: {
    readonly audioTokens: number;
    readonly textTokens: number;
    readonly totalTokens: number;
  };
}

export interface OpenAiRealtimeUsageLimits {
  readonly costMicroUsd: number;
  readonly generationCount: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface OpenAiRealtimeUsageTotals {
  readonly costMicroUsd: number;
  readonly generationCount: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface OpenAiRealtimeUsageState {
  readonly entries: readonly OpenAiRealtimeResponseUsage[];
  readonly trustworthy: boolean;
  readonly totals: OpenAiRealtimeUsageTotals;
}

export type OpenAiRealtimeUsageRecordResult =
  | {
      readonly kind: "ignored" | "duplicate" | "recorded";
      readonly state: OpenAiRealtimeUsageState;
    }
  | {
      readonly kind: "invalid" | "limit_exceeded";
      readonly state: OpenAiRealtimeUsageState;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const allowed = new Set(expected);
  return (
    expected.every((key) => key in value) &&
    Object.keys(value).every((key) => allowed.has(key))
  );
}

function identifier(value: unknown): string | undefined {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_PROVIDER_IDENTIFIER_LENGTH &&
    value.trim() === value
    ? value
    : undefined;
}

function tokenCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function safeSum(values: readonly number[]): number | undefined {
  const total = values.reduce((sum, value) => sum + value, 0);
  return Number.isSafeInteger(total) ? total : undefined;
}

function usageDetails(value: unknown):
  | {
      readonly input: OpenAiRealtimeResponseUsage["input"];
      readonly output: OpenAiRealtimeResponseUsage["output"];
    }
  | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (
    !exactKeys(value, [
      "input_token_details",
      "input_tokens",
      "output_token_details",
      "output_tokens",
      "total_tokens",
    ])
  ) {
    return undefined;
  }
  const inputTokens = tokenCount(value.input_tokens);
  const outputTokens = tokenCount(value.output_tokens);
  const totalTokens = tokenCount(value.total_tokens);
  const inputDetails = value.input_token_details;
  const outputDetails = value.output_token_details;
  if (
    inputTokens === undefined ||
    outputTokens === undefined ||
    totalTokens === undefined ||
    !isRecord(inputDetails) ||
    !isRecord(outputDetails)
  ) {
    return undefined;
  }
  if (
    !exactKeys(inputDetails, [
      "audio_tokens",
      "cached_tokens",
      "cached_tokens_details",
      "image_tokens",
      "text_tokens",
    ]) ||
    !exactKeys(outputDetails, ["audio_tokens", "text_tokens"])
  ) {
    return undefined;
  }

  const inputTextTokens = tokenCount(inputDetails.text_tokens);
  const inputAudioTokens = tokenCount(inputDetails.audio_tokens);
  const inputImageTokens = tokenCount(inputDetails.image_tokens);
  const cachedTokens = tokenCount(inputDetails.cached_tokens);
  const cachedDetails = inputDetails.cached_tokens_details;
  const outputTextTokens = tokenCount(outputDetails.text_tokens);
  const outputAudioTokens = tokenCount(outputDetails.audio_tokens);
  if (
    inputTextTokens === undefined ||
    inputAudioTokens === undefined ||
    inputImageTokens === undefined ||
    cachedTokens === undefined ||
    !isRecord(cachedDetails) ||
    outputTextTokens === undefined ||
    outputAudioTokens === undefined
  ) {
    return undefined;
  }
  if (
    !exactKeys(cachedDetails, ["audio_tokens", "image_tokens", "text_tokens"])
  ) {
    return undefined;
  }

  const cachedTextTokens = tokenCount(cachedDetails.text_tokens);
  const cachedAudioTokens = tokenCount(cachedDetails.audio_tokens);
  const cachedImageTokens = tokenCount(cachedDetails.image_tokens);
  if (
    cachedTextTokens === undefined ||
    cachedAudioTokens === undefined ||
    cachedImageTokens === undefined ||
    cachedTextTokens > inputTextTokens ||
    cachedAudioTokens > inputAudioTokens ||
    cachedImageTokens > inputImageTokens
  ) {
    return undefined;
  }

  const computedInput = safeSum([
    inputTextTokens,
    inputAudioTokens,
    inputImageTokens,
  ]);
  const computedCached = safeSum([
    cachedTextTokens,
    cachedAudioTokens,
    cachedImageTokens,
  ]);
  const computedOutput = safeSum([outputTextTokens, outputAudioTokens]);
  const computedTotal = safeSum([inputTokens, outputTokens]);
  if (
    computedInput !== inputTokens ||
    computedCached !== cachedTokens ||
    computedOutput !== outputTokens ||
    computedTotal !== totalTokens
  ) {
    return undefined;
  }

  return {
    input: {
      audioTokens: inputAudioTokens,
      cachedAudioTokens,
      cachedImageTokens,
      cachedTextTokens,
      imageTokens: inputImageTokens,
      textTokens: inputTextTokens,
      totalTokens: inputTokens,
    },
    output: {
      audioTokens: outputAudioTokens,
      textTokens: outputTextTokens,
      totalTokens: outputTokens,
    },
  };
}

export function parseOpenAiRealtimeResponseDoneUsage(
  value: unknown,
): OpenAiRealtimeResponseUsage | undefined {
  if (!isRecord(value) || value.type !== "response.done") {
    return undefined;
  }
  const eventId = identifier(value.event_id);
  const response = value.response;
  if (eventId === undefined || !isRecord(response)) {
    return undefined;
  }
  const responseId = identifier(response.id);
  const details = usageDetails(response.usage);
  if (responseId === undefined || details === undefined) {
    return undefined;
  }
  return {
    eventId,
    responseId,
    ...details,
  };
}

export function priceGptRealtime21UsageMicroUsd(
  usage: OpenAiRealtimeResponseUsage,
): number {
  const counts = [
    usage.input.textTokens,
    usage.input.audioTokens,
    usage.input.imageTokens,
    usage.input.cachedTextTokens,
    usage.input.cachedAudioTokens,
    usage.input.cachedImageTokens,
    usage.input.totalTokens,
    usage.output.textTokens,
    usage.output.audioTokens,
    usage.output.totalTokens,
  ];
  if (
    counts.some((value) => tokenCount(value) === undefined) ||
    usage.input.cachedTextTokens > usage.input.textTokens ||
    usage.input.cachedAudioTokens > usage.input.audioTokens ||
    usage.input.cachedImageTokens > usage.input.imageTokens ||
    safeSum([
      usage.input.textTokens,
      usage.input.audioTokens,
      usage.input.imageTokens,
    ]) !== usage.input.totalTokens ||
    safeSum([usage.output.textTokens, usage.output.audioTokens]) !==
      usage.output.totalTokens
  ) {
    throw new TypeError("Realtime usage cannot be priced safely");
  }
  const uncachedTextInput =
    usage.input.textTokens - usage.input.cachedTextTokens;
  const uncachedAudioInput =
    usage.input.audioTokens - usage.input.cachedAudioTokens;
  const uncachedImageInput =
    usage.input.imageTokens - usage.input.cachedImageTokens;
  const deciMicroUsd =
    uncachedTextInput * DECI_MICRO_USD_PER_TOKEN.uncachedTextInput +
    usage.input.cachedTextTokens * DECI_MICRO_USD_PER_TOKEN.cachedTextInput +
    uncachedAudioInput * DECI_MICRO_USD_PER_TOKEN.uncachedAudioInput +
    usage.input.cachedAudioTokens * DECI_MICRO_USD_PER_TOKEN.cachedAudioInput +
    uncachedImageInput * DECI_MICRO_USD_PER_TOKEN.uncachedImageInput +
    usage.input.cachedImageTokens * DECI_MICRO_USD_PER_TOKEN.cachedImageInput +
    usage.output.textTokens * DECI_MICRO_USD_PER_TOKEN.textOutput +
    usage.output.audioTokens * DECI_MICRO_USD_PER_TOKEN.audioOutput;
  if (!Number.isSafeInteger(deciMicroUsd)) {
    throw new RangeError("Realtime usage price exceeds safe integer range");
  }
  return Math.ceil(deciMicroUsd / 10);
}

export function emptyOpenAiRealtimeUsageState(): OpenAiRealtimeUsageState {
  return {
    entries: [],
    totals: {
      costMicroUsd: 0,
      generationCount: 0,
      inputTokens: 0,
      outputTokens: 0,
    },
    trustworthy: true,
  };
}

function sameUsage(
  left: OpenAiRealtimeResponseUsage,
  right: OpenAiRealtimeResponseUsage,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function invalidState(
  state: OpenAiRealtimeUsageState,
): OpenAiRealtimeUsageState {
  return state.trustworthy ? { ...state, trustworthy: false } : state;
}

function validLimit(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

export function recordOpenAiRealtimeServerEvent(
  state: OpenAiRealtimeUsageState,
  event: unknown,
  limits: OpenAiRealtimeUsageLimits,
): OpenAiRealtimeUsageRecordResult {
  if (
    !validLimit(limits.costMicroUsd) ||
    !validLimit(limits.generationCount) ||
    !validLimit(limits.inputTokens) ||
    !validLimit(limits.outputTokens)
  ) {
    throw new TypeError(
      "Realtime usage limits must be safe nonnegative integers",
    );
  }
  if (!state.trustworthy) {
    return { kind: "invalid", state };
  }
  if (!isRecord(event) || typeof event.type !== "string") {
    return { kind: "invalid", state: invalidState(state) };
  }
  if (event.type === "conversation.item.input_audio_transcription.completed") {
    return { kind: "invalid", state: invalidState(state) };
  }
  if (event.type !== "response.done") {
    return { kind: "ignored", state };
  }

  const parsed = parseOpenAiRealtimeResponseDoneUsage(event);
  if (parsed === undefined) {
    return { kind: "invalid", state: invalidState(state) };
  }
  const duplicateResponse = state.entries.find(
    ({ responseId }) => responseId === parsed.responseId,
  );
  if (duplicateResponse !== undefined) {
    return sameUsage(duplicateResponse, parsed)
      ? { kind: "duplicate", state }
      : { kind: "invalid", state: invalidState(state) };
  }
  if (state.entries.some(({ eventId }) => eventId === parsed.eventId)) {
    return { kind: "invalid", state: invalidState(state) };
  }

  const responseCostMicroUsd = priceGptRealtime21UsageMicroUsd(parsed);
  const costMicroUsd = safeSum([
    state.totals.costMicroUsd,
    responseCostMicroUsd,
  ]);
  const generationCount = safeSum([state.totals.generationCount, 1]);
  const inputTokens = safeSum([
    state.totals.inputTokens,
    parsed.input.totalTokens,
  ]);
  const outputTokens = safeSum([
    state.totals.outputTokens,
    parsed.output.totalTokens,
  ]);
  if (
    costMicroUsd === undefined ||
    generationCount === undefined ||
    inputTokens === undefined ||
    outputTokens === undefined
  ) {
    return { kind: "invalid", state: invalidState(state) };
  }
  const next: OpenAiRealtimeUsageState = {
    entries: [...state.entries, parsed],
    totals: {
      costMicroUsd,
      generationCount,
      inputTokens,
      outputTokens,
    },
    trustworthy: true,
  };
  if (
    costMicroUsd > limits.costMicroUsd ||
    generationCount > limits.generationCount ||
    inputTokens > limits.inputTokens ||
    outputTokens > limits.outputTokens
  ) {
    return { kind: "limit_exceeded", state: invalidState(next) };
  }
  return { kind: "recorded", state: next };
}
