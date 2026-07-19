export const OPENAI_REALTIME_CALLS_URL =
  "https://api.openai.com/v1/realtime/calls";

const DEFAULT_IDLE_TIMEOUT_MS = 60_000;
const DEFAULT_RETRY_DELAYS_MS = [250, 500, 1_000] as const;

export type OpenAiRealtimeChannel = "private" | "shared";
export type OpenAiRealtimeStatus =
  "off" | "connecting" | "connected" | "reconnecting" | "degraded";

export interface OpenAiRealtimeState {
  readonly channel: OpenAiRealtimeChannel;
  readonly microphone: "live" | "off" | "requesting";
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
  getReadyState(): "closed" | "closing" | "connecting" | "open";
  send(data: string): void;
  setMessageListener(listener: (data: string) => void): () => void;
  setOpenListener(listener: () => void): () => void;
}

export interface RealtimeAudioTrack {
  enabled: boolean;
  stop(): void;
}

export interface RealtimeAudioSender {
  replaceTrack(track: RealtimeAudioTrack | null): Promise<void>;
}

export interface RealtimeMediaStream {
  getAudioTracks(): readonly RealtimeAudioTrack[];
}

export type RealtimePeerConnectionState =
  "closed" | "connected" | "connecting" | "disconnected" | "failed" | "new";

export interface RealtimePeerConnection {
  close(): void;
  createAudioSender(): RealtimeAudioSender;
  createDataChannel(label: string): RealtimeDataChannel;
  createOffer(): Promise<RealtimeSessionDescription>;
  getConnectionState(): RealtimePeerConnectionState;
  setConnectionStateListener(listener: () => void): () => void;
  setLocalDescription(description: RealtimeSessionDescription): Promise<void>;
  setRemoteDescription(description: RealtimeSessionDescription): Promise<void>;
}

export type RealtimePeerConnectionFactory = () => RealtimePeerConnection;
export type RealtimeMediaFactory = () => Promise<RealtimeMediaStream>;

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
  sendText(text: string): void;
  startPushToTalk(): Promise<void>;
  stopPushToTalk(): Promise<void>;
}

export interface ConnectOpenAiRealtimeInput {
  readonly clientSecret: string;
  readonly fetch?: RealtimeFetch;
  readonly mediaFactory?: RealtimeMediaFactory;
  readonly onTranscript?: (transcript: string) => void;
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
  readonly mediaFactory?: RealtimeMediaFactory;
  readonly onTranscript?: (transcript: string) => void;
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
  readonly sendText: (text: string) => void;
  readonly startPushToTalk: () => Promise<void>;
  readonly stopPushToTalk: () => Promise<void>;
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
  const audioElement = document.createElement("audio");
  audioElement.autoplay = true;
  peer.addEventListener("track", (event) => {
    audioElement.srcObject = event.streams[0] ?? null;
  });

