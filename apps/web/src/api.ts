import {
  AcquireSharedFloorRequestSchema,
  AcquireSharedFloorResponseSchema,
  ApproveDisclosureResponseSchema,
  AwaitManagedRealtimeTranscriptResponseSchema,
  BeginManagedRealtimeTurnResponseSchema,
  CaptureUtteranceRequestSchema,
  CaptureUtteranceResponseSchema,
  ClearMeetingByokResponseSchema,
  CommitDecisionResponseSchema,
  ConfigureMeetingByokResponseSchema,
  CreateManagedRealtimeCallResponseSchema,
  DecisionAuditResponseSchema,
  DecisionHistoryResponseSchema,
  DecisionJsonExportResponseSchema,
  DispositionSharedDecisionCandidateResponseSchema,
  ErrorEnvelopeSchema,
  FacilitatorDemoResetResponseSchema,
  GetRoleProjectionRequestSchema,
  GetRoleProjectionResponseSchema,
  HeartbeatMeetingByokResponseSchema,
  InjectDemoRegulatoryChangeResponseSchema,
  IssueDisplayTokenResponseSchema,
  IssueRealtimeClientSecretResponseSchema,
  JoinMeetingByCodeResponseSchema,
  ListAssignedMeetingsResponseSchema,
  ListInvalidationEvaluationsResponseSchema,
  ListSharedDecisionsResponseSchema,
  ListSharedExternalEventsResponseSchema,
  ListSharedEvidenceResponseSchema,
  LoginResponseSchema,
  LogoutResponseSchema,
  MarkDecisionReadyResponseSchema,
  PreviewDisclosureResponseSchema,
  ProposeDisclosureResponseSchema,
  RegisterPrivateUrlArtifactResponseSchema,
  RegisterPrivateTextSourceFixtureResponseSchema,
  RejectDisclosureResponseSchema,
  RealtimeAccessResponseSchema,
  ReleaseSharedFloorRequestSchema,
  ReleaseSharedFloorResponseSchema,
  ResolveDecisionReviewResponseSchema,
  RevokeDisplayTokenResponseSchema,
  ReviewInvalidationResponseSchema,
  SaveDecisionDraftResponseSchema,
  StartDecisionMonitoringResponseSchema,
  SharedDisplayProjectionResponseSchema,
  SynthesizeSharedDecisionResponseSchema,
  TerminateManagedRealtimeCallResponseSchema,
  UploadPrivateArtifactResponseSchema,
  type AcquireSharedFloorRequest,
  type AcquireSharedFloorResponse,
  type AssignedMeeting,
  type ApproveDisclosureResponse,
  type AwaitManagedRealtimeTranscriptResponse,
  type BeginManagedRealtimeTurnResponse,
  type CaptureUtteranceRequest,
  type CaptureUtteranceResponse,
  type ClearMeetingByokResponse,
  type CommitDecisionRequest,
  type CommitDecisionResponse,
  type ConfigureMeetingByokResponse,
  type CreateManagedRealtimeCallResponse,
  type DecisionAuditQuery,
  type DecisionAuditResponse,
  type DecisionHistoryQuery,
  type DecisionHistoryResponse,
  type DecisionJsonExportResponse,
  type DispositionSharedDecisionCandidateRequest,
  type DispositionSharedDecisionCandidateResponse,
  type FacilitatorDemoResetResponse,
  type GetRoleProjectionRequest,
  type GetRoleProjectionResponse,
  type HeartbeatMeetingByokResponse,
  type LoginResponse,
  type InjectDemoRegulatoryChangeResponse,
  type IssueDisplayTokenResponse,
  type IssueRealtimeClientSecretResponse,
  type ListSharedDecisionsResponse,
  type ListSharedExternalEventsResponse,
  type ListSharedEvidenceResponse,
  type ListInvalidationEvaluationsResponse,
  type MarkDecisionReadyRequest,
  type MarkDecisionReadyResponse,
  type PreviewDisclosureResponse,
  type ProposeDisclosureResponse,
  type RegisterPrivateUrlArtifactResponse,
  type RegisterPrivateTextSourceFixtureResponse,
  type RejectDisclosureResponse,
  type RealtimeAccessResponse,
  type ReleaseSharedFloorRequest,
  type ReleaseSharedFloorResponse,
  type ReviewInvalidationRequest,
  type ReviewInvalidationResponse,
  type ResolveDecisionReviewResponse,
  type RevokeDisplayTokenResponse,
  type SaveDecisionDraftRequest,
  type SaveDecisionDraftResponse,
  type StartDecisionMonitoringResponse,
  type SharedDisplayProjectionResponse,
  type SynthesizeSharedDecisionRequest,
  type SynthesizeSharedDecisionResponse,
  type TerminateManagedRealtimeCallResponse,
  type TextRange,
  type UtteranceChannel,
  type UploadPrivateArtifactResponse,
} from "@counterpoint/protocol";

