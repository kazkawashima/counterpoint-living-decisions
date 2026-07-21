export const HEALTHY_PROJECTION_DELAY_MS = 1_000;

const PROJECTION_RETRY_DELAYS_MS = [2_000, 4_000, 8_000, 16_000, 30_000];

export function nextProjectionDelay(
  consecutiveFailures: number,
  retryable: boolean,
): number | undefined {
  if (!retryable) {
    return undefined;
  }
  const index = Math.min(
    Math.max(0, Math.trunc(consecutiveFailures)),
    PROJECTION_RETRY_DELAYS_MS.length - 1,
  );
  return PROJECTION_RETRY_DELAYS_MS[index];
}
