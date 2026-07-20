import { describe, expect, it, vi } from "vitest";

import type {
  ManagedAiOperationLifecycleClaim,
  ManagedAiOperationReserveClaim,
  ManagedUsageReservation,
} from "@counterpoint/adapters-cloudflare";
import type { UsageRequest } from "@counterpoint/ports";

import {
  JudgeManagedStructuredAiError,
  runJudgeManagedStructuredAiOperation,
  type JudgeManagedStructuredAiClaimRepository,
  type JudgeManagedStructuredAiUsageLimiter,
} from "../../../apps/worker/src/judge-managed-structured-ai.js";
import {
  JUDGE_STRUCTURED_AI_DESCRIPTORS,
  PRIVATE_DISCLOSURE_MODEL,
  PRIVATE_DISCLOSURE_OPERATION,
} from "../../../apps/worker/src/judge-structured-ai.js";

const NOW_EPOCH = 1_753_011_200;
const CLAIM_KEY_HASH = `sha256:${"a".repeat(64)}`;
const REQUEST_FINGERPRINT = `sha256:${"b".repeat(64)}`;
const RESERVATION_ID = "judge-ai:reservation-1";
const SUBJECT = {
  accountId: "judge",
  ipAddress: "203.0.113.44",
  meetingId: "meeting-1",
};
const DESCRIPTOR =
  JUDGE_STRUCTURED_AI_DESCRIPTORS[PRIVATE_DISCLOSURE_OPERATION];
const ACTUAL: UsageRequest = {
  estimatedCostUsd: 0.001,
  estimatedInputTokens: 100,
  estimatedOutputTokens: 20,
  generationCount: 1,
  realtimeSeconds: 0,
};

function reservedClaim(
  overrides: Partial<ManagedAiOperationLifecycleClaim> = {},
): ManagedAiOperationLifecycleClaim {
  return {
    claimKeyHash: CLAIM_KEY_HASH,
    createdAtEpoch: NOW_EPOCH,
    expiresAtEpoch: NOW_EPOCH + DESCRIPTOR.claimLeaseSeconds,
    leaseExpiresAtEpoch: NOW_EPOCH + DESCRIPTOR.claimLeaseSeconds,
    model: PRIVATE_DISCLOSURE_MODEL,
    operation: PRIVATE_DISCLOSURE_OPERATION,
    pricingVersion: DESCRIPTOR.pricingVersion,
    providerStartedAtEpoch: undefined,
    requestFingerprint: REQUEST_FINGERPRINT,
    reservationId: RESERVATION_ID,
    reuseAfterEpoch: undefined,
    settledAtEpoch: undefined,
    status: "reserved",
    ...overrides,
  } as ManagedAiOperationLifecycleClaim;
}

function reservation(
  overrides: Partial<ManagedUsageReservation> = {},
): ManagedUsageReservation {
  return {
    accountId: SUBJECT.accountId,
    activeUntilEpoch: NOW_EPOCH + DESCRIPTOR.claimLeaseSeconds,
    actualCostMicroUsd: undefined,
    actualGenerationCount: undefined,
    actualInputTokens: undefined,
    actualOutputTokens: undefined,
    actualRealtimeSeconds: undefined,
    estimatedCostMicroUsd: 5_500_000,
    estimatedGenerationCount: 2,
    estimatedInputTokens: 540_000,
    estimatedOutputTokens: 1_400,
    estimatedRealtimeSeconds: 0,
    finalizedAtEpoch: undefined,
    ipHash: `hmac-sha256:${"c".repeat(64)}`,
    meetingId: SUBJECT.meetingId,
    model: PRIVATE_DISCLOSURE_MODEL,
    operation: PRIVATE_DISCLOSURE_OPERATION,
    pricingVersion: DESCRIPTOR.pricingVersion,
    releasedAtEpoch: undefined,
    requestFingerprint: REQUEST_FINGERPRINT,
    reservationId: RESERVATION_ID,
    reservedAtEpoch: NOW_EPOCH,
    status: "reserved",
    ...overrides,
  };
}

