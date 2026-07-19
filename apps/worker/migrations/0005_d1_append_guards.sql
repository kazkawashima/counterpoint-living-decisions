CREATE TRIGGER IF NOT EXISTS events_contiguous_position
BEFORE INSERT ON events
WHEN NEW.position <> (
  SELECT COALESCE(MAX(position), 0) + 1
  FROM events
  WHERE meeting_id = NEW.meeting_id
)
BEGIN
  SELECT RAISE(ABORT, 'counterpoint_event_position_conflict');
END;

CREATE TRIGGER IF NOT EXISTS event_appends_complete_range
BEFORE INSERT ON event_appends
WHEN (
  NEW.event_count = 0
  AND NEW.first_position <> (
    SELECT COALESCE(MAX(position), 0) + 1
    FROM events
    WHERE meeting_id = NEW.meeting_id
  )
) OR (
  NEW.event_count > 0
  AND (
    NEW.first_position + NEW.event_count - 1 <> (
      SELECT COALESCE(MAX(position), 0)
      FROM events
      WHERE meeting_id = NEW.meeting_id
    )
    OR NEW.event_count <> (
      SELECT COUNT(*)
      FROM events
      WHERE meeting_id = NEW.meeting_id
        AND position >= NEW.first_position
        AND position < NEW.first_position + NEW.event_count
    )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'counterpoint_event_append_range_incomplete');
END;
