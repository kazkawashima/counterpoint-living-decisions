import {
  authenticateSession,
  resolveMeetingAuthorization,
  resolveRealtimeAccess,
  type ResolveRealtimeAccessDependencies,
  type UserAuthorizationPolicy,
} from "@counterpoint/application";
import type {
  Clock,
  MeetingRepository,
  SessionRepository,
  SessionTokenIssuer,
} from "@counterpoint/ports";
import { RealtimeAccessResponseSchema } from "@counterpoint/protocol";

import {
  apiErrorResponse,
  apiJsonResponse,
  parseBearerToken,
} from "./common.js";

export interface RealtimeAccessHttpDependencies {
  readonly authorizationPolicy?: UserAuthorizationPolicy;
  readonly clock: Clock;
  readonly meetings: MeetingRepository;
  readonly realtimeAccess: ResolveRealtimeAccessDependencies;
  readonly sessions: SessionRepository;
  readonly tokens: SessionTokenIssuer;
}

export async function handleRealtimeAccessHttp(input: {
  readonly correlationId: string;
  readonly dependencies: RealtimeAccessHttpDependencies;
  readonly meetingId: string;
  readonly request: Request;
}): Promise<Response> {
  const bearerToken = parseBearerToken(input.request);
  if (bearerToken === undefined) {
    return apiErrorResponse("AUTHENTICATION_REQUIRED", input.correlationId);
  }

  try {
    const authenticated = await authenticateSession(
      {
        clock: input.dependencies.clock,
        sessions: input.dependencies.sessions,
        tokens: input.dependencies.tokens,
      },
      bearerToken,
    );
    if (authenticated.kind === "rejected") {
      return apiErrorResponse(authenticated.code, input.correlationId);
    }
    const resolved = await resolveMeetingAuthorization(
      input.dependencies.meetings,
      authenticated.session,
      input.meetingId,
      input.dependencies.authorizationPolicy,
    );
    if (resolved.kind === "rejected") {
      return apiErrorResponse(resolved.code, input.correlationId);
    }
    const access = await resolveRealtimeAccess(
      input.dependencies.realtimeAccess,
      resolved.authorization,
      { meetingId: input.meetingId },
    );
    if (access.kind === "failed") {
      return apiErrorResponse(access.code, input.correlationId);
    }
    return apiJsonResponse(
      RealtimeAccessResponseSchema.parse({
        correlationId: input.correlationId,
        mode: access.mode,
      }),
      200,
      input.correlationId,
    );
  } catch {
    return apiErrorResponse("REALTIME_UNAVAILABLE", input.correlationId);
  }
}
