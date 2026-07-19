import {
  MAX_OPENAI_REALTIME_SIDEBAND_EVENT_BYTES,
  OPENAI_REALTIME_SIDEBAND_URL,
  OpenAiRealtimeSidebandConnector,
  OpenAiRealtimeSidebandError,
} from "@counterpoint/adapters-openai";
import type {
  ManagedRealtimeSidebandDisconnect,
  ManagedRealtimeSidebandObserver,
} from "@counterpoint/ports";
import { describe, expect, it, vi } from "vitest";

const standardApiKey = "sk-managed-standard-secret-must-stay-server-side";

class FakeSocket {
  readonly listeners = new Map<string, (event: never) => void>();
  readonly sent: string[] = [];
  accepted = false;
  acknowledgeConfiguration: "error" | "none" | "success" = "success";
  closed: { code?: number; reason?: string } | undefined;

  accept(): void {
    this.accepted = true;
  }

  addEventListener(type: string, listener: (event: never) => void): void {
    this.listeners.set(type, listener);
  }

  close(code?: number, reason?: string): void {
    this.closed = {
      ...(code === undefined ? {} : { code }),
      ...(reason === undefined ? {} : { reason }),
    };
  }

  emit(type: string, event: unknown): void {
    this.listeners.get(type)?.(event as never);
  }

  send(data: string): void {
    this.sent.push(data);
    const event = JSON.parse(data) as { readonly type?: unknown };
    if (event.type !== "session.update") {
      return;
    }
    if (this.acknowledgeConfiguration === "error") {
      this.emit("message", {
        data: JSON.stringify({
          error: { message: "provider-private-configuration-error" },
          type: "error",
        }),
      });
      return;
    }
    if (this.acknowledgeConfiguration === "none") {
      this.emit("error", {});
      return;
    }
    this.emit("message", {
      data: JSON.stringify({
        session: {
          audio: {
            input: {
              transcription: {
                model: "gpt-realtime-whisper",
              },
              turn_detection: {
                create_response: false,
                interrupt_response: false,
                type: "server_vad",
              },
            },
          },
        },
        type: "session.updated",
      }),
    });
  }
}

