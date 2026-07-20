import type { PrivateDisclosureProposal } from "@counterpoint/adapters-openai";
import type {
  DisclosureCandidateProposer,
  DisclosureDependencies,
  UserAuthorizationContext,
} from "@counterpoint/application";
import type { ArtifactStore, Clock, UsageDecision } from "@counterpoint/ports";

import {
  JudgeManagedStructuredAiError,
  runJudgeManagedStructuredAiOperation,
  type JudgeManagedStructuredAiClaimRepository,
  type JudgeManagedStructuredAiReconcileRequest,
  type JudgeManagedStructuredAiUsageLimiter,
} from "./judge-managed-structured-ai.js";
import {
  JUDGE_STRUCTURED_AI_DESCRIPTORS,
  PRIVATE_DISCLOSURE_MAX_SOURCE_BYTES,
  PRIVATE_DISCLOSURE_MODEL,
  PRIVATE_DISCLOSURE_OPERATION,
  calculatePrivateDisclosureActualUsage,
} from "./judge-structured-ai.js";

type UsageLimit = Extract<UsageDecision, { kind: "denied" }>["limit"];

export type JudgeManagedAiOperationClaimRepository =
  JudgeManagedStructuredAiClaimRepository;

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
  readonly claims: JudgeManagedStructuredAiClaimRepository;
  readonly ipAddress: string;
  readonly nextReservationId: () => string;
  readonly proposer: ConcretePrivateDisclosureProposer;
  readonly reconcile: (
    input: JudgeManagedStructuredAiReconcileRequest,
  ) => Promise<void>;
  readonly usage: JudgeManagedStructuredAiUsageLimiter;
}

interface PreparedSource {
  readonly claimKeyHash: string;
  readonly providerInputBytes: number;
  readonly requestFingerprint: string;
}

export async function runJudgePrivateDisclosure<T>(input: {
  readonly authorization: UserAuthorizationContext;
  readonly claims: JudgeManagedStructuredAiClaimRepository;
  readonly clock: Clock;
  readonly dependencies: DisclosureDependencies;
  readonly execute: (dependencies: DisclosureDependencies) => Promise<T> | T;
  readonly ipAddress: string;
  readonly nextReservationId: () => string;
  readonly proposer: ConcretePrivateDisclosureProposer;
  readonly reconcile: (
    input: JudgeManagedStructuredAiReconcileRequest,
  ) => Promise<void>;
  readonly request: JudgePrivateDisclosureRequest;
  readonly usage: JudgeManagedStructuredAiUsageLimiter;
}): Promise<T> {
  if (!input.authorization.capabilities.has("judge:managed-ai")) {
    throw new JudgePrivateDisclosureError("OPENAI_UNAVAILABLE");
  }

  let prepared: PreparedSource | undefined;
  let providerStarted = false;
  const artifacts = guardedArtifactStore(
    input.dependencies.artifacts,
    async (bytes) => {
      prepared ??= await prepareSource(input, bytes);
    },
  );
  const candidateProposer: DisclosureCandidateProposer = {
    async propose(proposalInput) {
      if (providerStarted || prepared === undefined) {
        throw new JudgePrivateDisclosureError("OPENAI_UNAVAILABLE");
      }
      providerStarted = true;
      try {
        return await runJudgeManagedStructuredAiOperation({
          actualUsage: (proposal) =>
            proposal.billing === undefined
              ? JUDGE_STRUCTURED_AI_DESCRIPTORS[PRIVATE_DISCLOSURE_OPERATION]
                  .reservedUsage
              : calculatePrivateDisclosureActualUsage(
                  PRIVATE_DISCLOSURE_MODEL,
                  proposal.billing,
                ),
          claimKeyHash: prepared.claimKeyHash,
          claims: input.claims,
          descriptor:
            JUDGE_STRUCTURED_AI_DESCRIPTORS[PRIVATE_DISCLOSURE_OPERATION],
          model: PRIVATE_DISCLOSURE_MODEL,
          nextReservationId: input.nextReservationId,
          nowEpoch: () => epochSeconds(input.clock.now()),
          provider: () => input.proposer.propose(proposalInput),
          providerInputBytes: prepared.providerInputBytes,
          reconcile: input.reconcile,
          requestFingerprint: prepared.requestFingerprint,
          subject: {
            accountId: input.authorization.userId,
            ipAddress: input.ipAddress,
            meetingId: input.request.meetingId,
          },
          usage: input.usage,
        });
      } catch (error) {
        if (error instanceof JudgeManagedStructuredAiError) {
          throw privateError(error);
        }
        throw error;
      }
    },
  };

  return input.execute({
    ...input.dependencies,
    artifacts,
    candidateProposer,
  });
}

function guardedArtifactStore(
  artifacts: ArtifactStore,
  prepare: (bytes: Uint8Array) => Promise<void>,
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
      await prepare(bytes);
      return bytes;
    },
    put: (write) => artifacts.put(write),
  };
}

async function prepareSource(
  input: {
    readonly authorization: UserAuthorizationContext;
    readonly request: JudgePrivateDisclosureRequest;
  },
  bytes: Uint8Array,
): Promise<PreparedSource> {
  const sourceContentHash = await sha256Bytes(bytes);
  return {
    claimKeyHash: await sha256([
      PRIVATE_DISCLOSURE_OPERATION,
      input.request.meetingId,
      input.request.idempotencyKey,
    ]),
    providerInputBytes: bytes.byteLength,
    requestFingerprint: await sha256([
      PRIVATE_DISCLOSURE_OPERATION,
      input.authorization.userId,
      input.authorization.participantId,
      input.request.meetingId,
      input.request.idempotencyKey,
      input.request.sourceArtifactId,
      sourceContentHash,
    ]),
  };
}

function privateError(
  error: JudgeManagedStructuredAiError,
): JudgePrivateDisclosureError {
  return new JudgePrivateDisclosureError(
    error.code,
    error.code === "USAGE_LIMIT_REACHED" ? error.details : {},
  );
}

function epochSeconds(value: string): number {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || milliseconds % 1_000 !== 0) {
    throw new JudgePrivateDisclosureError("OPENAI_UNAVAILABLE");
  }
  return milliseconds / 1_000;
}

async function sha256(fields: readonly (number | string)[]): Promise<string> {
  return sha256Bytes(new TextEncoder().encode(JSON.stringify(fields)));
}

async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    Uint8Array.from(bytes).buffer,
  );
  return `sha256:${[...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}
