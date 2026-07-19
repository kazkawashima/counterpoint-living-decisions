import type {
  ManagedRealtimeSidebandConnection,
  ManagedRealtimeSidebandConnector,
  ManagedRealtimeSidebandObserver,
} from "@counterpoint/ports";

export const OPENAI_REALTIME_SIDEBAND_URL =
  "https://api.openai.com/v1/realtime";
export const MAX_OPENAI_REALTIME_SIDEBAND_EVENT_BYTES = 64 * 1024;

const DEFAULT_TIMEOUT_MS = 10_000;
const REALTIME_CALL_ID_PATTERN = /^rtc_[A-Za-z0-9_-]+$/u;
const MAX_CALL_ID_LENGTH = 255;

interface SidebandMessageEvent {
  readonly data: unknown;
}

interface SidebandCloseEvent {
  readonly wasClean: boolean;
}

interface SidebandSocket {
  accept(): void;
  addEventListener(
    type: "close",
    listener: (event: SidebandCloseEvent) => void,
  ): void;
  addEventListener(type: "error", listener: (event: unknown) => void): void;
  addEventListener(
    type: "message",
    listener: (event: SidebandMessageEvent) => void,
  ): void;
  close(code?: number, reason?: string): void;
}

interface SidebandUpgradeResponse {
  readonly status: number;
  readonly webSocket?: SidebandSocket | null;
}

type SidebandFetch = (
  input: string,
  init: RequestInit,
) => Promise<SidebandUpgradeResponse>;

export interface OpenAiRealtimeSidebandConnectorOptions {
  readonly apiKey: string;
  readonly dispatch?: (work: Promise<void>) => void;
  readonly fetch?: SidebandFetch;
}

export class OpenAiRealtimeSidebandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenAiRealtimeSidebandError";
  }
}

function callId(value: string): string {
  if (
    !REALTIME_CALL_ID_PATTERN.test(value) ||
    value.length > MAX_CALL_ID_LENGTH
  ) {
    throw new OpenAiRealtimeSidebandError(
      "OpenAI Realtime sideband call ID is invalid",
    );
  }
  return value;
}

function decodeProviderEvent(data: unknown): unknown {
  if (typeof data !== "string") {
    throw new OpenAiRealtimeSidebandError(
      "OpenAI Realtime sideband returned a non-text event",
    );
  }
  if (
    new TextEncoder().encode(data).byteLength >
    MAX_OPENAI_REALTIME_SIDEBAND_EVENT_BYTES
  ) {
    throw new OpenAiRealtimeSidebandError(
      "OpenAI Realtime sideband returned an oversized event",
    );
  }
  try {
    return JSON.parse(data);
  } catch {
    throw new OpenAiRealtimeSidebandError(
      "OpenAI Realtime sideband returned invalid JSON",
    );
  }
}

export class OpenAiRealtimeSidebandConnector implements ManagedRealtimeSidebandConnector {
  readonly #apiKey: string;
  readonly #dispatch: (work: Promise<void>) => void;
  readonly #fetch: SidebandFetch;

  constructor(options: OpenAiRealtimeSidebandConnectorOptions) {
    if (
      options.apiKey.trim().length === 0 ||
      options.apiKey.trim() !== options.apiKey
    ) {
      throw new TypeError(
        "OpenAI Realtime sideband API key must be nonempty and trimmed",
      );
    }
    this.#apiKey = options.apiKey;
    this.#dispatch = options.dispatch ?? ((work) => void work);
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  async connect(
    providerCallId: string,
    observer: ManagedRealtimeSidebandObserver,
  ): Promise<ManagedRealtimeSidebandConnection> {
    const selectedCallId = callId(providerCallId);
    let response: SidebandUpgradeResponse;
    try {
      response = await this.#fetch(
        `${OPENAI_REALTIME_SIDEBAND_URL}?call_id=${encodeURIComponent(selectedCallId)}`,
        {
          headers: {
            Authorization: `Bearer ${this.#apiKey}`,
            Upgrade: "websocket",
          },
          redirect: "error",
          signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
        },
      );
    } catch {
      throw new OpenAiRealtimeSidebandError(
        "OpenAI Realtime sideband connection was unavailable",
      );
    }
    const socket = response.webSocket;
    if (response.status !== 101 || socket === undefined || socket === null) {
      throw new OpenAiRealtimeSidebandError(
        "OpenAI Realtime sideband upgrade was rejected",
      );
    }

    let initiatedByServer = false;
    let disconnected = false;
    let pendingProviderEvents = 0;
    let socketCloseRequested = false;
    let queue = Promise.resolve();
    const closeSocket = (code: number, reason: string): boolean => {
      if (socketCloseRequested) {
        return true;
      }
      socketCloseRequested = true;
      try {
        socket.close(code, reason);
        return true;
      } catch {
        // Disconnect notification below remains content-free and authoritative.
        return false;
      }
    };
    const disconnect = (
      clean: boolean,
      closeUnderlyingSocket = false,
      disconnectedByServer = initiatedByServer,
    ) => {
      if (closeUnderlyingSocket) {
        closeSocket(1011, "sideband unavailable");
      }
      if (disconnected) {
        return;
      }
      disconnected = true;
      queue = queue
        .catch(() => undefined)
        .then(() =>
          observer.onDisconnect({
            clean,
            initiatedByServer: disconnectedByServer,
          }),
        )
        .catch(() => undefined);
      this.#dispatch(queue);
    };
    const enqueueProviderEvent = (data: unknown) => {
      if (disconnected) {
        return;
      }
      let decoded: unknown;
      try {
        decoded = decodeProviderEvent(data);
      } catch {
        disconnect(false, true, initiatedByServer);
        return;
      }
      const initiatedWhenQueued = initiatedByServer;
      pendingProviderEvents += 1;
      queue = queue.then(async () => {
        try {
          await observer.onProviderEvent(decoded);
        } catch {
          disconnect(false, true, initiatedWhenQueued);
        } finally {
          pendingProviderEvents -= 1;
        }
      });
      this.#dispatch(queue);
    };

    try {
      socket.addEventListener("message", (event) => {
        enqueueProviderEvent(event.data);
      });
      socket.addEventListener("close", (event) => {
        disconnect(event.wasClean);
      });
      socket.addEventListener("error", () => {
        disconnect(false, true);
      });
      socket.accept();
    } catch {
      try {
        socket.close(1011, "sideband setup failed");
      } catch {
        // The sanitized setup error below remains the public failure.
      }
      throw new OpenAiRealtimeSidebandError(
        "OpenAI Realtime sideband setup was unavailable",
      );
    }

    return {
      close() {
        initiatedByServer = true;
        if (!closeSocket(1000, "server shutdown")) {
          disconnect(false);
        }
      },
      isHealthy() {
        return (
          !disconnected && !socketCloseRequested && pendingProviderEvents === 0
        );
      },
    };
  }
}
