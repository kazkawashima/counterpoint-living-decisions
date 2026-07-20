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

const SYNTHETIC_REQUEST_FINGERPRINT =
  "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
const OTHER_SYNTHETIC_REQUEST_FINGERPRINT =
  "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

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

async function sha256Fingerprint(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return `sha256:${[...new Uint8Array(digest)]
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
  database: D1Database = env.DB,
): D1UsageLimiter {
  return new D1UsageLimiter(database, {
    clock,
    hashIp,
    ids,
    limits: { ...DEFAULT_LIMITS, ...limits },
    model: "gpt-synthetic",
    operation: "responses",
    pricingVersion: "2026-07-19",
  });
}

function trackDatabaseSessions(database: D1Database): {
  readonly database: D1Database;
  readonly sessionCount: () => number;
} {
  let sessionCount = 0;
  return {
    database: new Proxy(database, {
      get(target, property, receiver) {
        if (property === "withSession") {
          return (constraint?: string): D1DatabaseSession => {
            sessionCount += 1;
            return target.withSession(constraint);
          };
        }
        return Reflect.get(target, property, receiver) as unknown;
      },
    }),
    sessionCount: () => sessionCount,
  };
}

function validationProbe(): {
  readonly d1StatementCount: () => number;
  readonly hashIpCount: () => number;
  readonly usageLimiter: D1UsageLimiter;
} {
  let d1StatementCount = 0;
  let hashIpCount = 0;
  const session = env.DB.withSession("first-primary");
  const trackedSession = new Proxy(session, {
    get(target, property, receiver) {
      if (property === "prepare") {
        return (query: string): D1PreparedStatement => {
          d1StatementCount += 1;
          return target.prepare(query);
        };
      }
      return Reflect.get(target, property, receiver) as unknown;
    },
  });
  const database = new Proxy(env.DB, {
    get(target, property, receiver) {
      if (property === "withSession") {
        return (): D1DatabaseSession => trackedSession;
      }
      return Reflect.get(target, property, receiver) as unknown;
    },
  });
  const usageLimiter = new D1UsageLimiter(database, {
    clock: new MutableClock(),
    hashIp: async (ipAddress) => {
      hashIpCount += 1;
      return hashIp(ipAddress);
    },
    ids: new UniqueIds(),
    limits: DEFAULT_LIMITS,
    model: "gpt-synthetic",
    operation: "responses",
    pricingVersion: "2026-07-19",
  });
  return {
    d1StatementCount: () => d1StatementCount,
    hashIpCount: () => hashIpCount,
    usageLimiter,
  };
}

function failAfterCommittedReservationInsert(): D1Database {
  let shouldFail = true;

  const wrapStatement = (
    statement: D1PreparedStatement,
    isReservationInsert: boolean,
  ): D1PreparedStatement =>
    new Proxy(statement, {
      get(target, property, receiver) {
        if (property === "bind") {
          return (...values: unknown[]) =>
            wrapStatement(target.bind(...values), isReservationInsert);
        }
        if (property === "run" && isReservationInsert) {
          return async () => {
            const result = await target.run();
            if (shouldFail) {
              shouldFail = false;
              throw new Error("synthetic response loss after durable insert");
            }
            return result;
          };
        }
        return Reflect.get(target, property, receiver) as unknown;
      },
    });

  const session = env.DB.withSession("first-primary");
  const wrappedSession = new Proxy(session, {
    get(target, property, receiver) {
      if (property === "prepare") {
        return (query: string) =>
          wrapStatement(
            target.prepare(query),
            query.includes("INSERT INTO judge_usage_reservations"),
          );
      }
      return Reflect.get(target, property, receiver) as unknown;
    },
  });

  return new Proxy(env.DB, {
    get(target, property, receiver) {
      if (property === "withSession") {
        return () => wrappedSession;
      }
      return Reflect.get(target, property, receiver) as unknown;
    },
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
    ["malformed", ""],
    ["content-bearing", "reservation user@example.com"],
    ["oversized", "a".repeat(257)],
  ])(
    "rejects a %s caller reservation ID before hashing or D1 access",
    async (_kind, reservationId) => {
      const probe = validationProbe();

      await expect(
        probe.usageLimiter.reserveWithId(
          {
            requestFingerprint: SYNTHETIC_REQUEST_FINGERPRINT,
            reservationId,
          },
          subject("invalid-reservation-id"),
          DEFAULT_REQUEST,
        ),
      ).rejects.toThrow("identity.reservationId");
      expect(probe.hashIpCount()).toBe(0);
      expect(probe.d1StatementCount()).toBe(0);
    },
  );

  it.each([
    ["malformed", "sha256:not-a-digest"],
    ["non-lowercase", `sha256:${"A".repeat(64)}`],
  ])(
    "rejects a %s request fingerprint before hashing or D1 access",
    async (_kind, requestFingerprint) => {
      const probe = validationProbe();

      await expect(
        probe.usageLimiter.reserveWithId(
          {
            requestFingerprint,
            reservationId: "caller-reservation-validation",
          },
          subject("invalid-request-fingerprint"),
          DEFAULT_REQUEST,
        ),
      ).rejects.toThrow("identity.requestFingerprint");
      expect(probe.hashIpCount()).toBe(0);
      expect(probe.d1StatementCount()).toBe(0);
    },
  );

  it("hashes generated request identities without changing reserve decisions", async () => {
    const generatedRequestIds: string[] = [];
    let sequence = 0;
    const ids: IdGenerator = {
      next(namespace) {
        sequence += 1;
        const value = `${namespace}-${String(sequence)}`;
        if (namespace === "judge-usage-request") {
          generatedRequestIds.push(value);
        }
        return value;
      },
    };
    const usageLimiter = limiter(new MutableClock(), {}, ids);

    const first = await usageLimiter.reserve(
      subject("generated-first"),
      DEFAULT_REQUEST,
    );
    const second = await usageLimiter.reserve(
      subject("generated-second"),
      DEFAULT_REQUEST,
    );

    expect(first).toEqual({
      kind: "allowed",
      reservationId: "judge-usage-reservation-1",
    });
    expect(second).toEqual({
      kind: "allowed",
      reservationId: "judge-usage-reservation-3",
    });
    const firstRow = await reservationRow("judge-usage-reservation-1");
    const secondRow = await reservationRow("judge-usage-reservation-3");
    expect(firstRow?.request_fingerprint).toBe(
      await sha256Fingerprint(generatedRequestIds[0]!),
    );
    expect(secondRow?.request_fingerprint).toBe(
      await sha256Fingerprint(generatedRequestIds[1]!),
    );
    expect(firstRow?.request_fingerprint).not.toBe(
      secondRow?.request_fingerprint,
    );
    expect(JSON.stringify([firstRow, secondRow])).not.toContain(
      generatedRequestIds[0],
    );
    expect(JSON.stringify([firstRow, secondRow])).not.toContain(
      generatedRequestIds[1],
    );
  });

  it("inserts the caller reservation ID", async () => {
    const usageLimiter = limiter(new MutableClock());

    const decision = await usageLimiter.reserveWithId(
      {
        requestFingerprint: SYNTHETIC_REQUEST_FINGERPRINT,
        reservationId: "caller-reservation-insert",
      },
      subject("named-insert"),
      DEFAULT_REQUEST,
    );

    expect(decision).toEqual({
      activeUntilEpoch: Date.parse(START) / 1_000 + 300,
      kind: "allowed",
      reservationId: "caller-reservation-insert",
      reservedAtEpoch: Date.parse(START) / 1_000,
    });
    await expect(
      reservationRow("caller-reservation-insert"),
    ).resolves.toMatchObject({
      request_fingerprint: SYNTHETIC_REQUEST_FINGERPRINT,
      reservation_id: "caller-reservation-insert",
    });
  });

  it("recovers an exact durable insert after caller uncertainty", async () => {
    const clock = new MutableClock();
    const usageLimiter = limiter(
      clock,
      {},
      new UniqueIds(),
      failAfterCommittedReservationInsert(),
    );
    const identity = {
      requestFingerprint: SYNTHETIC_REQUEST_FINGERPRINT,
      reservationId: "caller-reservation-uncertain",
    };
    const scopedSubject = subject("named-uncertain");

    await expect(
      usageLimiter.reserveWithId(identity, scopedSubject, DEFAULT_REQUEST),
    ).rejects.toThrow("synthetic response loss after durable insert");
    clock.advanceSeconds(120);

    await expect(
      usageLimiter.reserveWithId(identity, scopedSubject, DEFAULT_REQUEST),
    ).resolves.toEqual({
      activeUntilEpoch: Date.parse(START) / 1_000 + 300,
      kind: "allowed",
      reservationId: identity.reservationId,
      reservedAtEpoch: Date.parse(START) / 1_000,
    });
    const rows = await env.DB.withSession("first-primary")
      .prepare(
        `
          SELECT COUNT(*) AS count, MIN(reserved_at_epoch) AS reserved_at_epoch
          FROM judge_usage_reservations
          WHERE reservation_id = ?
        `,
      )
      .bind(identity.reservationId)
      .first<{ count: number; reserved_at_epoch: number }>();
    expect(rows).toEqual({
      count: 1,
      reserved_at_epoch: Date.parse(START) / 1_000,
    });
  });

  it("rejects a same-ID immutable-field collision", async () => {
    const usageLimiter = limiter(new MutableClock());
    const identity = {
      requestFingerprint: SYNTHETIC_REQUEST_FINGERPRINT,
      reservationId: "caller-reservation-collision",
    };

    await expect(
      usageLimiter.reserveWithId(
        identity,
        subject("named-collision"),
        DEFAULT_REQUEST,
      ),
    ).resolves.toMatchObject({ kind: "allowed" });
    await expect(
      usageLimiter.reserveWithId(identity, subject("named-collision"), {
        ...DEFAULT_REQUEST,
        estimatedOutputTokens: DEFAULT_REQUEST.estimatedOutputTokens + 1,
      }),
    ).rejects.toThrow("immutable fields");
    await expect(
      usageLimiter.reserveWithId(
        {
          ...identity,
          requestFingerprint: OTHER_SYNTHETIC_REQUEST_FINGERPRINT,
        },
        subject("named-collision"),
        DEFAULT_REQUEST,
      ),
    ).rejects.toThrow("immutable fields");
    const count = await env.DB.withSession("first-primary")
      .prepare(
        "SELECT COUNT(*) AS count FROM judge_usage_reservations WHERE reservation_id = ?",
      )
      .bind(identity.reservationId)
      .first<{ count: number }>();
    expect(count?.count).toBe(1);
  });

  it("finds only content-free reservation state", async () => {
    const rawIp = "192.0.2.199";
    const usageLimiter = limiter(new MutableClock());
    const identity = {
      requestFingerprint: SYNTHETIC_REQUEST_FINGERPRINT,
      reservationId: "caller-reservation-find",
    };
    const scopedSubject = subject("named-find", {
      accountId: "account-find-owner",
      ipAddress: rawIp,
      meetingId: "meeting-find-owner",
    });

    await usageLimiter.reserveWithId(identity, scopedSubject, {
      estimatedCostUsd: 0.25,
      estimatedInputTokens: 11,
      estimatedOutputTokens: 7,
      generationCount: 2,
      realtimeSeconds: 3,
    });

    const found = await usageLimiter.findReservation(identity.reservationId);
    expect(found).toMatchObject({
      accountId: scopedSubject.accountId,
      actualCostMicroUsd: undefined,
      actualGenerationCount: undefined,
      actualInputTokens: undefined,
      actualOutputTokens: undefined,
      actualRealtimeSeconds: undefined,
      estimatedCostMicroUsd: 250_000,
      estimatedGenerationCount: 2,
      estimatedInputTokens: 11,
      estimatedOutputTokens: 7,
      estimatedRealtimeSeconds: 3,
      ipHash: await hashIp(rawIp),
      meetingId: scopedSubject.meetingId,
      model: "gpt-synthetic",
      operation: "responses",
      pricingVersion: "2026-07-19",
      requestFingerprint: identity.requestFingerprint,
      reservationId: identity.reservationId,
      status: "reserved",
    });
    expect(JSON.stringify(found)).not.toContain(rawIp);
    expect(JSON.stringify(found)).not.toContain("content");
    await expect(
      usageLimiter.findReservation("missing-reservation"),
    ).resolves.toBeUndefined();
  });

  it("preserves trustworthy actuals when claim settlement was interrupted", async () => {
    const clock = new MutableClock();
    const usageLimiter = limiter(clock);
    const identity = {
      requestFingerprint: SYNTHETIC_REQUEST_FINGERPRINT,
      reservationId: "caller-reservation-settlement",
    };
    const scopedSubject = subject("named-settlement");
    const reserved = await usageLimiter.reserveWithId(identity, scopedSubject, {
      ...DEFAULT_REQUEST,
      estimatedCostUsd: 0.8,
      estimatedInputTokens: 20,
      estimatedOutputTokens: 10,
    });
    if (reserved.kind !== "allowed") {
      throw new Error("Expected named reservation");
    }
    await usageLimiter.finalize(identity.reservationId, {
      ...DEFAULT_REQUEST,
      estimatedCostUsd: 0.2,
      estimatedInputTokens: 3,
      estimatedOutputTokens: 2,
    });
    clock.advanceSeconds(60);

    await expect(
      usageLimiter.reserveWithId(identity, scopedSubject, {
        ...DEFAULT_REQUEST,
        estimatedCostUsd: 0.8,
        estimatedInputTokens: 20,
        estimatedOutputTokens: 10,
      }),
    ).resolves.toEqual(reserved);
    await expect(
      usageLimiter.findReservation(identity.reservationId),
    ).resolves.toMatchObject({
      actualCostMicroUsd: 200_000,
      actualGenerationCount: 1,
      actualInputTokens: 3,
      actualOutputTokens: 2,
      actualRealtimeSeconds: 1,
      status: "finalized",
    });
  });

  it("fails closed when an exact named reservation was released", async () => {
    const tracked = trackDatabaseSessions(env.DB);
    const usageLimiter = limiter(
      new MutableClock(),
      {},
      new UniqueIds(),
      tracked.database,
    );
    const identity = {
      requestFingerprint: SYNTHETIC_REQUEST_FINGERPRINT,
      reservationId: "caller-reservation-released",
    };
    const scopedSubject = subject("named-released");

    const reserved = await usageLimiter.reserveWithId(
      identity,
      scopedSubject,
      DEFAULT_REQUEST,
    );
    if (reserved.kind !== "allowed") {
      throw new Error("Expected named reservation");
    }
    await usageLimiter.release(identity.reservationId);

    await expect(
      usageLimiter.reserveWithId(identity, scopedSubject, DEFAULT_REQUEST),
    ).rejects.toThrow("Released usage reservation cannot be recovered");
    const rows = await env.DB.withSession("first-primary")
      .prepare(
        `
          SELECT COUNT(*) AS count, MIN(status) AS status
          FROM judge_usage_reservations
          WHERE reservation_id = ?
        `,
      )
      .bind(identity.reservationId)
      .first<{ count: number; status: string }>();
    expect(rows).toEqual({ count: 1, status: "released" });
    expect(tracked.sessionCount()).toBe(1);
  });

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

  it("reports reserved usage against every limit without exposing identifiers or content", async () => {
    const clock = new MutableClock();
    const usageLimiter = limiter(clock, {
      accountRequestsPerWindow: 4,
      concurrentReservations: 3,
      costMicroUsdPerWindow: 1_000_000,
      generationsPerWindow: 8,
      ipRequestsPerWindow: 5,
      meetingRequestsPerWindow: 6,
      realtimeSecondsPerWindow: 100,
      tokensPerWindow: 50,
    });
    const scopedSubject = subject("summary-reserved", {
      accountId: "private-account-id",
      ipAddress: "192.0.2.88",
      meetingId: "private-meeting-id",
    });
    const reservation = await usageLimiter.reserve(scopedSubject, {
      estimatedCostUsd: 0.8,
      estimatedInputTokens: 20,
      estimatedOutputTokens: 10,
      generationCount: 4,
      realtimeSeconds: 80,
    });
    expect(reservation).toMatchObject({ kind: "allowed" });

    const summary = await usageLimiter.readUsageSummary(scopedSubject);

    expect(summary).toEqual({
      dimensions: {
        account: { limit: 4, remaining: 3, used: 1 },
        concurrency: { limit: 3, remaining: 2, used: 1 },
        costMicroUsd: { limit: 1_000_000, remaining: 200_000, used: 800_000 },
        generation: { limit: 8, remaining: 4, used: 4 },
        ip: { limit: 5, remaining: 4, used: 1 },
        meeting: { limit: 6, remaining: 5, used: 1 },
        realtimeSeconds: { limit: 100, remaining: 20, used: 80 },
        tokens: { limit: 50, remaining: 20, used: 30 },
      },
      rollingWindowSeconds: 24 * 60 * 60,
    });
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain(scopedSubject.accountId);
    expect(serialized).not.toContain(scopedSubject.ipAddress);
    expect(serialized).not.toContain(scopedSubject.meetingId);
    if (reservation.kind === "allowed") {
      expect(serialized).not.toContain(reservation.reservationId);
    }
    expect(serialized).not.toContain("private content");
  });

  it("uses finalized actuals, excludes releases, and expires at the exact rolling boundary", async () => {
    const clock = new MutableClock();
    const usageLimiter = limiter(clock, {
      costMicroUsdPerWindow: 1_000_000,
      generationsPerWindow: 10,
      realtimeSecondsPerWindow: 100,
      tokensPerWindow: 100,
    });
    const scopedSubject = subject("summary-lifecycle");
    const finalized = await usageLimiter.reserve(scopedSubject, {
      estimatedCostUsd: 0.8,
      estimatedInputTokens: 20,
      estimatedOutputTokens: 10,
      generationCount: 4,
      realtimeSeconds: 80,
    });
    const released = await usageLimiter.reserve(scopedSubject, {
      estimatedCostUsd: 0.1,
      estimatedInputTokens: 5,
      estimatedOutputTokens: 5,
      generationCount: 1,
      realtimeSeconds: 10,
    });
    if (finalized.kind !== "allowed" || released.kind !== "allowed") {
      throw new Error("Expected summary lifecycle reservations");
    }
    await usageLimiter.finalize(finalized.reservationId, {
      estimatedCostUsd: 0.25,
      estimatedInputTokens: 3,
      estimatedOutputTokens: 2,
      generationCount: 1,
      realtimeSeconds: 8,
    });
    await usageLimiter.release(released.reservationId);

    await expect(usageLimiter.readUsageSummary(scopedSubject)).resolves.toEqual(
      {
        dimensions: {
          account: { limit: 100, remaining: 99, used: 1 },
          concurrency: { limit: 100, remaining: 100, used: 0 },
          costMicroUsd: {
            limit: 1_000_000,
            remaining: 750_000,
            used: 250_000,
          },
          generation: { limit: 10, remaining: 9, used: 1 },
          ip: { limit: 100, remaining: 99, used: 1 },
          meeting: { limit: 100, remaining: 99, used: 1 },
          realtimeSeconds: { limit: 100, remaining: 92, used: 8 },
          tokens: { limit: 100, remaining: 95, used: 5 },
        },
        rollingWindowSeconds: 24 * 60 * 60,
      },
    );

    clock.advanceSeconds(24 * 60 * 60 - 1);
    expect(
      (await usageLimiter.readUsageSummary(scopedSubject)).dimensions
        .costMicroUsd.used,
    ).toBe(250_000);

    clock.advanceSeconds(1);
    await expect(usageLimiter.readUsageSummary(scopedSubject)).resolves.toEqual(
      {
        dimensions: {
          account: { limit: 100, remaining: 100, used: 0 },
          concurrency: { limit: 100, remaining: 100, used: 0 },
          costMicroUsd: {
            limit: 1_000_000,
            remaining: 1_000_000,
            used: 0,
          },
          generation: { limit: 10, remaining: 10, used: 0 },
          ip: { limit: 100, remaining: 100, used: 0 },
          meeting: { limit: 100, remaining: 100, used: 0 },
          realtimeSeconds: { limit: 100, remaining: 100, used: 0 },
          tokens: { limit: 100, remaining: 100, used: 0 },
        },
        rollingWindowSeconds: 24 * 60 * 60,
      },
    );
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