export type {
  AcquireSharedFloorRequest,
  AcquireSharedFloorResponse,
  CaptureUtteranceRequest,
  CaptureUtteranceResponse,
  ClearMeetingByokResponse,
  CommitDecisionRequest,
  CommitDecisionResponse,
  ConfigureMeetingByokResponse,
  DecisionAuditQuery,
  DecisionAuditResponse,
  DecisionHistoryQuery,
  DecisionHistoryResponse,
  DecisionJsonExportResponse,
  FacilitatorDemoResetResponse,
  GetRoleProjectionRequest,
  GetRoleProjectionResponse,
  HeartbeatMeetingByokResponse,
  InjectDemoRegulatoryChangeResponse,
  IssueDisplayTokenResponse,
  IssueRealtimeClientSecretResponse,
  RealtimeAccessResponse,
  ListInvalidationEvaluationsResponse,
  DispositionSharedDecisionCandidateRequest,
  DispositionSharedDecisionCandidateResponse,
  MarkDecisionReadyRequest,
  MarkDecisionReadyResponse,
  ReviewInvalidationRequest,
  ReviewInvalidationResponse,
  ResolveDecisionReviewResponse,
  ReleaseSharedFloorRequest,
  ReleaseSharedFloorResponse,
  RevokeDisplayTokenResponse,
  SaveDecisionDraftRequest,
  SaveDecisionDraftResponse,
  StartDecisionMonitoringResponse,
  SharedDisplayProjectionResponse,
  SynthesizeSharedDecisionRequest,
  SynthesizeSharedDecisionResponse,
  TerminateManagedRealtimeCallResponse,
  UploadPrivateArtifactResponse,
};

interface MeetingMutationInput {
  readonly correlationId?: string;
  readonly expectedPosition: number;
  readonly idempotencyKey: string;
  readonly meetingId: string;
}

export interface ReviewInvalidationClientInput extends MeetingMutationInput {
  readonly decisionId: string;
  readonly disposition: "confirm_invalidation" | "reject_suggestion";
  readonly reason: string;
  readonly suggestionId: string;
}

export type ResolveDecisionReviewClientInput = MeetingMutationInput &
  (
    | {
        readonly changeReason: string;
        readonly decisionId: string;
        readonly monitorCondition: { readonly description: string };
        readonly outcome: string;
        readonly resolution: "recommit_revision";
        readonly title: string;
      }
    | {
        readonly decisionId: string;
        readonly replacementDecisionId: string;
        readonly resolution: "supersede_decision";
      }
    | {
        readonly decisionId: string;
        readonly reason: string;
        readonly resolution: "reject_decision";
      }
  );

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

export interface GetRoleProjectionClientInput {
  readonly correlationId?: string;
  readonly meetingId: string;
}

export interface AcquireSharedFloorClientInput {
  readonly correlationId?: string;
  readonly meetingId: string;
  readonly utteranceId: string;
}

export interface ReleaseSharedFloorClientInput {
  readonly meetingId: string;
  readonly utteranceId: string;
}

export interface CaptureUtteranceClientInput {
  readonly capturedAt: string;
  readonly channel: UtteranceChannel;
  readonly meetingId: string;
  readonly text: string;
  readonly utteranceId: string;
}

const SESSION_KEY = "counterpoint.session";
const MEETING_BYOK_KEY_PREFIX = "counterpoint.byok.";

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

export function loadStoredMeetingByok(meetingId: string): string | undefined {
  const apiKey = window.sessionStorage.getItem(
    `${MEETING_BYOK_KEY_PREFIX}${meetingId}`,
  );
  return apiKey === null || apiKey.length === 0 ? undefined : apiKey;
}

export function storeMeetingByok(meetingId: string, apiKey: string): void {
  window.sessionStorage.setItem(
    `${MEETING_BYOK_KEY_PREFIX}${meetingId}`,
    apiKey,
  );
}

