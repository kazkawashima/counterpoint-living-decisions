CREATE TABLE IF NOT EXISTS events (
  meeting_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position > 0),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  appended_at TEXT NOT NULL
    DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (meeting_id, position)
) STRICT;

CREATE TABLE IF NOT EXISTS event_appends (
  meeting_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  payload_fingerprint TEXT NOT NULL,
  event_payloads_json TEXT NOT NULL
    CHECK (json_valid(event_payloads_json)),
  first_position INTEGER NOT NULL CHECK (first_position > 0),
  event_count INTEGER NOT NULL CHECK (event_count >= 0),
  appended_at TEXT NOT NULL
    DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (meeting_id, idempotency_key)
) STRICT;

CREATE TABLE IF NOT EXISTS projections (
  meeting_id TEXT NOT NULL,
  projection TEXT NOT NULL,
  scope_kind TEXT NOT NULL
    CHECK (scope_kind IN ('shared', 'owner_private')),
  owner_participant_id TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  updated_at TEXT NOT NULL
    DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (
    (scope_kind = 'shared' AND owner_participant_id = '')
    OR
    (scope_kind = 'owner_private' AND owner_participant_id <> '')
  ),
  PRIMARY KEY (
    meeting_id,
    projection,
    scope_kind,
    owner_participant_id
  )
) STRICT;
