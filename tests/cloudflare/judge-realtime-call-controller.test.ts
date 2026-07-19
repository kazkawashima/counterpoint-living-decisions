import { env } from "cloudflare:workers";
import type {
  ManagedRealtimeCallConnector,
  ManagedRealtimeCallTerminator,
  ManagedRealtimeSidebandConnector,
  ManagedRealtimeSidebandObserver,
  UsageRequest,
} from "@counterpoint/ports";
import { emptyOpenAiRealtimeUsageState } from "@counterpoint/adapters-openai";
import {
  JUDGE_REALTIME_MAX_DURATION_SECONDS,
  JUDGE_REALTIME_RESERVED_USAGE,
  JudgeRealtimeCallLifecycle,
  isExactJudgeRealtimeReservation,
  type JudgeRealtimeCallStorage,
} from "../../apps/worker/src/judge-realtime-call-controller.js";
import { judgeRealtimeCallControllerFor } from "../../apps/worker/src/index.js";
import { describe, expect, it, vi } from "vitest";

const reservedUsage: UsageRequest = JUDGE_REALTIME_RESERVED_USAGE;
const input = {
  channel: "private" as const,
  reservationId: "reservation-judge-realtime",
  safetyIdentifier: "sha256:judge-user",
  sdpOffer: "v=0\r\ns=offer\r\n",
};

function responseDone(sequence = 1): Record<string, unknown> {
  return {
    event_id: `event-response-${String(sequence)}`,
    response: {
      id: `response-${String(sequence)}`,
      output: [
        {
          content: [
            { transcript: "meeting-private-canary-must-not-be-retained" },
          ],
        },
      ],
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
  };
}

class MemoryStorage implements JudgeRealtimeCallStorage {
  alarm: number | undefined;
  failPuts = 0;
  state: Awaited<ReturnType<JudgeRealtimeCallStorage["get"]>>;

  confirmHangup(
    callId: string,
  ): ReturnType<JudgeRealtimeCallStorage["confirmHangup"]> {
    if (this.state?.status !== "active" || this.state.callId !== callId) {
      return Promise.resolve(undefined);
    }
    const next = {
      reservationId: this.state.reservationId,
      reservedUsage: this.state.reservedUsage,
      sidebandUsage: this.state.sidebandUsage,
      status: "hangup_confirmed" as const,
    };
    this.state = structuredClone(next);
    return Promise.resolve(next);
  }

  deleteAlarm(): Promise<void> {
    this.alarm = undefined;
    return Promise.resolve();
  }

  get(): ReturnType<JudgeRealtimeCallStorage["get"]> {
    return Promise.resolve(this.state);
  }

  markSidebandUntrustworthy(callId: string): Promise<boolean> {
    if (this.state?.status !== "active" || this.state.callId !== callId) {
      return Promise.resolve(false);
    }
    this.state = {
      ...this.state,
      sidebandUsage: {
        ...this.state.sidebandUsage,
        trustworthy: false,
      },
    };
    return Promise.resolve(true);
  }

  put(
    state: NonNullable<Awaited<ReturnType<JudgeRealtimeCallStorage["get"]>>>,
  ): Promise<void> {
    if (this.failPuts > 0) {
      this.failPuts -= 1;
      return Promise.reject(new Error("storage put unavailable"));
    }
    this.state = structuredClone(state);
    return Promise.resolve();
  }

  replaceActiveUsage(
    callId: string,
    expected: Parameters<JudgeRealtimeCallStorage["replaceActiveUsage"]>[1],
    next: Parameters<JudgeRealtimeCallStorage["replaceActiveUsage"]>[2],
  ): Promise<boolean> {
    if (
      this.state?.status !== "active" ||
      this.state.callId !== callId ||
      JSON.stringify(this.state.sidebandUsage) !== JSON.stringify(expected)
    ) {
      return Promise.resolve(false);
    }
    this.state = {
      ...this.state,
      sidebandUsage: structuredClone(next),
    };
    return Promise.resolve(true);
  }

  replaceConnecting(
    reservationId: string,
    state: Parameters<JudgeRealtimeCallStorage["replaceConnecting"]>[1],
  ): Promise<boolean> {
    if (
      this.state?.status !== "connecting" ||
      this.state.reservationId !== reservationId
    ) {
      return Promise.resolve(false);
    }
    this.state = structuredClone(state);
    return Promise.resolve(true);
  }

  setAlarm(scheduledTimeEpochMs: number): Promise<void> {
    this.alarm = scheduledTimeEpochMs;
    return Promise.resolve();
  }
}

class DelayedUsageStorage extends MemoryStorage {
  readonly replacementStarted: Promise<void>;
  readonly #replacementGate: Promise<void>;
  #releaseReplacement: (() => void) | undefined;
  #reportReplacementStarted: (() => void) | undefined;

  constructor() {
    super();
    this.replacementStarted = new Promise<void>((resolve) => {
      this.#reportReplacementStarted = resolve;
    });
    this.#replacementGate = new Promise<void>((resolve) => {
      this.#releaseReplacement = resolve;
    });
  }

  releaseReplacement(): void {
    this.#releaseReplacement?.();
  }

  override async replaceActiveUsage(
    callId: string,
    expected: Parameters<JudgeRealtimeCallStorage["replaceActiveUsage"]>[1],
    next: Parameters<JudgeRealtimeCallStorage["replaceActiveUsage"]>[2],
  ): Promise<boolean> {
    this.#reportReplacementStarted?.();
    await this.#replacementGate;
    return super.replaceActiveUsage(callId, expected, next);
  }
}

