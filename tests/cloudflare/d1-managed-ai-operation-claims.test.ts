/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { env } from "cloudflare:workers";
import {
  D1ManagedAiOperationClaimRepository,
  type ManagedAiOperationClaim,
  type ManagedAiOperationLifecycleClaim,
} from "@counterpoint/adapters-cloudflare";
import { describe, expect, it } from "vitest";

const NOW_EPOCH = 1_753_000_000;

function fingerprint(character: string): string {
  const hex = [...character]
    .map((value) => value.codePointAt(0)?.toString(16) ?? "00")
    .join("");
  return `sha256:${hex.repeat(Math.ceil(64 / hex.length)).slice(0, 64)}`;
}

function operationClaim(
  suffix: string,
  nowEpoch = NOW_EPOCH,
): ManagedAiOperationClaim {
  return {
    claimKeyHash: fingerprint(suffix),
    createdAtEpoch: nowEpoch,
    expiresAtEpoch: nowEpoch + 300,
    model: "gpt-5.6-sol",
    operation: "private_disclosure",
    pricingVersion: "openai-2026-07-20",
    requestFingerprint: fingerprint(
      suffix === "a" ? "b" : suffix === "b" ? "c" : "d",
    ),
  };
}

function lifecycleClaim(suffix: string, nowEpoch = NOW_EPOCH) {
  return {
    ...operationClaim(suffix, nowEpoch),
    expectedStatus: "reserved" as const,
    leaseExpiresAtEpoch: nowEpoch + 120,
    reservationId: `reservation:${suffix}`,
  };
}

async function lifecycleRow(
  claimKeyHash: string,
): Promise<Record<string, unknown> | null> {
  return env.DB.withSession("first-primary")
    .prepare(
      `
        SELECT
          claims.claim_key_hash,
          claims.request_fingerprint,
          claims.operation,
          claims.model,
          claims.pricing_version,
          claims.created_at_epoch,
          claims.expires_at_epoch,
          lifecycle.status,
          lifecycle.reservation_id,
          lifecycle.lease_expires_at_epoch,
          lifecycle.provider_started_at_epoch,
          lifecycle.settled_at_epoch,
          lifecycle.reuse_after_epoch
        FROM judge_managed_ai_operation_claims AS claims
        JOIN judge_managed_ai_operation_lifecycle AS lifecycle
          USING (claim_key_hash)
        WHERE claims.claim_key_hash = ?
      `,
    )
    .bind(claimKeyHash)
    .first<Record<string, unknown>>();
}

