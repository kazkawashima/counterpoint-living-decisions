import { env } from "cloudflare:workers";
import type {
  ManagedRealtimeCallConnector,
  ManagedRealtimeCallTerminator,
  UsageRequest,
} from "@counterpoint/ports";
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

class MemoryStorage implements JudgeRealtimeCallStorage {
  alarm: number | undefined;
  failPuts = 0;
  state: Awaited<ReturnType<JudgeRealtimeCallStorage["get"]>>;

  deleteAlarm(): Promise<void> {
    this.alarm = undefined;
    return Promise.resolve();
  }

  get(): ReturnType<JudgeRealtimeCallStorage["get"]> {
    return Promise.resolve(this.state);
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

  setAlarm(scheduledTimeEpochMs: number): Promise<void> {
    this.alarm = scheduledTimeEpochMs;
    return Promise.resolve();
  }
}

function lifecycle(
  options: {
    readonly connector?: ManagedRealtimeCallConnector;
    readonly now?: number;
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
  return {
    connector,
    finalize,
    hangup,
    instance: new JudgeRealtimeCallLifecycle({
      clock: () => options.now ?? 1_000,
      connector,
      storage,
      terminator,
      usage: { finalize },
    }),
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
      status: "active",
      terminateAtEpochMs: 50_000 + JUDGE_REALTIME_MAX_DURATION_SECONDS * 1_000,
    });
    expect(fixture.storage.alarm).toBe(
      50_000 + JUDGE_REALTIME_MAX_DURATION_SECONDS * 1_000,
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

  it("recovers an accepted call ID when its first durable write fails", async () => {
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

    expect(hangup).toHaveBeenCalledWith("rtc_server-owned-call");
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
