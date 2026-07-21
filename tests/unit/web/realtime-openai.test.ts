import {
  OPENAI_REALTIME_CALLS_URL,
  OpenAiRealtimeConnectionError,
  connectManagedOpenAiRealtime,
  connectOpenAiRealtime,
  createOpenAiRealtimeController,
  type OpenAiRealtimeChannel,
  type OpenAiRealtimeState,
  type RealtimeAudioTrack,
  type RealtimeDataChannel,
  type RealtimeFetch,
  type RealtimePeerConnection,
  type RealtimePeerConnectionState,
  type RealtimeSessionDescription,
} from "../../../apps/web/src/realtime-openai.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class FakeDataChannel implements RealtimeDataChannel {
  closed = false;
  readonly sent: string[] = [];
  #messageListener: ((data: string) => void) | undefined;
  #openListener: (() => void) | undefined;

  close(): void {
    this.closed = true;
  }

  getReadyState(): "closed" | "closing" | "connecting" | "open" {
    return this.closed ? "closed" : "open";
  }

  send(data: string): void {
    this.sent.push(data);
  }

  setMessageListener(listener: (data: string) => void): () => void {
    this.#messageListener = listener;
    return () => {
      if (this.#messageListener === listener) {
        this.#messageListener = undefined;
      }
    };
  }

  setOpenListener(listener: () => void): () => void {
    this.#openListener = listener;
    return () => {
      if (this.#openListener === listener) {
        this.#openListener = undefined;
      }
    };
  }

  emitMessage(event: unknown): void {
    this.#messageListener?.(JSON.stringify(event));
  }
}

class FakeAudioTrack implements RealtimeAudioTrack {
  enabled = true;
  stopped = false;

  stop(): void {
    this.stopped = true;
  }
}

function parsedEvents(channel: FakeDataChannel | undefined): unknown[] {
  return (
    channel?.sent.map((serialized) => JSON.parse(serialized) as unknown) ?? []
  );
}

class FakePeer implements RealtimePeerConnection {
  readonly channels: { channel: FakeDataChannel; label: string }[] = [];
  readonly localDescriptions: RealtimeSessionDescription[] = [];
  readonly remoteDescriptions: RealtimeSessionDescription[] = [];
  closed = false;
  readonly replacedTracks: (RealtimeAudioTrack | null)[] = [];
  state: RealtimePeerConnectionState = "new";
  #listener: (() => void) | undefined;

  close(): void {
    this.closed = true;
    this.state = "closed";
  }

  createAudioSender() {
    return {
      replaceTrack: (track: RealtimeAudioTrack | null) => {
        this.replacedTracks.push(track);
        return Promise.resolve();
      },
    };
  }

  createDataChannel(label: string): FakeDataChannel {
    const channel = new FakeDataChannel();
    this.channels.push({ channel, label });
    return channel;
  }

  createOffer(): Promise<RealtimeSessionDescription> {
    return Promise.resolve({ sdp: "synthetic-offer-sdp", type: "offer" });
  }

  getConnectionState(): RealtimePeerConnectionState {
    return this.state;
  }

  setConnectionStateListener(listener: () => void): () => void {
    this.#listener = listener;
    return () => {
      if (this.#listener === listener) {
        this.#listener = undefined;
      }
    };
  }

  setLocalDescription(description: RealtimeSessionDescription): Promise<void> {
    this.localDescriptions.push(description);
    return Promise.resolve();
  }

  setRemoteDescription(description: RealtimeSessionDescription): Promise<void> {
    this.remoteDescriptions.push(description);
    this.state = "connected";
    return Promise.resolve();
  }

  transition(state: RealtimePeerConnectionState): void {
    this.state = state;
    this.#listener?.();
  }
}

function successfulFetch(): RealtimeFetch {
  return vi.fn(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      text: () => Promise.resolve("synthetic-answer-sdp"),
    }),
  );
}

function setupController(input?: {
  readonly channel?: OpenAiRealtimeChannel;
  readonly fetch?: RealtimeFetch;
  readonly onTranscript?: (transcript: string) => void;
  readonly secret?: string;
}) {
  const peers: FakePeer[] = [];
  const tracks: FakeAudioTrack[] = [];
  const issueSecret = vi.fn(() =>
    Promise.resolve({
      clientSecret: input?.secret ?? "ek_ephemeral_synthetic",
    }),
  );
  const controller = createOpenAiRealtimeController({
    channel: input?.channel ?? "private",
    clock: { now: () => Date.now() },
    fetch: input?.fetch ?? successfulFetch(),
    issueSecret,
    mediaFactory: () => {
      const track = new FakeAudioTrack();
      tracks.push(track);
      return Promise.resolve({
        getAudioTracks: () => [track],
      });
    },
    ...(input?.onTranscript === undefined
      ? {}
      : { onTranscript: input.onTranscript }),
    peerFactory: () => {
      const peer = new FakePeer();
      peers.push(peer);
      return peer;
    },
    timer: {
      clearTimeout: (handle) => {
        clearTimeout(handle as ReturnType<typeof setTimeout>);
      },
      setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
    },
  });
  return { controller, issueSecret, peers, tracks };
}