async function insertLegacyClaim(
  input: ReturnType<typeof lifecycleClaim>,
): Promise<void> {
  const session = env.DB.withSession("first-primary");
  await session.batch([
    session
      .prepare(
        `
          INSERT INTO judge_managed_ai_operation_claims (
            claim_key_hash,
            request_fingerprint,
            operation,
            model,
            pricing_version,
            created_at_epoch,
            expires_at_epoch
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .bind(
        input.claimKeyHash,
        input.requestFingerprint,
        input.operation,
        input.model,
        input.pricingVersion,
        input.createdAtEpoch,
        input.expiresAtEpoch,
      ),
    session
      .prepare(
        `
          INSERT INTO judge_managed_ai_operation_lifecycle (
            claim_key_hash,
            status
          ) VALUES (?, 'legacy_blocked')
        `,
      )
      .bind(input.claimKeyHash),
  ]);
}

function synchronizedLifecycleReadDatabase(): D1Database {
  const session = env.DB.withSession("first-primary");
  let releaseReaders: (() => void) | undefined;
  const readersReleased = new Promise<void>((resolve) => {
    releaseReaders = resolve;
  });
  let readerCount = 0;

  const wrapStatement = (
    statement: D1PreparedStatement,
    synchronizeRead: boolean,
  ): D1PreparedStatement =>
    new Proxy(statement, {
      get(target, property, receiver) {
        if (property === "bind") {
          return (...values: unknown[]) =>
            wrapStatement(target.bind(...values), synchronizeRead);
        }
        if (property === "first" && synchronizeRead) {
          return async () => {
            const row = await target.first();
            readerCount += 1;
            if (readerCount === 2) {
              releaseReaders?.();
            }
            await readersReleased;
            return row;
          };
        }
        return Reflect.get(target, property, receiver) as unknown;
      },
    });

  const synchronizedSession = new Proxy(session, {
    get(target, property, receiver) {
      if (property === "prepare") {
        return (query: string) =>
          wrapStatement(
            target.prepare(query),
            query.includes(
              "FROM judge_managed_ai_operation_claims AS claims",
            ),
          );
      }
      return Reflect.get(target, property, receiver) as unknown;
    },
  });

  return new Proxy(env.DB, {
    get(target, property, receiver) {
      if (property === "withSession") {
        return () => synchronizedSession;
      }
      return Reflect.get(target, property, receiver) as unknown;
    },
  });
}

describe("D1 managed-AI operation claims", () => {
  it("claims content-free metadata once, replays the exact request, and conflicts on changed content", async () => {
    const repository = new D1ManagedAiOperationClaimRepository(env.DB);
    const claim = operationClaim("a");

    await expect(repository.claim(claim)).resolves.toBe("claimed");
    await expect(repository.claim(claim)).resolves.toBe("replayed");
    await expect(
      repository.claim({
        ...claim,
        requestFingerprint: fingerprint("c"),
      }),
    ).resolves.toBe("conflict");

    const row = await env.DB.withSession("first-primary")
      .prepare(
        `
          SELECT *
          FROM judge_managed_ai_operation_claims
          WHERE claim_key_hash = ?
        `,
      )
      .bind(claim.claimKeyHash)
      .first<Record<string, unknown>>();
    expect(row).toEqual({
      claim_key_hash: claim.claimKeyHash,
      created_at_epoch: claim.createdAtEpoch,
      expires_at_epoch: claim.expiresAtEpoch,
      model: claim.model,
      operation: claim.operation,
      pricing_version: claim.pricingVersion,
      request_fingerprint: claim.requestFingerprint,
    });
    expect(Object.keys(row ?? {})).not.toContain("source");
    expect(Object.keys(row ?? {})).not.toContain("prompt");
    expect(Object.keys(row ?? {})).not.toContain("output");
    expect(Object.keys(row ?? {})).not.toContain("provider_id");
  });

  it("allows exactly one concurrent winner and reuses the key only after expiry", async () => {
    const repository = new D1ManagedAiOperationClaimRepository(env.DB);
    const first = operationClaim("b");

    const concurrent = await Promise.all([
      repository.claim(first),
      repository.claim(first),
    ]);
    expect(concurrent.sort()).toEqual(["claimed", "replayed"]);

    const conflicting = operationClaim("e");
    const conflictingResults = await Promise.all([
      repository.claim(conflicting),
      repository.claim({
        ...conflicting,
        requestFingerprint: fingerprint("f"),
      }),
    ]);
    expect(conflictingResults.sort()).toEqual(["claimed", "conflict"]);

    await expect(
      repository.claim({
        ...first,
        createdAtEpoch: first.expiresAtEpoch,
        expiresAtEpoch: first.expiresAtEpoch + 300,
      }),
    ).resolves.toBe("replayed");
    await expect(
      repository.claim({
        ...first,
        createdAtEpoch: first.expiresAtEpoch + 1,
        expiresAtEpoch: first.expiresAtEpoch + 301,
      }),
    ).resolves.toBe("claimed");
  });

  it("releases only the exact claim-key and request-fingerprint pair", async () => {
    const repository = new D1ManagedAiOperationClaimRepository(env.DB);
    const claim = operationClaim("c");
    await repository.claim(claim);

    await expect(
      repository.release({
        claimKeyHash: claim.claimKeyHash,
        createdAtEpoch: claim.createdAtEpoch,
        requestFingerprint: fingerprint("e"),
      }),
    ).resolves.toBe("unavailable");
    await expect(repository.claim(claim)).resolves.toBe("replayed");

    await expect(
      repository.release({
        claimKeyHash: claim.claimKeyHash,
        createdAtEpoch: claim.createdAtEpoch,
        requestFingerprint: claim.requestFingerprint,
      }),
    ).resolves.toBe("released");
    await expect(repository.claim(claim)).resolves.toBe("claimed");

    const replacement = {
      ...claim,
      createdAtEpoch: claim.expiresAtEpoch + 1,
      expiresAtEpoch: claim.expiresAtEpoch + 301,
    };
    await expect(repository.claim(replacement)).resolves.toBe("claimed");
    await expect(
      repository.release({
        claimKeyHash: claim.claimKeyHash,
        createdAtEpoch: claim.createdAtEpoch,
        requestFingerprint: claim.requestFingerprint,
      }),
    ).resolves.toBe("unavailable");
    await expect(repository.claim(replacement)).resolves.toBe("replayed");
  });

  it("rejects non-lowercase SHA-256 hashes and non-opaque metadata", async () => {
    const repository = new D1ManagedAiOperationClaimRepository(env.DB);
    const claim = operationClaim("d");

    for (const invalidClaim of [
      { ...claim, claimKeyHash: `sha256:${"A".repeat(64)}` },
      { ...claim, requestFingerprint: "not-a-sha256" },
      { ...claim, operation: "private disclosure" },
      { ...claim, model: "" },
      { ...claim, pricingVersion: "version\none" },
      { ...claim, createdAtEpoch: -1 },
      { ...claim, createdAtEpoch: Number.MAX_SAFE_INTEGER + 1 },
      { ...claim, expiresAtEpoch: claim.createdAtEpoch - 1 },
    ]) {
      await expect(repository.claim(invalidClaim)).rejects.toThrow(TypeError);
    }

    await expect(
      repository.release({
        claimKeyHash: `sha256:${"A".repeat(64)}`,
        createdAtEpoch: claim.createdAtEpoch,
        requestFingerprint: claim.requestFingerprint,
      }),
    ).rejects.toThrow(TypeError);
    await expect(
      repository.release({
        claimKeyHash: claim.claimKeyHash,
        createdAtEpoch: -1,
        requestFingerprint: claim.requestFingerprint,
      }),
    ).rejects.toThrow(TypeError);
  });

  it("creates a reserved lifecycle with one opaque reservation", async () => {
    const repository = new D1ManagedAiOperationClaimRepository(env.DB);
    const input = lifecycleClaim("f");

    const result = await repository.reserveClaim(input);

    expect(result).toEqual({
      claim: {
        claimKeyHash: input.claimKeyHash,
        createdAtEpoch: input.createdAtEpoch,
        expiresAtEpoch: input.expiresAtEpoch,
        leaseExpiresAtEpoch: input.leaseExpiresAtEpoch,
        model: input.model,
        operation: input.operation,
        pricingVersion: input.pricingVersion,
        providerStartedAtEpoch: undefined,
        requestFingerprint: input.requestFingerprint,
        reservationId: input.reservationId,
        reuseAfterEpoch: undefined,
        settledAtEpoch: undefined,
        status: "reserved",
      } satisfies ManagedAiOperationLifecycleClaim,
      kind: "reserved",
    });
    await expect(lifecycleRow(input.claimKeyHash)).resolves.toEqual({
      claim_key_hash: input.claimKeyHash,
      created_at_epoch: input.createdAtEpoch,
      expires_at_epoch: input.expiresAtEpoch,
      lease_expires_at_epoch: input.leaseExpiresAtEpoch,
      model: input.model,
      operation: input.operation,
      pricing_version: input.pricingVersion,
      provider_started_at_epoch: null,
      request_fingerprint: input.requestFingerprint,
      reservation_id: input.reservationId,
      reuse_after_epoch: null,
      settled_at_epoch: null,
      status: "reserved",
    });
  });

  it("replays an active exact lease", async () => {
    const repository = new D1ManagedAiOperationClaimRepository(env.DB);
    const input = lifecycleClaim("g");

    await expect(repository.reserveClaim(input)).resolves.toMatchObject({
      kind: "reserved",
    });
    await expect(
      repository.reserveClaim({
        ...input,
        createdAtEpoch: input.createdAtEpoch + 30,
        expiresAtEpoch: input.expiresAtEpoch + 30,
        leaseExpiresAtEpoch: input.leaseExpiresAtEpoch + 30,
      }),
    ).resolves.toMatchObject({
      claim: {
        createdAtEpoch: input.createdAtEpoch,
        leaseExpiresAtEpoch: input.leaseExpiresAtEpoch,
        reservationId: input.reservationId,
        status: "reserved",
      },
      kind: "replayed",
    });
  });

  it("conflicts a changed fingerprint", async () => {
    const repository = new D1ManagedAiOperationClaimRepository(env.DB);
    const input = lifecycleClaim("h");
    await repository.reserveClaim(input);

    await expect(
      repository.reserveClaim({
        ...input,
        requestFingerprint: fingerprint("i"),
      }),
    ).resolves.toEqual({ kind: "conflict" });
  });

  it("takes over an expired reserved generation conditionally", async () => {
    const repository = new D1ManagedAiOperationClaimRepository(env.DB);
    const input = lifecycleClaim("i");
    await repository.reserveClaim(input);
    const takeoverAtEpoch = input.leaseExpiresAtEpoch + 1;

    const mutation = {
      claimKeyHash: input.claimKeyHash,
      createdAtEpoch: input.createdAtEpoch,
      expectedStatus: "reserved" as const,
      leaseExpiresAtEpoch: takeoverAtEpoch + 120,
      nowEpoch: takeoverAtEpoch,
      requestFingerprint: input.requestFingerprint,
      reservationId: input.reservationId,
    };
    await expect(repository.takeOverReserved(mutation)).resolves.toBe(
      "taken_over",
    );
    await expect(repository.takeOverReserved(mutation)).resolves.toBe(
      "unavailable",
    );
    await expect(lifecycleRow(input.claimKeyHash)).resolves.toMatchObject({
      lease_expires_at_epoch: mutation.leaseExpiresAtEpoch,
      status: "reserved",
    });
  });

  it("marks provider start once for the winning generation", async () => {
    const repository = new D1ManagedAiOperationClaimRepository(env.DB);
    const input = lifecycleClaim("j");
    await repository.reserveClaim(input);
    const mutation = {
      claimKeyHash: input.claimKeyHash,
      createdAtEpoch: input.createdAtEpoch,
      expectedStatus: "reserved" as const,
      providerStartedAtEpoch: input.createdAtEpoch + 1,
      requestFingerprint: input.requestFingerprint,
      reservationId: input.reservationId,
    };

    await expect(repository.markProviderStarted(mutation)).resolves.toBe(
      "started",
    );
    await expect(repository.markProviderStarted(mutation)).resolves.toBe(
      "unavailable",
    );
    await expect(
      repository.markProviderStarted({
        ...mutation,
        createdAtEpoch: mutation.createdAtEpoch + 1,
      }),
    ).resolves.toBe("unavailable");
  });

  it("never replaces provider-started work on lease expiry", async () => {
    const repository = new D1ManagedAiOperationClaimRepository(env.DB);
    const input = lifecycleClaim("k");
    await repository.reserveClaim(input);
    await repository.markProviderStarted({
      claimKeyHash: input.claimKeyHash,
      createdAtEpoch: input.createdAtEpoch,
      expectedStatus: "reserved",
      providerStartedAtEpoch: input.createdAtEpoch + 1,
      requestFingerprint: input.requestFingerprint,
      reservationId: input.reservationId,
    });

    await expect(
      repository.takeOverReserved({
        claimKeyHash: input.claimKeyHash,
        createdAtEpoch: input.createdAtEpoch,
        expectedStatus: "reserved",
        leaseExpiresAtEpoch: input.leaseExpiresAtEpoch + 240,
        nowEpoch: input.leaseExpiresAtEpoch + 1,
        requestFingerprint: input.requestFingerprint,
        reservationId: input.reservationId,
      }),
    ).resolves.toBe("unavailable");
    await expect(
      repository.reserveClaim({
        ...input,
        createdAtEpoch: input.expiresAtEpoch + 1,
        expiresAtEpoch: input.expiresAtEpoch + 301,
        leaseExpiresAtEpoch: input.expiresAtEpoch + 121,
        reservationId: "reservation:k-new",
      }),
    ).resolves.toMatchObject({
      claim: {
        reservationId: input.reservationId,
        status: "provider_started",
      },
      kind: "replayed",
    });
  });

  it("marks finalized work settled for 25 hours", async () => {
    const repository = new D1ManagedAiOperationClaimRepository(env.DB);
    const input = lifecycleClaim("l");
    await repository.reserveClaim(input);
    await repository.markProviderStarted({
      claimKeyHash: input.claimKeyHash,
      createdAtEpoch: input.createdAtEpoch,
      expectedStatus: "reserved",
      providerStartedAtEpoch: input.createdAtEpoch + 1,
      requestFingerprint: input.requestFingerprint,
      reservationId: input.reservationId,
    });
    const settledAtEpoch = input.createdAtEpoch + 2;

    await expect(
      repository.markSettled({
        claimKeyHash: input.claimKeyHash,
        createdAtEpoch: input.createdAtEpoch,
        expectedStatus: "provider_started",
        requestFingerprint: input.requestFingerprint,
        reservationId: input.reservationId,
        reuseAfterEpoch: settledAtEpoch + 25 * 60 * 60,
        settledAtEpoch,
      }),
    ).resolves.toBe("settled");
    await expect(lifecycleRow(input.claimKeyHash)).resolves.toMatchObject({
      reuse_after_epoch: settledAtEpoch + 25 * 60 * 60,
      settled_at_epoch: settledAtEpoch,
      status: "settled",
    });
  });

  it("reuses settled work only after retention", async () => {
    const repository = new D1ManagedAiOperationClaimRepository(env.DB);
    const input = lifecycleClaim("m");
    await repository.reserveClaim(input);
    await repository.markProviderStarted({
      claimKeyHash: input.claimKeyHash,
      createdAtEpoch: input.createdAtEpoch,
      expectedStatus: "reserved",
      providerStartedAtEpoch: input.createdAtEpoch + 1,
      requestFingerprint: input.requestFingerprint,
      reservationId: input.reservationId,
    });
    const settledAtEpoch = input.createdAtEpoch + 2;
    const reuseAfterEpoch = settledAtEpoch + 25 * 60 * 60;
    await repository.markSettled({
      claimKeyHash: input.claimKeyHash,
      createdAtEpoch: input.createdAtEpoch,
      expectedStatus: "provider_started",
      requestFingerprint: input.requestFingerprint,
      reservationId: input.reservationId,
      reuseAfterEpoch,
      settledAtEpoch,
    });

    const replacement = {
      ...input,
      createdAtEpoch: reuseAfterEpoch,
      expiresAtEpoch: reuseAfterEpoch + 300,
      leaseExpiresAtEpoch: reuseAfterEpoch + 120,
      reservationId: "reservation:m-new",
    };
    await expect(repository.reserveClaim(replacement)).resolves.toMatchObject({
      claim: { reservationId: input.reservationId, status: "settled" },
      kind: "replayed",
    });
    await expect(
      repository.reserveClaim({
        ...replacement,
        createdAtEpoch: reuseAfterEpoch + 1,
        expiresAtEpoch: reuseAfterEpoch + 301,
        leaseExpiresAtEpoch: reuseAfterEpoch + 121,
      }),
    ).resolves.toMatchObject({
      claim: {
        createdAtEpoch: reuseAfterEpoch + 1,
        reservationId: replacement.reservationId,
        status: "reserved",
      },
      kind: "reserved",
    });
  });

  it("replays the persisted winner when exact replacements race after retention", async () => {
    const setupRepository = new D1ManagedAiOperationClaimRepository(env.DB);
    const input = lifecycleClaim("t");
    await setupRepository.reserveClaim(input);
    await setupRepository.markProviderStarted({
      claimKeyHash: input.claimKeyHash,
      createdAtEpoch: input.createdAtEpoch,
      expectedStatus: "reserved",
      providerStartedAtEpoch: input.createdAtEpoch + 1,
      requestFingerprint: input.requestFingerprint,
      reservationId: input.reservationId,
    });
    const settledAtEpoch = input.createdAtEpoch + 2;
    const reuseAfterEpoch = settledAtEpoch + 25 * 60 * 60;
    await setupRepository.markSettled({
      claimKeyHash: input.claimKeyHash,
      createdAtEpoch: input.createdAtEpoch,
      expectedStatus: "provider_started",
      requestFingerprint: input.requestFingerprint,
      reservationId: input.reservationId,
      reuseAfterEpoch,
      settledAtEpoch,
    });

    const synchronizedDatabase = synchronizedLifecycleReadDatabase();
    const firstRepository = new D1ManagedAiOperationClaimRepository(
      synchronizedDatabase,
    );
    const secondRepository = new D1ManagedAiOperationClaimRepository(
      synchronizedDatabase,
    );
    const firstReplacement = {
      ...input,
      createdAtEpoch: reuseAfterEpoch + 1,
      expiresAtEpoch: reuseAfterEpoch + 301,
      leaseExpiresAtEpoch: reuseAfterEpoch + 121,
      reservationId: "reservation:t-first",
    };
    const secondReplacement = {
      ...firstReplacement,
      createdAtEpoch: reuseAfterEpoch + 2,
      expiresAtEpoch: reuseAfterEpoch + 302,
      leaseExpiresAtEpoch: reuseAfterEpoch + 122,
      reservationId: "reservation:t-second",
    };

    const results = await Promise.all([
      firstRepository.reserveClaim(firstReplacement),
      secondRepository.reserveClaim(secondReplacement),
    ]);
    const reserved = results.find((result) => result.kind === "reserved");
    const replayed = results.find((result) => result.kind === "replayed");

    expect(reserved).toMatchObject({ kind: "reserved" });
    expect(replayed).toMatchObject({ kind: "replayed" });
    if (
      reserved?.kind !== "reserved" ||
      replayed?.kind !== "replayed"
    ) {
      throw new Error("Expected one reserved winner and one replayed loser");
    }
    expect(replayed.claim).toEqual(reserved.claim);
    await expect(lifecycleRow(input.claimKeyHash)).resolves.toMatchObject({
      created_at_epoch: reserved.claim.createdAtEpoch,
      reservation_id: reserved.claim.reservationId,
      status: "reserved",
    });
  });

  it("keeps legacy claims blocked", async () => {
    const repository = new D1ManagedAiOperationClaimRepository(env.DB);
    const input = lifecycleClaim("n");
    await insertLegacyClaim(input);

    await expect(
      repository.reserveClaim({
        ...input,
        createdAtEpoch: input.expiresAtEpoch + 1,
        expiresAtEpoch: input.expiresAtEpoch + 301,
        leaseExpiresAtEpoch: input.expiresAtEpoch + 121,
      }),
    ).resolves.toMatchObject({
      claim: { status: "legacy_blocked" },
      kind: "replayed",
    });
  });

  it("rolls back parent creation when lifecycle creation fails", async () => {
    const repository = new D1ManagedAiOperationClaimRepository(env.DB);
    const first = lifecycleClaim("o");
    await repository.reserveClaim(first);
    const second = {
      ...lifecycleClaim("p"),
      reservationId: first.reservationId,
    };

    await expect(repository.reserveClaim(second)).rejects.toThrow();
    await expect(lifecycleRow(second.claimKeyHash)).resolves.toBeNull();
    const parent = await env.DB.withSession("first-primary")
      .prepare(
        `
          SELECT claim_key_hash
          FROM judge_managed_ai_operation_claims
          WHERE claim_key_hash = ?
        `,
      )
      .bind(second.claimKeyHash)
      .first();
    expect(parent).toBeNull();
  });

  it("guards lifecycle parents from legacy expiry replacement and release", async () => {
    const repository = new D1ManagedAiOperationClaimRepository(env.DB);
    const input = lifecycleClaim("q");
    await insertLegacyClaim(input);

    await expect(
      repository.claim({
        ...input,
        createdAtEpoch: input.expiresAtEpoch + 1,
        expiresAtEpoch: input.expiresAtEpoch + 301,
      }),
    ).resolves.toBe("conflict");
    await expect(
      repository.release({
        claimKeyHash: input.claimKeyHash,
        createdAtEpoch: input.createdAtEpoch,
        requestFingerprint: input.requestFingerprint,
      }),
    ).resolves.toBe("unavailable");
    await expect(lifecycleRow(input.claimKeyHash)).resolves.toMatchObject({
      reservation_id: null,
      status: "legacy_blocked",
    });
  });

  it("abandons only the exact reserved generation and cascades its lifecycle", async () => {
    const repository = new D1ManagedAiOperationClaimRepository(env.DB);
    const input = lifecycleClaim("r");
    await repository.reserveClaim(input);
    const mutation = {
      claimKeyHash: input.claimKeyHash,
      createdAtEpoch: input.createdAtEpoch,
      expectedStatus: "reserved" as const,
      requestFingerprint: input.requestFingerprint,
      reservationId: input.reservationId,
    };

    await expect(
      repository.abandonReserved({
        ...mutation,
        createdAtEpoch: mutation.createdAtEpoch + 1,
      }),
    ).resolves.toBe("unavailable");
    await expect(repository.abandonReserved(mutation)).resolves.toBe(
      "abandoned",
    );
    await expect(lifecycleRow(input.claimKeyHash)).resolves.toBeNull();
  });

  it("strictly validates lifecycle mutation identity and status", async () => {
    const repository = new D1ManagedAiOperationClaimRepository(env.DB);
    const input = lifecycleClaim("s");

    await expect(
      repository.reserveClaim({
        ...input,
        reservationId: "contains spaces",
      }),
    ).rejects.toThrow(TypeError);
    await expect(
      repository.reserveClaim({
        ...input,
        expectedStatus: "provider_started" as unknown as "reserved",
      }),
    ).rejects.toThrow(TypeError);
    await expect(
      repository.takeOverReserved({
        claimKeyHash: input.claimKeyHash,
        createdAtEpoch: input.createdAtEpoch,
        expectedStatus: "reserved",
        leaseExpiresAtEpoch: input.createdAtEpoch,
        nowEpoch: input.createdAtEpoch + 1,
        requestFingerprint: input.requestFingerprint,
        reservationId: input.reservationId,
      }),
    ).rejects.toThrow(TypeError);
    await expect(
      repository.markSettled({
        claimKeyHash: input.claimKeyHash,
        createdAtEpoch: input.createdAtEpoch,
        expectedStatus: "provider_started",
        requestFingerprint: input.requestFingerprint,
        reservationId: input.reservationId,
        reuseAfterEpoch: input.createdAtEpoch + 25 * 60 * 60 - 1,
        settledAtEpoch: input.createdAtEpoch,
      }),
    ).rejects.toThrow(TypeError);
  });
});
