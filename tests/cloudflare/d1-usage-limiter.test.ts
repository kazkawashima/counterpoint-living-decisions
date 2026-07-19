/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import {
  D1UsageLimiter,
  JUDGE_USAGE_PRODUCT_CEILING_MICRO_USD,
  type D1UsageLimiterLimits,
} from "@counterpoint/adapters-cloudflare";
import type {
  Clock,
  IdGenerator,
  UsageRequest,
  UsageSubject,
} from "@counterpoint/ports";

const START = "2026-07-19T00:00:00.000Z";

const DEFAULT_LIMITS: D1UsageLimiterLimits = {
  accountRequestsPerWindow: 100,
  concurrentReservations: 100,
  costMicroUsdPerWindow: JUDGE_USAGE_PRODUCT_CEILING_MICRO_USD,
  generationsPerWindow: 100,
  ipRequestsPerWindow: 100,
  meetingRequestsPerWindow: 100,
  realtimeSecondsPerWindow: 100_000,
  reservationTtlSeconds: 300,
  tokensPerWindow: 100_000,
};

const DEFAULT_REQUEST: UsageRequest = {
  estimatedCostUsd: 0.1,
  estimatedInputTokens: 1,
  estimatedOutputTokens: 1,
  generationCount: 1,
  realtimeSeconds: 1,
};

let idSequence = 0;

class MutableClock implements Clock {
  #milliseconds: number;

  constructor(value = START) {
    this.#milliseconds = Date.parse(value);
  }

  advanceSeconds(seconds: number): void {
    this.#milliseconds += seconds * 1_000;
  }

