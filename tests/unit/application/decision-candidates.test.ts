import { describe, expect, it } from "vitest";

import {
  dispositionDecisionCandidate,
  prepareSharedDecisionCandidate,
  type DecisionCandidateDependencies,
  type SharedDecisionSynthesisInput,
} from "../../../packages/application/src/index.js";
import { userAuthorizationContext } from "../../../packages/application/src/sessions.js";
import {
  artifactId,
  auditReferenceId,
  correlationId,
  createEvidence,
  eventId,
  evidenceId,
  meetingId,
  meetingPosition,
  nonEmptyText,
  participantId,
  replayMeeting,
  revisionNumber,
  schemaVersion,
  textRange,
  timestamp,
  type DomainEvent,
  type MeetingProjection,
  type SharedEventEnvelope,
} from "../../../packages/domain/src/index.js";
import {
  MutableClock,
  SequenceIdGenerator,
} from "../../helpers/application-adapters.js";
import {
  InMemoryEventStore,
  InMemoryProjectionStore,
} from "../../helpers/in-memory-ports.js";

const MEETING_ID = "meeting-candidate";
const FACILITATOR_ID = "participant-facilitator";
const OPERATOR_ID = "participant-operator";
const EVIDENCE_ID = "evidence-shared-gate";
const NOW = timestamp("2026-07-19T08:30:00.000Z");

function stableFixtureHash(value: string): string {
  let hash = 2_166_136_261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return `fixture-${(hash >>> 0).toString(16)}`;
}

class CountingSynthesizer {
  calls = 0;
  inputs: SharedDecisionSynthesisInput[] = [];

  synthesize(input: SharedDecisionSynthesisInput) {
    this.calls += 1;
    this.inputs.push(structuredClone(input));
    return Promise.resolve({
      ai: {
        generatedAt: NOW,
        inputReferenceIds: [EVIDENCE_ID],
        model: "gpt-5.6-sol",
        operation: "shared_decision_synthesis",
        promptVersion: "shared-decision-v1",
        schemaVersion: "1",
      },
      draft: {
        action: {
          ownerParticipantId: OPERATOR_ID,
          scope: "Document the regional approval gate.",
        },
        confidence: 0.88,
        dissent: {
          reason: "Rollback ownership still needs review.",
          retained: true,
        },
        monitorCondition: "Reopen if the approval gate changes.",
        outcome: "Proceed only after the approval gate is documented.",
        premise: {
          evidenceReferenceIds: [EVIDENCE_ID],
          statement: "Regional launch requires a documented approval gate.",
        },
        reason: "The shared evidence defines a bounded launch gate.",
        title: "Conditional regional launch",
      },
    });
  }
}

function dependencies(
  synthesizer: CountingSynthesizer | null = new CountingSynthesizer(),
): DecisionCandidateDependencies {
  return {
    clock: new MutableClock(NOW),
    events: new InMemoryEventStore<DomainEvent>(),
    hash: stableFixtureHash,
    ids: new SequenceIdGenerator(),
    listParticipantIds: () => Promise.resolve([FACILITATOR_ID, OPERATOR_ID]),
    projections: new InMemoryProjectionStore<MeetingProjection>(),
    ...(synthesizer === null ? {} : { synthesizer }),
  };
}

function facilitatorContext() {
  return userAuthorizationContext({
    meetingId: MEETING_ID,
    participantId: FACILITATOR_ID,
    role: "facilitator",
    sessionId: "session-facilitator",
    userId: "user-facilitator",
  });
}

function participantContext() {
  return userAuthorizationContext({
    meetingId: MEETING_ID,
    participantId: OPERATOR_ID,
    role: "participant",
    sessionId: "session-operator",
    userId: "user-operator",
  });
}

function sharedEvidenceEvent(): SharedEventEnvelope<"EvidenceShared"> {
  const evidence = createEvidence({
    confirmationStatus: "confirmed",
    createdAt: NOW,
    createdBy: participantId(FACILITATOR_ID),
    disclosureAuditReferenceId: auditReferenceId("audit-shared-gate"),
    exactSnippet: nonEmptyText(
      "Synthetic shared fact: launch requires a documented approval gate.",
    ),
    id: evidenceId(EVIDENCE_ID),
    meetingId: meetingId(MEETING_ID),
    origin: "source_artifact",
    revision: revisionNumber(1),
    sourceArtifactId: artifactId("artifact-shared-gate"),
    sourceRange: textRange(0, 68),
    visibility: "shared",
  });
  return {
    actor: { kind: "participant", participantId: participantId(OPERATOR_ID) },
    correlationId: correlationId("correlation-evidence"),
    eventId: eventId("event-evidence"),
    eventType: "EvidenceShared",
    meetingId: meetingId(MEETING_ID),
    occurredAt: NOW,
    payload: { evidence },
    position: meetingPosition(1),
    schemaVersion: schemaVersion(1),
    visibility: "shared",
  };
}