describe("OpenAI Realtime browser lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-19T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("exchanges SDP with an ephemeral secret over the oai-events channel", async () => {
    const peer = new FakePeer();
    const fetch = successfulFetch();

    const connection = await connectOpenAiRealtime({
      clientSecret: "ek_ephemeral_only",
      fetch,
      peerFactory: () => peer,
    });

    expect(peer.channels.map(({ label }) => label)).toEqual(["oai-events"]);
    expect(parsedEvents(peer.channels[0]?.channel)).toContainEqual({
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
    expect(peer.localDescriptions).toEqual([
      { sdp: "synthetic-offer-sdp", type: "offer" },
    ]);
    expect(fetch).toHaveBeenCalledWith(OPENAI_REALTIME_CALLS_URL, {
      body: "synthetic-offer-sdp",
      headers: {
        Authorization: "Bearer ek_ephemeral_only",
        "Content-Type": "application/sdp",
      },
      method: "POST",
    });
    expect(peer.remoteDescriptions).toEqual([
      { sdp: "synthetic-answer-sdp", type: "answer" },
    ]);

    connection.close();
    expect(peer.closed).toBe(true);
    expect(peer.channels[0]?.channel.closed).toBe(true);
  });

  it.each([400, 401, 403, 404])(
    "marks provider status %i as a permanent call-creation failure",
    async (status) => {
      const failure = await connectOpenAiRealtime({
        clientSecret: "ek_ephemeral_only",
        fetch: () =>
          Promise.resolve({
            ok: false,
            status,
            text: () => Promise.resolve("private provider response"),
          }),
        peerFactory: () => new FakePeer(),
      }).catch((error: unknown) => error);

      expect(failure).toMatchObject({
        code: "REALTIME_CONNECT_FAILED",
        message: "Realtime call creation failed.",
        retryable: false,
        stage: "call_creation",
      });
      expect(String(failure)).not.toContain("private provider response");
    },
  );

  it.each([408, 425, 429, 500, 503, 599])(
    "marks provider status %i as a retryable call-creation failure",
    async (status) => {
      const failure = await connectOpenAiRealtime({
        clientSecret: "ek_ephemeral_only",
        fetch: () =>
          Promise.resolve({
            ok: false,
            status,
            text: () => Promise.resolve("private provider response"),
          }),
        peerFactory: () => new FakePeer(),
      }).catch((error: unknown) => error);

      expect(failure).toMatchObject({
        code: "REALTIME_CONNECT_FAILED",
        message: "Realtime call creation failed.",
        retryable: true,
        stage: "call_creation",
      });
      expect(String(failure)).not.toContain("private provider response");
    },
  );

  it("redacts direct peer factory failures behind peer negotiation", async () => {
    const failure = await connectOpenAiRealtime({
      clientSecret: "ek_ephemeral_only",
      fetch: successfulFetch(),
      peerFactory: () => {
        throw new Error("private peer factory device identifier");
      },
    }).catch((error: unknown) => error);

    expect(failure).toMatchObject({
      code: "REALTIME_CONNECT_FAILED",
      message: "Realtime peer negotiation failed.",
      retryable: true,
      stage: "peer_negotiation",
    });
    expect(String(failure)).not.toContain("device identifier");
  });

  it("redacts direct audio sender construction failures behind peer negotiation", async () => {
    const peer = new FakePeer();
    vi.spyOn(peer, "createAudioSender").mockImplementation(() => {
      throw new Error("private sender construction detail");
    });

    const failure = await connectOpenAiRealtime({
      clientSecret: "ek_ephemeral_only",
      fetch: successfulFetch(),
      peerFactory: () => peer,
    }).catch((error: unknown) => error);

    expect(failure).toMatchObject({
      code: "REALTIME_CONNECT_FAILED",
      message: "Realtime peer negotiation failed.",
      retryable: true,
      stage: "peer_negotiation",
    });
    expect(String(failure)).not.toContain("construction detail");
    expect(peer.closed).toBe(true);
  });

  it("redacts direct data-channel construction failures behind peer negotiation", async () => {
    const peer = new FakePeer();
    vi.spyOn(peer, "createDataChannel").mockImplementation(() => {
      throw new Error("private data-channel construction detail");
    });

    const failure = await connectOpenAiRealtime({
      clientSecret: "ek_ephemeral_only",
      fetch: successfulFetch(),
      peerFactory: () => peer,
    }).catch((error: unknown) => error);

    expect(failure).toMatchObject({
      code: "REALTIME_CONNECT_FAILED",
      message: "Realtime peer negotiation failed.",
      retryable: true,
      stage: "peer_negotiation",
    });
    expect(String(failure)).not.toContain("construction detail");
    expect(peer.closed).toBe(true);
  });

  it("preserves a classified direct failure when channel and peer cleanup throw", async () => {
    const peer = new FakePeer();
    const channel = new FakeDataChannel();
    const closeChannel = vi.spyOn(channel, "close").mockImplementation(() => {
      throw new Error("private data-channel cleanup detail");
    });
    const closePeer = vi.spyOn(peer, "close").mockImplementation(() => {
      throw new Error("private peer cleanup detail");
    });
    vi.spyOn(peer, "createDataChannel").mockReturnValue(channel);
    vi.spyOn(peer, "createOffer").mockRejectedValue(
      new Error("private offer detail"),
    );

    const failure = await connectOpenAiRealtime({
      clientSecret: "ek_ephemeral_only",
      fetch: successfulFetch(),
      peerFactory: () => peer,
    }).catch((error: unknown) => error);

    expect(failure).toMatchObject({
      code: "REALTIME_CONNECT_FAILED",
      message: "Realtime peer negotiation failed.",
      stage: "peer_negotiation",
    });
    expect(String(failure)).not.toMatch(/cleanup detail|offer detail/u);
    expect(closeChannel).toHaveBeenCalledOnce();
    expect(closePeer).toHaveBeenCalledOnce();
  });

  it("preserves direct media failure when attempted-track cleanup throws without closing", async () => {
    const peer = new FakePeer();
    const channel = new FakeDataChannel();
    const track = new FakeAudioTrack();
    const removeMessage = vi.fn(() => {
      throw new Error("private message-listener cleanup detail");
    });
    const removeOpen = vi.fn(() => {
      throw new Error("private open-listener cleanup detail");
    });
    const stopTrack = vi.spyOn(track, "stop").mockImplementation(() => {
      throw new Error("private track cleanup detail");
    });
    const closeChannel = vi.spyOn(channel, "close").mockImplementation(() => {
      throw new Error("private channel cleanup detail");
    });
    const closePeer = vi.spyOn(peer, "close").mockImplementation(() => {
      throw new Error("private peer cleanup detail");
    });
    const replaceTrack = vi.fn((nextTrack: RealtimeAudioTrack | null) =>
      nextTrack === null
        ? Promise.resolve()
        : Promise.reject(new Error("private sender attachment detail")),
    );
    vi.spyOn(peer, "createAudioSender").mockReturnValue({ replaceTrack });
    vi.spyOn(peer, "createDataChannel").mockReturnValue(channel);
    vi.spyOn(channel, "getReadyState").mockReturnValue("connecting");
    vi.spyOn(channel, "setMessageListener").mockReturnValue(removeMessage);
    vi.spyOn(channel, "setOpenListener").mockReturnValue(removeOpen);

    const connection = await connectOpenAiRealtime({
      clientSecret: "ek_ephemeral_only",
      fetch: successfulFetch(),
      mediaFactory: () =>
        Promise.resolve({
          getAudioTracks: () => [track],
        }),
      peerFactory: () => peer,
    });
    const failure = await connection
      .startPushToTalk()
      .catch((error: unknown) => error);

    expect(failure).toMatchObject({
      code: "REALTIME_CONNECT_FAILED",
      message: "Microphone setup failed.",
      safeReason: "MICROPHONE_TRACK_ATTACH_FAILED",
      stage: "media",
    });
    expect(String(failure)).not.toContain("cleanup detail");
    expect(stopTrack).toHaveBeenCalledOnce();
    expect(replaceTrack).toHaveBeenLastCalledWith(null);
    expect(removeMessage).not.toHaveBeenCalled();
    expect(removeOpen).not.toHaveBeenCalled();
    expect(closeChannel).not.toHaveBeenCalled();
    expect(closePeer).not.toHaveBeenCalled();
  });

  it("redacts direct microphone failures behind the public media stage", async () => {
    const peer = new FakePeer();
    const connection = await connectOpenAiRealtime({
      clientSecret: "ek_ephemeral_only",
      fetch: successfulFetch(),
      mediaFactory: () =>
        Promise.reject(new Error("private microphone hardware identifier")),
      peerFactory: () => peer,
    });

    const failure = await connection
      .startPushToTalk()
      .catch((error: unknown) => error);

    expect(failure).toMatchObject({
      code: "REALTIME_CONNECT_FAILED",
      message: "Microphone setup failed.",
      retryable: true,
      stage: "media",
    });
    expect(String(failure)).not.toContain("hardware identifier");
  });

  it("preserves an allowlisted microphone permission reason for recovery", async () => {
    const peer = new FakePeer();
    const connection = await connectOpenAiRealtime({
      clientSecret: "ek_ephemeral_only",
      fetch: successfulFetch(),
      mediaFactory: () =>
        Promise.reject(
          new DOMException(
            "private browser permission detail",
            "NotAllowedError",
          ),
        ),
      peerFactory: () => peer,
    });

    const failure = await connection
      .startPushToTalk()
      .catch((error: unknown) => error);

    expect(failure).toMatchObject({
      code: "REALTIME_CONNECT_FAILED",
      message: "Microphone setup failed.",
      retryable: true,
      safeReason: "MICROPHONE_PERMISSION_DENIED",
      stage: "media",
    });
    expect(JSON.stringify(failure)).not.toContain(
      "private browser permission detail",
    );
  });

  it.each([
    ["SecurityError", "MICROPHONE_PERMISSION_DENIED"],
    ["NotFoundError", "MICROPHONE_NOT_FOUND"],
    ["OverconstrainedError", "MICROPHONE_NOT_FOUND"],
    ["NotReadableError", "MICROPHONE_UNAVAILABLE"],
    ["AbortError", "MICROPHONE_UNAVAILABLE"],
  ] as const)(
    "classifies %s without exposing browser microphone detail",
    async (name, safeReason) => {
      const peer = new FakePeer();
      const connection = await connectOpenAiRealtime({
        clientSecret: "ek_ephemeral_only",
        fetch: successfulFetch(),
        mediaFactory: () =>
          Promise.reject(new DOMException("private device detail", name)),
        peerFactory: () => peer,
      });

      const failure = await connection
        .startPushToTalk()
        .catch((error: unknown) => error);

      expect(failure).toMatchObject({
        code: "REALTIME_CONNECT_FAILED",
        safeReason,
        stage: "media",
      });
      expect(JSON.stringify(failure)).not.toContain("private device detail");
    },
  );

  it("preserves a media failure through the controller push-to-talk boundary", async () => {
    const peer = new FakePeer();
    const track = new FakeAudioTrack();
    let mediaAttempts = 0;
    const controller = createOpenAiRealtimeController({
      channel: "private",
      connect: () =>
        connectOpenAiRealtime({
          clientSecret: "ek_ephemeral_only",
          fetch: successfulFetch(),
          mediaFactory: () => {
            mediaAttempts += 1;
            return mediaAttempts === 1
              ? Promise.reject(
                  new Error("private microphone hardware identifier"),
                )
              : Promise.resolve({ getAudioTracks: () => [track] });
          },
          peerFactory: () => peer,
        }),
    });
    await controller.connect();

    const failure = await controller
      .startPushToTalk()
      .catch((error: unknown) => error);

    expect(failure).toMatchObject({
      code: "REALTIME_CONNECT_FAILED",
      message: "Microphone setup failed.",
      retryable: true,
      stage: "media",
    });
    expect(String(failure)).not.toContain("hardware identifier");
    expect(controller.getState()).toMatchObject({
      microphone: "off",
      status: "connected",
    });
    expect(peer.closed).toBe(false);

    await controller.startPushToTalk();
    expect(controller.getState()).toMatchObject({
      microphone: "live",
      status: "connected",
    });
    expect(track.enabled).toBe(true);
    await controller.stopPushToTalk();
    expect(track.stopped).toBe(true);
    expect(peer.replacedTracks).toEqual([track, null]);
  });

  it("keeps a direct controller connected after attachment failure and retries voice", async () => {
    const peer = new FakePeer();
    const failedTrack = new FakeAudioTrack();
    const retryTrack = new FakeAudioTrack();
    let attachmentAttempts = 0;
    const replaceTrack = vi.fn((track: RealtimeAudioTrack | null) => {
      peer.replacedTracks.push(track);
      if (track !== null) {
        attachmentAttempts += 1;
        if (attachmentAttempts === 1) {
          return Promise.reject(new Error("private sender attachment detail"));
        }
      }
      return Promise.resolve();
    });
    vi.spyOn(peer, "createAudioSender").mockReturnValue({ replaceTrack });
    let mediaAttempts = 0;
    const controller = createOpenAiRealtimeController({
      channel: "private",
      connect: () =>
        connectOpenAiRealtime({
          clientSecret: "ek_ephemeral_only",
          fetch: successfulFetch(),
          mediaFactory: () => {
            mediaAttempts += 1;
            return Promise.resolve({
              getAudioTracks: () => [
                mediaAttempts === 1 ? failedTrack : retryTrack,
              ],
            });
          },
          peerFactory: () => peer,
        }),
    });
    await controller.connect();

    await expect(controller.startPushToTalk()).rejects.toMatchObject({
      code: "REALTIME_CONNECT_FAILED",
      stage: "media",
    });
    expect(controller.getState()).toMatchObject({
      microphone: "off",
      status: "connected",
    });
    expect(failedTrack.stopped).toBe(true);
    expect(peer.closed).toBe(false);

    await controller.startPushToTalk();
    expect(controller.getState()).toMatchObject({
      microphone: "live",
      status: "connected",
    });
    await controller.stopPushToTalk();
    expect(retryTrack.stopped).toBe(true);
    expect(peer.replacedTracks).toEqual([failedTrack, null, retryTrack, null]);
    controller.close();
  });

  it("uses a media-only peer for server-managed judge calls", async () => {
    const peer = new FakePeer();
    const createDataChannel = vi
      .spyOn(peer, "createDataChannel")
      .mockImplementation(() => {
        throw new Error(
          "managed calls must not create a provider data channel",
        );
      });
    const track = new FakeAudioTrack();
    const createCall = vi.fn(() =>
      Promise.resolve({
        managedCallId: "managed-call-synthetic",
        sdpAnswer: "synthetic-managed-answer-sdp",
      }),
    );
    const beginTurn = vi.fn(() => Promise.resolve());
    const awaitTranscript = vi.fn(() =>
      Promise.resolve({ transcript: "Synthetic managed transcript." }),
    );
    const transcripts: string[] = [];
    const terminateCall = vi.fn(() => Promise.resolve());
    const connection = await connectManagedOpenAiRealtime({
      awaitTranscript,
      beginTurn,
      channel: "private",
      createCall,
      idempotencyKey: "managed-idempotency-synthetic",
      mediaFactory: () => Promise.resolve({ getAudioTracks: () => [track] }),
      onTranscript: (transcript) => transcripts.push(transcript),
      peerFactory: () => peer,
      terminateCall,
    });

    expect(peer.channels).toEqual([]);
    expect(createDataChannel).not.toHaveBeenCalled();
    expect(createCall).toHaveBeenCalledWith({
      channel: "private",
      idempotencyKey: "managed-idempotency-synthetic",
      sdpOffer: "synthetic-offer-sdp",
    });
    expect(peer.remoteDescriptions).toEqual([
      { sdp: "synthetic-managed-answer-sdp", type: "answer" },
    ]);
    expect(() => connection.sendText("must use app text path")).toThrow(
      OpenAiRealtimeConnectionError,
    );

    await expect(connection.startPushToTalk()).rejects.toBeInstanceOf(
      OpenAiRealtimeConnectionError,
    );
    await connection.startPushToTalk("utterance-managed-1");
    expect(beginTurn).toHaveBeenCalledWith({
      managedCallId: "managed-call-synthetic",
      utteranceId: "utterance-managed-1",
    });
    await connection.stopPushToTalk();
    expect(peer.replacedTracks).toEqual([track, null]);
    expect(awaitTranscript).toHaveBeenCalledWith({
      managedCallId: "managed-call-synthetic",
      utteranceId: "utterance-managed-1",
    });
    expect(transcripts).toEqual(["Synthetic managed transcript."]);

    connection.close();
    expect(peer.closed).toBe(true);
    expect(terminateCall).toHaveBeenCalledWith("managed-call-synthetic");
  });

  it("redacts managed peer factory failures behind peer negotiation", async () => {
    const failure = await connectManagedOpenAiRealtime({
      awaitTranscript: () =>
        Promise.resolve({ transcript: "must not be reached" }),
      beginTurn: () => Promise.resolve(),
      channel: "private",
      createCall: () =>
        Promise.resolve({
          managedCallId: "must-not-be-created",
          sdpAnswer: "must-not-be-returned",
        }),
      idempotencyKey: "managed-peer-factory-failure",
      peerFactory: () => {
        throw new Error("private managed peer factory identifier");
      },
      terminateCall: () => Promise.resolve(),
    }).catch((error: unknown) => error);

    expect(failure).toMatchObject({
      code: "REALTIME_CONNECT_FAILED",
      message: "Realtime peer negotiation failed.",
      retryable: true,
      stage: "peer_negotiation",
    });
    expect(String(failure)).not.toContain("factory identifier");
  });

  it("redacts managed audio sender construction failures behind peer negotiation", async () => {
    const peer = new FakePeer();
    vi.spyOn(peer, "createAudioSender").mockImplementation(() => {
      throw new Error("private managed sender construction detail");
    });

    const failure = await connectManagedOpenAiRealtime({
      awaitTranscript: () =>
        Promise.resolve({ transcript: "must not be reached" }),
      beginTurn: () => Promise.resolve(),
      channel: "private",
      createCall: () =>
        Promise.resolve({
          managedCallId: "must-not-be-created",
          sdpAnswer: "must-not-be-returned",
        }),
      idempotencyKey: "managed-sender-construction-failure",
      peerFactory: () => peer,
      terminateCall: () => Promise.resolve(),
    }).catch((error: unknown) => error);

    expect(failure).toMatchObject({
      code: "REALTIME_CONNECT_FAILED",
      message: "Realtime peer negotiation failed.",
      retryable: true,
      stage: "peer_negotiation",
    });
    expect(String(failure)).not.toContain("construction detail");
    expect(peer.closed).toBe(true);
  });

  it("preserves a permanent managed-call denial for the UI", async () => {
    const peer = new FakePeer();
    const denial = Object.assign(new Error("Synthetic judge limit reached"), {
      code: "USAGE_LIMIT_REACHED",
      retryable: false,
    });

    const failure = await connectManagedOpenAiRealtime({
      awaitTranscript: () =>
        Promise.resolve({ transcript: "must not be reached" }),
      beginTurn: () => Promise.resolve(),
      channel: "private",
      createCall: () => Promise.reject(denial),
      idempotencyKey: "managed-permanent-denial",
      peerFactory: () => peer,
      terminateCall: () => Promise.resolve(),
    }).catch((error: unknown) => error);

    expect(failure).toBe(denial);
    expect(peer.closed).toBe(true);
  });

  it("identifies managed-call creation failures without exposing provider details", async () => {
    const peer = new FakePeer();

    const failure = await connectManagedOpenAiRealtime({
      awaitTranscript: () =>
        Promise.resolve({ transcript: "must not be reached" }),
      beginTurn: () => Promise.resolve(),
      channel: "private",
      createCall: () =>
        Promise.reject(
          new Error("provider response sk-private account-203.0.113.7"),
        ),
      idempotencyKey: "managed-call-creation-failure",
      peerFactory: () => peer,
      terminateCall: () => Promise.resolve(),
    }).catch((error: unknown) => error);

    expect(failure).toMatchObject({
      code: "REALTIME_CONNECT_FAILED",
      message: "Realtime call creation failed.",
      retryable: true,
      stage: "call_creation",
    });
    expect(String(failure)).not.toMatch(/sk-private|203\.0\.113\.7/u);
    expect(peer.closed).toBe(true);
  });

  it("retains only an allowlisted managed-call failure reason for recovery copy", async () => {
    const peer = new FakePeer();
    const providerFailure = Object.assign(
      new Error("private provider response sk-never-expose"),
      {
        code: "REALTIME_UNAVAILABLE",
        details: {
          privateResponse: "account-private-never-expose",
          providerStatus: 401,
          reason: "PROVIDER_REJECTED",
        },
        retryable: true,
      },
    );

    const failure = await connectManagedOpenAiRealtime({
      awaitTranscript: () =>
        Promise.resolve({ transcript: "must not be reached" }),
      beginTurn: () => Promise.resolve(),
      channel: "private",
      createCall: () => Promise.reject(providerFailure),
      idempotencyKey: "managed-safe-failure-reason",
      peerFactory: () => peer,
      terminateCall: () => Promise.resolve(),
    }).catch((error: unknown) => error);

    expect(failure).toMatchObject({
      code: "REALTIME_CONNECT_FAILED",
      safeReason: "PROVIDER_REJECTED",
      stage: "call_creation",
    });
    expect(JSON.stringify(failure)).not.toContain("private-never-expose");
    expect(JSON.stringify(failure)).not.toContain("sk-never-expose");
  });

  it("identifies offer creation as a peer-negotiation failure", async () => {
    const peer = new FakePeer();
    vi.spyOn(peer, "createOffer").mockRejectedValue(
      new Error("provider offer detail must stay private"),
    );

    const failure = await connectManagedOpenAiRealtime({
      awaitTranscript: () =>
        Promise.resolve({ transcript: "must not be reached" }),
      beginTurn: () => Promise.resolve(),
      channel: "private",
      createCall: () =>
        Promise.resolve({
          managedCallId: "must-not-be-created",
          sdpAnswer: "must-not-be-returned",
        }),
      idempotencyKey: "managed-offer-failure",
      peerFactory: () => peer,
      terminateCall: () => Promise.resolve(),
    }).catch((error: unknown) => error);

    expect(failure).toMatchObject({
      code: "REALTIME_CONNECT_FAILED",
      message: "Realtime peer negotiation failed.",
      retryable: true,
      stage: "peer_negotiation",
    });
    expect(String(failure)).not.toContain("provider offer detail");
    expect(peer.closed).toBe(true);
  });

  it("identifies local SDP application as a peer-negotiation failure", async () => {
    const peer = new FakePeer();
    vi.spyOn(peer, "setLocalDescription").mockRejectedValue(
      new Error("private local SDP must stay private"),
    );

    const failure = await connectManagedOpenAiRealtime({
      awaitTranscript: () =>
        Promise.resolve({ transcript: "must not be reached" }),
      beginTurn: () => Promise.resolve(),
      channel: "private",
      createCall: () =>
        Promise.resolve({
          managedCallId: "must-not-be-created",
          sdpAnswer: "must-not-be-returned",
        }),
      idempotencyKey: "managed-local-description-failure",
      peerFactory: () => peer,
      terminateCall: () => Promise.resolve(),
    }).catch((error: unknown) => error);

    expect(failure).toMatchObject({
      code: "REALTIME_CONNECT_FAILED",
      message: "Realtime peer negotiation failed.",
      retryable: true,
      stage: "peer_negotiation",
    });
    expect(String(failure)).not.toContain("private local SDP");
    expect(peer.closed).toBe(true);
  });

  it("identifies SDP answer application as a peer-negotiation failure", async () => {
    const peer = new FakePeer();
    vi.spyOn(peer, "setRemoteDescription").mockRejectedValue(
      new Error("private SDP answer must stay private"),
    );

    const failure = await connectManagedOpenAiRealtime({
      awaitTranscript: () =>
        Promise.resolve({ transcript: "must not be reached" }),
      beginTurn: () => Promise.resolve(),
      channel: "private",
      createCall: () =>
        Promise.resolve({
          managedCallId: "managed-answer-failure",
          sdpAnswer: "private-answer-sdp",
        }),
      idempotencyKey: "managed-answer-application-failure",
      peerFactory: () => peer,
      terminateCall: () => Promise.resolve(),
    }).catch((error: unknown) => error);

    expect(failure).toMatchObject({
      code: "REALTIME_CONNECT_FAILED",
      message: "Realtime peer negotiation failed.",
      retryable: true,
      stage: "peer_negotiation",
    });
    expect(String(failure)).not.toContain("private SDP answer");
    expect(peer.closed).toBe(true);
  });

  it("preserves a managed peer failure when termination and peer cleanup throw", async () => {
    const peer = new FakePeer();
    const closePeer = vi.spyOn(peer, "close").mockImplementation(() => {
      throw new Error("private managed peer cleanup detail");
    });
    vi.spyOn(peer, "setRemoteDescription").mockRejectedValue(
      new Error("private managed SDP detail"),
    );
    const terminateCall = vi.fn(() => {
      throw new Error("private managed termination cleanup detail");
    });

    const failure = await connectManagedOpenAiRealtime({
      awaitTranscript: () =>
        Promise.resolve({ transcript: "must not be reached" }),
      beginTurn: () => Promise.resolve(),
      channel: "private",
      createCall: () =>
        Promise.resolve({
          managedCallId: "managed-throwing-cleanup",
          sdpAnswer: "private-answer-sdp",
        }),
      idempotencyKey: "managed-throwing-cleanup",
      peerFactory: () => peer,
      terminateCall,
    }).catch((error: unknown) => error);

    expect(failure).toMatchObject({
      code: "REALTIME_CONNECT_FAILED",
      message: "Realtime peer negotiation failed.",
      stage: "peer_negotiation",
    });
    expect(String(failure)).not.toContain("cleanup detail");
    expect(terminateCall).toHaveBeenCalledOnce();
    expect(closePeer).toHaveBeenCalledOnce();
  });

  it("identifies microphone acquisition as a media failure", async () => {
    const peer = new FakePeer();
    const connection = await connectManagedOpenAiRealtime({
      awaitTranscript: () =>
        Promise.resolve({ transcript: "must not be reached" }),
      beginTurn: () => Promise.resolve(),
      channel: "private",
      createCall: () =>
        Promise.resolve({
          managedCallId: "managed-media-failure",
          sdpAnswer: "synthetic-answer-sdp",
        }),
      idempotencyKey: "managed-media-acquisition-failure",
      mediaFactory: () =>
        Promise.reject(new Error("microphone device account detail")),
      peerFactory: () => peer,
      terminateCall: () => Promise.resolve(),
    });

    const failure = await connection
      .startPushToTalk("utterance-media-failure")
      .catch((error: unknown) => error);

    expect(failure).toMatchObject({
      code: "REALTIME_CONNECT_FAILED",
      message: "Microphone setup failed.",
      retryable: true,
      stage: "media",
    });
    expect(String(failure)).not.toContain("account detail");
    expect(peer.closed).toBe(false);
  });

  it("keeps a managed peer connected for a later voice retry after media denial", async () => {
    const peer = new FakePeer();
    const track = new FakeAudioTrack();
    let mediaAttempts = 0;
    const controller = createOpenAiRealtimeController({
      channel: "private",
      connect: (_channel, idempotencyKey) =>
        connectManagedOpenAiRealtime({
          awaitTranscript: () =>
            Promise.resolve({ transcript: "Synthetic retry transcript." }),
          beginTurn: () => Promise.resolve(),
          channel: "private",
          createCall: () =>
            Promise.resolve({
              managedCallId: "managed-controller-media-retry",
              sdpAnswer: "synthetic-answer-sdp",
            }),
          idempotencyKey,
          mediaFactory: () => {
            mediaAttempts += 1;
            return mediaAttempts === 1
              ? Promise.reject(new Error("private managed microphone detail"))
              : Promise.resolve({ getAudioTracks: () => [track] });
          },
          peerFactory: () => peer,
          terminateCall: () => Promise.resolve(),
        }),
    });
    await controller.connect();

    await expect(
      controller.startPushToTalk("utterance-managed-media-denial"),
    ).rejects.toMatchObject({
      code: "REALTIME_CONNECT_FAILED",
      stage: "media",
    });
    expect(controller.getState()).toMatchObject({
      microphone: "off",
      status: "connected",
    });
    expect(peer.closed).toBe(false);

    await controller.startPushToTalk("utterance-managed-media-retry");
    expect(controller.getState().microphone).toBe("live");
    await controller.stopPushToTalk();
    expect(track.stopped).toBe(true);
    expect(peer.replacedTracks).toEqual([track, null]);
  });

  it("opens a managed turn only after media is ready so denial can retry", async () => {
    const peer = new FakePeer();
    const retryTrack = new FakeAudioTrack();
    let mediaAttempts = 0;
    let activeServerUtterance: string | undefined;
    const openedUtterances: string[] = [];
    const beginTurn = vi.fn(
      (input: {
        readonly managedCallId: string;
        readonly utteranceId: string;
      }) => {
        if (
          activeServerUtterance !== undefined &&
          activeServerUtterance !== input.utteranceId
        ) {
          return Promise.reject(new Error("unfinished server turn"));
        }
        activeServerUtterance = input.utteranceId;
        openedUtterances.push(input.utteranceId);
        return Promise.resolve();
      },
    );
    const controller = createOpenAiRealtimeController({
      channel: "private",
      connect: (_channel, idempotencyKey) =>
        connectManagedOpenAiRealtime({
          awaitTranscript: ({ utteranceId }) => {
            if (activeServerUtterance === utteranceId) {
              activeServerUtterance = undefined;
            }
            return Promise.resolve({
              transcript: "Synthetic retry transcript.",
            });
          },
          beginTurn,
          channel: "private",
          createCall: () =>
            Promise.resolve({
              managedCallId: "managed-controller-media-ordering",
              sdpAnswer: "synthetic-answer-sdp",
            }),
          idempotencyKey,
          mediaFactory: () => {
            mediaAttempts += 1;
            return mediaAttempts === 1
              ? Promise.reject(new Error("private microphone detail"))
              : Promise.resolve({ getAudioTracks: () => [retryTrack] });
          },
          peerFactory: () => peer,
          terminateCall: () => Promise.resolve(),
        }),
    });
    await controller.connect();

    await expect(
      controller.startPushToTalk("utterance-media-denial"),
    ).rejects.toMatchObject({
      code: "REALTIME_CONNECT_FAILED",
      stage: "media",
    });
    expect(beginTurn).not.toHaveBeenCalled();
    expect(openedUtterances).toEqual([]);
    expect(activeServerUtterance).toBeUndefined();
    expect(controller.getState()).toMatchObject({
      microphone: "off",
      status: "connected",
    });

    await controller.startPushToTalk("utterance-media-retry");
    expect(openedUtterances).toEqual(["utterance-media-retry"]);
    expect(activeServerUtterance).toBe("utterance-media-retry");
    expect(controller.getState().microphone).toBe("live");
    await controller.stopPushToTalk();
    expect(activeServerUtterance).toBeUndefined();
    expect(retryTrack.stopped).toBe(true);
    controller.close();
  });

  it("keeps a managed controller connected after attachment failure and retries voice", async () => {
    const peer = new FakePeer();
    const failedTrack = new FakeAudioTrack();
    const retryTrack = new FakeAudioTrack();
    let attachmentAttempts = 0;
    const replaceTrack = vi.fn((track: RealtimeAudioTrack | null) => {
      peer.replacedTracks.push(track);
      if (track !== null) {
        attachmentAttempts += 1;
        if (attachmentAttempts === 1) {
          return Promise.reject(new Error("private sender attachment detail"));
        }
      }
      return Promise.resolve();
    });
    vi.spyOn(peer, "createAudioSender").mockReturnValue({ replaceTrack });
    let mediaAttempts = 0;
    const terminateCall = vi.fn(() => Promise.resolve());
    const controller = createOpenAiRealtimeController({
      channel: "private",
      connect: (_channel, idempotencyKey) =>
        connectManagedOpenAiRealtime({
          awaitTranscript: () =>
            Promise.resolve({ transcript: "Synthetic retry transcript." }),
          beginTurn: () => Promise.resolve(),
          channel: "private",
          createCall: () =>
            Promise.resolve({
              managedCallId: "managed-controller-attachment-retry",
              sdpAnswer: "synthetic-answer-sdp",
            }),
          idempotencyKey,
          mediaFactory: () => {
            mediaAttempts += 1;
            return Promise.resolve({
              getAudioTracks: () => [
                mediaAttempts === 1 ? failedTrack : retryTrack,
              ],
            });
          },
          peerFactory: () => peer,
          terminateCall,
        }),
    });
    await controller.connect();

    await expect(
      controller.startPushToTalk("utterance-attachment-failure"),
    ).rejects.toMatchObject({
      code: "REALTIME_CONNECT_FAILED",
      stage: "media",
    });
    expect(controller.getState()).toMatchObject({
      microphone: "off",
      status: "connected",
    });
    expect(failedTrack.stopped).toBe(true);
    expect(peer.closed).toBe(false);
    expect(terminateCall).not.toHaveBeenCalled();

    await controller.startPushToTalk("utterance-attachment-retry");
    expect(controller.getState()).toMatchObject({
      microphone: "live",
      status: "connected",
    });
    await controller.stopPushToTalk();
    expect(retryTrack.stopped).toBe(true);
    expect(peer.replacedTracks).toEqual([failedTrack, null, retryTrack, null]);
    controller.close();
  });

  it("preserves managed media classification when attachment cleanup throws", async () => {
    const peer = new FakePeer();
    const track = new FakeAudioTrack();
    const stopTrack = vi.spyOn(track, "stop").mockImplementation(() => {
      throw new Error("private managed track cleanup detail");
    });
    const closePeer = vi.spyOn(peer, "close").mockImplementation(() => {
      throw new Error("private managed peer cleanup detail");
    });
    const replaceTrack = vi.fn((nextTrack: RealtimeAudioTrack | null) =>
      nextTrack === null
        ? Promise.resolve()
        : Promise.reject(new Error("private managed attachment detail")),
    );
    vi.spyOn(peer, "createAudioSender").mockReturnValue({ replaceTrack });
    const terminateCall = vi.fn(() => {
      throw new Error("private managed termination cleanup detail");
    });
    const connection = await connectManagedOpenAiRealtime({
      awaitTranscript: () =>
        Promise.resolve({ transcript: "must not be reached" }),
      beginTurn: () => Promise.resolve(),
      channel: "private",
      createCall: () =>
        Promise.resolve({
          managedCallId: "managed-attachment-cleanup",
          sdpAnswer: "synthetic-answer-sdp",
        }),
      idempotencyKey: "managed-attachment-cleanup",
      mediaFactory: () =>
        Promise.resolve({
          getAudioTracks: () => [track],
        }),
      peerFactory: () => peer,
      terminateCall,
    });

    const failure = await connection
      .startPushToTalk("utterance-managed-attachment-cleanup")
      .catch((error: unknown) => error);

    expect(failure).toMatchObject({
      code: "REALTIME_CONNECT_FAILED",
      message: "Microphone setup failed.",
      stage: "media",
    });
    expect(String(failure)).not.toContain("cleanup detail");
    expect(stopTrack).toHaveBeenCalledOnce();
    expect(replaceTrack).toHaveBeenLastCalledWith(null);
    expect(terminateCall).not.toHaveBeenCalled();
    expect(closePeer).not.toHaveBeenCalled();
  });

  it("identifies a missing microphone track as a media failure", async () => {
    const peer = new FakePeer();
    const connection = await connectManagedOpenAiRealtime({
      awaitTranscript: () =>
        Promise.resolve({ transcript: "must not be reached" }),
      beginTurn: () => Promise.resolve(),
      channel: "private",
      createCall: () =>
        Promise.resolve({
          managedCallId: "managed-missing-track",
          sdpAnswer: "synthetic-answer-sdp",
        }),
      idempotencyKey: "managed-missing-track-failure",
      mediaFactory: () =>
        Promise.resolve({
          getAudioTracks: () => [],
        }),
      peerFactory: () => peer,
      terminateCall: () => Promise.resolve(),
    });

    const failure = await connection
      .startPushToTalk("utterance-missing-track")
      .catch((error: unknown) => error);

    expect(failure).toMatchObject({
      code: "REALTIME_CONNECT_FAILED",
      message: "Microphone setup failed.",
      retryable: true,
      safeReason: "MICROPHONE_NOT_FOUND",
      stage: "media",
    });
    expect(peer.closed).toBe(false);
  });

  it("publishes a connecting-to-connected state sequence", async () => {
    const { controller } = setupController();
    const states: OpenAiRealtimeState[] = [];
    const { connect, getState, subscribe } = controller;
    subscribe(() => {
      states.push(getState());
    });

    await connect();

    expect(states.map(({ status }) => status)).toEqual([
      "connecting",
      "connected",
    ]);
    expect(getState()).toEqual({
      channel: "private",
      microphone: "off",
      reconnectAttempt: 0,
      status: "connected",
      textFallbackAvailable: false,
    });
    controller.close();
  });

  it("keeps microphone capture off until push-down and commits on release", async () => {
    const { controller, peers, tracks } = setupController();
    await controller.connect();

    expect(tracks).toHaveLength(0);
    expect(controller.getState().microphone).toBe("off");

    await controller.startPushToTalk();

    expect(tracks).toHaveLength(1);
    expect(tracks[0]?.enabled).toBe(true);
    expect(controller.getState().microphone).toBe("live");
    expect(peers[0]?.replacedTracks).toEqual([tracks[0]]);
    expect(parsedEvents(peers[0]?.channels[0]?.channel)).toContainEqual({
      type: "input_audio_buffer.clear",
    });

    await controller.stopPushToTalk();

    expect(controller.getState().microphone).toBe("off");
    expect(tracks[0]).toMatchObject({ enabled: false, stopped: true });
    expect(peers[0]?.replacedTracks).toEqual([tracks[0], null]);
    expect(parsedEvents(peers[0]?.channels[0]?.channel).slice(-2)).toEqual([
      { type: "input_audio_buffer.commit" },
      { type: "response.create" },
    ]);
    controller.close();
  });

  it("sends typed text through the Realtime conversation and deduplicates completed transcripts", async () => {
    const transcripts: string[] = [];
    const { controller, peers } = setupController({
      onTranscript: (transcript) => transcripts.push(transcript),
    });
    await controller.connect();

    controller.sendText("  Synthetic typed fallback.  ");
    const channel = peers[0]?.channels[0]?.channel;
    expect(parsedEvents(channel).slice(-2)).toEqual([
      {
        item: {
          content: [{ text: "Synthetic typed fallback.", type: "input_text" }],
          role: "user",
          type: "message",
        },
        type: "conversation.item.create",
      },
      { type: "response.create" },
    ]);

    channel?.emitMessage({
      item_id: "item-voice-1",
      transcript: "Synthetic voice transcript.",
      type: "conversation.item.input_audio_transcription.completed",
    });
    channel?.emitMessage({
      item: {
        content: [
          {
            transcript: "Synthetic voice transcript.",
            type: "input_audio",
          },
        ],
        id: "item-voice-1",
        role: "user",
      },
      type: "conversation.item.done",
    });

    expect(transcripts).toEqual(["Synthetic voice transcript."]);
    controller.close();
  });

  it("closes after 60 idle seconds and renews the deadline on activity", async () => {
    const { controller, peers } = setupController();
    await controller.connect();

    await vi.advanceTimersByTimeAsync(59_000);
    controller.markActivity();
    await vi.advanceTimersByTimeAsync(59_999);
    expect(controller.getState().status).toBe("connected");

    await vi.advanceTimersByTimeAsync(1);
    expect(controller.getState().status).toBe("off");
    expect(peers[0]?.closed).toBe(true);
  });

  it("caps exponential reconnects at three attempts before degrading", async () => {
    const fetch = vi.fn<RealtimeFetch>(() =>
      Promise.reject(new Error("synthetic transport failure")),
    );
    const { controller, issueSecret } = setupController({ fetch });

    await controller.connect();
    expect(controller.getState()).toMatchObject({
      reconnectAttempt: 1,
      status: "reconnecting",
    });
    expect(issueSecret).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(249);
    expect(issueSecret).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(issueSecret).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(499);
    expect(issueSecret).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(issueSecret).toHaveBeenCalledTimes(3);

    await vi.advanceTimersByTimeAsync(999);
    expect(issueSecret).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(issueSecret).toHaveBeenCalledTimes(4);
    expect(controller.getState()).toEqual({
      channel: "private",
      microphone: "off",
      reconnectAttempt: 3,
      status: "degraded",
      textFallbackAvailable: true,
    });
    controller.close();
  });

  it("retries a transient provider status and connects on the next attempt", async () => {
    let attempts = 0;
    const fetch = vi.fn<RealtimeFetch>(() => {
      attempts += 1;
      return Promise.resolve(
        attempts === 1
          ? {
              ok: false,
              status: 503,
              text: () => Promise.resolve("private provider response"),
            }
          : {
              ok: true,
              status: 200,
              text: () => Promise.resolve("synthetic-answer-sdp"),
            },
      );
    });
    const { controller, issueSecret } = setupController({ fetch });

    await controller.connect();
    expect(controller.getState()).toMatchObject({
      reconnectAttempt: 1,
      status: "reconnecting",
    });
    await vi.advanceTimersByTimeAsync(250);

    expect(controller.getState()).toMatchObject({
      reconnectAttempt: 0,
      status: "connected",
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(issueSecret).toHaveBeenCalledTimes(2);
    controller.close();
  });

  it("does not retry a permanent provider 4xx status", async () => {
    const fetch = vi.fn<RealtimeFetch>(() =>
      Promise.resolve({
        ok: false,
        status: 401,
        text: () => Promise.resolve("private provider response"),
      }),
    );
    const { controller, issueSecret } = setupController({ fetch });

    await controller.connect();
    expect(controller.getState()).toMatchObject({
      reconnectAttempt: 0,
      status: "degraded",
      textFallbackAvailable: true,
    });
    await vi.runAllTimersAsync();

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(issueSecret).toHaveBeenCalledTimes(1);
    controller.close();
  });

  it("does not retry a permanent managed-call denial", async () => {
    const denial = Object.assign(new Error("Synthetic judge limit reached"), {
      code: "USAGE_LIMIT_REACHED",
      retryable: false,
    });
    const connect = vi.fn(() => Promise.reject(denial));
    const controller = createOpenAiRealtimeController({
      channel: "private",
      connect,
      retryDelaysMs: [250, 500, 1_000],
    });

    await controller.connect();
    expect(controller.getState()).toMatchObject({
      reconnectAttempt: 0,
      status: "degraded",
      textFallbackAvailable: true,
    });
    await vi.runAllTimersAsync();
    expect(connect).toHaveBeenCalledTimes(1);
    controller.close();
  });

  it("does not reconnect after a manual disconnect", async () => {
    const fetch = vi.fn<RealtimeFetch>(() =>
      Promise.reject(new Error("synthetic transport failure")),
    );
    const { controller, issueSecret } = setupController({ fetch });
    await controller.connect();

    controller.disconnect();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(controller.getState().status).toBe("off");
    expect(issueSecret).toHaveBeenCalledTimes(1);
    controller.close();
  });

  it("keeps private and shared channel controllers independent", async () => {
    const privateSetup = setupController({ channel: "private" });
    const sharedSetup = setupController({ channel: "shared" });

    await privateSetup.controller.connect();
    expect(privateSetup.issueSecret).toHaveBeenCalledWith("private");
    expect(sharedSetup.controller.getState().status).toBe("off");

    await sharedSetup.controller.connect();
    privateSetup.controller.disconnect();

    expect(privateSetup.controller.getState().status).toBe("off");
    expect(sharedSetup.controller.getState()).toMatchObject({
      channel: "shared",
      status: "connected",
    });
    expect(sharedSetup.issueSecret).toHaveBeenCalledWith("shared");
    privateSetup.controller.close();
    sharedSetup.controller.close();
  });

  it("reconnects an unexpectedly failed peer with a newly issued secret", async () => {
    const { controller, issueSecret, peers } = setupController();
    await controller.connect();

    peers[0]?.transition("failed");
    expect(controller.getState().status).toBe("reconnecting");
    await vi.advanceTimersByTimeAsync(250);

    expect(issueSecret).toHaveBeenCalledTimes(2);
    expect(peers).toHaveLength(2);
    expect(controller.getState().status).toBe("connected");
    controller.close();
  });

  it("reuses a managed start key for ambiguous retries and rotates it after an established peer fails", async () => {
    const keys: string[] = [];
    const peers: FakePeer[] = [];
    let attempts = 0;
    const connect = vi.fn(
      (
        _channel: OpenAiRealtimeChannel,
        idempotencyKey: string,
      ): ReturnType<typeof connectOpenAiRealtime> => {
        attempts += 1;
        keys.push(idempotencyKey);
        if (attempts === 1) {
          return Promise.reject(new OpenAiRealtimeConnectionError());
        }
        const peer = new FakePeer();
        peer.state = "connected";
        peers.push(peer);
        return Promise.resolve({
          close: () => peer.close(),
          peer,
          sendText: () => undefined,
          startPushToTalk: () => Promise.resolve(),
          stopPushToTalk: () => Promise.resolve(),
        });
      },
    );
    const controller = createOpenAiRealtimeController({
      channel: "private",
      connect,
      retryDelaysMs: [250, 500, 1_000],
    });

    await controller.connect();
    expect(controller.getState().status).toBe("reconnecting");
    await vi.advanceTimersByTimeAsync(250);
    expect(controller.getState().status).toBe("connected");
    expect(keys[0]).toBe(keys[1]);

    peers[0]?.transition("failed");
    await vi.advanceTimersByTimeAsync(250);
    expect(controller.getState().status).toBe("connected");
    expect(keys[2]).not.toBe(keys[1]);
    controller.close();
  });

  it("never exposes an ephemeral secret through state or errors", async () => {
    const secret = "ek_do-not-retain-in-observable-output";
    const peer = new FakePeer();
    const fetch = vi.fn<RealtimeFetch>(() =>
      Promise.reject(new Error(`provider rejected ${secret}`)),
    );

    const failure = await connectOpenAiRealtime({
      clientSecret: secret,
      fetch,
      peerFactory: () => peer,
    }).catch((error: unknown) => error);

    expect(failure).toMatchObject({
      code: "REALTIME_CONNECT_FAILED",
      message: "Realtime call creation failed.",
      retryable: true,
      stage: "call_creation",
    });
    expect(String(failure)).not.toContain(secret);

    const { controller } = setupController({ fetch, secret });
    const observedStates: OpenAiRealtimeState[] = [];
    controller.subscribe(() => {
      observedStates.push(controller.getState());
    });
    await controller.connect();
    await vi.runAllTimersAsync();

    expect(JSON.stringify(controller.getState())).not.toContain(secret);
    expect(JSON.stringify(observedStates)).not.toContain(secret);
    controller.close();
  });
});
