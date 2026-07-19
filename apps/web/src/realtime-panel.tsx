import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react";

import {
  ApiError,
  clearMeetingByok,
  clearStoredMeetingByok,
  configureMeetingByok,
  heartbeatMeetingByok,
  issueRealtimeClientSecret,
  loadStoredMeetingByok,
  storeMeetingByok,
  type StoredSession,
} from "./api.js";
import {
  createOpenAiRealtimeController,
  type OpenAiRealtimeChannel,
  type OpenAiRealtimeController,
  type OpenAiRealtimeState,
} from "./realtime-openai.js";

interface RealtimePanelProps {
  readonly facilitator: boolean;
  readonly meetingId: string;
  readonly session: StoredSession;
}

type KeyState = "active" | "configuring" | "error" | "missing";

function safeMessage(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : "Live channels are unavailable. The text workspace remains active.";
}

function useControllerState(
  controller: OpenAiRealtimeController,
): OpenAiRealtimeState {
  return useSyncExternalStore(
    controller.subscribe,
    controller.getState,
    controller.getState,
  );
}

function statusLabel(state: OpenAiRealtimeState): string {
  switch (state.status) {
    case "off":
      return "Off";
    case "connecting":
      return "Connecting";
    case "connected":
      return "Connected";
    case "reconnecting":
      return `Retry ${String(state.reconnectAttempt)} / 3`;
    case "degraded":
      return "Text fallback";
  }
}

function RealtimeChannelCard({
  controller,
  state,
}: {
  readonly controller: OpenAiRealtimeController;
  readonly state: OpenAiRealtimeState;
}) {
  const busy = state.status === "connecting" || state.status === "reconnecting";
  const connected = state.status === "connected";
  const title =
    state.channel === "private" ? "Private agent" : "Shared room agent";
  const description =
    state.status === "degraded"
      ? "Realtime unavailable after capped reconnect. Continue in text."
      : state.channel === "private"
        ? "A separate owner-only Realtime session."
        : "A separate shared-context Realtime session.";

  return (
    <article
      className={`realtime-channel-card ${state.channel} ${state.status}`}
      onPointerDown={controller.markActivity}
    >
      <div className="realtime-channel-heading">
        <span>{state.channel} channel</span>
        <span className={`realtime-state ${state.status}`} role="status">
          {statusLabel(state)}
        </span>
      </div>
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
      <div className="realtime-channel-actions">
        <small>Mic off · text stays available</small>
        {connected || busy ? (
          <button
            className="disconnect"
            onClick={controller.disconnect}
            type="button"
          >
            {busy ? "Cancel" : "Disconnect"}
          </button>
        ) : (
          <button onClick={() => void controller.connect()} type="button">
            {state.status === "degraded" ? "Try again" : "Connect"}
          </button>
        )}
      </div>
    </article>
  );
}