async function seedEvidence(deps: DecisionCandidateDependencies) {
  const result = await deps.events.append({
    events: [sharedEvidenceEvent()],
    expectedPosition: 0,
    meetingId: MEETING_ID,
  });
  if (result.kind !== "appended") {
    throw new Error("Evidence fixture failed");
  }
}

const aiRequest = {
  assistance: "ai_preferred",
  expectedPosition: 1,
  idempotencyKey: "prepare-ai-candidate",
  meetingId: MEETING_ID,
} as const;

describe("shared Decision candidate application flow", () => {
  it("calls the model with shared state only and replays before a second provider call", async () => {
    const synthesizer = new CountingSynthesizer();
    const deps = dependencies(synthesizer);
    await seedEvidence(deps);

    const first = await prepareSharedDecisionCandidate(
      deps,
      facilitatorContext(),
      aiRequest,
    );
    const replayed = await prepareSharedDecisionCandidate(
      deps,
      facilitatorContext(),
      aiRequest,
    );

    expect(first).toMatchObject({
      candidate: {
        provenance: {
          model: "gpt-5.6-sol",
          origin: "ai_assisted",
        },
      },
      kind: "candidate_prepared",
      replayed: false,
    });
    expect(replayed).toMatchObject({
      kind: "candidate_prepared",
      replayed: true,
    });
    expect(synthesizer.calls).toBe(1);
    expect(synthesizer.inputs).toEqual([
      {
        actions: [],
        dissent: [],
        evidence: [
          {
            evidenceId: EVIDENCE_ID,
            exactSnippet:
              "Synthetic shared fact: launch requires a documented approval gate.",
          },
        ],
        meetingId: MEETING_ID,
        participantIds: [FACILITATOR_ID, OPERATOR_ID],
        premises: [],
      },
    ]);
    expect(JSON.stringify(synthesizer.inputs)).not.toContain("private");

    const records = await deps.events.load(MEETING_ID);
    expect(
      records.filter(({ event }) => event.eventType === "InferenceSuggested"),
    ).toHaveLength(4);
    expect(
      records.slice(1).every(({ event }) => event.visibility === "private"),
    ).toBe(true);
    const projection = replayMeeting(
      meetingId(MEETING_ID),
      records.map(({ event, position }) => ({
        ...event,
        position: meetingPosition(position),
      })),
    );
    expect(projection.shared.premises).toEqual([]);
    expect(projection.shared.actions).toEqual([]);
    expect(projection.shared.dissent).toEqual([]);
    expect(projection.shared.decisions).toEqual([]);
    expect(JSON.stringify(projection.shared)).not.toContain(
      "Conditional regional launch",
    );
  });

  it("materializes only explicit facilitator dispositions into canonical shared entities", async () => {
    const deps = dependencies();
    await seedEvidence(deps);
    const prepared = await prepareSharedDecisionCandidate(
      deps,
      facilitatorContext(),
      aiRequest,
    );
    if (prepared.kind !== "candidate_prepared") {
      throw new Error(`Candidate fixture failed: ${prepared.code}`);
    }
    const premise = prepared.candidate.draft.premiseCandidates[0];
    if (premise === undefined) {
      throw new Error("Candidate fixture has no premise");
    }

    const disposed = await dispositionDecisionCandidate(
      deps,
      facilitatorContext(),
      {
        actions: prepared.candidate.draft.actionCandidates.map(
          ({ ownerParticipantId, scope }) => ({ ownerParticipantId, scope }),
        ),
        candidateId: prepared.candidate.candidateId,
        dissent: prepared.candidate.draft.dissentCandidates.map(
          ({ reason, retained }) => ({ reason, retained }),
        ),
        expectedPosition: prepared.position,
        idempotencyKey: "confirm-ai-candidate",
        meetingId: MEETING_ID,
        premiseDispositions: [
          {
            candidateId: premise.candidateId,
            disposition: "confirmed",
            premise: {
              evidenceReferenceIds: premise.evidenceReferenceIds,
              statement: premise.statement,
            },
          },
        ],
      },
    );
    expect(disposed).toMatchObject({
      actions: [{ confirmationStatus: "confirmed", visibility: "shared" }],
      dissent: [{ confirmationStatus: "confirmed", visibility: "shared" }],
      kind: "candidate_disposed",
      premises: [{ confirmationStatus: "confirmed", visibility: "shared" }],
      replayed: false,
    });
    if (disposed.kind !== "candidate_disposed") {
      throw new Error(`Disposition failed: ${disposed.code}`);
    }
    expect(disposed.actions[0]?.affectedPremiseIds).toEqual([
      disposed.premises[0]?.id,
    ]);

    const replayed = await dispositionDecisionCandidate(
      deps,
      facilitatorContext(),
      {
        actions: prepared.candidate.draft.actionCandidates.map(
          ({ ownerParticipantId, scope }) => ({ ownerParticipantId, scope }),
        ),
        candidateId: prepared.candidate.candidateId,
        dissent: prepared.candidate.draft.dissentCandidates.map(
          ({ reason, retained }) => ({ reason, retained }),
        ),
        expectedPosition: prepared.position,
        idempotencyKey: "confirm-ai-candidate",
        meetingId: MEETING_ID,
        premiseDispositions: [
          {
            candidateId: premise.candidateId,
            disposition: "confirmed",
            premise: {
              evidenceReferenceIds: premise.evidenceReferenceIds,
              statement: premise.statement,
            },
          },
        ],
      },
    );
    expect(replayed).toMatchObject({
      kind: "candidate_disposed",
      replayed: true,
    });

    const records = await deps.events.load(MEETING_ID);
    expect(
      records.filter(({ event }) => event.eventType === "InferenceConfirmed"),
    ).toHaveLength(3);
    const projection = replayMeeting(
      meetingId(MEETING_ID),
      records.map(({ event, position }) => ({
        ...event,
        position: meetingPosition(position),
      })),
    );
    expect(projection.shared.premises).toHaveLength(1);
    expect(projection.shared.dissent).toHaveLength(1);
    expect(projection.shared.actions).toHaveLength(1);
    expect(projection.shared.decisions).toEqual([]);
  });

  it("supports human-authored fallback without a configured model", async () => {
    const deps = dependencies(null);
    await seedEvidence(deps);
    const result = await prepareSharedDecisionCandidate(
      deps,
      facilitatorContext(),
      {
        assistance: "manual",
        draft: {
          actions: [
            {
              ownerParticipantId: OPERATOR_ID,
              scope: ["Document the approval gate."],
            },
          ],
          dissent: [
            {
              reason: "Rollback ownership remains open.",
              retained: true,
            },
          ],
          monitorCondition: {
            description: "Reopen if the approval gate changes.",
          },
          outcome: "Proceed after the approval gate is documented.",
          premises: [
            {
              evidenceReferenceIds: [EVIDENCE_ID],
              statement: "A documented approval gate is required.",
            },
          ],
          title: "Human-authored launch decision",
        },
        expectedPosition: 1,
        idempotencyKey: "manual-candidate",
        meetingId: MEETING_ID,
      },
    );
    expect(result).toMatchObject({
      candidate: {
        provenance: { origin: "human_authored" },
      },
      kind: "candidate_prepared",
    });
  });

  it("rejects unauthorized use and references outside shared meeting state", async () => {
    const deps = dependencies();
    await seedEvidence(deps);
    await expect(
      prepareSharedDecisionCandidate(deps, participantContext(), aiRequest),
    ).resolves.toEqual({ code: "FORBIDDEN", kind: "failed" });
    await expect(
      prepareSharedDecisionCandidate(deps, facilitatorContext(), {
        assistance: "manual",
        draft: {
          actions: [
            {
              ownerParticipantId: "participant-other-meeting",
              scope: ["Cross-meeting action"],
            },
          ],
          dissent: [],
          monitorCondition: { description: "Monitor" },
          outcome: "Invalid",
          premises: [
            {
              evidenceReferenceIds: ["evidence-other-meeting"],
              statement: "Cross-meeting premise",
            },
          ],
          title: "Invalid candidate",
        },
        expectedPosition: 1,
        idempotencyKey: "invalid-manual-candidate",
        meetingId: MEETING_ID,
      }),
    ).resolves.toEqual({
      code: "REFERENCED_ENTITY_NOT_FOUND",
      kind: "failed",
    });
    const unavailableDependencies = dependencies(null);
    await seedEvidence(unavailableDependencies);
    await expect(
      prepareSharedDecisionCandidate(
        unavailableDependencies,
        facilitatorContext(),
        aiRequest,
      ),
    ).resolves.toEqual({
      code: "OPENAI_UNAVAILABLE",
      kind: "failed",
    });
  });
});
