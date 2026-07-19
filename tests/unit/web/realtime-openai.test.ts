import {
  OPENAI_REALTIME_CALLS_URL,
  OpenAiRealtimeConnectionError,
  connectOpenAiRealtime,
  createOpenAiRealtimeController,
  type OpenAiRealtimeChannel,
  type OpenAiRealtimeState,
  type RealtimeDataChannel,
  type RealtimeFetch,
  type RealtimePeerConnection,
  type RealtimePeerConnectionState,
  type RealtimeSessionDescription,
} from "../../../apps/web/src/realtime-openai.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class FakeDataChannel implements RealtimeDataChannel {
  closed = false;

  close(): void {
    this.closed = true;
  }
}

class FakePeer implements RealtimePeerConnection {
  readonly channels: { channel: FakeDataChannel; label: string }[] = [];
  readonly localDescriptions: RealtimeSessionDescription[] = [];
  readonly remoteDescriptions: RealtimeSessionDescription[] = [];
  closed = false;
  state: RealtimePeerConnectionState = "new";
  #listener: (() => void) | undefined;

  close(): void {
    this.closed = true;
    this.state = "closed";
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
  readonly secret?: string;
}) {
  const peers: FakePeer[] = [];
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
  return { controller, issueSecret, peers };
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
      reconnectAttempt: 0,
      status: "connected",
      textFallbackAvailable: false,
    });
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
      reconnectAttempt: 3,
      status: "degraded",
      textFallbackAvailable: true,
    });
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
