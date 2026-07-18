import { z } from "zod";

import { CorrelationIdSchema, type MeetingId } from "./primitives.js";

export const ERROR_CODES = [
  "AUTHENTICATION_REQUIRED",
  "SESSION_EXPIRED",
  "FORBIDDEN",
  "MEETING_NOT_FOUND",
  "VALIDATION_FAILED",
  "CONFLICT",
  "IDEMPOTENCY_CONFLICT",
  "DISPLAY_TOKEN_EXPIRED",
  "API_KEY_REQUIRED",
  "JUDGE_MODE_FORBIDDEN",
  "USAGE_LIMIT_REACHED",
  "SHARED_FLOOR_BUSY",
  "ARTIFACT_STORAGE_UNAVAILABLE",
  "ARTIFACT_TOO_LARGE",
  "ARTIFACT_TYPE_UNSUPPORTED",
  "URL_BLOCKED",
  "DISCLOSURE_PREVIEW_MISMATCH",
  "OPENAI_UNAVAILABLE",
  "REALTIME_UNAVAILABLE",
  "WEBHOOK_SIGNATURE_INVALID",
  "INVALID_STATE_TRANSITION",
] as const;

export const ErrorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export interface ErrorCodeDefinition {
  readonly message: string;
  readonly retryable: boolean;
}

export const ERROR_CODE_REGISTRY = {
  AUTHENTICATION_REQUIRED: {
    message: "Authentication is required.",
    retryable: false,
  },
  SESSION_EXPIRED: {
    message: "Your session has expired. Sign in again.",
    retryable: false,
  },
  FORBIDDEN: {
    message: "You do not have permission to perform this action.",
    retryable: false,
  },
  MEETING_NOT_FOUND: {
    message: "The meeting was not found.",
    retryable: false,
  },
  VALIDATION_FAILED: {
    message: "The request is invalid.",
    retryable: false,
  },
  CONFLICT: {
    message: "The request conflicts with the current state.",
    retryable: false,
  },
  IDEMPOTENCY_CONFLICT: {
    message: "The idempotency key was already used for a different request.",
    retryable: false,
  },
  DISPLAY_TOKEN_EXPIRED: {
    message: "The display token has expired.",
    retryable: false,
  },
  API_KEY_REQUIRED: {
    message: "A meeting API key is required.",
    retryable: false,
  },
  JUDGE_MODE_FORBIDDEN: {
    message: "This action is unavailable in judge mode.",
    retryable: false,
  },
  USAGE_LIMIT_REACHED: {
    message: "The meeting usage limit has been reached.",
    retryable: false,
  },
  SHARED_FLOOR_BUSY: {
    message: "The shared floor is currently in use. Try again shortly.",
    retryable: true,
  },
  ARTIFACT_STORAGE_UNAVAILABLE: {
    message: "Artifact storage is temporarily unavailable.",
    retryable: true,
  },
  ARTIFACT_TOO_LARGE: {
    message: "The artifact is too large.",
    retryable: false,
  },
  ARTIFACT_TYPE_UNSUPPORTED: {
    message: "The artifact type is not supported.",
    retryable: false,
  },
  URL_BLOCKED: {
    message: "The URL is not allowed.",
    retryable: false,
  },
  DISCLOSURE_PREVIEW_MISMATCH: {
    message: "The disclosure preview has changed. Review it again.",
    retryable: false,
  },
  OPENAI_UNAVAILABLE: {
    message: "AI assistance is temporarily unavailable.",
    retryable: true,
  },
  REALTIME_UNAVAILABLE: {
    message: "Realtime updates are temporarily unavailable.",
    retryable: true,
  },
  WEBHOOK_SIGNATURE_INVALID: {
    message: "The webhook signature is invalid.",
    retryable: false,
  },
  INVALID_STATE_TRANSITION: {
    message: "The requested state transition is not allowed.",
    retryable: false,
  },
} as const satisfies Record<ErrorCode, ErrorCodeDefinition>;

export const REDACTED_VALUE = "[REDACTED]" as const;

const BLOCKED_DETAIL_KEY =
  /stack|authorization|cookie|password|passwd|secret|token|api.?key|private.*text|source.*text|raw.*prompt|model.*prompt|prompt/iu;
const MEETING_ID_KEY = /meeting(?:[_-]?ids?|Ids?)$/iu;
const BEARER_PATTERN = /\bBearer\s+[^\s,;]+/giu;
const OPENAI_KEY_PATTERN = /\bsk-[A-Za-z0-9_-]{8,}\b/gu;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu;
const NAMED_SECRET_PATTERN =
  /\b(?:api[_-]?key|password|passwd|secret|token)\s*[:=]\s*[^\s,;]+/giu;
const PRIVATE_TEXT_PATTERN =
  /\b(?:private(?:\s+source)?\s+text|raw(?:\s+model)?\s+prompt)\s*[:=]\s*[^\r\n]*/giu;