interface Harness {
  readonly claims: JudgeManagedStructuredAiClaimRepository;
  readonly usage: JudgeManagedStructuredAiUsageLimiter;
  readonly order: string[];
  readonly reserveClaim: ReturnType<typeof vi.fn>;
  readonly reserveWithId: ReturnType<typeof vi.fn>;
  readonly findReservation: ReturnType<typeof vi.fn>;
  readonly markProviderStarted: ReturnType<typeof vi.fn>;
  readonly markSettled: ReturnType<typeof vi.fn>;
  readonly takeOverReserved: ReturnType<typeof vi.fn>;
  readonly abandonReserved: ReturnType<typeof vi.fn>;
  readonly finalize: ReturnType<typeof vi.fn>;
  readonly release: ReturnType<typeof vi.fn>;
}

function harness(
  options: {
    readonly initialClaim?: ManagedAiOperationLifecycleClaim;
    readonly reservation?: ManagedUsageReservation;
    readonly reserveDenied?: boolean;
  } = {},
): Harness {
  const order: string[] = [];
  let firstClaim = options.initialClaim;
  const reserveClaim = vi.fn((input: ManagedAiOperationReserveClaim) => {
    order.push("claim");
    if (firstClaim !== undefined) {
      return Promise.resolve({
        claim: firstClaim,
        kind: "replayed" as const,
      });
    }
    firstClaim = reservedClaim({
      ...input,
      status: "reserved",
    });
    return Promise.resolve({
      claim: firstClaim,
      kind: "reserved" as const,
    });
  });
  const takeOverReserved = vi.fn(() => {
    order.push("takeover");
    return Promise.resolve("taken_over" as const);
  });
  const markProviderStarted = vi.fn((input: Parameters<
    JudgeManagedStructuredAiClaimRepository["markProviderStarted"]
  >[0]) => {
    order.push("provider-start");
    if (
      firstClaim?.status !== input.expectedStatus ||
      firstClaim.claimKeyHash !== input.claimKeyHash ||
      firstClaim.createdAtEpoch !== input.createdAtEpoch ||
      firstClaim.requestFingerprint !== input.requestFingerprint ||
      firstClaim.reservationId !== input.reservationId
    ) {
      return Promise.resolve("unavailable" as const);
    }
    firstClaim = {
      ...firstClaim,
      providerStartedAtEpoch: input.providerStartedAtEpoch,
      status: "provider_started",
    };
    return Promise.resolve("started" as const);
  });
  const markSettled = vi.fn((input: Parameters<
    JudgeManagedStructuredAiClaimRepository["markSettled"]
  >[0]) => {
    order.push("settle-claim");
    if (
      firstClaim?.status !== input.expectedStatus ||
      firstClaim.claimKeyHash !== input.claimKeyHash ||
      firstClaim.createdAtEpoch !== input.createdAtEpoch ||
      firstClaim.requestFingerprint !== input.requestFingerprint ||
      firstClaim.reservationId !== input.reservationId
    ) {
      return Promise.resolve("unavailable" as const);
    }
    firstClaim = {
      ...firstClaim,
      leaseExpiresAtEpoch: undefined,
      reuseAfterEpoch: input.reuseAfterEpoch,
      settledAtEpoch: input.settledAtEpoch,
      status: "settled",
    };
    return Promise.resolve("settled" as const);
  });
  const abandonReserved = vi.fn(() => {
    order.push("abandon");
    firstClaim = undefined;
    return Promise.resolve("abandoned" as const);
  });
  const reserveWithId = vi.fn(() => {
    order.push("reserve");
    return Promise.resolve(
      options.reserveDenied
        ? { kind: "denied" as const, limit: "tokens" as const }
        : {
            activeUntilEpoch: NOW_EPOCH + DESCRIPTOR.claimLeaseSeconds,
            kind: "allowed" as const,
            reservationId: RESERVATION_ID,
            reservedAtEpoch: NOW_EPOCH,
          },
    );
  });
  const findReservation = vi.fn(() => {
    order.push("find-reservation");
    return Promise.resolve(options.reservation);
  });
  const finalize = vi.fn(() => {
    order.push("finalize");
    return Promise.resolve();
  });
  const release = vi.fn(() => {
    order.push("release");
    return Promise.resolve();
  });
  return {
    abandonReserved,
    claims: {
      abandonReserved,
      markProviderStarted,
      markSettled,
      reserveClaim,
      takeOverReserved,
    },
    finalize,
    findReservation,
    markProviderStarted,
    markSettled,
    order,
    release,
    reserveClaim,
    reserveWithId,
    takeOverReserved,
    usage: {
      finalize,
      findReservation,
      release,
      reserveWithId,
    },
  };
}

