import type {
  ActionId,
  ArtifactId,
  AuditReferenceId,
  ClaimId,
  ContentHash,
  ConstraintId,
  CriterionId,
  DecisionId,
  DecisionRevisionId,
  DissentId,
  DisplayTokenId,
  EvaluationId,
  EvidenceId,
  ExternalEventId,
  IdempotencyKey,
  InterventionId,
  MeetingId,
  MonitorRegistrationId,
  NonEmptyText,
  OptionId,
  ParticipantId,
  PremiseId,
  PropositionId,
  QuestionId,
  ReconsiderationTaskId,
  RelationId,
  RevisionNumber,
  RiskId,
  SourceReferenceId,
  StanceId,
  TextRange,
  Timestamp,
  UserId,
  UtteranceId,
} from "./values.js";
import { DomainValueError, revisionNumber } from "./values.js";

export type Visibility = "private" | "shared";
export type Origin =
  | "human_utterance"
  | "human_input"
  | "source_artifact"
  | "ai_inference"
  | "system";
export type ConfirmationStatus =
  "not_applicable" | "proposed" | "confirmed" | "rejected";

export interface SharedRecordScope {
  readonly visibility: "shared";
}

export interface PrivateRecordScope {
  readonly visibility: "private";
  readonly ownerParticipantId: ParticipantId;
}

export type RecordScope = SharedRecordScope | PrivateRecordScope;

export interface CommonRecordFields {
  readonly id: string;
  readonly meetingId: MeetingId;
  readonly createdAt: Timestamp;
  readonly createdBy: ParticipantId | "system";
  readonly origin: Origin;
  readonly confirmationStatus: ConfirmationStatus;
  readonly revision: RevisionNumber;
}

export type DomainRecord<Fields extends object> = CommonRecordFields &
  RecordScope &
  Fields;

export type SharedDomainRecord<Fields extends object> = CommonRecordFields &
  SharedRecordScope &
  Fields;

export type MeetingPhase = "preparing" | "deliberating" | "deciding" | "ended";

export interface ParticipantAssignment {
  readonly participantId: ParticipantId;
  readonly role: ParticipantRole;
  readonly active: boolean;
}

export interface DisplayTokenState {
  readonly tokenId: DisplayTokenId;
  readonly expiresAt: Timestamp;
  readonly revokedAt?: Timestamp;
}

export type Meeting = SharedDomainRecord<{
  readonly id: MeetingId;
  readonly purpose: NonEmptyText;
  readonly phase: MeetingPhase;
  readonly facilitatorParticipantId: ParticipantId;
  readonly participantAssignments: readonly ParticipantAssignment[];
  readonly displayTokens: readonly DisplayTokenState[];
}>;

export type ParticipantRole = "facilitator" | "participant";
export type Capability =
  | "read_shared"
  | "read_own_private"
  | "add_own_private_artifact"
  | "propose_own_disclosure"
  | "commit_decision"
  | "confirm_review_required"
  | "inject_demo_event"
  | "reset_demo_meeting"
  | "configure_byok";

export type Participant = SharedDomainRecord<{
  readonly id: ParticipantId;
  readonly userId: UserId;
  readonly role: ParticipantRole;
  readonly permissions: readonly Capability[];
  readonly active: boolean;
  readonly joinedAt?: Timestamp;
}>;

export type ArtifactType = "document" | "url" | "text";
export type ArtifactProcessingState =
  "registered" | "processing" | "processed" | "failed";

export type SourceArtifact = DomainRecord<{
  readonly id: ArtifactId;
  readonly artifactType: ArtifactType;
  readonly storageReference: NonEmptyText;
  readonly contentHash: ContentHash;
  readonly sizeBytes: number;
  readonly processingState: ArtifactProcessingState;
}>;

export type UtteranceChannel = "private" | "shared";

export type Utterance = DomainRecord<{
  readonly id: UtteranceId;
  readonly participantId: ParticipantId;
  readonly channel: UtteranceChannel;
  readonly text: NonEmptyText;
  readonly capturedAt: Timestamp;
  readonly idempotencyKey: IdempotencyKey;
}>;

export type Proposition = DomainRecord<{
  readonly id: PropositionId;
  readonly statement: NonEmptyText;
  readonly sourceReferenceIds: readonly SourceReferenceId[];
}>;

export type StancePosition = "support" | "oppose" | "uncertain";

export type Stance = DomainRecord<{
  readonly id: StanceId;
  readonly participantId: ParticipantId;
  readonly propositionId: PropositionId;
  readonly position: StancePosition;
}>;

export type Question = DomainRecord<{
  readonly id: QuestionId;
  readonly prompt: NonEmptyText;
  readonly resolutionStatus: "open" | "resolved";
}>;

