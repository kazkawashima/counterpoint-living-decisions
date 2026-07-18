import {
  ApproveDisclosureResponseSchema,
  CommitDecisionResponseSchema,
  DecisionAuditResponseSchema,
  DecisionHistoryResponseSchema,
  DispositionSharedDecisionCandidateResponseSchema,
  ErrorEnvelopeSchema,
  InjectDemoRegulatoryChangeResponseSchema,
  JoinMeetingByCodeResponseSchema,
  ListAssignedMeetingsResponseSchema,
  ListSharedDecisionsResponseSchema,
  ListSharedExternalEventsResponseSchema,
  ListSharedEvidenceResponseSchema,
  LoginResponseSchema,
  LogoutResponseSchema,
  MarkDecisionReadyResponseSchema,
  PreviewDisclosureResponseSchema,
  ProposeDisclosureResponseSchema,
  RegisterPrivateTextSourceFixtureResponseSchema,
  RejectDisclosureResponseSchema,
  SaveDecisionDraftResponseSchema,
  StartDecisionMonitoringResponseSchema,
  SynthesizeSharedDecisionResponseSchema,
  type AssignedMeeting,
  type ApproveDisclosureResponse,
  type CommitDecisionRequest,
  type CommitDecisionResponse,
  type DecisionAuditQuery,
  type DecisionAuditResponse,
  type DecisionHistoryQuery,
  type DecisionHistoryResponse,
  type DispositionSharedDecisionCandidateRequest,
  type DispositionSharedDecisionCandidateResponse,
  type LoginResponse,
  type InjectDemoRegulatoryChangeResponse,
  type ListSharedDecisionsResponse,
  type ListSharedExternalEventsResponse,
  type ListSharedEvidenceResponse,
  type MarkDecisionReadyRequest,
  type MarkDecisionReadyResponse,
  type PreviewDisclosureResponse,
  type ProposeDisclosureResponse,
  type RegisterPrivateTextSourceFixtureResponse,
  type RejectDisclosureResponse,
  type SaveDecisionDraftRequest,
  type SaveDecisionDraftResponse,
  type StartDecisionMonitoringResponse,
  type SynthesizeSharedDecisionRequest,
  type SynthesizeSharedDecisionResponse,
  type TextRange,
} from "@counterpoint/protocol";

export type {
  CommitDecisionRequest,
  CommitDecisionResponse,
  DecisionAuditQuery,
  DecisionAuditResponse,
  DecisionHistoryQuery,
  DecisionHistoryResponse,
  InjectDemoRegulatoryChangeResponse,
  DispositionSharedDecisionCandidateRequest,
  DispositionSharedDecisionCandidateResponse,
  MarkDecisionReadyRequest,
  MarkDecisionReadyResponse,
  SaveDecisionDraftRequest,
  SaveDecisionDraftResponse,
  StartDecisionMonitoringResponse,
  SynthesizeSharedDecisionRequest,
  SynthesizeSharedDecisionResponse,
};

interface MeetingMutationInput {
  readonly correlationId?: string;
  readonly expectedPosition: number;
  readonly idempotencyKey: string;
  readonly meetingId: string;
}

export interface ManualSharedDecisionDraftClientInput {
  readonly actions: readonly {
    readonly ownerParticipantId: string;
    readonly scope: readonly string[];
  }[];
  readonly dissent: readonly {
    readonly reason: string;
    readonly retained: boolean;
  }[];
  readonly monitorCondition: {
    readonly description: string;
  };
  readonly outcome: string;
  readonly premises: readonly {
    readonly evidenceReferenceIds: readonly string[];
    readonly statement: string;
  }[];
  readonly title: string;
}

export type SynthesizeSharedDecisionClientInput = MeetingMutationInput &
  (
    | {
        readonly assistance: "ai_preferred";
      }
    | {
        readonly assistance: "manual";
        readonly draft: ManualSharedDecisionDraftClientInput;
      }
  );

