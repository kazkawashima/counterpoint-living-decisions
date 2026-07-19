import type { UserAuthorizationContext } from "@counterpoint/application";
import {
  meetingId as domainMeetingId,
  meetingPosition,
  replayMeeting,
  type Decision as DomainDecision,
  type DomainEvent,
  type SourceArtifact,
} from "@counterpoint/domain";
import {
  RealtimeRoleProjectionSchema,
  RoleProjectionResponseSchema,
  SharedDisplayProjectionResponseSchema,
  type RealtimeRoleProjection,
  type RoleProjectionResponse,
  type SharedDisplayProjectionResponse,
} from "@counterpoint/protocol";

import type { ServerRuntime } from "./runtime.js";

function decisionReadiness(decision: DomainDecision) {
  return {
    actionIds: decision.actionIds.length > 0,
    evidenceIds: decision.evidenceIds.length > 0,
    monitorCondition: decision.monitorCondition.description.length > 0,
    outcome: decision.outcome.length > 0,
    premiseIds: decision.premiseIds.length > 0,
  };
}

function decisionView(
  decision: DomainDecision,
  updatedAt: string = decision.createdAt,
) {
  return {
    activeRevision: decision.activeRevision,
    activeRevisionId: decision.activeRevisionId,
    decisionId: decision.id,
    readiness: decisionReadiness(decision),
    snapshot: {
      actionIds: decision.actionIds,
      dissentIds: decision.dissentIds,
      evidenceIds: decision.evidenceIds,
      monitorCondition: decision.monitorCondition,
      outcome: decision.outcome,
      premiseIds: decision.premiseIds,
      status: decision.status,
      title: decision.title,
    },
    status: decision.status,
    ...(decision.supersededByDecisionId === undefined
      ? {}
      : { supersededByDecisionId: decision.supersededByDecisionId }),
    updatedAt,
  };
}

function isVisibleTo(event: DomainEvent, participantId: string): boolean {
  return (
    event.visibility === "shared" || event.ownerParticipantId === participantId
  );
}

function utteranceView(
  utterance: ReturnType<typeof replayMeeting>["shared"]["utterances"][number],
) {
  return {
    capturedAt: utterance.capturedAt,
    channel: utterance.channel,
    participantId: utterance.participantId,
    text: utterance.text,
    utteranceId: utterance.id,
  };
}

function privateDisclosureCandidates(
  events: readonly DomainEvent[],
  participantId: string,
) {
  const candidates = new Map<
    string,
    {
      candidateId: string;
      outgoingPayload: {
        exactSnippet: string;
        sourceArtifactId: string;
        sourceRange: { end: number; start: number };
      };
      previewHash?: string;
      state: "approved" | "previewed" | "proposed" | "rejected";
    }
  >();
  for (const event of events) {
    if (
      event.visibility !== "private" ||
      event.ownerParticipantId !== participantId
    ) {
      continue;
    }
    switch (event.eventType) {
      case "DisclosureProposed": {
        const candidateId = String(event.payload.disclosureId);
        candidates.set(candidateId, {
          candidateId,
          outgoingPayload: event.payload.outgoingPayload,
          state: "proposed",
        });
        break;
      }
      case "DisclosurePreviewed": {
        const candidateId = String(event.payload.disclosureId);
        const prior = candidates.get(candidateId);
        if (prior !== undefined) {
          candidates.set(candidateId, {
            ...prior,
            outgoingPayload: event.payload.outgoingPayload,
            previewHash: event.payload.previewHash,
            state: "previewed",
          });
        }
        break;
      }
      case "DisclosureApproved": {
        const candidateId = String(event.payload.disclosureId);
        const prior = candidates.get(candidateId);
        if (prior !== undefined) {
          candidates.set(candidateId, {
            ...prior,
            previewHash: event.payload.previewHash,
            state: "approved",
          });
        }
        break;
      }
      case "DisclosureRejected": {
        const candidateId = String(event.payload.disclosureId);
        const prior = candidates.get(candidateId);
        if (prior !== undefined) {
          candidates.set(candidateId, {
            ...prior,
            state: "rejected",
          });
        }
        break;
      }
      default:
        break;
    }
  }
  return [...candidates.values()];
}

function privateInferenceSuggestions(
  events: readonly DomainEvent[],
  participantId: string,
) {
  return events.flatMap((event) => {
    if (
      event.eventType !== "InferenceSuggested" ||
      event.visibility !== "private" ||
      event.ownerParticipantId !== participantId
    ) {
      return [];
    }
    const disposition = events.find(
      (candidate) =>
        (candidate.eventType === "InferenceConfirmed" ||
          candidate.eventType === "InferenceRejected") &&
        String(candidate.payload.suggestionId) ===
          String(event.payload.suggestionId),
    );
    return [
      {
        confirmationStatus:
          disposition?.eventType === "InferenceConfirmed"
            ? ("confirmed" as const)
            : disposition?.eventType === "InferenceRejected"
              ? ("rejected" as const)
              : ("proposed" as const),
        kind: event.payload.candidateKind,
        statement: event.payload.statement,
        suggestionId: event.payload.suggestionId,
      },
    ];
  });
}

