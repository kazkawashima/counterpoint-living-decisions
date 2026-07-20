import { describe, expect, it, vi } from "vitest";

import {
  OpenAiCandidateError,
  type PrivateDisclosureProposal,
} from "@counterpoint/adapters-openai";
import type {
  D1NamedUsageDecision,
  ManagedAiOperationReserveClaim,
} from "@counterpoint/adapters-cloudflare";
import {
  registerPrivateTextSource,
  type DisclosureDependencies,
} from "@counterpoint/application";
import type { DomainEvent, MeetingProjection } from "@counterpoint/domain";
import type {
  SessionRecord,
  UsageRequest,
  UsageSubject,
} from "@counterpoint/ports";

import {
  handleWorkerFlagshipHttp,
  type WorkerFlagshipHttpDependencies,
} from "../../../apps/worker/src/worker-flagship-http.js";
import type { JudgePrivateDisclosureRuntimeDependencies } from "../../../apps/worker/src/judge-private-disclosure.js";
import {
  JUDGE_STRUCTURED_AI_DESCRIPTORS,
  PRIVATE_DISCLOSURE_OPERATION,
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

const MEETING_ID = "meeting-worker-disclosure";
const PARTICIPANT_ID = "participant-worker-disclosure";
const USER_ID = "judge-worker-disclosure";
const SESSION_ID = "session-worker-disclosure";
const BEARER = "bearer-worker-disclosure";
const NOW = "2026-07-20T12:00:00.000Z";
const SOURCE_TEXT = "Synthetic private note with a bounded rollout.";
const EXACT_SNIPPET = "bounded rollout";

function managedRuntime(input: {
  readonly claim: (
    value: unknown,
  ) => Promise<"claimed" | "conflict" | "replayed">;
  readonly finalize?: (
    reservationId: string,
    actual: UsageRequest,
  ) => Promise<void>;
  readonly ipAddress: string;
  readonly propose: (
    value: Parameters<
      JudgePrivateDisclosureRuntimeDependencies["proposer"]["propose"]
    >[0],
  ) => Promise<PrivateDisclosureProposal>;
  readonly reserve: (
    subject: unknown,
    request: unknown,
  ) => Promise<
    | { readonly kind: "allowed"; readonly reservationId: string }
    | { readonly kind: "denied"; readonly limit: "tokens" }
  >;
}): JudgePrivateDisclosureRuntimeDependencies {
  const nowEpoch = Date.parse(NOW) / 1_000;
  const descriptor =
    JUDGE_STRUCTURED_AI_DESCRIPTORS[PRIVATE_DISCLOSURE_OPERATION];
  return {
    claims: {
      abandonReserved: vi.fn(() => Promise.resolve("abandoned" as const)),
      markProviderStarted: vi.fn(() => Promise.resolve("started" as const)),
      markSettled: vi.fn(() => Promise.resolve("settled" as const)),
      reserveClaim: vi.fn(
        async (claimInput: ManagedAiOperationReserveClaim) => {
          const legacyResult = await input.claim(claimInput);
          if (legacyResult === "conflict") {
            return { kind: "conflict" as const };
          }
          return {
            claim: {
              ...claimInput,
              providerStartedAtEpoch: undefined,
              reuseAfterEpoch: undefined,
              settledAtEpoch: undefined,
              status: "reserved" as const,
            },
            kind:
              legacyResult === "replayed"
                ? ("replayed" as const)
                : ("reserved" as const),
          };
        },
      ),
      takeOverReserved: vi.fn(() => Promise.resolve("taken_over" as const)),
    },
    ipAddress: input.ipAddress,
    nextReservationId: () => "reservation-worker-boundary",
    proposer: { propose: input.propose },
    reconcile: () => Promise.resolve(),
    usage: {
      finalize: input.finalize ?? vi.fn(() => Promise.resolve()),
      findReservation: vi.fn(() => Promise.resolve(undefined)),
      release: vi.fn(() => Promise.resolve()),
      reserveWithId: vi.fn(
        async (
          identity: {
            readonly reservationId: string;
            readonly requestFingerprint: string;
          },
          subject: UsageSubject,
          request: UsageRequest,
        ): Promise<D1NamedUsageDecision> => {
          const decision = await input.reserve(subject, request);
          return decision.kind === "denied"
            ? decision
            : {
                activeUntilEpoch: nowEpoch + descriptor.claimLeaseSeconds,
                kind: "allowed" as const,
                reservationId: identity.reservationId,
                reservedAtEpoch: nowEpoch,
              };
        },
      ),
    },
  };
}

function stableHash(value: string): string {
  return `fixture-${value.length}`;
}

function disclosureDependencies(): DisclosureDependencies {
  return {
    artifacts: new InMemoryArtifactStore(),
    clock: new MutableClock(NOW),
    events: new InMemoryEventStore<DomainEvent>(),
    hash: stableHash,
    ids: new SequenceIdGenerator(),
    projections: new InMemoryProjectionStore<MeetingProjection>(),
  };
}

async function fixture() {
  const disclosures = disclosureDependencies();
  const authorization = userAuthorizationContext({
    meetingId: MEETING_ID,
    participantId: PARTICIPANT_ID,
    role: "participant",
    sessionId: SESSION_ID,
    userId: USER_ID,
  });
  const registered = await registerPrivateTextSource(
    disclosures,
    authorization,
    {
      expectedPosition: 0,
      idempotencyKey: "register-worker-source",
      meetingId: MEETING_ID,
      text: SOURCE_TEXT,
      title: "Synthetic note",
    },
  );
  if (registered.kind !== "registered") {
    throw new Error(`Fixture registration failed: ${registered.code}`);
  }
  const session: SessionRecord = {
    absoluteExpiresAt: "2026-07-20T20:00:00.000Z",
    createdAt: NOW,
    lastActivityAt: NOW,
    sessionId: SESSION_ID,
    tokenHash: `digest:${BEARER}`,
    userId: USER_ID,
  };
  const dependencies = {
    clock: disclosures.clock,
    disclosures,
    events: disclosures.events,
    meetings: {
      findAssignment: () =>
        Promise.resolve({
          active: true,
          meetingId: MEETING_ID,
          participantId: PARTICIPANT_ID,
          role: "participant" as const,
          userId: USER_ID,
        }),
      findById: () =>
        Promise.resolve({
          active: true,
          code: "WORKER-DISCLOSURE",
          createdByUserId: USER_ID,
          facilitatorParticipantId: "participant-facilitator",
          meetingId: MEETING_ID,
          purpose: "Worker disclosure fixture",
        }),
    },
    sessions: {
      findByTokenHash: (hash: string) =>
        Promise.resolve(hash === session.tokenHash ? session : undefined),
      touch: vi.fn(() => Promise.resolve()),
    },
    tokens: {
      digest: (value: string) => Promise.resolve(`digest:${value}`),
    },
  } as unknown as WorkerFlagshipHttpDependencies;
  return {
    dependencies,
    sourceArtifactId: registered.source.sourceArtifactId,
  };
}

function request(
  sourceArtifactId: string,
  assistance: "ai_preferred" | "manual",
): Request {
  const start = SOURCE_TEXT.indexOf(EXACT_SNIPPET);
  return new Request("https://counterpoint.test/api/v1/disclosures/proposals", {
    body: JSON.stringify({
      assistance,
      exactSnippet:
        assistance === "manual"
          ? EXACT_SNIPPET
          : "caller placeholder must never be accepted",
      expectedPosition: 1,
      idempotencyKey: `worker-${assistance}`,
      meetingId: MEETING_ID,
      sourceArtifactId,
      sourceRange:
        assistance === "manual"
          ? { end: start + EXACT_SNIPPET.length, start }
          : { end: 1, start: 0 },
    }),
    headers: {
      authorization: `Bearer ${BEARER}`,
      "content-type": "application/json",
    },
    method: "POST",
  });
}

async function responseBody(
  response: Response,
): Promise<Record<string, unknown>> {
  const body: unknown = await response.json();
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new TypeError("Expected an object response body");
  }
  return Object.fromEntries(Object.entries(body));
}

