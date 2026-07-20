import type {
  D1NamedUsageDecision,
  ManagedAiOperationLifecycleClaim,
  ManagedAiOperationProviderStart,
  ManagedAiOperationReservedAbandonment,
  ManagedAiOperationReservedTakeover,
  ManagedAiOperationReserveClaim,
  ManagedAiOperationReserveClaimResult,
  ManagedAiOperationSettlement,
  ManagedUsageReservation,
} from "@counterpoint/adapters-cloudflare";
import type { UsageRequest, UsageSubject } from "@counterpoint/ports";

import type { JudgeStructuredAiDescriptor } from "./judge-structured-ai.js";

type UsageLimit = Extract<D1NamedUsageDecision, { kind: "denied" }>["limit"];

export type JudgeManagedStructuredAiErrorCode =
  | "IDEMPOTENCY_CONFLICT"
  | "OPENAI_UNAVAILABLE"
  | "USAGE_LIMIT_REACHED"
  | "VALIDATION_FAILED";

export class JudgeManagedStructuredAiError extends Error {
  readonly code: JudgeManagedStructuredAiErrorCode;
  readonly details: Readonly<{ limit?: UsageLimit }>;

  constructor(
    code: JudgeManagedStructuredAiErrorCode,
    details: Readonly<{ limit?: UsageLimit }> = {},
  ) {
    super(code);
    this.name = "JudgeManagedStructuredAiError";
    this.code = code;
    this.details =
      code === "USAGE_LIMIT_REACHED" && details.limit !== undefined
        ? { limit: details.limit }
        : {};
  }
}

export interface JudgeManagedStructuredAiClaimRepository {
  abandonReserved(
    input: ManagedAiOperationReservedAbandonment,
  ): Promise<"abandoned" | "unavailable">;
  markProviderStarted(
    input: ManagedAiOperationProviderStart,
  ): Promise<"started" | "unavailable">;
  markSettled(
    input: ManagedAiOperationSettlement,
  ): Promise<"settled" | "unavailable">;
  reserveClaim(
    input: ManagedAiOperationReserveClaim,
  ): Promise<ManagedAiOperationReserveClaimResult>;
  takeOverReserved(
    input: ManagedAiOperationReservedTakeover,
  ): Promise<"taken_over" | "unavailable">;
}

export interface JudgeManagedStructuredAiUsageLimiter {
  finalize(reservationId: string, actual: UsageRequest): Promise<void>;
  findReservation(
    reservationId: string,
  ): Promise<ManagedUsageReservation | undefined>;
  release(reservationId: string): Promise<void>;
  reserveWithId(
    identity: {
      readonly reservationId: string;
      readonly requestFingerprint: string;
    },
    subject: UsageSubject,
    request: UsageRequest,
  ): Promise<D1NamedUsageDecision>;
}

export interface JudgeManagedStructuredAiReconcileRequest {
  readonly limit: 20;
  readonly nowEpoch: number;
}

interface JudgeManagedStructuredAiOperationInput<T> {
  readonly actualUsage: (result: T) => UsageRequest;
  readonly claimKeyHash: string;
  readonly claims: JudgeManagedStructuredAiClaimRepository;
  readonly descriptor: JudgeStructuredAiDescriptor;
  readonly model: string;
  readonly nextReservationId: () => string;
  readonly nowEpoch: () => number;
  readonly provider: () => Promise<T>;
  readonly providerInputBytes: number;
  readonly reconcile: (
    input: JudgeManagedStructuredAiReconcileRequest,
  ) => Promise<void>;
  readonly requestFingerprint: string;
  readonly subject: UsageSubject;
  readonly usage: JudgeManagedStructuredAiUsageLimiter;
}

export async function runJudgeManagedStructuredAiOperation<T>(
  input: JudgeManagedStructuredAiOperationInput<T>,
): Promise<T> {
  validateProviderInput(input.providerInputBytes, input.descriptor);
  const nowEpoch = validatedEpoch(input.nowEpoch());
  await infrastructure(() => input.reconcile({ limit: 20, nowEpoch }));
  const initial = await reserveClaim(input, nowEpoch);
  if (initial.kind === "conflict") {
    throw new JudgeManagedStructuredAiError("IDEMPOTENCY_CONFLICT");
  }

  let claim = initial.claim;
  let reservationVerified = false;
  if (initial.kind === "replayed") {
    const recovered = await recoverReplayedClaim(input, claim, nowEpoch);
    claim = recovered.claim;
    reservationVerified = recovered.reservationVerified;
  }

  return executeReservedClaim(input, claim, nowEpoch, reservationVerified);
}

