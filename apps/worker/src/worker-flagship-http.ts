import {
  authenticateSession,
  listAssignedMeetings,
  login,
  logout,
  resolveMeetingAuthorization,
  type UserAuthorizationContext,
  type UserAuthorizationPolicy,
} from "@counterpoint/application";
import {
  domainEventTypes,
  meetingId as domainMeetingId,
  meetingPosition,
  replayMeeting,
  type DomainEvent,
} from "@counterpoint/domain";
import {
  D1EventStore,
  D1IdentityRepository,
  D1MeetingRepository,
  D1SessionRepository,
  ScryptPasswordVerifier,
  WebCryptoSessionTokenIssuer,
  createJsonCodec,
} from "@counterpoint/adapters-cloudflare";
import {
  apiErrorResponse,
  apiJsonResponse,
  parseBearerToken,
} from "@counterpoint/http-api";
import type {
  Clock,
  EventStore,
  IdGenerator,
  IdentityRepository,
  MeetingRepository,
  PasswordVerifier,
  SessionRepository,
  SessionTokenIssuer,
} from "@counterpoint/ports";
import {
  GetRoleProjectionResponseSchema,
  ListAssignedMeetingsResponseSchema,
  LoginRequestSchema,
  LoginResponseSchema,
  LogoutRequestSchema,
  LogoutResponseSchema,
  RoleProjectionQuerySchema,
} from "@counterpoint/protocol";

export interface WorkerFlagshipHttpDependencies {
  readonly clock: Clock;
  readonly events: EventStore<DomainEvent>;
  readonly identities: IdentityRepository;
  readonly ids: IdGenerator;
  readonly meetings: MeetingRepository;
  readonly passwords: PasswordVerifier;
  readonly sessions: SessionRepository;
  readonly tokens: SessionTokenIssuer;
  readonly authorizationPolicy?: UserAuthorizationPolicy;
}

export interface WorkerFlagshipD1Bindings {
  readonly DB: D1Database;
}

export type WorkerFlagshipOperation =
  "login" | "logout" | "meetings" | "projection";

const domainEventTypeSet = new Set<string>(domainEventTypes);

function parseStoredDomainEvent(input: unknown): DomainEvent {
  if (
    typeof input !== "object" ||
    input === null ||
    !("eventType" in input) ||
    typeof input.eventType !== "string" ||
    !domainEventTypeSet.has(input.eventType) ||
    !("eventId" in input) ||
    typeof input.eventId !== "string" ||
    !("meetingId" in input) ||
    typeof input.meetingId !== "string" ||
    !("position" in input) ||
    typeof input.position !== "number" ||
    !("schemaVersion" in input) ||
    typeof input.schemaVersion !== "number" ||
    !("visibility" in input) ||
    (input.visibility !== "private" && input.visibility !== "shared") ||
    !("payload" in input) ||
    typeof input.payload !== "object" ||
    input.payload === null
  ) {
    throw new TypeError("Stored domain event is invalid");
  }
  if (
    (input.visibility === "private" &&
      (!("ownerParticipantId" in input) ||
        typeof input.ownerParticipantId !== "string")) ||
    (input.visibility === "shared" && "ownerParticipantId" in input)
  ) {
    throw new TypeError("Stored domain event visibility scope is invalid");
  }
  return input as DomainEvent;
}

function nowClock(): Clock {
  return { now: () => new Date().toISOString() };
}

function randomIds(): IdGenerator {
  return { next: (namespace) => `${namespace}-${crypto.randomUUID()}` };
}

