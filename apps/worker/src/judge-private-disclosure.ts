import type {
  ManagedAiOperationClaim,
  ManagedAiOperationClaimRelease,
  ManagedAiOperationClaimResult,
} from "@counterpoint/adapters-cloudflare";
import type { PrivateDisclosureProposal } from "@counterpoint/adapters-openai";
import type {
  DisclosureCandidateProposer,
  DisclosureDependencies,
  UserAuthorizationContext,
} from "@counterpoint/application";
import type {
  ArtifactStore,
  Clock,
  UsageDecision,
  UsageLimiter,
} from "@counterpoint/ports";

import {
  PRIVATE_DISCLOSURE_CLAIM_TTL_SECONDS,
  PRIVATE_DISCLOSURE_MAX_SOURCE_BYTES,
  PRIVATE_DISCLOSURE_MODEL,
  PRIVATE_DISCLOSURE_OPERATION,
  PRIVATE_DISCLOSURE_PRICING_VERSION,
  PRIVATE_DISCLOSURE_RESERVED_USAGE,
  calculatePrivateDisclosureActualUsage,
} from "./judge-structured-ai.js";

type UsageLimit = Extract<UsageDecision, { kind: "denied" }>["limit"];

export interface JudgeManagedAiOperationClaimRepository {
  claim(claim: ManagedAiOperationClaim): Promise<ManagedAiOperationClaimResult>;
  release(
    release: ManagedAiOperationClaimRelease,
  ): Promise<"released" | "unavailable">;
}

export interface JudgePrivateDisclosureRequest {
  readonly assistance: "ai_preferred";
  readonly expectedPosition: number;
  readonly idempotencyKey: string;
  readonly meetingId: string;
  readonly sourceArtifactId: string;
}

export type JudgePrivateDisclosureErrorCode =
  | "IDEMPOTENCY_CONFLICT"
  | "OPENAI_UNAVAILABLE"
  | "USAGE_LIMIT_REACHED"
  | "VALIDATION_FAILED";

export class JudgePrivateDisclosureError extends Error {
  readonly code: JudgePrivateDisclosureErrorCode;
  readonly details: Readonly<{ limit?: UsageLimit }>;

  constructor(
    code: JudgePrivateDisclosureErrorCode,
    details: Readonly<{ limit?: UsageLimit }> = {},
  ) {
    super(code);
    this.name = "JudgePrivateDisclosureError";
    this.code = code;
    this.details =
      code === "USAGE_LIMIT_REACHED" && details.limit !== undefined
        ? { limit: details.limit }
        : {};
  }
}

export interface ConcretePrivateDisclosureProposer {
  propose(
    input: Parameters<DisclosureCandidateProposer["propose"]>[0],
  ): Promise<PrivateDisclosureProposal>;
}

export interface JudgePrivateDisclosureRuntimeDependencies {
  readonly claims: JudgeManagedAiOperationClaimRepository;
  readonly ipAddress: string;
  readonly proposer: ConcretePrivateDisclosureProposer;
  readonly usage: UsageLimiter;
}

interface ClaimedState {
  readonly claim: ManagedAiOperationClaim;
  readonly kind: "claimed";
  providerStarted: boolean;
  readonly reservationId: string;
  settled: boolean;
}

type PreparationState =
  | ClaimedState
  | { readonly kind: "replayed" }
  | { readonly kind: "unprepared" };