export type Claim = DomainRecord<{
  readonly id: ClaimId;
  readonly statement: NonEmptyText;
  readonly sourceReferenceIds: readonly SourceReferenceId[];
}>;

export interface MonitorCondition {
  readonly description: NonEmptyText;
  readonly registrationId?: MonitorRegistrationId;
}

export type Premise = DomainRecord<{
  readonly id: PremiseId;
  readonly statement: NonEmptyText;
  readonly dependencyScope: readonly NonEmptyText[];
  readonly monitorCondition?: MonitorCondition;
}>;

export type Evidence = DomainRecord<{
  readonly id: EvidenceId;
  readonly exactSnippet: NonEmptyText;
  readonly sourceArtifactId: ArtifactId;
  readonly sourceRange: TextRange;
  readonly disclosureAuditReferenceId: AuditReferenceId;
}>;

export type Option = DomainRecord<{
  readonly id: OptionId;
  readonly label: NonEmptyText;
  readonly description: NonEmptyText;
  readonly state: "candidate" | "selected" | "discarded";
}>;

export type Criterion = DomainRecord<{
  readonly id: CriterionId;
  readonly name: NonEmptyText;
  readonly description: NonEmptyText;
}>;

export type Constraint = DomainRecord<{
  readonly id: ConstraintId;
  readonly statement: NonEmptyText;
  readonly sourceReferenceIds: readonly SourceReferenceId[];
}>;

export type Risk = DomainRecord<{
  readonly id: RiskId;
  readonly statement: NonEmptyText;
  readonly probability?: number;
  readonly impact?: number;
}>;

export type Evaluation = DomainRecord<{
  readonly id: EvaluationId;
  readonly optionId: OptionId;
  readonly criterionId: CriterionId;
  readonly assessment: NonEmptyText;
}>;

export type DecisionStatus =
  | "DRAFT"
  | "DECISION_READY"
  | "COMMITTED"
  | "MONITORING"
  | "AT_RISK"
  | "REVIEW_REQUIRED"
  | "SUPERSEDED"
  | "REJECTED";

export interface DecisionReadiness {
  readonly outcome: boolean;
  readonly premiseIds: boolean;
  readonly evidenceIds: boolean;
  readonly actionIds: boolean;
  readonly monitorCondition: boolean;
}

export type Decision = SharedDomainRecord<{
  readonly id: DecisionId;
  readonly title: NonEmptyText;
  readonly outcome: NonEmptyText;
  readonly status: DecisionStatus;
  readonly activeRevision: RevisionNumber;
  readonly activeRevisionId: DecisionRevisionId;
  readonly premiseIds: readonly PremiseId[];
  readonly evidenceIds: readonly EvidenceId[];
  readonly dissentIds: readonly DissentId[];
  readonly actionIds: readonly ActionId[];
  readonly monitorCondition: MonitorCondition;
  readonly supersededByDecisionId?: DecisionId;
}>;

export type Dissent = SharedDomainRecord<{
  readonly id: DissentId;
  readonly participantId: ParticipantId;
  readonly reason: NonEmptyText;
  readonly retained: boolean;
}>;

export type ActionStatus = "planned" | "active" | "held" | "completed";

export type Action = SharedDomainRecord<{
  readonly id: ActionId;
  readonly ownerParticipantId: ParticipantId;
  readonly scope: readonly NonEmptyText[];
  readonly status: ActionStatus;
  readonly affectedPremiseIds: readonly PremiseId[];
  readonly holdReason?: NonEmptyText;
}>;

export type Intervention = SharedDomainRecord<{
  readonly id: InterventionId;
  readonly suggestion: NonEmptyText;
  readonly audienceParticipantIds: readonly ParticipantId[];
  readonly disposition: "pending" | "accepted" | "rejected";
}>;

export type ExternalEvent = SharedDomainRecord<{
  readonly id: ExternalEventId;
  readonly eventType: NonEmptyText;
  readonly payloadHash: ContentHash;
  readonly source: NonEmptyText;
  readonly jurisdiction: NonEmptyText;
  readonly effectiveAt: Timestamp;
  readonly receivedAt: Timestamp;
  readonly signatureResult: "valid" | "invalid";
}>;

export interface DecisionSnapshot {
  readonly title: NonEmptyText;
  readonly outcome: NonEmptyText;
  readonly status: DecisionStatus;
  readonly premiseIds: readonly PremiseId[];
  readonly evidenceIds: readonly EvidenceId[];
  readonly dissentIds: readonly DissentId[];
  readonly actionIds: readonly ActionId[];
  readonly monitorCondition: MonitorCondition;
}

export type DecisionRevision = SharedDomainRecord<{
  readonly id: DecisionRevisionId;
  readonly decisionId: DecisionId;
  readonly version: RevisionNumber;
  readonly previousRevisionId?: DecisionRevisionId;
  readonly snapshot: DecisionSnapshot;
  readonly changeReason: NonEmptyText;
  readonly createdBy: ParticipantId;
}>;

