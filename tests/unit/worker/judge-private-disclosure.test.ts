import { describe, expect, it, vi } from "vitest";

import {
  OpenAiCandidateError,
  type PrivateDisclosureProposal,
} from "@counterpoint/adapters-openai";
import {
  proposeDisclosure,
  registerPrivateTextSource,
  type DisclosureDependencies,
} from "@counterpoint/application";
import type { DomainEvent, MeetingProjection } from "@counterpoint/domain";
import type { UsageLimiter } from "@counterpoint/ports";

import {
  JudgePrivateDisclosureError,
  runJudgePrivateDisclosure,
  type ConcretePrivateDisclosureProposer,
  type JudgeManagedAiOperationClaimRepository,
} from "../../../apps/worker/src/judge-private-disclosure.js";
import {
  PRIVATE_DISCLOSURE_RESERVED_USAGE,
  calculatePrivateDisclosureActualUsage,
} from "../../../apps/worker/src/judge-structured-ai.js";
import {
  MutableClock,
  SequenceIdGenerator,
} from "../../helpers/application-adapters.js";
import {
  InMemoryArtifactStore,
  InMemoryEventStore,
  InMemoryProjectionStore,
} from "../../helpers/in-memory-ports.js";
import { userAuthorizationContext } from "../../../packages/application/src/sessions.js";

const MEETING_ID = "meeting-judge-disclosure";
const PARTICIPANT_ID = "participant-judge-disclosure";
const SESSION_ID = "session-judge-disclosure";
const USER_ID = "judge";
const IP_ADDRESS = "203.0.113.44";
const NOW = "2026-07-20T12:00:00.000Z";
const SOURCE_TEXT =
  "Synthetic private note. Share only the bounded rollout sentence.";
const EXACT_SNIPPET = "bounded rollout";

function authorization() {
  return userAuthorizationContext(
    {
      meetingId: MEETING_ID,
      participantId: PARTICIPANT_ID,
      role: "participant",
      sessionId: SESSION_ID,
      userId: USER_ID,
    },
    { judgeManagedAiUserIds: new Set([USER_ID]) },
  );
}

function stableHash(value: string): string {
  let hash = 2_166_136_261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return `fixture-${(hash >>> 0).toString(16)}`;
}

function baseDependencies(): DisclosureDependencies {
  return {
    artifacts: new InMemoryArtifactStore(),
    clock: new MutableClock(NOW),
    events: new InMemoryEventStore<DomainEvent>(),
    hash: stableHash,
    ids: new SequenceIdGenerator(),
    projections: new InMemoryProjectionStore<MeetingProjection>(),
  };
}

function proposal(
  billing: PrivateDisclosureProposal["billing"] = {
    attemptCount: 1,
    attempts: [{ inputTokens: 120, outputTokens: 30 }],
    inputTokens: 120,
    outputTokens: 30,
  },
): PrivateDisclosureProposal {
  const start = SOURCE_TEXT.indexOf(EXACT_SNIPPET);
  return {
    ai: {
      candidates: [
        {
          confidence: 0.9,
          exactSnippet: EXACT_SNIPPET,
          reason: "Synthetic fixture",
          sourceRange: { end: start + EXACT_SNIPPET.length, start },
          sourceReferenceId: "artifact-source-1",
        },
      ],
      confidence: 0.9,
      generatedAt: NOW,
      inputReferenceIds: ["artifact-source-1"],
      model: "gpt-5.6",
      operation: "private_evidence_disclosure",
      promptVersion: "private-evidence-v1",
      reason: "Synthetic fixture",
      schemaVersion: "1",
    },
    ...(billing === undefined ? {} : { billing }),
    exactSnippet: EXACT_SNIPPET,
    sourceRange: { end: start + EXACT_SNIPPET.length, start },
  };
}