function run<T = { readonly value: string }>(
  fixture: Harness,
  options: {
    readonly actualUsage?: () => UsageRequest;
    readonly nowEpoch?: number | (() => number);
    readonly provider?: () => Promise<T>;
    readonly providerInputBytes?: number;
    readonly reconcile?: () => Promise<void>;
    readonly requestFingerprint?: string;
  } = {},
) {
  return runJudgeManagedStructuredAiOperation({
    actualUsage: options.actualUsage ?? (() => ACTUAL),
    claimKeyHash: CLAIM_KEY_HASH,
    claims: fixture.claims,
    descriptor: DESCRIPTOR,
    model: PRIVATE_DISCLOSURE_MODEL,
    nextReservationId: () => RESERVATION_ID,
    nowEpoch: () =>
      typeof options.nowEpoch === "function"
        ? options.nowEpoch()
        : (options.nowEpoch ?? NOW_EPOCH),
    provider:
      options.provider ??
      (() => {
        fixture.order.push("provider");
        return Promise.resolve({ value: "ok" } as T);
      }),
    providerInputBytes: options.providerInputBytes ?? 128,
    reconcile:
      options.reconcile ??
      (() => {
        fixture.order.push("reconcile");
        return Promise.resolve();
      }),
    requestFingerprint: options.requestFingerprint ?? REQUEST_FINGERPRINT,
    subject: SUBJECT,
    usage: fixture.usage,
  });
}