export async function runJudgePrivateDisclosure<T>(input: {
  readonly authorization: UserAuthorizationContext;
  readonly claims: JudgeManagedAiOperationClaimRepository;
  readonly clock: Clock;
  readonly dependencies: DisclosureDependencies;
  readonly execute: (dependencies: DisclosureDependencies) => Promise<T> | T;
  readonly ipAddress: string;
  readonly proposer: ConcretePrivateDisclosureProposer;
  readonly request: JudgePrivateDisclosureRequest;
  readonly usage: UsageLimiter;
}): Promise<T> {
  if (!input.authorization.capabilities.has("judge:managed-ai")) {
    throw new JudgePrivateDisclosureError("OPENAI_UNAVAILABLE");
  }
  const lifecycle: { state: PreparationState } = {
    state: { kind: "unprepared" },
  };
  let preparation: Promise<void> | undefined;

  const prepare = (): Promise<void> => {
    preparation ??= prepareManagedCall(input).then((prepared) => {
      lifecycle.state = prepared;
    });
    return preparation;
  };
  const artifacts = guardedArtifactStore(input.dependencies.artifacts, prepare);
  const candidateProposer: DisclosureCandidateProposer = {
    async propose(proposalInput) {
      await preparation;
      const state = lifecycle.state;
      if (state.kind === "replayed") {
        throw new JudgePrivateDisclosureError("OPENAI_UNAVAILABLE");
      }
      if (state.kind !== "claimed") {
        throw new JudgePrivateDisclosureError("OPENAI_UNAVAILABLE");
      }
      if (state.providerStarted || state.settled) {
        throw new JudgePrivateDisclosureError("OPENAI_UNAVAILABLE");
      }

      state.providerStarted = true;
      let proposal: PrivateDisclosureProposal;
      try {
        proposal = await input.proposer.propose(proposalInput);
      } catch (error) {
        await finalizeUsage(
          input.usage,
          state,
          PRIVATE_DISCLOSURE_RESERVED_USAGE,
        );
        throw error;
      }

      let actual = PRIVATE_DISCLOSURE_RESERVED_USAGE;
      if (proposal.billing !== undefined) {
        try {
          actual = calculatePrivateDisclosureActualUsage(
            PRIVATE_DISCLOSURE_MODEL,
            proposal.billing,
          );
        } catch {
          actual = PRIVATE_DISCLOSURE_RESERVED_USAGE;
        }
      }
      await finalizeUsage(input.usage, state, actual);
      return proposal;
    },
  };

  try {
    return await input.execute({
      ...input.dependencies,
      artifacts,
      candidateProposer,
    });
  } finally {
    const state = lifecycle.state;
    if (state.kind === "claimed" && !state.providerStarted && !state.settled) {
      await releaseBeforeProvider(input.claims, input.usage, state);
    }
  }
}

async function finalizeUsage(
  usage: UsageLimiter,
  state: ClaimedState,
  actual: Parameters<UsageLimiter["finalize"]>[1],
): Promise<void> {
  try {
    await usage.finalize(state.reservationId, actual);
    state.settled = true;
  } catch {
    throw new JudgePrivateDisclosureError("OPENAI_UNAVAILABLE");
  }
}

async function releaseBeforeProvider(
  claims: JudgeManagedAiOperationClaimRepository,
  usage: UsageLimiter,
  state: ClaimedState,
): Promise<void> {
  try {
    await usage.release(state.reservationId);
  } catch {
    state.settled = true;
    throw new JudgePrivateDisclosureError("OPENAI_UNAVAILABLE");
  }
  try {
    const released = await claims.release(releaseFor(state.claim));
    if (released !== "released") {
      throw new Error("Managed-AI claim was unavailable during release");
    }
  } catch {
    state.settled = true;
    throw new JudgePrivateDisclosureError("OPENAI_UNAVAILABLE");
  }
  state.settled = true;
}

async function releaseClaimAfterUnreservedFailure(
  claims: JudgeManagedAiOperationClaimRepository,
  claim: ManagedAiOperationClaim,
): Promise<void> {
  try {
    const released = await claims.release(releaseFor(claim));
    if (released !== "released") {
      throw new Error("Managed-AI claim was unavailable during release");
    }
  } catch {
    throw new JudgePrivateDisclosureError("OPENAI_UNAVAILABLE");
  }
}

