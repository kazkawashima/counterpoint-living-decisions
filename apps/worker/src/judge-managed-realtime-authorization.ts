import type {
  ManagedRealtimeCallOwner,
  ManagedRealtimeCallOwnership,
} from "@counterpoint/adapters-cloudflare";
import {
  authenticateSession,
  resolveMeetingAuthorization,
  type UserAuthorizationContext,
  type UserAuthorizationPolicy,
} from "@counterpoint/application";
import { parseBearerToken } from "@counterpoint/http-api";
import type {
  Clock,
  MeetingRepository,
  SessionRepository,
  SessionTokenIssuer,
} from "@counterpoint/ports";
import type { ErrorCode } from "@counterpoint/protocol";

interface ManagedRealtimeCallOwnershipReader {
  findActiveOwned(
    owner: ManagedRealtimeCallOwner,
    nowEpoch: number,
  ): Promise<ManagedRealtimeCallOwnership | undefined>;
}

export interface JudgeManagedAuthorizationDependencies {
  readonly authorizationPolicy?: UserAuthorizationPolicy;
  readonly clock: Clock;
  readonly meetings: MeetingRepository;
  readonly sessions: SessionRepository;
  readonly tokens: SessionTokenIssuer;
}

export type JudgeManagedAuthorizationResult =
  | {
      readonly authorization: UserAuthorizationContext;
      readonly kind: "authorized";
    }
  | {
      readonly code: ErrorCode;
      readonly kind: "rejected";
    };

export type OwnedJudgeManagedCallResult =
  | {
      readonly authorization: UserAuthorizationContext;
      readonly kind: "authorized";
      readonly ownership: ManagedRealtimeCallOwnership;
    }
  | {
      readonly code: ErrorCode;
      readonly kind: "rejected";
    };

export async function resolveJudgeManagedAuthorization(input: {
  readonly dependencies: JudgeManagedAuthorizationDependencies;
  readonly meetingId: string;
  readonly request: Request;
}): Promise<JudgeManagedAuthorizationResult> {
  const bearerToken = parseBearerToken(input.request);
  if (bearerToken === undefined) {
    return { code: "AUTHENTICATION_REQUIRED", kind: "rejected" };
  }

  try {
    const authenticated = await authenticateSession(
      input.dependencies,
      bearerToken,
    );
    if (authenticated.kind === "rejected") {
      return authenticated;
    }
    const resolved = await resolveMeetingAuthorization(
      input.dependencies.meetings,
      authenticated.session,
      input.meetingId,
      input.dependencies.authorizationPolicy,
    );
    if (resolved.kind === "rejected") {
      return resolved;
    }
    if (!resolved.authorization.capabilities.has("judge:managed-ai")) {
      return { code: "JUDGE_MODE_FORBIDDEN", kind: "rejected" };
    }
    return {
      authorization: resolved.authorization,
      kind: "authorized",
    };
  } catch {
    return { code: "REALTIME_UNAVAILABLE", kind: "rejected" };
  }
}

export async function resolveOwnedJudgeManagedCall(input: {
  readonly dependencies: JudgeManagedAuthorizationDependencies;
  readonly managedCallId: string;
  readonly meetingId: string;
  readonly ownerships: ManagedRealtimeCallOwnershipReader;
  readonly request: Request;
}): Promise<OwnedJudgeManagedCallResult> {
  const resolved = await resolveJudgeManagedAuthorization(input);
  if (resolved.kind === "rejected") {
    return resolved;
  }
  const nowMilliseconds = Date.parse(input.dependencies.clock.now());
  if (!Number.isFinite(nowMilliseconds) || nowMilliseconds < 0) {
    return { code: "REALTIME_UNAVAILABLE", kind: "rejected" };
  }

  try {
    const ownership = await input.ownerships.findActiveOwned(
      {
        managedCallId: input.managedCallId,
        meetingId: resolved.authorization.meetingId,
        participantId: resolved.authorization.participantId,
        sessionId: resolved.authorization.sessionId,
        userId: resolved.authorization.userId,
      },
      Math.floor(nowMilliseconds / 1_000),
    );
    if (ownership === undefined) {
      return { code: "FORBIDDEN", kind: "rejected" };
    }
    return {
      authorization: resolved.authorization,
      kind: "authorized",
      ownership,
    };
  } catch {
    return { code: "REALTIME_UNAVAILABLE", kind: "rejected" };
  }
}