async function privateSources(
  runtime: ServerRuntime,
  meetingScope: string,
  participantId: string,
  events: readonly DomainEvent[],
) {
  const registered = events.filter(
    (event) =>
      event.eventType === "ArtifactRegistered" &&
      event.visibility === "private" &&
      event.ownerParticipantId === participantId &&
      event.payload.artifact.artifactType === "text",
  );
  return Promise.all(
    registered.map(async (event) => {
      if (event.eventType !== "ArtifactRegistered") {
        throw new Error("Private source narrowing failed");
      }
      const bytes = await runtime.disclosures.artifacts.get({
        artifactId: event.payload.artifact.id,
        meetingId: meetingScope,
        ownerParticipantId: participantId,
        visibility: "private",
      });
      return bytes === undefined
        ? undefined
        : {
            createdAt: event.occurredAt,
            sourceArtifactId: event.payload.artifact.id,
            text: new TextDecoder().decode(bytes),
            title: "Registered private text source",
          };
    }),
  ).then((sources) =>
    sources.filter(
      (source): source is NonNullable<typeof source> => source !== undefined,
    ),
  );
}

function privateArtifacts(
  artifacts: readonly SourceArtifact[],
  events: readonly DomainEvent[],
) {
  return artifacts.flatMap((artifact) => {
    if (
      artifact.originalFilename === undefined ||
      artifact.contentType === undefined ||
      (artifact.processingState !== "processed" &&
        artifact.processingState !== "failed")
    ) {
      return [];
    }
    const processed = events.find(
      (
        event,
      ): event is Extract<
        DomainEvent,
        { readonly eventType: "ArtifactProcessed" }
      > =>
        event.eventType === "ArtifactProcessed" &&
        event.payload.artifactId === artifact.id,
    );
    return [
      {
        contentType: artifact.contentType,
        createdAt: artifact.createdAt,
        ...(artifact.derivedArtifactId === undefined
          ? {}
          : { derivedArtifactId: artifact.derivedArtifactId }),
        ...(artifact.derivedContentHash === undefined
          ? {}
          : { derivedContentHash: artifact.derivedContentHash }),
        ...(artifact.derivedSizeBytes === undefined
          ? {}
          : { derivedSizeBytes: artifact.derivedSizeBytes }),
        ...(processed?.payload.failureCode === undefined
          ? {}
          : { failureCode: processed.payload.failureCode }),
        filename: artifact.originalFilename,
        ingestionMethod:
          artifact.sourceLocatorHash === undefined ? "upload" : "url",
        processingState: artifact.processingState,
        sizeBytes: artifact.sizeBytes,
        sourceArtifactId: artifact.id,
        sourceContentHash: artifact.contentHash,
      },
    ];
  });
}

export async function roleProjectionFor(
  runtime: ServerRuntime,
  authorization: UserAuthorizationContext,
  correlationId: string,
  options: { readonly includePrivateSourceBodies?: boolean } = {},
): Promise<RoleProjectionResponse | undefined> {
  const meeting = await runtime.meetings.findById(authorization.meetingId);
  const assignment = await runtime.meetings.findAssignment(
    authorization.meetingId,
    authorization.userId,
  );
  if (
    meeting === undefined ||
    assignment === undefined ||
    !meeting.active ||
    !assignment.active
  ) {
    return undefined;
  }
  const records = await runtime.decisions.events.load(authorization.meetingId);
  const events = records.map(({ event, position }) => ({
    ...event,
    position: meetingPosition(position),
  }));
  const projection = replayMeeting(
    domainMeetingId(authorization.meetingId),
    events,
  );
  const lastResetIndex = events.findLastIndex(
    ({ eventType }) => eventType === "DemoResetCompleted",
  );
  const activePrivateEvents = events.slice(lastResetIndex + 1);
  const visiblePosition = events.filter((event) =>
    isVisibleTo(event, authorization.participantId),
  ).length;
  const assignments = await runtime.meetings.listAssignments(
    authorization.meetingId,
  );
  const sources =
    options.includePrivateSourceBodies === false
      ? []
      : await privateSources(
          runtime,
          authorization.meetingId,
          authorization.participantId,
          activePrivateEvents,
        );
  const privateWorkspace = projection.privateWorkspaces.find(
    ({ ownerParticipantId }) =>
      ownerParticipantId === authorization.participantId,
  );
  return RoleProjectionResponseSchema.parse({
    capabilities: [...authorization.capabilities],
    correlationId,
    meeting: {
      meetingId: meeting.meetingId,
      phase: projection.shared.meeting?.phase ?? "preparing",
      purpose: meeting.purpose,
    },
    participant: {
      participantId: assignment.participantId,
      role: assignment.role,
      userId: assignment.userId,
    },
    privateWorkspace: {
      artifacts: privateArtifacts(
        privateWorkspace?.artifacts ?? [],
        activePrivateEvents,
      ),
      disclosureCandidates: privateDisclosureCandidates(
        activePrivateEvents,
        authorization.participantId,
      ),
      inferenceSuggestions: privateInferenceSuggestions(
        activePrivateEvents,
        authorization.participantId,
      ),
      sources,
      utterances: (privateWorkspace?.utterances ?? []).map(utteranceView),
    },
    shared: {
      actions: projection.shared.actions.map(
        ({ id, ownerParticipantId, scope, status }) => ({
          actionId: id,
          ownerParticipantId,
          scope,
          status,
        }),
      ),
      decisions: projection.shared.decisions.map((decision) => {
        const revision = projection.shared.decisionRevisions.find(
          ({ id }) => id === decision.activeRevisionId,
        );
        return decisionView(
          decision,
          revision?.createdAt ?? decision.createdAt,
        );
      }),
      dissent: projection.shared.dissent.map(({ id, reason, retained }) => ({
        dissentId: id,
        reason,
        retained,
      })),
      evidence: projection.shared.evidence.map(
        ({ createdAt, exactSnippet, id, sourceArtifactId, sourceRange }) => ({
          createdAt,
          evidenceId: id,
          exactSnippet,
          sourceArtifactId,
          sourceRange,
        }),
      ),
      participants: assignments
        .filter(({ active }) => active)
        .map(({ active, participantId, role, userId }) => ({
          active,
          participantId,
          role,
          userId,
        })),
      position: visiblePosition,
      premises: projection.shared.premises.map(
        ({ confirmationStatus, id, statement }) => ({
          confirmationStatus,
          premiseId: id,
          statement,
        }),
      ),
      sharedFloor: projection.shared.sharedFloor ?? null,
      utterances: projection.shared.utterances.map(utteranceView),
    },
  });
}

