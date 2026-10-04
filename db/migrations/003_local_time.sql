-- 003: the database works in Sri Lanka time. Safe to re-run.
-- Waypoint runs in one time zone (Asia/Colombo, no daylight saving). Functions that use
-- current_date or cast a timestamp to a date (order slots, "today", 7-day ledger windows) were
-- reading the server's UTC date, which is still "yesterday" between 00:00 and 05:30 in Sri Lanka:
-- a store manager at 03:00 on Sunday saw "the Saturday run has closed". Setting the database's
-- default time zone fixes every such place at once. Stored timestamps are unchanged (timestamptz);
-- only "what day is it" and how times print change. New connections pick it up.
DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET timezone = %L', current_database(), 'Asia/Colombo');
END $$;
