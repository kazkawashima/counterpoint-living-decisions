CREATE TABLE IF NOT EXISTS judge_managed_realtime_calls (
  managed_call_id TEXT PRIMARY KEY
    CHECK (
      length(managed_call_id) BETWEEN 1 AND 256
      AND instr(managed_call_id, char(9)) = 0
      AND instr(managed_call_id, char(10)) = 0
      AND instr(managed_call_id, char(11)) = 0
      AND instr(managed_call_id, char(12)) = 0
      AND instr(managed_call_id, char(13)) = 0
      AND instr(managed_call_id, char(32)) = 0
      AND instr(managed_call_id, char(127)) = 0
    ),
  reservation_id TEXT NOT NULL UNIQUE,
  account_id TEXT NOT NULL CHECK (length(account_id) > 0),
  meeting_id TEXT NOT NULL CHECK (length(meeting_id) > 0),
  user_id TEXT NOT NULL CHECK (length(user_id) > 0),
  session_id TEXT NOT NULL CHECK (length(session_id) > 0),
  participant_id TEXT NOT NULL CHECK (length(participant_id) > 0),
  channel TEXT NOT NULL CHECK (channel IN ('private', 'shared')),
  status TEXT NOT NULL CHECK (status IN ('active', 'terminated')),
  created_at_epoch INTEGER NOT NULL CHECK (created_at_epoch >= 0),
  expires_at_epoch INTEGER NOT NULL
    CHECK (
      expires_at_epoch >= 0
      AND expires_at_epoch >= created_at_epoch
    ),
  terminated_at_epoch INTEGER CHECK (
    terminated_at_epoch IS NULL
    OR terminated_at_epoch >= created_at_epoch
  ),
  CHECK (
    (
      status = 'active'
      AND terminated_at_epoch IS NULL
    )
    OR (
      status = 'terminated'
      AND terminated_at_epoch IS NOT NULL
    )
  ),
  CHECK (account_id = user_id),
  FOREIGN KEY (reservation_id)
    REFERENCES judge_usage_reservations(reservation_id),
  FOREIGN KEY (meeting_id) REFERENCES meetings(meeting_id),
  FOREIGN KEY (user_id) REFERENCES users(user_id),
  FOREIGN KEY (session_id) REFERENCES sessions(session_id),
  FOREIGN KEY (meeting_id, participant_id)
    REFERENCES participant_assignments(meeting_id, participant_id)
) STRICT;

CREATE INDEX IF NOT EXISTS judge_managed_realtime_calls_owner
  ON judge_managed_realtime_calls(
    user_id,
    session_id,
    meeting_id,
    managed_call_id
  );

CREATE INDEX IF NOT EXISTS judge_managed_realtime_calls_active_expiry
  ON judge_managed_realtime_calls(expires_at_epoch)
  WHERE status = 'active';

CREATE TRIGGER IF NOT EXISTS judge_managed_realtime_calls_reservation_guard
BEFORE INSERT ON judge_managed_realtime_calls
WHEN NOT EXISTS (
  SELECT 1
  FROM judge_usage_reservations
  WHERE reservation_id = NEW.reservation_id
    AND account_id = NEW.account_id
    AND meeting_id = NEW.meeting_id
    AND status = 'reserved'
    AND reserved_at_epoch <= NEW.created_at_epoch
    AND active_until_epoch >= NEW.expires_at_epoch
)
BEGIN
  SELECT RAISE(ABORT, 'counterpoint_managed_call_reservation_mismatch');
END;

CREATE TRIGGER IF NOT EXISTS judge_managed_realtime_calls_owner_immutable
BEFORE UPDATE OF
  managed_call_id,
  reservation_id,
  account_id,
  meeting_id,
  user_id,
  session_id,
  participant_id,
  channel,
  created_at_epoch,
  expires_at_epoch
ON judge_managed_realtime_calls
BEGIN
  SELECT RAISE(ABORT, 'counterpoint_managed_call_owner_immutable');
END;

CREATE TRIGGER IF NOT EXISTS judge_managed_realtime_calls_terminal
BEFORE UPDATE OF status, terminated_at_epoch
ON judge_managed_realtime_calls
WHEN OLD.status <> 'active'
  OR NEW.status <> 'terminated'
  OR NEW.terminated_at_epoch IS NULL
BEGIN
  SELECT RAISE(ABORT, 'counterpoint_managed_call_invalid_transition');
END;
