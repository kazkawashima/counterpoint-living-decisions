import type {
  ManagedRealtimeSidebandConnection,
  ManagedRealtimeSidebandConnector,
  ManagedRealtimeSidebandObserver,
} from "@counterpoint/ports";

import { GPT_REALTIME_WHISPER_MODEL } from "./realtime-usage.js";

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
  send(data: string): void;
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

function managedSessionConfigured(event: unknown): boolean {
  if (
    typeof event !== "object" ||
    event === null ||
    Array.isArray(event) ||
    (event as { readonly type?: unknown }).type !== "session.updated"
  ) {
    return false;
  }
  const session = (event as { readonly session?: unknown }).session;
  if (
    typeof session !== "object" ||
    session === null ||
    Array.isArray(session)
  ) {
    return false;
  }
  const audio = (session as { readonly audio?: unknown }).audio;
  if (typeof audio !== "object" || audio === null || Array.isArray(audio)) {
    return false;
  }
  const input = (audio as { readonly input?: unknown }).input;
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return false;
  }
  const turnDetection = (input as { readonly turn_detection?: unknown })
    .turn_detection;
  const transcription = (input as { readonly transcription?: unknown })
    .transcription;
  return (
    typeof transcription === "object" &&
    transcription !== null &&
    !Array.isArray(transcription) &&
    (transcription as { readonly model?: unknown }).model ===
      GPT_REALTIME_WHISPER_MODEL &&
    typeof turnDetection === "object" &&
    turnDetection !== null &&
    !Array.isArray(turnDetection) &&
    (turnDetection as { readonly type?: unknown }).type === "server_vad" &&
    (turnDetection as { readonly create_response?: unknown })
      .create_response === false &&
    (turnDetection as { readonly interrupt_response?: unknown })
      .interrupt_response === false
  );
}

function managedSessionUpdate(): string {
  return JSON.stringify({
    session: {
      audio: {
        input: {
          transcription: {
            model: GPT_REALTIME_WHISPER_MODEL,
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
  });
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
    let configured = false;
    let disconnected = false;
    let pendingProviderEvents = 0;
    let socketCloseRequested = false;
    let queue = Promise.resolve();
    let rejectConfiguration: ((error: Error) => void) | undefined;
    let resolveConfiguration: (() => void) | undefined;
    const configuration = new Promise<void>((resolve, reject) => {
      rejectConfiguration = reject;
      resolveConfiguration = resolve;
    });
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
      if (!configured) {
        rejectConfiguration?.(
          new OpenAiRealtimeSidebandError(
            "OpenAI Realtime sideband configuration was unavailable",
          ),
        );
      }
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
      if (!configured && managedSessionConfigured(decoded)) {
        configured = true;
        resolveConfiguration?.();
        return;
      }
      if (
        !configured &&
        typeof decoded === "object" &&
        decoded !== null &&
        !Array.isArray(decoded) &&
        (decoded as { readonly type?: unknown }).type === "error"
      ) {
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
      socket.send(managedSessionUpdate());
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

    let configurationTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        configuration,
        new Promise<never>((_resolve, reject) => {
          configurationTimer = setTimeout(
            () =>
              reject(
                new OpenAiRealtimeSidebandError(
                  "OpenAI Realtime sideband configuration timed out",
                ),
              ),
            DEFAULT_TIMEOUT_MS,
          );
        }),
      ]);
    } catch (error) {
      closeSocket(1011, "sideband configuration failed");
      if (error instanceof OpenAiRealtimeSidebandError) {
        throw error;
      }
      throw new OpenAiRealtimeSidebandError(
        "OpenAI Realtime sideband configuration was unavailable",
      );
    } finally {
      if (configurationTimer !== undefined) {
        clearTimeout(configurationTimer);
      }
    }

    const sendControlledEvent = (event: string): void => {
      if (disconnected || socketCloseRequested) {
        throw new OpenAiRealtimeSidebandError(
          "OpenAI Realtime sideband command channel was unavailable",
        );
      }
      try {
        socket.send(event);
      } catch {
        disconnect(false, true, false);
        throw new OpenAiRealtimeSidebandError(
          "OpenAI Realtime sideband command channel was unavailable",
        );
      }
    };

    return {
      cancelResponse() {
        sendControlledEvent(JSON.stringify({ type: "response.cancel" }));
      },
      close() {
        initiatedByServer = true;
        if (!closeSocket(1000, "server shutdown")) {
          disconnect(false);
        }
      },
      createResponse() {
        sendControlledEvent(JSON.stringify({ type: "response.create" }));
      },
      isHealthy() {
        return (
          !disconnected && !socketCloseRequested && pendingProviderEvents === 0
        );
      },
    };
  }
}