export function createWorkerFlagshipDependencies(
  bindings: WorkerFlagshipD1Bindings,
): WorkerFlagshipHttpDependencies {
  return {
    clock: nowClock(),
    events: new D1EventStore(
      bindings.DB,
      createJsonCodec(parseStoredDomainEvent),
    ),
    identities: new D1IdentityRepository(bindings.DB),
    ids: randomIds(),
    meetings: new D1MeetingRepository(bindings.DB),
    passwords: new ScryptPasswordVerifier(),
    sessions: new D1SessionRepository(bindings.DB),
    tokens: new WebCryptoSessionTokenIssuer(),
  };
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

function publicCapabilities(
  capabilities: ReadonlySet<string>,
): readonly string[] {
  return [...capabilities].filter(
    (capability) => capability !== "judge:managed-ai",
  );
}

async function authenticatedSession(
  request: Request,
  dependencies: WorkerFlagshipHttpDependencies,
) {
  const bearerToken = parseBearerToken(request);
  if (bearerToken === undefined) {
    return {
      code: "AUTHENTICATION_REQUIRED" as const,
      kind: "rejected" as const,
    };
  }
  const result = await authenticateSession(dependencies, bearerToken);
  return result.kind === "rejected"
    ? result
    : { bearerToken, kind: "authenticated" as const, session: result.session };
}

function visiblePosition(
  events: readonly DomainEvent[],
  participantId: string,
): number {
  return events.filter(
    (event) =>
      event.visibility === "shared" ||
      event.ownerParticipantId === participantId,
  ).length;
}

function utteranceView(utterance: {
  readonly capturedAt: string;
  readonly channel: "private" | "shared";
  readonly id: string;
  readonly participantId: string;
  readonly text: string;
}) {
  return {
    capturedAt: utterance.capturedAt,
    channel: utterance.channel,
    participantId: utterance.participantId,
    text: utterance.text,
    utteranceId: utterance.id,
  };
}

async function assignedMeeting(
  dependencies: WorkerFlagshipHttpDependencies,
  meetingId: string,
  userId: string,
) {
  const [meeting, assignment, records] = await Promise.all([
    dependencies.meetings.findById(meetingId),
    dependencies.meetings.findAssignment(meetingId, userId),
    dependencies.events.load(meetingId),
  ]);
  if (meeting?.active !== true || assignment?.active !== true) {
    return undefined;
  }
  const events = records.map(({ event, position }) => ({
    ...event,
    position: meetingPosition(position),
  }));
  const projection = replayMeeting(domainMeetingId(meetingId), events);
  return {
    meetingId,
    participantId: assignment.participantId,
    phase: projection.shared.meeting?.phase ?? "preparing",
    position: visiblePosition(events, assignment.participantId),
    purpose: meeting.purpose,
    role: assignment.role,
  };
}

async function roleProjection(
  dependencies: WorkerFlagshipHttpDependencies,
  authorization: UserAuthorizationContext,
  correlationId: string,
) {
  const meeting = await dependencies.meetings.findById(authorization.meetingId);
  const assignment = await dependencies.meetings.findAssignment(
    authorization.meetingId,
    authorization.userId,
  );
  if (meeting?.active !== true || assignment?.active !== true) {
    return undefined;
  }
  const [records, assignments] = await Promise.all([
    dependencies.events.load(authorization.meetingId),
    dependencies.meetings.listAssignments(authorization.meetingId),
  ]);
  const events = records.map(({ event, position }) => ({
    ...event,
    position: meetingPosition(position),
  }));
  const projection = replayMeeting(
    domainMeetingId(authorization.meetingId),
    events,
  );
  const privateWorkspace = projection.privateWorkspaces.find(
    ({ ownerParticipantId }) =>
      ownerParticipantId === authorization.participantId,
  );

  return GetRoleProjectionResponseSchema.parse({
    capabilities: publicCapabilities(authorization.capabilities),
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
      artifacts: [],
      disclosureCandidates: [],
      inferenceSuggestions: [],
      sources: [],
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
        return {
          activeRevision: decision.activeRevision,
          activeRevisionId: decision.activeRevisionId,
          decisionId: decision.id,
          readiness: {
            actionIds: decision.actionIds.length > 0,
            evidenceIds: decision.evidenceIds.length > 0,
            monitorCondition: decision.monitorCondition.description.length > 0,
            outcome: decision.outcome.length > 0,
            premiseIds: decision.premiseIds.length > 0,
          },
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
          updatedAt: revision?.createdAt ?? decision.createdAt,
        };
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
      position: visiblePosition(events, authorization.participantId),
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

export async function handleWorkerFlagshipHttp(input: {
  readonly correlationId: string;
  readonly dependencies: WorkerFlagshipHttpDependencies;
  readonly meetingId?: string;
  readonly operation: WorkerFlagshipOperation;
  readonly request: Request;
}): Promise<Response> {
  const { correlationId, dependencies, meetingId, operation, request } = input;

  if (operation === "login") {
    const parsed = LoginRequestSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      return apiErrorResponse("VALIDATION_FAILED", correlationId);
    }
    const result = await login(dependencies, parsed.data);
    if (result.kind === "rejected") {
      return apiErrorResponse(result.code, correlationId);
    }
    return apiJsonResponse(
      LoginResponseSchema.parse({
        bearerToken: result.bearerToken,
        correlationId,
        expiresAt: result.expiresAt,
        userId: result.userId,
      }),
      200,
      correlationId,
    );
  }

  const authenticated = await authenticatedSession(request, dependencies);
  if (authenticated.kind === "rejected") {
    return apiErrorResponse(authenticated.code, correlationId);
  }

  if (operation === "logout") {
    const parsed = LogoutRequestSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      return apiErrorResponse("VALIDATION_FAILED", correlationId);
    }
    await logout(dependencies, authenticated.bearerToken);
    return apiJsonResponse(
      LogoutResponseSchema.parse({
        correlationId,
        loggedOutAt: dependencies.clock.now(),
      }),
      200,
      correlationId,
    );
  }

  if (operation === "meetings") {
    const assigned = await listAssignedMeetings(
      dependencies.meetings,
      authenticated.session.userId,
    );
    const meetings = await Promise.all(
      assigned.map(({ meetingId: assignedMeetingId }) =>
        assignedMeeting(
          dependencies,
          assignedMeetingId,
          authenticated.session.userId,
        ),
      ),
    );
    return apiJsonResponse(
      ListAssignedMeetingsResponseSchema.parse({
        correlationId,
        meetings: meetings.filter(
          (meeting): meeting is NonNullable<typeof meeting> =>
            meeting !== undefined,
        ),
      }),
      200,
      correlationId,
    );
  }

  if (meetingId === undefined) {
    return apiErrorResponse("VALIDATION_FAILED", correlationId);
  }
  const query = RoleProjectionQuerySchema.safeParse({ meetingId });
  if (!query.success) {
    return apiErrorResponse("VALIDATION_FAILED", correlationId);
  }
  const resolved = await resolveMeetingAuthorization(
    dependencies.meetings,
    authenticated.session,
    query.data.meetingId,
    dependencies.authorizationPolicy,
  );
  if (resolved.kind === "rejected") {
    return apiErrorResponse(resolved.code, correlationId);
  }
  const projection = await roleProjection(
    dependencies,
    resolved.authorization,
    correlationId,
  );
  return projection === undefined
    ? apiErrorResponse("FORBIDDEN", correlationId)
    : apiJsonResponse(projection, 200, correlationId);
}