class DelayedInitialGetStorage extends MemoryStorage {
  readonly getStarted: Promise<void>;
  readonly #getGate: Promise<void>;
  #releaseGet: (() => void) | undefined;
  #reportGetStarted: (() => void) | undefined;

  constructor() {
    super();
    this.getStarted = new Promise<void>((resolve) => {
      this.#reportGetStarted = resolve;
    });
    this.#getGate = new Promise<void>((resolve) => {
      this.#releaseGet = resolve;
    });
  }

  override async get(): ReturnType<JudgeRealtimeCallStorage["get"]> {
    this.#reportGetStarted?.();
    await this.#getGate;
    return super.get();
  }

  releaseGet(): void {
    this.#releaseGet?.();
  }
}

function lifecycle(
  options: {
    readonly connector?: ManagedRealtimeCallConnector;
    readonly now?: number;
    readonly sideband?: ManagedRealtimeSidebandConnector;
    readonly storage?: MemoryStorage;
    readonly terminator?: ManagedRealtimeCallTerminator;
    readonly finalize?: (
      reservationId: string,
      actual: UsageRequest,
    ) => Promise<void>;
  } = {},
) {
  const storage = options.storage ?? new MemoryStorage();
  const connector: ManagedRealtimeCallConnector = options.connector ?? {
    async connect(_request, onAccepted) {
      await onAccepted?.("rtc_server-owned-call");
      return {
        callId: "rtc_server-owned-call",
        channel: "private",
        model: "gpt-realtime-2.1",
        sdpAnswer: "v=0\r\ns=answer\r\n",
      };
    },
  };
  const hangup = vi.fn(() => Promise.resolve());
  const terminator: ManagedRealtimeCallTerminator = options.terminator ?? {
    hangup,
  };
  const finalize = options.finalize ?? vi.fn(() => Promise.resolve());
  let sidebandObserver: ManagedRealtimeSidebandObserver | undefined;
  const sidebandCancelResponse = vi.fn();
  const sidebandClose = vi.fn();
  const sidebandCreateResponse = vi.fn();
  const sidebandConnect = vi.fn<ManagedRealtimeSidebandConnector["connect"]>(
    (_callId, observer) => {
      sidebandObserver = observer;
      return Promise.resolve({
        cancelResponse: sidebandCancelResponse,
        close: sidebandClose,
        createResponse: sidebandCreateResponse,
        isHealthy: () => true,
      });
    },
  );
  const sideband = options.sideband ?? { connect: sidebandConnect };
  return {
    connector,
    finalize,
    hangup,
    instance: new JudgeRealtimeCallLifecycle({
      clock: () => options.now ?? 1_000,
      connector,
      sideband,
      storage,
      terminator,
      usage: { finalize },
    }),
    get sidebandObserver() {
      return sidebandObserver;
    },
    sidebandCancelResponse,
    sidebandClose,
    sidebandConnect,
    sidebandCreateResponse,
    storage,
    terminator,
  };
}

