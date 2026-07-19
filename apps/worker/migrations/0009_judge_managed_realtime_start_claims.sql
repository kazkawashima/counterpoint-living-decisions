CREATE TABLE IF NOT EXISTS judge_managed_realtime_start_claims (
  start_key_hash TEXT PRIMARY KEY
    CHECK (
      length(start_key_hash) = 71
      AND substr(start_key_hash, 1, 7) = 'sha256:'
      AND substr(start_key_hash, 8) NOT GLOB '*[^0-9a-f]*'
    ),
  request_fingerprint TEXT NOT NULL
    CHECK (
      length(request_fingerprint) = 71
      AND substr(request_fingerprint, 1, 7) = 'sha256:'
      AND substr(request_fingerprint, 8) NOT GLOB '*[^0-9a-f]*'
    ),
  managed_call_id TEXT NOT NULL CHECK (length(managed_call_id) > 0),
  meeting_id TEXT NOT NULL CHECK (length(meeting_id) > 0),
  user_id TEXT NOT NULL CHECK (length(user_id) > 0),
  session_id TEXT NOT NULL CHECK (length(session_id) > 0),
  participant_id TEXT NOT NULL CHECK (length(participant_id) > 0),
  created_at_epoch INTEGER NOT NULL CHECK (created_at_epoch >= 0),
  expires_at_epoch INTEGER NOT NULL
    CHECK (
      expires_at_epoch >= 0
      AND expires_at_epoch >= created_at_epoch
    ),
  FOREIGN KEY (meeting_id) REFERENCES meetings(meeting_id),
  FOREIGN KEY (user_id) REFERENCES users(user_id),
  FOREIGN KEY (session_id) REFERENCES sessions(session_id),
  FOREIGN KEY (meeting_id, participant_id)
    REFERENCES participant_assignments(meeting_id, participant_id)
) STRICT;

CREATE INDEX IF NOT EXISTS judge_managed_realtime_start_claims_expiry
  ON judge_managed_realtime_start_claims(expires_at_epoch);

CREATE TRIGGER IF NOT EXISTS judge_managed_realtime_start_claims_scope_immutable
BEFORE UPDATE OF start_key_hash
ON judge_managed_realtime_start_claims
BEGIN
  SELECT RAISE(ABORT, 'counterpoint_managed_start_scope_immutable');
END;