export interface DispositionSharedDecisionCandidateClientInput extends MeetingMutationInput {
  readonly actions: readonly {
    readonly ownerParticipantId: string;
    readonly scope: readonly string[];
  }[];
  readonly candidateId: string;
  readonly dissent: readonly {
    readonly reason: string;
    readonly retained: boolean;
  }[];
  readonly monitorCondition: {
    readonly description: string;
  };
  readonly outcome: string;
  readonly premiseDispositions: readonly (
    | {
        readonly candidateId: string;
        readonly disposition: "confirmed";
        readonly premise: {
          readonly evidenceReferenceIds: readonly string[];
          readonly statement: string;
        };
      }
    | {
        readonly candidateId: string;
        readonly disposition: "rejected";
        readonly reason?: string;
      }
  )[];
  readonly reason?: string;
  readonly title: string;
}

export interface SaveDecisionDraftClientInput extends MeetingMutationInput {
  readonly actionIds: readonly string[];
  readonly changeReason: string;
  readonly decisionId?: string;
  readonly dissentIds: readonly string[];
  readonly evidenceIds: readonly string[];
  readonly monitorCondition: {
    readonly description: string;
  };
  readonly outcome: string;
  readonly premiseIds: readonly string[];
  readonly title: string;
}

export interface DecisionLifecycleClientInput extends MeetingMutationInput {
  readonly decisionId: string;
}

export interface DecisionHistoryClientQuery {
  readonly decisionId: string;
  readonly meetingId: string;
}

export interface DecisionAuditClientQuery {
  readonly decisionId?: string;
  readonly meetingId: string;
}

const SESSION_KEY = "counterpoint.session";

export interface StoredSession {
  readonly bearerToken: string;
  readonly expiresAt: string;
  readonly userId: string;
}

export class ApiError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
  }
}

export function loadStoredSession(): StoredSession | undefined {
  const serialized = window.sessionStorage.getItem(SESSION_KEY);
  if (serialized === null) {
    return undefined;
  }
  try {
    const value = JSON.parse(serialized) as Partial<StoredSession>;
    if (
      typeof value.bearerToken === "string" &&
      typeof value.expiresAt === "string" &&
      typeof value.userId === "string"
    ) {
      return {
        bearerToken: value.bearerToken,
        expiresAt: value.expiresAt,
        userId: value.userId,
      };
    }
  } catch {
    // A malformed tab-scoped value is treated as signed out.
  }
  window.sessionStorage.removeItem(SESSION_KEY);
  return undefined;
}

export function storeSession(session: LoginResponse): StoredSession {
  const stored = {
    bearerToken: session.bearerToken,
    expiresAt: session.expiresAt,
    userId: session.userId,
  };
  window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(stored));
  return stored;
}

export function clearStoredSession(): void {
  window.sessionStorage.removeItem(SESSION_KEY);
}

async function responseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new ApiError(
      "INVALID_RESPONSE",
      "The server response was unreadable.",
    );
  }
}

async function request(
  path: string,
  options: RequestInit = {},
  session?: StoredSession,
): Promise<unknown> {
  const headers = new Headers(options.headers);
  if (options.body !== undefined) {
    headers.set("content-type", "application/json");
  }
  if (session !== undefined) {
    headers.set("authorization", `Bearer ${session.bearerToken}`);
  }
  const response = await fetch(path, {
    ...options,
    headers,
  });
  const body = await responseJson(response);
  if (!response.ok) {
    const error = ErrorEnvelopeSchema.safeParse(body);
    if (error.success) {
      throw new ApiError(error.data.code, error.data.message);
    }
    throw new ApiError("REQUEST_FAILED", "The request could not be completed.");
  }
  return body;
}

export async function login(
  userId: string,
  password: string,
): Promise<LoginResponse> {
  const body = await request("/api/v1/login", {
    body: JSON.stringify({ password, userId }),
    method: "POST",
  });
  return LoginResponseSchema.parse(body);
}

export async function listMeetings(
  session: StoredSession,
  signal?: AbortSignal,
): Promise<readonly AssignedMeeting[]> {
  const body = await request(
    "/api/v1/meetings",
    signal === undefined ? {} : { signal },
    session,
  );
  return ListAssignedMeetingsResponseSchema.parse(body).meetings;
}

export async function listSharedEvidence(
  session: StoredSession,
  meetingId: string,
  signal?: AbortSignal,
): Promise<ListSharedEvidenceResponse> {
  const body = await request(
    `/api/v1/meetings/${encodeURIComponent(meetingId)}/evidence`,
    signal === undefined ? {} : { signal },
    session,
  );
  return ListSharedEvidenceResponseSchema.parse(body);
}

