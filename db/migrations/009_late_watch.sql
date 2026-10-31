-- 009 · Live early warning from the lateness model, and the store's answer to it. Safe to run again.
SET search_path = wp, public;

-- The model replays a whole trip, so it needs every stop and order on it. A store manager may only see their
-- own orders, so the API reads the trip through this function: the rows of each route the caller can see, or
-- that carries one of the caller's orders. It stays in the API (only the caller's own stop is returned to a
-- store). Times are minutes after midnight at the depot; arrived_min / done_min are what the phones reported.
CREATE OR REPLACE FUNCTION model_route_rows(p_routes integer[], p_orders bigint[] DEFAULT '{}')
RETURNS SETOF jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = wp, pg_temp AS $$
  WITH wanted AS (
    SELECT r.route_id FROM wp.route r WHERE r.route_id = ANY (p_routes) AND wp.can_see_route(r.route_id)
    UNION
    SELECT s.route_id FROM wp.stop_order so JOIN wp.stop s ON s.stop_id = so.stop_id
    WHERE so.order_id = ANY (p_orders) AND so.removed_at IS NULL AND wp.can_see_order(so.order_id)
  )
  SELECT to_jsonb(x) FROM (
    SELECT r.route_id, r.plan_id, p.run_id, p.service_date::text AS service_date, dp.tz, dp.name AS depot_name,
           r.state::text AS route_state,
           (EXTRACT(hour FROM r.depart_at AT TIME ZONE dp.tz) * 60 + EXTRACT(minute FROM r.depart_at AT TIME ZONE dp.tz))::float AS depart_min,
           (EXTRACT(hour FROM r.departed_at AT TIME ZONE dp.tz) * 60 + EXTRACT(minute FROM r.departed_at AT TIME ZONE dp.tz))::float AS departed_min,
           v.source_id AS vehicle_id, c.is_van, c.carries_chilled,
           v.max_weight_kg::float AS weight_cap_kg, v.max_volume_m3::float AS volume_cap_m3,
           replace(b.name, 'Waypoint ', '') AS brand, di.name AS district, dp.name AS depot,
           di.depot_to_district_km::float AS out_km, di.depot_to_district_freeflow_min::float AS out_min,
           di.inter_stop_km::float AS hop_km, di.inter_stop_freeflow_min::float AS hop_min,
           s.stop_id, s.seq AS stop_seq, ou.code AS outlet_id, ou.name AS outlet_name, ou.unload::text AS dock_type, ou.van_only,
           h.order_id, h.temp::text AS temp, h.weight_kg::float AS kg, h.volume_m3::float AS m3, h.deferral_count,
           sa.minutes::float AS allowance,
           (EXTRACT(hour FROM w.opens) * 60 + EXTRACT(minute FROM w.opens))::float AS opens_min,
           (EXTRACT(hour FROM w.closes) * 60 + EXTRACT(minute FROM w.closes))::float AS closes_min,
           (EXTRACT(hour FROM a.device_time AT TIME ZONE dp.tz) * 60 + EXTRACT(minute FROM a.device_time AT TIME ZONE dp.tz))::float AS arrived_min,
           (EXTRACT(hour FROM dn.done AT TIME ZONE dp.tz) * 60 + EXTRACT(minute FROM dn.done AT TIME ZONE dp.tz))::float AS done_min
    FROM wanted JOIN wp.route r ON r.route_id = wanted.route_id
    JOIN wp.plan p ON p.plan_id = r.plan_id JOIN wp.depot dp ON dp.depot_id = r.depot_id
    JOIN wp.vehicle v ON v.vehicle_id = r.vehicle_id JOIN wp.vehicle_class c ON c.class_id = v.class_id
    JOIN wp.brand b ON b.brand_id = r.brand_id JOIN wp.district di ON di.district_id = r.district_id
    JOIN wp.stop s ON s.route_id = r.route_id AND s.removed_at IS NULL
    JOIN wp.stop_order so ON so.stop_id = s.stop_id AND so.removed_at IS NULL
    JOIN wp.order_header h ON h.order_id = so.order_id
    JOIN wp.outlet ou ON ou.outlet_id = s.outlet_id
    JOIN wp.service_allowance sa ON sa.brand_id = r.brand_id AND sa.unload = ou.unload
    LEFT JOIN LATERAL (SELECT min(x.opens) AS opens, max(x.closes) AS closes FROM wp.outlet_window x
                       WHERE x.outlet_id = ou.outlet_id AND x.isodow = EXTRACT(isodow FROM p.service_date)::smallint) w ON true
    LEFT JOIN wp.stop_arrival a ON a.stop_id = s.stop_id
    LEFT JOIN LATERAL (SELECT max(d.device_time) AS done FROM wp.stop_order so2 JOIN wp.current_delivery d ON d.order_id = so2.order_id
                       WHERE so2.stop_id = s.stop_id AND so2.removed_at IS NULL) dn ON true
    WHERE r.state <> 'cancelled'
    ORDER BY r.route_id, s.seq, h.order_id
  ) x
