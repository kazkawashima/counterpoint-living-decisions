/// <reference types="@cloudflare/workers-types" />

import type {
  Clock,
  IdGenerator,
  UsageDecision,
  UsageLimiter,
  UsageRequest,
  UsageSubject,
} from "@counterpoint/ports";

export const JUDGE_USAGE_PRODUCT_CEILING_MICRO_USD = 25_000_000;

const ROLLING_WINDOW_SECONDS = 24 * 60 * 60;
const RESERVATION_ID_NAMESPACE = "judge-usage-reservation";
const REQUEST_FINGERPRINT_NAMESPACE = "judge-usage-request";
const KEYED_IP_HASH_PATTERN = /^hmac-sha256:[a-f0-9]{64}$/u;

export interface D1UsageLimiterLimits {
  readonly accountRequestsPerWindow: number;
  readonly concurrentReservations: number;
  readonly costMicroUsdPerWindow: number;
  readonly generationsPerWindow: number;
  readonly ipRequestsPerWindow: number;
  readonly meetingRequestsPerWindow: number;
  readonly realtimeSecondsPerWindow: number;
  readonly reservationTtlSeconds: number;
  readonly tokensPerWindow: number;
}

export interface D1UsageLimiterOptions {
  readonly clock: Clock | (() => string);
  readonly hashIp: (ipAddress: string) => Promise<string>;
  readonly ids: IdGenerator | ((namespace: string) => string);
  readonly limits: D1UsageLimiterLimits;
  readonly model: string;
  readonly operation: string;
  readonly pricingVersion: string;
}

export interface D1UsageSummaryDimension {
  readonly limit: number;
  readonly remaining: number;
  readonly used: number;
}

export interface D1UsageSummary {
  readonly dimensions: {
    readonly account: D1UsageSummaryDimension;
    readonly concurrency: D1UsageSummaryDimension;
    readonly costMicroUsd: D1UsageSummaryDimension;
    readonly generation: D1UsageSummaryDimension;
    readonly ip: D1UsageSummaryDimension;
    readonly meeting: D1UsageSummaryDimension;
    readonly realtimeSeconds: D1UsageSummaryDimension;
    readonly tokens: D1UsageSummaryDimension;
  };
  readonly rollingWindowSeconds: number;
}

interface StoredReservationRow {
  readonly actual_cost_micro_usd: number | null;
  readonly actual_generation_count: number | null;
  readonly actual_input_tokens: number | null;
  readonly actual_output_tokens: number | null;
  readonly actual_realtime_seconds: number | null;
  readonly reserved_cost_micro_usd: number;
  readonly reserved_generation_count: number;
  readonly reserved_input_tokens: number;
  readonly reserved_output_tokens: number;
  readonly reserved_realtime_seconds: number;
  readonly status: "finalized" | "released" | "reserved";
}

interface UsageAggregateRow {
  readonly account_requests: number;
  readonly concurrent_reservations: number;
  readonly cost_micro_usd: number;
  readonly generation_count: number;
  readonly ip_requests: number;
  readonly meeting_requests: number;
  readonly realtime_seconds: number;
  readonly token_count: number;
}

interface NormalizedUsage {
  readonly costMicroUsd: number;
  readonly generationCount: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly realtimeSeconds: number;
}

type UsageLimitDimension = Exclude<
  Extract<UsageDecision, { kind: "denied" }>["limit"],
  never
>;

