import { DurableObject } from "cloudflare:workers";

import {
  D1UsageLimiter,
  JUDGE_USAGE_PRODUCT_CEILING_MICRO_USD,
} from "@counterpoint/adapters-cloudflare";
import {
  DEFAULT_OPENAI_REALTIME_MODEL,
  GPT_REALTIME_2_1_PRICING_VERSION,
  MAX_OPENAI_REALTIME_SDP_BYTES,
  OpenAiManagedRealtimeCallConnector,
  OpenAiManagedRealtimeCallTerminator,
  OpenAiRealtimeSidebandConnector,
  emptyOpenAiRealtimeUsageState,
  recordOpenAiRealtimeServerEvent,
  type OpenAiRealtimeUsageState,
} from "@counterpoint/adapters-openai";
import type {
  ManagedRealtimeCallConnector,
  ManagedRealtimeCallTerminator,
  ManagedRealtimeSidebandConnection,
  ManagedRealtimeSidebandConnector,
  ManagedRealtimeSidebandDisconnect,
  UsageLimiter,
  UsageRequest,
} from "@counterpoint/ports";

export const JUDGE_REALTIME_MAX_DURATION_SECONDS = 30;
export const JUDGE_REALTIME_RETRY_DELAY_SECONDS = 5;
export const JUDGE_REALTIME_RESERVED_USAGE: UsageRequest = {
  estimatedCostUsd: 25,
  estimatedInputTokens: 800_000,
  estimatedOutputTokens: 400_000,
  generationCount: 100,
  realtimeSeconds: JUDGE_REALTIME_MAX_DURATION_SECONDS,
};

const CALL_STATE_KEY = "judge-realtime-call";
const JUDGE_REALTIME_USAGE_LIMITS = {
  costMicroUsd: JUDGE_USAGE_PRODUCT_CEILING_MICRO_USD,
  generationCount: JUDGE_REALTIME_RESERVED_USAGE.generationCount,
  inputTokens: JUDGE_REALTIME_RESERVED_USAGE.estimatedInputTokens,
  outputTokens: JUDGE_REALTIME_RESERVED_USAGE.estimatedOutputTokens,
} as const;
const JSON_HEADERS = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
} as const;

interface JudgeRealtimeBindings extends WorkerBindings {
  readonly OPENAI_API_KEY_JUDGE?: string;
}

export interface ReservationRow {
  readonly model: string;
  readonly operation: string;
  readonly pricing_version: string;
  readonly reserved_cost_micro_usd: number;
  readonly reserved_generation_count: number;
  readonly reserved_input_tokens: number;
  readonly reserved_output_tokens: number;
  readonly reserved_realtime_seconds: number;
  readonly status: string;
}

export function isExactJudgeRealtimeReservation(
  row: ReservationRow | null,
): boolean {
  return (
    row?.status === "reserved" &&
    row.operation === "judge_realtime" &&
    row.model === DEFAULT_OPENAI_REALTIME_MODEL &&
    row.pricing_version === GPT_REALTIME_2_1_PRICING_VERSION &&
    row.reserved_cost_micro_usd === JUDGE_USAGE_PRODUCT_CEILING_MICRO_USD &&
    row.reserved_input_tokens ===
      JUDGE_REALTIME_RESERVED_USAGE.estimatedInputTokens &&
    row.reserved_output_tokens ===
      JUDGE_REALTIME_RESERVED_USAGE.estimatedOutputTokens &&
    row.reserved_generation_count ===
      JUDGE_REALTIME_RESERVED_USAGE.generationCount &&
    row.reserved_realtime_seconds ===
      JUDGE_REALTIME_RESERVED_USAGE.realtimeSeconds
  );
}

export interface StartCallInput {
  readonly channel: "private" | "shared";
  readonly reservationId: string;
  readonly safetyIdentifier: string;
  readonly sdpOffer: string;
}

export type StoredCallState =
  | {
      readonly reservationId: string;
      readonly reservedUsage: UsageRequest;
      readonly sidebandUsage: OpenAiRealtimeUsageState;
      readonly startedAtEpochMs: number;
      readonly status: "connecting";
      readonly terminateAtEpochMs: number;
    }
  | {
      readonly callId: string;
      readonly reservationId: string;
      readonly reservedUsage: UsageRequest;
      readonly sidebandUsage: OpenAiRealtimeUsageState;
      readonly startedAtEpochMs: number;
      readonly status: "active";
      readonly terminateAtEpochMs: number;
    }
  | {
      readonly reservationId: string;
      readonly reservedUsage: UsageRequest;
      readonly sidebandUsage: OpenAiRealtimeUsageState;
      readonly status: "hangup_confirmed";
    }
  | {
      readonly settledAtEpochMs: number;
      readonly status: "settled";
    };

