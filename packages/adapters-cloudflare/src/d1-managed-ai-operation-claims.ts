/// <reference types="@cloudflare/workers-types" />

import {
  buildAbandonExpiredReservedStatement,
  buildAbandonReservedStatement,
  buildFinalizeFullReservationStatement,
  buildListStaleStatement,
  buildMarkSettledStatement,
  buildReleaseReservedStatement,
} from "./judge-structured-ai-reconciliation.js";

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

export type ManagedAiOperationLifecycleStatus =
  "legacy_blocked" | "reserved" | "provider_started" | "settled";

interface ManagedAiOperationLifecycleClaimBase extends ManagedAiOperationClaim {
  readonly leaseExpiresAtEpoch: number | undefined;
  readonly providerStartedAtEpoch: number | undefined;
  readonly reservationId: string | undefined;
  readonly reuseAfterEpoch: number | undefined;
  readonly settledAtEpoch: number | undefined;
  readonly status: ManagedAiOperationLifecycleStatus;
}

export interface ManagedAiOperationLegacyClaim extends ManagedAiOperationLifecycleClaimBase {
  readonly leaseExpiresAtEpoch: undefined;
  readonly providerStartedAtEpoch: undefined;
  readonly reservationId: undefined;
  readonly reuseAfterEpoch: undefined;
  readonly settledAtEpoch: undefined;
  readonly status: "legacy_blocked";
}

export interface ManagedAiOperationReservedClaim extends ManagedAiOperationLifecycleClaimBase {
  readonly leaseExpiresAtEpoch: number;
  readonly providerStartedAtEpoch: undefined;
  readonly reservationId: string;
  readonly reuseAfterEpoch: undefined;
  readonly settledAtEpoch: undefined;
  readonly status: "reserved";
}

export interface ManagedAiOperationProviderStartedClaim extends ManagedAiOperationLifecycleClaimBase {
  readonly leaseExpiresAtEpoch: number;
  readonly providerStartedAtEpoch: number;
  readonly reservationId: string;
  readonly reuseAfterEpoch: undefined;
  readonly settledAtEpoch: undefined;
  readonly status: "provider_started";
}

export interface ManagedAiOperationSettledClaim extends ManagedAiOperationLifecycleClaimBase {
  readonly reservationId: string;
  readonly reuseAfterEpoch: number;
  readonly settledAtEpoch: number;
  readonly status: "settled";
}

export type ManagedAiOperationLifecycleClaim =
  | ManagedAiOperationLegacyClaim
  | ManagedAiOperationProviderStartedClaim
  | ManagedAiOperationReservedClaim
  | ManagedAiOperationSettledClaim;

export type ManagedAiOperationStaleClaim = (
  ManagedAiOperationProviderStartedClaim | ManagedAiOperationReservedClaim
) & {
  readonly staleAtEpoch: number;
};

export interface ManagedAiOperationStaleSelection {
  readonly limit: number;
  readonly nowEpoch: number;
}

export interface ManagedAiOperationReserveClaim extends ManagedAiOperationClaim {
  readonly expectedStatus: "reserved";
  readonly leaseExpiresAtEpoch: number;
  readonly reservationId: string;
}

interface ManagedAiOperationLifecycleMutation {
  readonly claimKeyHash: string;
  readonly createdAtEpoch: number;
  readonly requestFingerprint: string;
  readonly reservationId: string;
}

export interface ManagedAiOperationReservedTakeover extends ManagedAiOperationLifecycleMutation {
  readonly expectedStatus: "reserved";
  readonly leaseExpiresAtEpoch: number;
  readonly nowEpoch: number;
}

export interface ManagedAiOperationProviderStart extends ManagedAiOperationLifecycleMutation {
  readonly expectedStatus: "reserved";
  readonly providerStartedAtEpoch: number;
}

export interface ManagedAiOperationSettlement extends ManagedAiOperationLifecycleMutation {
  readonly expectedStatus: "provider_started" | "reserved";
  readonly reuseAfterEpoch: number;
  readonly settledAtEpoch: number;
}

export interface ManagedAiOperationReservedAbandonment extends ManagedAiOperationLifecycleMutation {
  readonly expectedStatus: "reserved";
}

export type ManagedAiOperationReserveClaimResult =
  | {
      readonly claim: ManagedAiOperationLifecycleClaim;
      readonly kind: "reserved" | "replayed";
    }
  | { readonly kind: "conflict" };

interface ManagedAiOperationClaimRow {
  readonly expires_at_epoch: number;
  readonly model: string;
  readonly operation: string;
  readonly pricing_version: string;
  readonly request_fingerprint: string;
}