const INSERT_RESERVATION_SQL = `
  WITH rolling AS (
    SELECT
      COALESCE(SUM(CASE WHEN account_id = ? THEN 1 ELSE 0 END), 0)
        AS account_requests,
      COALESCE(SUM(CASE WHEN ip_hash = ? THEN 1 ELSE 0 END), 0)
        AS ip_requests,
      COALESCE(SUM(CASE WHEN meeting_id = ? THEN 1 ELSE 0 END), 0)
        AS meeting_requests,
      COALESCE(SUM(
        CASE status
          WHEN 'reserved' THEN reserved_realtime_seconds
          ELSE actual_realtime_seconds
        END
      ), 0) AS realtime_seconds,
      COALESCE(SUM(
        CASE status
          WHEN 'reserved' THEN
            reserved_input_tokens + reserved_output_tokens
          ELSE actual_input_tokens + actual_output_tokens
        END
      ), 0) AS token_count,
      COALESCE(SUM(
        CASE status
          WHEN 'reserved' THEN reserved_generation_count
          ELSE actual_generation_count
        END
      ), 0) AS generation_count,
      COALESCE(SUM(
        CASE status
          WHEN 'reserved' THEN reserved_cost_micro_usd
          ELSE actual_cost_micro_usd
        END
      ), 0) AS cost_micro_usd
    FROM judge_usage_reservations
    WHERE status = 'reserved'
      OR (
        status = 'finalized'
        AND finalized_at_epoch > ?
      )
  ),
  active AS (
    SELECT COUNT(*) AS concurrent_reservations
    FROM judge_usage_reservations
    WHERE status = 'reserved'
      AND active_until_epoch > ?
  )
  INSERT INTO judge_usage_reservations (
    reservation_id,
    request_fingerprint,
    account_id,
    ip_hash,
    meeting_id,
    operation,
    model,
    pricing_version,
    status,
    reserved_cost_micro_usd,
    reserved_input_tokens,
    reserved_output_tokens,
    reserved_generation_count,
    reserved_realtime_seconds,
    reserved_at_epoch,
    active_until_epoch
  )
  SELECT
    ?, ?, ?, ?, ?, ?, ?, ?, 'reserved', ?, ?, ?, ?, ?, ?, ?
  FROM rolling, active
  WHERE account_requests + 1 <= ?
    AND ip_requests + 1 <= ?
    AND meeting_requests + 1 <= ?
    AND concurrent_reservations + 1 <= ?
    AND realtime_seconds + ? <= ?
    AND token_count + ? + ? <= ?
    AND generation_count + ? <= ?
    AND cost_micro_usd + ? <= ?
`;

const READ_USAGE_SQL = `
  SELECT
    COALESCE(SUM(CASE WHEN account_id = ? THEN 1 ELSE 0 END), 0)
      AS account_requests,
    COALESCE(SUM(CASE WHEN ip_hash = ? THEN 1 ELSE 0 END), 0)
      AS ip_requests,
    COALESCE(SUM(CASE WHEN meeting_id = ? THEN 1 ELSE 0 END), 0)
      AS meeting_requests,
    COALESCE(SUM(
      CASE status
        WHEN 'reserved' THEN reserved_realtime_seconds
        ELSE actual_realtime_seconds
      END
    ), 0) AS realtime_seconds,
    COALESCE(SUM(
      CASE status
        WHEN 'reserved' THEN reserved_input_tokens + reserved_output_tokens
        ELSE actual_input_tokens + actual_output_tokens
      END
    ), 0) AS token_count,
    COALESCE(SUM(
      CASE status
        WHEN 'reserved' THEN reserved_generation_count
        ELSE actual_generation_count
      END
    ), 0) AS generation_count,
    COALESCE(SUM(
      CASE status
        WHEN 'reserved' THEN reserved_cost_micro_usd
        ELSE actual_cost_micro_usd
      END
    ), 0) AS cost_micro_usd,
    (
      SELECT COUNT(*)
      FROM judge_usage_reservations
      WHERE status = 'reserved'
        AND active_until_epoch > ?
    ) AS concurrent_reservations
  FROM judge_usage_reservations
  WHERE status = 'reserved'
    OR (
      status = 'finalized'
      AND finalized_at_epoch > ?
    )
`;

function requireNonEmpty(
  value: unknown,
  label: string,
): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
}

function requireNonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer`);
  }
  return value as number;
}

function requirePositiveInteger(value: unknown, label: string): number {
  const integer = requireNonNegativeInteger(value, label);
  if (integer === 0) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  return integer;
}

function usdToMicroUsd(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${label} must be a finite non-negative number`);
  }
  if (value === 0) {
    return 0;
  }

  const scaled = value * 1_000_000;
  if (!Number.isFinite(scaled) || scaled > Number.MAX_SAFE_INTEGER) {
    throw new TypeError(`${label} is too large`);
  }
  const roundedUp = Math.ceil(scaled);
  return roundedUp === 0 ? 1 : roundedUp;
}

