export interface JudgeStructuredAiSqlStatement {
  readonly bindings: readonly (number | string)[];
  readonly sql: string;
}

export interface JudgeStructuredAiStaleSelection {
  readonly limit: number;
  readonly nowEpoch: number;
}

export interface JudgeStructuredAiLifecycleIdentity {
  readonly claimKeyHash: string;
  readonly createdAtEpoch: number;
  readonly requestFingerprint: string;
  readonly reservationId: string;
}

export interface JudgeStructuredAiSettlementIdentity extends JudgeStructuredAiLifecycleIdentity {
  readonly expectedStatus: "provider_started" | "reserved";
  readonly reuseAfterEpoch: number;
  readonly settledAtEpoch: number;
}

const MAX_RECONCILIATION_ROWS = 20;
const SHA256_FINGERPRINT_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const OPAQUE_METADATA_PATTERN = /^[0-9A-Za-z._:/-]{1,256}$/u;
const SETTLED_RETENTION_SECONDS = 25 * 60 * 60;

function requireEpoch(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative epoch second`);
  }
}

function requireFingerprint(value: string, label: string): void {
  if (!SHA256_FINGERPRINT_PATTERN.test(value)) {
    throw new TypeError(`${label} must be a lowercase sha256 fingerprint`);
  }
}

function requireReservationId(value: string): void {
  if (!OPAQUE_METADATA_PATTERN.test(value)) {
    throw new TypeError("reservationId must be opaque metadata");
  }
}

function validateIdentity(input: JudgeStructuredAiLifecycleIdentity): void {
  requireFingerprint(input.claimKeyHash, "claimKeyHash");
  requireFingerprint(input.requestFingerprint, "requestFingerprint");
  requireReservationId(input.reservationId);
  requireEpoch(input.createdAtEpoch, "createdAtEpoch");
}

export function buildListStaleStatement(
  input: JudgeStructuredAiStaleSelection,
): JudgeStructuredAiSqlStatement {
  requireEpoch(input.nowEpoch, "nowEpoch");
  if (
    !Number.isSafeInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > MAX_RECONCILIATION_ROWS
  ) {
    throw new TypeError("limit must be an integer from 1 through 20");
  }
  return {
    bindings: [input.nowEpoch, input.limit],
    sql: `
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
        lifecycle.reuse_after_epoch,
        lifecycle.lease_expires_at_epoch AS stale_at_epoch,
        usage.status AS usage_status,
        usage.request_fingerprint AS usage_request_fingerprint,
        usage.operation AS usage_operation,
        usage.model AS usage_model,
        usage.pricing_version AS usage_pricing_version
      FROM judge_managed_ai_operation_claims AS claims
      JOIN judge_managed_ai_operation_lifecycle AS lifecycle
        USING (claim_key_hash)
      LEFT JOIN judge_usage_reservations AS usage
        ON usage.reservation_id = lifecycle.reservation_id
      WHERE lifecycle.status IN ('reserved', 'provider_started')
        AND lifecycle.lease_expires_at_epoch < ?
      ORDER BY stale_at_epoch ASC, claims.claim_key_hash ASC
      LIMIT ?
    `,
  };
}

export function buildAbandonReservedStatement(
  input: JudgeStructuredAiLifecycleIdentity,
): JudgeStructuredAiSqlStatement {
  validateIdentity(input);
  return {
    bindings: [
      input.claimKeyHash,
      input.requestFingerprint,
      input.createdAtEpoch,
      input.claimKeyHash,
      input.reservationId,
    ],
    sql: `
      DELETE FROM judge_managed_ai_operation_claims
      WHERE claim_key_hash = ?
        AND request_fingerprint = ?
        AND created_at_epoch = ?
        AND EXISTS (
          SELECT 1
          FROM judge_managed_ai_operation_lifecycle
          WHERE claim_key_hash = ?
            AND status = 'reserved'
            AND reservation_id = ?
            AND provider_started_at_epoch IS NULL
        )
    `,
  };
}

export function buildAbandonExpiredReservedStatement(
  input: JudgeStructuredAiLifecycleIdentity,
  nowEpoch: number,
): JudgeStructuredAiSqlStatement {
  validateIdentity(input);
  requireEpoch(nowEpoch, "nowEpoch");
  return {
    bindings: [
      input.claimKeyHash,
      input.requestFingerprint,
      input.createdAtEpoch,
      input.claimKeyHash,
      input.reservationId,
      nowEpoch,
    ],
    sql: `
      DELETE FROM judge_managed_ai_operation_claims
      WHERE claim_key_hash = ?
        AND request_fingerprint = ?
        AND created_at_epoch = ?
        AND EXISTS (
          SELECT 1
          FROM judge_managed_ai_operation_lifecycle
          WHERE claim_key_hash = ?
            AND status = 'reserved'
            AND reservation_id = ?
            AND provider_started_at_epoch IS NULL
            AND lease_expires_at_epoch < ?
        )
    `,
  };
}

export function buildReleaseReservedStatement(
  input: JudgeStructuredAiLifecycleIdentity,
  releasedAtEpoch: number,
): JudgeStructuredAiSqlStatement {
  validateIdentity(input);
  requireEpoch(releasedAtEpoch, "releasedAtEpoch");
  return {
    bindings: [
      releasedAtEpoch,
      input.reservationId,
      input.claimKeyHash,
      input.requestFingerprint,
      input.createdAtEpoch,
      input.reservationId,
      releasedAtEpoch,
    ],
    sql: `
      UPDATE judge_usage_reservations
      SET status = 'released', released_at_epoch = ?
      WHERE reservation_id = ?
        AND status = 'reserved'
        AND EXISTS (
          SELECT 1
          FROM judge_managed_ai_operation_claims AS claims
          JOIN judge_managed_ai_operation_lifecycle AS lifecycle
            USING (claim_key_hash)
          WHERE claims.claim_key_hash = ?
            AND claims.request_fingerprint = ?
            AND claims.created_at_epoch = ?
            AND lifecycle.status = 'reserved'
            AND lifecycle.reservation_id = ?
            AND lifecycle.provider_started_at_epoch IS NULL
            AND lifecycle.lease_expires_at_epoch < ?
        )
    `,
  };
}

export function buildFinalizeFullReservationStatement(
  reservationId: string,
  finalizedAtEpoch: number,
): JudgeStructuredAiSqlStatement {
  requireReservationId(reservationId);
  requireEpoch(finalizedAtEpoch, "finalizedAtEpoch");
  return {
    bindings: [finalizedAtEpoch, reservationId],
    sql: `
      UPDATE judge_usage_reservations
      SET
        status = 'finalized',
        actual_cost_micro_usd = reserved_cost_micro_usd,
        actual_input_tokens = reserved_input_tokens,
        actual_output_tokens = reserved_output_tokens,
        actual_generation_count = reserved_generation_count,
        actual_realtime_seconds = reserved_realtime_seconds,
        finalized_at_epoch = ?
      WHERE reservation_id = ?
        AND status = 'reserved'
    `,
  };
}

export function buildMarkSettledStatement(
  input: JudgeStructuredAiSettlementIdentity,
): JudgeStructuredAiSqlStatement {
  validateIdentity(input);
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
  return {
    bindings: [
      input.settledAtEpoch,
      input.reuseAfterEpoch,
      input.claimKeyHash,
      input.expectedStatus,
      input.reservationId,
      input.settledAtEpoch,
      input.claimKeyHash,
      input.requestFingerprint,
      input.createdAtEpoch,
    ],
    sql: `
      UPDATE judge_managed_ai_operation_lifecycle
      SET
        status = 'settled',
        settled_at_epoch = ?,
        reuse_after_epoch = ?
      WHERE claim_key_hash = ?
        AND status = ?
        AND reservation_id = ?
        AND (
          (
            status = 'reserved'
            AND provider_started_at_epoch IS NULL
          )
          OR (
            status = 'provider_started'
            AND provider_started_at_epoch <= ?
          )
        )
        AND EXISTS (
          SELECT 1
          FROM judge_managed_ai_operation_claims
          WHERE claim_key_hash = ?
            AND request_fingerprint = ?
            AND created_at_epoch = ?
        )
    `,
  };
}
