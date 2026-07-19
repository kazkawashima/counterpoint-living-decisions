CREATE TABLE IF NOT EXISTS judge_managed_ai_operation_lifecycle (
  claim_key_hash TEXT PRIMARY KEY,
  status TEXT NOT NULL
    CHECK (
      status IN (
        'legacy_blocked',
        'reserved',
        'provider_started',
        'settled'
      )
    ),
  reservation_id TEXT UNIQUE
    CHECK (reservation_id IS NULL OR length(reservation_id) > 0),
  lease_expires_at_epoch INTEGER
    CHECK (
      lease_expires_at_epoch IS NULL
      OR lease_expires_at_epoch BETWEEN 0 AND 9007199254740991
    ),
  provider_started_at_epoch INTEGER
    CHECK (
      provider_started_at_epoch IS NULL
      OR provider_started_at_epoch BETWEEN 0 AND 9007199254740991
    ),
  settled_at_epoch INTEGER
    CHECK (
      settled_at_epoch IS NULL
      OR settled_at_epoch BETWEEN 0 AND 9007199254740991
    ),
  reuse_after_epoch INTEGER
    CHECK (
      reuse_after_epoch IS NULL
      OR reuse_after_epoch BETWEEN 0 AND 9007199254740991
    ),
  FOREIGN KEY (claim_key_hash)
    REFERENCES judge_managed_ai_operation_claims(claim_key_hash)
    ON DELETE CASCADE,
  CHECK (
    (
      status = 'legacy_blocked'
      AND reservation_id IS NULL
      AND lease_expires_at_epoch IS NULL
      AND provider_started_at_epoch IS NULL
      AND settled_at_epoch IS NULL
      AND reuse_after_epoch IS NULL
    )
    OR (
      status = 'reserved'
      AND reservation_id IS NOT NULL
      AND lease_expires_at_epoch IS NOT NULL
      AND provider_started_at_epoch IS NULL
      AND settled_at_epoch IS NULL
      AND reuse_after_epoch IS NULL
    )
    OR (
      status = 'provider_started'
      AND reservation_id IS NOT NULL
      AND lease_expires_at_epoch IS NOT NULL
      AND provider_started_at_epoch IS NOT NULL
      AND settled_at_epoch IS NULL
      AND reuse_after_epoch IS NULL
    )
    OR (
      status = 'settled'
      AND reservation_id IS NOT NULL
      AND settled_at_epoch IS NOT NULL
      AND reuse_after_epoch IS NOT NULL
      AND reuse_after_epoch > settled_at_epoch
    )
  )
) STRICT;

CREATE INDEX IF NOT EXISTS judge_managed_ai_operation_lifecycle_stale
  ON judge_managed_ai_operation_lifecycle(
    status,
    lease_expires_at_epoch,
    provider_started_at_epoch,
    claim_key_hash
  );

CREATE TRIGGER IF NOT EXISTS judge_managed_ai_operation_lifecycle_key_immutable
BEFORE UPDATE OF claim_key_hash
ON judge_managed_ai_operation_lifecycle
BEGIN
  SELECT RAISE(
    ABORT,
    'counterpoint_managed_ai_lifecycle_claim_key_immutable'
  );
END;

INSERT OR IGNORE INTO judge_managed_ai_operation_lifecycle (
  claim_key_hash,
  status
)
SELECT
  claim_key_hash,
  'legacy_blocked'
FROM judge_managed_ai_operation_claims;
