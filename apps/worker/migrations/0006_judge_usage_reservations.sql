CREATE TABLE IF NOT EXISTS judge_usage_reservations (
  reservation_id TEXT PRIMARY KEY CHECK (length(reservation_id) > 0),
  request_fingerprint TEXT NOT NULL CHECK (length(request_fingerprint) > 0),
  account_id TEXT NOT NULL CHECK (length(account_id) > 0),
  ip_hash TEXT NOT NULL
    CHECK (
      length(ip_hash) = 76
      AND substr(ip_hash, 1, 12) = 'hmac-sha256:'
      AND substr(ip_hash, 13) NOT GLOB '*[^0-9a-f]*'
    ),
  meeting_id TEXT NOT NULL CHECK (length(meeting_id) > 0),
  operation TEXT NOT NULL CHECK (length(operation) > 0),
  model TEXT NOT NULL CHECK (length(model) > 0),
  pricing_version TEXT NOT NULL CHECK (length(pricing_version) > 0),
  status TEXT NOT NULL
    CHECK (status IN ('reserved', 'finalized', 'released')),
  reserved_cost_micro_usd INTEGER NOT NULL
    CHECK (reserved_cost_micro_usd >= 0),
  actual_cost_micro_usd INTEGER
    CHECK (
      actual_cost_micro_usd IS NULL
      OR (
        actual_cost_micro_usd >= 0
        AND actual_cost_micro_usd <= reserved_cost_micro_usd
      )
    ),
  reserved_input_tokens INTEGER NOT NULL
    CHECK (reserved_input_tokens >= 0),
  actual_input_tokens INTEGER
    CHECK (
      actual_input_tokens IS NULL
      OR (
        actual_input_tokens >= 0
        AND actual_input_tokens <= reserved_input_tokens
      )
    ),
  reserved_output_tokens INTEGER NOT NULL
    CHECK (reserved_output_tokens >= 0),
  actual_output_tokens INTEGER
    CHECK (
      actual_output_tokens IS NULL
      OR (
        actual_output_tokens >= 0
        AND actual_output_tokens <= reserved_output_tokens
      )
    ),
  reserved_generation_count INTEGER NOT NULL
    CHECK (reserved_generation_count >= 0),
  actual_generation_count INTEGER
    CHECK (
      actual_generation_count IS NULL
      OR (
        actual_generation_count >= 0
        AND actual_generation_count <= reserved_generation_count
      )
    ),
  reserved_realtime_seconds INTEGER NOT NULL
    CHECK (reserved_realtime_seconds >= 0),
  actual_realtime_seconds INTEGER
    CHECK (
      actual_realtime_seconds IS NULL
      OR (
        actual_realtime_seconds >= 0
        AND actual_realtime_seconds <= reserved_realtime_seconds
      )
    ),
  reserved_at_epoch INTEGER NOT NULL CHECK (reserved_at_epoch >= 0),
  active_until_epoch INTEGER NOT NULL
    CHECK (
      active_until_epoch >= 0
      AND active_until_epoch >= reserved_at_epoch
    ),
  finalized_at_epoch INTEGER CHECK (finalized_at_epoch >= 0),
  released_at_epoch INTEGER CHECK (released_at_epoch >= 0),
  CHECK (
    (
      status = 'reserved'
      AND actual_cost_micro_usd IS NULL
      AND actual_input_tokens IS NULL
      AND actual_output_tokens IS NULL
      AND actual_generation_count IS NULL
      AND actual_realtime_seconds IS NULL
      AND finalized_at_epoch IS NULL
      AND released_at_epoch IS NULL
    )
    OR (
      status = 'finalized'
      AND actual_cost_micro_usd IS NOT NULL
      AND actual_input_tokens IS NOT NULL
      AND actual_output_tokens IS NOT NULL
      AND actual_generation_count IS NOT NULL
      AND actual_realtime_seconds IS NOT NULL
      AND finalized_at_epoch IS NOT NULL
      AND finalized_at_epoch >= reserved_at_epoch
      AND released_at_epoch IS NULL
    )
    OR (
      status = 'released'
      AND actual_cost_micro_usd IS NULL
      AND actual_input_tokens IS NULL
      AND actual_output_tokens IS NULL
      AND actual_generation_count IS NULL
      AND actual_realtime_seconds IS NULL
      AND finalized_at_epoch IS NULL
      AND released_at_epoch IS NOT NULL
      AND released_at_epoch >= reserved_at_epoch
    )
  )
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS judge_usage_reservations_request
  ON judge_usage_reservations(request_fingerprint);

CREATE INDEX IF NOT EXISTS judge_usage_reservations_rolling
  ON judge_usage_reservations(reserved_at_epoch)
  WHERE status IN ('reserved', 'finalized');

CREATE INDEX IF NOT EXISTS judge_usage_reservations_account_window
  ON judge_usage_reservations(account_id, reserved_at_epoch)
  WHERE status IN ('reserved', 'finalized');

CREATE INDEX IF NOT EXISTS judge_usage_reservations_ip_window
  ON judge_usage_reservations(ip_hash, reserved_at_epoch)
  WHERE status IN ('reserved', 'finalized');

CREATE INDEX IF NOT EXISTS judge_usage_reservations_meeting_window
  ON judge_usage_reservations(meeting_id, reserved_at_epoch)
  WHERE status IN ('reserved', 'finalized');

CREATE INDEX IF NOT EXISTS judge_usage_reservations_active
  ON judge_usage_reservations(active_until_epoch)
  WHERE status = 'reserved';

-- The rolling-cost trigger below assumes append-time ordering. Enforce that
-- invariant in the database so a privileged out-of-order direct write cannot
-- create a rolling window that was never checked. Normal reservations may
-- share the same one-second epoch.
CREATE TRIGGER IF NOT EXISTS judge_usage_reservations_monotonic_insert
BEFORE INSERT ON judge_usage_reservations
WHEN NEW.status IN ('reserved', 'finalized')
  AND NEW.reserved_at_epoch < COALESCE((
    SELECT MAX(reserved_at_epoch)
    FROM judge_usage_reservations
    WHERE status IN ('reserved', 'finalized')
  ), 0)
BEGIN
  SELECT RAISE(ABORT, 'counterpoint_judge_usage_timestamp_regression');
END;

CREATE TRIGGER IF NOT EXISTS judge_usage_reservations_monotonic_update
BEFORE UPDATE OF status, reserved_at_epoch
ON judge_usage_reservations
WHEN NEW.status IN ('reserved', 'finalized')
  AND (
    NEW.reserved_at_epoch <> OLD.reserved_at_epoch
    OR OLD.status = 'released'
  )
  AND NEW.reserved_at_epoch < COALESCE((
    SELECT MAX(reserved_at_epoch)
    FROM judge_usage_reservations
    WHERE reservation_id <> OLD.reservation_id
      AND status IN ('reserved', 'finalized')
  ), 0)
BEGIN
  SELECT RAISE(ABORT, 'counterpoint_judge_usage_timestamp_regression');
END;

CREATE TRIGGER IF NOT EXISTS judge_usage_reservations_global_cost_insert
BEFORE INSERT ON judge_usage_reservations
WHEN NEW.status IN ('reserved', 'finalized')
  AND (
    CASE NEW.status
      WHEN 'reserved' THEN NEW.reserved_cost_micro_usd
      ELSE NEW.actual_cost_micro_usd
    END
    + COALESCE((
      SELECT SUM(
        CASE status
          WHEN 'reserved' THEN reserved_cost_micro_usd
          ELSE actual_cost_micro_usd
        END
      )
      FROM judge_usage_reservations
      WHERE status = 'reserved'
        OR (
          status = 'finalized'
          AND finalized_at_epoch > (
            CASE NEW.status
              WHEN 'reserved' THEN NEW.reserved_at_epoch
              ELSE NEW.finalized_at_epoch
            END
          ) - 86400
        )
    ), 0)
  ) > 25000000
BEGIN
  SELECT RAISE(ABORT, 'counterpoint_judge_usage_global_cost_limit');
END;

CREATE TRIGGER IF NOT EXISTS judge_usage_reservations_global_cost_update
BEFORE UPDATE OF
  status,
  reserved_cost_micro_usd,
  actual_cost_micro_usd,
  reserved_at_epoch
ON judge_usage_reservations
WHEN NEW.status IN ('reserved', 'finalized')
  AND (
    CASE NEW.status
      WHEN 'reserved' THEN NEW.reserved_cost_micro_usd
      ELSE NEW.actual_cost_micro_usd
    END
    + COALESCE((
      SELECT SUM(
        CASE status
          WHEN 'reserved' THEN reserved_cost_micro_usd
          ELSE actual_cost_micro_usd
        END
      )
      FROM judge_usage_reservations
      WHERE reservation_id <> OLD.reservation_id
        AND (
          status = 'reserved'
          OR (
            status = 'finalized'
            AND finalized_at_epoch > (
              CASE NEW.status
                WHEN 'reserved' THEN NEW.reserved_at_epoch
                ELSE NEW.finalized_at_epoch
              END
            ) - 86400
          )
        )
    ), 0)
  ) > 25000000
BEGIN
  SELECT RAISE(ABORT, 'counterpoint_judge_usage_global_cost_limit');
END;
