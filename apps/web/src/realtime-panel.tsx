import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react";

import {
  acquireSharedFloor,
  ApiError,
  captureUtterance,
  clearMeetingByok,
  clearStoredMeetingByok,
  configureMeetingByok,
  getRoleProjection,
  heartbeatMeetingByok,
  issueRealtimeClientSecret,
  loadStoredMeetingByok,
  releaseSharedFloor,
  storeMeetingByok,
  type GetRoleProjectionResponse,
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
  readonly participantId: string;
  readonly session: StoredSession;
}

type KeyState = "active" | "configuring" | "error" | "missing";
type SpeechState =
  | "acquiring"
  | "busy"
  | "error"
  | "idle"
  | "listening"
  | "sent"
  | "submitting"
  | "transcribing";

interface PendingVoiceTurn {
  readonly capturedAt: string;
  readonly channel: OpenAiRealtimeChannel;
  readonly utteranceId: string;
  releaseRequested: boolean;
  stopping: boolean;
}

const MAX_VOICE_HOLD_MS = 8_000;
const TRANSCRIPT_WAIT_MS = 5_000;

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
        <small>
          {state.microphone === "live"
            ? "Mic live · release to send"
            : state.microphone === "requesting"
              ? "Requesting mic"
              : "Mic off · text stays available"}
        </small>
        {connected || busy ? (
          <button
            className="disconnect"
            disabled={state.microphone !== "off"}
            onClick={controller.disconnect}
            type="button"
          >
            {state.microphone === "off"
              ? busy
                ? "Cancel"
                : "Disconnect"
              : "Release first"}
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
  participantId,
  session,
}: RealtimePanelProps) {
  const apiKeyId = useId();
  const messageId = useId();
  const [apiKey, setApiKey] = useState("");
  const [channel, setChannel] = useState<OpenAiRealtimeChannel>("private");
  const [keyState, setKeyState] = useState<KeyState>(() =>
    facilitator && loadStoredMeetingByok(meetingId) !== undefined
      ? "configuring"
      : "missing",
  );
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState("");
  const [projection, setProjection] = useState<GetRoleProjectionResponse>();
  const [speechState, setSpeechState] = useState<SpeechState>("idle");
  const [speechStatus, setSpeechStatus] = useState(
    "Choose a channel. Hold to speak, or type the same command below.",
  );
  const lifecycleGeneration = useRef(0);
  const pendingVoice = useRef<PendingVoiceTurn | undefined>(undefined);
  const transcriptHandlers = useRef<
    Partial<Record<OpenAiRealtimeChannel, (transcript: string) => void>>
  >({});
  const transcriptTimer = useRef<number | undefined>(undefined);
  const voiceHoldTimer = useRef<number | undefined>(undefined);
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
        onTranscript: (transcript) =>
          transcriptHandlers.current.private?.(transcript),
      }),
      shared: createOpenAiRealtimeController({
        channel: "shared",
        issueSecret,
        onTranscript: (transcript) =>
          transcriptHandlers.current.shared?.(transcript),
      }),
    };
  }

  const privateState = useControllerState(controllers.current.private);
  const sharedState = useControllerState(controllers.current.shared);

  function clearVoiceTimers() {
    if (voiceHoldTimer.current !== undefined) {
      window.clearTimeout(voiceHoldTimer.current);
      voiceHoldTimer.current = undefined;
    }
    if (transcriptTimer.current !== undefined) {
      window.clearTimeout(transcriptTimer.current);
      transcriptTimer.current = undefined;
    }
  }

  async function refreshProjection(signal?: AbortSignal) {
    const next = await getRoleProjection(session, { meetingId }, signal);
    setProjection(next);
    return next;
  }

  async function releaseTurnFloor(turn: PendingVoiceTurn) {
    if (turn.channel !== "shared") {
      return;
    }
    await releaseSharedFloor(session, {
      meetingId,
      utteranceId: turn.utteranceId,
    }).catch(() => undefined);
  }

  async function acceptTranscript(
    completedChannel: OpenAiRealtimeChannel,
    transcript: string,
  ) {
    const turn = pendingVoice.current;
    if (turn?.channel !== completedChannel) {
      return;
    }
    pendingVoice.current = undefined;
    clearVoiceTimers();
    setSpeechState("submitting");
    setSpeechStatus("Transcript complete · recording one immutable utterance…");
    try {
      const captured = await captureUtterance(session, {
        capturedAt: turn.capturedAt,
        channel: turn.channel,
        meetingId,
        text: transcript,
        utteranceId: turn.utteranceId,
      });
      setSpeechState("sent");
      setSpeechStatus(
        turn.channel === "private"
          ? `Captured privately · ${captured.utterance.text}`
          : `Captured for the room · ${captured.utterance.text}`,
      );
      await refreshProjection();
    } catch (cause) {
      setSpeechState("error");
      setSpeechStatus(safeMessage(cause));
    } finally {
      await releaseTurnFloor(turn);
    }
  }

  transcriptHandlers.current.private = (transcript) => {
    void acceptTranscript("private", transcript);
  };
  transcriptHandlers.current.shared = (transcript) => {
    void acceptTranscript("shared", transcript);
  };

  async function finishVoiceTurn(turn: PendingVoiceTurn) {
    if (turn.stopping || pendingVoice.current !== turn) {
      return;
    }
    turn.stopping = true;
    if (voiceHoldTimer.current !== undefined) {
      window.clearTimeout(voiceHoldTimer.current);
      voiceHoldTimer.current = undefined;
    }
    setSpeechState("transcribing");
    setSpeechStatus("Mic off · waiting for the final transcript…");
    try {
      await controllers.current?.[turn.channel].stopPushToTalk();
    } catch (cause) {
      pendingVoice.current = undefined;
      setSpeechState("error");
      setSpeechStatus(safeMessage(cause));
      await releaseTurnFloor(turn);
      return;
    }
    if (pendingVoice.current !== turn) {
      return;
    }
    transcriptTimer.current = window.setTimeout(() => {
      if (pendingVoice.current !== turn) {
        return;
      }
      pendingVoice.current = undefined;
      controllers.current?.[turn.channel].disconnect();
      setSpeechState("error");
      setSpeechStatus(
        "No transcript arrived. Nothing was recorded; reconnect or use text.",
      );
      void releaseTurnFloor(turn);
    }, TRANSCRIPT_WAIT_MS);
  }

  async function beginVoiceTurn() {
    if (
      pendingVoice.current !== undefined ||
      speechState === "submitting" ||
      speechState === "transcribing"
    ) {
      return;
    }
    const controller = controllers.current?.[channel];
    const connectionState = channel === "private" ? privateState : sharedState;
    if (controller === undefined || connectionState.status !== "connected") {
      setSpeechState("error");
      setSpeechStatus(
        "Connect this channel before speaking, or use the text command.",
      );
      return;
    }
    const turn: PendingVoiceTurn = {
      capturedAt: new Date().toISOString(),
      channel,
      releaseRequested: false,
      stopping: false,
      utteranceId: crypto.randomUUID(),
    };
    pendingVoice.current = turn;
    setSpeechState(channel === "shared" ? "acquiring" : "listening");
    setSpeechStatus(
      channel === "shared"
        ? "Requesting the room floor…"
        : "Preparing your owner-private microphone…",
    );
    try {
      if (channel === "shared") {
        await acquireSharedFloor(session, {
          meetingId,
          utteranceId: turn.utteranceId,
        });
      }
      if (pendingVoice.current !== turn) {
        await releaseTurnFloor(turn);
        return;
      }
      await controller.startPushToTalk();
      setSpeechState("listening");
      setSpeechStatus(
        channel === "private"
          ? "Listening privately · release to send"
          : "You hold the room floor · release to send",
      );
      voiceHoldTimer.current = window.setTimeout(() => {
        turn.releaseRequested = true;
        void finishVoiceTurn(turn);
      }, MAX_VOICE_HOLD_MS);
      if (turn.releaseRequested) {
        await finishVoiceTurn(turn);
      }
    } catch (cause) {
      pendingVoice.current = undefined;
      clearVoiceTimers();
      await releaseTurnFloor(turn);
      if (cause instanceof ApiError && cause.code === "SHARED_FLOOR_BUSY") {
        setSpeechState("busy");
        setSpeechStatus(
          "Room floor busy. Private speech and both text paths stay available.",
        );
      } else {
        setSpeechState("error");
        setSpeechStatus(
          cause instanceof DOMException && cause.name === "NotAllowedError"
            ? "Microphone permission was denied. Nothing was recorded; use text."
            : safeMessage(cause),
        );
      }
    }
  }

  function requestVoiceRelease() {
    const turn = pendingVoice.current;
    if (turn === undefined) {
      return;
    }
    turn.releaseRequested = true;
    if (speechState === "listening") {
      void finishVoiceTurn(turn);
    }
  }

  async function sendTypedMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const canonicalText = message.trim();
    if (
      canonicalText.length === 0 ||
      speechState === "submitting" ||
      pendingVoice.current !== undefined
    ) {
      return;
    }
    const turn: PendingVoiceTurn = {
      capturedAt: new Date().toISOString(),
      channel,
      releaseRequested: true,
      stopping: true,
      utteranceId: crypto.randomUUID(),
    };
    setSpeechState(channel === "shared" ? "acquiring" : "submitting");
    setSpeechStatus(
      channel === "shared"
        ? "Requesting the room floor for one text command…"
        : "Recording one owner-private text command…",
    );
    try {
      if (channel === "shared") {
        await acquireSharedFloor(session, {
          meetingId,
          utteranceId: turn.utteranceId,
        });
      }
      const captured = await captureUtterance(session, {
        capturedAt: turn.capturedAt,
        channel,
        meetingId,
        text: canonicalText,
        utteranceId: turn.utteranceId,
      });
      let realtimeDelivered = false;
      try {
        if (selectedRealtimeState.status === "connected") {
          controllers.current?.[channel].sendText(canonicalText);
          realtimeDelivered = true;
        }
      } catch {
        // The durable command succeeded; Realtime response delivery is optional.
      }
      setMessage("");
      setSpeechState("sent");
      setSpeechStatus(
        channel === "private"
          ? `Sent privately · ${captured.utterance.text}${
              realtimeDelivered ? "" : " · text-only"
            }`
          : `Sent to the room · ${captured.utterance.text}${
              realtimeDelivered ? "" : " · text-only"
            }`,
      );
      await refreshProjection();
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === "SHARED_FLOOR_BUSY") {
        setSpeechState("busy");
        setSpeechStatus(
          "Room floor busy. Switch to private or retry this text command.",
        );
      } else {
        setSpeechState("error");
        setSpeechStatus(safeMessage(cause));
      }
    } finally {
      await releaseTurnFloor(turn);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const update = async () => {
      try {
        const next = await getRoleProjection(
          session,
          { meetingId },
          controller.signal,
        );
        if (active) {
          setProjection(next);
        }
      } catch {
        // The action paths surface errors. Poll failures remain non-disruptive.
      }
    };
    void update();
    const interval = window.setInterval(() => void update(), 1_000);
    return () => {
      active = false;
      controller.abort();
      window.clearInterval(interval);
    };
  }, [meetingId, session]);

  useEffect(() => {
    lifecycleGeneration.current += 1;
    const generation = lifecycleGeneration.current;
    const activeControllers = controllers.current;
    return () => {
      queueMicrotask(() => {
        if (lifecycleGeneration.current === generation) {
          clearVoiceTimers();
          const turn = pendingVoice.current;
          pendingVoice.current = undefined;
          activeControllers?.private.close();
          activeControllers?.shared.close();
          if (turn !== undefined) {
            void releaseTurnFloor(turn);
          }
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
    const turn = pendingVoice.current;
    pendingVoice.current = undefined;
    clearVoiceTimers();
    controllers.current?.private.disconnect();
    controllers.current?.shared.disconnect();
    if (turn !== undefined) {
      await releaseTurnFloor(turn);
    }
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

  const selectedRealtimeState =
    channel === "private" ? privateState : sharedState;
  const activeFloor = projection?.shared.sharedFloor;
  const otherParticipantHasFloor =
    activeFloor !== null &&
    activeFloor !== undefined &&
    activeFloor.participantId !== participantId;
  const interactionLocked =
    pendingVoice.current !== undefined ||
    speechState === "acquiring" ||
    speechState === "listening" ||
    speechState === "submitting" ||
    speechState === "transcribing";
  const visibleUtterances =
    projection === undefined
      ? []
      : channel === "private"
        ? projection.privateWorkspace.utterances
        : projection.shared.utterances;
  const pushToTalkLabel =
    speechState === "acquiring"
      ? "Acquiring floor…"
      : speechState === "listening"
        ? channel === "private"
          ? "Listening privately"
          : "Speaking to room"
        : speechState === "transcribing"
          ? "Finalizing transcript…"
          : channel === "private"
            ? "Hold to speak privately"
            : "Hold to speak to room";

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
      <section
        aria-label="Explicit speech controls"
        className={`speech-console ${channel} ${speechState}`}
      >
        <div className="speech-console-header">
          <div>
            <span className="source-type">A7 · immutable channel</span>
            <h3>One gesture, one visible boundary</h3>
          </div>
          <div className="speech-floor-state" role="status">
            <span
              className={`floor-orb ${
                otherParticipantHasFloor ? "busy" : "available"
              }`}
            />
            <div>
              <strong>
                {activeFloor === null || activeFloor === undefined
                  ? "Room floor available"
                  : activeFloor.participantId === participantId
                    ? "You hold the room floor"
                    : "Room floor busy"}
              </strong>
              <small>
                {activeFloor === null || activeFloor === undefined
                  ? "15-second server lease"
                  : `Lease until ${new Date(
                      activeFloor.leaseExpiresAt,
                    ).toLocaleTimeString()}`}
              </small>
            </div>
          </div>
        </div>

        <div className="speech-boundary-picker" aria-label="Speech channel">
          <button
            aria-pressed={channel === "private"}
            className={channel === "private" ? "active private" : "private"}
            disabled={interactionLocked}
            onClick={() => setChannel("private")}
            type="button"
          >
            <span aria-hidden="true">◉</span>
            <span>
              <strong>Private · owner only</strong>
              <small>Never enters the room timeline</small>
            </span>
          </button>
          <button
            aria-pressed={channel === "shared"}
            className={channel === "shared" ? "active shared" : "shared"}
            disabled={interactionLocked}
            onClick={() => setChannel("shared")}
            type="button"
          >
            <span aria-hidden="true">◎</span>
            <span>
              <strong>Shared · room</strong>
              <small>Requires the server floor lease</small>
            </span>
          </button>
        </div>

        <div className="speech-command-grid">
          <div className="push-to-talk-stage">
            <div className="voice-rings" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <button
              aria-pressed={speechState === "listening"}
              className="push-to-talk"
              disabled={
                pendingVoice.current === undefined &&
                (selectedRealtimeState.status !== "connected" ||
                  (channel === "shared" && otherParticipantHasFloor))
              }
              onClick={(event) => event.preventDefault()}
              onKeyDown={(event) => {
                if (
                  !event.repeat &&
                  (event.key === " " || event.key === "Enter")
                ) {
                  event.preventDefault();
                  void beginVoiceTurn();
                }
              }}
              onKeyUp={(event) => {
                if (event.key === " " || event.key === "Enter") {
                  event.preventDefault();
                  requestVoiceRelease();
                }
              }}
              onPointerCancel={requestVoiceRelease}
              onPointerDown={(event) => {
                event.preventDefault();
                event.currentTarget.setPointerCapture(event.pointerId);
                void beginVoiceTurn();
              }}
              onPointerUp={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                  event.currentTarget.releasePointerCapture(event.pointerId);
                }
                requestVoiceRelease();
              }}
              type="button"
            >
              <span className="mic-glyph" aria-hidden="true">
                {speechState === "listening" ? "◍" : "●"}
              </span>
              <strong>{pushToTalkLabel}</strong>
              <small>
                {selectedRealtimeState.status === "connected"
                  ? "Mic starts only while held · max 8 sec"
                  : "Connect this channel to enable voice"}
              </small>
            </button>
          </div>

          <form
            className="speech-text-command"
            onSubmit={(event) => void sendTypedMessage(event)}
          >
            <div className="text-command-heading">
              <div>
                <label htmlFor={messageId}>Equivalent text command</label>
                <small>Same endpoint · same channel · same audit event</small>
              </div>
              <span>{channel}</span>
            </div>
            <textarea
              disabled={interactionLocked}
              id={messageId}
              maxLength={4_000}
              onChange={(event) => setMessage(event.target.value)}
              placeholder={
                channel === "private"
                  ? "Type an owner-private thought…"
                  : "Type one statement for the room…"
              }
              rows={3}
              value={message}
            />
            <button
              disabled={interactionLocked || message.trim().length === 0}
              type="submit"
            >
              {channel === "private" ? "Send privately" : "Send to room"}
              <span aria-hidden="true">↗</span>
            </button>
          </form>

          <aside className="speech-transcript" aria-label="Recent utterances">
            <div>
              <span>Visible here</span>
              <strong>
                {channel === "private"
                  ? "Your private transcript"
                  : "Shared room transcript"}
              </strong>
            </div>
            {visibleUtterances.length === 0 ? (
              <p>No utterances in this boundary yet.</p>
            ) : (
              <ol>
                {visibleUtterances
                  .slice(-3)
                  .reverse()
                  .map((utterance) => (
                    <li key={utterance.utteranceId}>
                      <span>{utterance.channel}</span>
                      <p>{utterance.text}</p>
                    </li>
                  ))}
              </ol>
            )}
          </aside>
        </div>
        <p
          className={`speech-command-status ${speechState}`}
          role={speechState === "error" ? "alert" : "status"}
        >
          <span aria-hidden="true">◆</span>
          {speechStatus}
        </p>
      </section>
    </section>
  );
}
