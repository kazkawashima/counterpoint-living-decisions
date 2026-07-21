import {
  authenticateSession,
  issueRealtimeClientSecret,
  resolveMeetingAuthorization,
  type RealtimeSecretDependencies,
  type UserAuthorizationPolicy,
} from "@counterpoint/application";
import type {
  Clock,
  ManagedRealtimeSecretIssuer,
  MeetingRepository,
  SessionRepository,
  SessionTokenIssuer,
} from "@counterpoint/ports";
import {
  IssueRealtimeClientSecretRequestSchema,
  IssueRealtimeClientSecretResponseSchema,
} from "@counterpoint/protocol";

import {
  apiErrorResponse,
  apiJsonResponse,
  parseBearerToken,
} from "./common.js";

export interface IssueRealtimeClientSecretHttpDependencies {
  readonly authorizationPolicy?: UserAuthorizationPolicy;
  readonly clock: Clock;
  readonly judgeByokIssuerFactory?: (
    apiKey: string,
  ) => ManagedRealtimeSecretIssuer | undefined;
  readonly judgeManagedIssuerFactory?: () =>
    ManagedRealtimeSecretIssuer | undefined;
  readonly meetings: MeetingRepository;
  readonly realtimeSecrets: RealtimeSecretDependencies;
  readonly sessions: SessionRepository;
  readonly tokens: SessionTokenIssuer;
}

export async function handleIssueRealtimeClientSecretHttp(input: {
  readonly correlationId: string;
  readonly dependencies: IssueRealtimeClientSecretHttpDependencies;
  readonly meetingId: string;
  readonly request: Request;
}): Promise<Response> {
  let body: unknown;
  try {
    body = await input.request.json();
  } catch {
    return apiErrorResponse("VALIDATION_FAILED", input.correlationId);
  }
  const parsed = IssueRealtimeClientSecretRequestSchema.safeParse(body);
  if (!parsed.success || parsed.data.meetingId !== input.meetingId) {
    return apiErrorResponse("VALIDATION_FAILED", input.correlationId);
  }

  const bearerToken = parseBearerToken(input.request);
  if (bearerToken === undefined) {
    return apiErrorResponse("AUTHENTICATION_REQUIRED", input.correlationId);
  }
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
  const isJudge = resolved.authorization.capabilities.has("judge:managed-ai");
  if (parsed.data.apiKey !== undefined && !isJudge) {
    return apiErrorResponse("VALIDATION_FAILED", input.correlationId);
  }
  if (
    parsed.data.apiKey !== undefined &&
    input.dependencies.judgeByokIssuerFactory === undefined
  ) {
    return apiErrorResponse("REALTIME_UNAVAILABLE", input.correlationId);
  }
  let requestJudgeByokIssuer: ManagedRealtimeSecretIssuer | undefined;
  if (parsed.data.apiKey !== undefined) {
    try {
      requestJudgeByokIssuer =
        input.dependencies.judgeByokIssuerFactory?.(parsed.data.apiKey) ??
        undefined;
    } catch {
      requestJudgeByokIssuer = undefined;
    }
    if (requestJudgeByokIssuer === undefined) {
      return apiErrorResponse("REALTIME_UNAVAILABLE", input.correlationId);
    }
  }
  let requestManagedIssuer: ManagedRealtimeSecretIssuer | undefined;
  if (
    isJudge &&
    requestJudgeByokIssuer === undefined &&
    input.dependencies.judgeManagedIssuerFactory !== undefined
  ) {
    try {
      requestManagedIssuer =
        input.dependencies.judgeManagedIssuerFactory() ?? undefined;
    } catch {
      requestManagedIssuer = undefined;
    }
  }
  const result = await issueRealtimeClientSecret(
    requestManagedIssuer === undefined
      ? requestJudgeByokIssuer === undefined
        ? input.dependencies.realtimeSecrets
        : {
            ...input.dependencies.realtimeSecrets,
            judgeByokIssuer: requestJudgeByokIssuer,
          }
      : {
          ...input.dependencies.realtimeSecrets,
          judgeManagedIssuer: requestManagedIssuer,
        },
    resolved.authorization,
    parsed.data,
  );
  if (result.kind === "failed") {
    return apiErrorResponse(result.code, input.correlationId);
  }
  return apiJsonResponse(
    IssueRealtimeClientSecretResponseSchema.parse({
      channel: result.channel,
      clientSecret: result.clientSecret,
      correlationId: input.correlationId,
      expiresAt: result.expiresAt,
      keySource: result.keySource,
      meetingId: result.meetingId,
      model: result.model,
    }),
    201,
    input.correlationId,
  );
}
