import { describe, expect, it } from "vitest";

import {
  domainEventTypes,
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

describe("domain event contracts", () => {
  it("lists every required event family with a typed payload", () => {
    expect(allRequiredEventsHavePayloads).toBe(true);
    expect(domainEventTypes).toEqual(expectedEventTypes);
    expect(new Set(domainEventTypes).size).toBe(domainEventTypes.length);
  });
});