describe("JudgeRealtimeCallLifecycle", () => {
  it("durably owns the provider call ID and alarm before returning browser SDP", async () => {
    const fixture = lifecycle({ now: 50_000 });

    await expect(fixture.instance.start(input)).resolves.toEqual({
      channel: "private",
      kind: "started",
      model: "gpt-realtime-2.1",
      sdpAnswer: "v=0\r\ns=answer\r\n",
    });

    expect(fixture.storage.state).toEqual({
      callId: "rtc_server-owned-call",
      reservationId: input.reservationId,
      reservedUsage,
      sidebandUsage: emptyOpenAiRealtimeUsageState(),
      startedAtEpochMs: 50_000,
      status: "active",
      terminateAtEpochMs: 50_000 + JUDGE_REALTIME_MAX_DURATION_SECONDS * 1_000,
    });
    expect(fixture.storage.alarm).toBe(
      50_000 + JUDGE_REALTIME_MAX_DURATION_SECONDS * 1_000,
    );
    expect(fixture.sidebandConnect).toHaveBeenCalledWith(
      "rtc_server-owned-call",
      expect.any(Object),
    );
    expect(JSON.stringify(await fixture.instance.status())).not.toContain(
      "rtc_server-owned-call",
    );
  });

  it("hangs up and conservatively settles the reservation at the alarm boundary", async () => {
    const hangup = vi.fn(() => Promise.resolve());
    const fixture = lifecycle({
      now: 60_000,
      terminator: { hangup },
    });
    await fixture.instance.start(input);

    await fixture.instance.terminate();

    expect(hangup).toHaveBeenCalledWith("rtc_server-owned-call");
    expect(fixture.finalize).toHaveBeenCalledWith(
      input.reservationId,
      reservedUsage,
    );
    expect(fixture.storage.state).toEqual({
      settledAtEpochMs: 60_000,
      status: "settled",
    });
    expect(fixture.storage.alarm).toBeUndefined();
  });

  it("retries settlement without issuing a duplicate hangup", async () => {
    const storage = new MemoryStorage();
    const hangup = vi.fn(() => Promise.resolve());
    const terminator = { hangup };
    const failedFinalize = vi.fn(() =>
      Promise.reject(new Error("D1 unavailable")),
    );
    const first = lifecycle({
      finalize: failedFinalize,
      storage,
      terminator,
    });
    await first.instance.start(input);

    await expect(first.instance.terminate()).rejects.toThrow("D1 unavailable");
    expect(storage.state).toEqual({
      reservationId: input.reservationId,
      reservedUsage,
      sidebandUsage: emptyOpenAiRealtimeUsageState(),
      status: "hangup_confirmed",
    });

    const successfulFinalize = vi.fn(() => Promise.resolve());
    const retry = lifecycle({
      finalize: successfulFinalize,
      storage,
      terminator,
    });
    await retry.instance.terminate();

    expect(hangup).toHaveBeenCalledOnce();
    expect(successfulFinalize).toHaveBeenCalledWith(
      input.reservationId,
      reservedUsage,
    );
  });

  it("immediately hangs up an accepted call when SDP validation later fails", async () => {
    const connector: ManagedRealtimeCallConnector = {
      async connect(_request, onAccepted) {
        await onAccepted?.("rtc_accepted-before-invalid-sdp");
        throw new Error("invalid SDP");
      },
    };
    const hangup = vi.fn(() => Promise.resolve());
    const fixture = lifecycle({ connector, terminator: { hangup } });

    await expect(fixture.instance.start(input)).resolves.toEqual({
      kind: "unavailable",
    });

    expect(hangup).toHaveBeenCalledWith("rtc_accepted-before-invalid-sdp");
    expect(fixture.finalize).toHaveBeenCalledWith(
      input.reservationId,
      reservedUsage,
    );
  });

  it("fails closed when the authenticated sideband cannot attach", async () => {
    const sideband: ManagedRealtimeSidebandConnector = {
      connect: () => Promise.reject(new Error("sideband unavailable")),
    };
    const fixture = lifecycle({ sideband });

    await expect(fixture.instance.start(input)).resolves.toEqual({
      kind: "unavailable",
    });

    expect(fixture.hangup).toHaveBeenCalledWith("rtc_server-owned-call");
    expect(fixture.finalize).toHaveBeenCalledWith(
      input.reservationId,
      reservedUsage,
    );
    expect(fixture.storage.state).toEqual({
      settledAtEpochMs: 1_000,
      status: "settled",
    });
  });

  it("durably projects sideband usage without retaining provider content", async () => {
    const fixture = lifecycle();
    await fixture.instance.start(input);

    await fixture.sidebandObserver?.onProviderEvent({
      type: "input_audio_buffer.speech_stopped",
    });
    await fixture.sidebandObserver?.onProviderEvent({
      type: "response.created",
    });
    await fixture.sidebandObserver?.onProviderEvent(responseDone());

    expect(fixture.storage.state).toMatchObject({
      sidebandUsage: {
        totals: {
          costMicroUsd: 7_206,
          generationCount: 1,
          inputTokens: 132,
          outputTokens: 121,
        },
        trustworthy: true,
      },
      status: "active",
    });
    expect(JSON.stringify(fixture.storage.state)).not.toContain(
      "meeting-private-canary",
    );
  });

  it("creates responses only from server-observed speech boundaries", async () => {
    const fixture = lifecycle();
    await fixture.instance.start(input);
    const observer = fixture.sidebandObserver;
    if (observer === undefined) {
      throw new TypeError("Expected attached sideband observer");
    }

    await observer.onProviderEvent({
      type: "input_audio_buffer.speech_stopped",
    });
    expect(fixture.sidebandCreateResponse).toHaveBeenCalledOnce();
    await observer.onProviderEvent({ type: "response.created" });
    await observer.onProviderEvent(responseDone());
    await observer.onProviderEvent({
      type: "input_audio_buffer.speech_stopped",
    });

    expect(fixture.sidebandCreateResponse).toHaveBeenCalledTimes(2);
    expect(fixture.hangup).not.toHaveBeenCalled();
    expect(fixture.storage.state).toMatchObject({
      sidebandUsage: {
        totals: { generationCount: 1 },
        trustworthy: true,
      },
      status: "active",
    });
  });

  it("serializes cancellation before creating a response for later speech", async () => {
    const fixture = lifecycle();
    await fixture.instance.start(input);
    const observer = fixture.sidebandObserver;
    if (observer === undefined) {
      throw new TypeError("Expected attached sideband observer");
    }

    await observer.onProviderEvent({
      type: "input_audio_buffer.speech_stopped",
    });
    await observer.onProviderEvent({ type: "response.created" });
    await observer.onProviderEvent({
      type: "input_audio_buffer.speech_started",
    });
    await observer.onProviderEvent({
      type: "input_audio_buffer.speech_stopped",
    });
    expect(fixture.sidebandCancelResponse).toHaveBeenCalledOnce();
    expect(fixture.sidebandCreateResponse).toHaveBeenCalledOnce();

    await observer.onProviderEvent(responseDone());

    expect(fixture.sidebandCreateResponse).toHaveBeenCalledTimes(2);
    expect(fixture.hangup).not.toHaveBeenCalled();
  });

  it("terminates an unsolicited provider response", async () => {
    const fixture = lifecycle();
    await fixture.instance.start(input);

    await fixture.sidebandObserver?.onProviderEvent({
      type: "response.created",
    });

    expect(fixture.sidebandCreateResponse).not.toHaveBeenCalled();
    expect(fixture.hangup).toHaveBeenCalledOnce();
    expect(fixture.finalize).toHaveBeenCalledWith(
      input.reservationId,
      reservedUsage,
    );
  });

  it("terminates duplicate response creation and provider command errors", async () => {
    const duplicateFixture = lifecycle();
    await duplicateFixture.instance.start(input);
    await duplicateFixture.sidebandObserver?.onProviderEvent({
      type: "input_audio_buffer.speech_stopped",
    });
    await duplicateFixture.sidebandObserver?.onProviderEvent({
      type: "response.created",
    });
    await duplicateFixture.sidebandObserver?.onProviderEvent({
      type: "response.created",
    });
    expect(duplicateFixture.hangup).toHaveBeenCalledOnce();

    const errorFixture = lifecycle();
    await errorFixture.instance.start(input);
    await errorFixture.sidebandObserver?.onProviderEvent({
      type: "input_audio_buffer.speech_stopped",
    });
    await errorFixture.sidebandObserver?.onProviderEvent({
      error: { message: "provider-private-command-error" },
      type: "error",
    });
    expect(errorFixture.hangup).toHaveBeenCalledOnce();
    expect(JSON.stringify(errorFixture.storage.state)).not.toContain(
      "provider-private-command-error",
    );
  });

  it("terminates a response completion without an observed creation", async () => {
    const fixture = lifecycle();
    await fixture.instance.start(input);
    await fixture.sidebandObserver?.onProviderEvent({
      type: "input_audio_buffer.speech_stopped",
    });
    await fixture.sidebandObserver?.onProviderEvent(responseDone());

    expect(fixture.hangup).toHaveBeenCalledOnce();
    expect(fixture.finalize).toHaveBeenCalledWith(
      input.reservationId,
      reservedUsage,
    );
  });

  it("terminates before a fourth response command can exceed its reservation", async () => {
    const fixture = lifecycle();
    await fixture.instance.start(input);
    const observer = fixture.sidebandObserver;
    if (observer === undefined) {
      throw new TypeError("Expected attached sideband observer");
    }

    for (let sequence = 1; sequence <= 3; sequence += 1) {
      await observer.onProviderEvent({
        type: "input_audio_buffer.speech_stopped",
      });
      await observer.onProviderEvent({ type: "response.created" });
      await observer.onProviderEvent(responseDone(sequence));
    }
    await observer.onProviderEvent({
      type: "input_audio_buffer.speech_stopped",
    });

    expect(fixture.sidebandCreateResponse).toHaveBeenCalledTimes(3);
    expect(fixture.hangup).toHaveBeenCalledOnce();
    expect(fixture.finalize).toHaveBeenCalledWith(
      input.reservationId,
      reservedUsage,
    );
  });

  it("cannot resurrect an active call with a stale telemetry write", async () => {
    const storage = new DelayedUsageStorage();
    const fixture = lifecycle({ storage });
    await fixture.instance.start(input);
    const observer = fixture.sidebandObserver;
    if (observer === undefined) {
      throw new TypeError("Expected attached sideband observer");
    }

    const record = observer.onProviderEvent(responseDone());
    await storage.replacementStarted;
    await fixture.instance.terminate();
    storage.releaseReplacement();
    await record;

    expect(fixture.storage.state).toEqual({
      settledAtEpochMs: 1_000,
      status: "settled",
    });
    expect(fixture.hangup).toHaveBeenCalledOnce();
    expect(fixture.finalize).toHaveBeenCalledOnce();
  });

  it("hangs up and fully settles malformed billable telemetry", async () => {
    const fixture = lifecycle();
    await fixture.instance.start(input);
    const malformed = responseDone();
    const response = malformed.response as Record<string, unknown>;
    response.usage = {
      ...(response.usage as Record<string, unknown>),
      future_billable_units: 1,
    };

    await fixture.sidebandObserver?.onProviderEvent(malformed);

    expect(fixture.hangup).toHaveBeenCalledWith("rtc_server-owned-call");
    expect(fixture.finalize).toHaveBeenCalledWith(
      input.reservationId,
      reservedUsage,
    );
    expect(fixture.storage.state).toEqual({
      settledAtEpochMs: 1_000,
      status: "settled",
    });
  });

  it("fully settles a provider-side sideband disconnect", async () => {
    const fixture = lifecycle();
    await fixture.instance.start(input);

    await fixture.sidebandObserver?.onDisconnect({
      clean: false,
      initiatedByServer: false,
    });

    expect(fixture.hangup).toHaveBeenCalledWith("rtc_server-owned-call");
    expect(fixture.finalize).toHaveBeenCalledWith(
      input.reservationId,
      reservedUsage,
    );
    expect(fixture.storage.state).toEqual({
      settledAtEpochMs: 1_000,
      status: "settled",
    });
  });

  it("does not return browser SDP when sideband disconnects during attachment", async () => {
    const close = vi.fn();
    const sideband: ManagedRealtimeSidebandConnector = {
      async connect(_callId, observer) {
        await observer.onDisconnect({
          clean: false,
          initiatedByServer: false,
        });
        return {
          cancelResponse: vi.fn(),
          close,
          createResponse: vi.fn(),
          isHealthy: () => true,
        };
      },
    };
    const fixture = lifecycle({ sideband });

    await expect(fixture.instance.start(input)).resolves.toEqual({
      kind: "unavailable",
    });

    expect(close).toHaveBeenCalledOnce();
    expect(fixture.hangup).toHaveBeenCalledOnce();
    expect(fixture.finalize).toHaveBeenCalledOnce();
    expect(fixture.storage.state).toEqual({
      settledAtEpochMs: 1_000,
      status: "settled",
    });
  });

  it("does not return browser SDP when sideband disconnects after attachment", async () => {
    let observer: ManagedRealtimeSidebandObserver | undefined;
    const sideband: ManagedRealtimeSidebandConnector = {
      connect(_callId, selectedObserver) {
        observer = selectedObserver;
        return Promise.resolve({
          cancelResponse: vi.fn(),
          close: vi.fn(),
          createResponse: vi.fn(),
          isHealthy: () => true,
        });
      },
    };
    const connector: ManagedRealtimeCallConnector = {
      async connect(_request, onAccepted) {
        await onAccepted?.("rtc_disconnect-before-sdp");
        await observer?.onDisconnect({
          clean: false,
          initiatedByServer: false,
        });
        return {
          callId: "rtc_disconnect-before-sdp",
          channel: "private",
          model: "gpt-realtime-2.1",
          sdpAnswer: "v=0\r\ns=answer\r\n",
        };
      },
    };
    const fixture = lifecycle({ connector, sideband });

    await expect(fixture.instance.start(input)).resolves.toEqual({
      kind: "unavailable",
    });

    expect(fixture.hangup).toHaveBeenCalledOnce();
    expect(fixture.finalize).toHaveBeenCalledOnce();
    expect(fixture.storage.state).toEqual({
      settledAtEpochMs: 1_000,
      status: "settled",
    });
  });

  it("does not return browser SDP while sideband health notification is pending", async () => {
    const close = vi.fn();
    const sideband: ManagedRealtimeSidebandConnector = {
      connect: () =>
        Promise.resolve({
          cancelResponse: vi.fn(),
          close,
          createResponse: vi.fn(),
          isHealthy: () => false,
        }),
    };
    const fixture = lifecycle({ sideband });

    await expect(fixture.instance.start(input)).resolves.toEqual({
      kind: "unavailable",
    });

    expect(close).toHaveBeenCalledOnce();
    expect(fixture.hangup).toHaveBeenCalledOnce();
    expect(fixture.finalize).toHaveBeenCalledOnce();
    expect(fixture.storage.state).toEqual({
      settledAtEpochMs: 1_000,
      status: "settled",
    });
  });

  it("does not duplicate settlement when server shutdown closes sideband", async () => {
    let observer: ManagedRealtimeSidebandObserver | undefined;
    let disconnect: Promise<void> | undefined;
    const sideband: ManagedRealtimeSidebandConnector = {
      connect(_callId, selectedObserver) {
        observer = selectedObserver;
        return Promise.resolve({
          cancelResponse: vi.fn(),
          close() {
            disconnect = observer?.onDisconnect({
              clean: true,
              initiatedByServer: true,
            });
          },
          createResponse: vi.fn(),
          isHealthy: () => true,
        });
      },
    };
    const fixture = lifecycle({ sideband });
    await fixture.instance.start(input);

    await fixture.instance.terminate();
    await disconnect;

    expect(fixture.hangup).toHaveBeenCalledOnce();
    expect(fixture.finalize).toHaveBeenCalledOnce();
  });

  it("serializes concurrent termination attempts", async () => {
    const fixture = lifecycle();
    await fixture.instance.start(input);

    await Promise.all([
      fixture.instance.terminate(),
      fixture.instance.terminate(),
      fixture.instance.terminate(),
    ]);

    expect(fixture.hangup).toHaveBeenCalledOnce();
    expect(fixture.finalize).toHaveBeenCalledOnce();
    expect(fixture.storage.state).toEqual({
      settledAtEpochMs: 1_000,
      status: "settled",
    });
  });

  it("settles without provider work when its initial durable claim fails", async () => {
    const storage = new MemoryStorage();
    storage.failPuts = 1;
    const hangup = vi.fn(() => Promise.resolve());
    const fixture = lifecycle({
      storage,
      terminator: { hangup },
    });

    await expect(fixture.instance.start(input)).resolves.toEqual({
      kind: "unavailable",
    });

    expect(hangup).not.toHaveBeenCalled();
    expect(fixture.finalize).toHaveBeenCalledWith(
      input.reservationId,
      reservedUsage,
    );
    expect(storage.state).toEqual({
      settledAtEpochMs: 1_000,
      status: "settled",
    });
  });

  it("charges an unknown provider outcome without attempting an unknown call ID", async () => {
    const connector: ManagedRealtimeCallConnector = {
      connect: () => Promise.reject(new Error("transport unavailable")),
    };
    const hangup = vi.fn(() => Promise.resolve());
    const fixture = lifecycle({ connector, terminator: { hangup } });

    await expect(fixture.instance.start(input)).resolves.toEqual({
      kind: "unavailable",
    });

    expect(hangup).not.toHaveBeenCalled();
    expect(fixture.finalize).toHaveBeenCalledWith(
      input.reservationId,
      reservedUsage,
    );
    expect(fixture.storage.state).toEqual({
      settledAtEpochMs: 1_000,
      status: "settled",
    });
  });

  it("rejects a second start without touching the provider", async () => {
    const connect = vi.fn<ManagedRealtimeCallConnector["connect"]>(
      async (_request, onAccepted) => {
        await onAccepted?.("rtc_server-owned-call");
        return {
          callId: "rtc_server-owned-call",
          channel: "private" as const,
          model: "gpt-realtime-2.1",
          sdpAnswer: "v=0\r\ns=answer\r\n",
        };
      },
    );
    const connector: ManagedRealtimeCallConnector = { connect };
    const fixture = lifecycle({ connector });
    await fixture.instance.start(input);

    await expect(fixture.instance.start(input)).resolves.toEqual({
      kind: "conflict",
    });
    expect(connect).toHaveBeenCalledOnce();
  });

  it("rejects a concurrent start while provider connection is pending", async () => {
    let releaseConnection: (() => void) | undefined;
    const connectionGate = new Promise<void>((resolve) => {
      releaseConnection = resolve;
    });
    const connect = vi.fn<ManagedRealtimeCallConnector["connect"]>(
      async (_request, onAccepted) => {
        await connectionGate;
        await onAccepted?.("rtc_concurrent-start");
        return {
          callId: "rtc_concurrent-start",
          channel: "private",
          model: "gpt-realtime-2.1",
          sdpAnswer: "v=0\r\ns=answer\r\n",
        };
      },
    );
    const fixture = lifecycle({ connector: { connect } });
    const firstStart = fixture.instance.start(input);
    await vi.waitFor(() => expect(connect).toHaveBeenCalledOnce());

    await expect(fixture.instance.start(input)).resolves.toEqual({
      kind: "conflict",
    });
    releaseConnection?.();
    await expect(firstStart).resolves.toMatchObject({ kind: "started" });
    expect(connect).toHaveBeenCalledOnce();
  });

  it("cancels a connecting claim without allowing a late accepted call to revive", async () => {
    let releaseConnection: (() => void) | undefined;
    const connectionGate = new Promise<void>((resolve) => {
      releaseConnection = resolve;
    });
    const connector: ManagedRealtimeCallConnector = {
      async connect(_request, onAccepted) {
        await connectionGate;
        await onAccepted?.("rtc_accepted-after-cancel");
        return {
          callId: "rtc_accepted-after-cancel",
          channel: "private",
          model: "gpt-realtime-2.1",
          sdpAnswer: "v=0\r\ns=answer\r\n",
        };
      },
    };
    const fixture = lifecycle({ connector });
    const pendingStart = fixture.instance.start(input);
    await vi.waitFor(() =>
      expect(fixture.storage.state?.status).toBe("connecting"),
    );

    await fixture.instance.terminate();
    releaseConnection?.();

    await expect(pendingStart).resolves.toEqual({ kind: "unavailable" });
    expect(fixture.hangup).toHaveBeenCalledWith("rtc_accepted-after-cancel");
    expect(fixture.finalize).toHaveBeenCalledOnce();
    expect(fixture.storage.state).toEqual({
      settledAtEpochMs: 1_000,
      status: "settled",
    });
  });

  it("cancels before the initial durable claim without starting provider work", async () => {
    const storage = new DelayedInitialGetStorage();
    const connect = vi.fn<ManagedRealtimeCallConnector["connect"]>();
    const fixture = lifecycle({ connector: { connect }, storage });
    const pendingStart = fixture.instance.start(input);
    await storage.getStarted;

    const termination = fixture.instance.terminate();
    storage.releaseGet();

    await expect(pendingStart).resolves.toEqual({ kind: "unavailable" });
    await termination;
    expect(connect).not.toHaveBeenCalled();
    expect(fixture.finalize).toHaveBeenCalledOnce();
    expect(fixture.storage.state).toBeUndefined();
  });
});