function observer() {
  const events: unknown[] = [];
  const disconnects: ManagedRealtimeSidebandDisconnect[] = [];
  const value: ManagedRealtimeSidebandObserver = {
    onDisconnect(event) {
      disconnects.push(event);
      return Promise.resolve();
    },
    onProviderEvent(event) {
      events.push(event);
      return Promise.resolve();
    },
  };
  return { disconnects, events, value };
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function parseJson(serialized: string): unknown {
  return JSON.parse(serialized) as unknown;
}

describe("OpenAiRealtimeSidebandConnector", () => {
  it("upgrades only the fixed provider origin with server-side authorization", async () => {
    const socket = new FakeSocket();
    const fetch = vi.fn(() =>
      Promise.resolve({ status: 101, webSocket: socket }),
    );
    const connector = new OpenAiRealtimeSidebandConnector({
      apiKey: standardApiKey,
      fetch,
    });

    await connector.connect("rtc_call-ABC_123", observer().value);

    expect(fetch).toHaveBeenCalledWith(
      `${OPENAI_REALTIME_SIDEBAND_URL}?call_id=rtc_call-ABC_123`,
      expect.objectContaining({
        headers: {
          Authorization: `Bearer ${standardApiKey}`,
          Upgrade: "websocket",
        },
        redirect: "error",
      }),
    );
    expect(socket.accepted).toBe(true);
    expect(socket.sent.map(parseJson)).toEqual([
      {
        session: {
          audio: {
            input: {
              transcription: {
                model: "gpt-realtime-whisper",
              },
              turn_detection: {
                create_response: false,
                interrupt_response: false,
                type: "server_vad",
              },
            },
          },
          type: "realtime",
        },
        type: "session.update",
      },
    ]);
    expect(JSON.stringify(fetch.mock.calls)).not.toContain(
      "meeting-private-canary",
    );
  });

  it("exposes only fixed response control commands after configuration", async () => {
    const socket = new FakeSocket();
    const connection = await new OpenAiRealtimeSidebandConnector({
      apiKey: standardApiKey,
      fetch: () => Promise.resolve({ status: 101, webSocket: socket }),
    }).connect("rtc_controlled", observer().value);

    connection.createResponse();
    connection.cancelResponse();

    expect(socket.sent.slice(1).map(parseJson)).toEqual([
      { type: "response.create" },
      { type: "response.cancel" },
    ]);
  });

  it("fails closed when managed turn-taking is not acknowledged", async () => {
    const socket = new FakeSocket();
    socket.acknowledgeConfiguration = "none";

    await expect(
      new OpenAiRealtimeSidebandConnector({
        apiKey: standardApiKey,
        fetch: () => Promise.resolve({ status: 101, webSocket: socket }),
      }).connect("rtc_unconfigured", observer().value),
    ).rejects.toThrow("configuration was unavailable");
    expect(socket.closed).toEqual({
      code: 1011,
      reason: "sideband unavailable",
    });
  });

  it("fails closed immediately on a provider configuration error", async () => {
    const socket = new FakeSocket();
    socket.acknowledgeConfiguration = "error";

    await expect(
      new OpenAiRealtimeSidebandConnector({
        apiKey: standardApiKey,
        fetch: () => Promise.resolve({ status: 101, webSocket: socket }),
      }).connect("rtc_provider_error", observer().value),
    ).rejects.toThrow("configuration was unavailable");
    expect(socket.closed).toEqual({
      code: 1011,
      reason: "sideband unavailable",
    });
    expect(JSON.stringify(socket)).not.toContain(
      "provider-private-configuration-error",
    );
  });

  it("projects ordered JSON events without retaining provider frames", async () => {
    const socket = new FakeSocket();
    const observed = observer();
    const dispatched: Promise<void>[] = [];
    const connector = new OpenAiRealtimeSidebandConnector({
      apiKey: standardApiKey,
      dispatch: (work) => dispatched.push(work),
      fetch: () => Promise.resolve({ status: 101, webSocket: socket }),
    });
    const connection = await connector.connect("rtc_ordered", observed.value);

    socket.emit("message", {
      data: JSON.stringify({ event_id: "event-1", type: "session.created" }),
    });
    socket.emit("message", {
      data: JSON.stringify({ event_id: "event-2", type: "response.done" }),
    });
    expect(connection.isHealthy()).toBe(false);
    await Promise.all(dispatched);

    expect(connection.isHealthy()).toBe(true);
    expect(observed.events).toEqual([
      { event_id: "event-1", type: "session.created" },
      { event_id: "event-2", type: "response.done" },
    ]);
  });

  it.each([
    ["wrong prefix", "call_123"],
    ["empty", ""],
    ["path injection", "rtc_valid/extra"],
    ["query injection", "rtc_valid&model=other"],
    ["oversized", `rtc_${"a".repeat(252)}`],
  ])("rejects %s call IDs before fetch", async (_label, callId) => {
    const fetch = vi.fn();
    const connector = new OpenAiRealtimeSidebandConnector({
      apiKey: standardApiKey,
      fetch,
    });

    await expect(connector.connect(callId, observer().value)).rejects.toThrow(
      "call ID is invalid",
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects failed upgrades without exposing provider details", async () => {
    const providerBody = "provider-private-error-body";
    const connector = new OpenAiRealtimeSidebandConnector({
      apiKey: standardApiKey,
      fetch: () =>
        Promise.resolve({
          body: providerBody,
          status: 403,
          webSocket: null,
        }),
    });

    const failure = await connector
      .connect("rtc_rejected", observer().value)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(OpenAiRealtimeSidebandError);
    expect(String(failure)).not.toContain(providerBody);
    expect(String(failure)).not.toContain(standardApiKey);
  });

  it.each([
    ["binary", new Uint8Array([1, 2, 3])],
    ["oversized", "x".repeat(MAX_OPENAI_REALTIME_SIDEBAND_EVENT_BYTES + 1)],
    ["malformed JSON", "{"],
  ])("fails closed on %s frames", async (_label, data) => {
    const socket = new FakeSocket();
    const observed = observer();
    const connector = new OpenAiRealtimeSidebandConnector({
      apiKey: standardApiKey,
      fetch: () => Promise.resolve({ status: 101, webSocket: socket }),
    });
    const connection = await connector.connect(
      "rtc_invalid_frame",
      observed.value,
    );

    socket.emit("message", { data });
    expect(connection.isHealthy()).toBe(false);
    await flush();

    expect(observed.events).toEqual([]);
    expect(observed.disconnects).toEqual([
      { clean: false, initiatedByServer: false },
    ]);
    expect(socket.closed).toEqual({
      code: 1011,
      reason: "sideband unavailable",
    });
  });

  it("does not relabel an already queued invalid frame as server-initiated", async () => {
    const socket = new FakeSocket();
    const observed = observer();
    const connection = await new OpenAiRealtimeSidebandConnector({
      apiKey: standardApiKey,
      fetch: () => Promise.resolve({ status: 101, webSocket: socket }),
    }).connect("rtc_close_race", observed.value);

    socket.emit("message", { data: "{" });
    connection.close();
    await flush();

    expect(observed.disconnects).toEqual([
      { clean: false, initiatedByServer: false },
    ]);
  });

  it("reports provider and server-initiated closes exactly once", async () => {
    const providerSocket = new FakeSocket();
    const providerObserved = observer();
    const connector = new OpenAiRealtimeSidebandConnector({
      apiKey: standardApiKey,
      fetch: () => Promise.resolve({ status: 101, webSocket: providerSocket }),
    });
    const providerConnection = await connector.connect(
      "rtc_provider_close",
      providerObserved.value,
    );
    providerSocket.emit("close", { wasClean: true });
    expect(providerConnection.isHealthy()).toBe(false);
    providerSocket.emit("error", {});
    await flush();
    expect(providerObserved.disconnects).toEqual([
      { clean: true, initiatedByServer: false },
    ]);

    const serverSocket = new FakeSocket();
    const serverObserved = observer();
    const serverConnection = await new OpenAiRealtimeSidebandConnector({
      apiKey: standardApiKey,
      fetch: () => Promise.resolve({ status: 101, webSocket: serverSocket }),
    }).connect("rtc_server_close", serverObserved.value);
    serverConnection.close();
    expect(serverConnection.isHealthy()).toBe(false);
    serverSocket.emit("close", { wasClean: true });
    await flush();
    expect(serverObserved.disconnects).toEqual([
      { clean: true, initiatedByServer: true },
    ]);
    expect(serverSocket.closed).toEqual({
      code: 1000,
      reason: "server shutdown",
    });
  });
});
