DROP INDEX IF EXISTS judge_usage_reservations_request;

CREATE UNIQUE INDEX judge_usage_reservations_request
  ON judge_usage_reservations(request_fingerprint)
  WHERE status = 'reserved';