async function reserveClaim<T>(
  input: JudgeManagedStructuredAiOperationInput<T>,
  nowEpoch: number,
): Promise<ManagedAiOperationReserveClaimResult> {
  try {
    const reservationId = input.nextReservationId();
    return await input.claims.reserveClaim({
      claimKeyHash: input.claimKeyHash,
      createdAtEpoch: nowEpoch,
      expectedStatus: "reserved",
      expiresAtEpoch: nowEpoch + input.descriptor.claimLeaseSeconds,
      leaseExpiresAtEpoch: nowEpoch + input.descriptor.claimLeaseSeconds,
      model: input.model,
      operation: input.descriptor.operation,
      pricingVersion: opaqueClaimPricingVersion(
        input.descriptor.pricingVersion,
      ),
      requestFingerprint: input.requestFingerprint,
      reservationId,
    });
  } catch {
    throw new JudgeManagedStructuredAiError("OPENAI_UNAVAILABLE");
  }
}

async function recoverReplayedClaim<T>(
  input: JudgeManagedStructuredAiOperationInput<T>,
  claim: ManagedAiOperationLifecycleClaim,
  nowEpoch: number,
): Promise<{
  readonly claim: ManagedAiOperationLifecycleClaim;
  readonly reservationVerified: boolean;
}> {
  switch (claim.status) {
    case "legacy_blocked":
    case "settled":
      throw new JudgeManagedStructuredAiError("OPENAI_UNAVAILABLE");
    case "provider_started":
      if (claim.leaseExpiresAtEpoch >= nowEpoch) {
        throw new JudgeManagedStructuredAiError("OPENAI_UNAVAILABLE");
      }
      await recoverProviderStarted(input, claim);
      throw new JudgeManagedStructuredAiError("OPENAI_UNAVAILABLE");
    case "reserved":
      break;
  }

  if (claim.leaseExpiresAtEpoch >= nowEpoch) {
    throw new JudgeManagedStructuredAiError("OPENAI_UNAVAILABLE");
  }

  const persisted = await infrastructure(() =>
    input.usage.findReservation(claim.reservationId),
  );
  if (persisted === undefined) {
    const abandoned = await infrastructure(() =>
      input.claims.abandonReserved(reservedMutation(claim)),
    );
    if (abandoned !== "abandoned") {
      throw new JudgeManagedStructuredAiError("OPENAI_UNAVAILABLE");
    }
    const replacement = await reserveClaim(input, nowEpoch);
    if (replacement.kind === "conflict") {
      throw new JudgeManagedStructuredAiError("IDEMPOTENCY_CONFLICT");
    }
    if (
      replacement.kind !== "reserved" ||
      replacement.claim.status !== "reserved"
    ) {
      throw new JudgeManagedStructuredAiError("OPENAI_UNAVAILABLE");
    }
    return {
      claim: replacement.claim,
      reservationVerified: false,
    };
  }

  assertReservationMatches(input, claim, persisted);
  if (persisted.status === "finalized") {
    assertFinalizedReservation(persisted);
    await verifyReservation(input, claim);
    await settleClaim(input, claim, nowEpoch);
    throw new JudgeManagedStructuredAiError("OPENAI_UNAVAILABLE");
  }
  if (persisted.status !== "reserved") {
    throw new JudgeManagedStructuredAiError("OPENAI_UNAVAILABLE");
  }
  if (persisted.activeUntilEpoch <= nowEpoch) {
    throw new JudgeManagedStructuredAiError("OPENAI_UNAVAILABLE");
  }
  await verifyReservation(input, claim);
  const takeover = await infrastructure(() =>
    input.claims.takeOverReserved({
      ...reservedMutation(claim),
      leaseExpiresAtEpoch: nowEpoch + input.descriptor.claimLeaseSeconds,
      nowEpoch,
    }),
  );
  if (takeover !== "taken_over") {
    throw new JudgeManagedStructuredAiError("OPENAI_UNAVAILABLE");
  }
  return {
    claim: {
      ...claim,
      leaseExpiresAtEpoch: nowEpoch + input.descriptor.claimLeaseSeconds,
    },
    reservationVerified: true,
  };
}

