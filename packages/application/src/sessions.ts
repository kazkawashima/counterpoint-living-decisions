import type {
  Clock,
  IdentityRepository,
  IdGenerator,
  PasswordVerifier,
  SessionRecord,
  SessionRepository,
  SessionTokenIssuer,
} from "@counterpoint/ports";

import type {
  AuthorizationContext,
  Capability,
  UserAuthorizationContext,
} from "./authorization.js";

export const SESSION_INACTIVITY_MS = 2 * 60 * 60 * 1_000;
export const SESSION_ABSOLUTE_MS = 8 * 60 * 60 * 1_000;

export interface SessionDependencies {
  readonly clock: Clock;
  readonly identities: IdentityRepository;
  readonly ids: IdGenerator;
  readonly passwords: PasswordVerifier;
  readonly sessions: SessionRepository;
  readonly tokens: SessionTokenIssuer;
}

export type LoginResult =
  | {
      readonly bearerToken: string;
      readonly expiresAt: string;
      readonly kind: "authenticated";
      readonly userId: string;
    }
  | {
      readonly code: "AUTHENTICATION_REQUIRED";
      readonly kind: "rejected";
    };

export type SessionAuthenticationResult =
  | {
      readonly kind: "authenticated";
      readonly session: SessionRecord;
    }
  | {
      readonly code: "AUTHENTICATION_REQUIRED" | "SESSION_EXPIRED";
      readonly kind: "rejected";
    };

function timestampMs(value: string): number {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) {
    throw new Error("Clock returned a non-ISO timestamp");
  }
  return milliseconds;
}

function isoTimestamp(milliseconds: number): string {
  return new Date(milliseconds).toISOString();
}

type SessionAuthenticationDependencies = Pick<
  SessionDependencies,
  "clock" | "sessions"
>;

async function authenticateStoredSession(
  dependencies: SessionAuthenticationDependencies,
  session: SessionRecord | undefined,
  options: { readonly touchActivity: boolean },
): Promise<SessionAuthenticationResult> {
  if (session === undefined || session.revokedAt !== undefined) {
    return {
      code: "AUTHENTICATION_REQUIRED",
      kind: "rejected",
    };
  }

  const now = dependencies.clock.now();
  const nowMs = timestampMs(now);
  const expired =
    nowMs >= timestampMs(session.absoluteExpiresAt) ||
    nowMs - timestampMs(session.lastActivityAt) >= SESSION_INACTIVITY_MS;
  if (expired) {
    await dependencies.sessions.revoke(session.sessionId, now);
    return {
      code: "SESSION_EXPIRED",
      kind: "rejected",
    };
  }

  if (options.touchActivity) {
    await dependencies.sessions.touch(session.sessionId, now);
  }
  return {
    kind: "authenticated",
    session: {
      ...session,
      lastActivityAt: options.touchActivity ? now : session.lastActivityAt,
    },
  };
}

export async function login(
  dependencies: SessionDependencies,
  input: {
    readonly password: string;
    readonly userId: string;
  },
): Promise<LoginResult> {
  const identity = await dependencies.identities.findByUserId(input.userId);
  if (
    identity === undefined ||
    !identity.active ||
    !(await dependencies.passwords.verify(
      input.password,
      identity.passwordHash,
    ))
  ) {
    return {
      code: "AUTHENTICATION_REQUIRED",
      kind: "rejected",
    };
  }

  const now = dependencies.clock.now();
  const nowMs = timestampMs(now);
  const token = await dependencies.tokens.issue();
  const session: SessionRecord = {
    absoluteExpiresAt: isoTimestamp(nowMs + SESSION_ABSOLUTE_MS),
    createdAt: now,
    lastActivityAt: now,
    sessionId: dependencies.ids.next("session"),
    tokenHash: token.hash,
    userId: identity.userId,
  };
  await dependencies.sessions.put(session);

  return {
    bearerToken: token.value,
    expiresAt: session.absoluteExpiresAt,
    kind: "authenticated",
    userId: session.userId,
  };
}

export async function authenticateSession(
  dependencies: Pick<SessionDependencies, "clock" | "sessions" | "tokens">,
  bearerToken: string,
): Promise<SessionAuthenticationResult> {
  if (bearerToken.length === 0) {
    return {
      code: "AUTHENTICATION_REQUIRED",
      kind: "rejected",
    };
  }

  const tokenHash = await dependencies.tokens.digest(bearerToken);
  const session = await dependencies.sessions.findByTokenHash(tokenHash);
  return authenticateStoredSession(dependencies, session, {
    touchActivity: true,
  });
}

export async function authenticateSessionById(
  dependencies: SessionAuthenticationDependencies,
  sessionId: string,
  options: { readonly touchActivity?: boolean } = {},
): Promise<SessionAuthenticationResult> {
  if (sessionId.length === 0) {
    return {
      code: "AUTHENTICATION_REQUIRED",
      kind: "rejected",
    };
  }

  const session = await dependencies.sessions.findById(sessionId);
  return authenticateStoredSession(dependencies, session, {
    touchActivity: options.touchActivity ?? true,
  });
}

export async function logout(
  dependencies: Pick<SessionDependencies, "clock" | "sessions" | "tokens">,
  bearerToken: string,
): Promise<void> {
  const tokenHash = await dependencies.tokens.digest(bearerToken);
  const session = await dependencies.sessions.findByTokenHash(tokenHash);
  if (session !== undefined && session.revokedAt === undefined) {
    await dependencies.sessions.revoke(
      session.sessionId,
      dependencies.clock.now(),
    );
  }
}

export function capabilitiesForRole(
  role: "facilitator" | "participant",
): ReadonlySet<Capability> {
  const shared: readonly Capability[] = [
    "meeting:read",
    "private:read-own",
    "artifact:create-own",
    "disclosure:propose-own",
    "disclosure:approve-own",
  ];

  return new Set(
    role === "facilitator"
      ? [
          ...shared,
          "decision:commit",
          "decision:review-confirm",
          "demo:event-inject",
          "demo:reset",
          "byok:configure",
        ]
      : shared,
  );
}

export function userAuthorizationContext(input: {
  readonly meetingId: string;
  readonly participantId: string;
  readonly role: "facilitator" | "participant";
  readonly sessionId: string;
  readonly userId: string;
}): UserAuthorizationContext {
  return {
    ...input,
    capabilities: capabilitiesForRole(input.role),
    kind: "user",
  };
}

export function isUserAuthorizationContext(
  context: AuthorizationContext,
): context is UserAuthorizationContext {
  return context.kind === "user";
}
