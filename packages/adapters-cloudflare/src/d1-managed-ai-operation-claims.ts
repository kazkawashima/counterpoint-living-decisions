/// <reference types="@cloudflare/workers-types" />

export interface ManagedAiOperationClaim {
  readonly claimKeyHash: string;
  readonly createdAtEpoch: number;
  readonly expiresAtEpoch: number;
  readonly model: string;
  readonly operation: string;
  readonly pricingVersion: string;
  readonly requestFingerprint: string;
}

export interface ManagedAiOperationClaimRelease {
  readonly claimKeyHash: string;
  readonly createdAtEpoch: number;
  readonly requestFingerprint: string;
}

export type ManagedAiOperationClaimResult = "claimed" | "conflict" | "replayed";

interface ManagedAiOperationClaimRow {
  readonly expires_at_epoch: number;
  readonly model: string;
  readonly operation: string;
  readonly pricing_version: string;
  readonly request_fingerprint: string;
}

const SHA256_FINGERPRINT_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const OPAQUE_METADATA_PATTERN = /^[0-9A-Za-z._:/-]{1,256}$/u;

const CLAIM_SQL = `
  INSERT INTO judge_managed_ai_operation_claims (
    claim_key_hash,
    request_fingerprint,
    operation,
    model,
    pricing_version,
    created_at_epoch,
    expires_at_epoch
  ) VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(claim_key_hash) DO UPDATE SET
    request_fingerprint = excluded.request_fingerprint,
    operation = excluded.operation,
    model = excluded.model,
    pricing_version = excluded.pricing_version,
    created_at_epoch = excluded.created_at_epoch,
    expires_at_epoch = excluded.expires_at_epoch
  WHERE judge_managed_ai_operation_claims.expires_at_epoch
    < excluded.created_at_epoch
`;

function requireSha256Fingerprint(value: string, label: string): void {
  if (!SHA256_FINGERPRINT_PATTERN.test(value)) {
    throw new TypeError(`${label} must be a lowercase sha256 fingerprint`);
  }
}

function requireOpaqueMetadata(value: string, label: string): void {
  if (!OPAQUE_METADATA_PATTERN.test(value)) {
    throw new TypeError(`${label} must be opaque metadata`);
  }
}

function requireEpoch(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative epoch second`);
  }
}

function validateRelease(release: ManagedAiOperationClaimRelease): void {
  requireSha256Fingerprint(release.claimKeyHash, "claimKeyHash");
  requireSha256Fingerprint(release.requestFingerprint, "requestFingerprint");
  requireEpoch(release.createdAtEpoch, "createdAtEpoch");
}

export class D1ManagedAiOperationClaimRepository {
  readonly #database: D1Database;

  constructor(database: D1Database) {
    this.#database = database;
  }

  async claim(
    claim: ManagedAiOperationClaim,
  ): Promise<ManagedAiOperationClaimResult> {
    validateRelease(claim);
    requireOpaqueMetadata(claim.operation, "operation");
    requireOpaqueMetadata(claim.model, "model");
    requireOpaqueMetadata(claim.pricingVersion, "pricingVersion");
    requireEpoch(claim.createdAtEpoch, "createdAtEpoch");
    requireEpoch(claim.expiresAtEpoch, "expiresAtEpoch");
    if (claim.expiresAtEpoch < claim.createdAtEpoch) {
      throw new TypeError("expiresAtEpoch must not precede createdAtEpoch");
    }

    const session = this.#database.withSession("first-primary");
    const result = await session
      .prepare(CLAIM_SQL)
      .bind(
        claim.claimKeyHash,
        claim.requestFingerprint,
        claim.operation,
        claim.model,
        claim.pricingVersion,
        claim.createdAtEpoch,
        claim.expiresAtEpoch,
      )
      .run();
    if (result.meta.changes === 1) {
      return "claimed";
    }
    if (result.meta.changes !== 0) {
      throw new Error(
        "Managed-AI operation claim changed an unexpected row count",
      );
    }

    const existing = await session
      .prepare(
        `
          SELECT
            request_fingerprint,
            operation,
            model,
            pricing_version,
            expires_at_epoch
          FROM judge_managed_ai_operation_claims
          WHERE claim_key_hash = ?
        `,
      )
      .bind(claim.claimKeyHash)
      .first<ManagedAiOperationClaimRow>();
    return existing !== null &&
      existing.request_fingerprint === claim.requestFingerprint &&
      existing.operation === claim.operation &&
      existing.model === claim.model &&
      existing.pricing_version === claim.pricingVersion &&
      existing.expires_at_epoch >= claim.createdAtEpoch
      ? "replayed"
      : "conflict";
  }

  async release(
    release: ManagedAiOperationClaimRelease,
  ): Promise<"released" | "unavailable"> {
    validateRelease(release);
    const result = await this.#database
      .withSession("first-primary")
      .prepare(
        `
          DELETE FROM judge_managed_ai_operation_claims
          WHERE claim_key_hash = ?
            AND request_fingerprint = ?
            AND created_at_epoch = ?
        `,
      )
      .bind(
        release.claimKeyHash,
        release.requestFingerprint,
        release.createdAtEpoch,
      )
      .run();
    if (result.meta.changes === 1) {
      return "released";
    }
    if (result.meta.changes === 0) {
      return "unavailable";
    }
    throw new Error(
      "Managed-AI operation claim release changed an unexpected row count",
    );
  }
}
