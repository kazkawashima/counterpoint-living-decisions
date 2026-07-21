export const OPENAI_REALTIME_CALLS_URL =
  "https://api.openai.com/v1/realtime/calls";

const DEFAULT_IDLE_TIMEOUT_MS = 60_000;
const DEFAULT_RETRY_DELAYS_MS = [250, 500, 1_000] as const;

export type OpenAiRealtimeChannel = "private" | "shared";
export type RealtimeFailureStage =
  "access" | "call_creation" | "media" | "peer_negotiation";
export type RealtimeManagedFailureReason =
  | "OFFER_REJECTED"
  | "PROVIDER_LOCATION_INVALID"
  | "PROVIDER_REJECTED"
  | "PROVIDER_SDP_INVALID"
  | "PROVIDER_UNAVAILABLE";
export type RealtimeMediaFailureReason =
  | "MICROPHONE_NOT_FOUND"
  | "MICROPHONE_PERMISSION_DENIED"
  | "MICROPHONE_TRACK_ATTACH_FAILED"
  | "MICROPHONE_UNAVAILABLE";
export type RealtimeFailureReason =
  RealtimeManagedFailureReason | RealtimeMediaFailureReason;
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
  startPushToTalk(utteranceId?: string): Promise<void>;
  stopPushToTalk(): Promise<void>;
}

export interface ConnectOpenAiRealtimeInput {
  readonly clientSecret: string;
  readonly fetch?: RealtimeFetch;
  readonly mediaFactory?: RealtimeMediaFactory;
  readonly onTranscript?: (transcript: string) => void;
  readonly peerFactory?: RealtimePeerConnectionFactory;
}

export interface ConnectManagedOpenAiRealtimeInput {
  readonly awaitTranscript: (input: {
    readonly managedCallId: string;
    readonly utteranceId: string;
  }) => Promise<{ readonly transcript: string }>;
  readonly beginTurn: (input: {
    readonly managedCallId: string;
    readonly utteranceId: string;
  }) => Promise<void>;
  readonly channel: OpenAiRealtimeChannel;
  readonly createCall: (input: {
    readonly channel: OpenAiRealtimeChannel;
    readonly idempotencyKey: string;
    readonly sdpOffer: string;
  }) => Promise<{
    readonly managedCallId: string;
    readonly sdpAnswer: string;
  }>;
  readonly idempotencyKey: string;
  readonly mediaFactory?: RealtimeMediaFactory;
  readonly onTranscript?: (transcript: string) => void;
  readonly peerFactory?: RealtimePeerConnectionFactory;
  readonly terminateCall: (managedCallId: string) => Promise<void>;
}

export type OpenAiRealtimeConnectionFactory = (
  channel: OpenAiRealtimeChannel,
  idempotencyKey: string,
) => Promise<OpenAiRealtimeConnection>;

export interface OpenAiRealtimeControllerOptions {
  readonly channel: OpenAiRealtimeChannel;
  readonly clock?: RealtimeClock;
  readonly connect?: OpenAiRealtimeConnectionFactory;
  readonly fetch?: RealtimeFetch;
  readonly idleTimeoutMs?: number;
  readonly issueSecret?: (
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
  readonly startPushToTalk: (utteranceId?: string) => Promise<void>;
  readonly stopPushToTalk: () => Promise<void>;
  readonly subscribe: (listener: () => void) => () => void;
}

export class OpenAiRealtimeConnectionError extends Error {
  constructor() {
    super("OpenAI Realtime connection was unavailable");
    this.name = "OpenAiRealtimeConnectionError";
  }
}

export class RealtimeConnectionStageError extends Error {
  readonly code = "REALTIME_CONNECT_FAILED";

