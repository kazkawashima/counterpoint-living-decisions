import type { UsageRequest } from "@counterpoint/ports";

export const JUDGE_REALTIME_MAX_DURATION_SECONDS = 30;
export const JUDGE_REALTIME_RETRY_DELAY_SECONDS = 5;
export const JUDGE_REALTIME_RESERVATION_TTL_SECONDS =
  JUDGE_REALTIME_MAX_DURATION_SECONDS + 30;
export const JUDGE_REALTIME_RESERVED_COST_USD = 12;
export const JUDGE_REALTIME_RESERVED_USAGE: UsageRequest = {
  // Two short-lived private/shared calls can coexist under the USD 25 ceiling.
  // Provider telemetry settles each call to actual usage on termination.
  estimatedCostUsd: JUDGE_REALTIME_RESERVED_COST_USD,
  estimatedInputTokens: 800_000,
  estimatedOutputTokens: 400_000,
  generationCount: 3,
  realtimeSeconds: JUDGE_REALTIME_MAX_DURATION_SECONDS,
};
