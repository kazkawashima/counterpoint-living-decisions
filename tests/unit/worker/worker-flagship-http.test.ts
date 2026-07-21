import { describe, expect, it, vi } from "vitest";

import {
  ASSUMPTION_INVALIDATION_OPERATION,
  OpenAiCandidateError,
  type AssumptionInvalidationEvaluation,
  type PrivateDisclosureProposal,
  type SharedDecisionSynthesis,
} from "@counterpoint/adapters-openai";
import type {
  D1NamedUsageDecision,
  ManagedAiOperationLifecycleClaim,
  ManagedAiOperationReserveClaim,
} from "@counterpoint/adapters-cloudflare";
import {
  registerPrivateTextSource,
  type DecisionCandidateDependencies,
  type DisclosureDependencies,
} from "@counterpoint/application";
import {
  createDecisionRevision,
  createPremise,
  meetingId as domainMeetingId,
  monitorRegistrationId,
  nonEmptyText,
  replayMeeting,
  revisionNumber,
  suggestionId,
  timestamp,
  transitionDecision,
  type DomainEvent,
  type MeetingProjection,
} from "@counterpoint/domain";
import type {
  MeetingRecord,
  ParticipantAssignment,
  SessionRecord,
  UsageRequest,
  UsageSubject,
} from "@counterpoint/ports";

import {
  handleWorkerFlagshipHttp,
  type WorkerFlagshipHttpDependencies,
} from "../../../apps/worker/src/worker-flagship-http.js";
import type { JudgeAssumptionInvalidationRuntimeDependencies } from "../../../apps/worker/src/judge-assumption-invalidation.js";
import type { JudgePrivateDisclosureRuntimeDependencies } from "../../../apps/worker/src/judge-private-disclosure.js";
import type { JudgeSharedDecisionRuntimeDependencies } from "../../../apps/worker/src/judge-shared-decision.js";
import {
  JUDGE_STRUCTURED_AI_DESCRIPTORS,
  PRIVATE_DISCLOSURE_OPERATION,
} from "../../../apps/worker/src/judge-structured-ai.js";
import { DECISION_SYNTHESIS_OPERATION } from "@counterpoint/adapters-openai";
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
import {
  action,
  firstRevision,
  flagshipDecision,
  ids,
  sharedEvent,
  sharedEvidence,
} from "../domain/fixtures.js";

const MEETING_ID = "meeting-worker-disclosure";
const PARTICIPANT_ID = "participant-worker-disclosure";
const USER_ID = "judge-worker-disclosure";
const SESSION_ID = "session-worker-disclosure";
const BEARER = "bearer-worker-disclosure";
const NOW = "2026-07-20T12:00:00.000Z";
const SOURCE_TEXT = "Synthetic private note with a bounded rollout.";
const EXACT_SNIPPET = "bounded rollout";
const DECISION_EVIDENCE_ID = "evidence-worker-decision";
const FACILITATOR_ID = "participant-facilitator";

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
      releaseOrphanedReservation: vi.fn(() =>
        Promise.resolve("unavailable" as const),
      ),
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

