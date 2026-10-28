-- 010 · Live, clearer: one clock, plain alert texts, a short load that has been answered leaves the list.
-- Safe to run again.
SET search_path = wp, public;

-- ----- one clock ---------------------------------------------------------------------------------------
-- Phone contact and the dispatcher's instructions were stamped on real time while the plan ran on the demo
-- clock, so No signal and "instruction not seen" could never be shown by moving the clock, and alerts showed
-- 17:35 on a 07:15 morning. Stamp them on app_now(): with the demo clock off (offset 0, every real
-- deployment) that is exactly now(), so nothing changes outside a demo.
CREATE OR REPLACE FUNCTION device_contact_on_app_clock() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.last_seen_at = now() THEN NEW.last_seen_at := wp.app_now(); END IF;
  IF NEW.last_sync_at = now() THEN NEW.last_sync_at := wp.app_now(); END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS device_contact_on_app_clock ON device;
CREATE TRIGGER device_contact_on_app_clock BEFORE INSERT OR UPDATE OF last_seen_at, last_sync_at ON device
  FOR EACH ROW EXECUTE FUNCTION device_contact_on_app_clock();

CREATE OR REPLACE FUNCTION instruction_sent_on_app_clock() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.sent_at = now() THEN NEW.sent_at := wp.app_now(); END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS instruction_sent_on_app_clock ON instruction;
CREATE TRIGGER instruction_sent_on_app_clock BEFORE INSERT ON instruction
  FOR EACH ROW EXECUTE FUNCTION instruction_sent_on_app_clock();

-- ----- Needs attention -----------------------------------------------------------------------------------
-- As in 007, with: each alert's time is when it happened on the phone or tablet (device_time); a short load
-- shows only while nobody has dealt with it (no open loader flag already says it, no dispatcher answer on the
-- trip); no signal and unseen instructions on the same clock as the plan; texts a dispatcher can read.
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
       h.order_id, NULL::uuid AS flag_id, cd.device_time AS since,
       ou.name || ': ' || h.confirmation_no || ' not delivered' AS detail
FROM order_header h JOIN current_delivery cd ON cd.order_id = h.order_id AND cd.outcome = 'not_delivered'
JOIN stop s ON s.stop_id = cd.stop_id JOIN outlet ou ON ou.outlet_id = h.outlet_id
WHERE h.status = 'not_delivered' AND can_see_order(h.order_id)
UNION ALL
SELECT 'driver_reported', 2, 'crit', (SELECT p.run_id FROM plan p JOIN route r ON r.plan_id = p.plan_id WHERE r.route_id = f.route_id),
       f.route_id, f.stop_id, f.order_id, f.flag_id, COALESCE(f.device_time, f.received_at),
       ve.code || ': ' || rc.label || COALESCE(' · “' || NULLIF(btrim(f.note), '') || '”', '')
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
  AND NOT EXISTS (SELECT 1 FROM flag f WHERE f.route_id = l.route_id AND f.source = 'loader' AND f.state = 'open')
  AND NOT EXISTS (SELECT 1 FROM instruction i WHERE i.route_id = l.route_id AND i.type IN ('proceed_short', 'hold'))
UNION ALL
-- A trip of a sent plan still at the depot after its departure time (past the grace), loaded or not.
SELECT 'not_left', 3, 'warn', p.run_id, r.route_id, NULL, NULL, NULL, r.depart_at,
       ve.code || ' hasn''t left: due ' || to_char(r.depart_at AT TIME ZONE 'Asia/Colombo', 'HH24:MI') || ', '
       || CASE r.state WHEN 'planned' THEN 'loading not started' WHEN 'loading' THEN 'still loading'
                       ELSE 'loaded, the driver hasn''t started' END
FROM route r JOIN plan p ON p.plan_id = r.plan_id JOIN vehicle ve ON ve.vehicle_id = r.vehicle_id
WHERE p.state = 'released' AND r.state IN ('planned', 'loading', 'loaded') AND r.departed_at IS NULL
  AND r.depart_at + make_interval(mins => setting_int('late_grace_minutes')) < wp.app_now()
  AND (wp.app_now() AT TIME ZONE 'Asia/Colombo')::date = p.service_date
  AND can_see_route(r.route_id)