async function executeReservedClaim<T>(
  input: JudgeManagedStructuredAiOperationInput<T>,
  claim: ManagedAiOperationLifecycleClaim,
  nowEpoch: number,
  reservationVerified: boolean,
): Promise<T> {
  if (claim.status !== "reserved") {
    throw new JudgeManagedStructuredAiError("OPENAI_UNAVAILABLE");
  }

  if (!reservationVerified) {
    let reservation: D1NamedUsageDecision;
    try {
      reservation = await input.usage.reserveWithId(
        {
          requestFingerprint: claim.requestFingerprint,
          reservationId: claim.reservationId,
        },
        input.subject,
        input.descriptor.reservedUsage,
      );
    } catch {
      throw new JudgeManagedStructuredAiError("OPENAI_UNAVAILABLE");
    }
    if (reservation.kind === "denied") {
      const abandoned = await infrastructure(() =>
        input.claims.abandonReserved(reservedMutation(claim)),
      );
      if (abandoned !== "abandoned") {
        throw new JudgeManagedStructuredAiError("OPENAI_UNAVAILABLE");
      }
      throw new JudgeManagedStructuredAiError("USAGE_LIMIT_REACHED", {
        limit: reservation.limit,
      });
    }
    if (reservation.reservationId !== claim.reservationId) {
      throw new JudgeManagedStructuredAiError("OPENAI_UNAVAILABLE");
    }
  }

  const providerStartedAtEpoch = validatedEpoch(input.nowEpoch());
  const providerStart = await infrastructure(() =>
    input.claims.markProviderStarted({
      claimKeyHash: claim.claimKeyHash,
      createdAtEpoch: claim.createdAtEpoch,
      expectedStatus: "reserved",
      providerStartedAtEpoch,
      requestFingerprint: claim.requestFingerprint,
      reservationId: claim.reservationId,
    }),
  );
  if (providerStart !== "started") {
    throw new JudgeManagedStructuredAiError("OPENAI_UNAVAILABLE");
  }
  const providerStartedClaim: Extract<
    ManagedAiOperationLifecycleClaim,
    { status: "provider_started" }
  > = {
    ...claim,
    providerStartedAtEpoch,
    status: "provider_started",
  };

  let result: T;
  try {
    result = await input.provider();
  } catch {
    await finalizeAndSettle(
      input,
      providerStartedClaim,
      input.descriptor.reservedUsage,
    );
    throw new JudgeManagedStructuredAiError("OPENAI_UNAVAILABLE");
  }

  let actual: UsageRequest;
  try {
    actual = input.actualUsage(result);
  } catch {
    actual = input.descriptor.reservedUsage;
  }
  await finalizeAndSettle(input, providerStartedClaim, actual);
  return result;
}

async function recoverProviderStarted<T>(
  input: JudgeManagedStructuredAiOperationInput<T>,
  claim: Extract<
    ManagedAiOperationLifecycleClaim,
    { status: "provider_started" }
  >,
): Promise<void> {
  const persisted = await infrastructure(() =>
    input.usage.findReservation(claim.reservationId),
  );
  if (persisted === undefined) {
    throw new JudgeManagedStructuredAiError("OPENAI_UNAVAILABLE");
  }
  assertReservationMatches(input, claim, persisted);
  await verifyReservation(input, claim);
  if (persisted.status === "reserved") {
    await infrastructure(() =>
      input.usage.finalize(claim.reservationId, input.descriptor.reservedUsage),
    );
  } else if (persisted.status === "finalized") {
    assertFinalizedReservation(persisted);
  } else {
    throw new JudgeManagedStructuredAiError("OPENAI_UNAVAILABLE");
  }
  await settleClaim(input, claim, validatedEpoch(input.nowEpoch()));
}

async function finalizeAndSettle<T>(
  input: JudgeManagedStructuredAiOperationInput<T>,
  claim: Extract<
    ManagedAiOperationLifecycleClaim,
    { status: "provider_started" }
  >,
  actual: UsageRequest,
): Promise<void> {
  await infrastructure(() => input.usage.finalize(claim.reservationId, actual));
  await settleClaim(input, claim, validatedEpoch(input.nowEpoch()));
}

async function settleClaim<T>(
  input: JudgeManagedStructuredAiOperationInput<T>,
  claim: Extract<
    ManagedAiOperationLifecycleClaim,
    { status: "provider_started" | "reserved" }
  >,
  nowEpoch: number,
): Promise<void> {
  const settled = await infrastructure(() =>
    input.claims.markSettled({
      claimKeyHash: claim.claimKeyHash,
      createdAtEpoch: claim.createdAtEpoch,
      expectedStatus: claim.status,
      requestFingerprint: claim.requestFingerprint,
      reservationId: claim.reservationId,
      reuseAfterEpoch: nowEpoch + input.descriptor.retentionSeconds,
      settledAtEpoch: nowEpoch,
    }),
  );
  if (settled !== "settled") {
    throw new JudgeManagedStructuredAiError("OPENAI_UNAVAILABLE");
  }
}

