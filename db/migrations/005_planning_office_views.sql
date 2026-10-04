-- 005: the planning office sees both depots. Safe to re-run.
-- A dispatcher with all_depots (001) may READ every depot in the shared views (Live, Records, fuel),
-- so monitoring covers Kandy and Peliyagoda on one screen. Every WRITE still goes through
-- assert_depot(), which checks the depot the dispatcher is working on (app_user.depot_id):
-- plans, moves, deferrals and releases stay one depot at a time.
-- Generated from the exact text in waypoint_schema.sql; only the visibility test changes.
SET search_path = wp, public;

CREATE OR REPLACE FUNCTION can_see_route(p_route integer) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = wp, pg_temp AS $$
  SELECT CASE u.role
           WHEN 'admin' THEN true
           WHEN 'dispatcher' THEN u.all_depots OR r.depot_id = u.depot_id
           WHEN 'loader' THEN r.depot_id = u.depot_id
           WHEN 'driver' THEN r.driver_id = u.user_id
           ELSE false END
  FROM wp.app_user u, wp.route r
  WHERE u.user_id = wp.me() AND u.active AND r.route_id = p_route
$$;

CREATE OR REPLACE FUNCTION can_see_order(p_order bigint) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = wp, pg_temp AS $$
  SELECT CASE u.role
           WHEN 'admin' THEN true
           WHEN 'dispatcher' THEN u.all_depots OR ou.depot_id = u.depot_id
           WHEN 'loader' THEN ou.depot_id = u.depot_id
           WHEN 'store_manager' THEN h.outlet_id = u.outlet_id
           WHEN 'driver' THEN EXISTS (SELECT 1 FROM wp.stop_order so JOIN wp.stop s ON s.stop_id = so.stop_id
                                      JOIN wp.route r ON r.route_id = s.route_id
                                      WHERE so.order_id = h.order_id AND r.driver_id = u.user_id)
           ELSE false END
  FROM wp.app_user u, wp.order_header h JOIN wp.outlet ou ON ou.outlet_id = h.outlet_id
  WHERE u.user_id = wp.me() AND u.active AND h.order_id = p_order
$$;

CREATE OR REPLACE FUNCTION can_see_outlet(p_outlet integer) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = wp, pg_temp AS $$
  SELECT CASE u.role WHEN 'admin' THEN true
           WHEN 'store_manager' THEN u.outlet_id = p_outlet
           WHEN 'dispatcher' THEN u.all_depots OR (SELECT depot_id FROM wp.outlet WHERE outlet_id = p_outlet) = u.depot_id
           ELSE (SELECT depot_id FROM wp.outlet WHERE outlet_id = p_outlet) = u.depot_id END
  FROM wp.app_user u WHERE u.user_id = wp.me() AND u.active
$$;

CREATE OR REPLACE VIEW plan_summary AS
SELECT p.plan_id, p.run_id, p.service_date, p.depot_id, p.version, p.dirty, p.edited_at,
       (SELECT count(*) FROM order_header h WHERE h.run_id = p.run_id AND h.status IN ('confirmed','planned','loading','loaded','on_the_way','delivered','delivered_in_part','received','not_delivered')) AS orders_confirmed,
       (SELECT count(DISTINCT so.order_id) FROM stop_order so WHERE so.plan_id = p.plan_id AND so.removed_at IS NULL) AS orders_planned,
       pv.cannot_fit, pv.rule_conflicts,
       (SELECT count(*) FROM route r JOIN vehicle ve USING (vehicle_id) JOIN vehicle_class vc USING (class_id)
         WHERE r.plan_id = p.plan_id AND r.state <> 'cancelled' AND vc.carries_chilled) AS refrigerated_routes,
       (SELECT count(*) FROM vehicle ve JOIN vehicle_class vc USING (class_id)
         WHERE ve.active AND ve.depot_id = p.depot_id AND vc.carries_chilled
           AND NOT EXISTS (SELECT 1 FROM route r WHERE r.plan_id = p.plan_id AND r.vehicle_id = ve.vehicle_id AND r.state <> 'cancelled')) AS refrigerated_free,
       (SELECT count(*) FROM vehicle ve JOIN vehicle_class vc USING (class_id)
         WHERE ve.active AND ve.depot_id = p.depot_id AND vc.carries_chilled) AS refrigerated_total,
       data_through() AS data_through