const STACK_LINE_PATTERN =
  /(?:^|\n)\s*at\s+(?:async\s+)?(?:[\w$.<>]+\s+)?\(?[^)\n]+:\d+:\d+\)?/gu;

export interface RedactionOptions {
  readonly allowedMeetingId?: MeetingId | string;
  readonly replacement?: string;
}

export function redactSensitiveText(
  text: string,
  replacement: string = REDACTED_VALUE,
): string {
  return text
    .replace(BEARER_PATTERN, replacement)
    .replace(OPENAI_KEY_PATTERN, replacement)
    .replace(JWT_PATTERN, replacement)
    .replace(NAMED_SECRET_PATTERN, replacement)
    .replace(PRIVATE_TEXT_PATTERN, replacement)
    .replace(STACK_LINE_PATTERN, `\n${replacement}`);
}

function shouldRedactMeetingId(
  value: unknown,
  allowedMeetingId: MeetingId | string | undefined,
): boolean {
  if (allowedMeetingId === undefined) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.some((item) => item !== allowedMeetingId);
  }
  return value !== allowedMeetingId;
}

/**
 * Converts unknown details into a JSON-safe, deeply redacted value. Cycles and
 * unsupported runtime values are replaced rather than leaked or thrown.
 */
export function redactErrorDetails(
  details: unknown,
  options: RedactionOptions = {},
): Record<string, unknown> {
  const replacement = options.replacement ?? REDACTED_VALUE;
  const seen = new WeakSet<object>();

  const visit = (value: unknown, key?: string): unknown => {
    if (key !== undefined && BLOCKED_DETAIL_KEY.test(key)) {
      return replacement;
    }

    if (
      key !== undefined &&
      MEETING_ID_KEY.test(key) &&
      shouldRedactMeetingId(value, options.allowedMeetingId)
    ) {
      return replacement;
    }

    if (typeof value === "string") {
      return redactSensitiveText(value, replacement);
    }

    if (
      value === null ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      return value;
    }

    if (typeof value === "bigint") {
      return value.toString();
    }

    if (
      typeof value === "undefined" ||
      typeof value === "function" ||
      typeof value === "symbol"
    ) {
      return replacement;
    }

    if (value instanceof Date) {
      return Number.isNaN(value.valueOf()) ? replacement : value.toISOString();
    }

    if (value instanceof Error) {
      return {
        name: redactSensitiveText(value.name, replacement),
        message: replacement,
      };
    }

    if (seen.has(value)) {
      return replacement;
    }
    seen.add(value);

    if (Array.isArray(value)) {
      return value.map((item) => visit(item));
    }

    return Object.fromEntries(
      Object.entries(value).map(([nestedKey, nestedValue]) => [
        nestedKey,
        visit(nestedValue, nestedKey),
      ]),
    );
  };

  const redacted = visit(details);
  if (
    typeof redacted !== "object" ||
    redacted === null ||
    Array.isArray(redacted)
  ) {
    return { value: redacted };
  }
  return redacted as Record<string, unknown>;
}

const ErrorDetailsSchema = z
  .record(z.string(), z.unknown())
  .transform((details) => redactErrorDetails(details));

export const ErrorEnvelopeSchema = z
  .strictObject({
    code: ErrorCodeSchema,
    message: z
      .string()
      .min(1)
      .transform((message) => redactSensitiveText(message)),
    correlationId: CorrelationIdSchema,
    retryable: z.boolean(),
    details: ErrorDetailsSchema,
  })
  .superRefine((envelope, context) => {
    if (envelope.retryable !== ERROR_CODE_REGISTRY[envelope.code].retryable) {
      context.addIssue({
        code: "custom",
        path: ["retryable"],
        message: `retryable must match the ${envelope.code} registry policy`,
      });
    }
  });

export const HttpErrorEnvelopeSchema = ErrorEnvelopeSchema;
export const RealtimeErrorEnvelopeSchema = ErrorEnvelopeSchema;
export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;
export type HttpErrorEnvelope = ErrorEnvelope;
export type RealtimeErrorEnvelope = ErrorEnvelope;

export function isRetryableErrorCode(code: ErrorCode): boolean {
  return ERROR_CODE_REGISTRY[code].retryable;
}

export interface CreateErrorEnvelopeInput {
  readonly code: ErrorCode;
  readonly correlationId: z.input<typeof CorrelationIdSchema>;
  readonly message?: string;
  readonly details?: unknown;
}

export function createErrorEnvelope(
  input: CreateErrorEnvelopeInput,
): ErrorEnvelope {
  const definition = ERROR_CODE_REGISTRY[input.code];

  return ErrorEnvelopeSchema.parse({
    code: input.code,
    message: redactSensitiveText(input.message ?? definition.message),
    correlationId: input.correlationId,
    retryable: definition.retryable,
    details: redactErrorDetails(input.details ?? {}),
  });
}
