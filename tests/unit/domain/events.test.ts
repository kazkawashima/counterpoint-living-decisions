import { describe, expect, it } from "vitest";

import {
  domainEventTypes,
  nonEmptyText,
  participantId,
  promptVersion,
  sourceReferenceId,
  suggestionId,
  type DomainEventPayloads,
  type DomainEventType,
} from "../../../packages/domain/src/index.js";

const expectedEventTypes = [
  "MeetingCreated",
  "ParticipantAssigned",
  "ParticipantJoined",
  "MeetingEnded",
  "DisplayTokenIssued",
  "DisplayTokenRevoked",
  "ArtifactRegistered",
  "ArtifactProcessed",
  "UtteranceCaptured",
  "SharedFloorAcquired",
  "SharedFloorReleased",
  "DisclosureProposed",
  "DisclosurePreviewed",
  "DisclosureApproved",
  "DisclosureRejected",
  "EvidenceShared",
  "InferenceSuggested",
  "InferenceConfirmed",
  "InferenceRejected",
  "DecisionDrafted",
  "DecisionMarkedReady",
  "DecisionCommitted",
  "MonitoringStarted",
  "ExternalEventReceived",
  "AssumptionInvalidationSuggested",
  "DecisionMarkedAtRisk",
  "FacilitatorReviewed",
  "DecisionReviewRequired",
  "ActionHeld",
  "ReconsiderationTaskCreated",
  "DecisionRevisionCommitted",
  "DecisionSuperseded",
  "DecisionRejected",
  "DemoResetRequested",
  "DemoResetCompleted",
  "ApiKeyLeaseUpdated",
  "ApiKeyLeaseExpired",
] as const satisfies readonly DomainEventType[];

type MissingPayload = Exclude<
  (typeof expectedEventTypes)[number],
  keyof DomainEventPayloads
>;
const allRequiredEventsHavePayloads: MissingPayload extends never
  ? true
  : false = true;

const suggestionMetadata = {
  model: nonEmptyText("facilitator-synthesis"),
  promptVersion: promptVersion("decision-synthesis-v1"),
  inputReferenceIds: [sourceReferenceId("private-reference")],
  confidence: 0.82,
  reason: nonEmptyText("Connects the private synthesis candidates"),
} as const;

describe("domain event contracts", () => {
  it("lists every required event family with a typed payload", () => {
    expect(allRequiredEventsHavePayloads).toBe(true);
    expect(domainEventTypes).toEqual(expectedEventTypes);
    expect(new Set(domainEventTypes).size).toBe(domainEventTypes.length);
  });

  it("keeps legacy suggestions valid and types linked synthesis details", () => {
    const legacySuggestion = {
      suggestionId: suggestionId("legacy-proposition"),
      candidateKind: "proposition",
      statement: nonEmptyText("A legacy suggestion without details"),
      metadata: suggestionMetadata,
    } satisfies DomainEventPayloads["InferenceSuggested"];
    const premiseSuggestionId = suggestionId("premise-candidate");
    const dissentSuggestionId = suggestionId("dissent-candidate");
    const actionSuggestionId = suggestionId("action-candidate");
    const candidates = [
      {
        suggestionId: premiseSuggestionId,
        candidateKind: "premise",
        statement: nonEmptyText("Regulatory approval remains necessary"),
        metadata: suggestionMetadata,
        details: {
          evidenceReferenceIds: [sourceReferenceId("regulatory-reference")],
          dependencyScope: [nonEmptyText("Europe rollout")],
          monitorCondition: {
            description: nonEmptyText("Monitor regulatory approval"),
          },
        },
      },
      {
        suggestionId: dissentSuggestionId,
        candidateKind: "dissent",
        statement: nonEmptyText("Legal recommends retaining the concern"),
        metadata: suggestionMetadata,
        details: {
          participantId: participantId("participant-legal"),
          retained: true,
        },
      },
      {
        suggestionId: actionSuggestionId,
        candidateKind: "action",
        statement: nonEmptyText("Assign the approval follow-up"),
        metadata: suggestionMetadata,
        details: {
          ownerParticipantId: participantId("participant-facilitator"),
          scope: [nonEmptyText("Europe rollout")],
          affectedPremiseSuggestionIds: [premiseSuggestionId],
        },
      },
      {
        suggestionId: suggestionId("decision-candidate"),
        candidateKind: "decision",
        statement: nonEmptyText("Draft a conditional Europe rollout"),
        metadata: suggestionMetadata,
        details: {
          title: nonEmptyText("Conditional Europe rollout"),
          outcome: nonEmptyText("Proceed after regulatory approval"),
          monitorCondition: {
            description: nonEmptyText("Monitor regulatory approval"),
          },
          premiseSuggestionIds: [premiseSuggestionId],
          dissentSuggestionIds: [dissentSuggestionId],
          actionSuggestionIds: [actionSuggestionId],
        },
      },
    ] as const satisfies readonly DomainEventPayloads["InferenceSuggested"][];

    expect(legacySuggestion).not.toHaveProperty("details");
    expect(candidates.map(({ candidateKind }) => candidateKind)).toEqual([
      "premise",
      "dissent",
      "action",
      "decision",
    ]);
  });
});