interface ManagedAiOperationLifecycleClaimRow extends ManagedAiOperationClaimRow {
  readonly claim_key_hash: string;
  readonly created_at_epoch: number;
  readonly lease_expires_at_epoch: number | null;
  readonly provider_started_at_epoch: number | null;
  readonly reservation_id: string | null;
  readonly reuse_after_epoch: number | null;
  readonly settled_at_epoch: number | null;
  readonly status: ManagedAiOperationLifecycleStatus;
}

interface ManagedAiOperationStaleClaimRow extends ManagedAiOperationLifecycleClaimRow {
  readonly stale_at_epoch: number;
}

const SHA256_FINGERPRINT_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const OPAQUE_METADATA_PATTERN = /^[0-9A-Za-z._:/-]{1,256}$/u;
const SETTLED_RETENTION_SECONDS = 25 * 60 * 60;

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
    AND NOT EXISTS (
      SELECT 1
      FROM judge_managed_ai_operation_lifecycle
      WHERE claim_key_hash =
        judge_managed_ai_operation_claims.claim_key_hash
    )
`;

const SELECT_LIFECYCLE_SQL = `
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

function requireExpectedStatus(
  actual: ManagedAiOperationLifecycleStatus,
  expected: ManagedAiOperationLifecycleStatus,
): void {
  if (actual !== expected) {
    throw new TypeError(`expectedStatus must be ${expected}`);
  }
}

function validateClaim(claim: ManagedAiOperationClaim): void {
  validateRelease(claim);
  requireOpaqueMetadata(claim.operation, "operation");
  requireOpaqueMetadata(claim.model, "model");
  requireOpaqueMetadata(claim.pricingVersion, "pricingVersion");
  requireEpoch(claim.expiresAtEpoch, "expiresAtEpoch");
  if (claim.expiresAtEpoch < claim.createdAtEpoch) {
    throw new TypeError("expiresAtEpoch must not precede createdAtEpoch");
  }
}

function validateLifecycleIdentity(
  mutation: ManagedAiOperationLifecycleMutation,
): void {
  validateRelease(mutation);
  requireOpaqueMetadata(mutation.reservationId, "reservationId");
}

function lifecycleClaimFromRow(
  row: ManagedAiOperationLifecycleClaimRow,
): ManagedAiOperationLifecycleClaim {
  const common = {
    claimKeyHash: row.claim_key_hash,
    createdAtEpoch: row.created_at_epoch,
    expiresAtEpoch: row.expires_at_epoch,
    model: row.model,
    operation: row.operation,
    pricingVersion: row.pricing_version,
    requestFingerprint: row.request_fingerprint,
  };
  switch (row.status) {
    case "legacy_blocked":
      return {
        ...common,
        leaseExpiresAtEpoch: undefined,
        providerStartedAtEpoch: undefined,
        reservationId: undefined,
        reuseAfterEpoch: undefined,
        settledAtEpoch: undefined,
        status: row.status,
      };
    case "reserved":
      if (row.reservation_id === null || row.lease_expires_at_epoch === null) {
        throw new Error("Invalid reserved managed-AI lifecycle row");
      }
      return {
        ...common,
        leaseExpiresAtEpoch: row.lease_expires_at_epoch,
        providerStartedAtEpoch: undefined,
        reservationId: row.reservation_id,
        reuseAfterEpoch: undefined,
        settledAtEpoch: undefined,
        status: row.status,
      };
    case "provider_started":
      if (
        row.reservation_id === null ||
        row.lease_expires_at_epoch === null ||
        row.provider_started_at_epoch === null
      ) {
        throw new Error("Invalid provider-started managed-AI lifecycle row");
      }
      return {
        ...common,
        leaseExpiresAtEpoch: row.lease_expires_at_epoch,
        providerStartedAtEpoch: row.provider_started_at_epoch,
        reservationId: row.reservation_id,
        reuseAfterEpoch: undefined,
        settledAtEpoch: undefined,
        status: row.status,
      };
    case "settled":
      if (
        row.reservation_id === null ||
        row.settled_at_epoch === null ||
        row.reuse_after_epoch === null
      ) {
        throw new Error("Invalid settled managed-AI lifecycle row");
      }
      return {
        ...common,
        leaseExpiresAtEpoch: row.lease_expires_at_epoch ?? undefined,
        providerStartedAtEpoch: row.provider_started_at_epoch ?? undefined,
        reservationId: row.reservation_id,
        reuseAfterEpoch: row.reuse_after_epoch,
        settledAtEpoch: row.settled_at_epoch,
        status: row.status,
      };
  }
}

