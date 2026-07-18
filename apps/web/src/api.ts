import {
  ApproveDisclosureResponseSchema,
  ErrorEnvelopeSchema,
  JoinMeetingByCodeResponseSchema,
  ListAssignedMeetingsResponseSchema,
  ListSharedEvidenceResponseSchema,
  LoginResponseSchema,
  LogoutResponseSchema,
  PreviewDisclosureResponseSchema,
  ProposeDisclosureResponseSchema,
  RegisterPrivateTextSourceFixtureResponseSchema,
  RejectDisclosureResponseSchema,
  type AssignedMeeting,
  type ApproveDisclosureResponse,
  type LoginResponse,
  type ListSharedEvidenceResponse,
  type PreviewDisclosureResponse,
  type ProposeDisclosureResponse,
  type RegisterPrivateTextSourceFixtureResponse,
  type RejectDisclosureResponse,
  type TextRange,
} from "@counterpoint/protocol";

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
