declare const brand: unique symbol;

export type Brand<Value, Name extends string> = Value & {
  readonly [brand]: Name;
};

export type ActionId = Brand<string, "ActionId">;
export type ArtifactId = Brand<string, "ArtifactId">;
export type AuditReferenceId = Brand<string, "AuditReferenceId">;
export type CausationId = Brand<string, "CausationId">;
export type ClaimId = Brand<string, "ClaimId">;
export type ConstraintId = Brand<string, "ConstraintId">;
export type CorrelationId = Brand<string, "CorrelationId">;
export type CriterionId = Brand<string, "CriterionId">;
export type DecisionId = Brand<string, "DecisionId">;
export type DecisionRevisionId = Brand<string, "DecisionRevisionId">;
export type DisclosureId = Brand<string, "DisclosureId">;
export type DisplayTokenId = Brand<string, "DisplayTokenId">;
export type DissentId = Brand<string, "DissentId">;
export type EvaluationId = Brand<string, "EvaluationId">;
export type EventId = Brand<string, "EventId">;
export type EvidenceId = Brand<string, "EvidenceId">;
export type ExternalEventId = Brand<string, "ExternalEventId">;
export type IdempotencyKey = Brand<string, "IdempotencyKey">;
export type InterventionId = Brand<string, "InterventionId">;
export type MeetingId = Brand<string, "MeetingId">;
export type MonitorRegistrationId = Brand<string, "MonitorRegistrationId">;
export type OptionId = Brand<string, "OptionId">;
export type ParticipantId = Brand<string, "ParticipantId">;
export type PremiseId = Brand<string, "PremiseId">;
export type PropositionId = Brand<string, "PropositionId">;
export type QuestionId = Brand<string, "QuestionId">;
export type ReconsiderationTaskId = Brand<string, "ReconsiderationTaskId">;
export type RelationId = Brand<string, "RelationId">;
export type ResetRequestId = Brand<string, "ResetRequestId">;
export type RiskId = Brand<string, "RiskId">;
export type SourceReferenceId = Brand<string, "SourceReferenceId">;
export type StanceId = Brand<string, "StanceId">;
export type SuggestionId = Brand<string, "SuggestionId">;
export type Timestamp = Brand<string, "Timestamp">;
export type UserId = Brand<string, "UserId">;
export type UtteranceId = Brand<string, "UtteranceId">;

export type ContentHash = Brand<string, "ContentHash">;
export type NonEmptyText = Brand<string, "NonEmptyText">;
export type PreviewHash = Brand<string, "PreviewHash">;
export type PromptVersion = Brand<string, "PromptVersion">;

export type MeetingPosition = Brand<number, "MeetingPosition">;
export type RevisionNumber = Brand<number, "RevisionNumber">;
export type SchemaVersion = Brand<number, "SchemaVersion">;

function opaqueText<Name extends string>(
  value: string,
  label: Name,
): Brand<string, Name> {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new DomainValueError(`${label} must not be empty`);
  }
  return normalized as Brand<string, Name>;
}

function opaqueInteger<Name extends string>(
  value: number,
  label: Name,
  minimum: number,
): Brand<number, Name> {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new DomainValueError(
      `${label} must be a safe integer greater than or equal to ${String(minimum)}`,
    );
  }
  return value as Brand<number, Name>;
}

export class DomainValueError extends Error {
  readonly code = "INVALID_DOMAIN_VALUE";

  constructor(message: string) {
    super(message);
    this.name = "DomainValueError";
  }
}

export const actionId = (value: string): ActionId =>
  opaqueText(value, "ActionId");
export const artifactId = (value: string): ArtifactId =>
  opaqueText(value, "ArtifactId");
export const auditReferenceId = (value: string): AuditReferenceId =>
  opaqueText(value, "AuditReferenceId");
export const causationId = (value: string): CausationId =>
  opaqueText(value, "CausationId");
export const claimId = (value: string): ClaimId => opaqueText(value, "ClaimId");
export const constraintId = (value: string): ConstraintId =>
  opaqueText(value, "ConstraintId");
export const correlationId = (value: string): CorrelationId =>
  opaqueText(value, "CorrelationId");
