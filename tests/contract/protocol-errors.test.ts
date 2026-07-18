import { describe, expect, it } from "vitest";

import {
  ERROR_CODES,
  ERROR_CODE_REGISTRY,
  ErrorEnvelopeSchema,
  HttpErrorEnvelopeSchema,
  REDACTED_VALUE,
  RealtimeErrorEnvelopeSchema,
  createErrorEnvelope,
  isRetryableErrorCode,
  redactErrorDetails,
} from "@counterpoint/protocol";

describe("safe protocol error contract", () => {
  it("registers all 20 stable machine codes", () => {
    expect(ERROR_CODES).toHaveLength(20);
    expect(Object.keys(ERROR_CODE_REGISTRY)).toEqual([...ERROR_CODES]);

    for (const code of ERROR_CODES) {
      expect(ERROR_CODE_REGISTRY[code].message.length).toBeGreaterThan(0);
      expect(typeof ERROR_CODE_REGISTRY[code].retryable).toBe("boolean");
    }
  });

  it("uses the same logical envelope for HTTP and realtime", () => {
    expect(HttpErrorEnvelopeSchema).toBe(ErrorEnvelopeSchema);
    expect(RealtimeErrorEnvelopeSchema).toBe(ErrorEnvelopeSchema);

    const envelope = createErrorEnvelope({
      code: "VALIDATION_FAILED",
      correlationId: "correlation-1",
      details: { field: "title" },
    });
    expect(HttpErrorEnvelopeSchema.parse(envelope)).toEqual(envelope);
    expect(RealtimeErrorEnvelopeSchema.parse(envelope)).toEqual(envelope);
  });

  it("enforces the central retryable classification", () => {
    expect(isRetryableErrorCode("OPENAI_UNAVAILABLE")).toBe(true);
    expect(isRetryableErrorCode("REALTIME_UNAVAILABLE")).toBe(true);
    expect(isRetryableErrorCode("SHARED_FLOOR_BUSY")).toBe(true);
    expect(isRetryableErrorCode("INVALID_STATE_TRANSITION")).toBe(false);
    expect(isRetryableErrorCode("VALIDATION_FAILED")).toBe(false);

    expect(
      ErrorEnvelopeSchema.safeParse({
        code: "OPENAI_UNAVAILABLE",
        message: "Temporarily unavailable.",
        correlationId: "correlation-1",
        retryable: false,
        details: {},
      }).success,
    ).toBe(false);
  });

  it("deeply redacts stacks, secrets, Bearer values, private text, and prompts", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    const details = redactErrorDetails({
      stack: "Error: failed\n    at handler (/app/private.ts:10:2)",
      authorization: "Bearer top-secret-token",
      nested: {
        apiKey: "sk-1234567890abcdef",
        privateText: "unpublished participant concern",
        rawPrompt: "entire model system prompt",
        diagnostic:
          "request failed with Bearer nested-token and token=also-secret",
        exception: "Error: failed\n    at processRequest (/srv/server.ts:20:4)",
      },
      cycle: circular,
      cause: new Error("unclassified private failure text"),
      safe: "field name",
    });

    expect(details).toEqual({
      stack: REDACTED_VALUE,
      authorization: REDACTED_VALUE,
      nested: {
        apiKey: REDACTED_VALUE,
        privateText: REDACTED_VALUE,
        rawPrompt: REDACTED_VALUE,
        diagnostic: `request failed with ${REDACTED_VALUE} and ${REDACTED_VALUE}`,
        exception: `Error: failed\n${REDACTED_VALUE}`,
      },
      cycle: { self: REDACTED_VALUE },
      cause: { name: "Error", message: REDACTED_VALUE },
      safe: "field name",
    });
    expect(JSON.stringify(details)).not.toContain("top-secret");
    expect(JSON.stringify(details)).not.toContain("participant concern");
    expect(JSON.stringify(details)).not.toContain("/srv/server.ts");
  });

  it("removes cross-meeting identifiers at any depth", () => {
    expect(
      redactErrorDetails(
        {
          meetingId: "meeting-current",
          nested: {
            meetingId: "meeting-other",
            meetingIds: ["meeting-current", "meeting-other"],
          },
        },
        { allowedMeetingId: "meeting-current" },
      ),
    ).toEqual({
      meetingId: "meeting-current",
      nested: {
        meetingId: REDACTED_VALUE,
        meetingIds: REDACTED_VALUE,
      },
    });

    expect(redactErrorDetails({ meetingId: "meeting-unknown" })).toEqual({
      meetingId: REDACTED_VALUE,
    });
  });

  it("sanitizes custom messages and details while preserving safeParse behavior", () => {
    const envelope = createErrorEnvelope({
      code: "OPENAI_UNAVAILABLE",
      correlationId: "correlation-1",
      message: "Provider rejected Bearer custom-secret",
      details: {
        reason: "api_key=sk-1234567890",
        rawPrompt: "do not expose",
      },
    });

    expect(envelope).toEqual({
      code: "OPENAI_UNAVAILABLE",
      message: `Provider rejected ${REDACTED_VALUE}`,
      correlationId: "correlation-1",
      retryable: true,
      details: {
        reason: REDACTED_VALUE,
        rawPrompt: REDACTED_VALUE,
      },
    });
    expect(ErrorEnvelopeSchema.safeParse(envelope).success).toBe(true);
    expect(
      ErrorEnvelopeSchema.safeParse({
        ...envelope,
        code: "NOT_A_STABLE_CODE",
      }).success,
    ).toBe(false);
    expect(
      ErrorEnvelopeSchema.safeParse({
        ...envelope,
        internal: "undeclared",
      }).success,
    ).toBe(false);
  });
});
