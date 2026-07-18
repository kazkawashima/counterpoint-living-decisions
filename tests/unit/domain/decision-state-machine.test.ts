import { describe, expect, it } from "vitest";

import {
  DecisionTransitionError,
  actionId,
  appendDecisionRevision,
  decisionId,
  decisionTransitionMatrix,
  externalEventId,
  holdAffectedActions,
  newReconsiderationTask,
  nextDecisionRevision,
  nonEmptyText,
  premiseId,
  reviseReconsiderationTask,
  revisionNumber,
  selectActionsToHold,
  transitionDecision,
  type DecisionAuthority,
  type DecisionStatus,
  type DecisionTransitionRequest,
} from "../../../packages/domain/src/index.js";
import {
  action,
  auditReason,
  decisionSnapshot,
  firstRevision,
  flagshipDecision,
  ids,
  later,
  readinessComplete,
} from "./fixtures.js";

const facilitator: DecisionAuthority = {
  kind: "facilitator",
  participantId: ids.facilitator,
};
const system: DecisionAuthority = { kind: "system" };
const ai: DecisionAuthority = {
  kind: "ai",
  model: nonEmptyText("gpt-5.6"),
};

const statuses = Object.keys(
  decisionTransitionMatrix,
) as readonly DecisionStatus[];

function revisionForReview() {
  return nextDecisionRevision(flagshipDecision("REVIEW_REQUIRED"), {
    id: ids.revision2,
    changeReason: nonEmptyText("Revised after regulatory review"),
    createdAt: later,
    createdBy: ids.facilitator,
    snapshot: decisionSnapshot("COMMITTED"),
  });
}

const validCases: readonly {
  from: DecisionStatus;
  to: DecisionStatus;
  request: DecisionTransitionRequest;
}[] = [
  {
    from: "DRAFT",
    to: "DECISION_READY",
    request: {
      to: "DECISION_READY",
      authority: facilitator,
      readiness: readinessComplete,
    },
  },
  {
    from: "DECISION_READY",
    to: "COMMITTED",
    request: {
      to: "COMMITTED",
      authority: facilitator,
      explicitCommit: true,
    },
  },
  {
    from: "COMMITTED",
    to: "MONITORING",
    request: {
      to: "MONITORING",
      authority: system,
      monitorRegistrationSucceeded: true,
    },
  },
  {
    from: "MONITORING",
    to: "AT_RISK",
    request: {
      to: "AT_RISK",
      authority: system,
      invalidationSuggestionRecorded: true,
      suggestionReferenceIds: [ids.sourceReference],
      affectedPremiseIds: [ids.premiseEurope],
      affectedActionIds: [ids.actionEurope],
    },
  },
  {
    from: "AT_RISK",
    to: "MONITORING",
    request: {
      to: "MONITORING",
      authority: facilitator,
      rejectionReason: auditReason,
    },
  },
  {
    from: "AT_RISK",
    to: "REVIEW_REQUIRED",
    request: {
      to: "REVIEW_REQUIRED",
      authority: facilitator,
      invalidationConfirmed: true,
      reviewedPremiseIds: [ids.premiseEurope],
      reviewedEvidenceReferenceIds: [ids.sourceReference],
      reviewedActionIds: [ids.actionEurope],
    },
  },
  {
    from: "REVIEW_REQUIRED",
    to: "COMMITTED",
    request: {
      to: "COMMITTED",
      authority: facilitator,
      explicitCommit: true,
      revision: revisionForReview(),
    },
  },
  {
    from: "REVIEW_REQUIRED",
    to: "SUPERSEDED",
    request: {
      to: "SUPERSEDED",
      authority: facilitator,
      replacementDecisionId: decisionId("replacement-decision"),
    },
  },
  {
    from: "REVIEW_REQUIRED",
    to: "REJECTED",
    request: {
      to: "REJECTED",
      authority: facilitator,
      rejectionReason: auditReason,
    },
  },
];