$$;
REVOKE ALL ON FUNCTION model_route_rows(integer[], bigint[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION model_route_rows(integer[], bigint[]) TO waypoint_app;

-- A store told "likely after your window" answers: it will receive until a later time, or it can't. The answer
-- is for that one delivery; the outlet's window (master data the engine plans with) does not change.
-- Append-only: the newest answer per stop counts.
CREATE TABLE IF NOT EXISTS receiving_reply (
  reply_id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id         bigint NOT NULL REFERENCES order_header,
  stop_id          integer NOT NULL REFERENCES stop,
  answer           text NOT NULL CHECK (answer IN ('will_receive', 'cannot_receive')),
  receive_until    timestamptz,
  expected_arrival timestamptz,   -- what the store was told
  late_probability numeric(5,4),
  replied_by       integer NOT NULL REFERENCES app_user,
  replied_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (answer = 'cannot_receive' OR receive_until IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS receiving_reply_stop_idx ON receiving_reply (stop_id, replied_at DESC);
DROP TRIGGER IF EXISTS receiving_reply_append_only ON receiving_reply;
CREATE TRIGGER receiving_reply_append_only BEFORE UPDATE OR DELETE ON receiving_reply
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
ALTER TABLE receiving_reply ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS receiving_reply_read ON receiving_reply;
CREATE POLICY receiving_reply_read ON receiving_reply FOR SELECT USING (can_see_order(order_id));
GRANT SELECT ON receiving_reply TO waypoint_app;

CREATE OR REPLACE FUNCTION reply_receiving(p_order bigint, p_user integer, p_answer text, p_until timestamptz,
                                           p_expected timestamptz, p_probability numeric)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = wp, pg_temp AS $$
DECLARE u wp.app_user%ROWTYPE; h wp.order_header%ROWTYPE; sid integer; rstate text; rid bigint;
BEGIN
  PERFORM wp.assert_role(p_user, ARRAY['store_manager']);
  SELECT * INTO u FROM wp.app_user WHERE user_id = p_user;
  SELECT * INTO h FROM wp.order_header WHERE order_id = p_order;
  IF NOT FOUND OR u.outlet_id IS DISTINCT FROM h.outlet_id THEN
    RAISE EXCEPTION 'WP340: this order is not yours to answer for' USING ERRCODE = 'WP340';
  END IF;
  SELECT s.stop_id, r.state::text INTO sid, rstate
  FROM wp.stop_order so JOIN wp.stop s ON s.stop_id = so.stop_id JOIN wp.route r ON r.route_id = s.route_id
  WHERE so.order_id = p_order AND so.removed_at IS NULL AND s.removed_at IS NULL AND r.state <> 'cancelled';
  IF sid IS NULL OR rstate NOT IN ('loaded', 'on_the_way') OR EXISTS (SELECT 1 FROM wp.stop_arrival a WHERE a.stop_id = sid) THEN
    RAISE EXCEPTION 'WP341: this delivery is not on its way any more' USING ERRCODE = 'WP341';
  END IF;
  IF p_answer = 'will_receive' AND (p_until IS NULL OR p_until <= wp.app_now() OR p_until > wp.app_now() + interval '8 hours') THEN
    RAISE EXCEPTION 'WP342: choose a time later today' USING ERRCODE = 'WP342';
  END IF;
  PERFORM set_config('wp.actor_id', p_user::text, true);
  INSERT INTO wp.receiving_reply (order_id, stop_id, answer, receive_until, expected_arrival, late_probability, replied_by, replied_at)
  VALUES (p_order, sid, p_answer, CASE WHEN p_answer = 'will_receive' THEN p_until END, p_expected, p_probability, p_user, wp.app_now())
  RETURNING reply_id INTO rid;
  RETURN rid;
END $$;
REVOKE ALL ON FUNCTION reply_receiving(bigint, integer, text, timestamptz, timestamptz, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reply_receiving(bigint, integer, text, timestamptz, timestamptz, numeric) TO waypoint_app;