  return {
    close: () => {
      audioElement.srcObject = null;
      audioElement.remove();
      peer.close();
    },
    createAudioSender: () => {
      const sender = peer.addTransceiver("audio", {
        direction: "sendrecv",
      }).sender;
      return {
        replaceTrack: (track) =>
          sender.replaceTrack(track as MediaStreamTrack | null),
      };
    },
    createDataChannel: (label) => {
      const channel = peer.createDataChannel(label);
      return {
        close: () => channel.close(),
        getReadyState: () => channel.readyState,
        send: (data) => channel.send(data),
        setMessageListener: (listener) => {
          const handleMessage = (event: MessageEvent<unknown>) => {
            if (typeof event.data === "string") {
              listener(event.data);
            }
          };
          channel.addEventListener("message", handleMessage);
          return () => channel.removeEventListener("message", handleMessage);
        },
        setOpenListener: (listener) => {
          channel.addEventListener("open", listener);
          return () => channel.removeEventListener("open", listener);
        },
      };
    },
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

async function browserMediaFactory(): Promise<RealtimeMediaStream> {
  return navigator.mediaDevices.getUserMedia({ audio: true });
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

function transcriptFromServerEvent(
  serialized: string,
): { readonly itemId: string; readonly transcript: string } | undefined {
  let event: unknown;
  try {
    event = JSON.parse(serialized);
  } catch {
    return undefined;
  }
  if (typeof event !== "object" || event === null) {
    return undefined;
  }
  const candidate = event as {
    readonly item?: {
      readonly content?: readonly {
        readonly transcript?: unknown;
        readonly type?: unknown;
      }[];
      readonly id?: unknown;
      readonly role?: unknown;
    };
    readonly item_id?: unknown;
    readonly transcript?: unknown;
    readonly type?: unknown;
  };
  if (
    candidate.type ===
      "conversation.item.input_audio_transcription.completed" &&
    typeof candidate.item_id === "string" &&
    typeof candidate.transcript === "string" &&
    candidate.transcript.trim().length > 0
  ) {
    return {
      itemId: candidate.item_id,
      transcript: candidate.transcript.trim(),
    };
  }
  if (
    candidate.type !== "conversation.item.done" ||
    candidate.item?.role !== "user" ||
    typeof candidate.item.id !== "string"
  ) {
    return undefined;
  }
  const transcript = candidate.item.content?.find(
    (part) =>
      part.type === "input_audio" &&
      typeof part.transcript === "string" &&
      part.transcript.trim().length > 0,
  )?.transcript;
  return typeof transcript === "string"
    ? { itemId: candidate.item.id, transcript: transcript.trim() }
    : undefined;
}

export async function connectOpenAiRealtime(
  input: ConnectOpenAiRealtimeInput,
): Promise<OpenAiRealtimeConnection> {
  const peer = (input.peerFactory ?? createBrowserPeerConnection)();
  const audioSender = peer.createAudioSender();
  const dataChannel = peer.createDataChannel("oai-events");
  const fetch = input.fetch ?? browserFetch;
  const mediaFactory = input.mediaFactory ?? browserMediaFactory;
  const deliveredTranscriptItems = new Set<string>();
  let activeTrack: RealtimeAudioTrack | undefined;
  let closed = false;
  let removeMessageListener: (() => void) | undefined;
  let removeOpenListener: (() => void) | undefined;

  const sendEvent = (event: Readonly<Record<string, unknown>>): void => {
    if (closed || dataChannel.getReadyState() !== "open") {
      throw new OpenAiRealtimeConnectionError();
    }
    dataChannel.send(JSON.stringify(event));
  };

  const configureManualTurnTaking = (): void => {
    sendEvent({
      session: {
        audio: {
          input: {
            transcription: { model: "gpt-4o-mini-transcribe" },
            turn_detection: null,
          },
        },
      },
      type: "session.update",
    });
  };

  const close = (): void => {
    if (closed) {
      return;
    }
    closed = true;
    activeTrack?.stop();
    activeTrack = undefined;
    removeMessageListener?.();
    removeOpenListener?.();
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
    removeMessageListener = dataChannel.setMessageListener((serialized) => {
      const completed = transcriptFromServerEvent(serialized);
      if (
        completed === undefined ||
        deliveredTranscriptItems.has(completed.itemId)
      ) {
        return;
      }
      deliveredTranscriptItems.add(completed.itemId);
      input.onTranscript?.(completed.transcript);
    });
    if (dataChannel.getReadyState() === "open") {
      configureManualTurnTaking();
    } else {
      removeOpenListener = dataChannel.setOpenListener(
        configureManualTurnTaking,
      );
    }
    return {
      close,
      peer,
      sendText: (text) => {
        const canonicalText = text.trim();
        if (canonicalText.length === 0) {
          throw new OpenAiRealtimeConnectionError();
        }
        sendEvent({
          item: {
            content: [{ text: canonicalText, type: "input_text" }],
            role: "user",
            type: "message",
          },
          type: "conversation.item.create",
        });
        sendEvent({ type: "response.create" });
      },
      startPushToTalk: async () => {
        if (activeTrack !== undefined) {
          return;
        }
        const stream = await mediaFactory();
        const track = stream.getAudioTracks()[0];
        if (track === undefined || closed) {
          track?.stop();
          throw new OpenAiRealtimeConnectionError();
        }
        track.enabled = false;
        try {
          await audioSender.replaceTrack(track);
          if (closed) {
            throw new OpenAiRealtimeConnectionError();
          }
          sendEvent({ type: "input_audio_buffer.clear" });
          activeTrack = track;
          track.enabled = true;
        } catch {
          track.stop();
          await audioSender.replaceTrack(null).catch(() => undefined);
          throw new OpenAiRealtimeConnectionError();
        }
      },
      stopPushToTalk: async () => {
        const track = activeTrack;
        if (track === undefined) {
          return;
        }
        track.enabled = false;
        activeTrack = undefined;
        try {
          sendEvent({ type: "input_audio_buffer.commit" });
          sendEvent({ type: "response.create" });
        } finally {
          await audioSender.replaceTrack(null).catch(() => undefined);
          track.stop();
        }
      },
    };
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
  readonly #mediaFactory: RealtimeMediaFactory | undefined;
  readonly #onTranscript: ((transcript: string) => void) | undefined;
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
    this.#mediaFactory = options.mediaFactory;
    this.#onTranscript = options.onTranscript;
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

  readonly sendText = (text: string): void => {
    if (this.#disposed || this.#state.status !== "connected") {
      return;
    }
    this.#connection?.sendText(text);
    this.#scheduleIdleClose();
  };

  readonly startPushToTalk = async (): Promise<void> => {
    if (
      this.#disposed ||
      this.#state.status !== "connected" ||
      this.#connection === undefined ||
      this.#state.microphone !== "off"
    ) {
      throw new OpenAiRealtimeConnectionError();
    }
    const connection = this.#connection;
    this.#setMicrophone("requesting");
    try {
      await connection.startPushToTalk();
      if (connection !== this.#connection) {
        await connection.stopPushToTalk();
        throw new OpenAiRealtimeConnectionError();
      }
      this.#setMicrophone("live");
      this.#scheduleIdleClose();
    } catch {
      this.#setMicrophone("off");
      throw new OpenAiRealtimeConnectionError();
    }
  };

  readonly stopPushToTalk = async (): Promise<void> => {
    if (
      this.#disposed ||
      this.#connection === undefined ||
      this.#state.microphone === "off"
    ) {
      return;
    }
    const connection = this.#connection;
    try {
      await connection.stopPushToTalk();
    } finally {
      if (connection === this.#connection) {
        this.#setMicrophone("off");
        this.#scheduleIdleClose();
      }
    }
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
      microphone: "off" as const,
      reconnectAttempt,
      status,
      textFallbackAvailable: status === "degraded",
    });
  }

  #setMicrophone(microphone: OpenAiRealtimeState["microphone"]): void {
    if (this.#state.microphone === microphone) {
      return;
    }
    this.#state = Object.freeze({ ...this.#state, microphone });
    for (const listener of this.#listeners) {
      listener();
    }
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
        ...(this.#mediaFactory === undefined
          ? {}
          : { mediaFactory: this.#mediaFactory }),
        ...(this.#onTranscript === undefined
          ? {}
          : { onTranscript: this.#onTranscript }),
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