export async function listSharedDecisions(
  session: StoredSession,
  meetingId: string,
  signal?: AbortSignal,
): Promise<ListSharedDecisionsResponse> {
  const body = await request(
    `/api/v1/meetings/${encodeURIComponent(meetingId)}/decisions`,
    signal === undefined ? {} : { signal },
    session,
  );
  return ListSharedDecisionsResponseSchema.parse(body);
}

export async function listSharedExternalEvents(
  session: StoredSession,
  meetingId: string,
  signal?: AbortSignal,
): Promise<ListSharedExternalEventsResponse> {
  const body = await request(
    `/api/v1/meetings/${encodeURIComponent(meetingId)}/external-events`,
    signal === undefined ? {} : { signal },
    session,
  );
  return ListSharedExternalEventsResponseSchema.parse(body);
}

export async function joinMeeting(
  session: StoredSession,
  code: string,
): Promise<AssignedMeeting> {
  const body = await request(
    "/api/v1/meetings/join",
    {
      body: JSON.stringify({
        code,
        idempotencyKey: crypto.randomUUID(),
      }),
      method: "POST",
    },
    session,
  );
  return JoinMeetingByCodeResponseSchema.parse(body).meeting;
}

export async function logout(session: StoredSession): Promise<void> {
  const body = await request(
    "/api/v1/logout",
    {
      body: "{}",
      method: "POST",
    },
    session,
  );
  LogoutResponseSchema.parse(body);
}

export async function registerPrivateTextSource(
  session: StoredSession,
  input: {
    readonly expectedPosition: number;
    readonly idempotencyKey: string;
    readonly meetingId: string;
    readonly text: string;
    readonly title: string;
  },
): Promise<RegisterPrivateTextSourceFixtureResponse> {
  const body = await request(
    "/api/v1/disclosures/sources/text",
    {
      body: JSON.stringify({
        ...input,
      }),
      method: "POST",
    },
    session,
  );
  return RegisterPrivateTextSourceFixtureResponseSchema.parse(body);
}

export async function proposeDisclosure(
  session: StoredSession,
  input: {
    readonly assistance: "ai_preferred" | "manual";
    readonly exactSnippet: string;
    readonly expectedPosition: number;
    readonly idempotencyKey: string;
    readonly meetingId: string;
    readonly sourceArtifactId: string;
    readonly sourceRange: TextRange;
  },
): Promise<ProposeDisclosureResponse> {
  const body = await request(
    "/api/v1/disclosures/proposals",
    {
      body: JSON.stringify({
        ...input,
      }),
      method: "POST",
    },
    session,
  );
  return ProposeDisclosureResponseSchema.parse(body);
}

export async function previewDisclosure(
  session: StoredSession,
  input: {
    readonly candidateId: string;
    readonly exactSnippet: string;
    readonly expectedPosition: number;
    readonly idempotencyKey: string;
    readonly meetingId: string;
    readonly sourceRange: TextRange;
  },
): Promise<PreviewDisclosureResponse> {
  const body = await request(
    "/api/v1/disclosures/preview",
    {
      body: JSON.stringify({
        ...input,
      }),
      method: "POST",
    },
    session,
  );
  return PreviewDisclosureResponseSchema.parse(body);
}

export async function approveDisclosure(
  session: StoredSession,
  input: {
    readonly candidateId: string;
    readonly expectedPosition: number;
    readonly idempotencyKey: string;
    readonly meetingId: string;
    readonly previewHash: string;
  },
): Promise<ApproveDisclosureResponse> {
  const body = await request(
    "/api/v1/disclosures/approve",
    {
      body: JSON.stringify({
        ...input,
      }),
      method: "POST",
    },
    session,
  );
  return ApproveDisclosureResponseSchema.parse(body);
}

export async function rejectDisclosure(
  session: StoredSession,
  input: {
    readonly candidateId: string;
    readonly expectedPosition: number;
    readonly idempotencyKey: string;
    readonly meetingId: string;
    readonly reason?: string;
  },
): Promise<RejectDisclosureResponse> {
  const body = await request(
    "/api/v1/disclosures/reject",
    {
      body: JSON.stringify({
        ...input,
      }),
      method: "POST",
    },
    session,
  );
  return RejectDisclosureResponseSchema.parse(body);
}