UNION ALL
SELECT 'no_signal', 4, 'warn', (SELECT p.run_id FROM plan p WHERE p.plan_id = l.plan_id), l.route_id, NULL, NULL, NULL,
       dev.last_seen_at,
       l.vehicle_code || ' silent since ' || to_char(dev.last_seen_at AT TIME ZONE 'Asia/Colombo', 'HH24:MI')
FROM live l JOIN dev ON dev.user_id = l.driver_id
WHERE l.state = 'on_the_way' AND dev.last_seen_at < wp.app_now() - make_interval(mins => setting_int('no_signal_minutes'))
UNION ALL
SELECT 'late', 5, 'warn', (SELECT p.run_id FROM plan p WHERE p.plan_id = l.plan_id), l.route_id, s.stop_id, NULL, NULL,
       s.planned_arrival,
       ou.name || ' is ' || floor(extract(epoch FROM wp.app_now() - s.planned_arrival) / 60)::int || ' min behind plan'
FROM live l JOIN stop s ON s.route_id = l.route_id AND s.removed_at IS NULL JOIN outlet ou ON ou.outlet_id = s.outlet_id
LEFT JOIN dev ON dev.user_id = l.driver_id
WHERE l.state = 'on_the_way'
  AND s.planned_arrival + make_interval(mins => setting_int('late_grace_minutes')) < wp.app_now()
  AND NOT EXISTS (SELECT 1 FROM stop_arrival a WHERE a.stop_id = s.stop_id)
  AND NOT EXISTS (SELECT 1 FROM stop_order so JOIN delivery d ON d.order_id = so.order_id WHERE so.stop_id = s.stop_id AND so.removed_at IS NULL)
  AND (dev.last_seen_at IS NULL OR dev.last_seen_at >= wp.app_now() - make_interval(mins => setting_int('no_signal_minutes')))
UNION ALL
SELECT 'loader_flag', 6, 'warn', (SELECT p.run_id FROM plan p JOIN route r ON r.plan_id = p.plan_id WHERE r.route_id = f.route_id),
       f.route_id, f.stop_id, f.order_id, f.flag_id, COALESCE(f.device_time, f.received_at),
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
       ve.code || ': the driver hasn''t opened your '
       || CASE i.type WHEN 'proceed_short' THEN '“send partial”' WHEN 'hold' THEN '“hold the vehicle”'
                      WHEN 'skip_stop' THEN '“skip the stop”' WHEN 'reorder' THEN 'new stop order'
                      WHEN 'reassign' THEN 'reassignment' ELSE 'message' END
       || ' (sent ' || to_char(i.sent_at AT TIME ZONE 'Asia/Colombo', 'HH24:MI') || ')'
FROM instruction i JOIN route r ON r.route_id = i.route_id JOIN vehicle ve ON ve.vehicle_id = r.vehicle_id
WHERE i.state IN ('sent', 'on_phone') AND i.sent_at < wp.app_now() - interval '10 minutes' AND can_see_route(i.route_id)
UNION ALL
SELECT 'rejected_event', 9, 'warn', NULL, e.route_id, e.stop_id, NULL, NULL, e.device_time,
       COALESCE(ve.code || ': a ', 'A ')
       || CASE e.type WHEN 'delivery' THEN 'delivery' WHEN 'arrive' THEN 'arrival' WHEN 'depart' THEN 'departure'
                      WHEN 'flag' THEN 'flag' WHEN 'load_confirm' THEN 'load check' WHEN 'route_release' THEN 'release'
                      ELSE replace(e.type, '_', ' ') END
       || ' record from the ' || CASE WHEN e.type IN ('load_confirm', 'route_release') THEN 'tablet' ELSE 'phone' END
       || ' was refused: ' || regexp_replace(e.reject_reason, '^WP\d+:\s*', '')
FROM device_event e LEFT JOIN route r ON r.route_id = e.route_id LEFT JOIN vehicle ve ON ve.vehicle_id = r.vehicle_id
WHERE e.state = 'rejected' AND e.received_at > now() - interval '24 hours'
  AND EXISTS (SELECT 1 FROM app_user u WHERE u.user_id = me() AND u.role IN ('dispatcher', 'admin'));

