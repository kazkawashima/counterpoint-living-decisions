import {
  useCallback,
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
  getJudgeUsage,
  getRealtimeAccess,
  getRoleProjection,
  heartbeatMeetingByok,
  issueRealtimeClientSecret,
  loadStoredMeetingByok,
  releaseSharedFloor,
  storeMeetingByok,
  type CaptureUtteranceResponse,
  type GetRoleProjectionResponse,
  type JudgeUsageSummaryResponse,
  type RealtimeAccessResponse,
  type StoredSession,
} from "./api.js";
import {
  connectOpenAiRealtime,
  createOpenAiRealtimeController,
  RealtimeConnectionStageError,
  type RealtimeFailureReason,
  type OpenAiRealtimeChannel,
  type OpenAiRealtimeController,
  type OpenAiRealtimeState,
  type RealtimeFailureStage,
} from "./realtime-openai.js";
import {
  HEALTHY_PROJECTION_DELAY_MS,
  nextProjectionDelay,
} from "./projection-recovery.js";

interface RealtimePanelProps {
  readonly facilitator: boolean;
  readonly meetingId: string;
  readonly onPrivateUtterance: (text: string, source: "text" | "voice") => void;
  readonly onPositionChange: (
    position: CaptureUtteranceResponse["position"],
  ) => void;
  readonly participantId: string;
  readonly session: StoredSession;
}

type KeyState = "active" | "configuring" | "error" | "missing";
type JudgeUsageState = "hidden" | "loading" | "ready" | "unavailable";
type RealtimeAccessState = "checking" | RealtimeAccessResponse["mode"];
type ProjectionState = "checking" | "offline" | "online";
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
const connectionStageMessage: Readonly<Record<RealtimeFailureStage, string>> = {
  access: "Realtime access check failed.",
  call_creation: "Realtime call creation failed.",
  media: "Microphone setup failed.",
  peer_negotiation: "Realtime peer negotiation failed.",
};
const managedFailureReasonMessage = {
  OFFER_REJECTED:
    "This browser produced an unsupported audio offer. Text remains available.",
  PROVIDER_LOCATION_INVALID:
    "Realtime provider returned an invalid call reference. Text remains available; retry.",
  PROVIDER_REJECTED:
    "Realtime provider rejected the call. Check the configured key or provider account, then retry.",
  PROVIDER_SDP_INVALID:
    "Realtime provider returned an invalid audio answer. Text remains available; retry.",
  PROVIDER_UNAVAILABLE:
    "Realtime provider could not be reached. Text remains available; retry.",
} as const;
const failureReasonMessage: Readonly<Record<RealtimeFailureReason, string>> = {
  ...managedFailureReasonMessage,
  MICROPHONE_NOT_FOUND:
    "No microphone was found. Connect or select an input device, then hold to speak again.",
  MICROPHONE_PERMISSION_DENIED:
    "Microphone permission is blocked. Allow it in browser site settings, then hold to speak again.",
  MICROPHONE_TRACK_ATTACH_FAILED:
    "The microphone could not join this Realtime session. Disconnect and reconnect the channel, then try again.",
  MICROPHONE_UNAVAILABLE:
    "The microphone is busy or unavailable. Close other tabs or apps using it, then hold to speak again.",
};

function managedFailureDetail(error: ApiError): string | undefined {
  if (
    error.code !== "REALTIME_UNAVAILABLE" ||
    typeof error.details !== "object" ||
    error.details === null ||
    !("reason" in error.details) ||
    typeof error.details.reason !== "string" ||
    !(error.details.reason in managedFailureReasonMessage)
  ) {
    return undefined;
  }
  return managedFailureReasonMessage[
    error.details.reason as keyof typeof managedFailureReasonMessage
  ];
}

