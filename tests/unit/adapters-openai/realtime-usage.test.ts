import {
  emptyOpenAiRealtimeUsageState,
  parseOpenAiRealtimeResponseDoneUsage,
  priceGptRealtime21UsageMicroUsd,
  recordOpenAiRealtimeServerEvent,
} from "@counterpoint/adapters-openai";
import { describe, expect, it } from "vitest";

const limits = {
  costMicroUsd: 25_000_000,
  generationCount: 100,
  inputTokens: 800_000,
  outputTokens: 400_000,
};

function responseDone(
  override: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    event_id: "event-response-1",
    response: {
      id: "response-1",
      output: [{ content: [{ transcript: "private output not retained" }] }],
      usage: {
        input_token_details: {
          audio_tokens: 13,
          cached_tokens: 64,
          cached_tokens_details: {
            audio_tokens: 0,
            image_tokens: 0,
            text_tokens: 64,
          },
          image_tokens: 0,
          text_tokens: 119,
        },
        input_tokens: 132,
        output_token_details: {
          audio_tokens: 91,
          text_tokens: 30,
        },
        output_tokens: 121,
        total_tokens: 253,
      },
    },
    type: "response.done",
    ...override,
  };
}

describe("OpenAI Realtime usage accounting", () => {
  it("extracts only content-free response.done usage", () => {
    const parsed = parseOpenAiRealtimeResponseDoneUsage(responseDone());

    expect(parsed).toEqual({
      eventId: "event-response-1",
      input: {
        audioTokens: 13,
        cachedAudioTokens: 0,
        cachedImageTokens: 0,
        cachedTextTokens: 64,
        imageTokens: 0,
        textTokens: 119,
        totalTokens: 132,
      },
      output: {
        audioTokens: 91,
        textTokens: 30,
        totalTokens: 121,
      },
      responseId: "response-1",
    });
    expect(JSON.stringify(parsed)).not.toContain("private output");
  });

  it("prices text, audio, image, and cached input with conservative micro-USD rounding", () => {
    const parsed = parseOpenAiRealtimeResponseDoneUsage(responseDone());
    if (parsed === undefined) {
      throw new TypeError("Expected valid usage");
    }

    // (55 * 4) + (64 * 0.4) + (13 * 32) + (30 * 24) + (91 * 64)
    // = USD 0.0072056, rounded up to 7,206 micro-USD.
    expect(priceGptRealtime21UsageMicroUsd(parsed)).toBe(7_206);

    const imageUsage = {
      ...parsed,
      input: {
        ...parsed.input,
        cachedImageTokens: 1,
        imageTokens: 2,
        totalTokens: 134,
      },
    };
    expect(priceGptRealtime21UsageMicroUsd(imageUsage)).toBe(7_212);
  });

  it("refuses to price a caller-forged inconsistent usage object", () => {
    const parsed = parseOpenAiRealtimeResponseDoneUsage(responseDone());
    if (parsed === undefined) {
      throw new TypeError("Expected valid usage");
    }

    expect(() =>
      priceGptRealtime21UsageMicroUsd({
        ...parsed,
        input: {
          ...parsed.input,
          cachedAudioTokens: parsed.input.audioTokens + 1,
        },
      }),
    ).toThrow("cannot be priced safely");
  });

  it.each([
    ["missing usage", { response: { id: "response-1" } }],
    [
      "inconsistent total",
      {
        response: {
          id: "response-1",
          usage: {
            input_token_details: {
              audio_tokens: 13,
              cached_tokens: 64,
              cached_tokens_details: {
                audio_tokens: 0,
                image_tokens: 0,
                text_tokens: 64,
              },
              image_tokens: 0,
              text_tokens: 119,
            },
            input_tokens: 132,
            output_token_details: { audio_tokens: 91, text_tokens: 30 },
            output_tokens: 121,
            total_tokens: 252,
          },
        },
      },
    ],
    [
      "cached tokens above modality input",
      {
        response: {
          id: "response-1",
          usage: {
            input_token_details: {
              audio_tokens: 13,
              cached_tokens: 120,
              cached_tokens_details: {
                audio_tokens: 0,
                image_tokens: 0,
                text_tokens: 120,
              },
              image_tokens: 0,
              text_tokens: 119,
            },
            input_tokens: 132,
            output_token_details: { audio_tokens: 91, text_tokens: 30 },
            output_tokens: 121,
            total_tokens: 253,
          },
        },
      },
    ],
    [
      "unknown billable usage field",
      {
        response: {
          ...(responseDone().response as Record<string, unknown>),
          usage: {
            ...((responseDone().response as Record<string, unknown>)
              .usage as Record<string, unknown>),
            future_billable_units: 1,
          },
        },
      },
    ],
  ])("rejects %s", (_label, override) => {
    expect(
      parseOpenAiRealtimeResponseDoneUsage(responseDone(override)),
    ).toBeUndefined();
  });

  it("aggregates valid events and ignores non-billable provider events", () => {
    const empty = emptyOpenAiRealtimeUsageState();
    const ignored = recordOpenAiRealtimeServerEvent(
      empty,
      { event_id: "session-1", type: "session.created" },
      limits,
    );
    expect(ignored).toEqual({ kind: "ignored", state: empty });

    const recorded = recordOpenAiRealtimeServerEvent(
      empty,
      responseDone(),
      limits,
    );
    expect(recorded.kind).toBe("recorded");
    expect(recorded.state.totals).toEqual({
      costMicroUsd: 7_206,
      generationCount: 1,
      inputTokens: 132,
      outputTokens: 121,
    });
    expect(JSON.stringify(recorded.state)).not.toContain("private output");
  });

  it("deduplicates exact responses and fails closed on conflicting identities", () => {
    const recorded = recordOpenAiRealtimeServerEvent(
      emptyOpenAiRealtimeUsageState(),
      responseDone(),
      limits,
    );
    const duplicate = recordOpenAiRealtimeServerEvent(
      recorded.state,
      responseDone(),
      limits,
    );
    expect(duplicate.kind).toBe("duplicate");
    expect(duplicate.state.totals).toEqual(recorded.state.totals);

    const conflictingResponse = structuredClone(responseDone());
    const response = conflictingResponse.response as Record<string, unknown>;
    const usage = response.usage as Record<string, unknown>;
    usage.total_tokens = 254;
    const conflict = recordOpenAiRealtimeServerEvent(
      recorded.state,
      conflictingResponse,
      limits,
    );
    expect(conflict.kind).toBe("invalid");
    expect(conflict.state.trustworthy).toBe(false);

    const reusedEventId = recordOpenAiRealtimeServerEvent(
      recorded.state,
      responseDone({
        response: {
          ...(responseDone().response as Record<string, unknown>),
          id: "response-2",
        },
      }),
      limits,
    );
    expect(reusedEventId.kind).toBe("invalid");
    expect(reusedEventId.state.trustworthy).toBe(false);
  });

  it("fails closed on malformed events, transcription billing, and exceeded limits", () => {
    const malformed = recordOpenAiRealtimeServerEvent(
      emptyOpenAiRealtimeUsageState(),
      "not-an-event",
      limits,
    );
    expect(malformed.kind).toBe("invalid");
    expect(malformed.state.trustworthy).toBe(false);

    const transcription = recordOpenAiRealtimeServerEvent(
      emptyOpenAiRealtimeUsageState(),
      {
        type: "conversation.item.input_audio_transcription.completed",
        usage: { total_tokens: 1 },
      },
      limits,
    );
    expect(transcription.kind).toBe("invalid");
    expect(transcription.state.trustworthy).toBe(false);

    const exceeded = recordOpenAiRealtimeServerEvent(
      emptyOpenAiRealtimeUsageState(),
      responseDone(),
      { ...limits, costMicroUsd: 7_205 },
    );
    expect(exceeded.kind).toBe("limit_exceeded");
    expect(exceeded.state.trustworthy).toBe(false);
    expect(exceeded.state.totals.costMicroUsd).toBe(7_206);
  });

  it("keeps an invalid accumulator invalid even after later valid telemetry", () => {
    const invalid = recordOpenAiRealtimeServerEvent(
      emptyOpenAiRealtimeUsageState(),
      null,
      limits,
    );
    const later = recordOpenAiRealtimeServerEvent(
      invalid.state,
      responseDone(),
      limits,
    );

    expect(later.kind).toBe("invalid");
    expect(later.state).toBe(invalid.state);
    expect(later.state.totals.generationCount).toBe(0);
  });
});
