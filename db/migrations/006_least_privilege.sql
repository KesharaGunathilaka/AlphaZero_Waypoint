-- 006 · The API runs as a restricted role, not as the owner.
--
-- The schema always meant the API to connect as a member of waypoint_app (no ownership, no TRUNCATE,
-- no UPDATE or DELETE on append-only tables, row-level security applies), but the API connected as the
-- owner, which bypasses all of that. This migration completes what waypoint_app needs so the API works
-- with it; db/init/10-load-waypoint.sh (Docker) and db/load.sh --api-role (Neon) create the login role
-- waypoint_api that inherits it. Safe to run again.

SET search_path = wp, public;

-- ----- functions the API calls that were missing from the grant list --------------------------------
GRANT EXECUTE ON FUNCTION close_run, get_run, next_open_service_date, apply_pending_events, demo_reset TO waypoint_app;

-- The audit trail: the trigger writes audit_log as the owner, so the API can cause audit rows but has
-- no right to write (or change) audit_log itself.
ALTER FUNCTION audit_row() SECURITY DEFINER SET search_path = wp, pg_temp;

-- Photo and signature bytes of the "db" storage backend (created in 001, after the schema's grants).
GRANT SELECT, INSERT ON attachment_blob TO waypoint_app;

-- ----- trips and stops: dispatchers write them, only in their own depot -----------------------------
-- (read policies already exist; with row-level security on, a write needs its own policy.)
CREATE OR REPLACE FUNCTION can_plan_depot(p_depot smallint) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = wp, pg_temp AS $$
  SELECT COALESCE((SELECT u.role = 'admin' OR (u.role = 'dispatcher' AND u.depot_id = p_depot)
                   FROM wp.app_user u WHERE u.user_id = wp.me() AND u.active), false)
$$;
GRANT EXECUTE ON FUNCTION can_plan_depot TO waypoint_app;

-- The read policy looked a trip up by its id, which a row being inserted is not yet visible to, so
-- INSERT ... RETURNING failed. Same rule as can_see_route() (005), from the row's own columns.
CREATE OR REPLACE FUNCTION can_see_route_row(p_depot smallint, p_driver integer) RETURNS boolean LANGUAGE sql
STABLE SECURITY DEFINER SET search_path = wp, pg_temp AS $$
  SELECT COALESCE((SELECT CASE u.role
                            WHEN 'admin' THEN true
                            WHEN 'dispatcher' THEN u.all_depots OR p_depot = u.depot_id
                            WHEN 'loader' THEN p_depot = u.depot_id
                            WHEN 'driver' THEN p_driver = u.user_id
                            ELSE false END
                   FROM wp.app_user u WHERE u.user_id = wp.me() AND u.active), false)
$$;
GRANT EXECUTE ON FUNCTION can_see_route_row TO waypoint_app;
DROP POLICY IF EXISTS route_read ON route;
CREATE POLICY route_read ON route FOR SELECT USING (can_see_route_row(depot_id, driver_id));

DROP POLICY IF EXISTS route_plan_insert ON route;
DROP POLICY IF EXISTS route_plan_update ON route;
CREATE POLICY route_plan_insert ON route FOR INSERT WITH CHECK (can_plan_depot(depot_id));
CREATE POLICY route_plan_update ON route FOR UPDATE USING (can_plan_depot(depot_id)) WITH CHECK (can_plan_depot(depot_id));

DROP POLICY IF EXISTS stop_plan_insert ON stop;
DROP POLICY IF EXISTS stop_plan_update ON stop;
CREATE POLICY stop_plan_insert ON stop FOR INSERT
  WITH CHECK (can_plan_depot((SELECT r.depot_id FROM wp.route r WHERE r.route_id = stop.route_id)));
CREATE POLICY stop_plan_update ON stop FOR UPDATE
  USING (can_plan_depot((SELECT r.depot_id FROM wp.route r WHERE r.route_id = stop.route_id)))
  WITH CHECK (can_plan_depot((SELECT r.depot_id FROM wp.route r WHERE r.route_id = stop.route_id)));

-- ----- the engine's fresh start: drop a draft plan's trips, done as the owner after the checks ------
-- Trips and stops are never deleted once a plan has been released; before that, the engine replaces its
-- own proposal. The API role has no DELETE on these tables, so this function does it.
CREATE OR REPLACE FUNCTION clear_plan_draft(p_plan integer, p_actor integer) RETURNS void LANGUAGE plpgsql
SECURITY DEFINER SET search_path = wp, pg_temp AS $$
DECLARE pl wp.plan%ROWTYPE;
BEGIN
  PERFORM wp.assert_role(p_actor, ARRAY['dispatcher', 'admin']);
  SELECT * INTO pl FROM wp.plan WHERE plan_id = p_plan FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WP201: plan % does not exist', p_plan USING ERRCODE = 'WP201';
  END IF;
  PERFORM wp.assert_depot(p_actor, pl.depot_id);
  IF pl.state <> 'draft' THEN
    RAISE EXCEPTION 'WP202: plan % is already released; adjust it instead', p_plan USING ERRCODE = 'WP202';
  END IF;
  DELETE FROM wp.deferral_draft WHERE plan_id = p_plan;
  DELETE FROM wp.stop_order WHERE plan_id = p_plan;
  DELETE FROM wp.stop WHERE plan_id = p_plan;
  DELETE FROM wp.route WHERE plan_id = p_plan;
END $$;
REVOKE ALL ON FUNCTION clear_plan_draft FROM PUBLIC;
GRANT EXECUTE ON FUNCTION clear_plan_draft TO waypoint_app;

-- demo_reset() runs as the owner and checks its caller itself (see demo_reset_allowed() in 001).