describe("Decision 8x8 lifecycle matrix", () => {
  it("defines every source and target cell", () => {
    expect(statuses).toHaveLength(8);
    for (const sourceStatus of statuses) {
      expect(Object.keys(decisionTransitionMatrix[sourceStatus])).toEqual(
        statuses,
      );
    }
  });

  it.each(validCases)(
    "allows $from → $to with required authority and conditions",
    ({ from: sourceStatus, to, request }) => {
      expect(
        transitionDecision(flagshipDecision(sourceStatus), request).status,
      ).toBe(to);
    },
  );

  it("rejects every matrix cell not explicitly allowed", () => {
    for (const sourceStatus of statuses) {
      for (const targetStatus of statuses) {
        if (!decisionTransitionMatrix[sourceStatus][targetStatus]) {
          expect(() =>
            transitionDecision(flagshipDecision(sourceStatus), {
              to: targetStatus,
              authority: facilitator,
            }),
          ).toThrowError(
            expect.objectContaining({ code: "INVALID_STATE_TRANSITION" }),
          );
        }
      }
    }
  });

  it("rejects wrong authority for every otherwise-valid transition", () => {
    for (const testCase of validCases) {
      const wrongAuthority =
        testCase.request.authority.kind === "system" ? facilitator : ai;
      expect(() =>
        transitionDecision(flagshipDecision(testCase.from), {
          ...testCase.request,
          authority: wrongAuthority,
        }),
      ).toThrowError(
        expect.objectContaining({ code: "DECISION_AUTHORITY_REQUIRED" }),
      );
    }
  });

  it("rejects missing conditions for every valid edge", () => {
    for (const { from: sourceStatus, to, request } of validCases) {
      expect(() =>
        transitionDecision(flagshipDecision(sourceStatus), {
          to,
          authority: request.authority,
        }),
      ).toThrowError(
        expect.objectContaining({ code: "DECISION_CONDITION_REQUIRED" }),
      );
    }
  });

  it("specifically prevents AI from entering REVIEW_REQUIRED", () => {
    expect(() =>
      transitionDecision(flagshipDecision("AT_RISK"), {
        to: "REVIEW_REQUIRED",
        authority: ai,
        invalidationConfirmed: true,
        reviewedPremiseIds: [ids.premiseEurope],
        reviewedEvidenceReferenceIds: [ids.sourceReference],
        reviewedActionIds: [ids.actionEurope],
      }),
    ).toThrow("AI cannot");
  });

  it("recommit appends a new active revision instead of mutating revision one", () => {
    const decision = flagshipDecision("REVIEW_REQUIRED");
    const next = revisionForReview();
    const result = transitionDecision(decision, {
      to: "COMMITTED",
      authority: facilitator,
      explicitCommit: true,
      revision: next,
    });

    expect(decision.activeRevision).toBe(1);
    expect(result.activeRevision).toBe(2);
    expect(result.activeRevisionId).toBe(ids.revision2);
  });
});

describe("Action hold and reconsideration revisions", () => {
  it("holds only suggested Actions linked to affected premises", () => {
    const europe = action(
      ids.actionEurope,
      ids.premiseEurope,
      "Europe rollout",
    );
    const us = action(ids.actionUs, ids.premiseUs, "US rollout");
    const unrelatedSuggested = action(
      actionId("action-unrelated"),
      premiseId("premise-unrelated"),
      "Unrelated rollout",
    );
    const selection = {
      affectedPremiseIds: [ids.premiseEurope],
      suggestedActionIds: [ids.actionEurope, unrelatedSuggested.id],
      holdReason: nonEmptyText("European legal premise is at risk"),
    };

    expect(
      selectActionsToHold([europe, us, unrelatedSuggested], selection).map(
        ({ id }) => id,
      ),
    ).toEqual([ids.actionEurope]);

    const held = holdAffectedActions(
      [europe, us, unrelatedSuggested],
      selection,
    );
    expect(held.map(({ status }) => status)).toEqual([
      "held",
      "active",
      "active",
    ]);
    expect(held[0]?.revision).toBe(revisionNumber(2));
    expect(europe.status).toBe("active");
  });

  it("appends Decision revisions monotonically and idempotently", () => {
    const initial = firstRevision();
    const next = revisionForReview();
    const history = appendDecisionRevision([], initial);
    const appended = appendDecisionRevision(history, next);

    expect(appended.map(({ version }) => version)).toEqual([1, 2]);
    expect(appendDecisionRevision(appended, next)).toBe(appended);
    expect(() =>
      appendDecisionRevision(appended, {
        ...next,
        changeReason: nonEmptyText("Conflicting reason"),
      }),
    ).toThrow("conflicts");
    expect(history).toHaveLength(1);
  });

  it("creates and revises a reconsideration task without mutation", () => {
    const task = newReconsiderationTask({
      id: ids.task,
      meetingId: ids.meeting,
      decisionId: ids.decision,
      triggerExternalEventId: externalEventId("external-regulation"),
      ownerParticipantId: ids.facilitator,
      affectedPremiseIds: [ids.premiseEurope],
      affectedActionIds: [ids.actionEurope],
      createdAt: later,
    });
    const inProgress = reviseReconsiderationTask(task, "in_progress");
    const completed = reviseReconsiderationTask(inProgress, "completed");

    expect(task).toMatchObject({ state: "open", revision: 1 });
    expect(inProgress).toMatchObject({ state: "in_progress", revision: 2 });
    expect(completed).toMatchObject({ state: "completed", revision: 3 });
    expect(() => reviseReconsiderationTask(completed, "in_progress")).toThrow(
      DecisionTransitionError,
    );
    expect(() => reviseReconsiderationTask(task, "completed")).toThrow(
      DecisionTransitionError,
    );
    expect(() => reviseReconsiderationTask(inProgress, "open")).toThrow(
      DecisionTransitionError,
    );
  });
});