export async function realtimeRoleProjectionFor(
  runtime: ServerRuntime,
  authorization: UserAuthorizationContext,
  correlationId: string,
): Promise<RealtimeRoleProjection | undefined> {
  const projection = await roleProjectionFor(
    runtime,
    authorization,
    correlationId,
    { includePrivateSourceBodies: false },
  );
  if (projection === undefined) {
    return undefined;
  }
  const records = await runtime.decisions.events.load(authorization.meetingId);
  const events = records.map(({ event, position }) => ({
    ...event,
    position: meetingPosition(position),
  }));
  const lastResetIndex = events.findLastIndex(
    ({ eventType }) => eventType === "DemoResetCompleted",
  );
  const sources = events.slice(lastResetIndex + 1).flatMap((event) =>
    event.eventType === "ArtifactRegistered" &&
    event.visibility === "private" &&
    event.ownerParticipantId === authorization.participantId &&
    event.payload.artifact.artifactType === "text"
      ? [
          {
            createdAt: event.occurredAt,
            processingState: event.payload.artifact.processingState,
            sizeBytes: event.payload.artifact.sizeBytes,
            sourceArtifactId: event.payload.artifact.id,
          },
        ]
      : [],
  );
  return RealtimeRoleProjectionSchema.parse({
    ...projection,
    privateWorkspace: {
      disclosureCandidates: projection.privateWorkspace.disclosureCandidates,
      inferenceSuggestions: projection.privateWorkspace.inferenceSuggestions,
      sources,
      utterances: projection.privateWorkspace.utterances,
    },
  });
}

export async function sharedDisplayProjectionFor(
  runtime: ServerRuntime,
  meetingScope: string,
  expiresAt: string,
  correlationId: string,
): Promise<SharedDisplayProjectionResponse | undefined> {
  const meeting = await runtime.meetings.findById(meetingScope);
  if (!meeting?.active) {
    return undefined;
  }
  const records = await runtime.decisions.events.load(meetingScope);
  const events = records.map(({ event, position }) => ({
    ...event,
    position: meetingPosition(position),
  }));
  const projection = replayMeeting(domainMeetingId(meetingScope), events);
  return SharedDisplayProjectionResponseSchema.parse({
    correlationId,
    expiresAt,
    meeting: {
      meetingId: meeting.meetingId,
      phase: projection.shared.meeting?.phase ?? "preparing",
      purpose: meeting.purpose,
    },
    shared: {
      actions: projection.shared.actions.map(
        ({ id, ownerParticipantId, scope, status }) => ({
          actionId: id,
          ownerParticipantId,
          scope,
          status,
        }),
      ),
      decisions: projection.shared.decisions.map((decision) => {
        const revision = projection.shared.decisionRevisions.find(
          ({ id }) => id === decision.activeRevisionId,
        );
        return decisionView(
          decision,
          revision?.createdAt ?? decision.createdAt,
        );
      }),
      dissent: projection.shared.dissent.map(({ id, reason, retained }) => ({
        dissentId: id,
        reason,
        retained,
      })),
      evidence: projection.shared.evidence.map(
        ({ createdAt, exactSnippet, id, sourceArtifactId, sourceRange }) => ({
          createdAt,
          evidenceId: id,
          exactSnippet,
          sourceArtifactId,
          sourceRange,
        }),
      ),
      position: events.filter(({ visibility }) => visibility === "shared")
        .length,
      premises: projection.shared.premises.map(
        ({ confirmationStatus, id, statement }) => ({
          confirmationStatus,
          premiseId: id,
          statement,
        }),
      ),
    },
  });
}