interface Fixture {
  readonly claims: JudgeManagedAiOperationClaimRepository;
  readonly claim: ReturnType<typeof vi.fn>;
  readonly claimInputs: unknown[];
  readonly dependencies: DisclosureDependencies;
  readonly finalize: ReturnType<typeof vi.fn>;
  readonly order: string[];
  readonly proposer: { readonly propose: ReturnType<typeof vi.fn> };
  readonly releaseClaim: ReturnType<typeof vi.fn>;
  readonly releaseUsage: ReturnType<typeof vi.fn>;
  readonly reserve: ReturnType<typeof vi.fn>;
  readonly usage: UsageLimiter;
}

function fixture(
  options: {
    readonly claimError?: unknown;
    readonly claimResult?: "claimed" | "conflict" | "replayed";
    readonly finalizeError?: unknown;
    readonly proposal?: PrivateDisclosureProposal;
    readonly proposerError?: unknown;
    readonly releaseClaimError?: unknown;
    readonly releaseUsageError?: unknown;
    readonly reserveError?: unknown;
    readonly reservationLimit?: "cost" | "tokens";
  } = {},
): Fixture {
  const order: string[] = [];
  const claimInputs: unknown[] = [];
  const claim = vi.fn((input: unknown) => {
    order.push("claim");
    claimInputs.push(input);
    return options.claimError === undefined
      ? Promise.resolve(options.claimResult ?? "claimed")
      : Promise.reject(options.claimError);
  });
  const releaseClaim = vi.fn(() => {
    order.push("release-claim");
    return options.releaseClaimError === undefined
      ? Promise.resolve("released" as const)
      : Promise.reject(options.releaseClaimError);
  });
  const claims: JudgeManagedAiOperationClaimRepository = {
    claim,
    release: releaseClaim,
  };
  const reserve = vi.fn((subject: unknown, request: unknown) => {
    order.push("reserve");
    claimInputs.push({ request, subject });
    if (options.reserveError !== undefined) {
      return Promise.reject(options.reserveError);
    }
    return Promise.resolve(
      options.reservationLimit === undefined
        ? { kind: "allowed" as const, reservationId: "reservation-1" }
        : {
            kind: "denied" as const,
            limit: options.reservationLimit,
          },
    );
  });
  const finalize = vi.fn(() => {
    order.push("finalize");
    return options.finalizeError === undefined
      ? Promise.resolve()
      : Promise.reject(options.finalizeError);
  });
  const releaseUsage = vi.fn(() => {
    order.push("release-usage");
    return options.releaseUsageError === undefined
      ? Promise.resolve()
      : Promise.reject(options.releaseUsageError);
  });
  const usage: UsageLimiter = {
    finalize,
    release: releaseUsage,
    reserve,
  };
  const proposer = {
    propose: vi.fn(
      (_input: {
        readonly meetingId: string;
        readonly ownerParticipantId: string;
        readonly sourceArtifactId: string;
        readonly text: string;
      }): Promise<PrivateDisclosureProposal> => {
        order.push("provider");
        return options.proposerError === undefined
          ? Promise.resolve(options.proposal ?? proposal())
          : Promise.reject(options.proposerError);
      },
    ),
  };
  return {
    claims,
    claim,
    claimInputs,
    dependencies: baseDependencies(),
    finalize,
    order,
    proposer,
    releaseClaim,
    releaseUsage,
    reserve,
    usage,
  };
}

async function registerSource(
  dependencies: DisclosureDependencies,
  text = SOURCE_TEXT,
  idempotencyKey = "register-judge-source",
) {
  const result = await registerPrivateTextSource(
    dependencies,
    authorization(),
    {
      expectedPosition: await dependencies.events.position(MEETING_ID),
      idempotencyKey,
      meetingId: MEETING_ID,
      text,
      title: "Synthetic note",
    },
  );
  if (result.kind !== "registered") {
    throw new Error(`Fixture registration failed: ${result.code}`);
  }
  return result.source.sourceArtifactId;
}

function request(sourceArtifactId: string, expectedPosition = 1) {
  return {
    assistance: "ai_preferred" as const,
    exactSnippet: "caller placeholder must be ignored",
    expectedPosition,
    idempotencyKey: "judge-disclosure-proposal",
    meetingId: MEETING_ID,
    sourceArtifactId,
    sourceRange: { end: 1, start: 0 },
  };
}