  constructor(
    readonly stage: RealtimeFailureStage,
    message: string,
    readonly retryable = true,
    readonly safeReason?: RealtimeFailureReason,
  ) {
    super(message);
    this.name = "RealtimeConnectionStageError";
  }
}

const SAFE_MANAGED_FAILURE_REASONS = new Set<RealtimeManagedFailureReason>([
  "OFFER_REJECTED",
  "PROVIDER_LOCATION_INVALID",
  "PROVIDER_REJECTED",
  "PROVIDER_SDP_INVALID",
  "PROVIDER_UNAVAILABLE",
]);

function safeManagedFailureReason(
  error: unknown,
): RealtimeManagedFailureReason | undefined {
  if (
    typeof error !== "object" ||
    error === null ||
    !("code" in error) ||
    error.code !== "REALTIME_UNAVAILABLE" ||
    !("details" in error) ||
    typeof error.details !== "object" ||
    error.details === null ||
    !("reason" in error.details) ||
    typeof error.details.reason !== "string" ||
    !SAFE_MANAGED_FAILURE_REASONS.has(
      error.details.reason as RealtimeManagedFailureReason,
    )
  ) {
    return undefined;
  }
  return error.details.reason as RealtimeManagedFailureReason;
}

function safeMediaFailureReason(
  error: unknown,
): RealtimeMediaFailureReason | undefined {
  if (
    typeof error !== "object" ||
    error === null ||
    !("name" in error) ||
    typeof error.name !== "string"
  ) {
    return undefined;
  }
  switch (error.name) {
    case "NotAllowedError":
    case "SecurityError":
      return "MICROPHONE_PERMISSION_DENIED";
    case "NotFoundError":
    case "OverconstrainedError":
      return "MICROPHONE_NOT_FOUND";
    case "AbortError":
    case "NotReadableError":
      return "MICROPHONE_UNAVAILABLE";
    default:
      return undefined;
  }
}

function isPermanentConnectionFailure(
  error: unknown,
): error is Error & { readonly code: string; readonly retryable: false } {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    "retryable" in error &&
    error.retryable === false
  );
}

