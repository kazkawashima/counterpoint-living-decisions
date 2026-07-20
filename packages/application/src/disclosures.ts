import {
  DomainValueError,
  artifactId,
  auditReferenceId,
  causationId,
  contentHash,
  correlationId,
  createEvidence,
  createSourceArtifact,
  disclosureId,
  eventId,
  evidenceId,
  idempotencyKey,
  meetingId,
  meetingPosition,
  nonEmptyText,
  participantId,
  previewHash,
  replayMeeting,
  revisionNumber,
  schemaVersion,
  textRange,
  timestamp,
  type DisclosureOutgoingPayload,
  type DomainEvent,
  type EventOf,
  type MeetingProjection,
  type NonEmptyText,
  type TextRange,
} from "@counterpoint/domain";
import type {
  ArtifactStore,
  Clock,
  EventRecord,
  EventStore,
  IdGenerator,
  ProjectionStore,
} from "@counterpoint/ports";

import {
  authorize,
  type Capability,
  type UserAuthorizationContext,
} from "./authorization.js";

const MEETING_PROJECTION = "meeting";
const TEXT_CONTENT_TYPE = "text/plain; charset=utf-8";

export type StableHashFunction =
  | ((value: string) => Promise<string> | string)
  | {
      hash(value: string): Promise<string> | string;
    };

export interface DisclosureCandidateProposer {
  propose(input: {
    readonly meetingId: string;
    readonly ownerParticipantId: string;
    readonly sourceArtifactId: string;
    readonly text: string;
  }): Promise<{
    readonly exactSnippet?: string;
    readonly sourceRange: {
      readonly end: number;
      readonly start: number;
    };
  }>;
}

export interface DisclosureDependencies {
  readonly artifacts: ArtifactStore;
  readonly candidateProposer?: DisclosureCandidateProposer;
  readonly clock: Clock;
  readonly events: EventStore<DomainEvent>;
  readonly hash: StableHashFunction;
  readonly ids: IdGenerator;
  readonly projections: ProjectionStore<MeetingProjection>;
}

interface MutationInput {
  readonly correlationId?: string;
  readonly expectedPosition: number;
  readonly idempotencyKey: string;
  readonly meetingId: string;
}

export interface RegisterPrivateTextSourceInput extends MutationInput {
  readonly text: string;
  readonly title: string;
}

export interface ProposeDisclosureInput extends MutationInput {
  readonly exactSnippet?: string;
  readonly sourceArtifactId: string;
  readonly sourceRange?: {
    readonly end: number;
    readonly start: number;
  };
}

export interface PreviewDisclosureInput extends MutationInput {
  readonly candidateId: string;
  readonly exactSnippet: string;
  readonly sourceRange: {
    readonly end: number;
    readonly start: number;
  };
}

export interface ApproveDisclosureInput extends MutationInput {
  readonly candidateId: string;
  readonly previewHash: string;
}

export interface RejectDisclosureInput extends MutationInput {
  readonly candidateId: string;
  readonly reason?: string;
}

export type DisclosureFailure =
  | {
      readonly code: "CONFLICT";
      readonly actualPosition: number;
      readonly expectedPosition: number;
      readonly kind: "failed";
    }
  | {
      readonly code:
        | "DISCLOSURE_PREVIEW_MISMATCH"
        | "FORBIDDEN"
        | "IDEMPOTENCY_CONFLICT"
        | "INVALID_STATE_TRANSITION"
        | "VALIDATION_FAILED";
      readonly kind: "failed";
    };

export interface PrivateTextSourceView {
  readonly createdAt: string;
  readonly sourceArtifactId: string;
  readonly text: string;
  readonly title: string;
}

export interface DisclosureOutgoingPayloadView {
  readonly exactSnippet: string;
  readonly sourceArtifactId: string;
  readonly sourceRange: {
    readonly end: number;
    readonly start: number;
  };
}

export interface DisclosureCandidateView {
  readonly candidateId: string;
  readonly outgoingPayload: DisclosureOutgoingPayloadView;
  readonly previewHash?: string;
  readonly state: "approved" | "previewed" | "proposed" | "rejected";
}

export interface SharedEvidenceView {
  readonly createdAt: string;
  readonly evidenceId: string;
  readonly exactSnippet: string;
  readonly sourceArtifactId: string;
  readonly sourceRange: {
    readonly end: number;
    readonly start: number;
  };
}

export type RegisterPrivateTextSourceResult =
  | {
      readonly correlationId: string;
      readonly kind: "registered";
      readonly position: number;
      readonly replayed: boolean;
      readonly source: PrivateTextSourceView;
    }
  | DisclosureFailure;

export type ProposeDisclosureResult =
  | {
      readonly candidate: DisclosureCandidateView;
      readonly correlationId: string;
      readonly kind: "proposed";
      readonly position: number;
      readonly replayed: boolean;
    }
  | DisclosureFailure;

export type PreviewDisclosureResult =
  | {
      readonly candidateId: string;
      readonly correlationId: string;
      readonly kind: "previewed";
      readonly outgoingPayload: DisclosureOutgoingPayloadView;
      readonly position: number;
      readonly previewHash: string;
      readonly replayed: boolean;
    }
  | DisclosureFailure;