export const criterionId = (value: string): CriterionId =>
  opaqueText(value, "CriterionId");
export const decisionId = (value: string): DecisionId =>
  opaqueText(value, "DecisionId");
export const decisionRevisionId = (value: string): DecisionRevisionId =>
  opaqueText(value, "DecisionRevisionId");
export const disclosureId = (value: string): DisclosureId =>
  opaqueText(value, "DisclosureId");
export const displayTokenId = (value: string): DisplayTokenId =>
  opaqueText(value, "DisplayTokenId");
export const dissentId = (value: string): DissentId =>
  opaqueText(value, "DissentId");
export const evaluationId = (value: string): EvaluationId =>
  opaqueText(value, "EvaluationId");
export const eventId = (value: string): EventId => opaqueText(value, "EventId");
export const evidenceId = (value: string): EvidenceId =>
  opaqueText(value, "EvidenceId");
export const externalEventId = (value: string): ExternalEventId =>
  opaqueText(value, "ExternalEventId");
export const idempotencyKey = (value: string): IdempotencyKey =>
  opaqueText(value, "IdempotencyKey");
export const interventionId = (value: string): InterventionId =>
  opaqueText(value, "InterventionId");
export const meetingId = (value: string): MeetingId =>
  opaqueText(value, "MeetingId");
export const monitorRegistrationId = (value: string): MonitorRegistrationId =>
  opaqueText(value, "MonitorRegistrationId");
export const optionId = (value: string): OptionId =>
  opaqueText(value, "OptionId");
export const participantId = (value: string): ParticipantId =>
  opaqueText(value, "ParticipantId");
export const premiseId = (value: string): PremiseId =>
  opaqueText(value, "PremiseId");
export const propositionId = (value: string): PropositionId =>
  opaqueText(value, "PropositionId");
export const questionId = (value: string): QuestionId =>
  opaqueText(value, "QuestionId");
export const reconsiderationTaskId = (value: string): ReconsiderationTaskId =>
  opaqueText(value, "ReconsiderationTaskId");
export const relationId = (value: string): RelationId =>
  opaqueText(value, "RelationId");
export const resetRequestId = (value: string): ResetRequestId =>
  opaqueText(value, "ResetRequestId");
export const riskId = (value: string): RiskId => opaqueText(value, "RiskId");
export const sourceReferenceId = (value: string): SourceReferenceId =>
  opaqueText(value, "SourceReferenceId");
export const stanceId = (value: string): StanceId =>
  opaqueText(value, "StanceId");
export const suggestionId = (value: string): SuggestionId =>
  opaqueText(value, "SuggestionId");
export const userId = (value: string): UserId => opaqueText(value, "UserId");
export const utteranceId = (value: string): UtteranceId =>
  opaqueText(value, "UtteranceId");

export const contentHash = (value: string): ContentHash =>
  opaqueText(value, "ContentHash");
export const nonEmptyText = (value: string): NonEmptyText =>
  opaqueText(value, "NonEmptyText");
export const previewHash = (value: string): PreviewHash =>
  opaqueText(value, "PreviewHash");
export const promptVersion = (value: string): PromptVersion =>
  opaqueText(value, "PromptVersion");

export function timestamp(value: string): Timestamp {
  if (
    !value.endsWith("Z") ||
    Number.isNaN(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw new DomainValueError(
      "Timestamp must be a canonical UTC ISO 8601 string",
    );
  }
  return value as Timestamp;
}

export const meetingPosition = (value: number): MeetingPosition =>
  opaqueInteger(value, "MeetingPosition", 0);
export const revisionNumber = (value: number): RevisionNumber =>
  opaqueInteger(value, "RevisionNumber", 1);
export const schemaVersion = (value: number): SchemaVersion =>
  opaqueInteger(value, "SchemaVersion", 1);

export interface TextRange {
  readonly start: number;
  readonly end: number;
}

export function textRange(start: number, end: number): TextRange {
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end <= start
  ) {
    throw new DomainValueError(
      "TextRange requires safe integer offsets with 0 <= start < end",
    );
  }
  return { start, end };
}
