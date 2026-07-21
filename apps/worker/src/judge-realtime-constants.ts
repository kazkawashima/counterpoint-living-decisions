import type { UsageRequest } from "@counterpoint/ports";

export const JUDGE_REALTIME_MAX_DURATION_SECONDS = 30;
export const JUDGE_REALTIME_RETRY_DELAY_SECONDS = 5;
export const JUDGE_REALTIME_RESERVATION_TTL_SECONDS =
  JUDGE_REALTIME_MAX_DURATION_SECONDS + 30;
export const JUDGE_REALTIME_RESERVED_COST_USD = 13;
export const JUDGE_REALTIME_RESERVED_USAGE: UsageRequest = {
  // Conservative bound for the configured token envelope. Final provider
  // telemetry still settles actual usage against the USD 25 hard ceiling.
  estimatedCostUsd: JUDGE_REALTIME_RESERVED_COST_USD,
  estimatedInputTokens: 800_000,
  estimatedOutputTokens: 400_000,
  generationCount: 3,
  realtimeSeconds: JUDGE_REALTIME_MAX_DURATION_SECONDS,
};