function isRetryableRealtimeCallStatus(status: number): boolean {
  return (
    status === 408 ||
    status === 425 ||
    status === 429 ||
    (status >= 500 && status <= 599)
  );
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

function runBestEffortCleanup(cleanup: () => void): void {
  try {
    cleanup();
  } catch {
    // Cleanup must never replace the original classified failure.
  }
}

async function runBestEffortAsyncCleanup(
  cleanup: () => Promise<void>,
): Promise<void> {
  try {
    await cleanup();
  } catch {
    // Async cleanup must never replace the original classified failure.
  }
}

function closePeerResources(
  peer: RealtimePeerConnection,
  dataChannel: RealtimeDataChannel,
): void {
  runBestEffortCleanup(() => dataChannel.close());
  runBestEffortCleanup(() => peer.close());
}

function closePeerAfterSetupFailure(peer: RealtimePeerConnection): void {
  runBestEffortCleanup(() => peer.close());
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
  let peer: RealtimePeerConnection;
  try {
    peer = (input.peerFactory ?? createBrowserPeerConnection)();
  } catch {
    throw new RealtimeConnectionStageError(
      "peer_negotiation",
      "Realtime peer negotiation failed.",
    );
  }
  let audioSender: RealtimeAudioSender;
  try {
    audioSender = peer.createAudioSender();
  } catch {
    closePeerAfterSetupFailure(peer);
    throw new RealtimeConnectionStageError(
      "peer_negotiation",
      "Realtime peer negotiation failed.",
    );
  }
  let dataChannel: RealtimeDataChannel;
  try {
    dataChannel = peer.createDataChannel("oai-events");
  } catch {
    closePeerAfterSetupFailure(peer);
    throw new RealtimeConnectionStageError(
      "peer_negotiation",
      "Realtime peer negotiation failed.",
    );
  }
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
    const track = activeTrack;
    activeTrack = undefined;
    const removeMessage = removeMessageListener;
    removeMessageListener = undefined;
    const removeOpen = removeOpenListener;
    removeOpenListener = undefined;
    if (track !== undefined) {
      runBestEffortCleanup(() => track.stop());
    }
    if (removeMessage !== undefined) {
      runBestEffortCleanup(removeMessage);
    }
    if (removeOpen !== undefined) {
      runBestEffortCleanup(removeOpen);
    }
    closePeerResources(peer, dataChannel);
  };

  try {
    let offer: RealtimeSessionDescription;
    try {
      offer = await peer.createOffer();
    } catch {
      throw new RealtimeConnectionStageError(
        "peer_negotiation",
        "Realtime peer negotiation failed.",
      );
    }
    try {
      await peer.setLocalDescription(offer);
    } catch {
      throw new RealtimeConnectionStageError(
        "peer_negotiation",
        "Realtime peer negotiation failed.",
      );
    }
    let response: RealtimeSdpResponse;
    try {
      response = await fetch(OPENAI_REALTIME_CALLS_URL, {
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${input.clientSecret}`,
          "Content-Type": "application/sdp",
        },
        method: "POST",
      });
    } catch {
      throw new RealtimeConnectionStageError(
        "call_creation",
        "Realtime call creation failed.",
      );
    }
    if (!response.ok) {
      throw new RealtimeConnectionStageError(
        "call_creation",
        "Realtime call creation failed.",
        isRetryableRealtimeCallStatus(response.status),
      );
    }
    let answerSdp: string;
    try {
      answerSdp = await response.text();
    } catch {
      throw new RealtimeConnectionStageError(
        "call_creation",
        "Realtime call creation failed.",
      );
    }
    if (answerSdp.length === 0) {
      throw new RealtimeConnectionStageError(
        "call_creation",
        "Realtime call creation failed.",
      );
    }
    try {
      await peer.setRemoteDescription({
        sdp: answerSdp,
        type: "answer",
      });
    } catch {
      throw new RealtimeConnectionStageError(
        "peer_negotiation",
        "Realtime peer negotiation failed.",
      );
    }
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
        let stream: RealtimeMediaStream;
        try {
          stream = await mediaFactory();
        } catch (cause) {
          throw new RealtimeConnectionStageError(
            "media",
            "Microphone setup failed.",
            true,
            safeMediaFailureReason(cause),
          );
        }
        const track = stream.getAudioTracks()[0];
        if (track === undefined || closed) {
          if (track !== undefined) {
            runBestEffortCleanup(() => track.stop());
          }
          throw new RealtimeConnectionStageError(
            "media",
            "Microphone setup failed.",
            true,
            "MICROPHONE_NOT_FOUND",
          );
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
          runBestEffortCleanup(() => track.stop());
          await runBestEffortAsyncCleanup(() => audioSender.replaceTrack(null));
          throw new RealtimeConnectionStageError(
            "media",
            "Microphone setup failed.",
            true,
            "MICROPHONE_TRACK_ATTACH_FAILED",
          );
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
          await runBestEffortAsyncCleanup(() => audioSender.replaceTrack(null));
          runBestEffortCleanup(() => track.stop());
        }
      },
    };
  } catch (cause) {
    close();
    if (
      cause instanceof RealtimeConnectionStageError ||
      isPermanentConnectionFailure(cause)
    ) {
      throw cause;
    }
    throw new OpenAiRealtimeConnectionError();
  }
}

export async function connectManagedOpenAiRealtime(
  input: ConnectManagedOpenAiRealtimeInput,
): Promise<OpenAiRealtimeConnection> {
  let peer: RealtimePeerConnection;
  try {
    peer = (input.peerFactory ?? createBrowserPeerConnection)();
  } catch {
    throw new RealtimeConnectionStageError(
      "peer_negotiation",
      "Realtime peer negotiation failed.",
    );
  }
  let audioSender: RealtimeAudioSender;
  try {
    audioSender = peer.createAudioSender();
  } catch {
    closePeerAfterSetupFailure(peer);
    throw new RealtimeConnectionStageError(
      "peer_negotiation",
      "Realtime peer negotiation failed.",
    );
  }
  const mediaFactory = input.mediaFactory ?? browserMediaFactory;
  let activeTrack: RealtimeAudioTrack | undefined;
  let activeUtteranceId: string | undefined;
  let callCreated = false;
  let closed = false;
  let managedCallId: string | undefined;
  let terminationRequested = false;

  const terminate = (): void => {
    if (managedCallId === undefined || !callCreated || terminationRequested) {
      return;
    }
    const callId = managedCallId;
    terminationRequested = true;
    runBestEffortCleanup(() => {
      void input.terminateCall(callId).catch(() => undefined);
    });
  };
  const close = (): void => {
    if (closed) {
      return;
    }
    closed = true;
    const track = activeTrack;
    activeTrack = undefined;
    activeUtteranceId = undefined;
    if (track !== undefined) {
      runBestEffortCleanup(() => track.stop());
    }
    terminate();
    runBestEffortCleanup(() => peer.close());
  };

  try {
    let offer: RealtimeSessionDescription;
    try {
      offer = await peer.createOffer();
    } catch {
      throw new RealtimeConnectionStageError(
        "peer_negotiation",
        "Realtime peer negotiation failed.",
      );
    }
    try {
      await peer.setLocalDescription(offer);
    } catch {
      throw new RealtimeConnectionStageError(
        "peer_negotiation",
        "Realtime peer negotiation failed.",
      );
    }
    let answer: Awaited<ReturnType<typeof input.createCall>>;
    try {
      answer = await input.createCall({
        channel: input.channel,
        idempotencyKey: input.idempotencyKey,
        sdpOffer: offer.sdp,
      });
    } catch (cause) {
      if (isPermanentConnectionFailure(cause)) {
        throw cause;
      }
      throw new RealtimeConnectionStageError(
        "call_creation",
        "Realtime call creation failed.",
        true,
        safeManagedFailureReason(cause),
      );
    }
    managedCallId = answer.managedCallId;
    callCreated = true;
    if (answer.sdpAnswer.trim().length === 0) {
      throw new RealtimeConnectionStageError(
        "peer_negotiation",
        "Realtime peer negotiation failed.",
      );
    }
    try {
      await peer.setRemoteDescription({
        sdp: answer.sdpAnswer,
        type: "answer",
      });
    } catch {
      throw new RealtimeConnectionStageError(
        "peer_negotiation",
        "Realtime peer negotiation failed.",
      );
    }
    return {
      close,
      peer,
      sendText: () => {
        throw new OpenAiRealtimeConnectionError();
      },
      startPushToTalk: async (utteranceId) => {
        if (
          activeTrack !== undefined ||
          managedCallId === undefined ||
          utteranceId === undefined ||
          utteranceId.trim().length === 0
        ) {
          if (activeTrack !== undefined) {
            return;
          }
          throw new OpenAiRealtimeConnectionError();
        }
        if (closed) {
          throw new OpenAiRealtimeConnectionError();
        }
        if (activeTrack !== undefined) {
          return;
        }
        let stream: RealtimeMediaStream;
        try {
          stream = await mediaFactory();
        } catch (cause) {
          throw new RealtimeConnectionStageError(
            "media",
            "Microphone setup failed.",
            true,
            safeMediaFailureReason(cause),
          );
        }
        const track = stream.getAudioTracks()[0];
        if (track === undefined || closed) {
          if (track !== undefined) {
            runBestEffortCleanup(() => track.stop());
          }
          throw new RealtimeConnectionStageError(
            "media",
            "Microphone setup failed.",
            true,
            "MICROPHONE_NOT_FOUND",
          );
        }
        track.enabled = false;
        try {
          await audioSender.replaceTrack(track);
          if (closed) {
            throw new OpenAiRealtimeConnectionError();
          }
        } catch {
          runBestEffortCleanup(() => track.stop());
          await runBestEffortAsyncCleanup(() => audioSender.replaceTrack(null));
          throw new RealtimeConnectionStageError(
            "media",
            "Microphone setup failed.",
            true,
            "MICROPHONE_TRACK_ATTACH_FAILED",
          );
        }
        try {
          await input.beginTurn({ managedCallId, utteranceId });
          if (closed) {
            throw new OpenAiRealtimeConnectionError();
          }
        } catch {
          await runBestEffortAsyncCleanup(() => audioSender.replaceTrack(null));
          runBestEffortCleanup(() => track.stop());
          throw new OpenAiRealtimeConnectionError();
        }
        activeTrack = track;
        activeUtteranceId = utteranceId;
        track.enabled = true;
      },
      stopPushToTalk: async () => {
        const track = activeTrack;
        const utteranceId = activeUtteranceId;
        if (
          track === undefined ||
          utteranceId === undefined ||
          managedCallId === undefined
        ) {
          return;
        }
        track.enabled = false;
        activeTrack = undefined;
        activeUtteranceId = undefined;
        await runBestEffortAsyncCleanup(() => audioSender.replaceTrack(null));
        runBestEffortCleanup(() => track.stop());
        try {
          const completed = await input.awaitTranscript({
            managedCallId,
            utteranceId,
          });
          input.onTranscript?.(completed.transcript);
        } catch {
          throw new OpenAiRealtimeConnectionError();
        }
      },
    };
  } catch (cause) {
    close();
    if (
      cause instanceof RealtimeConnectionStageError ||
      isPermanentConnectionFailure(cause)
    ) {
      throw cause;
    }
    throw new OpenAiRealtimeConnectionError();
  }
}

class DefaultOpenAiRealtimeController implements OpenAiRealtimeController {
  readonly #channel: OpenAiRealtimeChannel;
  readonly #clock: RealtimeClock;
  readonly #connect: OpenAiRealtimeConnectionFactory;
  readonly #idleTimeoutMs: number;
  readonly #listeners = new Set<() => void>();
  readonly #retryDelaysMs: readonly number[];
  readonly #timer: RealtimeTimer;

  #connection: OpenAiRealtimeConnection | undefined;
  #connectionIdempotencyKey = "";
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
    this.#idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    if (options.connect !== undefined) {
      this.#connect = options.connect;
    } else {
      const issueSecret = options.issueSecret;
      if (issueSecret === undefined) {
        throw new TypeError("Realtime connection source is required");
      }
      this.#connect = async (channel) => {
        const issued = await issueSecret(channel);
        return connectOpenAiRealtime({
          clientSecret: issued.clientSecret,
          ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
          ...(options.mediaFactory === undefined
            ? {}
            : { mediaFactory: options.mediaFactory }),
          ...(options.onTranscript === undefined
            ? {}
            : { onTranscript: options.onTranscript }),
          ...(options.peerFactory === undefined
            ? {}
            : { peerFactory: options.peerFactory }),
        });
      };
    }
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
    this.#connectionIdempotencyKey = crypto.randomUUID();
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

  readonly startPushToTalk = async (utteranceId?: string): Promise<void> => {
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
      await connection.startPushToTalk(utteranceId);
      if (connection !== this.#connection) {
        await connection.stopPushToTalk();
        throw new OpenAiRealtimeConnectionError();
      }
      this.#setMicrophone("live");
      this.#scheduleIdleClose();
    } catch (cause) {
      this.#setMicrophone("off");
      if (cause instanceof RealtimeConnectionStageError) {
        throw cause;
      }
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
      const connection = await this.#connect(
        this.#channel,
        this.#connectionIdempotencyKey,
      );
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
    } catch (cause) {
      if (this.#isCurrent(generation)) {
        if (isPermanentConnectionFailure(cause)) {
          this.#setState("degraded", 0);
        } else {
          this.#scheduleReconnect(generation);
        }
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
    this.#connectionIdempotencyKey = crypto.randomUUID();
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