describe("judge managed structured-AI lifecycle", () => {
  it("validates before reconciliation or any D1 mutation", async () => {
    const fixture = harness();
    const reconcile = vi.fn();
    const provider = vi.fn();

    await expect(
      run(fixture, {
        provider,
        providerInputBytes: 65_537,
        reconcile,
      }),
    ).rejects.toEqual(new JudgeManagedStructuredAiError("VALIDATION_FAILED"));
    expect(reconcile).not.toHaveBeenCalled();
    expect(fixture.reserveClaim).not.toHaveBeenCalled();
    expect(fixture.reserveWithId).not.toHaveBeenCalled();
    expect(provider).not.toHaveBeenCalled();
  });

  it("runs validation, reconciliation, durable lifecycle, provider, and settlement in order", async () => {
    const fixture = harness();

    await expect(run(fixture)).resolves.toEqual({ value: "ok" });

    expect(fixture.order).toEqual([
      "reconcile",
      "claim",
      "reserve",
      "provider-start",
      "provider",
      "finalize",
      "settle-claim",
    ]);
    expect(fixture.order.filter((entry) => entry === "reconcile")).toHaveLength(
      1,
    );
    expect(fixture.markProviderStarted).toHaveBeenCalledWith(
      expect.objectContaining({
        claimKeyHash: CLAIM_KEY_HASH,
        createdAtEpoch: NOW_EPOCH,
        reservationId: RESERVATION_ID,
      }),
    );
    expect(fixture.finalize).toHaveBeenCalledWith(RESERVATION_ID, ACTUAL);
    expect(fixture.markSettled).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedStatus: "provider_started",
        reuseAfterEpoch: NOW_EPOCH + DESCRIPTOR.retentionSeconds,
        settledAtEpoch: NOW_EPOCH,
      }),
    );
  });

  it("injects a bounded reconciliation request after validation", async () => {
    const fixture = harness();
    const reconcile = vi.fn(() => {
      fixture.order.push("reconcile");
      return Promise.resolve();
    });

    await run(fixture, { reconcile });

    expect(reconcile).toHaveBeenCalledWith({
      limit: 20,
      nowEpoch: NOW_EPOCH,
    });
  });

  it("starts retention at settlement time rather than provider start", async () => {
    const fixture = harness();
    const epochs = [NOW_EPOCH, NOW_EPOCH + 1, NOW_EPOCH + 10];

    await run(fixture, {
      nowEpoch: () => epochs.shift() ?? NOW_EPOCH + 10,
    });

    expect(fixture.markProviderStarted).toHaveBeenCalledWith(
      expect.objectContaining({
        providerStartedAtEpoch: NOW_EPOCH + 1,
      }),
    );
    expect(fixture.markSettled).toHaveBeenCalledWith(
      expect.objectContaining({
        reuseAfterEpoch: NOW_EPOCH + 10 + DESCRIPTOR.retentionSeconds,
        settledAtEpoch: NOW_EPOCH + 10,
      }),
    );
  });

  it("fails closed for an active exact lease", async () => {
    const fixture = harness({ initialClaim: reservedClaim() });

    await expect(run(fixture)).rejects.toEqual(
      new JudgeManagedStructuredAiError("OPENAI_UNAVAILABLE"),
    );
    expect(fixture.reserveWithId).not.toHaveBeenCalled();
    expect(fixture.markProviderStarted).not.toHaveBeenCalled();
  });

  it("takes over an expired exact reservation before provider start", async () => {
    const expired = reservedClaim({
      leaseExpiresAtEpoch: NOW_EPOCH - 1,
    });
    const fixture = harness({
      initialClaim: expired,
      reservation: reservation({
        activeUntilEpoch: NOW_EPOCH + DESCRIPTOR.claimLeaseSeconds,
      }),
    });

    await expect(run(fixture)).resolves.toEqual({ value: "ok" });

    expect(fixture.order).toEqual([
      "reconcile",
      "claim",
      "find-reservation",
      "reserve",
      "takeover",
      "provider-start",
      "provider",
      "finalize",
      "settle-claim",
    ]);
  });

  it("replaces an expired generation whose reservation is missing", async () => {
    const fixture = harness({
      initialClaim: reservedClaim({ leaseExpiresAtEpoch: NOW_EPOCH - 1 }),
    });

    await expect(run(fixture)).resolves.toEqual({ value: "ok" });

    expect(fixture.order).toEqual([
      "reconcile",
      "claim",
      "find-reservation",
      "abandon",
      "claim",
      "reserve",
      "provider-start",
      "provider",
      "finalize",
      "settle-claim",
    ]);
  });

  it("fails closed on immutable reservation mismatch", async () => {
    const fixture = harness({
      initialClaim: reservedClaim({ leaseExpiresAtEpoch: NOW_EPOCH - 1 }),
      reservation: reservation({ meetingId: "different-meeting" }),
    });

    await expect(run(fixture)).rejects.toEqual(
      new JudgeManagedStructuredAiError("OPENAI_UNAVAILABLE"),
    );
    expect(fixture.takeOverReserved).not.toHaveBeenCalled();
    expect(fixture.markProviderStarted).not.toHaveBeenCalled();
  });

  it("fails closed when the recovered reservation is no longer active", async () => {
    const fixture = harness({
      initialClaim: reservedClaim({ leaseExpiresAtEpoch: NOW_EPOCH - 1 }),
      reservation: reservation({ activeUntilEpoch: NOW_EPOCH - 1 }),
    });

    await expect(run(fixture)).rejects.toEqual(
      new JudgeManagedStructuredAiError("OPENAI_UNAVAILABLE"),
    );
    expect(fixture.takeOverReserved).not.toHaveBeenCalled();
    expect(fixture.markProviderStarted).not.toHaveBeenCalled();
  });

  it("does not invoke provider after losing the provider-start CAS", async () => {
    const fixture = harness();
    fixture.markProviderStarted.mockResolvedValue("unavailable");
    const provider = vi.fn();

    await expect(run(fixture, { provider })).rejects.toEqual(
      new JudgeManagedStructuredAiError("OPENAI_UNAVAILABLE"),
    );
    expect(provider).not.toHaveBeenCalled();
  });

  it("keeps a settled claim unavailable through the retention boundary", async () => {
    const fixture = harness({
      initialClaim: reservedClaim({
        leaseExpiresAtEpoch: undefined,
        providerStartedAtEpoch: NOW_EPOCH - 5,
        reuseAfterEpoch: NOW_EPOCH,
        settledAtEpoch: NOW_EPOCH - DESCRIPTOR.retentionSeconds,
        status: "settled",
      }),
    });

    await expect(run(fixture)).rejects.toEqual(
      new JudgeManagedStructuredAiError("OPENAI_UNAVAILABLE"),
    );
    expect(fixture.reserveWithId).not.toHaveBeenCalled();
  });

  it("recovers provider-started reserved usage by full-finalizing without another provider call", async () => {
    const fixture = harness({
      initialClaim: reservedClaim({
        leaseExpiresAtEpoch: NOW_EPOCH - 1,
        providerStartedAtEpoch: NOW_EPOCH - 2,
        status: "provider_started",
      }),
      reservation: reservation(),
    });
    const provider = vi.fn();

    await expect(run(fixture, { provider })).rejects.toEqual(
      new JudgeManagedStructuredAiError("OPENAI_UNAVAILABLE"),
    );
    expect(fixture.finalize).toHaveBeenCalledWith(
      RESERVATION_ID,
      DESCRIPTOR.reservedUsage,
    );
    expect(fixture.markSettled).toHaveBeenCalledTimes(1);
    expect(provider).not.toHaveBeenCalled();
  });

  it("does not recover provider-started usage while its lease is active", async () => {
    const fixture = harness({
      initialClaim: reservedClaim({
        providerStartedAtEpoch: NOW_EPOCH,
        status: "provider_started",
      }),
      reservation: reservation(),
    });

    await expect(run(fixture)).rejects.toEqual(
      new JudgeManagedStructuredAiError("OPENAI_UNAVAILABLE"),
    );
    expect(fixture.findReservation).not.toHaveBeenCalled();
    expect(fixture.finalize).not.toHaveBeenCalled();
    expect(fixture.markSettled).not.toHaveBeenCalled();
  });

  it("recovers provider-started finalized usage without mutating actuals", async () => {
    const fixture = harness({
      initialClaim: reservedClaim({
        leaseExpiresAtEpoch: NOW_EPOCH - 1,
        providerStartedAtEpoch: NOW_EPOCH - 2,
        status: "provider_started",
      }),
      reservation: reservation({
        actualCostMicroUsd: 1_000,
        actualGenerationCount: 1,
        actualInputTokens: 100,
        actualOutputTokens: 20,
        actualRealtimeSeconds: 0,
        finalizedAtEpoch: NOW_EPOCH - 1,
        reservedAtEpoch: NOW_EPOCH - 10,
        status: "finalized",
      }),
    });

    await expect(run(fixture)).rejects.toEqual(
      new JudgeManagedStructuredAiError("OPENAI_UNAVAILABLE"),
    );
    expect(fixture.finalize).not.toHaveBeenCalled();
    expect(fixture.markSettled).toHaveBeenCalledTimes(1);
  });

  it("settles an expired reserved claim with exact finalized usage without replaying the provider", async () => {
    const finalized = reservation({
      actualCostMicroUsd: 1_000,
      actualGenerationCount: 1,
      actualInputTokens: 100,
      actualOutputTokens: 20,
      actualRealtimeSeconds: 0,
      finalizedAtEpoch: NOW_EPOCH - 1,
      reservedAtEpoch: NOW_EPOCH - 10,
      status: "finalized",
    });
    const fixture = harness({
      initialClaim: reservedClaim({
        leaseExpiresAtEpoch: NOW_EPOCH - 1,
      }),
      reservation: finalized,
    });
    const provider = vi.fn();

    await expect(run(fixture, { provider })).rejects.toEqual(
      new JudgeManagedStructuredAiError("OPENAI_UNAVAILABLE"),
    );
    expect(fixture.findReservation).toHaveBeenCalledWith(RESERVATION_ID);
    expect(fixture.reserveWithId).toHaveBeenCalledTimes(1);
    expect(fixture.markSettled).toHaveBeenCalledWith(
      expect.objectContaining({
        claimKeyHash: CLAIM_KEY_HASH,
        createdAtEpoch: NOW_EPOCH,
        expectedStatus: "reserved",
        requestFingerprint: REQUEST_FINGERPRINT,
        reservationId: RESERVATION_ID,
      }),
    );
    expect(fixture.markProviderStarted).not.toHaveBeenCalled();
    expect(provider).not.toHaveBeenCalled();
    expect(fixture.finalize).not.toHaveBeenCalled();
  });

  it("fails closed on incomplete finalized usage without marking settled", async () => {
    const fixture = harness({
      initialClaim: reservedClaim({
        leaseExpiresAtEpoch: NOW_EPOCH - 1,
        providerStartedAtEpoch: NOW_EPOCH - 2,
        status: "provider_started",
      }),
      reservation: reservation({
        actualCostMicroUsd: 1_000,
        actualGenerationCount: 1,
        actualInputTokens: undefined,
        actualOutputTokens: 20,
        actualRealtimeSeconds: 0,
        finalizedAtEpoch: NOW_EPOCH - 1,
        status: "finalized",
      }),
    });

    await expect(run(fixture)).rejects.toEqual(
      new JudgeManagedStructuredAiError("OPENAI_UNAVAILABLE"),
    );
    expect(fixture.finalize).not.toHaveBeenCalled();
    expect(fixture.markSettled).not.toHaveBeenCalled();
  });

  it("leaves provider-started work retryable when finalization fails", async () => {
    const fixture = harness({
      initialClaim: reservedClaim({
        leaseExpiresAtEpoch: NOW_EPOCH - 1,
        providerStartedAtEpoch: NOW_EPOCH - 2,
        status: "provider_started",
      }),
      reservation: reservation(),
    });
    fixture.finalize.mockRejectedValue(
      new Error("sensitive finalization failure"),
    );

    await expect(run(fixture)).rejects.toEqual(
      new JudgeManagedStructuredAiError("OPENAI_UNAVAILABLE"),
    );
    expect(fixture.markSettled).not.toHaveBeenCalled();
  });

  it("keeps legacy claims blocked", async () => {
    const fixture = harness({
      initialClaim: reservedClaim({
        leaseExpiresAtEpoch: undefined,
        reservationId: undefined,
        status: "legacy_blocked",
      }),
    });

    await expect(run(fixture)).rejects.toEqual(
      new JudgeManagedStructuredAiError("OPENAI_UNAVAILABLE"),
    );
    expect(fixture.findReservation).not.toHaveBeenCalled();
  });

  it("abandons the exact reserved generation on a denied reservation", async () => {
    const fixture = harness({ reserveDenied: true });

    await expect(run(fixture)).rejects.toEqual(
      new JudgeManagedStructuredAiError("USAGE_LIMIT_REACHED", {
        limit: "tokens",
      }),
    );
    expect(fixture.abandonReserved).toHaveBeenCalledTimes(1);
    expect(fixture.markProviderStarted).not.toHaveBeenCalled();
  });

  it("full-finalizes provider failures and never releases provider-started usage", async () => {
    const fixture = harness();
    const providerError = new Error(
      "transient provider failure with synthetic-private-secret",
    );

    await expect(
      run(fixture, {
        provider: () => Promise.reject(providerError),
      }),
    ).rejects.toEqual(new JudgeManagedStructuredAiError("OPENAI_UNAVAILABLE"));
    expect(fixture.finalize).toHaveBeenCalledWith(
      RESERVATION_ID,
      DESCRIPTOR.reservedUsage,
    );
    expect(fixture.markSettled).toHaveBeenCalledTimes(1);
    expect(fixture.markSettled).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedStatus: "provider_started",
      }),
    );
    expect(fixture.release).not.toHaveBeenCalled();
  });

  it("keeps raw provider content out of durable and public sinks", async () => {
    const fixture = harness();
    const raw = "synthetic-private-secret";

    await expect(
      run(fixture, {
        provider: () => {
          fixture.order.push("provider");
          return Promise.resolve({ value: "redacted-result" });
        },
      }),
    ).resolves.toEqual({ value: "redacted-result" });

    const durable = JSON.stringify([
      fixture.reserveClaim.mock.calls,
      fixture.reserveWithId.mock.calls,
      fixture.markProviderStarted.mock.calls,
      fixture.markSettled.mock.calls,
    ]);
    expect(durable).not.toContain(raw);
    expect(
      String(new JudgeManagedStructuredAiError("OPENAI_UNAVAILABLE")),
    ).not.toContain(raw);
  });
});
