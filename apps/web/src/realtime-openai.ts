export const OPENAI_REALTIME_CALLS_URL =
  "https://api.openai.com/v1/realtime/calls";

const DEFAULT_IDLE_TIMEOUT_MS = 60_000;
const DEFAULT_RETRY_DELAYS_MS = [250, 500, 1_000] as const;

export type OpenAiRealtimeChannel = "private" | "shared";
export type OpenAiRealtimeStatus =
  "off" | "connecting" | "connected" | "reconnecting" | "degraded";

export interface OpenAiRealtimeState {
  readonly channel: OpenAiRealtimeChannel;
  readonly reconnectAttempt: number;
  readonly status: OpenAiRealtimeStatus;
  readonly textFallbackAvailable: boolean;
}

export interface EphemeralRealtimeSecret {
  readonly clientSecret: string;
}

export interface RealtimeSessionDescription {
  readonly sdp: string;
  readonly type: "answer" | "offer";
}

export interface RealtimeDataChannel {
  close(): void;
}

export type RealtimePeerConnectionState =
  "closed" | "connected" | "connecting" | "disconnected" | "failed" | "new";

export interface RealtimePeerConnection {
  close(): void;
  createDataChannel(label: string): RealtimeDataChannel;
  createOffer(): Promise<RealtimeSessionDescription>;
  getConnectionState(): RealtimePeerConnectionState;
  setConnectionStateListener(listener: () => void): () => void;
  setLocalDescription(description: RealtimeSessionDescription): Promise<void>;
  setRemoteDescription(description: RealtimeSessionDescription): Promise<void>;
}

export type RealtimePeerConnectionFactory = () => RealtimePeerConnection;

export interface RealtimeSdpResponse {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
}

export interface RealtimeSdpRequest {
  readonly body: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly method: "POST";
}

export type RealtimeFetch = (
  input: string,
  init: RealtimeSdpRequest,
) => Promise<RealtimeSdpResponse>;

export interface RealtimeClock {
  now(): number;
}

export interface RealtimeTimer {
  clearTimeout(handle: unknown): void;
  setTimeout(callback: () => void, delayMs: number): unknown;
}

export interface OpenAiRealtimeConnection {
  close(): void;
  readonly peer: RealtimePeerConnection;
}

export interface ConnectOpenAiRealtimeInput {
  readonly clientSecret: string;
  readonly fetch?: RealtimeFetch;
  readonly peerFactory?: RealtimePeerConnectionFactory;
}

export interface OpenAiRealtimeControllerOptions {
  readonly channel: OpenAiRealtimeChannel;
  readonly clock?: RealtimeClock;
  readonly fetch?: RealtimeFetch;
  readonly idleTimeoutMs?: number;
  readonly issueSecret: (
    channel: OpenAiRealtimeChannel,
  ) => Promise<EphemeralRealtimeSecret>;
  readonly peerFactory?: RealtimePeerConnectionFactory;
  readonly retryDelaysMs?: readonly number[];
  readonly timer?: RealtimeTimer;
}

export interface OpenAiRealtimeController {
  readonly close: () => void;
  readonly connect: () => Promise<void>;
  readonly disconnect: () => void;
  readonly getState: () => OpenAiRealtimeState;
  readonly markActivity: () => void;
  readonly subscribe: (listener: () => void) => () => void;
}

export class OpenAiRealtimeConnectionError extends Error {
  constructor() {
    super("OpenAI Realtime connection was unavailable");
    this.name = "OpenAiRealtimeConnectionError";
  }
}

function createBrowserPeerConnection(): RealtimePeerConnection {
  const peer = new RTCPeerConnection();

  return {
    close: () => {
      peer.close();
    },
    createDataChannel: (label) => peer.createDataChannel(label),
    createOffer: async () => {
      const offer = await peer.createOffer();
      if (offer.sdp === undefined) {
        throw new OpenAiRealtimeConnectionError();
      }
      return { sdp: offer.sdp, type: "offer" };
    },
    getConnectionState: () => peer.connectionState,
    setConnectionStateListener: (listener) => {
      peer.addEventListener("connectionstatechange", listener);
      return () => {
        peer.removeEventListener("connectionstatechange", listener);
      };
    },
    setLocalDescription: async (description) => {
      await peer.setLocalDescription(description);
    },
    setRemoteDescription: async (description) => {
      await peer.setRemoteDescription(description);
    },
  };
}