export function clearStoredMeetingByok(meetingId: string): void {
  window.sessionStorage.removeItem(`${MEETING_BYOK_KEY_PREFIX}${meetingId}`);
}

export function clearAllStoredMeetingByok(): void {
  const keys = Array.from(
    { length: window.sessionStorage.length },
    (_, index) => window.sessionStorage.key(index),
  );
  for (const key of keys) {
    if (key?.startsWith(MEETING_BYOK_KEY_PREFIX) === true) {
      window.sessionStorage.removeItem(key);
    }
  }
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
  if (options.body !== undefined && !(options.body instanceof FormData)) {
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

export async function uploadPrivateArtifact(
  session: StoredSession,
  input: {
    readonly file: File;
    readonly idempotencyKey: string;
    readonly meetingId: string;
  },
): Promise<UploadPrivateArtifactResponse> {
  const form = new FormData();
  form.set("meetingId", input.meetingId);
  form.set("idempotencyKey", input.idempotencyKey);
  form.set("file", input.file);
  const body = await request(
    "/api/v1/artifacts",
    {
      body: form,
      method: "POST",
    },
    session,
  );
  return UploadPrivateArtifactResponseSchema.parse(body);
}

export async function registerPrivateUrlArtifact(
  session: StoredSession,
  input: {
    readonly idempotencyKey: string;
    readonly meetingId: string;
    readonly url: string;
  },
): Promise<RegisterPrivateUrlArtifactResponse> {
  const body = await request(
    "/api/v1/artifacts/url",
    {
      body: JSON.stringify(input),
      method: "POST",
    },
    session,
  );
  return RegisterPrivateUrlArtifactResponseSchema.parse(body);
}

export async function downloadPrivateArtifact(
  session: StoredSession,
  input: {
    readonly artifactId: string;
    readonly meetingId: string;
    readonly representation: "derived" | "source";
  },
): Promise<{ readonly blob: Blob; readonly filename: string }> {
  const search = new URLSearchParams({
    representation: input.representation,
  });
  const response = await fetch(
    `/api/v1/meetings/${encodeURIComponent(input.meetingId)}/artifacts/${encodeURIComponent(input.artifactId)}?${search.toString()}`,
    {
      headers: {
        authorization: `Bearer ${session.bearerToken}`,
      },
    },
  );
  if (!response.ok) {
    const body = await responseJson(response);
    const error = ErrorEnvelopeSchema.safeParse(body);
    throw error.success
      ? new ApiError(error.data.code, error.data.message)
      : new ApiError("REQUEST_FAILED", "The artifact could not be downloaded.");
  }
  const disposition = response.headers.get("content-disposition") ?? "";
  const encodedFilename = /filename\*=UTF-8''([^;]+)/iu.exec(disposition)?.[1];
  return {
    blob: await response.blob(),
    filename:
      encodedFilename === undefined
        ? "artifact"
        : decodeURIComponent(encodedFilename),
  };
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

export async function listInvalidationEvaluations(
  session: StoredSession,
  meetingId: string,
  signal?: AbortSignal,
): Promise<ListInvalidationEvaluationsResponse> {
  const body = await request(
    `/api/v1/meetings/${encodeURIComponent(meetingId)}/invalidation-evaluations`,
    signal === undefined ? {} : { signal },
    session,
  );
  return ListInvalidationEvaluationsResponseSchema.parse(body);
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

export async function configureMeetingByok(
  session: StoredSession,
  meetingId: string,
  apiKey: string,
): Promise<ConfigureMeetingByokResponse> {
  const body = await request(
    `/api/v1/meetings/${encodeURIComponent(meetingId)}/byok`,
    {
      body: JSON.stringify({ apiKey, meetingId }),
      method: "PUT",
    },
    session,
  );
  return ConfigureMeetingByokResponseSchema.parse(body);
}

export async function heartbeatMeetingByok(
  session: StoredSession,
  meetingId: string,
): Promise<HeartbeatMeetingByokResponse> {
  const body = await request(
    `/api/v1/meetings/${encodeURIComponent(meetingId)}/byok/heartbeat`,
    {
      body: JSON.stringify({ meetingId }),
      method: "POST",
    },
    session,
  );
  return HeartbeatMeetingByokResponseSchema.parse(body);
}

export async function clearMeetingByok(
  session: StoredSession,
  meetingId: string,
): Promise<ClearMeetingByokResponse> {
  const body = await request(
    `/api/v1/meetings/${encodeURIComponent(meetingId)}/byok`,
    {
      body: JSON.stringify({ meetingId }),
      method: "DELETE",
    },
    session,
  );
  return ClearMeetingByokResponseSchema.parse(body);
}

export async function issueRealtimeClientSecret(
  session: StoredSession,
  meetingId: string,
  channel: "private" | "shared",
): Promise<IssueRealtimeClientSecretResponse> {
  const body = await request(
    `/api/v1/meetings/${encodeURIComponent(meetingId)}/realtime/client-secrets`,
    {
      body: JSON.stringify({ channel, meetingId }),
      method: "POST",
    },
    session,
  );
  return IssueRealtimeClientSecretResponseSchema.parse(body);
}

export async function getRealtimeAccess(
  session: StoredSession,
  meetingId: string,
): Promise<RealtimeAccessResponse> {
  const body = await request(
    `/api/v1/meetings/${encodeURIComponent(meetingId)}/realtime/access`,
    {},
    session,
  );
  return RealtimeAccessResponseSchema.parse(body);
}

export async function createManagedRealtimeCall(
  session: StoredSession,
  input: {
    readonly channel: "private" | "shared";
    readonly idempotencyKey: string;
    readonly meetingId: string;
    readonly sdpOffer: string;
  },
): Promise<CreateManagedRealtimeCallResponse> {
  const body = await request(
    `/api/v1/meetings/${encodeURIComponent(input.meetingId)}/realtime/calls`,
    {
      body: JSON.stringify(input),
      method: "POST",
    },
    session,
  );
  return CreateManagedRealtimeCallResponseSchema.parse(body);
}

export async function beginManagedRealtimeTurn(
  session: StoredSession,
  input: {
    readonly managedCallId: string;
    readonly meetingId: string;
    readonly utteranceId: string;
  },
): Promise<BeginManagedRealtimeTurnResponse> {
  const body = await request(
    `/api/v1/meetings/${encodeURIComponent(input.meetingId)}/realtime/calls/${encodeURIComponent(input.managedCallId)}/turn`,
    {
      body: JSON.stringify(input),
      method: "POST",
    },
    session,
  );
  return BeginManagedRealtimeTurnResponseSchema.parse(body);
}

export async function awaitManagedRealtimeTranscript(
  session: StoredSession,
  input: {
    readonly managedCallId: string;
    readonly meetingId: string;
    readonly utteranceId: string;
  },
): Promise<AwaitManagedRealtimeTranscriptResponse> {
  const body = await request(
    `/api/v1/meetings/${encodeURIComponent(input.meetingId)}/realtime/calls/${encodeURIComponent(input.managedCallId)}/transcript`,
    {
      body: JSON.stringify(input),
      method: "POST",
    },
    session,
  );
  return AwaitManagedRealtimeTranscriptResponseSchema.parse(body);
}

export async function terminateManagedRealtimeCall(
  session: StoredSession,
  input: {
    readonly managedCallId: string;
    readonly meetingId: string;
  },
): Promise<TerminateManagedRealtimeCallResponse> {
  const body = await request(
    `/api/v1/meetings/${encodeURIComponent(input.meetingId)}/realtime/calls/${encodeURIComponent(input.managedCallId)}/terminate`,
    {
      body: JSON.stringify(input),
      method: "POST",
    },
    session,
  );
  return TerminateManagedRealtimeCallResponseSchema.parse(body);
}

export async function getRoleProjection(
  session: StoredSession,
  input: GetRoleProjectionClientInput,
  signal?: AbortSignal,
): Promise<GetRoleProjectionResponse> {
  const requestInput: GetRoleProjectionRequest =
    GetRoleProjectionRequestSchema.parse(input);
  const body = await request(
    `/api/v1/meetings/${encodeURIComponent(requestInput.meetingId)}/projection`,
    signal === undefined ? {} : { signal },
    session,
  );
  return GetRoleProjectionResponseSchema.parse(body);
}

export async function acquireSharedFloor(
  session: StoredSession,
  input: AcquireSharedFloorClientInput,
): Promise<AcquireSharedFloorResponse> {
  const requestInput: AcquireSharedFloorRequest =
    AcquireSharedFloorRequestSchema.parse(input);
  const body = await request(
    `/api/v1/meetings/${encodeURIComponent(requestInput.meetingId)}/realtime/shared-floor`,
    {
      body: JSON.stringify(requestInput),
      method: "POST",
    },
    session,
  );
  return AcquireSharedFloorResponseSchema.parse(body);
}

export async function releaseSharedFloor(
  session: StoredSession,
  input: ReleaseSharedFloorClientInput,
): Promise<ReleaseSharedFloorResponse> {
  const requestInput: ReleaseSharedFloorRequest =
    ReleaseSharedFloorRequestSchema.parse(input);
  const body = await request(
    `/api/v1/meetings/${encodeURIComponent(requestInput.meetingId)}/realtime/shared-floor`,
    {
      body: JSON.stringify(requestInput),
      method: "DELETE",
    },
    session,
  );
  return ReleaseSharedFloorResponseSchema.parse(body);
}

export async function captureUtterance(
  session: StoredSession,
  input: CaptureUtteranceClientInput,
): Promise<CaptureUtteranceResponse> {
  const requestInput: CaptureUtteranceRequest =
    CaptureUtteranceRequestSchema.parse(input);
  const body = await request(
    `/api/v1/meetings/${encodeURIComponent(requestInput.meetingId)}/utterances`,
    {
      body: JSON.stringify(requestInput),
      method: "POST",
    },
    session,
  );
  return CaptureUtteranceResponseSchema.parse(body);
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

export async function reviewInvalidation(
  session: StoredSession,
  input: ReviewInvalidationClientInput,
): Promise<ReviewInvalidationResponse> {
  const body = await request(
    "/api/v1/decisions/invalidation-review",
    {
      body: JSON.stringify(input),
      method: "POST",
    },
    session,
  );
  return ReviewInvalidationResponseSchema.parse(body);
}

export async function resolveDecisionReview(
  session: StoredSession,
  input: ResolveDecisionReviewClientInput,
): Promise<ResolveDecisionReviewResponse> {
  const body = await request(
    "/api/v1/decisions/review-resolution",
    {
      body: JSON.stringify(input),
      method: "POST",
    },
    session,
  );
  return ResolveDecisionReviewResponseSchema.parse(body);
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

export async function resetDemoMeeting(
  session: StoredSession,
  input: MeetingMutationInput,
): Promise<FacilitatorDemoResetResponse> {
  const body = await request(
    `/api/v1/meetings/${encodeURIComponent(input.meetingId)}/demo/reset`,
    {
      body: JSON.stringify(input),
      method: "POST",
    },
    session,
  );
  return FacilitatorDemoResetResponseSchema.parse(body);
}

export async function issueDisplayToken(
  session: StoredSession,
  input: {
    readonly expectedPosition: number;
    readonly meetingId: string;
  },
): Promise<IssueDisplayTokenResponse> {
  const body = await request(
    `/api/v1/meetings/${encodeURIComponent(input.meetingId)}/display-tokens`,
    {
      body: JSON.stringify(input),
      method: "POST",
    },
    session,
  );
  return IssueDisplayTokenResponseSchema.parse(body);
}

export async function revokeDisplayToken(
  session: StoredSession,
  input: {
    readonly displayTokenId: string;
    readonly expectedPosition: number;
    readonly meetingId: string;
  },
): Promise<RevokeDisplayTokenResponse> {
  const body = await request(
    `/api/v1/meetings/${encodeURIComponent(input.meetingId)}/display-tokens/revoke`,
    {
      body: JSON.stringify(input),
      method: "POST",
    },
    session,
  );
  return RevokeDisplayTokenResponseSchema.parse(body);
}

export async function getSharedDisplayProjection(
  meetingId: string,
  displayToken: string,
  signal?: AbortSignal,
): Promise<SharedDisplayProjectionResponse> {
  const body = await request(
    `/api/v1/meetings/${encodeURIComponent(meetingId)}/display?token=${encodeURIComponent(displayToken)}`,
    signal === undefined ? {} : { signal },
  );
  return SharedDisplayProjectionResponseSchema.parse(body);
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

export async function exportDecisionJson(
  session: StoredSession,
  query: DecisionHistoryClientQuery,
  signal?: AbortSignal,
): Promise<DecisionJsonExportResponse> {
  const body = await request(
    `/api/v1/meetings/${encodeURIComponent(query.meetingId)}/decisions/${encodeURIComponent(query.decisionId)}/export`,
    signal === undefined ? {} : { signal },
    session,
  );
  return DecisionJsonExportResponseSchema.parse(body);
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
