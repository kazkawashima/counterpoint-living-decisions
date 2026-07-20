import { describe, expect, it } from "vitest";

import {
  DomainValueError,
  createEvidence,
  createMeeting,
  createProposition,
  createSourceArtifact,
  createStance,
  createUtterance,
  meetingId,
  nonEmptyText,
  participantId,
  propositionId,
  revisionNumber,
  sourceReferenceId,
  stanceId,
  textRange,
  timestamp,
  type Proposition,
} from "../../../packages/domain/src/index.js";
import {
  facilitatorParticipant,
  flagshipMeeting,
  ids,
  now,
  privateArtifact,
  privateUtterance,
  sharedEvidence,
} from "./fixtures.js";

describe("opaque values and entity construction", () => {
  it("rejects empty IDs, non-canonical timestamps, and invalid ranges", () => {
    expect(() => meetingId("  ")).toThrow(DomainValueError);
    expect(() => timestamp("2026-07-19")).toThrow(DomainValueError);
    expect(() => textRange(4, 4)).toThrow(DomainValueError);
  });

  it("constructs branded values that serialize as stable wire primitives", () => {
    expect(
      JSON.parse(
        JSON.stringify({
          meetingId: ids.meeting,
          position: revisionNumber(2),
          occurredAt: now,
        }),
      ),
    ).toEqual({
      meetingId: "meeting-flagship",
      position: 2,
      occurredAt: "2026-07-19T00:00:00.000Z",
    });
  });

  it("requires an active facilitator assignment and facilitator capabilities", () => {
    expect(() =>
      createMeeting({
        ...flagshipMeeting(),
        participantAssignments: [
          {
            participantId: ids.facilitator,
            role: "participant",
            active: true,
          },
        ],
      }),
    ).toThrow("active facilitator assignment");

    expect(facilitatorParticipant().permissions).toContain("commit_decision");
  });

  it("enforces artifact limits and immutable utterance visibility", () => {
    expect(() =>
      createSourceArtifact({
        ...privateArtifact(),
        sizeBytes: 20 * 1024 * 1024 + 1,
      }),
    ).toThrow("20 MB");

    expect(() =>
      createUtterance({
        ...privateUtterance(),
        channel: "shared",
      }),
    ).toThrow("channel");
  });

  it("requires private ownership even when untyped input crosses the boundary", () => {
    const invalid = {
      id: propositionId("proposition-private"),
      meetingId: ids.meeting,
      createdAt: now,
      createdBy: ids.legal,
      visibility: "private",
      origin: "human_input",
      confirmationStatus: "confirmed",
      revision: revisionNumber(1),
      statement: nonEmptyText("Legal clearance is required"),
      sourceReferenceIds: [sourceReferenceId("source-1")],
    } as unknown as Proposition;

    expect(() => createProposition(invalid)).toThrow("ownerParticipantId");
  });

  it("keeps Proposition, Stance, private source, and shared Evidence distinct", () => {
    const proposition = createProposition({
      id: propositionId("proposition-1"),
      meetingId: ids.meeting,
      createdAt: now,
      createdBy: ids.legal,
      visibility: "shared",
      origin: "human_input",
      confirmationStatus: "confirmed",
      revision: revisionNumber(1),
      statement: nonEmptyText("EU rollout requires legal clearance"),
      sourceReferenceIds: [sourceReferenceId("source-1")],
    });
    const stance = createStance({
      id: stanceId("stance-1"),
      meetingId: ids.meeting,
      createdAt: now,
      createdBy: ids.legal,
      visibility: "shared",
      origin: "human_input",
      confirmationStatus: "confirmed",
      revision: revisionNumber(1),
      participantId: participantId("participant-legal"),
      propositionId: proposition.id,
      position: "support",
    });

    expect(proposition).not.toHaveProperty("position");
    expect(stance).not.toHaveProperty("statement");
    expect(privateArtifact().visibility).toBe("private");
    expect(sharedEvidence().visibility).toBe("shared");
  });

  it("publishes only confirmed shared Evidence", () => {
    expect(() =>
      createEvidence({
        ...sharedEvidence(),
        confirmationStatus: "proposed",
      }),
    ).toThrow("shared and human-confirmed");
  });

  it("publishes Evidence only from an approved source artifact", () => {
    expect(() =>
      createEvidence({
        ...sharedEvidence(),
        origin: "ai_inference",
      }),
    ).toThrow("source artifact");
  });
});