describe("judge Realtime reservation gate", () => {
  const exactReservation = {
    model: "gpt-realtime-2.1",
    operation: "judge_realtime",
    pricing_version: "gpt-realtime-2.1-2026-07-19",
    reserved_cost_micro_usd: 25_000_000,
    reserved_generation_count: reservedUsage.generationCount,
    reserved_input_tokens: reservedUsage.estimatedInputTokens,
    reserved_output_tokens: reservedUsage.estimatedOutputTokens,
    reserved_realtime_seconds: reservedUsage.realtimeSeconds,
    status: "reserved",
  } as const;

  it("requires every full-cap reservation field before provider work", () => {
    expect(isExactJudgeRealtimeReservation(exactReservation)).toBe(true);
    expect(
      isExactJudgeRealtimeReservation({
        ...exactReservation,
        reserved_cost_micro_usd: 24_999_999,
      }),
    ).toBe(false);
    expect(
      isExactJudgeRealtimeReservation({
        ...exactReservation,
        status: "finalized",
      }),
    ).toBe(false);
    expect(isExactJudgeRealtimeReservation(null)).toBe(false);
  });
});

describe("JudgeRealtimeCallController binding", () => {
  it("is registered and stays fail-closed without the Worker Secret", async () => {
    const controller = judgeRealtimeCallControllerFor(
      env,
      "judge-realtime-not-configured",
    );

    const status = await controller.fetch(
      "https://judge-realtime.internal/status",
    );
    await expect(status.json()).resolves.toEqual({
      kind: "not_configured",
    });

    const start = await controller.fetch(
      "https://judge-realtime.internal/start",
      {
        body: JSON.stringify(input),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(start.status).toBe(503);
    await expect(start.json()).resolves.toEqual({
      code: "REALTIME_UNAVAILABLE",
    });
  });
});