export interface JudgeRealtimeCallStorage {
  confirmHangup(
    callId: string,
  ): Promise<
    | Extract<StoredCallState, { readonly status: "hangup_confirmed" }>
    | undefined
  >;
  deleteAlarm(): Promise<void>;
  get(): Promise<StoredCallState | undefined>;
  markSidebandUntrustworthy(callId: string): Promise<boolean>;
  put(state: StoredCallState): Promise<void>;
  replaceActiveUsage(
    callId: string,
    expected: OpenAiRealtimeUsageState,
    next: OpenAiRealtimeUsageState,
  ): Promise<boolean>;
  replaceConnecting(
    reservationId: string,
    state: Extract<
      StoredCallState,
      { readonly status: "active" | "hangup_confirmed" }
    >,
  ): Promise<boolean>;
  setAlarm(scheduledTimeEpochMs: number): Promise<void>;
}

export interface JudgeRealtimeCallLifecycleDependencies {
  readonly clock: () => number;
  readonly connector: ManagedRealtimeCallConnector;
  readonly sideband: ManagedRealtimeSidebandConnector;
  readonly storage: JudgeRealtimeCallStorage;
  readonly terminator: ManagedRealtimeCallTerminator;
  readonly usage: Pick<UsageLimiter, "finalize">;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
): boolean {
  const allowed = new Set(required);
  return (
    required.every((key) => key in value) &&
    Object.keys(value).every((key) => allowed.has(key))
  );
}

function nonEmptyString(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.trim() === value
  );
}

function parseStartCallInput(value: unknown): StartCallInput | undefined {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "channel",
      "reservationId",
      "safetyIdentifier",
      "sdpOffer",
    ]) ||
    (value.channel !== "private" && value.channel !== "shared") ||
    !nonEmptyString(value.reservationId) ||
    value.reservationId.length > 255 ||
    !nonEmptyString(value.safetyIdentifier) ||
    value.safetyIdentifier.length > 512 ||
    /\s/u.test(value.safetyIdentifier) ||
    !nonEmptyString(value.sdpOffer) ||
    new TextEncoder().encode(value.sdpOffer).byteLength >
      MAX_OPENAI_REALTIME_SDP_BYTES
  ) {
    return undefined;
  }
  return {
    channel: value.channel,
    reservationId: value.reservationId,
    safetyIdentifier: value.safetyIdentifier,
    sdpOffer: value.sdpOffer,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { headers: JSON_HEADERS, status });
}

