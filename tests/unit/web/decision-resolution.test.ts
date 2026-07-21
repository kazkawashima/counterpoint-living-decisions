import {
  createResolutionDraft,
  hasMaterialRevisionChange,
  reconcileResolutionDraftState,
  updateResolutionDraftField,
  type ResolutionDraftState,
} from "../../../apps/web/src/decision-resolution.js";
import { describe, expect, it } from "vitest";

const activeSnapshot = {
  monitorCondition: "Revisit when the approval gate changes.",
  outcome: "Proceed after the documented approval gate is satisfied.",
  title: "Regional launch approval gate",
};

describe("Decision review resolution", () => {
  it("constructs materially revised Flagship defaults from the active snapshot", () => {
    const draft = createResolutionDraft(activeSnapshot, true);

    expect(draft).toMatchObject({
      changeReason:
        "Regulatory change requires a revised approval gate before launch.",
      monitorCondition:
        "Monitor the revised approval gate before resuming launch.",
      outcome:
        "Pause regional launch until the revised approval gate is satisfied.",
      title: "Revised conditional regional launch",
    });
    expect(hasMaterialRevisionChange(activeSnapshot, draft)).toBe(true);
  });

  it("constructs an ordinary draft from the active snapshot", () => {
    const draft = createResolutionDraft(activeSnapshot, false);

    expect(draft).toMatchObject(activeSnapshot);
    expect(draft.changeReason).toBe(
      "New shared evidence requires a revised Decision.",
    );
    expect(hasMaterialRevisionChange(activeSnapshot, draft)).toBe(false);
  });

  it("rejects identical and whitespace-only revision changes", () => {
    expect(hasMaterialRevisionChange(activeSnapshot, activeSnapshot)).toBe(
      false,
    );
    expect(
      hasMaterialRevisionChange(activeSnapshot, {
        monitorCondition: `  ${activeSnapshot.monitorCondition}\n`,
        outcome: `\n${activeSnapshot.outcome} `,
        title: ` ${activeSnapshot.title} `,
      }),
    ).toBe(false);
  });

  it.each([
    ["title", "Revised regional launch approval gate"],
    ["outcome", "Pause regional launch pending a revised approval gate."],
    ["monitorCondition", "Revisit before regional launch resumes."],
  ] as const)("accepts a trimmed %s change", (field, value) => {
    expect(
      hasMaterialRevisionChange(activeSnapshot, {
        ...activeSnapshot,
        [field]: `  ${value}  `,
      }),
    ).toBe(true);
  });

  it("preserves edited fields when the same Decision revision refreshes", () => {
    const target = {
      activeRevisionId: "decision-revision-2",
      decisionId: "decision-regional-launch",
    };
    const initial: ResolutionDraftState = {
      draft: createResolutionDraft(activeSnapshot, true),
      edited: false,
      target,
    };
    const edited = updateResolutionDraftField(
      initial,
      "outcome",
      "User-authored revised outcome",
    );
    const refreshed = reconcileResolutionDraftState(
      edited,
      target,
      createResolutionDraft(
        {
          ...activeSnapshot,
          outcome: "Unexpected same-revision refresh copy",
        },
        true,
      ),
    );

    expect(refreshed).toBe(edited);
    expect(refreshed.edited).toBe(true);
    expect(refreshed.draft.outcome).toBe("User-authored revised outcome");
  });

  it.each([
    [
      "Decision",
      {
        activeRevisionId: "decision-revision-2",
        decisionId: "decision-replacement",
      },
    ],
    [
      "revision",
      {
        activeRevisionId: "decision-revision-3",
        decisionId: "decision-regional-launch",
      },
    ],
  ] as const)(
    "reinitializes fields and clears dirty state for a different %s target",
    (_changedIdentity, nextTarget) => {
      const current = updateResolutionDraftField(
        {
          draft: createResolutionDraft(activeSnapshot, true),
          edited: false,
          target: {
            activeRevisionId: "decision-revision-2",
            decisionId: "decision-regional-launch",
          },
        },
        "title",
        "Previous target user edit",
      );
      const nextDraft = createResolutionDraft(
        {
          monitorCondition: "Review the replacement condition.",
          outcome: "Replacement target outcome.",
          title: "Replacement target title",
        },
        false,
      );

      const reconciled = reconcileResolutionDraftState(
        current,
        nextTarget,
        nextDraft,
      );

      expect(reconciled).toEqual({
        draft: nextDraft,
        edited: false,
        target: nextTarget,
      });
      expect(reconciled.draft.title).not.toBe("Previous target user edit");
    },
  );
});