export type ReconsiderationTask = SharedDomainRecord<{
  readonly id: ReconsiderationTaskId;
  readonly decisionId: DecisionId;
  readonly triggerExternalEventId: ExternalEventId;
  readonly ownerParticipantId: ParticipantId;
  readonly affectedPremiseIds: readonly PremiseId[];
  readonly affectedActionIds: readonly ActionId[];
  readonly state: "open" | "in_progress" | "completed" | "cancelled";
}>;

export type RelationKind =
  | "supports"
  | "contradicts"
  | "assumes"
  | "answers"
  | "depends_on"
  | "satisfies"
  | "violates"
  | "implements"
  | `derived_${"f"}rom`
  | "affects";

export type Relation = DomainRecord<{
  readonly id: RelationId;
  readonly sourceId: string;
  readonly targetId: string;
  readonly kind: RelationKind;
  readonly sourceReferenceIds: readonly SourceReferenceId[];
}>;

export function assertRecordScope(record: DomainRecord<object>): void {
  if (record.visibility === "private") {
    const ownerParticipantId = (
      record as {
        readonly ownerParticipantId?: ParticipantId;
      }
    ).ownerParticipantId;
    if (ownerParticipantId === undefined || ownerParticipantId.length === 0) {
      throw new DomainValueError(
        "Private records require an ownerParticipantId",
      );
    }
  }
}

function assertCommonRecord(record: DomainRecord<object>): void {
  assertRecordScope(record);
  if (record.id.length === 0) {
    throw new DomainValueError("Domain record id must not be empty");
  }
}

function assertUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new DomainValueError(`${label} must not contain duplicates`);
  }
}

function assertProbability(value: number | undefined, label: string): void {
  if (
    value !== undefined &&
    (!Number.isFinite(value) || value < 0 || value > 1)
  ) {
    throw new DomainValueError(`${label} must be between 0 and 1`);
  }
}

export function createMeeting(input: Meeting): Meeting {
  assertCommonRecord(input);
  if (input.visibility !== "shared" || input.id !== input.meetingId) {
    throw new DomainValueError(
      "Meeting must be shared and use its own ID as meeting scope",
    );
  }
  if (input.participantAssignments.length === 0) {
    throw new DomainValueError("Meeting requires at least one participant");
  }
  assertUnique(
    input.participantAssignments.map(({ participantId }) => participantId),
    "Meeting participant assignments",
  );
  const facilitator = input.participantAssignments.find(
    ({ participantId }) => participantId === input.facilitatorParticipantId,
  );
  if (facilitator?.role !== "facilitator" || !facilitator.active) {
    throw new DomainValueError(
      "Meeting facilitator must have an active facilitator assignment",
    );
  }
  return input;
}

export function createParticipant(input: Participant): Participant {
  assertCommonRecord(input);
  if (input.visibility !== "shared") {
    throw new DomainValueError("Participant records must be shared");
  }
  assertUnique(input.permissions, "Participant permissions");
  if (
    input.role === "facilitator" &&
    (!input.permissions.includes("commit_decision") ||
      !input.permissions.includes("confirm_review_required"))
  ) {
    throw new DomainValueError(
      "Facilitator requires commitment and review capabilities",
    );
  }
  return input;
}

export function createSourceArtifact(input: SourceArtifact): SourceArtifact {
  assertCommonRecord(input);
  if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 0) {
    throw new DomainValueError(
      "SourceArtifact sizeBytes must be a non-negative safe integer",
    );
  }
  if (input.sizeBytes > 20 * 1024 * 1024) {
    throw new DomainValueError("SourceArtifact exceeds the 20 MB domain limit");
  }
  return input;
}

export function createUtterance(input: Utterance): Utterance {
  assertCommonRecord(input);
  if (input.channel !== input.visibility) {
    throw new DomainValueError(
      "Utterance channel must equal its immutable visibility",
    );
  }
  if (
    input.visibility === "private" &&
    input.participantId !== input.ownerParticipantId
  ) {
    throw new DomainValueError(
      "Private utterance owner must be the speaking participant",
    );
  }
  return input;
}

export function createProposition(input: Proposition): Proposition {
  assertCommonRecord(input);
  assertUnique(input.sourceReferenceIds, "Proposition source references");
  return input;
}

export function createStance(input: Stance): Stance {
  assertCommonRecord(input);
  return input;
}

export function createQuestion(input: Question): Question {
  assertCommonRecord(input);
  return input;
}

export function createClaim(input: Claim): Claim {
  assertCommonRecord(input);
  assertUnique(input.sourceReferenceIds, "Claim source references");
  return input;
}

export function createPremise(input: Premise): Premise {
  assertCommonRecord(input);
  assertUnique(input.dependencyScope, "Premise dependency scope");
  return input;
}