export function RealtimePanel({
  facilitator,
  meetingId,
  session,
}: RealtimePanelProps) {
  const apiKeyId = useId();
  const [apiKey, setApiKey] = useState("");
  const [keyState, setKeyState] = useState<KeyState>(() =>
    facilitator && loadStoredMeetingByok(meetingId) !== undefined
      ? "configuring"
      : "missing",
  );
  const [error, setError] = useState<string>();
  const lifecycleGeneration = useRef(0);
  const controllers = useRef<
    | {
        readonly private: OpenAiRealtimeController;
        readonly shared: OpenAiRealtimeController;
      }
    | undefined
  >(undefined);

  if (controllers.current === undefined) {
    const issueSecret = async (channel: OpenAiRealtimeChannel) => {
      try {
        return await issueRealtimeClientSecret(session, meetingId, channel);
      } catch (cause) {
        setError(safeMessage(cause));
        throw cause;
      }
    };
    controllers.current = {
      private: createOpenAiRealtimeController({
        channel: "private",
        issueSecret,
      }),
      shared: createOpenAiRealtimeController({
        channel: "shared",
        issueSecret,
      }),
    };
  }

  const privateState = useControllerState(controllers.current.private);
  const sharedState = useControllerState(controllers.current.shared);

  useEffect(() => {
    lifecycleGeneration.current += 1;
    const generation = lifecycleGeneration.current;
    const activeControllers = controllers.current;
    return () => {
      queueMicrotask(() => {
        if (lifecycleGeneration.current === generation) {
          activeControllers?.private.close();
          activeControllers?.shared.close();
        }
      });
    };
  }, []);

  useEffect(() => {
    if (!facilitator) {
      return;
    }
    const storedKey = loadStoredMeetingByok(meetingId);
    if (storedKey === undefined) {
      setKeyState("missing");
      return;
    }
    let cancelled = false;
    setKeyState("configuring");
    setError(undefined);
    void configureMeetingByok(session, meetingId, storedKey)
      .then(() => {
        if (!cancelled) {
          setKeyState("active");
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setKeyState("error");
          setError(safeMessage(cause));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [facilitator, meetingId, session]);

  useEffect(() => {
    if (!facilitator || keyState !== "active") {
      return;
    }
    const interval = window.setInterval(() => {
      void heartbeatMeetingByok(session, meetingId).catch((cause: unknown) => {
        setKeyState("error");
        setError(safeMessage(cause));
      });
    }, 60_000);
    return () => window.clearInterval(interval);
  }, [facilitator, keyState, meetingId, session]);

  async function configure(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const candidate = apiKey.trim();
    if (candidate.length < 20) {
      setError("Enter a valid standard API key for this synthetic meeting.");
      return;
    }
    setKeyState("configuring");
    setError(undefined);
    try {
      await configureMeetingByok(session, meetingId, candidate);
      storeMeetingByok(meetingId, candidate);
      setApiKey("");
      setKeyState("active");
    } catch (cause) {
      setKeyState("error");
      setError(safeMessage(cause));
    }
  }

  async function removeKey() {
    controllers.current?.private.disconnect();
    controllers.current?.shared.disconnect();
    setError(undefined);
    try {
      await clearMeetingByok(session, meetingId);
    } catch (cause) {
      if (!(cause instanceof ApiError && cause.code === "API_KEY_REQUIRED")) {
        setError(
          "The browser key was removed. Any unreachable server lease expires within five minutes.",
        );
      }
    } finally {
      clearStoredMeetingByok(meetingId);
      setApiKey("");
      setKeyState("missing");
    }
  }

  return (
    <section aria-labelledby="live-channels-title" className="realtime-dock">
      <div className="realtime-intro">
        <div className="realtime-signal" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div>
          <span className="source-type">OpenAI Realtime · WebRTC</span>
          <h2 id="live-channels-title">Live channels, explicit boundaries</h2>
          <p>
            Short-lived browser credentials. Private and shared sessions never
            merge.
          </p>
        </div>
      </div>
      <div className="realtime-controls">
        <div className="realtime-byok">
          {facilitator ? (
            keyState === "active" ? (
              <>
                <span className="realtime-key-state">
                  Facilitator lease active
                </span>
                <p>
                  Standard key stays in this tab and meeting memory only.
                  Heartbeat renews it.
                </p>
                <div className="realtime-key-actions">
                  <span className="realtime-state connected">Ready</span>
                  <button onClick={() => void removeKey()} type="button">
                    Remove key
                  </button>
                </div>
              </>
            ) : (
              <form onSubmit={(event) => void configure(event)}>
                <label htmlFor={apiKeyId}>Facilitator BYOK · tab only</label>
                <p>Required for ordinary users. Never shown to participants.</p>
                <div className="realtime-key-entry">
                  <input
                    autoComplete="off"
                    id={apiKeyId}
                    onChange={(event) => setApiKey(event.target.value)}
                    placeholder="Paste standard API key"
                    spellCheck={false}
                    type="password"
                    value={apiKey}
                  />
                  <button disabled={keyState === "configuring"} type="submit">
                    {keyState === "configuring" ? "Securing…" : "Set key"}
                  </button>
                </div>
              </form>
            )
          ) : (
            <>
              <span className="realtime-key-state">
                Facilitator-managed lease
              </span>
              <p>
                Participants receive only short-lived channel credentials. A
                standard key never enters this view.
              </p>
            </>
          )}
        </div>
        <RealtimeChannelCard
          controller={controllers.current.private}
          state={privateState}
        />
        <RealtimeChannelCard
          controller={controllers.current.shared}
          state={sharedState}
        />
        {error === undefined ? null : (
          <p className="realtime-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