export type ApproveDisclosureResult =
  | {
      readonly candidateId: string;
      readonly correlationId: string;
      readonly evidence: SharedEvidenceView;
      readonly kind: "approved";
      readonly position: number;
      readonly previewHash: string;
      readonly replayed: boolean;
    }
  | DisclosureFailure;

export type RejectDisclosureResult =
  | {
      readonly candidateId: string;
      readonly correlationId: string;
      readonly kind: "rejected";
      readonly position: number;
      readonly replayed: boolean;
      readonly state: "rejected";
    }
  | DisclosureFailure;

type AppendResult =
  | {
      readonly kind: "appended" | "replayed";
      readonly records: readonly EventRecord<DomainEvent>[];
    }
  | DisclosureFailure;

interface OwnedSource {
  readonly artifact: EventOf<"ArtifactRegistered">["payload"]["artifact"];
  readonly contentHash: string;
  readonly text: string;
}

type PrivateArtifactRegisteredEvent = Extract<
  EventOf<"ArtifactRegistered">,
  { readonly visibility: "private" }
>;

interface CandidateSnapshot {
  readonly events: readonly (
    | EventOf<"DisclosureApproved">
    | EventOf<"DisclosurePreviewed">
    | EventOf<"DisclosureProposed">
    | EventOf<"DisclosureRejected">
  )[];
  readonly outgoingPayload: DisclosureOutgoingPayload;
  readonly ownerParticipantId: string;
  readonly previewHash?: string;
  readonly resultingEvidenceId?: string;
  readonly state: "approved" | "previewed" | "proposed" | "rejected";
}

function failed(
  code: Exclude<DisclosureFailure["code"], "CONFLICT">,
): DisclosureFailure {
  return { code, kind: "failed" };
}

function authorizeMutation(
  context: UserAuthorizationContext,
  input: MutationInput,
  capability: Capability,
): DisclosureFailure | undefined {
  const result = authorize(context, {
    capability,
    meetingId: input.meetingId,
    ownerParticipantId: context.participantId,
  });
  return result.kind === "authorized" ? undefined : failed("FORBIDDEN");
}