export async function synthesizeSharedDecisionCandidate(
  session: StoredSession,
  input: SynthesizeSharedDecisionClientInput,
): Promise<SynthesizeSharedDecisionResponse> {
  const body = await request(
    "/api/v1/decisions/candidates",
    {
      body: JSON.stringify(input),
      method: "POST",
    },
    session,
  );
  return SynthesizeSharedDecisionResponseSchema.parse(body);
}

export async function dispositionSharedDecisionCandidate(
  session: StoredSession,
  input: DispositionSharedDecisionCandidateClientInput,
): Promise<DispositionSharedDecisionCandidateResponse> {
  const body = await request(
    "/api/v1/decisions/candidates/disposition",
    {
      body: JSON.stringify(input),
      method: "POST",
    },
    session,
  );
  return DispositionSharedDecisionCandidateResponseSchema.parse(body);
}

export async function saveDecisionDraft(
  session: StoredSession,
  input: SaveDecisionDraftClientInput,
): Promise<SaveDecisionDraftResponse> {
  const body = await request(
    "/api/v1/decisions/drafts",
    {
      body: JSON.stringify(input),
      method: "POST",
    },
    session,
  );
  return SaveDecisionDraftResponseSchema.parse(body);
}

export async function markDecisionReady(
  session: StoredSession,
  input: DecisionLifecycleClientInput,
): Promise<MarkDecisionReadyResponse> {
  const body = await request(
    "/api/v1/decisions/ready",
    {
      body: JSON.stringify(input),
      method: "POST",
    },
    session,
  );
  return MarkDecisionReadyResponseSchema.parse(body);
}

export async function commitDecision(
  session: StoredSession,
  input: DecisionLifecycleClientInput,
): Promise<CommitDecisionResponse> {
  const body = await request(
    "/api/v1/decisions/commit",
    {
      body: JSON.stringify(input),
      method: "POST",
    },
    session,
  );
  return CommitDecisionResponseSchema.parse(body);
}

export async function startDecisionMonitoring(
  session: StoredSession,
  input: DecisionLifecycleClientInput,
): Promise<StartDecisionMonitoringResponse> {
  const body = await request(
    "/api/v1/decisions/monitoring",
    {
      body: JSON.stringify(input),
      method: "POST",
    },
    session,
  );
  return StartDecisionMonitoringResponseSchema.parse(body);
}

export async function injectDemoRegulatoryChange(
  session: StoredSession,
  input: {
    readonly idempotencyKey: string;
    readonly meetingId: string;
  },
): Promise<InjectDemoRegulatoryChangeResponse> {
  const body = await request(
    `/api/v1/meetings/${encodeURIComponent(input.meetingId)}/demo/regulatory-changes`,
    {
      body: JSON.stringify({ idempotencyKey: input.idempotencyKey }),
      method: "POST",
    },
    session,
  );
  return InjectDemoRegulatoryChangeResponseSchema.parse(body);
}

export async function getDecisionHistory(
  session: StoredSession,
  query: DecisionHistoryClientQuery,
  signal?: AbortSignal,
): Promise<DecisionHistoryResponse> {
  const body = await request(
    `/api/v1/meetings/${encodeURIComponent(query.meetingId)}/decisions/${encodeURIComponent(query.decisionId)}/history`,
    signal === undefined ? {} : { signal },
    session,
  );
  return DecisionHistoryResponseSchema.parse(body);
}

export async function getDecisionAudit(
  session: StoredSession,
  query: DecisionAuditClientQuery,
  signal?: AbortSignal,
): Promise<DecisionAuditResponse> {
  const search = new URLSearchParams();
  if (query.decisionId !== undefined) {
    search.set("decisionId", query.decisionId);
  }
  const suffix = search.size === 0 ? "" : `?${search.toString()}`;
  const body = await request(
    `/api/v1/meetings/${encodeURIComponent(query.meetingId)}/decisions/audit${suffix}`,
    signal === undefined ? {} : { signal },
    session,
  );
  return DecisionAuditResponseSchema.parse(body);
}