function sameUsageState(
  left: OpenAiRealtimeUsageState,
  right: OpenAiRealtimeUsageState,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export class JudgeRealtimeCallLifecycle {
  readonly #clock: () => number;
  readonly #connector: ManagedRealtimeCallConnector;
  readonly #sidebandConnector: ManagedRealtimeSidebandConnector;
  #sidebandConnection: ManagedRealtimeSidebandConnection | undefined;
  #startCancelled = false;
  #startInProgress = false;
  #termination: Promise<void> | undefined;
  readonly #storage: JudgeRealtimeCallStorage;
  readonly #terminator: ManagedRealtimeCallTerminator;
  readonly #usage: Pick<UsageLimiter, "finalize">;

  constructor(dependencies: JudgeRealtimeCallLifecycleDependencies) {
    this.#clock = dependencies.clock;
    this.#connector = dependencies.connector;
    this.#sidebandConnector = dependencies.sideband;
    this.#storage = dependencies.storage;
    this.#terminator = dependencies.terminator;
    this.#usage = dependencies.usage;
  }

  async start(input: StartCallInput): Promise<
    | {
        readonly channel: "private" | "shared";
        readonly kind: "started";
        readonly model: string;
        readonly sdpAnswer: string;
      }
    | { readonly kind: "conflict" }
    | { readonly kind: "unavailable" }
  > {
    if (this.#startInProgress) {
      return { kind: "conflict" };
    }
    this.#startInProgress = true;
    this.#startCancelled = false;
    try {
      return await this.#start(input);
    } finally {
      this.#startCancelled = false;
      this.#startInProgress = false;
    }
  }

  async #start(input: StartCallInput): Promise<
    | {
        readonly channel: "private" | "shared";
        readonly kind: "started";
        readonly model: string;
        readonly sdpAnswer: string;
      }
    | { readonly kind: "conflict" }
    | { readonly kind: "unavailable" }
  > {
    if ((await this.#storage.get()) !== undefined) {
      return { kind: "conflict" };
    }
    if (this.#startCancelled) {
      await this.#usage
        .finalize(input.reservationId, JUDGE_REALTIME_RESERVED_USAGE)
        .catch(() => undefined);
      return { kind: "unavailable" };
    }

    const startedAtEpochMs = this.#clock();
    const terminateAtEpochMs =
      startedAtEpochMs + JUDGE_REALTIME_MAX_DURATION_SECONDS * 1_000;
    let acceptedCallId: string | undefined;
    try {
      await this.#storage.put({
        reservationId: input.reservationId,
        reservedUsage: JUDGE_REALTIME_RESERVED_USAGE,
        sidebandUsage: {
          ...emptyOpenAiRealtimeUsageState(),
          trustworthy: false,
        },
        startedAtEpochMs,
        status: "connecting",
        terminateAtEpochMs,
      });
      await this.#storage.setAlarm(terminateAtEpochMs);

      const call = await this.#connector.connect(input, async (callId) => {
        acceptedCallId = callId;
        const activeState: Extract<
          StoredCallState,
          { readonly status: "active" }
        > = {
          callId,
          reservationId: input.reservationId,
          reservedUsage: JUDGE_REALTIME_RESERVED_USAGE,
          sidebandUsage: emptyOpenAiRealtimeUsageState(),
          startedAtEpochMs,
          status: "active",
          terminateAtEpochMs,
        };
        if (
          !(await this.#storage.replaceConnecting(
            input.reservationId,
            activeState,
          ))
        ) {
          try {
            await this.#terminator.hangup(callId);
          } catch {
            await this.#storage.put({
              ...activeState,
              sidebandUsage: {
                ...activeState.sidebandUsage,
                trustworthy: false,
              },
              terminateAtEpochMs:
                this.#clock() + JUDGE_REALTIME_RETRY_DELAY_SECONDS * 1_000,
            });
            await this.#storage.setAlarm(
              this.#clock() + JUDGE_REALTIME_RETRY_DELAY_SECONDS * 1_000,
            );
          }
          throw new Error(
            "Realtime call was accepted after its durable claim was cancelled",
          );
        }
        const sidebandConnection = await this.#sidebandConnector.connect(
          callId,
          {
            onDisconnect: (event) => this.sidebandDisconnected(event),
            onProviderEvent: (event) => this.recordProviderEvent(event),
          },
        );
        this.#sidebandConnection = sidebandConnection;
        const attachedState = await this.#storage.get();
        if (
          attachedState?.status !== "active" ||
          attachedState.callId !== callId
        ) {
          sidebandConnection.close();
          throw new Error(
            "Realtime sideband lost durable call ownership during attachment",
          );
        }
      });
      const finalState = await this.#storage.get();
      if (
        finalState?.status !== "active" ||
        finalState.callId !== call.callId ||
        !finalState.sidebandUsage.trustworthy ||
        this.#sidebandConnection?.isHealthy() !== true
      ) {
        await this.terminate().catch(() => undefined);
        return { kind: "unavailable" };
      }
      return {
        channel: call.channel,
        kind: "started",
        model: call.model,
        sdpAnswer: call.sdpAnswer,
      };
    } catch {
      const stored = await this.#storage.get().catch(() => undefined);
      if (stored === undefined) {
        if (acceptedCallId !== undefined) {
          const terminateAtEpochMs =
            this.#clock() + JUDGE_REALTIME_RETRY_DELAY_SECONDS * 1_000;
          await this.#storage
            .put({
              callId: acceptedCallId,
              reservationId: input.reservationId,
              reservedUsage: JUDGE_REALTIME_RESERVED_USAGE,
              sidebandUsage: {
                ...emptyOpenAiRealtimeUsageState(),
                trustworthy: false,
              },
              startedAtEpochMs: this.#clock(),
              status: "active",
              terminateAtEpochMs,
            })
            .then(() => this.#storage.setAlarm(terminateAtEpochMs))
            .catch(() => undefined);
        } else {
          await this.#storage
            .put({
              reservationId: input.reservationId,
              reservedUsage: JUDGE_REALTIME_RESERVED_USAGE,
              sidebandUsage: {
                ...emptyOpenAiRealtimeUsageState(),
                trustworthy: false,
              },
              status: "hangup_confirmed",
            })
            .catch(() => undefined);
        }
      }
      await this.terminate().catch(() => undefined);
      return { kind: "unavailable" };
    }
  }

  async status(): Promise<
    | { readonly kind: "empty" }
    | {
        readonly kind: "connecting";
        readonly terminateAtEpochMs: number;
      }
    | {
        readonly kind: "active";
        readonly observedGenerationCount: number;
        readonly telemetryTrustworthy: boolean;
        readonly terminateAtEpochMs: number;
      }
    | {
        readonly kind: "settlement_pending";
        readonly telemetryTrustworthy: boolean;
      }
    | { readonly kind: "settled"; readonly settledAtEpochMs: number }
  > {
    const state = await this.#storage.get();
    if (state === undefined) {
      return { kind: "empty" };
    }
    if (state.status === "connecting") {
      return {
        kind: "connecting",
        terminateAtEpochMs: state.terminateAtEpochMs,
      };
    }
    if (state.status === "active") {
      return {
        kind: "active",
        observedGenerationCount: state.sidebandUsage.totals.generationCount,
        telemetryTrustworthy: state.sidebandUsage.trustworthy,
        terminateAtEpochMs: state.terminateAtEpochMs,
      };
    }
    if (state.status === "hangup_confirmed") {
      return {
        kind: "settlement_pending",
        telemetryTrustworthy: state.sidebandUsage.trustworthy,
      };
    }
    return {
      kind: "settled",
      settledAtEpochMs: state.settledAtEpochMs,
    };
  }

  async terminate(): Promise<void> {
    if (this.#startInProgress) {
      this.#startCancelled = true;
    }
    if (this.#termination !== undefined) {
      return this.#termination;
    }
    const operation = this.#terminate();
    this.#termination = operation;
    try {
      await operation;
    } finally {
      if (this.#termination === operation) {
        this.#termination = undefined;
      }
    }
  }

  async #terminate(): Promise<void> {
    let state: StoredCallState | undefined;
    for (;;) {
      state = await this.#storage.get();
      if (state === undefined || state.status === "settled") {
        await this.#storage.deleteAlarm();
        return;
      }
      if (state.status !== "connecting") {
        break;
      }
      const cancelledState: Extract<
        StoredCallState,
        { readonly status: "hangup_confirmed" }
      > = {
        reservationId: state.reservationId,
        reservedUsage: state.reservedUsage,
        sidebandUsage: state.sidebandUsage,
        status: "hangup_confirmed",
      };
      if (
        await this.#storage.replaceConnecting(
          state.reservationId,
          cancelledState,
        )
      ) {
        state = cancelledState;
        break;
      }
    }
    if (state.status === "active") {
      await this.#terminator.hangup(state.callId);
      const confirmedState = await this.#storage.confirmHangup(state.callId);
      if (confirmedState === undefined) {
        return this.#terminate();
      }
      state = confirmedState;
      this.#sidebandConnection?.close();
    }
    await this.#usage.finalize(state.reservationId, state.reservedUsage);
    await this.#storage.put({
      settledAtEpochMs: this.#clock(),
      status: "settled",
    });
    await this.#storage.deleteAlarm();
  }

  async recordProviderEvent(event: unknown): Promise<void> {
    const state = await this.#storage.get();
    if (state?.status !== "active") {
      return;
    }
    const result = recordOpenAiRealtimeServerEvent(
      state.sidebandUsage,
      event,
      JUDGE_REALTIME_USAGE_LIMITS,
    );
    if (result.kind === "ignored" || result.kind === "duplicate") {
      return;
    }
    if (
      !(await this.#storage.replaceActiveUsage(
        state.callId,
        state.sidebandUsage,
        result.state,
      ))
    ) {
      return;
    }
    if (result.kind === "invalid" || result.kind === "limit_exceeded") {
      await this.terminate();
    }
  }

  async sidebandDisconnected(
    event: ManagedRealtimeSidebandDisconnect,
  ): Promise<void> {
    if (event.initiatedByServer) {
      return;
    }
    const state = await this.#storage.get();
    if (state === undefined || state.status === "settled") {
      return;
    }
    if (state.status === "active" && state.sidebandUsage.trustworthy) {
      await this.#storage.markSidebandUntrustworthy(state.callId);
    }
    await this.terminate();
  }
}