function safeMessage(error: unknown): string {
  if (error instanceof RealtimeConnectionStageError) {
    if (error.safeReason !== undefined) {
      return failureReasonMessage[error.safeReason];
    }
    return connectionStageMessage[error.stage];
  }
  if (error instanceof ApiError && error.code === "API_KEY_REQUIRED") {
    return "API key required. Meeting state is preserved; add BYOK or continue in text.";
  }
  if (error instanceof ApiError && error.code === "USAGE_LIMIT_REACHED") {
    const limit =
      typeof error.details === "object" &&
      error.details !== null &&
      "limit" in error.details &&
      typeof error.details.limit === "string"
        ? error.details.limit
        : undefined;
    return limit === "cost"
      ? "Daily judge cost limit reached. Meeting state and text remain available."
      : `Daily judge${limit === undefined ? "" : ` ${limit.replaceAll("_", " ")}`} limit reached. Meeting state and text remain available.`;
  }
  if (error instanceof ApiError) {
    const managedDetail = managedFailureDetail(error);
    if (managedDetail !== undefined) {
      return managedDetail;
    }
  }
  return error instanceof ApiError
    ? error.message
    : "Live channels are unavailable. The text workspace remains active.";
}

function connectionFailureMessage(
  error: unknown,
  fallbackStage: RealtimeFailureStage,
): string {
  const stage =
    error instanceof RealtimeConnectionStageError ? error.stage : fallbackStage;
  const stageMessage = connectionStageMessage[stage];
  const detail = safeMessage(error);
  return detail === stageMessage ? stageMessage : `${stageMessage} ${detail}`;
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

function formatMicroUsd(microUsd: number): string {
  return `$${(microUsd / 1_000_000).toFixed(2)}`;
}

function JudgeUsagePanel({
  onRefresh,
  state,
  summary,
}: {
  readonly onRefresh: () => void;
  readonly state: JudgeUsageState;
  readonly summary: JudgeUsageSummaryResponse | undefined;
}) {
  if (state === "hidden") {
    return null;
  }
  if (state === "loading" && summary === undefined) {
    return (
      <section
        aria-busy="true"
        aria-label="Judge usage limits"
        className="judge-usage-panel"
      >
        <div>
          <span className="source-type">Judge safety budget · rolling 24h</span>
          <strong>Checking bounded usage…</strong>
        </div>
        <p>Content-free counters only. Meeting state and text do not wait.</p>
      </section>
    );
  }
  if (state === "unavailable" || summary === undefined) {
    return (
      <section
        aria-label="Judge usage limits"
        className="judge-usage-panel unavailable"
      >
        <div>
          <span className="source-type">Judge safety budget · rolling 24h</span>
          <strong>Usage meter unavailable</strong>
        </div>
        <p>New paid work remains fail-closed; durable text stays available.</p>
        <button onClick={onRefresh} type="button">
          Retry usage check
        </button>
      </section>
    );
  }

  const { dimensions } = summary;
  const costRatio =
    dimensions.costMicroUsd.limit === 0
      ? 1
      : Math.min(
          1,
          dimensions.costMicroUsd.used / dimensions.costMicroUsd.limit,
        );
  const costLimitReached = dimensions.costMicroUsd.remaining === 0;

  return (
    <section
      aria-busy={state === "loading"}
      aria-label="Judge usage limits"
      className={`judge-usage-panel ${
        costLimitReached ? "exhausted" : "available"
      }`}
    >
      <div className="judge-usage-heading">
        <div>
          <span className="source-type">Judge safety budget · rolling 24h</span>
          <strong aria-live="polite">
            {costLimitReached ? "Daily cost limit reached" : "Budget available"}
          </strong>
        </div>
        <button
          disabled={state === "loading"}
          onClick={onRefresh}
          type="button"
        >
          {state === "loading" ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      <div className="judge-cost-meter">
        <div>
          <small>Counted toward enforced cost limit</small>
          <strong>
            {formatMicroUsd(dimensions.costMicroUsd.used)}
            <span>
              {" / "}
              {formatMicroUsd(dimensions.costMicroUsd.limit)}
            </span>
          </strong>
        </div>
        <progress aria-label="Judge cost usage" max={1} value={costRatio} />
      </div>
      <p>
        Only the rolling 24h cost total locks new managed work at $25. Meeting
        state and manual text remain available after the lock.
      </p>
    </section>
  );
}

function RealtimeChannelCard({
  controller,
  onConnect,
  state,
}: {
  readonly controller: OpenAiRealtimeController;
  readonly onConnect: () => Promise<void>;
  readonly state: OpenAiRealtimeState;
}) {
  const busy = state.status === "connecting" || state.status === "reconnecting";
  const connected = state.status === "connected";
  const title =
    state.channel === "private" ? "Private agent" : "Shared room agent";
  const description =
    state.status === "degraded"
      ? "Realtime unavailable. Continue in text; the reason is shown below."
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
          <button onClick={() => void onConnect()} type="button">
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
  onPrivateUtterance,
  onPositionChange,
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
  const [projectionError, setProjectionError] = useState<string>();
  const [projectionRetryPaused, setProjectionRetryPaused] = useState(false);
  const [projectionState, setProjectionState] =
    useState<ProjectionState>("checking");
  const [judgeUsage, setJudgeUsage] = useState<JudgeUsageSummaryResponse>();
  const [judgeUsageState, setJudgeUsageState] =
    useState<JudgeUsageState>("hidden");
  const [realtimeAccess, setRealtimeAccess] =
    useState<RealtimeAccessState>("checking");
  const [speechState, setSpeechState] = useState<SpeechState>("idle");
  const [speechStatus, setSpeechStatus] = useState(
    "Choose a channel. Hold to speak, or type the same command below.",
  );
  const lifecycleGeneration = useRef(0);
  const projectionGeneration = useRef(0);
  const projectionRefreshTrigger = useRef<(manual: boolean) => void>(() => {
    // Installed by the projection scheduler effect.
  });
  const configuredMeetingByok = useRef<string | undefined>(undefined);
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

  const refreshJudgeUsage = useCallback(async () => {
    setJudgeUsageState("loading");
    try {
      const summary = await getJudgeUsage(session, meetingId);
      setJudgeUsage(summary);
      setJudgeUsageState("ready");
    } catch {
      setJudgeUsageState("unavailable");
    }
  }, [meetingId, session]);

  if (controllers.current === undefined) {
    const connect = async (selectedChannel: OpenAiRealtimeChannel) => {
      let failureStage: RealtimeFailureStage = "access";
      try {
        const access = await getRealtimeAccess(session, meetingId);
        setRealtimeAccess(access.mode);
        if (access.usageSummary === "available") {
          void refreshJudgeUsage();
        } else {
          setJudgeUsage(undefined);
          setJudgeUsageState("hidden");
        }
        if (access.mode === "facilitatorProvided") {
          failureStage = "call_creation";
          const issued = await issueRealtimeClientSecret(
            session,
            meetingId,
            selectedChannel,
          );
          return await connectOpenAiRealtime({
            clientSecret: issued.clientSecret,
            onTranscript: (transcript) =>
              transcriptHandlers.current[selectedChannel]?.(transcript),
          });
        }
        if (access.mode === "judgeManaged") {
          const judgeByokKey = loadStoredMeetingByok(meetingId);
          failureStage = "call_creation";
          const issued = await issueRealtimeClientSecret(
            session,
            meetingId,
            selectedChannel,
            judgeByokKey,
          );
          return await connectOpenAiRealtime({
            clientSecret: issued.clientSecret,
            onTranscript: (transcript) =>
              transcriptHandlers.current[selectedChannel]?.(transcript),
          });
        }
        throw new ApiError(
          "API_KEY_REQUIRED",
          "Realtime access is unavailable for this meeting",
        );
      } catch (cause) {
        setError(connectionFailureMessage(cause, failureStage));
        throw cause;
      }
    };
    controllers.current = {
      private: createOpenAiRealtimeController({
        channel: "private",
        connect,
      }),
      shared: createOpenAiRealtimeController({
        channel: "shared",
        connect,
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

  const requestProjectionRefresh = useCallback((manual = false) => {
    projectionRefreshTrigger.current(manual);
  }, []);

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
      onPositionChange(captured.position);
      if (turn.channel === "private") {
        onPrivateUtterance(captured.utterance.text, "voice");
      }
      setSpeechState("sent");
      setSpeechStatus(
        turn.channel === "private"
          ? `Captured privately · ${captured.utterance.text}`
          : `Captured for the room · ${captured.utterance.text}`,
      );
      requestProjectionRefresh();
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
      await controller.startPushToTalk(turn.utteranceId);
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
        setSpeechStatus(safeMessage(cause));
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
      onPositionChange(captured.position);
      if (turn.channel === "private") {
        onPrivateUtterance(captured.utterance.text, "text");
      }
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
      requestProjectionRefresh();
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
    let cancelled = false;
    void getRealtimeAccess(session, meetingId)
      .then((access) => {
        if (!cancelled) {
          setRealtimeAccess(access.mode);
          if (access.usageSummary === "available") {
            void refreshJudgeUsage();
          } else {
            setJudgeUsage(undefined);
            setJudgeUsageState("hidden");
          }
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRealtimeAccess("unavailable");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [meetingId, refreshJudgeUsage, session]);

  useEffect(() => {
    const generation = projectionGeneration.current + 1;
    projectionGeneration.current = generation;
    let activeController: AbortController | undefined;
    let consecutiveFailureCount = 0;
    let inFlight = false;
    let nonretryablePaused = false;
    let queuedImmediateRefresh = false;
    let retryableBackoffPending = false;
    let stopped = false;
    let timer: number | undefined;

    const current = () =>
      !stopped && projectionGeneration.current === generation;
    const clearTimer = () => {
      if (timer !== undefined) {
        window.clearTimeout(timer);
        timer = undefined;
      }
      retryableBackoffPending = false;
    };
    const schedule = (delay: number, retryableBackoff = false) => {
      clearTimer();
      retryableBackoffPending = retryableBackoff;
      timer = window.setTimeout(() => {
        timer = undefined;
        retryableBackoffPending = false;
        void refresh();
      }, delay);
    };
    const refresh = async () => {
      if (!current() || nonretryablePaused) {
        return;
      }
      if (inFlight) {
        queuedImmediateRefresh = true;
        return;
      }
      clearTimer();
      inFlight = true;
      const controller = new AbortController();
      activeController = controller;
      let completionDelay: number | undefined;
      let failed = false;
      try {
        const next = await getRoleProjection(
          session,
          { meetingId },
          controller.signal,
        );
        if (!current()) {
          return;
        }
        setProjection(next);
        setProjectionError(undefined);
        setProjectionRetryPaused(false);
        setProjectionState("online");
        consecutiveFailureCount = 0;
        completionDelay = HEALTHY_PROJECTION_DELAY_MS;
      } catch (cause) {
        if (
          !current() ||
          (cause instanceof DOMException && cause.name === "AbortError")
        ) {
          return;
        }
        const retryable = cause instanceof ApiError ? cause.retryable : true;
        failed = true;
        queuedImmediateRefresh = false;
        if (!retryable) {
          nonretryablePaused = true;
        }
        setProjectionError(safeMessage(cause));
        setProjectionRetryPaused(!retryable);
        setProjectionState("offline");
        completionDelay = nextProjectionDelay(
          consecutiveFailureCount,
          retryable,
        );
        consecutiveFailureCount += 1;
      } finally {
        if (activeController === controller) {
          activeController = undefined;
        }
        inFlight = false;
        if (current()) {
          if (failed) {
            queuedImmediateRefresh = false;
            if (!nonretryablePaused && completionDelay !== undefined) {
              schedule(completionDelay, true);
            }
          } else if (nonretryablePaused) {
            queuedImmediateRefresh = false;
          } else if (queuedImmediateRefresh) {
            queuedImmediateRefresh = false;
            schedule(0);
          } else if (completionDelay !== undefined) {
            schedule(completionDelay);
          }
        }
      }
    };

    projectionRefreshTrigger.current = (manual) => {
      if (!current()) {
        return;
      }
      if (manual) {
        nonretryablePaused = false;
        consecutiveFailureCount = 0;
        setProjectionError(undefined);
        setProjectionRetryPaused(false);
        setProjectionState("checking");
      } else if (nonretryablePaused || retryableBackoffPending) {
        return;
      }
      clearTimer();
      if (inFlight) {
        queuedImmediateRefresh = true;
      } else {
        schedule(0);
      }
    };
    setProjection(undefined);
    setProjectionError(undefined);
    setProjectionRetryPaused(false);
    setProjectionState("checking");
    void refresh();

    return () => {
      stopped = true;
      clearTimer();
      activeController?.abort();
      if (projectionGeneration.current === generation) {
        projectionGeneration.current += 1;
        projectionRefreshTrigger.current = () => {
          // Ignore refreshes after this scheduler has been disposed.
        };
      }
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
    if (realtimeAccess === "judgeManaged") {
      setKeyState(storedKey === undefined ? "missing" : "active");
      return;
    }
    if (realtimeAccess !== "facilitatorProvided") {
      return;
    }
    if (storedKey === undefined) {
      setKeyState("missing");
      return;
    }
    if (configuredMeetingByok.current === storedKey) {
      setKeyState("active");
      return;
    }
    let cancelled = false;
    setKeyState("configuring");
    setError(undefined);
    void configureMeetingByok(session, meetingId, storedKey)
      .then(() => {
        if (!cancelled) {
          configuredMeetingByok.current = storedKey;
          setKeyState("active");
          setRealtimeAccess("facilitatorProvided");
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
  }, [facilitator, meetingId, realtimeAccess, session]);

  useEffect(() => {
    if (
      !facilitator ||
      realtimeAccess !== "facilitatorProvided" ||
      keyState !== "active"
    ) {
      return;
    }
    const interval = window.setInterval(() => {
      void heartbeatMeetingByok(session, meetingId).catch((cause: unknown) => {
        setKeyState("error");
        setError(safeMessage(cause));
      });
    }, 60_000);
    return () => window.clearInterval(interval);
  }, [facilitator, keyState, meetingId, realtimeAccess, session]);

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
      if (realtimeAccess !== "judgeManaged") {
        await configureMeetingByok(session, meetingId, candidate);
        configuredMeetingByok.current = candidate;
      }
      storeMeetingByok(meetingId, candidate);
      setApiKey("");
      setKeyState("active");
      if (realtimeAccess !== "judgeManaged") {
        setRealtimeAccess("facilitatorProvided");
      }
    } catch (cause) {
      setKeyState("error");
      setError(safeMessage(cause));
    }
  }

  async function connectChannel(nextChannel: OpenAiRealtimeChannel) {
    setError(undefined);
    await controllers.current?.[nextChannel].connect();
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
      if (realtimeAccess !== "judgeManaged") {
        await clearMeetingByok(session, meetingId);
      }
    } catch (cause) {
      if (!(cause instanceof ApiError && cause.code === "API_KEY_REQUIRED")) {
        setError(
          "The browser key was removed. Any unreachable server lease expires within five minutes.",
        );
      }
    } finally {
      clearStoredMeetingByok(meetingId);
      configuredMeetingByok.current = undefined;
      setApiKey("");
      setKeyState("missing");
      if (realtimeAccess !== "judgeManaged") {
        setRealtimeAccess("unavailable");
      }
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
  const realtimeDegraded =
    privateState.status === "degraded" || sharedState.status === "degraded";
  const realtimeAccessReady =
    realtimeAccess === "facilitatorProvided" ||
    realtimeAccess === "judgeManaged";
  const recoveryLabel =
    realtimeAccess === "checking"
      ? "Checking access"
      : !realtimeAccessReady
        ? "API key required"
        : realtimeDegraded
          ? "Text fallback active"
          : privateState.status === "connected" ||
              sharedState.status === "connected"
            ? "Realtime available"
            : "Realtime optional";

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
        <div
          className={`realtime-byok ${
            realtimeAccess === "judgeManaged" ? "judge-managed" : ""
          }`}
        >
          {realtimeAccess === "judgeManaged" ? (
            keyState === "active" ? (
              <>
                <span className="realtime-key-state">
                  Your API key active · this tab only
                </span>
                <p>
                  This key is sent only to issue a short-lived client secret;
                  the Worker does not store it. Judge-sponsored access remains
                  available after removal.
                </p>
                <div className="realtime-key-actions">
                  <span className="realtime-state connected">Ready</span>
                  <button onClick={() => void removeKey()} type="button">
                    Remove key
                  </button>
                </div>
              </>
            ) : (
              <>
                <span className="realtime-key-state">
                  Judge-sponsored Realtime
                </span>
                <p>
                  The Worker exchanges its server key for a short-lived browser
                  credential. The standard key never enters this browser.
                  Optional: use your own API key in this tab.
                </p>
                <div className="realtime-key-actions">
                  <span className="realtime-state connected">Ready</span>
                  <span className="managed-access-mark" aria-hidden="true">
                    ◆
                  </span>
                </div>
                {facilitator ? (
                  <form onSubmit={(event) => void configure(event)}>
                    <label htmlFor={apiKeyId}>
                      Optional judge BYOK · tab only
                    </label>
                    <p>
                      Never shown to participants or returned by the Worker.
                    </p>
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
                      <button
                        disabled={keyState === "configuring"}
                        type="submit"
                      >
                        {keyState === "configuring"
                          ? "Securing…"
                          : "Use my key"}
                      </button>
                    </div>
                  </form>
                ) : null}
              </>
            )
          ) : facilitator ? (
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
                {realtimeAccess === "facilitatorProvided"
                  ? "Facilitator-managed lease"
                  : realtimeAccess === "checking"
                    ? "Checking Realtime access"
                    : "Realtime access unavailable"}
              </span>
              <p>
                {realtimeAccess === "facilitatorProvided"
                  ? "Participants receive only short-lived channel credentials. A standard key never enters this view."
                  : "Ask the facilitator to activate a meeting lease; text remains available."}
              </p>
            </>
          )}
        </div>
        <RealtimeChannelCard
          controller={controllers.current.private}
          onConnect={() => connectChannel("private")}
          state={privateState}
        />
        <RealtimeChannelCard
          controller={controllers.current.shared}
          onConnect={() => connectChannel("shared")}
          state={sharedState}
        />
        <JudgeUsagePanel
          onRefresh={() => void refreshJudgeUsage()}
          state={judgeUsageState}
          summary={judgeUsage}
        />
        {error === undefined ? null : (
          <p className="realtime-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <aside
        aria-label="Continuity status"
        className={`continuity-strip ${
          projectionState === "offline" ||
          realtimeDegraded ||
          (realtimeAccess !== "checking" && !realtimeAccessReady)
            ? "degraded"
            : "ready"
        }`}
      >
        <div className="continuity-heading">
          <span className="source-type">A8 · durable continuity</span>
          <strong>
            {projectionState === "online"
              ? "Meeting state stays online"
              : projectionState === "checking"
                ? "Checking durable meeting state"
                : "Meeting state needs reconnection"}
          </strong>
        </div>
        <div className="continuity-capabilities">
          <span data-state={projectionState}>
            <small>State reads</small>
            <strong>
              {projectionState === "online"
                ? "Live"
                : projectionState === "checking"
                  ? "Checking"
                  : "Offline"}
            </strong>
          </span>
          <span data-state="online">
            <small>Manual text</small>
            <strong>Available</strong>
          </span>
          <span
            data-state={
              realtimeAccess === "checking"
                ? "checking"
                : !realtimeAccessReady || realtimeDegraded
                  ? "degraded"
                  : "online"
            }
          >
            <small>AI + voice</small>
            <strong>{recoveryLabel}</strong>
          </span>
        </div>
        <p>
          Realtime retries stop after 3 attempts. Text commands, manual Decision
          editing, export, and audit use the durable workspace and do not wait
          for AI.
        </p>
        {projectionError === undefined ? null : (
          <div className="projection-recovery" role="alert">
            <span>{projectionError}</span>
            {projectionRetryPaused ? (
              <button
                onClick={() => requestProjectionRefresh(true)}
                type="button"
              >
                Retry meeting state
              </button>
            ) : null}
          </div>
        )}
      </aside>
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