function normalizeUsage(request: UsageRequest, label: string): NormalizedUsage {
  if (typeof request !== "object" || request === null) {
    throw new TypeError(`${label} must be an object`);
  }
  return {
    costMicroUsd: usdToMicroUsd(
      request.estimatedCostUsd,
      `${label}.estimatedCostUsd`,
    ),
    generationCount: requireNonNegativeInteger(
      request.generationCount,
      `${label}.generationCount`,
    ),
    inputTokens: requireNonNegativeInteger(
      request.estimatedInputTokens,
      `${label}.estimatedInputTokens`,
    ),
    outputTokens: requireNonNegativeInteger(
      request.estimatedOutputTokens,
      `${label}.estimatedOutputTokens`,
    ),
    realtimeSeconds: requireNonNegativeInteger(
      request.realtimeSeconds,
      `${label}.realtimeSeconds`,
    ),
  };
}

function unixSeconds(clock: Clock | (() => string)): number {
  const value = typeof clock === "function" ? clock() : clock.now();
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) {
    throw new TypeError("Clock must return a valid timestamp");
  }
  return requireNonNegativeInteger(
    Math.floor(milliseconds / 1_000),
    "Clock timestamp",
  );
}

function nextId(
  ids: IdGenerator | ((namespace: string) => string),
  namespace: string,
): string {
  const value =
    typeof ids === "function" ? ids(namespace) : ids.next(namespace);
  requireNonEmpty(value, `${namespace} ID`);
  return value;
}

function normalizedAggregate(row: UsageAggregateRow): UsageAggregateRow {
  return {
    account_requests: requireNonNegativeInteger(
      row.account_requests,
      "Stored account request count",
    ),
    concurrent_reservations: requireNonNegativeInteger(
      row.concurrent_reservations,
      "Stored concurrent reservation count",
    ),
    cost_micro_usd: requireNonNegativeInteger(
      row.cost_micro_usd,
      "Stored cost",
    ),
    generation_count: requireNonNegativeInteger(
      row.generation_count,
      "Stored generation count",
    ),
    ip_requests: requireNonNegativeInteger(
      row.ip_requests,
      "Stored IP request count",
    ),
    meeting_requests: requireNonNegativeInteger(
      row.meeting_requests,
      "Stored meeting request count",
    ),
    realtime_seconds: requireNonNegativeInteger(
      row.realtime_seconds,
      "Stored Realtime seconds",
    ),
    token_count: requireNonNegativeInteger(
      row.token_count,
      "Stored token count",
    ),
  };
}

function summaryDimension(
  used: number,
  limit: number,
): D1UsageSummaryDimension {
  return {
    limit,
    remaining: Math.max(0, limit - used),
    used,
  };
}

function sameActual(
  row: StoredReservationRow,
  actual: NormalizedUsage,
): boolean {
  return (
    row.actual_cost_micro_usd === actual.costMicroUsd &&
    row.actual_input_tokens === actual.inputTokens &&
    row.actual_output_tokens === actual.outputTokens &&
    row.actual_generation_count === actual.generationCount &&
    row.actual_realtime_seconds === actual.realtimeSeconds
  );
}

function isGlobalCostTriggerError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes("counterpoint_judge_usage_global_cost_limit")
  );
}

export class D1UsageLimiter implements UsageLimiter {
  readonly #clock: Clock | (() => string);
  readonly #database: D1Database;
  readonly #hashIp: (ipAddress: string) => Promise<string>;
  readonly #ids: IdGenerator | ((namespace: string) => string);
  readonly #limits: D1UsageLimiterLimits;
  readonly #model: string;
  readonly #operation: string;
  readonly #pricingVersion: string;

