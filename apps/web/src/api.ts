import {
  ErrorEnvelopeSchema,
  JoinMeetingByCodeResponseSchema,
  ListAssignedMeetingsResponseSchema,
  LoginResponseSchema,
  LogoutResponseSchema,
  type AssignedMeeting,
  type LoginResponse,
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
