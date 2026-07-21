export interface DecisionCandidateCopy {
  readonly outcome: string;
  readonly title: string;
}

const TITLE_WORKFLOW_WRAPPER = /^\s*AI[-\u2010\u2011 ]Proposed:\s*/iu;
const OUTCOME_WORKFLOW_WRAPPER =
  /^\s*AI[-\u2010\u2011 ]proposed outcome pending facilitator confirmation:\s*/iu;

export type NormalizedDecisionCandidateCopy<
  Candidate extends DecisionCandidateCopy,
> = Omit<Candidate, "outcome" | "title"> & DecisionCandidateCopy;

export function normalizeDecisionCandidateCopy<
  Candidate extends DecisionCandidateCopy,
>(candidate: Candidate): NormalizedDecisionCandidateCopy<Candidate> {
  const title = stripKnownLeadingWrapper(
    candidate.title,
    TITLE_WORKFLOW_WRAPPER,
  );
  const outcome = stripKnownLeadingWrapper(
    candidate.outcome,
    OUTCOME_WORKFLOW_WRAPPER,
  );
  if (title === candidate.title && outcome === candidate.outcome) {
    return candidate;
  }
  return {
    ...candidate,
    outcome,
    title,
  };
}

function stripKnownLeadingWrapper(value: string, wrapper: RegExp): string {
  if (!wrapper.test(value)) {
    return value;
  }
  const stripped = value.replace(wrapper, "").trim();
  if (stripped.length === 0) {
    return value;
  }
  const leadingWord = /^\p{Ll}[\p{L}\p{M}]*/u.exec(stripped)?.[0];
  if (leadingWord !== leadingWord?.toLocaleLowerCase("en-US")) {
    return stripped;
  }
  const [first = "", ...remainder] = Array.from(stripped);
  return `${first.toLocaleUpperCase("en-US")}${remainder.join("")}`;
}