-- No signal on the trip list, on the same clock.
CREATE OR REPLACE VIEW fleet_status AS
SELECT rb.route_id, rb.run_id, rb.vehicle_code, rb.route_seq, rb.state, rb.driver_name, rb.depart_at,
       (SELECT count(*) FROM stop s WHERE s.route_id = rb.route_id AND s.removed_at IS NULL) AS stops_total,
       (SELECT count(*) FROM stop s WHERE s.route_id = rb.route_id AND s.removed_at IS NULL
          AND EXISTS (SELECT 1 FROM stop_order so JOIN delivery d ON d.order_id = so.order_id WHERE so.stop_id = s.stop_id AND so.removed_at IS NULL)) AS stops_done,
       nx.stop_id AS next_stop_id, nx.outlet_name AS next_outlet, nx.planned_arrival AS next_planned,
       dev.last_seen_at,
       (dev.last_seen_at IS NULL OR dev.last_seen_at < wp.app_now() - make_interval(mins => setting_int('no_signal_minutes'))) AND rb.state = 'on_the_way' AS no_signal,
       (SELECT count(*) FROM monitor_exceptions m WHERE m.route_id = rb.route_id) AS exception_count
FROM route_board rb
LEFT JOIN LATERAL (
   SELECT s.stop_id, ou.name AS outlet_name, s.planned_arrival FROM stop s JOIN outlet ou ON ou.outlet_id = s.outlet_id
   WHERE s.route_id = rb.route_id AND s.removed_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM stop_order so JOIN delivery d ON d.order_id = so.order_id WHERE so.stop_id = s.stop_id AND so.removed_at IS NULL)
   ORDER BY s.seq LIMIT 1) nx ON true
LEFT JOIN LATERAL (SELECT d.last_seen_at FROM device d WHERE d.user_id = rb.driver_id AND d.active
                   ORDER BY d.last_seen_at DESC NULLS LAST LIMIT 1) dev ON true;

-- The loader's flag time: when the tablet recorded it, on the same clock as the departure check.
CREATE OR REPLACE VIEW load_list AS
SELECT s.route_id, s.stop_id, s.seq AS stop_seq, dense_rank() OVER (PARTITION BY s.route_id ORDER BY s.seq DESC) AS load_order,
       ou.name AS outlet_name, ou.unload, s.deliver_by,
       h.order_id, h.confirmation_no, l.line_no, pr.sku, pr.name AS product_name, pr.unit, l.qty AS ordered_qty,
       pr.temp AS line_temp, pr.fragile, pr.hanging,
       lc.qty_loaded, lc.plan_version AS confirmed_in_version,
       CASE WHEN lc.confirmation_id IS NULL THEN 'to_load'
            WHEN lc.qty_loaded < l.qty THEN 'short' ELSE 'loaded' END AS line_state,
       f.flag_id, f.type AS flag_type, f.state AS flag_state, COALESCE(f.device_time, f.received_at) AS flagged_at,
       (SELECT i.text FROM instruction i WHERE i.flag_id = f.flag_id ORDER BY i.sent_at DESC LIMIT 1) AS dispatcher_reply
FROM stop s
JOIN stop_order so ON so.stop_id = s.stop_id AND so.removed_at IS NULL
JOIN order_header h ON h.order_id = so.order_id
JOIN outlet ou ON ou.outlet_id = s.outlet_id
JOIN order_line l ON l.order_id = h.order_id
JOIN product pr ON pr.product_id = l.product_id
LEFT JOIN LATERAL (SELECT * FROM load_confirmation x WHERE x.order_id = l.order_id AND x.line_no = l.line_no
                   ORDER BY x.device_time DESC, x.received_at DESC LIMIT 1) lc ON true
LEFT JOIN LATERAL (SELECT * FROM flag fx WHERE fx.order_id = l.order_id AND fx.line_no = l.line_no
                   ORDER BY fx.received_at DESC LIMIT 1) f ON true
WHERE s.removed_at IS NULL AND can_see_route(s.route_id);