function managedDecisionRuntime(input: {
  readonly claim: (
    input: ManagedAiOperationReserveClaim,
  ) => Promise<"claimed" | "conflict" | "replayed">;
  readonly finalize?: JudgeSharedDecisionRuntimeDependencies["usage"]["finalize"];
  readonly reconcile?: JudgeSharedDecisionRuntimeDependencies["reconcile"];
  readonly reserve: (
    subject: UsageSubject,
    request: UsageRequest,
  ) => Promise<
    | { readonly kind: "allowed"; readonly reservationId: string }
    | { readonly kind: "denied"; readonly limit: "tokens" }
  >;
  readonly synthesize: JudgeSharedDecisionRuntimeDependencies["synthesizer"]["synthesize"];
}): JudgeSharedDecisionRuntimeDependencies {
  const nowEpoch = Date.parse(NOW) / 1_000;
  const descriptor =
    JUDGE_STRUCTURED_AI_DESCRIPTORS[DECISION_SYNTHESIS_OPERATION];
  return {
    claims: {
      abandonReserved: vi.fn(() => Promise.resolve("abandoned" as const)),
      markProviderStarted: vi.fn(() => Promise.resolve("started" as const)),
      markSettled: vi.fn(() => Promise.resolve("settled" as const)),
      releaseOrphanedReservation: vi.fn(() =>
        Promise.resolve("unavailable" as const),
      ),
      reserveClaim: vi.fn(
        async (claimInput: ManagedAiOperationReserveClaim) => {
          const result = await input.claim(claimInput);
          if (result === "conflict") {
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
              result === "replayed"
                ? ("replayed" as const)
                : ("reserved" as const),
          };
        },
      ),
      takeOverReserved: vi.fn(() => Promise.resolve("taken_over" as const)),
    },
    ipAddress: "203.0.113.72",
    nextReservationId: () => "reservation-worker-decision",
    reconcile: input.reconcile ?? vi.fn(() => Promise.resolve()),
    synthesizer: { synthesize: input.synthesize },
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
          requestValue: UsageRequest,
        ): Promise<D1NamedUsageDecision> => {
          const result = await input.reserve(subject, requestValue);
          return result.kind === "denied"
            ? result
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

function invalidationEvaluation(): AssumptionInvalidationEvaluation {
  const suggestion = {
    affectedActionIds: [ids.actionEurope],
    affectedPremiseIds: [ids.premiseEurope],
    confidence: 0.91,
    evidenceReferenceIds: [
      ids.evidence,
      "demo://regulatory-change/eu-approval-gate",
    ],
    reason: "The synthetic regulation invalidates the monitored premise.",
  };
  return {
    ai: {
      candidates: [suggestion],
      generatedAt: NOW,
      inputReferenceIds: [
        "demo-regulator:worker-invalidation",
        String(firstRevision("COMMITTED").id),
        ids.premiseEurope,
        ids.actionEurope,
        ids.evidence,
        "demo://regulatory-change/eu-approval-gate",
      ],
      model: "gpt-5.6",
      operation: ASSUMPTION_INVALIDATION_OPERATION,
      promptVersion: "assumption-invalidation-v1",
      schemaVersion: "1",
    },
    billing: {
      attemptCount: 1,
      attempts: [{ inputTokens: 180, model: "gpt-5.6", outputTokens: 55 }],
      inputTokens: 180,
      outputTokens: 55,
    },
    suggestion,
  };
}

function managedInvalidationRuntime(input: {
  readonly claim: (
    input: ManagedAiOperationReserveClaim,
  ) => Promise<"claimed" | "conflict" | "replayed">;
  readonly evaluate: JudgeAssumptionInvalidationRuntimeDependencies["evaluator"]["evaluate"];
  readonly reserve: (
    subject: UsageSubject,
    request: UsageRequest,
  ) => Promise<D1NamedUsageDecision>;
}): JudgeAssumptionInvalidationRuntimeDependencies {
  return {
    claims: {
      abandonReserved: vi.fn(() => Promise.resolve("abandoned" as const)),
      markProviderStarted: vi.fn(() => Promise.resolve("started" as const)),
      markSettled: vi.fn(() => Promise.resolve("settled" as const)),
      releaseOrphanedReservation: vi.fn(() =>
        Promise.resolve("unavailable" as const),
      ),
      reserveClaim: vi.fn(
        async (claimInput: ManagedAiOperationReserveClaim) => {
          const result = await input.claim(claimInput);
          if (result === "conflict") {
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
              result === "replayed"
                ? ("replayed" as const)
                : ("reserved" as const),
          };
        },
      ),
      takeOverReserved: vi.fn(() => Promise.resolve("taken_over" as const)),
    },
    evaluator: { evaluate: input.evaluate },
    ipAddress: "203.0.113.74",
    nextReservationId: () => "reservation-worker-invalidation",
    reconcile: vi.fn(() => Promise.resolve()),
    usage: {
      finalize: vi.fn(() => Promise.resolve()),
      findReservation: vi.fn(() => Promise.resolve(undefined)),
      release: vi.fn(() => Promise.resolve()),
      reserveWithId: vi.fn(
        (
          _identity: {
            readonly requestFingerprint: string;
            readonly reservationId: string;
          },
          subject: UsageSubject,
          requestValue: UsageRequest,
        ) => input.reserve(subject, requestValue),
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

function decisionSynthesis(): SharedDecisionSynthesis {
  const draft = {
    action: {
      affectedPremiseIndex: 0 as const,
      ownerParticipantId: PARTICIPANT_ID,
      scope: "Document the approval gate.",
    },
    confidence: 0.9,
    dissent: {
      reason: "Rollback ownership needs review.",
      retained: true,
    },
    monitorCondition: "Reopen if the gate changes.",
    outcome: "Proceed after documenting the gate.",
    premise: {
      evidenceReferenceIds: [DECISION_EVIDENCE_ID],
      statement: "The approval gate is documented.",
    },
    reason: "The shared evidence supports a bounded decision.",
    title: "Conditional rollout",
  };
  return {
    ai: {
      candidates: [draft],
      generatedAt: NOW,
      inputReferenceIds: [DECISION_EVIDENCE_ID],
      model: "gpt-5.6",
      operation: DECISION_SYNTHESIS_OPERATION,
      promptVersion: "shared-decision-v1",
      schemaVersion: "1",
    },
    billing: {
      attemptCount: 1,
      attempts: [{ inputTokens: 200, model: "gpt-5.6", outputTokens: 70 }],
      inputTokens: 200,
      outputTokens: 70,
    },
    draft,
  };
}

async function decisionFixture(
  options: {
    readonly participantIds?: readonly string[];
  } = {},
) {
  const fixtureValue = await fixture();
  const evidenceEvent = {
    actor: { kind: "participant", participantId: PARTICIPANT_ID },
    correlationId: "correlation-worker-decision-evidence",
    eventId: "event-worker-decision-evidence",
    eventType: "EvidenceShared",
    meetingId: MEETING_ID,
    occurredAt: NOW,
    payload: {
      evidence: {
        confirmationStatus: "confirmed",
        createdAt: NOW,
        createdBy: PARTICIPANT_ID,
        disclosureAuditReferenceId: "audit-worker-decision",
        exactSnippet: "Synthetic shared evidence for the approval gate.",
        id: DECISION_EVIDENCE_ID,
        meetingId: MEETING_ID,
        origin: "source_artifact",
        revision: 1,
        sourceArtifactId: "artifact-worker-decision",
        sourceRange: { end: 48, start: 0 },
        visibility: "shared",
      },
    },
    position: 2,
    schemaVersion: 1,
    visibility: "shared",
  } as unknown as DomainEvent;
  const appended = await fixtureValue.dependencies.events.append({
    events: [evidenceEvent],
    expectedPosition: 1,
    meetingId: MEETING_ID,
  });
  if (appended.kind !== "appended") {
    throw new Error("Decision evidence fixture failed");
  }
  let generatedId = 0;
  const decisionCandidates: DecisionCandidateDependencies = {
    clock: fixtureValue.dependencies.clock,
    events: fixtureValue.dependencies.events,
    hash: stableHash,
    ids: {
      next(namespace) {
        generatedId += 1;
        return `worker-decision-${namespace}-${String(generatedId)}`;
      },
    },
    listParticipantIds: () =>
      Promise.resolve(
        options.participantIds ?? [FACILITATOR_ID, PARTICIPANT_ID],
      ),
    projections: new InMemoryProjectionStore<MeetingProjection>(),
  };
  return {
    ...fixtureValue,
    dependencies: {
      ...fixtureValue.dependencies,
      decisionCandidates,
      meetings: {
        ...fixtureValue.dependencies.meetings,
        findAssignment: () =>
          Promise.resolve({
            active: true,
            meetingId: MEETING_ID,
            participantId: FACILITATOR_ID,
            role: "facilitator" as const,
            userId: USER_ID,
          }),
      },
    },
  };
}

async function invalidationFixture() {
  const fixtureValue = await fixture();
  const scope = domainMeetingId(MEETING_ID);
  const clock = new MutableClock(NOW);
  const projections = new InMemoryProjectionStore<MeetingProjection>();
  let generatedId = 0;
  const generator = {
    next(namespace: string) {
      generatedId += 1;
      return `worker-invalidation-${namespace}-${String(generatedId)}`;
    },
  };
  const premise = createPremise({
    confirmationStatus: "confirmed",
    createdAt: timestamp("2026-07-19T00:01:00.000Z"),
    createdBy: ids.facilitator,
    dependencyScope: [nonEmptyText("Europe rollout")],
    id: ids.premiseEurope,
    meetingId: scope,
    monitorCondition: {
      description: nonEmptyText("Monitor European regulatory changes"),
    },
    origin: "ai_inference",
    revision: revisionNumber(1),
    statement: nonEmptyText(
      "The current European rollout remains legally permitted",
    ),
    visibility: "shared",
  });
  const rolloutAction = action(
    ids.actionEurope,
    ids.premiseEurope,
    "Europe rollout",
    { meetingId: scope },
  );
  const committedDecision = flagshipDecision("COMMITTED", {
    actionIds: [ids.actionEurope],
    dissentIds: [],
    meetingId: scope,
  });
  const monitoringDecision = transitionDecision(committedDecision, {
    authority: { kind: "system" },
    monitorRegistrationId: monitorRegistrationId("monitor-worker-invalidation"),
    to: "MONITORING",
  });
  const baseRevision = firstRevision("COMMITTED");
  const committedRevision = createDecisionRevision({
    ...baseRevision,
    meetingId: scope,
    snapshot: {
      ...baseRevision.snapshot,
      actionIds: [ids.actionEurope],
      dissentIds: [],
    },
  });
  const events = [
    {
      ...sharedEvent("EvidenceShared", 2, {
        evidence: { ...sharedEvidence(), meetingId: scope },
      }),
      meetingId: scope,
    },
    {
      ...sharedEvent("InferenceConfirmed", 3, {
        confirmedBy: ids.facilitator,
        result: { entity: premise, kind: "premise" },
        suggestionId: suggestionId("suggestion-worker-premise"),
      }),
      meetingId: scope,
    },
    {
      ...sharedEvent("InferenceConfirmed", 4, {
        confirmedBy: ids.facilitator,
        result: { entity: rolloutAction, kind: "action" },
        suggestionId: suggestionId("suggestion-worker-action"),
      }),
      meetingId: scope,
    },
    {
      ...sharedEvent("DecisionCommitted", 5, {
        decision: committedDecision,
        revision: committedRevision,
      }),
      meetingId: scope,
    },
    {
      ...sharedEvent("MonitoringStarted", 6, {
        decision: monitoringDecision,
        monitorRegistrationId: monitorRegistrationId(
          "monitor-worker-invalidation",
        ),
      }),
      meetingId: scope,
    },
  ] as readonly DomainEvent[];
  const seeded = await fixtureValue.dependencies.events.append({
    events,
    expectedPosition: 1,
    meetingId: MEETING_ID,
  });
  if (seeded.kind !== "appended") {
    throw new Error("Worker invalidation fixture failed");
  }
  return {
    ...fixtureValue,
    clock,
    committedRevision,
    dependencies: {
      ...fixtureValue.dependencies,
      clock,
      externalEvents: {
        clock,
        events: fixtureValue.dependencies.events,
        ids: generator,
        projections,
      },
      invalidationEvaluations: {
        clock,
        events: fixtureValue.dependencies.events,
        hash: stableHash,
        ids: generator,
        projections,
      },
      ids: generator,
      meetings: {
        ...fixtureValue.dependencies.meetings,
        findAssignment: () =>
          Promise.resolve({
            active: true,
            meetingId: MEETING_ID,
            participantId: FACILITATOR_ID,
            role: "facilitator" as const,
            userId: USER_ID,
          }),
      },
    },
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

function decisionRequest(assistance: "ai_preferred" | "manual"): Request {
  return new Request("https://counterpoint.test/api/v1/decisions/candidates", {
    body: JSON.stringify({
      assistance,
      ...(assistance === "manual"
        ? {
            draft: {
              actions: [
                {
                  ownerParticipantId: PARTICIPANT_ID,
                  scope: ["Document the approval gate."],
                },
              ],
              dissent: [
                {
                  reason: "Rollback ownership needs review.",
                  retained: true,
                },
              ],
              monitorCondition: {
                description: "Reopen if the gate changes.",
              },
              outcome: "Proceed after documenting the gate.",
              premises: [
                {
                  evidenceReferenceIds: [DECISION_EVIDENCE_ID],
                  statement: "The approval gate is documented.",
                },
              ],
              title: "Conditional rollout",
            },
          }
        : {}),
      expectedPosition: 2,
      idempotencyKey: `worker-decision-${assistance}`,
      meetingId: MEETING_ID,
    }),
    headers: {
      authorization: `Bearer ${BEARER}`,
      "content-type": "application/json",
    },
    method: "POST",
  });
}

function invalidationRequest(): Request {
  return new Request(
    "https://counterpoint.test/api/v1/demo/regulatory-change",
    {
      body: JSON.stringify({
        idempotencyKey: "worker-invalidation",
      }),
      headers: {
        authorization: `Bearer ${BEARER}`,
        "content-type": "application/json",
      },
      method: "POST",
    },
  );
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
  it("revokes transient meeting credentials after the durable session logout", async () => {
    const fixtureValue = await fixture();
    const revoked = vi.fn(() => Promise.resolve());
    const onSessionLogout = vi.fn(() => Promise.resolve());
    const response = await handleWorkerFlagshipHttp({
      correlationId: "correlation-worker-logout",
      dependencies: {
        ...fixtureValue.dependencies,
        onSessionLogout,
        sessions: {
          ...fixtureValue.dependencies.sessions,
          revoke: revoked,
        },
      },
      operation: "logout",
      request: new Request("https://counterpoint.test/api/v1/logout", {
        body: JSON.stringify({}),
        headers: {
          authorization: `Bearer ${BEARER}`,
          "content-type": "application/json",
        },
        method: "POST",
      }),
    });

    expect(response.status).toBe(200);
    expect(revoked).toHaveBeenCalledWith(SESSION_ID, NOW);
    expect(onSessionLogout).toHaveBeenCalledWith({
      sessionId: SESSION_ID,
      userId: USER_ID,
    });
    expect(revoked.mock.invocationCallOrder[0]).toBeLessThan(
      onSessionLogout.mock.invocationCallOrder[0]!,
    );
  });

  it.each(["evidence", "decisions"] as const)(
    "does not read private source bodies for the shared %s list",
    async (operation) => {
      const fixtureValue = await fixture();
      const privateBodyRead = vi.spyOn(
        fixtureValue.dependencies.disclosures.artifacts,
        "get",
      );
      privateBodyRead.mockClear();
      const dependencies = {
        ...fixtureValue.dependencies,
        meetings: {
          ...fixtureValue.dependencies.meetings,
          listAssignments: () =>
            Promise.resolve([
              {
                active: true,
                meetingId: MEETING_ID,
                participantId: PARTICIPANT_ID,
                role: "participant" as const,
                userId: USER_ID,
              },
            ]),
        },
      };

      const response = await handleWorkerFlagshipHttp({
        correlationId: `correlation-worker-${operation}-no-private-body`,
        dependencies,
        meetingId: MEETING_ID,
        operation,
        request: new Request(
          `https://counterpoint.test/api/v1/meetings/${MEETING_ID}/${operation}`,
          { headers: { authorization: `Bearer ${BEARER}` } },
        ),
      });

      expect(response.status).toBe(200);
      expect(privateBodyRead).not.toHaveBeenCalled();
    },
  );

  it("projects truthful UI grammar labels for shared evidence", async () => {
    const fixtureValue = await decisionFixture();
    const dependencies = {
      ...fixtureValue.dependencies,
      meetings: {
        ...fixtureValue.dependencies.meetings,
        listAssignments: () =>
          Promise.resolve([
            {
              active: true,
              meetingId: MEETING_ID,
              participantId: FACILITATOR_ID,
              role: "facilitator" as const,
              userId: USER_ID,
            },
          ]),
      },
    };
    const response = await handleWorkerFlagshipHttp({
      correlationId: "correlation-worker-evidence-projection",
      dependencies,
      meetingId: MEETING_ID,
      operation: "evidence",
      request: new Request(
        `https://counterpoint.test/api/v1/meetings/${MEETING_ID}/evidence`,
        { headers: { authorization: `Bearer ${BEARER}` } },
      ),
    });

    expect(response.status).toBe(200);
    await expect(responseBody(response)).resolves.toMatchObject({
      evidence: [
        {
          confirmationStatus: "human_confirmed",
          evidenceId: DECISION_EVIDENCE_ID,
          origin: "source",
          provenance: "approved_exact_excerpt",
          scope: "shared",
        },
      ],
    });
  });

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
        providerFreePrivateDisclosureEnabled: true,
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

describe("Worker shared Decision boundary", () => {
  it("meters judge ai_preferred synthesis", async () => {
    const fixtureValue = await decisionFixture();
    const claim = vi.fn(() => Promise.resolve("claimed" as const));
    const reserve = vi.fn(() =>
      Promise.resolve({
        kind: "allowed" as const,
        reservationId: "reservation-worker-decision",
      }),
    );
    const synthesize = vi.fn(() => Promise.resolve(decisionSynthesis()));

    const response = await handleWorkerFlagshipHttp({
      correlationId: "correlation-worker-decision-managed",
      dependencies: {
        ...fixtureValue.dependencies,
        authorizationPolicy: {
          judgeManagedAiUserIds: new Set([USER_ID]),
        },
        judgeSharedDecision: managedDecisionRuntime({
          claim,
          reserve,
          synthesize,
        }),
      },
      operation: "prepare-decision-candidate",
      request: decisionRequest("ai_preferred"),
    });

    expect(response.status).toBe(201);
    expect(claim).toHaveBeenCalledTimes(1);
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(synthesize).toHaveBeenCalledTimes(1);
  });

  it("denies an ordinary facilitator before Decision lifecycle work", async () => {
    const fixtureValue = await decisionFixture();
    const claim = vi.fn(() => Promise.resolve("claimed" as const));
    const reserve = vi.fn(() =>
      Promise.reject(new Error("ordinary request touched ledger")),
    );
    const synthesize = vi.fn(() =>
      Promise.reject(new Error("ordinary request touched provider")),
    );

    const response = await handleWorkerFlagshipHttp({
      correlationId: "correlation-worker-decision-ordinary",
      dependencies: {
        ...fixtureValue.dependencies,
        judgeSharedDecision: managedDecisionRuntime({
          claim,
          reserve,
          synthesize,
        }),
      },
      operation: "prepare-decision-candidate",
      request: decisionRequest("ai_preferred"),
    });

    expect(response.status).toBe(403);
    await expect(responseBody(response)).resolves.toMatchObject({
      code: "JUDGE_MODE_FORBIDDEN",
    });
    expect(claim).not.toHaveBeenCalled();
    expect(reserve).not.toHaveBeenCalled();
    expect(synthesize).not.toHaveBeenCalled();
  });

  it("keeps manual Decision synthesis at zero lifecycle usage", async () => {
    const fixtureValue = await decisionFixture();
    const injectedSynthesizer = vi.fn(() =>
      Promise.reject(new Error("manual request touched synthesizer")),
    );
    const claim = vi.fn(() =>
      Promise.reject(new Error("manual request touched claim")),
    );
    const reserve = vi.fn(() =>
      Promise.reject(new Error("manual request touched ledger")),
    );

    const response = await handleWorkerFlagshipHttp({
      correlationId: "correlation-worker-decision-manual",
      dependencies: {
        ...fixtureValue.dependencies,
        decisionCandidates: {
          ...fixtureValue.dependencies.decisionCandidates,
          synthesizer: { synthesize: injectedSynthesizer },
        },
        judgeSharedDecision: managedDecisionRuntime({
          claim,
          reserve,
          synthesize: injectedSynthesizer,
        }),
      },
      operation: "prepare-decision-candidate",
      request: decisionRequest("manual"),
    });

    expect(response.status).toBe(201);
    expect(claim).not.toHaveBeenCalled();
    expect(reserve).not.toHaveBeenCalled();
    expect(injectedSynthesizer).not.toHaveBeenCalled();
  });

  it("keeps deterministic Decision synthesis outside managed lifecycle", async () => {
    const fixtureValue = await decisionFixture();
    const synthesize = vi.fn(() => Promise.resolve(decisionSynthesis()));

    const response = await handleWorkerFlagshipHttp({
      correlationId: "correlation-worker-decision-deterministic",
      dependencies: {
        ...fixtureValue.dependencies,
        decisionCandidates: {
          ...fixtureValue.dependencies.decisionCandidates,
          synthesizer: { synthesize },
        },
        providerFreeSharedDecisionEnabled: true,
      },
      operation: "prepare-decision-candidate",
      request: decisionRequest("ai_preferred"),
    });

    expect(response.status).toBe(201);
    expect(synthesize).toHaveBeenCalledTimes(1);
  });

  it("fails closed when managed and deterministic Decision synthesis are disabled", async () => {
    const fixtureValue = await decisionFixture();

    const response = await handleWorkerFlagshipHttp({
      correlationId: "correlation-worker-decision-disabled",
      dependencies: fixtureValue.dependencies,
      operation: "prepare-decision-candidate",
      request: decisionRequest("ai_preferred"),
    });

    expect(response.status).toBe(503);
    await expect(responseBody(response)).resolves.toMatchObject({
      code: "OPENAI_UNAVAILABLE",
    });
  });

  it("replays a completed Decision candidate when AI runtime is disabled", async () => {
    const fixtureValue = await decisionFixture();
    const synthesize = vi.fn(() => Promise.resolve(decisionSynthesis()));
    const first = await handleWorkerFlagshipHttp({
      correlationId: "correlation-worker-decision-replay-first",
      dependencies: {
        ...fixtureValue.dependencies,
        authorizationPolicy: {
          judgeManagedAiUserIds: new Set([USER_ID]),
        },
        judgeSharedDecision: managedDecisionRuntime({
          claim: vi.fn(() => Promise.resolve("claimed" as const)),
          reserve: vi.fn(() =>
            Promise.resolve({
              kind: "allowed" as const,
              reservationId: "reservation-worker-decision-replay",
            }),
          ),
          synthesize,
        }),
      },
      operation: "prepare-decision-candidate",
      request: decisionRequest("ai_preferred"),
    });
    expect(first.status).toBe(201);

    const replay = await handleWorkerFlagshipHttp({
      correlationId: "correlation-worker-decision-replay-disabled",
      dependencies: fixtureValue.dependencies,
      operation: "prepare-decision-candidate",
      request: decisionRequest("ai_preferred"),
    });

    expect(replay.status).toBe(201);
    expect(synthesize).toHaveBeenCalledTimes(1);
  });

  it("denies an allowlisted non-facilitator before Decision lifecycle work", async () => {
    const fixtureValue = await decisionFixture();
    const claim = vi.fn(() =>
      Promise.reject(new Error("participant request touched claim")),
    );
    const reserve = vi.fn(() =>
      Promise.reject(new Error("participant request touched ledger")),
    );
    const synthesize = vi.fn(() =>
      Promise.reject(new Error("participant request touched provider")),
    );
    const response = await handleWorkerFlagshipHttp({
      correlationId: "correlation-worker-decision-participant",
      dependencies: {
        ...fixtureValue.dependencies,
        authorizationPolicy: {
          judgeManagedAiUserIds: new Set([USER_ID]),
        },
        judgeSharedDecision: managedDecisionRuntime({
          claim,
          reserve,
          synthesize,
        }),
        meetings: {
          ...fixtureValue.dependencies.meetings,
          findAssignment: () =>
            Promise.resolve({
              active: true,
              meetingId: MEETING_ID,
              participantId: PARTICIPANT_ID,
              role: "participant" as const,
              userId: USER_ID,
            }),
        },
      },
      operation: "prepare-decision-candidate",
      request: decisionRequest("ai_preferred"),
    });

    expect(response.status).toBe(403);
    await expect(responseBody(response)).resolves.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(claim).not.toHaveBeenCalled();
    expect(reserve).not.toHaveBeenCalled();
    expect(synthesize).not.toHaveBeenCalled();
  });

  it("rejects oversize Decision input before reconciliation or mutation", async () => {
    const participantIds = Array.from(
      { length: 6_000 },
      (_, index) => `participant-${index.toString().padStart(5, "0")}`,
    );
    participantIds[0] = PARTICIPANT_ID;
    participantIds[1] = FACILITATOR_ID;
    const fixtureValue = await decisionFixture({ participantIds });
    const claim = vi.fn(() => Promise.resolve("claimed" as const));
    const reconcile = vi.fn(() => Promise.resolve());
    const reserve = vi.fn(() =>
      Promise.reject(new Error("oversize request touched ledger")),
    );
    const synthesize = vi.fn(() =>
      Promise.reject(new Error("oversize request touched provider")),
    );

    const response = await handleWorkerFlagshipHttp({
      correlationId: "correlation-worker-decision-oversize",
      dependencies: {
        ...fixtureValue.dependencies,
        authorizationPolicy: {
          judgeManagedAiUserIds: new Set([USER_ID]),
        },
        judgeSharedDecision: managedDecisionRuntime({
          claim,
          reconcile,
          reserve,
          synthesize,
        }),
      },
      operation: "prepare-decision-candidate",
      request: decisionRequest("ai_preferred"),
    });

    expect(response.status).toBe(400);
    await expect(responseBody(response)).resolves.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    expect(reconcile).not.toHaveBeenCalled();
    expect(claim).not.toHaveBeenCalled();
    expect(reserve).not.toHaveBeenCalled();
    expect(synthesize).not.toHaveBeenCalled();
  });
});

describe("Worker assumption invalidation boundary", () => {
  it("keeps the external receipt durable before managed usage denial returns typed 429", async () => {
    const fixtureValue = await invalidationFixture();
    const evaluate = vi.fn(() => Promise.resolve(invalidationEvaluation()));
    const response = await handleWorkerFlagshipHttp({
      correlationId: "correlation-worker-invalidation-denied",
      dependencies: {
        ...fixtureValue.dependencies,
        authorizationPolicy: {
          judgeManagedAiUserIds: new Set([USER_ID]),
        },
        judgeAssumptionInvalidation: managedInvalidationRuntime({
          claim: vi.fn(() => Promise.resolve("claimed" as const)),
          evaluate,
          reserve: vi.fn(() =>
            Promise.resolve({
              kind: "denied" as const,
              limit: "cost" as const,
            }),
          ),
        }),
      },
      meetingId: MEETING_ID,
      operation: "inject-demo-regulatory-change",
      request: invalidationRequest(),
    });

    expect(response.status).toBe(429);
    await expect(responseBody(response)).resolves.toMatchObject({
      code: "USAGE_LIMIT_REACHED",
      details: { limit: "cost" },
    });
    const records = await fixtureValue.dependencies.events.load(MEETING_ID);
    expect(
      records.filter(
        ({ event }) => event.eventType === "ExternalEventReceived",
      ),
    ).toHaveLength(1);
    expect(evaluate).not.toHaveBeenCalled();
  });

  it("keeps provider failure as a durable 202 pending receipt", async () => {
    const fixtureValue = await invalidationFixture();
    const response = await handleWorkerFlagshipHttp({
      correlationId: "correlation-worker-invalidation-provider-failure",
      dependencies: {
        ...fixtureValue.dependencies,
        authorizationPolicy: {
          judgeManagedAiUserIds: new Set([USER_ID]),
        },
        judgeAssumptionInvalidation: managedInvalidationRuntime({
          claim: vi.fn(() => Promise.resolve("claimed" as const)),
          evaluate: vi.fn(() =>
            Promise.reject(new Error("sensitive provider failure")),
          ),
          reserve: vi.fn(() =>
            Promise.resolve({
              activeUntilEpoch: Date.parse(NOW) / 1_000 + 120,
              kind: "allowed" as const,
              reservationId: "reservation-worker-invalidation",
              reservedAtEpoch: Date.parse(NOW) / 1_000,
            }),
          ),
        }),
      },
      meetingId: MEETING_ID,
      operation: "inject-demo-regulatory-change",
      request: invalidationRequest(),
    });

    expect(response.status).toBe(202);
    await expect(responseBody(response)).resolves.toMatchObject({
      evaluationStatus: "pending",
      receiptStatus: "received",
    });
    expect(
      (await fixtureValue.dependencies.events.load(MEETING_ID)).filter(
        ({ event }) => event.eventType === "ExternalEventReceived",
      ),
    ).toHaveLength(1);
  });

  it("retries after retention with the original durable receipt and revision identity", async () => {
    const fixtureValue = await invalidationFixture();
    const claims: ManagedAiOperationReserveClaim[] = [];
    const evaluatorInputs: unknown[] = [];
    let attempt = 0;
    let lifecycle: ManagedAiOperationLifecycleClaim | undefined;
    const clock = fixtureValue.dependencies.clock;
    const baseRuntime = managedInvalidationRuntime({
      claim: vi.fn(() => Promise.resolve("claimed" as const)),
      evaluate: vi.fn((input) => {
        evaluatorInputs.push(structuredClone(input));
        attempt += 1;
        return attempt === 1
          ? Promise.reject(new Error("first provider failure"))
          : Promise.resolve(invalidationEvaluation());
      }),
      reserve: vi.fn(() =>
        Promise.resolve({
          activeUntilEpoch:
            Date.parse(clock.now()) / 1_000 +
            JUDGE_STRUCTURED_AI_DESCRIPTORS[ASSUMPTION_INVALIDATION_OPERATION]
              .claimLeaseSeconds,
          kind: "allowed" as const,
          reservationId: "reservation-worker-invalidation",
          reservedAtEpoch: Date.parse(clock.now()) / 1_000,
        }),
      ),
    });
    const runtime: JudgeAssumptionInvalidationRuntimeDependencies = {
      ...baseRuntime,
      claims: {
        abandonReserved: vi.fn(() => Promise.resolve("abandoned" as const)),
        markProviderStarted: vi.fn(
          (
            input: Parameters<
              JudgeAssumptionInvalidationRuntimeDependencies["claims"]["markProviderStarted"]
            >[0],
          ) => {
            if (
              lifecycle?.status !== "reserved" ||
              lifecycle.createdAtEpoch !== input.createdAtEpoch
            ) {
              return Promise.resolve("unavailable" as const);
            }
            lifecycle = {
              ...lifecycle,
              providerStartedAtEpoch: input.providerStartedAtEpoch,
              status: "provider_started",
            };
            return Promise.resolve("started" as const);
          },
        ),
        markSettled: vi.fn(
          (
            input: Parameters<
              JudgeAssumptionInvalidationRuntimeDependencies["claims"]["markSettled"]
            >[0],
          ) => {
            const current = lifecycle;
            if (
              current?.status !== "provider_started" ||
              input.expectedStatus !== "provider_started" ||
              current.createdAtEpoch !== input.createdAtEpoch
            ) {
              return Promise.resolve("unavailable" as const);
            }
            lifecycle = {
              ...current,
              leaseExpiresAtEpoch: undefined,
              reuseAfterEpoch: input.reuseAfterEpoch,
              settledAtEpoch: input.settledAtEpoch,
              status: "settled",
            };
            return Promise.resolve("settled" as const);
          },
        ),
        releaseOrphanedReservation: vi.fn(() =>
          Promise.resolve("unavailable" as const),
        ),
        reserveClaim: vi.fn((input: ManagedAiOperationReserveClaim) => {
          if (
            lifecycle?.status === "settled" &&
            input.createdAtEpoch <= lifecycle.reuseAfterEpoch
          ) {
            return Promise.resolve({
              claim: lifecycle,
              kind: "replayed" as const,
            });
          }
          claims.push(input);
          lifecycle = {
            ...input,
            providerStartedAtEpoch: undefined,
            reuseAfterEpoch: undefined,
            settledAtEpoch: undefined,
            status: "reserved",
          };
          return Promise.resolve({
            claim: lifecycle,
            kind: "reserved" as const,
          });
        }),
        takeOverReserved: vi.fn(() => Promise.resolve("taken_over" as const)),
      },
    };
    const dependencies: WorkerFlagshipHttpDependencies = {
      ...fixtureValue.dependencies,
      authorizationPolicy: {
        judgeManagedAiUserIds: new Set([USER_ID]),
      },
      judgeAssumptionInvalidation: runtime,
      sessions: {
        ...fixtureValue.dependencies.sessions,
        findByTokenHash: async (tokenHash) => {
          const session =
            await fixtureValue.dependencies.sessions.findByTokenHash(tokenHash);
          return session === undefined
            ? undefined
            : {
                ...session,
                absoluteExpiresAt: new Date(
                  Date.parse(clock.now()) + 8 * 60 * 60 * 1_000,
                ).toISOString(),
                lastActivityAt: clock.now(),
              };
        },
        revoke: vi.fn(() => Promise.resolve()),
      },
    };

    const first = await handleWorkerFlagshipHttp({
      correlationId: "correlation-worker-invalidation-retry-first",
      dependencies,
      meetingId: MEETING_ID,
      operation: "inject-demo-regulatory-change",
      request: invalidationRequest(),
    });
    const withinRetention = await handleWorkerFlagshipHttp({
      correlationId: "correlation-worker-invalidation-retry-second",
      dependencies,
      meetingId: MEETING_ID,
      operation: "inject-demo-regulatory-change",
      request: invalidationRequest(),
    });
    clock.advance(25 * 60 * 60 * 1_000 + 1_000);
    const afterRetention = await handleWorkerFlagshipHttp({
      correlationId: "correlation-worker-invalidation-retry-third",
      dependencies,
      meetingId: MEETING_ID,
      operation: "inject-demo-regulatory-change",
      request: invalidationRequest(),
    });

    expect(first.status).toBe(202);
    expect(withinRetention.status).toBe(202);
    expect(afterRetention.status).toBe(202);
    expect(claims).toHaveLength(2);
    expect(claims[1]?.claimKeyHash).toBe(claims[0]?.claimKeyHash);
    expect(claims[1]?.requestFingerprint).toBe(claims[0]?.requestFingerprint);
    expect(evaluatorInputs).toHaveLength(2);
    expect(evaluatorInputs[1]).toEqual(evaluatorInputs[0]);
    expect(evaluatorInputs[0]).toMatchObject({
      decision: {
        revision: fixtureValue.committedRevision.version,
        revisionId: fixtureValue.committedRevision.id,
      },
      externalEvent: {
        externalEventId: "demo-regulator:worker-invalidation",
      },
    });
    expect(
      (await fixtureValue.dependencies.events.load(MEETING_ID)).filter(
        ({ event }) => event.eventType === "ExternalEventReceived",
      ),
    ).toHaveLength(1);
  });

  it("keeps ordinary deterministic evaluation outside the managed lifecycle", async () => {
    const fixtureValue = await invalidationFixture();
    const claim = vi.fn(() =>
      Promise.reject(new Error("ordinary path touched claim")),
    );
    const reserve = vi.fn(() =>
      Promise.reject(new Error("ordinary path touched ledger")),
    );
    const managedEvaluate = vi.fn(() =>
      Promise.reject(new Error("ordinary path touched managed provider")),
    );
    const deterministicEvaluate = vi.fn(() =>
      Promise.resolve(invalidationEvaluation()),
    );

    const response = await handleWorkerFlagshipHttp({
      correlationId: "correlation-worker-invalidation-deterministic",
      dependencies: {
        ...fixtureValue.dependencies,
        invalidationEvaluations: {
          ...fixtureValue.dependencies.invalidationEvaluations,
          evaluator: { evaluate: deterministicEvaluate },
        },
        judgeAssumptionInvalidation: managedInvalidationRuntime({
          claim,
          evaluate: managedEvaluate,
          reserve,
        }),
      },
      meetingId: MEETING_ID,
      operation: "inject-demo-regulatory-change",
      request: invalidationRequest(),
    });

    expect(response.status).toBe(202);
    expect(deterministicEvaluate).toHaveBeenCalledTimes(1);
    expect(claim).not.toHaveBeenCalled();
    expect(reserve).not.toHaveBeenCalled();
    expect(managedEvaluate).not.toHaveBeenCalled();
  });

  it("serves decision history, audit, and export after a commit", async () => {
    const fixtureValue = await invalidationFixture();
    const records = await fixtureValue.dependencies.events.load(MEETING_ID);
    const projection = replayMeeting(
      domainMeetingId(MEETING_ID),
      records.map(({ event }) => event),
    );
    const decision = projection.shared.decisions[0];
    if (decision === undefined) {
      throw new Error("Decision history fixture is missing its decision");
    }

    for (const [operation, path] of [
      [
        "decision-history" as const,
        `/api/v1/meetings/${MEETING_ID}/decisions/${decision.id}/history`,
      ],
      [
        "decision-audit" as const,
        `/api/v1/meetings/${MEETING_ID}/decisions/audit?decisionId=${decision.id}`,
      ],
      [
        "decision-export" as const,
        `/api/v1/meetings/${MEETING_ID}/decisions/${decision.id}/export`,
      ],
    ] as const) {
      const response = await handleWorkerFlagshipHttp({
        correlationId: `correlation-worker-${operation}`,
        dependencies: fixtureValue.dependencies,
        meetingId: MEETING_ID,
        operation,
        request: new Request(`https://counterpoint.test${path}`, {
          headers: { authorization: `Bearer ${BEARER}` },
        }),
      });
      expect(response.status).toBe(200);
    }
  });

  it("creates meetings and replays the same idempotency key", async () => {
    const fixtureValue = await fixture();
    const stored = new Map<
      string,
      {
        readonly assignments: readonly ParticipantAssignment[];
        readonly meeting: MeetingRecord;
      }
    >();
    const createWithAssignments = vi.fn(
      (
        meeting: MeetingRecord,
        assignments: readonly ParticipantAssignment[],
      ) => {
        stored.set(meeting.meetingId, { assignments, meeting });
        return Promise.resolve();
      },
    );
    const dependencies: WorkerFlagshipHttpDependencies = {
      ...fixtureValue.dependencies,
      facilitatorUserIds: new Set([USER_ID]),
      meetings: {
        ...fixtureValue.dependencies.meetings,
        createWithAssignments,
        findById: (meetingId: string) =>
          Promise.resolve(stored.get(meetingId)?.meeting),
        listAssignments: (meetingId: string) =>
          Promise.resolve(stored.get(meetingId)?.assignments ?? []),
      },
    };
    const request = () =>
      new Request("https://counterpoint.test/api/v1/meetings", {
        body: JSON.stringify({
          idempotencyKey: "create-worker-meeting-once",
          purpose: "A hosted product decision",
          users: [
            { role: "facilitator", userId: USER_ID },
            { role: "participant", userId: "safety" },
            { role: "participant", userId: "legal" },
          ],
        }),
        headers: {
          authorization: `Bearer ${BEARER}`,
          "content-type": "application/json",
        },
        method: "POST",
      });

    const first = await handleWorkerFlagshipHttp({
      correlationId: "correlation-worker-create-first",
      dependencies,
      operation: "create-meeting",
      request: request(),
    });
    const second = await handleWorkerFlagshipHttp({
      correlationId: "correlation-worker-create-replay",
      dependencies,
      operation: "create-meeting",
      request: request(),
    });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const firstBody = await responseBody(first);
    const secondBody = await responseBody(second);
    expect(secondBody.meetingId).toBe(firstBody.meetingId);
    expect(createWithAssignments).toHaveBeenCalledTimes(1);
  });
});
