CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
) STRICT;

CREATE TABLE IF NOT EXISTS meetings (
  meeting_id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  created_by_user_id TEXT NOT NULL,
  facilitator_participant_id TEXT NOT NULL,
  purpose TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL
    DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (created_by_user_id) REFERENCES users(user_id)
) STRICT;

CREATE TABLE IF NOT EXISTS participant_assignments (
  meeting_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('facilitator', 'participant')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  PRIMARY KEY (meeting_id, participant_id),
  UNIQUE (meeting_id, user_id),
  FOREIGN KEY (meeting_id) REFERENCES meetings(meeting_id),
  FOREIGN KEY (user_id) REFERENCES users(user_id)
) STRICT;

CREATE INDEX IF NOT EXISTS participant_assignments_user
  ON participant_assignments(user_id, active, meeting_id);
