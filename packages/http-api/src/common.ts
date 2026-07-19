import { createErrorEnvelope, type ErrorCode } from "@counterpoint/protocol";

export const HTTP_STATUS_BY_ERROR_CODE: Readonly<
  Record<ErrorCode, 400 | 401 | 403 | 404 | 409 | 429 | 500 | 503>
> = {
  API_KEY_REQUIRED: 400,
  ARTIFACT_STORAGE_UNAVAILABLE: 503,
  ARTIFACT_TOO_LARGE: 400,
  ARTIFACT_TYPE_UNSUPPORTED: 400,
  AUTHENTICATION_REQUIRED: 401,
  CONFLICT: 409,
  DISCLOSURE_PREVIEW_MISMATCH: 409,
  DISPLAY_TOKEN_EXPIRED: 401,
  FORBIDDEN: 403,
  IDEMPOTENCY_CONFLICT: 409,
  INVALID_STATE_TRANSITION: 409,
  JUDGE_MODE_FORBIDDEN: 403,
  MEETING_NOT_FOUND: 404,
  OPENAI_UNAVAILABLE: 503,
  REALTIME_UNAVAILABLE: 503,
  SESSION_EXPIRED: 401,
  SHARED_FLOOR_BUSY: 409,
  URL_BLOCKED: 400,
  USAGE_LIMIT_REACHED: 429,
  VALIDATION_FAILED: 400,
  WEBHOOK_SIGNATURE_INVALID: 403,
};

const JSON_HEADERS = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
} as const;

export function apiJsonResponse(
  body: unknown,
  status = 200,
  correlationId?: string,
): Response {
  return Response.json(body, {
    headers: {
      ...JSON_HEADERS,
      ...(correlationId === undefined
        ? {}
        : { "x-correlation-id": correlationId }),
    },
    status,
  });
}

export function apiErrorResponse(
  code: ErrorCode,
  correlationId: string,
  details: unknown = {},
): Response {
  return apiJsonResponse(
    createErrorEnvelope({ code, correlationId, details }),
    HTTP_STATUS_BY_ERROR_CODE[code],
    correlationId,
  );
}

export function parseBearerToken(request: Request): string | undefined {
  const matched = /^Bearer ([A-Za-z0-9_-]{16,4096})$/u.exec(
    request.headers.get("authorization") ?? "",
  );
  return matched?.[1];
}