  now(): string {
    return new Date(this.#milliseconds).toISOString();
  }
}

class UniqueIds implements IdGenerator {
  next(namespace: string): string {
    idSequence += 1;
    return `${namespace}-${String(idSequence)}`;
  }
}

async function hashIp(ipAddress: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode("synthetic-test-ip-hash-key"),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(ipAddress),
  );
  return `hmac-sha256:${[...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

function subject(
  suffix: string,
  overrides: Partial<UsageSubject> = {},
): UsageSubject {
  return {
    accountId: `account-${suffix}`,
    ipAddress: `203.0.113.${String(suffix.length + 10)}`,
    meetingId: `meeting-${suffix}`,
    ...overrides,
  };
}

function limiter(
  clock: Clock,
  limits: Partial<D1UsageLimiterLimits> = {},
  ids: IdGenerator = new UniqueIds(),
): D1UsageLimiter {
  return new D1UsageLimiter(env.DB, {
    clock,
    hashIp,
    ids,
    limits: { ...DEFAULT_LIMITS, ...limits },
    model: "gpt-synthetic",
    operation: "responses",
    pricingVersion: "2026-07-19",
  });
}

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM judge_usage_reservations").run();
});

async function reservationRow(
  reservationId: string,
): Promise<Record<string, unknown> | undefined> {
  const row = await env.DB.withSession("first-primary")
    .prepare(
      `
        SELECT *
        FROM judge_usage_reservations
        WHERE reservation_id = ?
      `,
    )
    .bind(reservationId)
    .first<Record<string, unknown>>();
  return row ?? undefined;
}

describe("D1UsageLimiter", () => {
  it.each([
    {
      dimension: "account",
      firstRequest: DEFAULT_REQUEST,
      firstSubject: subject("account-first", {
        accountId: "account-shared",
      }),
      limits: { accountRequestsPerWindow: 1 },
      secondRequest: DEFAULT_REQUEST,
      secondSubject: subject("account-second", {
        accountId: "account-shared",
      }),
    },
    {
      dimension: "ip",
      firstRequest: DEFAULT_REQUEST,
      firstSubject: subject("ip-first", { ipAddress: "198.51.100.8" }),
      limits: { ipRequestsPerWindow: 1 },
      secondRequest: DEFAULT_REQUEST,
      secondSubject: subject("ip-second", { ipAddress: "198.51.100.8" }),
    },
    {
      dimension: "meeting",
      firstRequest: DEFAULT_REQUEST,
      firstSubject: subject("meeting-first", {
        meetingId: "meeting-shared",
      }),
      limits: { meetingRequestsPerWindow: 1 },
      secondRequest: DEFAULT_REQUEST,
      secondSubject: subject("meeting-second", {
        meetingId: "meeting-shared",
      }),
    },
    {
      dimension: "concurrency",
      firstRequest: DEFAULT_REQUEST,
      firstSubject: subject("concurrency-first"),
      limits: { concurrentReservations: 1 },
      secondRequest: DEFAULT_REQUEST,
      secondSubject: subject("concurrency-second"),
    },
    {
      dimension: "realtime",
      firstRequest: { ...DEFAULT_REQUEST, realtimeSeconds: 6 },
      firstSubject: subject("realtime-first"),
      limits: { realtimeSecondsPerWindow: 10 },
      secondRequest: { ...DEFAULT_REQUEST, realtimeSeconds: 5 },
      secondSubject: subject("realtime-second"),
    },
    {
      dimension: "tokens",
      firstRequest: {
        ...DEFAULT_REQUEST,
        estimatedInputTokens: 3,
        estimatedOutputTokens: 3,
      },
      firstSubject: subject("tokens-first"),
      limits: { tokensPerWindow: 10 },
      secondRequest: {
        ...DEFAULT_REQUEST,
        estimatedInputTokens: 2,
        estimatedOutputTokens: 3,
      },
      secondSubject: subject("tokens-second"),
    },
    {
      dimension: "generation",
      firstRequest: { ...DEFAULT_REQUEST, generationCount: 1 },
      firstSubject: subject("generation-first"),
      limits: { generationsPerWindow: 1 },
      secondRequest: { ...DEFAULT_REQUEST, generationCount: 1 },
      secondSubject: subject("generation-second"),
    },
    {
      dimension: "cost",
      firstRequest: { ...DEFAULT_REQUEST, estimatedCostUsd: 0.6 },
      firstSubject: subject("cost-first"),
      limits: { costMicroUsdPerWindow: 1_000_000 },
      secondRequest: { ...DEFAULT_REQUEST, estimatedCostUsd: 0.400_001 },
      secondSubject: subject("cost-second"),
    },
  ] as const)(
    "denies the $dimension dimension before another reservation is written",
    async ({
      dimension,
      firstRequest,
      firstSubject,
      limits,
      secondRequest,
      secondSubject,
    }) => {
      const usageLimiter = limiter(new MutableClock(), limits);

      await expect(
        usageLimiter.reserve(firstSubject, firstRequest),
      ).resolves.toMatchObject({ kind: "allowed" });
      await expect(
        usageLimiter.reserve(secondSubject, secondRequest),
      ).resolves.toEqual({ kind: "denied", limit: dimension });

      const count = await env.DB.withSession("first-primary")
        .prepare("SELECT COUNT(*) AS count FROM judge_usage_reservations")
        .first<{ count: number }>();
      expect(count?.count).toBe(1);
    },
  );

  it("allows exactly USD 25 and conservatively denies the next micro-USD", async () => {
    const usageLimiter = limiter(new MutableClock());
    const exact = await usageLimiter.reserve(subject("exact-25"), {
      ...DEFAULT_REQUEST,
      estimatedCostUsd: 25,
    });

    expect(exact).toMatchObject({ kind: "allowed" });
    if (exact.kind !== "allowed") {
      throw new Error("Expected the exact product ceiling reservation");
    }
    await expect(reservationRow(exact.reservationId)).resolves.toMatchObject({
      reserved_cost_micro_usd: 25_000_000,
    });
    await expect(
      usageLimiter.reserve(subject("one-micro-over"), {
        ...DEFAULT_REQUEST,
        estimatedCostUsd: 0.000_000_1,
      }),
    ).resolves.toEqual({ kind: "denied", limit: "cost" });
  });

  it("expires rolling totals at the exact 24-hour boundary", async () => {
    const clock = new MutableClock();
    const usageLimiter = limiter(clock, {
      accountRequestsPerWindow: 1,
      reservationTtlSeconds: 60,
    });
    const account = "account-rolling";

    const first = await usageLimiter.reserve(
      subject("rolling-first", { accountId: account }),
      {
        ...DEFAULT_REQUEST,
        estimatedCostUsd: 25,
      },
    );
    expect(first).toMatchObject({ kind: "allowed" });
    if (first.kind !== "allowed") {
      throw new Error("Expected rolling-window reservation");
    }
    await usageLimiter.finalize(first.reservationId, {
      ...DEFAULT_REQUEST,
      estimatedCostUsd: 25,
    });
    clock.advanceSeconds(24 * 60 * 60);
    await expect(
      usageLimiter.reserve(subject("rolling-second", { accountId: account }), {
        ...DEFAULT_REQUEST,
        estimatedCostUsd: 25,
      }),
    ).resolves.toMatchObject({ kind: "allowed" });
  });

  it("keeps outcome-unknown reservations charged beyond 24 hours", async () => {
    const clock = new MutableClock();
    const usageLimiter = limiter(clock, {
      costMicroUsdPerWindow: 1_000_000,
      reservationTtlSeconds: 60,
    });
    await expect(
      usageLimiter.reserve(subject("unknown-first"), {
        ...DEFAULT_REQUEST,
        estimatedCostUsd: 0.75,
      }),
    ).resolves.toMatchObject({ kind: "allowed" });

    clock.advanceSeconds(24 * 60 * 60);
    await expect(
      usageLimiter.reserve(subject("unknown-second"), {
        ...DEFAULT_REQUEST,
        estimatedCostUsd: 0.3,
      }),
    ).resolves.toEqual({ kind: "denied", limit: "cost" });
  });

  it("admits only one concurrent reservation under Promise.all", async () => {
    const clock = new MutableClock();
    const ids = new UniqueIds();
    const firstLimiter = limiter(clock, { concurrentReservations: 1 }, ids);
    const secondLimiter = limiter(clock, { concurrentReservations: 1 }, ids);

    const decisions = await Promise.all([
      firstLimiter.reserve(subject("parallel-first"), DEFAULT_REQUEST),
      secondLimiter.reserve(subject("parallel-second"), DEFAULT_REQUEST),
    ]);

    expect(decisions.filter(({ kind }) => kind === "allowed")).toHaveLength(1);
    expect(decisions.filter(({ kind }) => kind === "denied")).toEqual([
      { kind: "denied", limit: "concurrency" },
    ]);
  });

  it("keeps reservations durable across adapter restarts", async () => {
    const clock = new MutableClock();
    const ids = new UniqueIds();
    const firstLimiter = limiter(
      clock,
      { costMicroUsdPerWindow: 1_000_000 },
      ids,
    );
    await expect(
      firstLimiter.reserve(subject("restart-first"), {
        ...DEFAULT_REQUEST,
        estimatedCostUsd: 0.75,
      }),
    ).resolves.toMatchObject({ kind: "allowed" });

    const restartedLimiter = limiter(
      clock,
      { costMicroUsdPerWindow: 1_000_000 },
      ids,
    );
    await expect(
      restartedLimiter.reserve(subject("restart-second"), {
        ...DEFAULT_REQUEST,
        estimatedCostUsd: 0.3,
      }),
    ).resolves.toEqual({ kind: "denied", limit: "cost" });
  });

  it("counts reserved usage fully, then makes release and finalize idempotent", async () => {
    const usageLimiter = limiter(new MutableClock(), {
      costMicroUsdPerWindow: 1_000_000,
    });
    const reserved = await usageLimiter.reserve(subject("lifecycle-reserved"), {
      ...DEFAULT_REQUEST,
      estimatedCostUsd: 0.8,
    });
    if (reserved.kind !== "allowed") {
      throw new Error("Expected lifecycle reservation");
    }
    await expect(
      usageLimiter.reserve(subject("lifecycle-denied"), {
        ...DEFAULT_REQUEST,
        estimatedCostUsd: 0.3,
      }),
    ).resolves.toEqual({ kind: "denied", limit: "cost" });

    await usageLimiter.release(reserved.reservationId);
    await usageLimiter.release(reserved.reservationId);
    await expect(
      usageLimiter.finalize(reserved.reservationId, {
        ...DEFAULT_REQUEST,
        estimatedCostUsd: 0.1,
      }),
    ).rejects.toThrow("Released usage reservation cannot be finalized");

    const finalized = await usageLimiter.reserve(
      subject("lifecycle-finalized"),
      {
        ...DEFAULT_REQUEST,
        estimatedCostUsd: 1,
      },
    );
    if (finalized.kind !== "allowed") {
      throw new Error("Expected reservation after release");
    }
    const actual = { ...DEFAULT_REQUEST, estimatedCostUsd: 0.25 };
    await usageLimiter.finalize(finalized.reservationId, actual);
    await usageLimiter.finalize(finalized.reservationId, actual);
    await expect(
      usageLimiter.finalize(finalized.reservationId, {
        ...actual,
        estimatedCostUsd: 0.2,
      }),
    ).rejects.toThrow("different actuals");
    await expect(usageLimiter.release(finalized.reservationId)).rejects.toThrow(
      "Finalized usage reservation cannot be released",
    );

    await expect(
      usageLimiter.reserve(subject("lifecycle-after-finalize"), {
        ...DEFAULT_REQUEST,
        estimatedCostUsd: 0.75,
      }),
    ).resolves.toMatchObject({ kind: "allowed" });
  });

  it("finalizes overlapping reservations in completion order", async () => {
    const clock = new MutableClock();
    const usageLimiter = limiter(clock);
    const first = await usageLimiter.reserve(
      subject("reverse-finalize-first"),
      DEFAULT_REQUEST,
    );
    clock.advanceSeconds(1);
    const second = await usageLimiter.reserve(
      subject("reverse-finalize-second"),
      DEFAULT_REQUEST,
    );
    if (first.kind !== "allowed" || second.kind !== "allowed") {
      throw new Error("Expected overlapping reservations");
    }

    await expect(
      usageLimiter.finalize(first.reservationId, DEFAULT_REQUEST),
    ).resolves.toBeUndefined();
    await expect(
      usageLimiter.finalize(second.reservationId, DEFAULT_REQUEST),
    ).resolves.toBeUndefined();
  });

  it("rejects actual usage above any reserved field without changing state", async () => {
    const usageLimiter = limiter(new MutableClock());
    const reserved = await usageLimiter.reserve(
      subject("actual-invariant"),
      DEFAULT_REQUEST,
    );
    if (reserved.kind !== "allowed") {
      throw new Error("Expected invariant reservation");
    }

    await expect(
      usageLimiter.finalize(reserved.reservationId, {
        ...DEFAULT_REQUEST,
        estimatedOutputTokens: DEFAULT_REQUEST.estimatedOutputTokens + 1,
      }),
    ).rejects.toThrow("Actual usage cannot exceed reserved usage");
    await expect(reservationRow(reserved.reservationId)).resolves.toMatchObject(
      {
        actual_output_tokens: null,
        status: "reserved",
      },
    );
  });

  it("stores only the hashed IP and non-content request metadata", async () => {
    const rawIp = "192.0.2.240";
    const usageLimiter = limiter(new MutableClock());
    const decision = await usageLimiter.reserve(
      subject("privacy", { ipAddress: rawIp }),
      DEFAULT_REQUEST,
    );
    if (decision.kind !== "allowed") {
      throw new Error("Expected privacy reservation");
    }

    const row = await reservationRow(decision.reservationId);
    expect(row).toMatchObject({
      ip_hash: await hashIp(rawIp),
      model: "gpt-synthetic",
      operation: "responses",
      pricing_version: "2026-07-19",
    });
    expect(JSON.stringify(row)).not.toContain(rawIp);

    const unsafeLimiter = new D1UsageLimiter(env.DB, {
      clock: new MutableClock(),
      hashIp: (value) => Promise.resolve(`unsafe:${value}`),
      ids: new UniqueIds(),
      limits: DEFAULT_LIMITS,
      model: "gpt-synthetic",
      operation: "responses",
      pricingVersion: "2026-07-19",
    });
    await expect(
      unsafeLimiter.reserve(
        subject("unsafe", { ipAddress: rawIp }),
        DEFAULT_REQUEST,
      ),
    ).rejects.toThrow("lowercase keyed hmac-sha256 digest");
  });

  it("fails closed on invalid request and dependency input", async () => {
    const usageLimiter = limiter(new MutableClock());

    await expect(
      usageLimiter.reserve(subject("invalid"), {
        ...DEFAULT_REQUEST,
        estimatedInputTokens: -1,
      }),
    ).rejects.toThrow("non-negative safe integer");
    expect(() =>
      limiter(new MutableClock(), {
        costMicroUsdPerWindow: JUDGE_USAGE_PRODUCT_CEILING_MICRO_USD + 1,
      }),
    ).toThrow("USD 25 product ceiling");
  });

  it("defends the fixed product ceiling against direct D1 writes", async () => {
    const statement = env.DB.withSession("first-primary").prepare(`
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
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'reserved', ?, 0, 0, 0, 0, ?, ?)
    `);

    await expect(
      statement
        .bind(
          "direct-invalid-ip",
          "direct-request-invalid-ip",
          "direct-account-invalid-ip",
          "sha256:reversible-ip",
          "direct-meeting-invalid-ip",
          "responses",
          "gpt-synthetic",
          "2026-07-19",
          0,
          99_999,
          100_299,
        )
        .run(),
    ).rejects.toThrow();
    await statement
      .bind(
        "direct-at-cap",
        "direct-request-at-cap",
        "direct-account",
        "hmac-sha256:0000000000000000000000000000000000000000000000000000000000000000",
        "direct-meeting",
        "responses",
        "gpt-synthetic",
        "2026-07-19",
        25_000_000,
        100_000,
        100_300,
      )
      .run();
    await expect(
      statement
        .bind(
          "direct-out-of-order",
          "direct-request-out-of-order",
          "direct-account-older",
          "hmac-sha256:0000000000000000000000000000000000000000000000000000000000000001",
          "direct-meeting-older",
          "responses",
          "gpt-synthetic",
          "2026-07-19",
          0,
          99_999,
          100_299,
        )
        .run(),
    ).rejects.toThrow("counterpoint_judge_usage_timestamp_regression");
    await expect(
      statement
        .bind(
          "direct-over-cap",
          "direct-request-over-cap",
          "direct-account-2",
          "hmac-sha256:0000000000000000000000000000000000000000000000000000000000000002",
          "direct-meeting-2",
          "responses",
          "gpt-synthetic",
          "2026-07-19",
          1,
          100_001,
          100_301,
        )
        .run(),
    ).rejects.toThrow("counterpoint_judge_usage_global_cost_limit");
  });
});