export function createEvidence(input: Evidence): Evidence {
  assertCommonRecord(input);
  if (
    input.visibility !== "shared" ||
    input.confirmationStatus !== "confirmed"
  ) {
    throw new DomainValueError(
      "Published Evidence must be shared and human-confirmed",
    );
  }
  return input;
}

export function createOption(input: Option): Option {
  assertCommonRecord(input);
  return input;
}

export function createCriterion(input: Criterion): Criterion {
  assertCommonRecord(input);
  return input;
}

export function createConstraint(input: Constraint): Constraint {
  assertCommonRecord(input);
  assertUnique(input.sourceReferenceIds, "Constraint source references");
  return input;
}

export function createRisk(input: Risk): Risk {
  assertCommonRecord(input);
  assertProbability(input.probability, "Risk probability");
  assertProbability(input.impact, "Risk impact");
  return input;
}

export function createEvaluation(input: Evaluation): Evaluation {
  assertCommonRecord(input);
  return input;
}

export function createDecision(input: Decision): Decision {
  assertCommonRecord(input);
  assertUnique(input.premiseIds, "Decision premise IDs");
  assertUnique(input.evidenceIds, "Decision evidence IDs");
  assertUnique(input.dissentIds, "Decision dissent IDs");
  assertUnique(input.actionIds, "Decision Action IDs");
  if (input.activeRevision !== input.revision) {
    throw new DomainValueError(
      "Decision activeRevision and record revision must agree",
    );
  }
  if (
    input.status === "SUPERSEDED" &&
    input.supersededByDecisionId === undefined
  ) {
    throw new DomainValueError(
      "A superseded Decision requires its replacement Decision ID",
    );
  }
  return input;
}

export function createDissent(input: Dissent): Dissent {
  assertCommonRecord(input);
  return input;
}

export function createAction(input: Action): Action {
  assertCommonRecord(input);
  if (input.ownerParticipantId.length === 0) {
    throw new DomainValueError("Action requires an owner");
  }
  assertUnique(input.scope, "Action scope");
  assertUnique(input.affectedPremiseIds, "Action affected premise IDs");
  if (input.status === "held" && input.holdReason === undefined) {
    throw new DomainValueError("A held Action requires a hold reason");
  }
  return input;
}

export function createIntervention(input: Intervention): Intervention {
  assertCommonRecord(input);
  assertUnique(
    input.audienceParticipantIds,
    "Intervention audience participant IDs",
  );
  return input;
}

export function createExternalEvent(input: ExternalEvent): ExternalEvent {
  assertCommonRecord(input);
  if (input.visibility !== "shared" || input.signatureResult !== "valid") {
    throw new DomainValueError(
      "Canonical ExternalEvent must be shared and signature-validated",
    );
  }
  return input;
}

export function createDecisionRevision(
  input: DecisionRevision,
): DecisionRevision {
  assertCommonRecord(input);
  if (
    input.visibility !== "shared" ||
    input.confirmationStatus !== "confirmed" ||
    input.revision !== input.version
  ) {
    throw new DomainValueError(
      "DecisionRevision must be shared, confirmed, and match its version",
    );
  }
  if (
    input.version === revisionNumber(1) &&
    input.previousRevisionId !== undefined
  ) {
    throw new DomainValueError(
      "The first Decision revision cannot have a previous revision",
    );
  }
  if (
    input.version > revisionNumber(1) &&
    input.previousRevisionId === undefined
  ) {
    throw new DomainValueError(
      "A later Decision revision requires a previous revision",
    );
  }
  assertUnique(input.snapshot.premiseIds, "Revision premise IDs");
  assertUnique(input.snapshot.evidenceIds, "Revision evidence IDs");
  assertUnique(input.snapshot.dissentIds, "Revision dissent IDs");
  assertUnique(input.snapshot.actionIds, "Revision Action IDs");
  return input;
}

export function createReconsiderationTask(
  input: ReconsiderationTask,
): ReconsiderationTask {
  assertCommonRecord(input);
  if (input.visibility !== "shared") {
    throw new DomainValueError("ReconsiderationTask must be shared");
  }
  if (
    input.affectedPremiseIds.length === 0 ||
    input.affectedActionIds.length === 0
  ) {
    throw new DomainValueError(
      "ReconsiderationTask requires affected premises and Actions",
    );
  }
  assertUnique(input.affectedPremiseIds, "Task premise IDs");
  assertUnique(input.affectedActionIds, "Task Action IDs");
  return input;
}

export function createRelation(input: Relation): Relation {
  assertCommonRecord(input);
  if (input.sourceId === input.targetId) {
    throw new DomainValueError("Relation source and target must differ");
  }
  assertUnique(input.sourceReferenceIds, "Relation source references");
  return input;
}