FROM plan p
CROSS JOIN LATERAL (SELECT count(*) FILTER (WHERE x.code = 'unplanned') AS cannot_fit,
                           count(*) FILTER (WHERE x.code <> 'unplanned') AS rule_conflicts
                    FROM plan_violations(p.plan_id) x) pv
WHERE EXISTS (SELECT 1 FROM app_user u WHERE u.user_id = me() AND (u.role = 'admin' OR u.all_depots OR u.depot_id = p.depot_id));

CREATE OR REPLACE VIEW outlet_run_history AS
SELECT x.outlet_id, x.day,
       CASE WHEN EXISTS (SELECT 1 FROM deferral d WHERE d.outlet_id = x.outlet_id AND d.from_date = x.day) THEN 'deferred'
            WHEN EXISTS (SELECT 1 FROM order_header h WHERE h.outlet_id = x.outlet_id AND h.delivery_date = x.day
                         AND h.status IN ('delivered','delivered_in_part','received')) THEN 'delivered'
            ELSE 'no_order' END AS outcome,
       x.rn
FROM (
  SELECT o.outlet_id, g.day::date AS day, row_number() OVER (PARTITION BY o.outlet_id ORDER BY g.day DESC) AS rn
  FROM outlet o
  CROSS JOIN generate_series(current_date - 14, current_date - 1, interval '1 day') g(day)
  WHERE is_working_day(g.day::date) AND o.active
) x
WHERE x.rn <= 5
  AND EXISTS (SELECT 1 FROM app_user u WHERE u.user_id = me()
              AND (u.role = 'admin' OR u.all_depots OR u.depot_id = (SELECT depot_id FROM outlet WHERE outlet_id = x.outlet_id)
                   OR u.outlet_id = x.outlet_id));

CREATE OR REPLACE VIEW monitor_exceptions AS
WITH live AS (
  SELECT r.route_id, r.plan_id, r.vehicle_id, ve.code AS vehicle_code, r.driver_id, r.state, r.depart_at
  FROM route r JOIN vehicle ve USING (vehicle_id)
  WHERE r.state IN ('loaded', 'on_the_way') AND can_see_route(r.route_id)
), dev AS (
  SELECT DISTINCT ON (d.user_id) d.user_id, d.last_seen_at FROM device d
  WHERE d.kind = 'driver_phone' AND d.active ORDER BY d.user_id, d.last_seen_at DESC NULLS LAST
)
-- Delivery failed, not yet requeued
SELECT 'delivery_failed'::text AS kind, 1 AS urgency, 'crit'::text AS severity, h.run_id, s.route_id, s.stop_id,
       h.order_id, NULL::uuid AS flag_id, cd.received_at AS since,
       ou.name || ': ' || h.confirmation_no || ' not delivered' AS detail
FROM order_header h JOIN current_delivery cd ON cd.order_id = h.order_id AND cd.outcome = 'not_delivered'
JOIN stop s ON s.stop_id = cd.stop_id JOIN outlet ou ON ou.outlet_id = h.outlet_id
WHERE h.status = 'not_delivered' AND can_see_order(h.order_id)
UNION ALL
SELECT 'driver_reported', 2, 'crit', (SELECT p.run_id FROM plan p JOIN route r ON r.plan_id = p.plan_id WHERE r.route_id = f.route_id),
       f.route_id, f.stop_id, f.order_id, f.flag_id, f.received_at,
       ve.code || ': ' || rc.label
FROM flag f JOIN route r ON r.route_id = f.route_id JOIN vehicle ve ON ve.vehicle_id = r.vehicle_id
JOIN reason_code rc ON rc.scope = f.scope AND rc.code = f.type
WHERE f.source = 'driver' AND f.state <> 'resolved' AND can_see_route(f.route_id)
UNION ALL
SELECT 'short_loaded', 3, 'warn', (SELECT p.run_id FROM plan p WHERE p.plan_id = l.plan_id), l.route_id, NULL, NULL, NULL,
       (SELECT max(device_time) FROM route_release rr WHERE rr.route_id = l.route_id AND rr.kind = 'release'),
       l.vehicle_code || ' left ' || x.n || ' line(s) short'