export function createJudgeRealtimeUsageLimiter(
  database: D1Database,
  options: {
    readonly clock: () => string;
    readonly hashIp: (ipAddress: string) => Promise<string>;
    readonly ids: (namespace: string) => string;
  },
): UsageLimiter {
  return new D1UsageLimiter(database, {
    clock: options.clock,
    hashIp: options.hashIp,
    ids: options.ids,
    limits: {
      accountRequestsPerWindow: 10,
      concurrentReservations: 1,
      costMicroUsdPerWindow: JUDGE_USAGE_PRODUCT_CEILING_MICRO_USD,
      generationsPerWindow: JUDGE_REALTIME_RESERVED_USAGE.generationCount,
      ipRequestsPerWindow: 10,
      meetingRequestsPerWindow: 10,
      realtimeSecondsPerWindow: JUDGE_REALTIME_RESERVED_USAGE.realtimeSeconds,
      reservationTtlSeconds: JUDGE_REALTIME_MAX_DURATION_SECONDS + 30,
      tokensPerWindow:
        JUDGE_REALTIME_RESERVED_USAGE.estimatedInputTokens +
        JUDGE_REALTIME_RESERVED_USAGE.estimatedOutputTokens,
    },
    model: DEFAULT_OPENAI_REALTIME_MODEL,
    operation: "judge_realtime",
    pricingVersion: GPT_REALTIME_2_1_PRICING_VERSION,
  });
}