function guardedArtifactStore(
  artifacts: ArtifactStore,
  prepare: () => Promise<void>,
): ArtifactStore {
  return {
    delete: (scope) => artifacts.delete(scope),
    async get(scope) {
      const bytes = await artifacts.get(scope);
      if (bytes === undefined) {
        return undefined;
      }
      if (bytes.byteLength > PRIVATE_DISCLOSURE_MAX_SOURCE_BYTES) {
        throw new JudgePrivateDisclosureError("VALIDATION_FAILED");
      }
      try {
        new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        throw new JudgePrivateDisclosureError("VALIDATION_FAILED");
      }
      await prepare();
      return bytes;
    },
    put: (write) => artifacts.put(write),
  };
}

async function prepareManagedCall(input: {
  readonly authorization: UserAuthorizationContext;
  readonly claims: JudgeManagedAiOperationClaimRepository;
  readonly clock: Clock;
  readonly ipAddress: string;
  readonly request: JudgePrivateDisclosureRequest;
  readonly usage: UsageLimiter;
}): Promise<PreparationState> {
  const createdAtEpoch = epochSeconds(input.clock.now());
  const claim: ManagedAiOperationClaim = {
    claimKeyHash: await sha256([
      PRIVATE_DISCLOSURE_OPERATION,
      input.request.meetingId,
      input.request.idempotencyKey,
    ]),
    createdAtEpoch,
    expiresAtEpoch: createdAtEpoch + PRIVATE_DISCLOSURE_CLAIM_TTL_SECONDS,
    model: PRIVATE_DISCLOSURE_MODEL,
    operation: PRIVATE_DISCLOSURE_OPERATION,
    pricingVersion: PRIVATE_DISCLOSURE_PRICING_VERSION,
    requestFingerprint: await sha256([
      PRIVATE_DISCLOSURE_OPERATION,
      input.authorization.userId,
      input.authorization.participantId,
      input.request.meetingId,
      input.request.idempotencyKey,
      input.request.sourceArtifactId,
    ]),
  };
  let claimed: ManagedAiOperationClaimResult;
  try {
    claimed = await input.claims.claim(claim);
  } catch {
    throw new JudgePrivateDisclosureError("OPENAI_UNAVAILABLE");
  }
  if (claimed === "conflict") {
    throw new JudgePrivateDisclosureError("IDEMPOTENCY_CONFLICT");
  }
  if (claimed === "replayed") {
    return { kind: "replayed" };
  }

  let reservation: UsageDecision;
  try {
    reservation = await input.usage.reserve(
      {
        accountId: input.authorization.userId,
        ipAddress: input.ipAddress,
        meetingId: input.request.meetingId,
      },
      PRIVATE_DISCLOSURE_RESERVED_USAGE,
    );
  } catch {
    throw new JudgePrivateDisclosureError("OPENAI_UNAVAILABLE");
  }
  if (reservation.kind === "denied") {
    await releaseClaimAfterUnreservedFailure(input.claims, claim);
    throw usageLimitError(reservation.limit);
  }
  return {
    claim,
    kind: "claimed",
    providerStarted: false,
    reservationId: reservation.reservationId,
    settled: false,
  };
}

function releaseFor(
  claim: ManagedAiOperationClaim,
): ManagedAiOperationClaimRelease {
  return {
    claimKeyHash: claim.claimKeyHash,
    createdAtEpoch: claim.createdAtEpoch,
    requestFingerprint: claim.requestFingerprint,
  };
}

function usageLimitError(limit: UsageLimit): JudgePrivateDisclosureError {
  return new JudgePrivateDisclosureError("USAGE_LIMIT_REACHED", { limit });
}

function epochSeconds(value: string): number {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || milliseconds % 1_000 !== 0) {
    throw new JudgePrivateDisclosureError("OPENAI_UNAVAILABLE");
  }
  return milliseconds / 1_000;
}

async function sha256(fields: readonly (number | string)[]): Promise<string> {
  const serialized = JSON.stringify(fields);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(serialized),
  );
  return `sha256:${[...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}
