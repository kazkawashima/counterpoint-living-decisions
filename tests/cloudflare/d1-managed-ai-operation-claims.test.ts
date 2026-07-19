/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { env } from "cloudflare:workers";
import {
  D1ManagedAiOperationClaimRepository,
  type ManagedAiOperationClaim,
} from "@counterpoint/adapters-cloudflare";
import { describe, expect, it } from "vitest";

const NOW_EPOCH = 1_753_000_000;

function fingerprint(character: string): string {
  return `sha256:${character.repeat(64)}`;
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
});