async function verifyReservation<T>(
  input: JudgeManagedStructuredAiOperationInput<T>,
  claim: Extract<
    ManagedAiOperationLifecycleClaim,
    { status: "provider_started" | "reserved" }
  >,
): Promise<void> {
  let result: D1NamedUsageDecision;
  try {
    result = await input.usage.reserveWithId(
      {
        requestFingerprint: claim.requestFingerprint,
        reservationId: claim.reservationId,
      },
      input.subject,
      input.descriptor.reservedUsage,
    );
  } catch {
    throw new JudgeManagedStructuredAiError("OPENAI_UNAVAILABLE");
  }
  if (
    result.kind !== "allowed" ||
    result.reservationId !== claim.reservationId
  ) {
    throw new JudgeManagedStructuredAiError("OPENAI_UNAVAILABLE");
  }
}

function assertReservationMatches<T>(
  input: JudgeManagedStructuredAiOperationInput<T>,
  claim: Extract<
    ManagedAiOperationLifecycleClaim,
    { status: "provider_started" | "reserved" }
  >,
  reservation: ManagedUsageReservation,
): void {
  const expected = input.descriptor.reservedUsage;
  if (
    reservation.reservationId !== claim.reservationId ||
    reservation.requestFingerprint !== claim.requestFingerprint ||
    reservation.accountId !== input.subject.accountId ||
    reservation.meetingId !== input.subject.meetingId ||
    reservation.operation !== input.descriptor.operation ||
    reservation.model !== input.model ||
    reservation.pricingVersion !== input.descriptor.pricingVersion ||
    reservation.estimatedCostMicroUsd !==
      Math.round(expected.estimatedCostUsd * 1_000_000) ||
    reservation.estimatedInputTokens !== expected.estimatedInputTokens ||
    reservation.estimatedOutputTokens !== expected.estimatedOutputTokens ||
    reservation.estimatedGenerationCount !== expected.generationCount ||
    reservation.estimatedRealtimeSeconds !== expected.realtimeSeconds
  ) {
    throw new JudgeManagedStructuredAiError("OPENAI_UNAVAILABLE");
  }
}

function assertFinalizedReservation(
  reservation: ManagedUsageReservation,
): void {
  const pairs = [
    [reservation.actualCostMicroUsd, reservation.estimatedCostMicroUsd],
    [reservation.actualGenerationCount, reservation.estimatedGenerationCount],
    [reservation.actualInputTokens, reservation.estimatedInputTokens],
    [reservation.actualOutputTokens, reservation.estimatedOutputTokens],
    [reservation.actualRealtimeSeconds, reservation.estimatedRealtimeSeconds],
  ] as const;
  if (
    reservation.finalizedAtEpoch === undefined ||
    !Number.isSafeInteger(reservation.finalizedAtEpoch) ||
    reservation.finalizedAtEpoch < reservation.reservedAtEpoch ||
    pairs.some(
      ([actual, estimated]) =>
        actual === undefined ||
        !Number.isSafeInteger(actual) ||
        actual < 0 ||
        actual > estimated,
    )
  ) {
    throw new JudgeManagedStructuredAiError("OPENAI_UNAVAILABLE");
  }
}

function reservedMutation(
  claim: Extract<ManagedAiOperationLifecycleClaim, { status: "reserved" }>,
): ManagedAiOperationReservedAbandonment {
  return {
    claimKeyHash: claim.claimKeyHash,
    createdAtEpoch: claim.createdAtEpoch,
    expectedStatus: "reserved",
    requestFingerprint: claim.requestFingerprint,
    reservationId: claim.reservationId,
  };
}

function validateProviderInput(
  providerInputBytes: number,
  descriptor: JudgeStructuredAiDescriptor,
): void {
  if (
    !Number.isSafeInteger(providerInputBytes) ||
    providerInputBytes < 0 ||
    providerInputBytes > descriptor.inputJsonMaxBytes
  ) {
    throw new JudgeManagedStructuredAiError("VALIDATION_FAILED");
  }
}

function validatedEpoch(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new JudgeManagedStructuredAiError("OPENAI_UNAVAILABLE");
  }
  return value;
}

function opaqueClaimPricingVersion(value: string): string {
  if (/^[0-9A-Za-z._:/-]{1,256}$/u.test(value)) {
    return value;
  }
  const encoded = `hex:${Array.from(new TextEncoder().encode(value), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")}`;
  if (encoded.length > 256) {
    throw new JudgeManagedStructuredAiError("OPENAI_UNAVAILABLE");
  }
  return encoded;
}

async function infrastructure<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof JudgeManagedStructuredAiError) {
      throw error;
    }
    throw new JudgeManagedStructuredAiError("OPENAI_UNAVAILABLE");
  }
}
