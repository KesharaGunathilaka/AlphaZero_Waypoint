-- 008 · Predicted lateness and handling time (our Datathon Task 1 model). Safe to run again.
SET search_path = wp, public;

-- The prediction seam gets the model's late probability (0 to 1) next to its handling minutes. The API writes
-- what the model said about each stop before the vehicle left, append-only, so it can later be checked
-- against what happened. The newest row per stop and subject is the current one.
ALTER TABLE prediction DROP CONSTRAINT IF EXISTS prediction_subject_check;
ALTER TABLE prediction ADD CONSTRAINT prediction_subject_check
  CHECK (subject IN ('service_minutes', 'lateness_minutes', 'demand_qty', 'late_probability'));
CREATE INDEX IF NOT EXISTS prediction_stop_latest_idx ON prediction (stop_id, subject, generated_at DESC)
  WHERE stop_id IS NOT NULL;
GRANT INSERT ON prediction TO waypoint_app;