FROM live l CROSS JOIN LATERAL (
  SELECT count(*) AS n FROM stop_order so JOIN stop s ON s.stop_id = so.stop_id JOIN order_line ol ON ol.order_id = so.order_id
  JOIN LATERAL (SELECT qty_loaded FROM load_confirmation c WHERE c.order_id = ol.order_id AND c.line_no = ol.line_no
                ORDER BY c.device_time DESC LIMIT 1) lc ON lc.qty_loaded < ol.qty
  WHERE s.route_id = l.route_id AND so.removed_at IS NULL) x
WHERE x.n > 0 AND l.state = 'on_the_way'
UNION ALL
SELECT 'no_signal', 4, 'warn', (SELECT p.run_id FROM plan p WHERE p.plan_id = l.plan_id), l.route_id, NULL, NULL, NULL,
       dev.last_seen_at,
       l.vehicle_code || ' silent since ' || to_char(dev.last_seen_at AT TIME ZONE 'Asia/Colombo', 'HH24:MI')
FROM live l JOIN dev ON dev.user_id = l.driver_id
WHERE l.state = 'on_the_way' AND dev.last_seen_at < now() - make_interval(mins => setting_int('no_signal_minutes'))
UNION ALL
SELECT 'late', 5, 'warn', (SELECT p.run_id FROM plan p WHERE p.plan_id = l.plan_id), l.route_id, s.stop_id, NULL, NULL,
       s.planned_arrival,
       ou.name || ' is ' || floor(extract(epoch FROM now() - s.planned_arrival) / 60)::int || ' min behind plan'
FROM live l JOIN stop s ON s.route_id = l.route_id AND s.removed_at IS NULL JOIN outlet ou ON ou.outlet_id = s.outlet_id
LEFT JOIN dev ON dev.user_id = l.driver_id
WHERE l.state = 'on_the_way'
  AND s.planned_arrival + make_interval(mins => setting_int('late_grace_minutes')) < now()
  AND NOT EXISTS (SELECT 1 FROM stop_arrival a WHERE a.stop_id = s.stop_id)
  AND NOT EXISTS (SELECT 1 FROM stop_order so JOIN delivery d ON d.order_id = so.order_id WHERE so.stop_id = s.stop_id AND so.removed_at IS NULL)
  AND (dev.last_seen_at IS NULL OR dev.last_seen_at >= now() - make_interval(mins => setting_int('no_signal_minutes')))
UNION ALL
SELECT 'loader_flag', 6, 'warn', (SELECT p.run_id FROM plan p JOIN route r ON r.plan_id = p.plan_id WHERE r.route_id = f.route_id),
       f.route_id, f.stop_id, f.order_id, f.flag_id, f.received_at,
       ve.code || ': ' || rc.label || COALESCE(' x' || f.qty, '')
FROM flag f JOIN route r ON r.route_id = f.route_id JOIN vehicle ve ON ve.vehicle_id = r.vehicle_id
JOIN reason_code rc ON rc.scope = f.scope AND rc.code = f.type
WHERE f.source = 'loader' AND f.state = 'open' AND can_see_route(f.route_id)
UNION ALL
SELECT 'plan_conflict', 7, 'warn', (SELECT run_id FROM plan WHERE plan_id = c.plan_id), NULL, c.stop_id, c.order_id, NULL, c.created_at, c.detail
FROM plan_conflict c
WHERE c.acknowledged_at IS NULL
  AND EXISTS (SELECT 1 FROM app_user u WHERE u.user_id = me() AND (u.role = 'admin' OR u.all_depots OR u.depot_id = (SELECT depot_id FROM plan WHERE plan_id = c.plan_id)))
UNION ALL
SELECT 'instruction_unseen', 8, 'info', NULL, i.route_id, i.stop_id, NULL, NULL, i.sent_at,
       ve.code || ': instruction ' || i.type || ' not seen yet'
FROM instruction i JOIN route r ON r.route_id = i.route_id JOIN vehicle ve ON ve.vehicle_id = r.vehicle_id
WHERE i.state IN ('sent', 'on_phone') AND i.sent_at < now() - interval '10 minutes' AND can_see_route(i.route_id)
UNION ALL
SELECT 'rejected_event', 9, 'warn', NULL, e.route_id, e.stop_id, NULL, NULL, e.received_at,
       'Device event ' || e.type || ' rejected: ' || e.reject_reason
FROM device_event e
WHERE e.state = 'rejected' AND e.received_at > now() - interval '24 hours'
  AND EXISTS (SELECT 1 FROM app_user u WHERE u.user_id = me() AND u.role IN ('dispatcher', 'admin'));