  constructor(database: D1Database, options: D1UsageLimiterOptions) {
    requireNonEmpty(options.operation, "operation");
    requireNonEmpty(options.model, "model");
    requireNonEmpty(options.pricingVersion, "pricingVersion");
    if (typeof options.hashIp !== "function") {
      throw new TypeError("hashIp must be an async hash function");
    }

    const limits: D1UsageLimiterLimits = {
      accountRequestsPerWindow: requireNonNegativeInteger(
        options.limits.accountRequestsPerWindow,
        "accountRequestsPerWindow",
      ),
      concurrentReservations: requireNonNegativeInteger(
        options.limits.concurrentReservations,
        "concurrentReservations",
      ),
      costMicroUsdPerWindow: requireNonNegativeInteger(
        options.limits.costMicroUsdPerWindow,
        "costMicroUsdPerWindow",
      ),
      generationsPerWindow: requireNonNegativeInteger(
        options.limits.generationsPerWindow,
        "generationsPerWindow",
      ),
      ipRequestsPerWindow: requireNonNegativeInteger(
        options.limits.ipRequestsPerWindow,
        "ipRequestsPerWindow",
      ),
      meetingRequestsPerWindow: requireNonNegativeInteger(
        options.limits.meetingRequestsPerWindow,
        "meetingRequestsPerWindow",
      ),
      realtimeSecondsPerWindow: requireNonNegativeInteger(
        options.limits.realtimeSecondsPerWindow,
        "realtimeSecondsPerWindow",
      ),
      reservationTtlSeconds: requirePositiveInteger(
        options.limits.reservationTtlSeconds,
        "reservationTtlSeconds",
      ),
      tokensPerWindow: requireNonNegativeInteger(
        options.limits.tokensPerWindow,
        "tokensPerWindow",
      ),
    };
    if (limits.costMicroUsdPerWindow > JUDGE_USAGE_PRODUCT_CEILING_MICRO_USD) {
      throw new TypeError(
        "costMicroUsdPerWindow cannot exceed the USD 25 product ceiling",
      );
    }

    this.#clock = options.clock;
    this.#database = database;
    this.#hashIp = options.hashIp;
    this.#ids = options.ids;
    this.#limits = limits;
    this.#model = options.model;
    this.#operation = options.operation;
    this.#pricingVersion = options.pricingVersion;
  }

