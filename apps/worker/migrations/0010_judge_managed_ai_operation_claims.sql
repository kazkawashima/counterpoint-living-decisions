CREATE TABLE IF NOT EXISTS judge_managed_ai_operation_claims (
  claim_key_hash TEXT PRIMARY KEY
    CHECK (
      length(claim_key_hash) = 71
      AND substr(claim_key_hash, 1, 7) = 'sha256:'
      AND substr(claim_key_hash, 8) NOT GLOB '*[^0-9a-f]*'
    ),
  request_fingerprint TEXT NOT NULL
    CHECK (
      length(request_fingerprint) = 71
      AND substr(request_fingerprint, 1, 7) = 'sha256:'
      AND substr(request_fingerprint, 8) NOT GLOB '*[^0-9a-f]*'
    ),
  operation TEXT NOT NULL
    CHECK (
      length(operation) BETWEEN 1 AND 256
      AND operation NOT GLOB '*[^0-9A-Za-z._:/-]*'
    ),
  model TEXT NOT NULL
    CHECK (
      length(model) BETWEEN 1 AND 256
      AND model NOT GLOB '*[^0-9A-Za-z._:/-]*'
    ),
  pricing_version TEXT NOT NULL
    CHECK (
      length(pricing_version) BETWEEN 1 AND 256
      AND pricing_version NOT GLOB '*[^0-9A-Za-z._:/-]*'
    ),
  created_at_epoch INTEGER NOT NULL
    CHECK (created_at_epoch BETWEEN 0 AND 9007199254740991),
  expires_at_epoch INTEGER NOT NULL
    CHECK (
      expires_at_epoch BETWEEN 0 AND 9007199254740991
      AND expires_at_epoch >= created_at_epoch
    )
) STRICT;

CREATE INDEX IF NOT EXISTS judge_managed_ai_operation_claims_expiry
  ON judge_managed_ai_operation_claims(expires_at_epoch);

CREATE TRIGGER IF NOT EXISTS judge_managed_ai_operation_claims_key_immutable
BEFORE UPDATE OF claim_key_hash
ON judge_managed_ai_operation_claims
BEGIN
  SELECT RAISE(ABORT, 'counterpoint_managed_ai_claim_key_immutable');
END;
