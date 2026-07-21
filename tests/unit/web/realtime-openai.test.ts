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

  getReadyState(): "closed" | "open" {
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

    expect(failure).toBeInstanceOf(OpenAiRealtimeConnectionError);
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
