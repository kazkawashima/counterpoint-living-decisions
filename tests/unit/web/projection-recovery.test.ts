import {
  HEALTHY_PROJECTION_DELAY_MS,
  nextProjectionDelay,
} from "../../../apps/web/src/projection-recovery.js";
import { describe, expect, it } from "vitest";

describe("projection recovery policy", () => {
  it("polls a healthy projection once per second", () => {
    expect(HEALTHY_PROJECTION_DELAY_MS).toBe(1_000);
  });

  it.each([
    [0, 2_000],
    [1, 4_000],
    [2, 8_000],
    [3, 16_000],
    [4, 30_000],
    [5, 30_000],
    [100, 30_000],
  ])(
    "backs off retryable failure count %i to %i ms",
    (consecutiveFailures, expectedDelay) => {
      expect(nextProjectionDelay(consecutiveFailures, true)).toBe(
        expectedDelay,
      );
    },
  );

  it("does not schedule a nonretryable projection failure", () => {
    expect(nextProjectionDelay(0, false)).toBeUndefined();
  });
});
