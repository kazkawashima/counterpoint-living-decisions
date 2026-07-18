import { describe, expect, it } from "vitest";

import {
  contentHash,
  createExternalEvent,
  createPremise,
  externalEventId,
  holdAffectedActions,
  monitorRegistrationId,
  newReconsiderationTask,
  nonEmptyText,
  promptVersion,
  replayMeeting,
  replaySharedMeeting,
  revisionNumber,
  suggestionId,
  timestamp,
  toSharedMeetingProjection,
  transitionDecision,
  type DecisionAuthority,
  type DomainEvent,
  type SharedDomainEvent,
} from "../../packages/domain/src/index.js";
import {
  action,
  facilitatorParticipant,
  firstRevision,
  flagshipDecision,
  flagshipMeeting,
  ids,
  readinessComplete,
  sharedEvent,
  sharedEvidence,
} from "../unit/domain/fixtures.js";

const facilitator: DecisionAuthority = {
  kind: "facilitator",
  participantId: ids.facilitator,
};
const system: DecisionAuthority = { kind: "system" };

function completeFlagshipEvents(): readonly DomainEvent[] {
  const premise = createPremise({
    id: ids.premiseEurope,
    meetingId: ids.meeting,
    createdAt: timestamp("2026-07-19T00:01:00.000Z"),
    createdBy: ids.facilitator,
    visibility: "shared",
    origin: "ai_inference",
    confirmationStatus: "confirmed",
    revision: revisionNumber(1),
    statement: nonEmptyText(
      "The current European rollout remains legally permitted",
    ),
    dependencyScope: [nonEmptyText("Europe rollout")],
    monitorCondition: {
      description: nonEmptyText("Monitor European regulatory changes"),
    },
  });
  const rolloutAction = action(
    ids.actionEurope,
    ids.premiseEurope,
    "Europe rollout",
  );
  const draft = flagshipDecision("DRAFT");
  const ready = transitionDecision(draft, {
    to: "DECISION_READY",
    authority: facilitator,
    readiness: readinessComplete,
  });
  const committed = transitionDecision(ready, {
    to: "COMMITTED",
    authority: facilitator,
    explicitCommit: true,
  });
  const monitoring = transitionDecision(committed, {
    to: "MONITORING",
    authority: system,
    monitorRegistrationSucceeded: true,
  });
  const invalidationSuggestionId = suggestionId(
    "suggestion-regulatory-invalidation",
  );
  const atRisk = transitionDecision(monitoring, {
    to: "AT_RISK",
    authority: system,
    invalidationSuggestionRecorded: true,
    suggestionReferenceIds: [ids.sourceReference],
    affectedPremiseIds: [ids.premiseEurope],
    affectedActionIds: [ids.actionEurope],
  });
  const reviewRequired = transitionDecision(atRisk, {
    to: "REVIEW_REQUIRED",
    authority: facilitator,
    invalidationConfirmed: true,
    reviewedPremiseIds: [ids.premiseEurope],
    reviewedEvidenceReferenceIds: [ids.sourceReference],
    reviewedActionIds: [ids.actionEurope],
  });
  const heldActions = holdAffectedActions([rolloutAction], {
    affectedPremiseIds: [ids.premiseEurope],
    suggestedActionIds: [ids.actionEurope],
    holdReason: nonEmptyText("Regulatory premise requires human review"),
  });
  const externalEvent = createExternalEvent({
    id: externalEventId("external-event-eu-regulation"),
    meetingId: ids.meeting,
    createdAt: timestamp("2026-07-20T09:00:00.000Z"),
    createdBy: "system",
    visibility: "shared",
    origin: "system",
    confirmationStatus: "not_applicable",
    revision: revisionNumber(1),
    eventType: nonEmptyText("regulatory_change"),
    payloadHash: contentHash("sha256:synthetic-regulatory-event"),
    source: nonEmptyText("Synthetic regulator feed"),
    jurisdiction: nonEmptyText("European Union"),
    effectiveAt: timestamp("2026-08-01T00:00:00.000Z"),
    receivedAt: timestamp("2026-07-20T09:00:00.000Z"),
    signatureResult: "valid",
  });
  const task = newReconsiderationTask({
    id: ids.task,
    meetingId: ids.meeting,
    decisionId: ids.decision,
    triggerExternalEventId: externalEvent.id,
    ownerParticipantId: ids.facilitator,
    affectedPremiseIds: [ids.premiseEurope],
    affectedActionIds: [ids.actionEurope],
    createdAt: timestamp("2026-07-20T09:02:00.000Z"),
  });

  return [
    sharedEvent("MeetingCreated", 1, { meeting: flagshipMeeting() }),
    sharedEvent("ParticipantAssigned", 2, {
      participant: facilitatorParticipant(),
    }),
    sharedEvent("EvidenceShared", 3, { evidence: sharedEvidence() }),
    sharedEvent("InferenceConfirmed", 4, {
      suggestionId: suggestionId("suggestion-premise"),
      result: { kind: "premise", entity: premise },
      confirmedBy: ids.facilitator,
    }),
    sharedEvent("InferenceConfirmed", 5, {
      suggestionId: suggestionId("suggestion-action"),
      result: { kind: "action", entity: rolloutAction },
      confirmedBy: ids.facilitator,
    }),
    sharedEvent("DecisionDrafted", 6, {
      decision: draft,
      revision: firstRevision("DRAFT"),
    }),
    sharedEvent("DecisionMarkedReady", 7, { decision: ready }),
    sharedEvent("DecisionCommitted", 8, {
      decision: committed,
      revision: firstRevision("DRAFT"),
    }),
    sharedEvent("MonitoringStarted", 9, {
      decision: monitoring,
      monitorRegistrationId: monitorRegistrationId("monitor-eu-regulation"),
    }),
    sharedEvent("ExternalEventReceived", 10, { externalEvent }),
    sharedEvent("AssumptionInvalidationSuggested", 11, {
      suggestionId: invalidationSuggestionId,
      decisionId: ids.decision,
      externalEventId: externalEvent.id,
      affectedPremiseIds: [ids.premiseEurope],
      affectedActionIds: [ids.actionEurope],
      evidenceReferenceIds: [ids.sourceReference],
      metadata: {
        model: nonEmptyText("gpt-5.6"),
        promptVersion: promptVersion("living-decision-v1"),
        inputReferenceIds: [ids.sourceReference],
        confidence: 0.91,
        reason: nonEmptyText(
          "The regulatory change may invalidate the rollout premise",
        ),
      },
    }),
    sharedEvent("DecisionMarkedAtRisk", 12, {
      decision: atRisk,
      suggestionId: invalidationSuggestionId,
      affectedPremiseIds: [ids.premiseEurope],
      affectedActionIds: [ids.actionEurope],
    }),
    sharedEvent("FacilitatorReviewed", 13, {
      decisionId: ids.decision,
      suggestionId: invalidationSuggestionId,
      facilitatorParticipantId: ids.facilitator,
      disposition: "confirm_invalidation",
      reviewedPremiseIds: [ids.premiseEurope],
      reviewedEvidenceReferenceIds: [ids.sourceReference],
      reviewedActionIds: [ids.actionEurope],
      reason: nonEmptyText("Synthetic regulatory evidence is material"),
    }),
    sharedEvent("DecisionReviewRequired", 14, {
      decision: reviewRequired,
      suggestionId: invalidationSuggestionId,
      heldActionIds: [ids.actionEurope],
      reconsiderationTaskId: task.id,
    }),
    sharedEvent("ActionHeld", 15, {
      decisionId: ids.decision,
      suggestionId: invalidationSuggestionId,
      actions: heldActions,
    }),
    sharedEvent("ReconsiderationTaskCreated", 16, { task }),
  ];
}

describe("Plan 01 deterministic flagship exit gate", () => {
  it("replays through human-confirmed REVIEW_REQUIRED with held Action and task", () => {
    const events = completeFlagshipEvents();
    const first = replayMeeting(ids.meeting, events);
    const second = replayMeeting(ids.meeting, events);

    expect(first).toEqual(second);
    expect(first.position).toBe(16);
    expect(first.shared.decisions).toEqual([
      expect.objectContaining({ status: "REVIEW_REQUIRED" }),
    ]);
    expect(first.shared.actions).toEqual([
      expect.objectContaining({ status: "held" }),
    ]);
    expect(first.shared.reconsiderationTasks).toEqual([
      expect.objectContaining({ state: "open" }),
    ]);
    expect(first.shared.externalEvents).toHaveLength(1);
  });

  it("rebuilds the identical shared projection from shared events only", () => {
    const events = completeFlagshipEvents();
    const complete = replayMeeting(ids.meeting, events);
    const sharedEvents = events.filter(
      (event): event is SharedDomainEvent => event.visibility === "shared",
    );

    expect(replaySharedMeeting(ids.meeting, sharedEvents)).toEqual(
      toSharedMeetingProjection(complete),
    );
  });
});