  async reserve(
    subject: UsageSubject,
    request: UsageRequest,
  ): Promise<UsageDecision> {
    if (typeof subject !== "object" || subject === null) {
      throw new TypeError("subject must be an object");
    }
    requireNonEmpty(subject.accountId, "subject.accountId");
    requireNonEmpty(subject.ipAddress, "subject.ipAddress");
    requireNonEmpty(subject.meetingId, "subject.meetingId");
    const usage = normalizeUsage(request, "request");
    const now = unixSeconds(this.#clock);
    const activeUntil = now + this.#limits.reservationTtlSeconds;
    if (!Number.isSafeInteger(activeUntil)) {
      throw new TypeError("Reservation expiry is too large");
    }

    const ipHash = await this.#hashIp(subject.ipAddress);
    if (!KEYED_IP_HASH_PATTERN.test(ipHash)) {
      throw new TypeError(
        "IP hash must be a lowercase keyed hmac-sha256 digest",
      );
    }

    const reservationId = nextId(this.#ids, RESERVATION_ID_NAMESPACE);
    const requestFingerprint = nextId(this.#ids, REQUEST_FINGERPRINT_NAMESPACE);
    const cutoff = now - ROLLING_WINDOW_SECONDS;
    const session = this.#database.withSession("first-primary");

    try {
      const result = await session
        .prepare(INSERT_RESERVATION_SQL)
        .bind(
          subject.accountId,
          ipHash,
          subject.meetingId,
          cutoff,
          now,
          reservationId,
          requestFingerprint,
          subject.accountId,
          ipHash,
          subject.meetingId,
          this.#operation,
          this.#model,
          this.#pricingVersion,
          usage.costMicroUsd,
          usage.inputTokens,
          usage.outputTokens,
          usage.generationCount,
          usage.realtimeSeconds,
          now,
          activeUntil,
          this.#limits.accountRequestsPerWindow,
          this.#limits.ipRequestsPerWindow,
          this.#limits.meetingRequestsPerWindow,
          this.#limits.concurrentReservations,
          usage.realtimeSeconds,
          this.#limits.realtimeSecondsPerWindow,
          usage.inputTokens,
          usage.outputTokens,
          this.#limits.tokensPerWindow,
          usage.generationCount,
          this.#limits.generationsPerWindow,
          usage.costMicroUsd,
          this.#limits.costMicroUsdPerWindow,
        )
        .run();
      if (result.meta.changes === 1) {
        return { kind: "allowed", reservationId };
      }
      if (result.meta.changes !== 0) {
        throw new Error(
          "D1 reservation insert changed an unexpected row count",
        );
      }
    } catch (error) {
      if (isGlobalCostTriggerError(error)) {
        return { kind: "denied", limit: "cost" };
      }
      throw error;
    }

    const limit = await this.#deniedLimit(
      session,
      subject,
      ipHash,
      usage,
      now,
      cutoff,
    );
    if (limit === undefined) {
      throw new Error("D1 rejected a usage reservation without a known limit");
    }
    return { kind: "denied", limit };
  }

  async finalize(reservationId: string, actual: UsageRequest): Promise<void> {
    requireNonEmpty(reservationId, "reservationId");
    const usage = normalizeUsage(actual, "actual");
    const now = unixSeconds(this.#clock);
    const session = this.#database.withSession("first-primary");
    const result = await session
      .prepare(
        `
          UPDATE judge_usage_reservations
          SET
            status = 'finalized',
            actual_cost_micro_usd = ?,
            actual_input_tokens = ?,
            actual_output_tokens = ?,
            actual_generation_count = ?,
            actual_realtime_seconds = ?,
            finalized_at_epoch = ?
          WHERE reservation_id = ?
            AND status = 'reserved'
            AND ? <= reserved_cost_micro_usd
            AND ? <= reserved_input_tokens
            AND ? <= reserved_output_tokens
            AND ? <= reserved_generation_count
            AND ? <= reserved_realtime_seconds
        `,
      )
      .bind(
        usage.costMicroUsd,
        usage.inputTokens,
        usage.outputTokens,
        usage.generationCount,
        usage.realtimeSeconds,
        now,
        reservationId,
        usage.costMicroUsd,
        usage.inputTokens,
        usage.outputTokens,
        usage.generationCount,
        usage.realtimeSeconds,
      )
      .run();
    if (result.meta.changes === 1) {
      return;
    }
    if (result.meta.changes !== 0) {
      throw new Error("D1 finalize changed an unexpected row count");
    }

    const row = await this.#reservation(session, reservationId);
    if (row === undefined) {
      throw new Error("Unknown usage reservation");
    }
    if (row.status === "finalized" && sameActual(row, usage)) {
      return;
    }
    if (row.status === "released") {
      throw new Error("Released usage reservation cannot be finalized");
    }
    if (row.status === "finalized") {
      throw new Error("Usage reservation was finalized with different actuals");
    }
    throw new RangeError("Actual usage cannot exceed reserved usage");
  }

  async release(reservationId: string): Promise<void> {
    requireNonEmpty(reservationId, "reservationId");
    const now = unixSeconds(this.#clock);
    const session = this.#database.withSession("first-primary");
    const result = await session
      .prepare(
        `
          UPDATE judge_usage_reservations
          SET status = 'released', released_at_epoch = ?
          WHERE reservation_id = ? AND status = 'reserved'
        `,
      )
      .bind(now, reservationId)
      .run();
    if (result.meta.changes === 1) {
      return;
    }
    if (result.meta.changes !== 0) {
      throw new Error("D1 release changed an unexpected row count");
    }

    const row = await this.#reservation(session, reservationId);
    if (row === undefined) {
      throw new Error("Unknown usage reservation");
    }
    if (row.status === "released") {
      return;
    }
    throw new Error("Finalized usage reservation cannot be released");
  }

  async readUsageSummary(subject: UsageSubject): Promise<D1UsageSummary> {
    if (typeof subject !== "object" || subject === null) {
      throw new TypeError("subject must be an object");
    }
    requireNonEmpty(subject.accountId, "subject.accountId");
    requireNonEmpty(subject.ipAddress, "subject.ipAddress");
    requireNonEmpty(subject.meetingId, "subject.meetingId");

    const ipHash = await this.#hashIp(subject.ipAddress);
    if (!KEYED_IP_HASH_PATTERN.test(ipHash)) {
      throw new TypeError(
        "IP hash must be a lowercase keyed hmac-sha256 digest",
      );
    }

    const now = unixSeconds(this.#clock);
    const aggregate = await this.#usageAggregate(
      this.#database.withSession("first-primary"),
      subject,
      ipHash,
      now,
      now - ROLLING_WINDOW_SECONDS,
    );

    return {
      dimensions: {
        account: summaryDimension(
          aggregate.account_requests,
          this.#limits.accountRequestsPerWindow,
        ),
        concurrency: summaryDimension(
          aggregate.concurrent_reservations,
          this.#limits.concurrentReservations,
        ),
        costMicroUsd: summaryDimension(
          aggregate.cost_micro_usd,
          this.#limits.costMicroUsdPerWindow,
        ),
        generation: summaryDimension(
          aggregate.generation_count,
          this.#limits.generationsPerWindow,
        ),
        ip: summaryDimension(
          aggregate.ip_requests,
          this.#limits.ipRequestsPerWindow,
        ),
        meeting: summaryDimension(
          aggregate.meeting_requests,
          this.#limits.meetingRequestsPerWindow,
        ),
        realtimeSeconds: summaryDimension(
          aggregate.realtime_seconds,
          this.#limits.realtimeSecondsPerWindow,
        ),
        tokens: summaryDimension(
          aggregate.token_count,
          this.#limits.tokensPerWindow,
        ),
      },
      rollingWindowSeconds: ROLLING_WINDOW_SECONDS,
    };
  }

  async #deniedLimit(
    session: D1DatabaseSession,
    subject: UsageSubject,
    ipHash: string,
    usage: NormalizedUsage,
    now: number,
    cutoff: number,
  ): Promise<UsageLimitDimension | undefined> {
    const aggregate = await this.#usageAggregate(
      session,
      subject,
      ipHash,
      now,
      cutoff,
    );

    if (
      aggregate.account_requests + 1 >
      this.#limits.accountRequestsPerWindow
    ) {
      return "account";
    }
    if (aggregate.ip_requests + 1 > this.#limits.ipRequestsPerWindow) {
      return "ip";
    }
    if (
      aggregate.meeting_requests + 1 >
      this.#limits.meetingRequestsPerWindow
    ) {
      return "meeting";
    }
    if (
      aggregate.concurrent_reservations + 1 >
      this.#limits.concurrentReservations
    ) {
      return "concurrency";
    }
    if (
      aggregate.realtime_seconds + usage.realtimeSeconds >
      this.#limits.realtimeSecondsPerWindow
    ) {
      return "realtime";
    }
    if (
      aggregate.token_count + usage.inputTokens + usage.outputTokens >
      this.#limits.tokensPerWindow
    ) {
      return "tokens";
    }
    if (
      aggregate.generation_count + usage.generationCount >
      this.#limits.generationsPerWindow
    ) {
      return "generation";
    }
    if (
      aggregate.cost_micro_usd + usage.costMicroUsd >
      this.#limits.costMicroUsdPerWindow
    ) {
      return "cost";
    }
    return undefined;
  }

  async #usageAggregate(
    session: D1DatabaseSession,
    subject: UsageSubject,
    ipHash: string,
    now: number,
    cutoff: number,
  ): Promise<UsageAggregateRow> {
    const row = await session
      .prepare(READ_USAGE_SQL)
      .bind(subject.accountId, ipHash, subject.meetingId, now, cutoff)
      .first<UsageAggregateRow>();
    if (row === null) {
      throw new Error("D1 usage aggregate query returned no row");
    }
    return normalizedAggregate(row);
  }

  async #reservation(
    session: D1DatabaseSession,
    reservationId: string,
  ): Promise<StoredReservationRow | undefined> {
    const row = await session
      .prepare(
        `
          SELECT
            status,
            reserved_cost_micro_usd,
            actual_cost_micro_usd,
            reserved_input_tokens,
            actual_input_tokens,
            reserved_output_tokens,
            actual_output_tokens,
            reserved_generation_count,
            actual_generation_count,
            reserved_realtime_seconds,
            actual_realtime_seconds
          FROM judge_usage_reservations
          WHERE reservation_id = ?
        `,
      )
      .bind(reservationId)
      .first<StoredReservationRow>();
    return row ?? undefined;
  }
}