export class D1ManagedAiOperationClaimRepository {
  readonly #database: D1Database;

  constructor(database: D1Database) {
    this.#database = database;
  }

  async claim(
    claim: ManagedAiOperationClaim,
  ): Promise<ManagedAiOperationClaimResult> {
    validateClaim(claim);

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
            AND NOT EXISTS (
              SELECT 1
              FROM judge_managed_ai_operation_lifecycle
              WHERE claim_key_hash =
                judge_managed_ai_operation_claims.claim_key_hash
            )
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

  async reserveClaim(
    input: ManagedAiOperationReserveClaim,
  ): Promise<ManagedAiOperationReserveClaimResult> {
    validateClaim(input);
    requireExpectedStatus(input.expectedStatus, "reserved");
    requireOpaqueMetadata(input.reservationId, "reservationId");
    requireEpoch(input.leaseExpiresAtEpoch, "leaseExpiresAtEpoch");
    if (input.leaseExpiresAtEpoch < input.createdAtEpoch) {
      throw new TypeError(
        "leaseExpiresAtEpoch must not precede createdAtEpoch",
      );
    }

    const session = this.#database.withSession("first-primary");
    const existing = await this.#findLifecycle(session, input.claimKeyHash);
    if (existing !== undefined) {
      if (!this.#sameRequest(existing, input)) {
        return { kind: "conflict" };
      }
      if (
        existing.status === "settled" &&
        input.createdAtEpoch > existing.reuseAfterEpoch
      ) {
        const results = await session.batch([
          session
            .prepare(
              `
                UPDATE judge_managed_ai_operation_claims
                SET
                  request_fingerprint = ?,
                  operation = ?,
                  model = ?,
                  pricing_version = ?,
                  created_at_epoch = ?,
                  expires_at_epoch = ?
                WHERE claim_key_hash = ?
                  AND request_fingerprint = ?
                  AND created_at_epoch = ?
                  AND EXISTS (
                    SELECT 1
                    FROM judge_managed_ai_operation_lifecycle
                    WHERE claim_key_hash = ?
                      AND status = 'settled'
                      AND reuse_after_epoch < ?
                  )
              `,
            )
            .bind(
              input.requestFingerprint,
              input.operation,
              input.model,
              input.pricingVersion,
              input.createdAtEpoch,
              input.expiresAtEpoch,
              input.claimKeyHash,
              existing.requestFingerprint,
              existing.createdAtEpoch,
              input.claimKeyHash,
              input.createdAtEpoch,
            ),
          session
            .prepare(
              `
                UPDATE judge_managed_ai_operation_lifecycle
                SET
                  status = 'reserved',
                  reservation_id = ?,
                  lease_expires_at_epoch = ?,
                  provider_started_at_epoch = NULL,
                  settled_at_epoch = NULL,
                  reuse_after_epoch = NULL
                WHERE claim_key_hash = ?
                  AND status = 'settled'
                  AND reservation_id = ?
                  AND reuse_after_epoch < ?
              `,
            )
            .bind(
              input.reservationId,
              input.leaseExpiresAtEpoch,
              input.claimKeyHash,
              existing.reservationId,
              input.createdAtEpoch,
            ),
        ]);
        if (results.every((result) => result.meta.changes === 1)) {
          const claim = await this.#findLifecycle(session, input.claimKeyHash);
          if (claim === undefined) {
            throw new Error("Reserved managed-AI lifecycle disappeared");
          }
          return { claim, kind: "reserved" };
        }
        if (results.every((result) => result.meta.changes === 0)) {
          const concurrent = await this.#findLifecycle(
            session,
            input.claimKeyHash,
          );
          if (concurrent === undefined) {
            throw new Error(
              "Concurrent managed-AI settled claim replacement disappeared",
            );
          }
          return this.#sameRequest(concurrent, input)
            ? { claim: concurrent, kind: "replayed" }
            : { kind: "conflict" };
        }
        throw new Error(
          "Managed-AI settled claim replacement changed an unexpected row count",
        );
      }
      return { claim: existing, kind: "replayed" };
    }

    try {
      const results = await session.batch([
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
                status,
                reservation_id,
                lease_expires_at_epoch
              ) VALUES (?, 'reserved', ?, ?)
            `,
          )
          .bind(
            input.claimKeyHash,
            input.reservationId,
            input.leaseExpiresAtEpoch,
          ),
      ]);
      if (!results.every((result) => result.meta.changes === 1)) {
        throw new Error(
          "Managed-AI lifecycle creation changed an unexpected row count",
        );
      }
      const claim = await this.#findLifecycle(session, input.claimKeyHash);
      if (claim === undefined) {
        throw new Error("Reserved managed-AI lifecycle was not persisted");
      }
      return { claim, kind: "reserved" };
    } catch (error) {
      const concurrent = await this.#findLifecycle(session, input.claimKeyHash);
      if (concurrent === undefined) {
        throw error;
      }
      return this.#sameRequest(concurrent, input)
        ? { claim: concurrent, kind: "replayed" }
        : { kind: "conflict" };
    }
  }

  async takeOverReserved(
    input: ManagedAiOperationReservedTakeover,
  ): Promise<"taken_over" | "unavailable"> {
    validateLifecycleIdentity(input);
    requireExpectedStatus(input.expectedStatus, "reserved");
    requireEpoch(input.nowEpoch, "nowEpoch");
    requireEpoch(input.leaseExpiresAtEpoch, "leaseExpiresAtEpoch");
    if (input.leaseExpiresAtEpoch <= input.nowEpoch) {
      throw new TypeError("leaseExpiresAtEpoch must follow nowEpoch");
    }
    return this.#conditionalMutation(
      `
        UPDATE judge_managed_ai_operation_lifecycle
        SET lease_expires_at_epoch = ?
        WHERE claim_key_hash = ?
          AND status = ?
          AND reservation_id = ?
          AND lease_expires_at_epoch < ?
          AND EXISTS (
            SELECT 1
            FROM judge_managed_ai_operation_claims
            WHERE claim_key_hash = ?
              AND request_fingerprint = ?
              AND created_at_epoch = ?
          )
      `,
      [
        input.leaseExpiresAtEpoch,
        input.claimKeyHash,
        input.expectedStatus,
        input.reservationId,
        input.nowEpoch,
        input.claimKeyHash,
        input.requestFingerprint,
        input.createdAtEpoch,
      ],
      "taken_over",
      "Managed-AI reserved takeover",
    );
  }

  async markProviderStarted(
    input: ManagedAiOperationProviderStart,
  ): Promise<"started" | "unavailable"> {
    validateLifecycleIdentity(input);
    requireExpectedStatus(input.expectedStatus, "reserved");
    requireEpoch(input.providerStartedAtEpoch, "providerStartedAtEpoch");
    if (input.providerStartedAtEpoch < input.createdAtEpoch) {
      throw new TypeError(
        "providerStartedAtEpoch must not precede createdAtEpoch",
      );
    }
    return this.#conditionalMutation(
      `
        UPDATE judge_managed_ai_operation_lifecycle
        SET
          status = 'provider_started',
          provider_started_at_epoch = ?
        WHERE claim_key_hash = ?
          AND status = ?
          AND reservation_id = ?
          AND lease_expires_at_epoch >= ?
          AND EXISTS (
            SELECT 1
            FROM judge_managed_ai_operation_claims
            WHERE claim_key_hash = ?
              AND request_fingerprint = ?
              AND created_at_epoch = ?
          )
      `,
      [
        input.providerStartedAtEpoch,
        input.claimKeyHash,
        input.expectedStatus,
        input.reservationId,
        input.providerStartedAtEpoch,
        input.claimKeyHash,
        input.requestFingerprint,
        input.createdAtEpoch,
      ],
      "started",
      "Managed-AI provider start",
    );
  }

  async markSettled(
    input: ManagedAiOperationSettlement,
  ): Promise<"settled" | "unavailable"> {
    validateLifecycleIdentity(input);
    if (
      input.expectedStatus !== "reserved" &&
      input.expectedStatus !== "provider_started"
    ) {
      throw new TypeError(
        "expectedStatus must be reserved or provider_started",
      );
    }
    requireEpoch(input.settledAtEpoch, "settledAtEpoch");
    requireEpoch(input.reuseAfterEpoch, "reuseAfterEpoch");
    if (
      input.reuseAfterEpoch - input.settledAtEpoch !==
      SETTLED_RETENTION_SECONDS
    ) {
      throw new TypeError(
        "reuseAfterEpoch must be exactly 25 hours after settledAtEpoch",
      );
    }
    const statement = buildMarkSettledStatement(input);
    return this.#conditionalMutation(
      statement.sql,
      statement.bindings,
      "settled",
      "Managed-AI settlement",
    );
  }

  async abandonReserved(
    input: ManagedAiOperationReservedAbandonment,
  ): Promise<"abandoned" | "unavailable"> {
    validateLifecycleIdentity(input);
    requireExpectedStatus(input.expectedStatus, "reserved");
    const statement = buildAbandonReservedStatement(input);
    return this.#conditionalMutation(
      statement.sql,
      statement.bindings,
      "abandoned",
      "Managed-AI reserved abandonment",
      2,
    );
  }

  async listStale(
    input: ManagedAiOperationStaleSelection,
  ): Promise<readonly ManagedAiOperationStaleClaim[]> {
    const statement = buildListStaleStatement(input);
    const result = await this.#database
      .withSession("first-primary")
      .prepare(statement.sql)
      .bind(...statement.bindings)
      .all<ManagedAiOperationStaleClaimRow>();
    return result.results.map((row) => {
      const claim = lifecycleClaimFromRow(row);
      if (claim.status !== "reserved" && claim.status !== "provider_started") {
        throw new Error("Stale query returned an ineligible lifecycle");
      }
      return {
        ...claim,
        staleAtEpoch: row.stale_at_epoch,
      };
    });
  }

  async releaseExpiredReserved(
    input: ManagedAiOperationReservedAbandonment,
    releasedAtEpoch: number,
  ): Promise<"released" | "unavailable"> {
    validateLifecycleIdentity(input);
    requireExpectedStatus(input.expectedStatus, "reserved");
    requireEpoch(releasedAtEpoch, "releasedAtEpoch");
    const abandon = buildAbandonExpiredReservedStatement(
      input,
      releasedAtEpoch,
    );
    const release = buildReleaseReservedStatement(input, releasedAtEpoch);
    const session = this.#database.withSession("first-primary");
    const results = await session.batch([
      session.prepare(release.sql).bind(...release.bindings),
      session.prepare(abandon.sql).bind(...abandon.bindings),
    ]);
    if (results[0]?.meta.changes === 1 && results[1]?.meta.changes === 2) {
      return "released";
    }
    if (results.every((result) => result.meta.changes === 0)) {
      return "unavailable";
    }
    throw new Error(
      `Managed-AI reserved reconciliation changed an unexpected row count (${String(results[0]?.meta.changes)}/${String(results[1]?.meta.changes)})`,
    );
  }

  async abandonExpiredReserved(
    input: ManagedAiOperationReservedAbandonment,
    nowEpoch: number,
  ): Promise<"abandoned" | "unavailable"> {
    validateLifecycleIdentity(input);
    requireExpectedStatus(input.expectedStatus, "reserved");
    requireEpoch(nowEpoch, "nowEpoch");
    const statement = buildAbandonExpiredReservedStatement(input, nowEpoch);
    return this.#conditionalMutation(
      statement.sql,
      statement.bindings,
      "abandoned",
      "Managed-AI expired reserved abandonment",
      2,
    );
  }

  async finalizeFullReservation(
    reservationId: string,
    finalizedAtEpoch: number,
  ): Promise<"finalized" | "unavailable"> {
    requireOpaqueMetadata(reservationId, "reservationId");
    requireEpoch(finalizedAtEpoch, "finalizedAtEpoch");
    const statement = buildFinalizeFullReservationStatement(
      reservationId,
      finalizedAtEpoch,
    );
    return this.#conditionalMutation(
      statement.sql,
      statement.bindings,
      "finalized",
      "Managed-AI full reservation finalization",
    );
  }

  async #conditionalMutation<TSuccess extends string>(
    sql: string,
    bindings: readonly unknown[],
    success: TSuccess,
    label: string,
    expectedChanges = 1,
  ): Promise<TSuccess | "unavailable"> {
    const result = await this.#database
      .withSession("first-primary")
      .prepare(sql)
      .bind(...bindings)
      .run();
    if (result.meta.changes === expectedChanges) {
      return success;
    }
    if (result.meta.changes === 0) {
      return "unavailable";
    }
    throw new Error(`${label} changed an unexpected row count`);
  }

  async #findLifecycle(
    session: D1DatabaseSession,
    claimKeyHash: string,
  ): Promise<ManagedAiOperationLifecycleClaim | undefined> {
    const row = await session
      .prepare(SELECT_LIFECYCLE_SQL)
      .bind(claimKeyHash)
      .first<ManagedAiOperationLifecycleClaimRow>();
    return row === null ? undefined : lifecycleClaimFromRow(row);
  }

  #sameRequest(
    existing: ManagedAiOperationLifecycleClaim,
    input: ManagedAiOperationClaim,
  ): boolean {
    return (
      existing.requestFingerprint === input.requestFingerprint &&
      existing.operation === input.operation &&
      existing.model === input.model &&
      existing.pricingVersion === input.pricingVersion
    );
  }
}