async function browserFetch(
  input: string,
  init: RealtimeSdpRequest,
): Promise<RealtimeSdpResponse> {
  return globalThis.fetch(input, {
    body: init.body,
    headers: init.headers,
    method: init.method,
  });
}

const systemClock: RealtimeClock = {
  now: () => Date.now(),
};

const systemTimer: RealtimeTimer = {
  clearTimeout: (handle) => {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
};

function closePeerResources(
  peer: RealtimePeerConnection,
  dataChannel: RealtimeDataChannel,
): void {
  try {
    dataChannel.close();
  } finally {
    peer.close();
  }
}

export async function connectOpenAiRealtime(
  input: ConnectOpenAiRealtimeInput,
): Promise<OpenAiRealtimeConnection> {
  const peer = (input.peerFactory ?? createBrowserPeerConnection)();
  const dataChannel = peer.createDataChannel("oai-events");
  const fetch = input.fetch ?? browserFetch;
  let closed = false;

  const close = (): void => {
    if (closed) {
      return;
    }
    closed = true;
    closePeerResources(peer, dataChannel);
  };

  try {
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    const response = await fetch(OPENAI_REALTIME_CALLS_URL, {
      body: offer.sdp,
      headers: {
        Authorization: `Bearer ${input.clientSecret}`,
        "Content-Type": "application/sdp",
      },
      method: "POST",
    });
    if (!response.ok) {
      throw new OpenAiRealtimeConnectionError();
    }
    const answerSdp = await response.text();
    if (answerSdp.length === 0) {
      throw new OpenAiRealtimeConnectionError();
    }
    await peer.setRemoteDescription({
      sdp: answerSdp,
      type: "answer",
    });
    return { close, peer };
  } catch {
    close();
    throw new OpenAiRealtimeConnectionError();
  }
}

class DefaultOpenAiRealtimeController implements OpenAiRealtimeController {
  readonly #channel: OpenAiRealtimeChannel;
  readonly #clock: RealtimeClock;
  readonly #fetch: RealtimeFetch | undefined;
  readonly #idleTimeoutMs: number;
  readonly #issueSecret: (
    channel: OpenAiRealtimeChannel,
  ) => Promise<EphemeralRealtimeSecret>;
  readonly #listeners = new Set<() => void>();
  readonly #peerFactory: RealtimePeerConnectionFactory | undefined;
  readonly #retryDelaysMs: readonly number[];
  readonly #timer: RealtimeTimer;

  #connection: OpenAiRealtimeConnection | undefined;
  #disposed = false;
  #generation = 0;
  #idleDeadline = 0;
  #idleTimer?: unknown;
  #removeConnectionStateListener: (() => void) | undefined;
  #retryTimer?: unknown;
  #state: OpenAiRealtimeState;

  constructor(options: OpenAiRealtimeControllerOptions) {
    this.#channel = options.channel;
    this.#clock = options.clock ?? systemClock;
    this.#fetch = options.fetch;
    this.#idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    this.#issueSecret = options.issueSecret;
    this.#peerFactory = options.peerFactory;
    this.#retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
    this.#timer = options.timer ?? systemTimer;
    this.#state = this.#createState("off", 0);
  }

  readonly getState = (): OpenAiRealtimeState => {
    return this.#state;
  };

  readonly subscribe = (listener: () => void): (() => void) => {
    if (this.#disposed) {
      return () => undefined;
    }
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  readonly connect = async (): Promise<void> => {
    if (
      this.#disposed ||
      this.#state.status === "connected" ||
      this.#state.status === "connecting" ||
      this.#state.status === "reconnecting"
    ) {
      return;
    }

    this.#generation += 1;
    const generation = this.#generation;
    this.#clearRetryTimer();
    this.#setState("connecting", 0);
    await this.#attemptConnection(generation);
  };

  readonly disconnect = (): void => {
    if (this.#disposed) {
      return;
    }
    this.#generation += 1;
    this.#clearRetryTimer();
    this.#clearIdleTimer();
    this.#closeConnection();
    this.#setState("off", 0);
  };

  readonly markActivity = (): void => {
    if (this.#disposed || this.#state.status !== "connected") {
      return;
    }
    this.#scheduleIdleClose();
  };

  readonly close = (): void => {
    if (this.#disposed) {
      return;
    }
    this.disconnect();
    this.#disposed = true;
    this.#listeners.clear();
  };

  #createState(
    status: OpenAiRealtimeStatus,
    reconnectAttempt: number,
  ): OpenAiRealtimeState {
    return Object.freeze({
      channel: this.#channel,
      reconnectAttempt,
      status,
      textFallbackAvailable: status === "degraded",
    });
  }

  #setState(status: OpenAiRealtimeStatus, reconnectAttempt: number): void {
    const previous = this.#state;
    if (
      previous.status === status &&
      previous.reconnectAttempt === reconnectAttempt
    ) {
      return;
    }
    this.#state = this.#createState(status, reconnectAttempt);
    for (const listener of this.#listeners) {
      listener();
    }
  }

  async #attemptConnection(generation: number): Promise<void> {
    try {
      const issued = await this.#issueSecret(this.#channel);
      if (!this.#isCurrent(generation)) {
        return;
      }
      const connection = await connectOpenAiRealtime({
        clientSecret: issued.clientSecret,
        ...(this.#fetch === undefined ? {} : { fetch: this.#fetch }),
        ...(this.#peerFactory === undefined
          ? {}
          : { peerFactory: this.#peerFactory }),
      });
      if (!this.#isCurrent(generation)) {
        connection.close();
        return;
      }

      this.#connection = connection;
      this.#removeConnectionStateListener =
        connection.peer.setConnectionStateListener(() => {
          this.#handlePeerStateChange(connection, generation);
        });
      this.#setState("connected", 0);
      this.#scheduleIdleClose();
      this.#handlePeerStateChange(connection, generation);
    } catch {
      if (this.#isCurrent(generation)) {
        this.#scheduleReconnect(generation);
      }
    }
  }

  #handlePeerStateChange(
    connection: OpenAiRealtimeConnection,
    generation: number,
  ): void {
    if (
      !this.#isCurrent(generation) ||
      this.#connection !== connection ||
      this.#state.status !== "connected"
    ) {
      return;
    }
    const peerState = connection.peer.getConnectionState();
    if (
      peerState !== "closed" &&
      peerState !== "disconnected" &&
      peerState !== "failed"
    ) {
      return;
    }
    this.#clearIdleTimer();
    this.#closeConnection();
    this.#scheduleReconnect(generation);
  }

  #scheduleReconnect(generation: number): void {
    this.#clearIdleTimer();
    this.#closeConnection();
    const nextAttempt = this.#state.reconnectAttempt + 1;
    const delay = this.#retryDelaysMs[nextAttempt - 1];
    if (delay === undefined) {
      this.#setState("degraded", this.#retryDelaysMs.length);
      return;
    }

    this.#setState("reconnecting", nextAttempt);
    this.#retryTimer = this.#timer.setTimeout(() => {
      this.#retryTimer = undefined;
      if (!this.#isCurrent(generation)) {
        return;
      }
      void this.#attemptConnection(generation);
    }, delay);
  }

  #scheduleIdleClose(): void {
    this.#clearIdleTimer();
    this.#idleDeadline = this.#clock.now() + this.#idleTimeoutMs;
    this.#scheduleIdleCheck(this.#idleTimeoutMs);
  }

  #scheduleIdleCheck(delayMs: number): void {
    this.#idleTimer = this.#timer.setTimeout(() => {
      this.#idleTimer = undefined;
      if (this.#disposed || this.#state.status !== "connected") {
        return;
      }
      const remaining = this.#idleDeadline - this.#clock.now();
      if (remaining > 0) {
        this.#scheduleIdleCheck(remaining);
        return;
      }
      this.disconnect();
    }, delayMs);
  }

  #clearRetryTimer(): void {
    if (this.#retryTimer === undefined) {
      return;
    }
    this.#timer.clearTimeout(this.#retryTimer);
    this.#retryTimer = undefined;
  }

  #clearIdleTimer(): void {
    if (this.#idleTimer === undefined) {
      return;
    }
    this.#timer.clearTimeout(this.#idleTimer);
    this.#idleTimer = undefined;
  }

  #closeConnection(): void {
    this.#removeConnectionStateListener?.();
    this.#removeConnectionStateListener = undefined;
    this.#connection?.close();
    this.#connection = undefined;
  }

  #isCurrent(generation: number): boolean {
    return !this.#disposed && generation === this.#generation;
  }
}

export function createOpenAiRealtimeController(
  options: OpenAiRealtimeControllerOptions,
): OpenAiRealtimeController {
  return new DefaultOpenAiRealtimeController(options);
}