describe("Worker private-disclosure boundary", () => {
  it("strips every proposer in manual mode and never touches claim or ledger", async () => {
    const fixtureValue = await fixture();
    const candidateProposer = vi.fn(() =>
      Promise.reject(new Error("manual mode must strip this proposer")),
    );
    const claim = vi.fn(() => Promise.reject(new Error("claim touched")));
    const reserve = vi.fn(() => Promise.reject(new Error("ledger touched")));
    const dependencies: WorkerFlagshipHttpDependencies = {
      ...fixtureValue.dependencies,
      disclosures: {
        ...fixtureValue.dependencies.disclosures,
        candidateProposer: { propose: candidateProposer },
      },
      judgePrivateDisclosure: managedRuntime({
        claim,
        ipAddress: "203.0.113.45",
        propose: candidateProposer,
        reserve,
      }),
    };

    const response = await handleWorkerFlagshipHttp({
      correlationId: "correlation-worker-manual",
      dependencies,
      operation: "propose-disclosure",
      request: request(fixtureValue.sourceArtifactId, "manual"),
    });

    expect(response.status).toBe(201);
    await expect(responseBody(response)).resolves.toMatchObject({
      origin: "human_selected",
    });
    expect(candidateProposer).not.toHaveBeenCalled();
    expect(claim).not.toHaveBeenCalled();
    expect(reserve).not.toHaveBeenCalled();
  });

  it("fails closed when ai_preferred is not configured", async () => {
    const fixtureValue = await fixture();
    const response = await handleWorkerFlagshipHttp({
      correlationId: "correlation-worker-unconfigured",
      dependencies: fixtureValue.dependencies,
      operation: "propose-disclosure",
      request: request(fixtureValue.sourceArtifactId, "ai_preferred"),
    });

    expect(response.status).toBe(503);
    await expect(responseBody(response)).resolves.toMatchObject({
      code: "OPENAI_UNAVAILABLE",
      details: {},
    });
    expect(await fixtureValue.dependencies.events.position(MEETING_ID)).toBe(1);
  });

  it("keeps the deterministic provider-free proposer available without managed billing", async () => {
    const fixtureValue = await fixture();
    const start = SOURCE_TEXT.indexOf(EXACT_SNIPPET);
    const propose = vi.fn(() =>
      Promise.resolve({
        exactSnippet: EXACT_SNIPPET,
        sourceRange: { end: start + EXACT_SNIPPET.length, start },
      }),
    );
    const response = await handleWorkerFlagshipHttp({
      correlationId: "correlation-worker-deterministic",
      dependencies: {
        ...fixtureValue.dependencies,
        deterministicPrivateDisclosureEnabled: true,
        disclosures: {
          ...fixtureValue.dependencies.disclosures,
          candidateProposer: { propose },
        },
      },
      operation: "propose-disclosure",
      request: request(fixtureValue.sourceArtifactId, "ai_preferred"),
    });

    expect(response.status).toBe(201);
    await expect(responseBody(response)).resolves.toMatchObject({
      origin: "ai_assisted",
    });
    expect(propose).toHaveBeenCalledTimes(1);
  });

  it("redacts OpenAiCandidateError at the Worker boundary", async () => {
    const fixtureValue = await fixture();
    const finalize = vi.fn(() => Promise.resolve());
    const dependencies: WorkerFlagshipHttpDependencies = {
      ...fixtureValue.dependencies,
      authorizationPolicy: {
        judgeManagedAiUserIds: new Set([USER_ID]),
      },
      judgePrivateDisclosure: managedRuntime({
        claim: vi.fn(() => Promise.resolve("claimed" as const)),
        finalize,
        ipAddress: "203.0.113.46",
        propose: vi.fn(() =>
          Promise.reject(
            new OpenAiCandidateError(
              "OPENAI_UNAVAILABLE",
              "sensitive upstream detail",
              true,
            ),
          ),
        ),
        reserve: vi.fn(() =>
          Promise.resolve({
            kind: "allowed" as const,
            reservationId: "reservation-worker-boundary",
          }),
        ),
      }),
    };

    const response = await handleWorkerFlagshipHttp({
      correlationId: "correlation-worker-provider",
      dependencies,
      operation: "propose-disclosure",
      request: request(fixtureValue.sourceArtifactId, "ai_preferred"),
    });

    expect(response.status).toBe(503);
    const body = await responseBody(response);
    expect(body).toMatchObject({ code: "OPENAI_UNAVAILABLE", details: {} });
    expect(JSON.stringify(body)).not.toContain("sensitive upstream detail");
    expect(finalize).toHaveBeenCalledTimes(1);
  });

  it("denies an ordinary participant before claim, ledger, or provider work", async () => {
    const fixtureValue = await fixture();
    const claim = vi.fn(() => Promise.resolve("claimed" as const));
    const reserve = vi.fn(() =>
      Promise.resolve({
        kind: "allowed" as const,
        reservationId: "reservation-must-not-exist",
      }),
    );
    const propose = vi.fn(() =>
      Promise.reject(new Error("provider must not be called")),
    );

    const response = await handleWorkerFlagshipHttp({
      correlationId: "correlation-worker-ordinary-denied",
      dependencies: {
        ...fixtureValue.dependencies,
        judgePrivateDisclosure: managedRuntime({
          claim,
          ipAddress: "203.0.113.47",
          propose,
          reserve,
        }),
      },
      operation: "propose-disclosure",
      request: request(fixtureValue.sourceArtifactId, "ai_preferred"),
    });

    expect(response.status).toBe(403);
    await expect(responseBody(response)).resolves.toMatchObject({
      code: "JUDGE_MODE_FORBIDDEN",
    });
    expect(claim).not.toHaveBeenCalled();
    expect(reserve).not.toHaveBeenCalled();
    expect(propose).not.toHaveBeenCalled();
  });

  it("stops an inactive assignment before managed work", async () => {
    const fixtureValue = await fixture();
    const claim = vi.fn(() => Promise.resolve("claimed" as const));
    const reserve = vi.fn(() =>
      Promise.resolve({
        kind: "allowed" as const,
        reservationId: "reservation-must-not-exist",
      }),
    );
    const propose = vi.fn(() =>
      Promise.reject(new Error("provider must not be called")),
    );
    const response = await handleWorkerFlagshipHttp({
      correlationId: "correlation-worker-inactive",
      dependencies: {
        ...fixtureValue.dependencies,
        authorizationPolicy: {
          judgeManagedAiUserIds: new Set([USER_ID]),
        },
        judgePrivateDisclosure: managedRuntime({
          claim,
          ipAddress: "203.0.113.48",
          propose,
          reserve,
        }),
        meetings: {
          ...fixtureValue.dependencies.meetings,
          findAssignment: () =>
            Promise.resolve({
              active: false,
              meetingId: MEETING_ID,
              participantId: PARTICIPANT_ID,
              role: "participant" as const,
              userId: USER_ID,
            }),
        },
      },
      operation: "propose-disclosure",
      request: request(fixtureValue.sourceArtifactId, "ai_preferred"),
    });

    expect(response.status).toBe(403);
    expect(claim).not.toHaveBeenCalled();
    expect(reserve).not.toHaveBeenCalled();
    expect(propose).not.toHaveBeenCalled();
  });
});
