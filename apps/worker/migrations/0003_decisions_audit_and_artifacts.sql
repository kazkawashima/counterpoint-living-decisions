CREATE TABLE IF NOT EXISTS decision_revisions (
  meeting_id TEXT NOT NULL,
  decision_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  created_at TEXT NOT NULL
    DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (meeting_id, decision_id, revision)
) STRICT;

CREATE TABLE IF NOT EXISTS audit_history (
  meeting_id TEXT NOT NULL,
  audit_id TEXT NOT NULL,
  event_position INTEGER,
  action TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  recorded_at TEXT NOT NULL
    DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (meeting_id, audit_id),
  FOREIGN KEY (meeting_id, event_position)
    REFERENCES events(meeting_id, position)
) STRICT;

CREATE INDEX IF NOT EXISTS audit_history_meeting_position
  ON audit_history(meeting_id, event_position);

CREATE TABLE IF NOT EXISTS artifact_metadata (
  meeting_id TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  visibility TEXT NOT NULL CHECK (visibility IN ('private', 'shared')),
  owner_participant_id TEXT NOT NULL DEFAULT '',
  content_type TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  storage_reference TEXT NOT NULL,
  created_at TEXT NOT NULL
    DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (
    (visibility = 'shared' AND owner_participant_id = '')
    OR
    (visibility = 'private' AND owner_participant_id <> '')
  ),
  PRIMARY KEY (
    meeting_id,
    visibility,
    owner_participant_id,
    artifact_id
  ),
  UNIQUE (storage_reference)
) STRICT;