CREATE OR REPLACE VIEW run_progress AS
SELECT ru.run_id, ru.depot_id, ru.service_date, ru.state,
       (SELECT count(*) FROM route r JOIN plan p ON p.plan_id = r.plan_id WHERE p.run_id = ru.run_id AND r.state <> 'cancelled' AND r.seq = 1) AS routes_total,
       (SELECT count(*) FROM route r JOIN plan p ON p.plan_id = r.plan_id WHERE p.run_id = ru.run_id AND r.departed_at IS NOT NULL) AS routes_departed,
       (SELECT count(DISTINCT so.order_id) FROM stop_order so JOIN plan p ON p.plan_id = so.plan_id WHERE p.run_id = ru.run_id AND so.removed_at IS NULL) AS orders_total,
       (SELECT count(*) FROM order_header h WHERE h.run_id = ru.run_id AND h.status IN ('delivered','delivered_in_part','received')) AS orders_delivered,
       (SELECT count(DISTINCT so.order_id) FROM stop_order so JOIN stop s ON s.stop_id = so.stop_id JOIN plan p ON p.plan_id = so.plan_id
         WHERE p.run_id = ru.run_id AND so.removed_at IS NULL AND s.planned_arrival <= now()) AS orders_due_by_now,
       (SELECT count(DISTINCT so.order_id) FROM stop_order so JOIN stop s ON s.stop_id = so.stop_id JOIN plan p ON p.plan_id = so.plan_id
         JOIN order_header h ON h.order_id = so.order_id
         WHERE p.run_id = ru.run_id AND so.removed_at IS NULL AND s.deliver_by IS NOT NULL
           AND h.status NOT IN ('delivered','delivered_in_part','received')
           AND (s.planned_arrival > s.deliver_by OR s.deliver_by < now() + interval '30 minutes' AND NOT EXISTS (SELECT 1 FROM stop_arrival a WHERE a.stop_id = s.stop_id))) AS fresh_at_risk,
       (SELECT count(*) FROM monitor_exceptions m WHERE m.run_id = ru.run_id) AS needs_attention,
       data_through() AS data_through
FROM run ru
WHERE EXISTS (SELECT 1 FROM app_user u WHERE u.user_id = me() AND (u.role = 'admin' OR u.all_depots OR u.depot_id = ru.depot_id));

CREATE OR REPLACE VIEW fuel_week AS
SELECT ve.vehicle_id, ve.code, w.week_start, fuel_quota_for(ve.vehicle_id, w.week_start) AS quota_l,
       fuel_used_week(ve.vehicle_id, w.week_start) AS used_l,
       fuel_quota_for(ve.vehicle_id, w.week_start) - fuel_used_week(ve.vehicle_id, w.week_start) AS left_l
FROM vehicle ve CROSS JOIN LATERAL (SELECT week_start(current_date) AS week_start) w
WHERE ve.active AND EXISTS (SELECT 1 FROM app_user u WHERE u.user_id = me() AND (u.role = 'admin' OR u.all_depots OR u.depot_id = ve.depot_id));

CREATE OR REPLACE VIEW road_disruptions AS
SELECT rc.district_id, d.name AS district, d.depot_id, rc.day, rc.disruption_index
FROM road_condition rc JOIN district d ON d.district_id = rc.district_id
WHERE rc.day >= current_date AND rc.disruption_index <= setting_int('road_warn_at_or_below')
  AND EXISTS (SELECT 1 FROM app_user u WHERE u.user_id = me() AND (u.role = 'admin' OR u.all_depots OR u.depot_id = d.depot_id));

-- Writes: a planning-office dispatcher may act on either depot (moving a failed delivery to the next
-- run from the combined Live view). The API still opens and changes a plan only for the depot the
-- dispatcher is working on, so planning stays one depot at a time.
CREATE OR REPLACE FUNCTION assert_depot(p_user integer, p_depot smallint) RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = wp, pg_temp AS $$
DECLARE u wp.app_user%ROWTYPE;
BEGIN
  SELECT * INTO u FROM wp.app_user WHERE user_id = p_user AND active;
  IF NOT FOUND OR (u.role <> 'admin' AND NOT (u.role = 'dispatcher' AND u.all_depots) AND u.depot_id IS DISTINCT FROM p_depot) THEN
    RAISE EXCEPTION 'WP012: user % does not work at depot %', p_user, p_depot USING ERRCODE = 'WP012';
  END IF;
END $$;