async function execute(
  fixtureValue: Fixture,
  sourceArtifactId: string,
  requestValue = request(sourceArtifactId),
  authorizationValue = authorization(),
): Promise<Awaited<ReturnType<typeof proposeDisclosure>>> {
  return runJudgePrivateDisclosure({
    authorization: authorizationValue,
    claims: fixtureValue.claims,
    clock: { now: () => NOW },
    dependencies: fixtureValue.dependencies,
    ipAddress: IP_ADDRESS,
    proposer:
      fixtureValue.proposer as unknown as ConcretePrivateDisclosureProposer,
    request: requestValue,
    usage: fixtureValue.usage,
    execute: (dependencies) =>
      proposeDisclosure(dependencies, authorizationValue, {
        correlationId: "correlation-judge-disclosure",
        expectedPosition: requestValue.expectedPosition,
        idempotencyKey: requestValue.idempotencyKey,
        meetingId: requestValue.meetingId,
        sourceArtifactId: requestValue.sourceArtifactId,
      }),
  });
}

describe("judge private-disclosure orchestration", () => {
  it("claims, reserves, calls the provider, then finalizes trustworthy actual usage", async () => {
    const fixtureValue = fixture();
    const sourceArtifactId = await registerSource(fixtureValue.dependencies);

    await expect(
      execute(fixtureValue, sourceArtifactId),
    ).resolves.toMatchObject({
      kind: "proposed",
    });

    expect(fixtureValue.order).toEqual([
      "claim",
      "reserve",
      "provider",
      "finalize",
    ]);
    expect(fixtureValue.finalize).toHaveBeenCalledWith(
      "reservation-1",
      calculatePrivateDisclosureActualUsage("gpt-5.6", proposal().billing!),
    );
  });

  it("rejects a source over 64 KiB before claim, reservation, or provider", async () => {
    const fixtureValue = fixture();
    const sourceArtifactId = await registerSource(
      fixtureValue.dependencies,
      "x".repeat(64 * 1024 + 1),
    );

    await expect(execute(fixtureValue, sourceArtifactId)).rejects.toMatchObject(
      {
        code: "VALIDATION_FAILED",
      },
    );
    expect(fixtureValue.order).toEqual([]);
  });

  it("returns only the exhausted limit and releases the exact claim on denial", async () => {
    const fixtureValue = fixture({ reservationLimit: "tokens" });
    const sourceArtifactId = await registerSource(fixtureValue.dependencies);

    await expect(execute(fixtureValue, sourceArtifactId)).rejects.toEqual(
      new JudgePrivateDisclosureError("USAGE_LIMIT_REACHED", {
        limit: "tokens",
      }),
    );
    expect(fixtureValue.proposer.propose).not.toHaveBeenCalled();
    expect(fixtureValue.releaseClaim).toHaveBeenCalledWith(
      expect.objectContaining({
        createdAtEpoch: Date.parse(NOW) / 1_000,
      }),
    );
    expect(fixtureValue.releaseUsage).not.toHaveBeenCalled();
  });

  it.each([
    ["claim", { claimError: new Error("sensitive claim failure") }],
    ["reserve", { reserveError: new Error("sensitive reserve failure") }],
    [
      "claim release",
      {
        releaseClaimError: new Error("sensitive claim release failure"),
        reservationLimit: "cost" as const,
      },
    ],
  ])("redacts a %s infrastructure failure", async (_label, options) => {
    const fixtureValue = fixture(options);
    const sourceArtifactId = await registerSource(fixtureValue.dependencies);

    await expect(execute(fixtureValue, sourceArtifactId)).rejects.toEqual(
      new JudgePrivateDisclosureError("OPENAI_UNAVAILABLE"),
    );
    expect(fixtureValue.proposer.propose).not.toHaveBeenCalled();
  });

  it("retains the claim when reservation outcome is uncertain", async () => {
    const fixtureValue = fixture({
      reserveError: new Error("synthetic commit-before-response failure"),
    });
    const sourceArtifactId = await registerSource(fixtureValue.dependencies);

    await expect(execute(fixtureValue, sourceArtifactId)).rejects.toEqual(
      new JudgePrivateDisclosureError("OPENAI_UNAVAILABLE"),
    );
    expect(fixtureValue.releaseClaim).not.toHaveBeenCalled();
    expect(fixtureValue.proposer.propose).not.toHaveBeenCalled();
  });

  it("rejects direct use without judge-managed authorization before claim work", async () => {
    const fixtureValue = fixture();
    const sourceArtifactId = await registerSource(fixtureValue.dependencies);
    const ordinaryAuthorization = userAuthorizationContext({
      meetingId: MEETING_ID,
      participantId: PARTICIPANT_ID,
      role: "participant",
      sessionId: SESSION_ID,
      userId: USER_ID,
    });

    await expect(
      execute(
        fixtureValue,
        sourceArtifactId,
        request(sourceArtifactId),
        ordinaryAuthorization,
      ),
    ).rejects.toEqual(new JudgePrivateDisclosureError("OPENAI_UNAVAILABLE"));
    expect(fixtureValue.claim).not.toHaveBeenCalled();
  });

  it("replays a persisted application event through a replay-only proposer", async () => {
    const fixtureValue = fixture();
    const sourceArtifactId = await registerSource(fixtureValue.dependencies);
    const requestValue = request(sourceArtifactId);

    const first = await execute(fixtureValue, sourceArtifactId, requestValue);
    fixtureValue.claim.mockResolvedValue("replayed");
    const replayed = await execute(
      fixtureValue,
      sourceArtifactId,
      requestValue,
    );

    expect(replayed).toEqual(
      first.kind === "proposed" ? { ...first, replayed: true } : first,
    );
    expect(fixtureValue.proposer.propose).toHaveBeenCalledTimes(1);
    expect(fixtureValue.reserve).toHaveBeenCalledTimes(1);
  });

  it("fails closed without provider when a replay claim has no persisted result", async () => {
    const fixtureValue = fixture({ claimResult: "replayed" });
    const sourceArtifactId = await registerSource(fixtureValue.dependencies);

    await expect(execute(fixtureValue, sourceArtifactId)).rejects.toMatchObject(
      {
        code: "OPENAI_UNAVAILABLE",
      },
    );
    expect(fixtureValue.proposer.propose).not.toHaveBeenCalled();
    expect(fixtureValue.reserve).not.toHaveBeenCalled();
  });

  it("maps a changed fingerprint to an idempotency conflict", async () => {
    const fixtureValue = fixture({ claimResult: "conflict" });
    const sourceArtifactId = await registerSource(fixtureValue.dependencies);
    const changedSourceArtifactId = await registerSource(
      fixtureValue.dependencies,
      `${SOURCE_TEXT} Second synthetic source.`,
      "register-judge-source-changed",
    );

    await expect(execute(fixtureValue, sourceArtifactId)).rejects.toMatchObject(
      {
        code: "IDEMPOTENCY_CONFLICT",
      },
    );
    const firstClaim = fixtureValue.claim.mock.calls[0]?.[0] as {
      claimKeyHash: string;
      requestFingerprint: string;
    };
    await expect(
      execute(fixtureValue, sourceArtifactId, request(sourceArtifactId, 2)),
    ).rejects.toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
    });
    const repeatedClaim = fixtureValue.claim.mock.calls[1]?.[0] as {
      claimKeyHash: string;
      requestFingerprint: string;
    };
    const renewedSessionAuthorization = userAuthorizationContext(
      {
        meetingId: MEETING_ID,
        participantId: PARTICIPANT_ID,
        role: "participant",
        sessionId: `${SESSION_ID}-renewed`,
        userId: USER_ID,
      },
      { judgeManagedAiUserIds: new Set([USER_ID]) },
    );
    await expect(
      execute(
        fixtureValue,
        sourceArtifactId,
        request(sourceArtifactId, 3),
        renewedSessionAuthorization,
      ),
    ).rejects.toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
    });
    const renewedSessionClaim = fixtureValue.claim.mock.calls[2]?.[0] as {
      claimKeyHash: string;
      requestFingerprint: string;
    };
    await expect(
      execute(
        fixtureValue,
        changedSourceArtifactId,
        request(changedSourceArtifactId, 2),
      ),
    ).rejects.toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
    });
    const changedClaim = fixtureValue.claim.mock.calls[3]?.[0] as {
      claimKeyHash: string;
      requestFingerprint: string;
    };

    expect(repeatedClaim).toMatchObject(firstClaim);
    expect(renewedSessionClaim).toMatchObject(firstClaim);
    expect(changedClaim.claimKeyHash).toBe(firstClaim.claimKeyHash);
    expect(changedClaim.requestFingerprint).not.toBe(
      firstClaim.requestFingerprint,
    );
    expect(fixtureValue.reserve).not.toHaveBeenCalled();
    expect(fixtureValue.proposer.propose).not.toHaveBeenCalled();
  });

  it("releases reservation and exact claim generation on a pre-provider failure", async () => {
    const fixtureValue = fixture();
    const sourceArtifactId = await registerSource(fixtureValue.dependencies);
    const requestValue = request(sourceArtifactId);

    await expect(
      runJudgePrivateDisclosure({
        authorization: authorization(),
        claims: fixtureValue.claims,
        clock: { now: () => NOW },
        dependencies: fixtureValue.dependencies,
        execute: async (dependencies) => {
          await dependencies.artifacts.get({
            artifactId: sourceArtifactId,
            meetingId: MEETING_ID,
            ownerParticipantId: PARTICIPANT_ID,
            visibility: "private",
          });
          throw new Error("pre-provider application failure");
        },
        ipAddress: IP_ADDRESS,
        proposer:
          fixtureValue.proposer as unknown as ConcretePrivateDisclosureProposer,
        request: requestValue,
        usage: fixtureValue.usage,
      }),
    ).rejects.toThrow("pre-provider application failure");

    expect(fixtureValue.order).toEqual([
      "claim",
      "reserve",
      "release-usage",
      "release-claim",
    ]);
    expect(fixtureValue.releaseClaim).toHaveBeenCalledWith(
      expect.objectContaining({
        createdAtEpoch: Date.parse(NOW) / 1_000,
      }),
    );
  });

  it("retains the claim and redacts the error when reservation release fails", async () => {
    const fixtureValue = fixture({
      releaseUsageError: new Error("sensitive ledger release failure"),
    });
    const sourceArtifactId = await registerSource(fixtureValue.dependencies);
    const requestValue = request(sourceArtifactId);

    await expect(
      runJudgePrivateDisclosure({
        authorization: authorization(),
        claims: fixtureValue.claims,
        clock: { now: () => NOW },
        dependencies: fixtureValue.dependencies,
        execute: async (dependencies) => {
          await dependencies.artifacts.get({
            artifactId: sourceArtifactId,
            meetingId: MEETING_ID,
            ownerParticipantId: PARTICIPANT_ID,
            visibility: "private",
          });
          throw new Error("pre-provider application failure");
        },
        ipAddress: IP_ADDRESS,
        proposer:
          fixtureValue.proposer as unknown as ConcretePrivateDisclosureProposer,
        request: requestValue,
        usage: fixtureValue.usage,
      }),
    ).rejects.toEqual(new JudgePrivateDisclosureError("OPENAI_UNAVAILABLE"));
    expect(fixtureValue.releaseClaim).not.toHaveBeenCalled();
  });

  it("finalizes the full envelope and retains the claim after provider-started failure", async () => {
    const providerError = new OpenAiCandidateError(
      "OPENAI_UNAVAILABLE",
      "synthetic provider failure",
      true,
    );
    const fixtureValue = fixture({ proposerError: providerError });
    const sourceArtifactId = await registerSource(fixtureValue.dependencies);

    await expect(execute(fixtureValue, sourceArtifactId)).rejects.toBe(
      providerError,
    );
    expect(fixtureValue.finalize).toHaveBeenCalledWith(
      "reservation-1",
      PRIVATE_DISCLOSURE_RESERVED_USAGE,
    );
    expect(fixtureValue.releaseClaim).not.toHaveBeenCalled();
    expect(fixtureValue.releaseUsage).not.toHaveBeenCalled();
  });

  it("redacts a settlement failure after provider work starts", async () => {
    const fixtureValue = fixture({
      finalizeError: new Error("sensitive settlement failure"),
    });
    const sourceArtifactId = await registerSource(fixtureValue.dependencies);

    await expect(execute(fixtureValue, sourceArtifactId)).rejects.toEqual(
      new JudgePrivateDisclosureError("OPENAI_UNAVAILABLE"),
    );
    expect(fixtureValue.finalize).toHaveBeenCalledTimes(1);
    expect(fixtureValue.releaseClaim).not.toHaveBeenCalled();
    expect(fixtureValue.releaseUsage).not.toHaveBeenCalled();
  });

  it("allows at most one provider invocation per claimed reservation", async () => {
    const fixtureValue = fixture();
    const sourceArtifactId = await registerSource(fixtureValue.dependencies);
    const proposalInput = {
      meetingId: MEETING_ID,
      ownerParticipantId: PARTICIPANT_ID,
      sourceArtifactId,
      text: SOURCE_TEXT,
    };

    const results = await runJudgePrivateDisclosure({
      authorization: authorization(),
      claims: fixtureValue.claims,
      clock: { now: () => NOW },
      dependencies: fixtureValue.dependencies,
      execute: async (dependencies) => {
        await dependencies.artifacts.get({
          artifactId: sourceArtifactId,
          meetingId: MEETING_ID,
          ownerParticipantId: PARTICIPANT_ID,
          visibility: "private",
        });
        return Promise.allSettled([
          dependencies.candidateProposer!.propose(proposalInput),
          dependencies.candidateProposer!.propose(proposalInput),
        ]);
      },
      ipAddress: IP_ADDRESS,
      proposer:
        fixtureValue.proposer as unknown as ConcretePrivateDisclosureProposer,
      request: request(sourceArtifactId),
      usage: fixtureValue.usage,
    });

    expect(results.map(({ status }) => status).sort()).toEqual([
      "fulfilled",
      "rejected",
    ]);
    expect(fixtureValue.proposer.propose).toHaveBeenCalledTimes(1);
    expect(fixtureValue.finalize).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      "missing",
      (() => {
        const { billing: _billing, ...withoutBilling } = proposal();
        return withoutBilling;
      })(),
    ],
    [
      "malformed",
      proposal({
        attemptCount: 1,
        attempts: [{ inputTokens: -1, outputTokens: 1 }],
        inputTokens: -1,
        outputTokens: 1,
      }),
    ],
  ])("finalizes the full envelope for %s billing", async (_label, result) => {
    const fixtureValue = fixture({ proposal: result });
    const sourceArtifactId = await registerSource(fixtureValue.dependencies);

    await expect(
      execute(fixtureValue, sourceArtifactId),
    ).resolves.toMatchObject({
      kind: "proposed",
    });
    expect(fixtureValue.finalize).toHaveBeenCalledWith(
      "reservation-1",
      PRIVATE_DISCLOSURE_RESERVED_USAGE,
    );
  });

  it("uses only opaque hashes and server scope in claim and ledger inputs", async () => {
    const fixtureValue = fixture();
    const sourceArtifactId = await registerSource(fixtureValue.dependencies);

    await execute(fixtureValue, sourceArtifactId);

    const serialized = JSON.stringify(fixtureValue.claimInputs);
    expect(serialized).not.toContain(SOURCE_TEXT);
    expect(serialized).not.toContain("caller placeholder");
    expect(serialized).not.toContain(EXACT_SNIPPET);
    expect(fixtureValue.claim).toHaveBeenCalledWith(
      expect.objectContaining({
        claimKeyHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
        requestFingerprint: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
      }),
    );
    expect(fixtureValue.reserve).toHaveBeenCalledWith(
      {
        accountId: USER_ID,
        ipAddress: IP_ADDRESS,
        meetingId: MEETING_ID,
      },
      PRIVATE_DISCLOSURE_RESERVED_USAGE,
    );
  });
});