function authorizeOwner(
  context: UserAuthorizationContext,
  capability: Capability,
  meetingScope: string,
  ownerParticipantId: string,
): DisclosureFailure | undefined {
  const result = authorize(context, {
    capability,
    meetingId: meetingScope,
    ownerParticipantId,
  });
  return result.kind === "authorized" ? undefined : failed("FORBIDDEN");
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(",")}]`;
  }
  return `{${Object.entries(value as Readonly<Record<string, unknown>>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`)
    .join(",")}}`;
}

async function hashValue(
  hash: StableHashFunction,
  value: string,
): Promise<string> {
  const result =
    typeof hash === "function" ? await hash(value) : await hash.hash(value);
  if (
    result.length === 0 ||
    result.length > 512 ||
    result.trim() !== result ||
    /\s/u.test(result)
  ) {
    throw new DomainValueError(
      "Injected hash must be a non-empty, whitespace-free value",
    );
  }
  return result;
}

function exactText(value: string): NonEmptyText {
  nonEmptyText(value);
  return value as NonEmptyText;
}

function outgoingPayloadView(
  payload: DisclosureOutgoingPayload,
): DisclosureOutgoingPayloadView {
  return {
    exactSnippet: payload.exactSnippet,
    sourceArtifactId: payload.sourceArtifactId,
    sourceRange: {
      start: payload.sourceRange.start,
      end: payload.sourceRange.end,
    },
  };
}

function previewFingerprintPayload(payload: DisclosureOutgoingPayload): string {
  return stableSerialize(outgoingPayloadView(payload));
}

function commandCorrelationId(
  dependencies: DisclosureDependencies,
  input: MutationInput,
): ReturnType<typeof correlationId> {
  return correlationId(
    input.correlationId ?? dependencies.ids.next("correlation"),
  );
}

function participantActor(context: UserAuthorizationContext): {
  readonly kind: "participant";
  readonly participantId: ReturnType<typeof participantId>;
} {
  return {
    kind: "participant",
    participantId: participantId(context.participantId),
  };
}

function normalizeRecords(
  records: readonly EventRecord<DomainEvent>[],
): readonly DomainEvent[] {
  return records.map(({ event, position }) => ({
    ...event,
    position: meetingPosition(position),
  }));
}

function eventsAfterLatestDemoReset(
  events: readonly DomainEvent[],
): readonly DomainEvent[] {
  const resetIndex = events.findLastIndex(
    (event) => event.eventType === "DemoResetCompleted",
  );
  return resetIndex < 0 ? events : events.slice(resetIndex + 1);
}

async function refreshProjection(
  dependencies: DisclosureDependencies,
  meetingScope: string,
  ownerParticipantId: string,
): Promise<void> {
  const records = await dependencies.events.load(meetingScope);
  const projection = replayMeeting(
    meetingId(meetingScope),
    normalizeRecords(records),
  );
  await dependencies.projections.put(
    {
      meetingId: meetingScope,
      ownerParticipantId,
      projection: MEETING_PROJECTION,
    },
    projection,
  );
}

async function appendMutation(
  dependencies: DisclosureDependencies,
  input: MutationInput,
  fingerprint: string,
  events: readonly DomainEvent[],
  ownerParticipantId: string,
): Promise<AppendResult> {
  const result = await dependencies.events.append({
    events,
    expectedPosition: input.expectedPosition,
    idempotencyKey: input.idempotencyKey,
    meetingId: input.meetingId,
    payloadFingerprint: fingerprint,
    trustPayloadFingerprintForReplay: true,
  });
  if (result.kind === "position_conflict") {
    return {
      actualPosition: result.actualPosition,
      code: "CONFLICT",
      expectedPosition: result.expectedPosition,
      kind: "failed",
    };
  }
  if (result.kind === "idempotency_conflict") {
    return failed("IDEMPOTENCY_CONFLICT");
  }
  await refreshProjection(dependencies, input.meetingId, ownerParticipantId);
  return result;
}

function disclosureEvent(
  event: DomainEvent,
): event is
  | EventOf<"DisclosureApproved">
  | EventOf<"DisclosurePreviewed">
  | EventOf<"DisclosureProposed">
  | EventOf<"DisclosureRejected"> {
  return (
    event.eventType === "DisclosureApproved" ||
    event.eventType === "DisclosurePreviewed" ||
    event.eventType === "DisclosureProposed" ||
    event.eventType === "DisclosureRejected"
  );
}

async function loadCandidate(
  dependencies: DisclosureDependencies,
  meetingScope: string,
  candidateId: string,
): Promise<CandidateSnapshot | undefined> {
  const records = await dependencies.events.load(meetingScope);
  const events = eventsAfterLatestDemoReset(normalizeRecords(records)).filter(
    (event) =>
      disclosureEvent(event) && event.payload.disclosureId === candidateId,
  ) as CandidateSnapshot["events"];
  const proposed = events.find(
    (event): event is EventOf<"DisclosureProposed"> =>
      event.eventType === "DisclosureProposed",
  );
  if (proposed === undefined) {
    return undefined;
  }

  let outgoingPayload = proposed.payload.outgoingPayload;
  let state: CandidateSnapshot["state"] = "proposed";
  let storedPreviewHash: string | undefined;
  let resultingEvidenceId: string | undefined;
  for (const event of events) {
    if (event.ownerParticipantId !== proposed.ownerParticipantId) {
      continue;
    }
    switch (event.eventType) {
      case "DisclosureProposed":
        break;
      case "DisclosurePreviewed":
        outgoingPayload = event.payload.outgoingPayload;
        storedPreviewHash = event.payload.previewHash;
        state = "previewed";
        break;
      case "DisclosureApproved":
        storedPreviewHash = event.payload.previewHash;
        resultingEvidenceId = event.payload.resultingEvidenceId;
        state = "approved";
        break;
      case "DisclosureRejected":
        state = "rejected";
        break;
    }
  }
  return {
    events,
    outgoingPayload,
    ownerParticipantId: proposed.ownerParticipantId,
    ...(storedPreviewHash === undefined
      ? {}
      : { previewHash: storedPreviewHash }),
    ...(resultingEvidenceId === undefined ? {} : { resultingEvidenceId }),
    state,
  };
}

function sourceRegisteredEvent(
  event: DomainEvent,
): event is PrivateArtifactRegisteredEvent {
  return (
    event.eventType === "ArtifactRegistered" && event.visibility === "private"
  );
}

async function loadOwnedSource(
  dependencies: DisclosureDependencies,
  context: UserAuthorizationContext,
  meetingScope: string,
  sourceArtifactId: string,
  capability: Capability,
): Promise<DisclosureFailure | OwnedSource> {
  const records = await dependencies.events.load(meetingScope);
  const activeEvents = eventsAfterLatestDemoReset(normalizeRecords(records));
  const registered = activeEvents.find(
    (event): event is PrivateArtifactRegisteredEvent =>
      sourceRegisteredEvent(event) &&
      event.payload.artifact.id === sourceArtifactId,
  );
  if (registered === undefined) {
    return failed("FORBIDDEN");
  }
  const ownerFailure = authorizeOwner(
    context,
    capability,
    registered.meetingId,
    registered.ownerParticipantId,
  );
  if (ownerFailure !== undefined) {
    return ownerFailure;
  }
  if (
    registered.payload.artifact.visibility !== "private" ||
    registered.payload.artifact.ownerParticipantId !==
      registered.ownerParticipantId
  ) {
    return failed("FORBIDDEN");
  }

  const processed =
    registered.payload.artifact.artifactType === "text"
      ? undefined
      : activeEvents.find(
          (event): event is EventOf<"ArtifactProcessed"> =>
            event.eventType === "ArtifactProcessed" &&
            event.ownerParticipantId === registered.ownerParticipantId &&
            event.payload.artifactId === sourceArtifactId,
        );
  const readableArtifactId =
    registered.payload.artifact.artifactType === "text"
      ? sourceArtifactId
      : processed?.payload.processingState === "processed"
        ? processed.payload.derivedArtifactId
        : undefined;
  const readableContentHash =
    registered.payload.artifact.artifactType === "text"
      ? registered.payload.artifact.contentHash
      : processed?.payload.processingState === "processed"
        ? processed.payload.contentHash
        : undefined;
  if (readableArtifactId === undefined || readableContentHash === undefined) {
    return failed("VALIDATION_FAILED");
  }
  const bytes = await dependencies.artifacts.get({
    artifactId: readableArtifactId,
    meetingId: meetingScope,
    ownerParticipantId: registered.ownerParticipantId,
    visibility: "private",
  });
  if (bytes === undefined) {
    return failed("FORBIDDEN");
  }
  try {
    return {
      artifact: registered.payload.artifact,
      contentHash: readableContentHash,
      text: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    };
  } catch {
    return failed("VALIDATION_FAILED");
  }
}

function selectedPayload(
  sourceArtifactId: string,
  sourceText: string,
  rangeInput: { readonly end: number; readonly start: number },
  expectedSnippet?: string,
): DisclosureFailure | DisclosureOutgoingPayload {
  let range: TextRange;
  try {
    range = textRange(rangeInput.start, rangeInput.end);
  } catch (error) {
    if (error instanceof DomainValueError) {
      return failed("VALIDATION_FAILED");
    }
    throw error;
  }
  if (range.end > sourceText.length) {
    return failed("VALIDATION_FAILED");
  }
  const exactSnippet = sourceText.slice(range.start, range.end);
  if (expectedSnippet !== undefined && expectedSnippet !== exactSnippet) {
    return failed("DISCLOSURE_PREVIEW_MISMATCH");
  }
  try {
    return {
      exactSnippet: exactText(exactSnippet),
      sourceArtifactId: artifactId(sourceArtifactId),
      sourceRange: range,
    };
  } catch (error) {
    if (error instanceof DomainValueError) {
      return failed("VALIDATION_FAILED");
    }
    throw error;
  }
}

function candidateHasIdempotencyKey(
  candidate: CandidateSnapshot,
  key: string,
): boolean {
  return candidate.events.some((event) => event.idempotencyKey === key);
}

function eventAt<Type extends DomainEvent["eventType"]>(
  records: readonly EventRecord<DomainEvent>[],
  eventType: Type,
): Extract<DomainEvent, { readonly eventType: Type }> | undefined {
  return normalizeRecords(records).find(
    (event): event is Extract<DomainEvent, { readonly eventType: Type }> =>
      event.eventType === eventType,
  );
}

export async function registerPrivateTextSource(
  dependencies: DisclosureDependencies,
  context: UserAuthorizationContext,
  input: RegisterPrivateTextSourceInput,
): Promise<RegisterPrivateTextSourceResult> {
  const authorizationFailure = authorizeMutation(
    context,
    input,
    "artifact:create-own",
  );
  if (authorizationFailure !== undefined) {
    return authorizationFailure;
  }

  let title: string;
  let occurredAt: ReturnType<typeof timestamp>;
  let sourceHash: string;
  let expectedPosition: ReturnType<typeof meetingPosition>;
  let commandIdempotencyKey: ReturnType<typeof idempotencyKey>;
  try {
    title = nonEmptyText(input.title);
    exactText(input.text);
    occurredAt = timestamp(dependencies.clock.now());
    expectedPosition = meetingPosition(input.expectedPosition);
    commandIdempotencyKey = idempotencyKey(input.idempotencyKey);
    sourceHash = await hashValue(
      dependencies.hash,
      `source\u0000${input.text}`,
    );
  } catch (error) {
    if (error instanceof DomainValueError) {
      return failed("VALIDATION_FAILED");
    }
    throw error;
  }

  const sourceArtifactId = artifactId(dependencies.ids.next("artifact"));
  const metadata = await dependencies.artifacts.put({
    bytes: new TextEncoder().encode(input.text),
    contentType: TEXT_CONTENT_TYPE,
    hash: sourceHash,
    scope: {
      artifactId: sourceArtifactId,
      meetingId: input.meetingId,
      ownerParticipantId: context.participantId,
      visibility: "private",
    },
  });
  const correlation = commandCorrelationId(dependencies, input);
  const artifact = createSourceArtifact({
    artifactType: "text",
    confirmationStatus: "not_applicable",
    contentHash: contentHash(sourceHash),
    createdAt: occurredAt,
    createdBy: participantId(context.participantId),
    id: sourceArtifactId,
    meetingId: meetingId(input.meetingId),
    origin: "human_input",
    ownerParticipantId: participantId(context.participantId),
    processingState: "processed",
    revision: revisionNumber(1),
    sizeBytes: metadata.size,
    storageReference: nonEmptyText(metadata.storageReference),
    visibility: "private",
  });
  const event: EventOf<"ArtifactRegistered"> = {
    actor: participantActor(context),
    correlationId: correlation,
    eventId: eventId(dependencies.ids.next("event")),
    eventType: "ArtifactRegistered",
    idempotencyKey: commandIdempotencyKey,
    meetingId: meetingId(input.meetingId),
    occurredAt,
    ownerParticipantId: participantId(context.participantId),
    payload: { artifact },
    position: meetingPosition(expectedPosition + 1),
    schemaVersion: schemaVersion(1),
    visibility: "private",
  };
  const fingerprint = await hashValue(
    dependencies.hash,
    stableSerialize({
      command: "register-private-text-source",
      contentHash: sourceHash,
      meetingId: input.meetingId,
      ownerParticipantId: context.participantId,
      title,
    }),
  );
  const appended = await appendMutation(
    dependencies,
    input,
    fingerprint,
    [event],
    context.participantId,
  );
  if (appended.kind === "failed") {
    await dependencies.artifacts.delete({
      artifactId: sourceArtifactId,
      meetingId: input.meetingId,
      ownerParticipantId: context.participantId,
      visibility: "private",
    });
    return appended;
  }

  const registered = eventAt(appended.records, "ArtifactRegistered");
  if (registered === undefined) {
    throw new Error("Artifact registration append returned no registration");
  }
  if (
    appended.kind === "replayed" &&
    registered.payload.artifact.id !== sourceArtifactId
  ) {
    await dependencies.artifacts.delete({
      artifactId: sourceArtifactId,
      meetingId: input.meetingId,
      ownerParticipantId: context.participantId,
      visibility: "private",
    });
  }
  return {
    correlationId: registered.correlationId,
    kind: "registered",
    position: registered.position,
    replayed: appended.kind === "replayed",
    source: {
      createdAt: registered.occurredAt,
      sourceArtifactId: registered.payload.artifact.id,
      text: input.text,
      title,
    },
  };
}

export const registerPrivateTextSourceFixture = registerPrivateTextSource;

async function replayedAiProposal(
  dependencies: DisclosureDependencies,
  context: UserAuthorizationContext,
  input: ProposeDisclosureInput,
): Promise<ProposeDisclosureResult | undefined> {
  const records = await dependencies.events.load(input.meetingId);
  const events = normalizeRecords(records);
  const existing = events.find(
    (event) => event.idempotencyKey === input.idempotencyKey,
  );
  if (existing === undefined) {
    return undefined;
  }
  if (!eventsAfterLatestDemoReset(events).includes(existing)) {
    return failed("IDEMPOTENCY_CONFLICT");
  }
  if (
    existing.eventType !== "DisclosureProposed" ||
    existing.ownerParticipantId !== context.participantId
  ) {
    return failed("IDEMPOTENCY_CONFLICT");
  }
  const proposed: EventOf<"DisclosureProposed"> = existing;
  if (
    proposed.payload.outgoingPayload.sourceArtifactId !== input.sourceArtifactId
  ) {
    return failed("IDEMPOTENCY_CONFLICT");
  }
  return {
    candidate: {
      candidateId: proposed.payload.disclosureId,
      outgoingPayload: outgoingPayloadView(proposed.payload.outgoingPayload),
      state: "proposed",
    },
    correlationId: proposed.correlationId,
    kind: "proposed",
    position: proposed.position,
    replayed: true,
  };
}

export async function proposeDisclosure(
  dependencies: DisclosureDependencies,
  context: UserAuthorizationContext,
  input: ProposeDisclosureInput,
): Promise<ProposeDisclosureResult> {
  const authorizationFailure = authorizeMutation(
    context,
    input,
    "disclosure:propose-own",
  );
  if (authorizationFailure !== undefined) {
    return authorizationFailure;
  }
  const source = await loadOwnedSource(
    dependencies,
    context,
    input.meetingId,
    input.sourceArtifactId,
    "disclosure:propose-own",
  );
  if ("kind" in source) {
    return source;
  }

  let proposedRange = input.sourceRange;
  let proposedSnippet = input.exactSnippet;
  if (dependencies.candidateProposer !== undefined) {
    const replayed = await replayedAiProposal(dependencies, context, input);
    if (replayed !== undefined) {
      return replayed;
    }
    const proposal = await dependencies.candidateProposer.propose({
      meetingId: input.meetingId,
      ownerParticipantId: context.participantId,
      sourceArtifactId: input.sourceArtifactId,
      text: source.text,
    });
    proposedRange = proposal.sourceRange;
    proposedSnippet = proposal.exactSnippet;
  }
  if (proposedRange === undefined) {
    return failed("VALIDATION_FAILED");
  }
  const outgoingPayload = selectedPayload(
    input.sourceArtifactId,
    source.text,
    proposedRange,
    proposedSnippet,
  );
  if ("kind" in outgoingPayload) {
    return outgoingPayload.code === "DISCLOSURE_PREVIEW_MISMATCH"
      ? failed("VALIDATION_FAILED")
      : outgoingPayload;
  }

  let occurredAt: ReturnType<typeof timestamp>;
  let expectedPosition: ReturnType<typeof meetingPosition>;
  let commandIdempotencyKey: ReturnType<typeof idempotencyKey>;
  try {
    occurredAt = timestamp(dependencies.clock.now());
    expectedPosition = meetingPosition(input.expectedPosition);
    commandIdempotencyKey = idempotencyKey(input.idempotencyKey);
  } catch (error) {
    if (error instanceof DomainValueError) {
      return failed("VALIDATION_FAILED");
    }
    throw error;
  }
  const candidateId = disclosureId(dependencies.ids.next("disclosure"));
  const correlation = commandCorrelationId(dependencies, input);
  const event: EventOf<"DisclosureProposed"> = {
    actor: participantActor(context),
    correlationId: correlation,
    eventId: eventId(dependencies.ids.next("event")),
    eventType: "DisclosureProposed",
    idempotencyKey: commandIdempotencyKey,
    meetingId: meetingId(input.meetingId),
    occurredAt,
    ownerParticipantId: participantId(context.participantId),
    payload: {
      disclosureId: candidateId,
      outgoingPayload,
      ownerParticipantId: participantId(context.participantId),
    },
    position: meetingPosition(expectedPosition + 1),
    schemaVersion: schemaVersion(1),
    visibility: "private",
  };
  const payloadHash = await hashValue(
    dependencies.hash,
    previewFingerprintPayload(outgoingPayload),
  );
  const fingerprint = await hashValue(
    dependencies.hash,
    stableSerialize({
      command: "propose-disclosure",
      meetingId: input.meetingId,
      ownerParticipantId: context.participantId,
      outgoingPayloadHash: payloadHash,
    }),
  );
  const appended = await appendMutation(
    dependencies,
    input,
    fingerprint,
    [event],
    context.participantId,
  );
  if (appended.kind === "failed") {
    return appended;
  }
  const proposed = eventAt(appended.records, "DisclosureProposed");
  if (proposed === undefined) {
    throw new Error("Disclosure proposal append returned no proposal");
  }
  return {
    candidate: {
      candidateId: proposed.payload.disclosureId,
      outgoingPayload: outgoingPayloadView(proposed.payload.outgoingPayload),
      state: "proposed",
    },
    correlationId: proposed.correlationId,
    kind: "proposed",
    position: proposed.position,
    replayed: appended.kind === "replayed",
  };
}

export async function previewDisclosure(
  dependencies: DisclosureDependencies,
  context: UserAuthorizationContext,
  input: PreviewDisclosureInput,
): Promise<PreviewDisclosureResult> {
  const authorizationFailure = authorizeMutation(
    context,
    input,
    "disclosure:propose-own",
  );
  if (authorizationFailure !== undefined) {
    return authorizationFailure;
  }
  const candidate = await loadCandidate(
    dependencies,
    input.meetingId,
    input.candidateId,
  );
  if (candidate === undefined) {
    return failed("FORBIDDEN");
  }
  const ownerFailure = authorizeOwner(
    context,
    "disclosure:propose-own",
    input.meetingId,
    candidate.ownerParticipantId,
  );
  if (ownerFailure !== undefined) {
    return ownerFailure;
  }
  if (
    (candidate.state === "approved" || candidate.state === "rejected") &&
    !candidateHasIdempotencyKey(candidate, input.idempotencyKey)
  ) {
    return failed("INVALID_STATE_TRANSITION");
  }

  const source = await loadOwnedSource(
    dependencies,
    context,
    input.meetingId,
    candidate.outgoingPayload.sourceArtifactId,
    "disclosure:propose-own",
  );
  if ("kind" in source) {
    return source;
  }
  const outgoingPayload = selectedPayload(
    source.artifact.id,
    source.text,
    input.sourceRange,
    input.exactSnippet,
  );
  if ("kind" in outgoingPayload) {
    return outgoingPayload.code === "VALIDATION_FAILED"
      ? outgoingPayload
      : failed("DISCLOSURE_PREVIEW_MISMATCH");
  }

  let occurredAt: ReturnType<typeof timestamp>;
  let expectedPosition: ReturnType<typeof meetingPosition>;
  let commandIdempotencyKey: ReturnType<typeof idempotencyKey>;
  let calculatedPreviewHash: string;
  try {
    occurredAt = timestamp(dependencies.clock.now());
    expectedPosition = meetingPosition(input.expectedPosition);
    commandIdempotencyKey = idempotencyKey(input.idempotencyKey);
    calculatedPreviewHash = await hashValue(
      dependencies.hash,
      previewFingerprintPayload(outgoingPayload),
    );
  } catch (error) {
    if (error instanceof DomainValueError) {
      return failed("VALIDATION_FAILED");
    }
    throw error;
  }
  const correlation = commandCorrelationId(dependencies, input);
  const event: EventOf<"DisclosurePreviewed"> = {
    actor: participantActor(context),
    correlationId: correlation,
    eventId: eventId(dependencies.ids.next("event")),
    eventType: "DisclosurePreviewed",
    idempotencyKey: commandIdempotencyKey,
    meetingId: meetingId(input.meetingId),
    occurredAt,
    ownerParticipantId: participantId(context.participantId),
    payload: {
      disclosureId: disclosureId(input.candidateId),
      outgoingPayload,
      previewHash: previewHash(calculatedPreviewHash),
    },
    position: meetingPosition(expectedPosition + 1),
    schemaVersion: schemaVersion(1),
    visibility: "private",
  };
  const fingerprint = await hashValue(
    dependencies.hash,
    stableSerialize({
      candidateId: input.candidateId,
      command: "preview-disclosure",
      meetingId: input.meetingId,
      ownerParticipantId: context.participantId,
      previewHash: calculatedPreviewHash,
    }),
  );
  const appended = await appendMutation(
    dependencies,
    input,
    fingerprint,
    [event],
    context.participantId,
  );
  if (appended.kind === "failed") {
    return appended;
  }
  const previewed = eventAt(appended.records, "DisclosurePreviewed");
  if (previewed === undefined) {
    throw new Error("Disclosure preview append returned no preview");
  }
  return {
    candidateId: previewed.payload.disclosureId,
    correlationId: previewed.correlationId,
    kind: "previewed",
    outgoingPayload: outgoingPayloadView(previewed.payload.outgoingPayload),
    position: previewed.position,
    previewHash: previewed.payload.previewHash,
    replayed: appended.kind === "replayed",
  };
}

export async function approveDisclosure(
  dependencies: DisclosureDependencies,
  context: UserAuthorizationContext,
  input: ApproveDisclosureInput,
): Promise<ApproveDisclosureResult> {
  const authorizationFailure = authorizeMutation(
    context,
    input,
    "disclosure:approve-own",
  );
  if (authorizationFailure !== undefined) {
    return authorizationFailure;
  }
  const candidate = await loadCandidate(
    dependencies,
    input.meetingId,
    input.candidateId,
  );
  if (candidate === undefined) {
    return failed("FORBIDDEN");
  }
  const ownerFailure = authorizeOwner(
    context,
    "disclosure:approve-own",
    input.meetingId,
    candidate.ownerParticipantId,
  );
  if (ownerFailure !== undefined) {
    return ownerFailure;
  }
  if (
    candidate.state !== "previewed" &&
    !(
      candidate.state === "approved" &&
      candidateHasIdempotencyKey(candidate, input.idempotencyKey)
    )
  ) {
    return failed("INVALID_STATE_TRANSITION");
  }

  const source = await loadOwnedSource(
    dependencies,
    context,
    input.meetingId,
    candidate.outgoingPayload.sourceArtifactId,
    "disclosure:approve-own",
  );
  if ("kind" in source) {
    return source;
  }
  const revalidatedPayload = selectedPayload(
    source.artifact.id,
    source.text,
    candidate.outgoingPayload.sourceRange,
    candidate.outgoingPayload.exactSnippet,
  );
  if ("kind" in revalidatedPayload) {
    return failed("DISCLOSURE_PREVIEW_MISMATCH");
  }

  let occurredAt: ReturnType<typeof timestamp>;
  let expectedPosition: ReturnType<typeof meetingPosition>;
  let commandIdempotencyKey: ReturnType<typeof idempotencyKey>;
  let revalidatedPreviewHash: string;
  try {
    occurredAt = timestamp(dependencies.clock.now());
    expectedPosition = meetingPosition(input.expectedPosition);
    commandIdempotencyKey = idempotencyKey(input.idempotencyKey);
    const revalidatedSourceHash = await hashValue(
      dependencies.hash,
      source.artifact.origin === "human_input"
        ? `source\u0000${source.text}`
        : source.text,
    );
    revalidatedPreviewHash = await hashValue(
      dependencies.hash,
      previewFingerprintPayload(revalidatedPayload),
    );
    if (
      revalidatedSourceHash !== source.contentHash ||
      candidate.previewHash === undefined ||
      candidate.previewHash !== input.previewHash ||
      revalidatedPreviewHash !== input.previewHash
    ) {
      return failed("DISCLOSURE_PREVIEW_MISMATCH");
    }
  } catch (error) {
    if (error instanceof DomainValueError) {
      return failed("VALIDATION_FAILED");
    }
    throw error;
  }

  const correlation = commandCorrelationId(dependencies, input);
  const approvalEventId = eventId(dependencies.ids.next("event"));
  const resultingEvidenceId =
    candidate.resultingEvidenceId === undefined
      ? evidenceId(dependencies.ids.next("evidence"))
      : evidenceId(candidate.resultingEvidenceId);
  const evidence = createEvidence({
    confirmationStatus: "confirmed",
    createdAt: occurredAt,
    createdBy: participantId(context.participantId),
    disclosureAuditReferenceId: auditReferenceId(approvalEventId),
    exactSnippet: revalidatedPayload.exactSnippet,
    id: resultingEvidenceId,
    meetingId: meetingId(input.meetingId),
    origin: "source_artifact",
    revision: revisionNumber(1),
    sourceArtifactId: revalidatedPayload.sourceArtifactId,
    sourceRange: revalidatedPayload.sourceRange,
    visibility: "shared",
  });
  const approved: EventOf<"DisclosureApproved"> = {
    actor: participantActor(context),
    correlationId: correlation,
    eventId: approvalEventId,
    eventType: "DisclosureApproved",
    idempotencyKey: commandIdempotencyKey,
    meetingId: meetingId(input.meetingId),
    occurredAt,
    ownerParticipantId: participantId(context.participantId),
    payload: {
      approvedAt: occurredAt,
      disclosureId: disclosureId(input.candidateId),
      previewHash: previewHash(revalidatedPreviewHash),
      resultingEvidenceId,
    },
    position: meetingPosition(expectedPosition + 1),
    schemaVersion: schemaVersion(1),
    visibility: "private",
  };
  const shared: EventOf<"EvidenceShared"> = {
    actor: participantActor(context),
    causationId: causationId(approvalEventId),
    correlationId: correlation,
    eventId: eventId(dependencies.ids.next("event")),
    eventType: "EvidenceShared",
    meetingId: meetingId(input.meetingId),
    occurredAt,
    payload: { evidence },
    position: meetingPosition(expectedPosition + 2),
    schemaVersion: schemaVersion(1),
    visibility: "shared",
  };
  const fingerprint = await hashValue(
    dependencies.hash,
    stableSerialize({
      candidateId: input.candidateId,
      command: "approve-disclosure",
      meetingId: input.meetingId,
      ownerParticipantId: context.participantId,
      previewHash: input.previewHash,
    }),
  );
  const appended = await appendMutation(
    dependencies,
    input,
    fingerprint,
    [approved, shared],
    context.participantId,
  );
  if (appended.kind === "failed") {
    return appended;
  }
  const storedApproval = eventAt(appended.records, "DisclosureApproved");
  const storedEvidence = eventAt(appended.records, "EvidenceShared");
  if (storedApproval === undefined || storedEvidence === undefined) {
    throw new Error("Disclosure approval append returned incomplete records");
  }
  return {
    candidateId: storedApproval.payload.disclosureId,
    correlationId: storedApproval.correlationId,
    evidence: {
      createdAt: storedEvidence.payload.evidence.createdAt,
      evidenceId: storedEvidence.payload.evidence.id,
      exactSnippet: storedEvidence.payload.evidence.exactSnippet,
      sourceArtifactId: storedEvidence.payload.evidence.sourceArtifactId,
      sourceRange: {
        start: storedEvidence.payload.evidence.sourceRange.start,
        end: storedEvidence.payload.evidence.sourceRange.end,
      },
    },
    kind: "approved",
    position: storedEvidence.position,
    previewHash: storedApproval.payload.previewHash,
    replayed: appended.kind === "replayed",
  };
}

export async function rejectDisclosure(
  dependencies: DisclosureDependencies,
  context: UserAuthorizationContext,
  input: RejectDisclosureInput,
): Promise<RejectDisclosureResult> {
  const authorizationFailure = authorizeMutation(
    context,
    input,
    "disclosure:approve-own",
  );
  if (authorizationFailure !== undefined) {
    return authorizationFailure;
  }
  const candidate = await loadCandidate(
    dependencies,
    input.meetingId,
    input.candidateId,
  );
  if (candidate === undefined) {
    return failed("FORBIDDEN");
  }
  const ownerFailure = authorizeOwner(
    context,
    "disclosure:approve-own",
    input.meetingId,
    candidate.ownerParticipantId,
  );
  if (ownerFailure !== undefined) {
    return ownerFailure;
  }
  if (
    (candidate.state === "approved" || candidate.state === "rejected") &&
    !candidateHasIdempotencyKey(candidate, input.idempotencyKey)
  ) {
    return failed("INVALID_STATE_TRANSITION");
  }

  let occurredAt: ReturnType<typeof timestamp>;
  let expectedPosition: ReturnType<typeof meetingPosition>;
  let commandIdempotencyKey: ReturnType<typeof idempotencyKey>;
  let reason: NonEmptyText | undefined;
  try {
    occurredAt = timestamp(dependencies.clock.now());
    expectedPosition = meetingPosition(input.expectedPosition);
    commandIdempotencyKey = idempotencyKey(input.idempotencyKey);
    reason =
      input.reason === undefined ? undefined : nonEmptyText(input.reason);
  } catch (error) {
    if (error instanceof DomainValueError) {
      return failed("VALIDATION_FAILED");
    }
    throw error;
  }

  const correlation = commandCorrelationId(dependencies, input);
  const event: EventOf<"DisclosureRejected"> = {
    actor: participantActor(context),
    correlationId: correlation,
    eventId: eventId(dependencies.ids.next("event")),
    eventType: "DisclosureRejected",
    idempotencyKey: commandIdempotencyKey,
    meetingId: meetingId(input.meetingId),
    occurredAt,
    ownerParticipantId: participantId(context.participantId),
    payload: {
      disclosureId: disclosureId(input.candidateId),
      rejectedAt: occurredAt,
      ...(reason === undefined ? {} : { reason }),
    },
    position: meetingPosition(expectedPosition + 1),
    schemaVersion: schemaVersion(1),
    visibility: "private",
  };
  const reasonHash =
    reason === undefined
      ? undefined
      : await hashValue(dependencies.hash, `rejection\u0000${reason}`);
  const fingerprint = await hashValue(
    dependencies.hash,
    stableSerialize({
      candidateId: input.candidateId,
      command: "reject-disclosure",
      meetingId: input.meetingId,
      ownerParticipantId: context.participantId,
      reasonHash,
    }),
  );
  const appended = await appendMutation(
    dependencies,
    input,
    fingerprint,
    [event],
    context.participantId,
  );
  if (appended.kind === "failed") {
    return appended;
  }
  const rejected = eventAt(appended.records, "DisclosureRejected");
  if (rejected === undefined) {
    throw new Error("Disclosure rejection append returned no rejection");
  }
  return {
    candidateId: rejected.payload.disclosureId,
    correlationId: rejected.correlationId,
    kind: "rejected",
    position: rejected.position,
    replayed: appended.kind === "replayed",
    state: "rejected",
  };
}
