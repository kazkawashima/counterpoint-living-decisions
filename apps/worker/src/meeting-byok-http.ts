import {
  authenticateSession,
  clearMeetingByok,
  configureMeetingByok,
  heartbeatMeetingByok,
  resolveMeetingAuthorization,
  type UserAuthorizationPolicy,
} from "@counterpoint/application";
import type {
  Clock,
  MeetingApiKeyLeaseStore,
  MeetingRepository,
  SessionRepository,
  SessionTokenIssuer,
} from "@counterpoint/ports";
import {
  ClearMeetingByokRequestSchema,
  ClearMeetingByokResponseSchema,
  ConfigureMeetingByokRequestSchema,
  ConfigureMeetingByokResponseSchema,
  HeartbeatMeetingByokRequestSchema,
  HeartbeatMeetingByokResponseSchema,
} from "@counterpoint/protocol";
import {
  apiErrorResponse,
  apiJsonResponse,
  parseBearerToken,
} from "@counterpoint/http-api";

export interface MeetingByokHttpDependencies {
  readonly authorizationPolicy?: UserAuthorizationPolicy;
  readonly clock: Clock;
  readonly leases: MeetingApiKeyLeaseStore;
  readonly meetings: MeetingRepository;
  readonly sessions: SessionRepository;
  readonly tokens: SessionTokenIssuer;
}

export async function handleMeetingByokHttp(input: {
  readonly correlationId: string;
  readonly dependencies: MeetingByokHttpDependencies;
  readonly meetingId: string;
  readonly operation: "clear" | "configure" | "heartbeat";
  readonly request: Request;
}): Promise<Response> {
  let body: unknown;
  try {
    body = await input.request.json();
  } catch {
    return apiErrorResponse("VALIDATION_FAILED", input.correlationId);
  }

  const schema =
    input.operation === "configure"
      ? ConfigureMeetingByokRequestSchema
      : input.operation === "heartbeat"
        ? HeartbeatMeetingByokRequestSchema
        : ClearMeetingByokRequestSchema;
  const parsed = schema.safeParse(body);
  if (!parsed.success || parsed.data.meetingId !== input.meetingId) {
    return apiErrorResponse("VALIDATION_FAILED", input.correlationId);
  }

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
      parsed.data.meetingId,
      input.dependencies.authorizationPolicy,
    );
    if (resolved.kind === "rejected") {
      return apiErrorResponse(resolved.code, input.correlationId);
    }

    if (input.operation === "configure") {
      const configured = ConfigureMeetingByokRequestSchema.parse(parsed.data);
      const result = await configureMeetingByok(
        { clock: input.dependencies.clock, leases: input.dependencies.leases },
        resolved.authorization,
        configured,
      );
      if (result.kind === "failed") {
        return apiErrorResponse(result.code, input.correlationId);
      }
      return apiJsonResponse(
        ConfigureMeetingByokResponseSchema.parse({
          configured: true,
          correlationId: input.correlationId,
          keySource: "byok",
          meetingId: result.meetingId,
        }),
        201,
        input.correlationId,
      );
    }

    if (input.operation === "heartbeat") {
      const result = await heartbeatMeetingByok(
        { clock: input.dependencies.clock, leases: input.dependencies.leases },
        resolved.authorization,
        parsed.data,
      );
      if (result.kind === "failed") {
        return apiErrorResponse(result.code, input.correlationId);
      }
      return apiJsonResponse(
        HeartbeatMeetingByokResponseSchema.parse({
          active: true,
          correlationId: input.correlationId,
          meetingId: result.meetingId,
        }),
        200,
        input.correlationId,
      );
    }

    const result = await clearMeetingByok(
      { clock: input.dependencies.clock, leases: input.dependencies.leases },
      resolved.authorization,
      parsed.data,
    );
    if (result.kind === "failed") {
      return apiErrorResponse(result.code, input.correlationId);
    }
    return apiJsonResponse(
      ClearMeetingByokResponseSchema.parse({
        cleared: true,
        correlationId: input.correlationId,
        meetingId: result.meetingId,
      }),
      200,
      input.correlationId,
    );
  } catch {
    return apiErrorResponse("REALTIME_UNAVAILABLE", input.correlationId);
  }
}