export class JudgeRealtimeCallController extends DurableObject<JudgeRealtimeBindings> {
  readonly #context: DurableObjectState;
  #lifecycleInstance: JudgeRealtimeCallLifecycle | undefined;
  #startRequestCancelled = false;
  #startRequestInProgress = false;
  readonly #storage: JudgeRealtimeCallStorage;

  constructor(
    context: DurableObjectState,
    override readonly env: JudgeRealtimeBindings,
  ) {
    super(context, env);
    this.#context = context;
    this.#storage = {
      confirmHangup: (callId) =>
        context.storage.transaction(async (transaction) => {
          const current =
            await transaction.get<StoredCallState>(CALL_STATE_KEY);
          if (current?.status !== "active" || current.callId !== callId) {
            return undefined;
          }
          const next: Extract<
            StoredCallState,
            { readonly status: "hangup_confirmed" }
          > = {
            reservationId: current.reservationId,
            reservedUsage: current.reservedUsage,
            sidebandUsage: current.sidebandUsage,
            status: "hangup_confirmed",
          };
          await transaction.put(CALL_STATE_KEY, next);
          return next;
        }),
      deleteAlarm: () => context.storage.deleteAlarm(),
      get: () => context.storage.get<StoredCallState>(CALL_STATE_KEY),
      markSidebandUntrustworthy: (callId) =>
        context.storage.transaction(async (transaction) => {
          const current =
            await transaction.get<StoredCallState>(CALL_STATE_KEY);
          if (current?.status !== "active" || current.callId !== callId) {
            return false;
          }
          if (!current.sidebandUsage.trustworthy) {
            return true;
          }
          await transaction.put(CALL_STATE_KEY, {
            ...current,
            sidebandUsage: {
              ...current.sidebandUsage,
              trustworthy: false,
            },
          });
          return true;
        }),
      put: (state) => context.storage.put(CALL_STATE_KEY, state),
      replaceActiveUsage: (callId, expected, next) =>
        context.storage.transaction(async (transaction) => {
          const current =
            await transaction.get<StoredCallState>(CALL_STATE_KEY);
          if (
            current?.status !== "active" ||
            current.callId !== callId ||
            !sameUsageState(current.sidebandUsage, expected)
          ) {
            return false;
          }
          await transaction.put(CALL_STATE_KEY, {
            ...current,
            sidebandUsage: next,
          });
          return true;
        }),
      replaceConnecting: (reservationId, state) =>
        context.storage.transaction(async (transaction) => {
          const current =
            await transaction.get<StoredCallState>(CALL_STATE_KEY);
          if (
            current?.status !== "connecting" ||
            current.reservationId !== reservationId
          ) {
            return false;
          }
          await transaction.put(CALL_STATE_KEY, state);
          return true;
        }),
      setAlarm: (scheduledTimeEpochMs) =>
        context.storage.setAlarm(scheduledTimeEpochMs),
    };
  }

  override async alarm(): Promise<void> {
    const lifecycle = this.#lifecycle();
    if (lifecycle === undefined) {
      await this.#storage.setAlarm(
        Date.now() + JUDGE_REALTIME_RETRY_DELAY_SECONDS * 1_000,
      );
      return;
    }
    try {
      await lifecycle.terminate();
    } catch {
      await this.#storage.setAlarm(
        Date.now() + JUDGE_REALTIME_RETRY_DELAY_SECONDS * 1_000,
      );
    }
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const lifecycle = this.#lifecycle();
    if (request.method === "GET" && url.pathname === "/status") {
      return jsonResponse(
        lifecycle === undefined
          ? { kind: "not_configured" }
          : await lifecycle.status(),
      );
    }
    if (
      request.method !== "POST" ||
      (url.pathname !== "/start" && url.pathname !== "/terminate")
    ) {
      return jsonResponse({ code: "NOT_FOUND" }, 404);
    }
    if (lifecycle === undefined) {
      return jsonResponse({ code: "REALTIME_UNAVAILABLE" }, 503);
    }
    if (url.pathname === "/terminate") {
      if (this.#startRequestInProgress) {
        this.#startRequestCancelled = true;
      }
      try {
        await lifecycle.terminate();
        return jsonResponse({ kind: "terminated" });
      } catch {
        return jsonResponse({ code: "REALTIME_UNAVAILABLE" }, 503);
      }
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ code: "INVALID_REQUEST" }, 400);
    }
    const parsed = parseStartCallInput(body);
    if (parsed === undefined) {
      return jsonResponse({ code: "INVALID_REQUEST" }, 400);
    }
    if (this.#startRequestInProgress) {
      return jsonResponse({ code: "CALL_ALREADY_STARTED" }, 409);
    }
    this.#startRequestInProgress = true;
    this.#startRequestCancelled = false;
    try {
      let reservationReady: boolean;
      try {
        reservationReady = await this.#reservationReady(parsed.reservationId);
      } catch {
        return jsonResponse({ code: "REALTIME_UNAVAILABLE" }, 503);
      }
      if (this.#startRequestCancelled) {
        return jsonResponse({ code: "REALTIME_UNAVAILABLE" }, 503);
      }
      if (!reservationReady) {
        return jsonResponse({ code: "USAGE_LIMIT_REACHED" }, 429);
      }
      const result = await lifecycle.start(parsed);
      if (this.#startRequestCancelled || result.kind === "unavailable") {
        return jsonResponse({ code: "REALTIME_UNAVAILABLE" }, 503);
      }
      if (result.kind === "conflict") {
        return jsonResponse({ code: "CALL_ALREADY_STARTED" }, 409);
      }
      return jsonResponse(result, 201);
    } finally {
      this.#startRequestCancelled = false;
      this.#startRequestInProgress = false;
    }
  }

  #lifecycle(): JudgeRealtimeCallLifecycle | undefined {
    const apiKey = this.env.OPENAI_API_KEY_JUDGE;
    if (
      apiKey === undefined ||
      apiKey.trim().length === 0 ||
      apiKey.trim() !== apiKey
    ) {
      return undefined;
    }
    this.#lifecycleInstance ??= new JudgeRealtimeCallLifecycle({
      clock: Date.now,
      connector: new OpenAiManagedRealtimeCallConnector({ apiKey }),
      sideband: new OpenAiRealtimeSidebandConnector({
        apiKey,
        dispatch: (work) => this.#context.waitUntil(work),
      }),
      storage: this.#storage,
      terminator: new OpenAiManagedRealtimeCallTerminator({ apiKey }),
      usage: createJudgeRealtimeUsageLimiter(this.env.DB, {
        clock: () => new Date().toISOString(),
        hashIp: () => Promise.resolve(`hmac-sha256:${"0".repeat(64)}`),
        ids: () => crypto.randomUUID(),
      }),
    });
    return this.#lifecycleInstance;
  }

  async #reservationReady(reservationId: string): Promise<boolean> {
    const row = await this.env.DB.withSession("first-primary")
      .prepare(
        `
          SELECT
            status,
            operation,
            model,
            pricing_version,
            reserved_cost_micro_usd,
            reserved_input_tokens,
            reserved_output_tokens,
            reserved_generation_count,
            reserved_realtime_seconds
          FROM judge_usage_reservations
          WHERE reservation_id = ?
        `,
      )
      .bind(reservationId)
      .first<ReservationRow>();
    return isExactJudgeRealtimeReservation(row);
  }
}
