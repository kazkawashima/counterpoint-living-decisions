export interface RevisionCopy {
  readonly monitorCondition: string;
  readonly outcome: string;
  readonly title: string;
}

export interface ResolutionDraft extends RevisionCopy {
  readonly changeReason: string;
  readonly rejectionReason: string;
  readonly replacementDecisionId: string;
}

export interface ResolutionTargetIdentity {
  readonly activeRevisionId: string;
  readonly decisionId: string;
}

export interface ResolutionDraftState {
  readonly draft: ResolutionDraft;
  readonly edited: boolean;
  readonly target: ResolutionTargetIdentity | undefined;
}

const FLAGSHIP_REVISION: RevisionCopy = {
  monitorCondition: "Monitor the revised approval gate before resuming launch.",
  outcome:
    "Pause regional launch until the revised approval gate is satisfied.",
  title: "Revised conditional regional launch",
};

export function createResolutionDraft(
  activeSnapshot: RevisionCopy,
  isFlagship: boolean,
): ResolutionDraft {
  return {
    ...(isFlagship ? FLAGSHIP_REVISION : activeSnapshot),
    changeReason: isFlagship
      ? "Regulatory change requires a revised approval gate before launch."
      : "New shared evidence requires a revised Decision.",
    rejectionReason: isFlagship
      ? "The Decision can no longer proceed under the changed regulation."
      : "The Decision can no longer proceed under the reviewed evidence.",
    replacementDecisionId: "",
  };
}

export function hasMaterialRevisionChange(
  activeSnapshot: RevisionCopy,
  proposedRevision: RevisionCopy,
): boolean {
  return (
    activeSnapshot.title.trim() !== proposedRevision.title.trim() ||
    activeSnapshot.outcome.trim() !== proposedRevision.outcome.trim() ||
    activeSnapshot.monitorCondition.trim() !==
      proposedRevision.monitorCondition.trim()
  );
}

export function reconcileResolutionDraftState(
  current: ResolutionDraftState,
  nextTarget: ResolutionTargetIdentity,
  nextDraft: ResolutionDraft,
): ResolutionDraftState {
  if (
    current.target?.decisionId === nextTarget.decisionId &&
    current.target.activeRevisionId === nextTarget.activeRevisionId
  ) {
    return current;
  }
  return {
    draft: nextDraft,
    edited: false,
    target: nextTarget,
  };
}

export function updateResolutionDraftField<Field extends keyof ResolutionDraft>(
  current: ResolutionDraftState,
  field: Field,
  value: ResolutionDraft[Field],
): ResolutionDraftState {
  return {
    ...current,
    draft: { ...current.draft, [field]: value },
    edited: true,
  };
}
