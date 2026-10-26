-- 007 · Finals: demo clock, demand forecast, a week of history for the demo. Safe to run again.
SET search_path = wp, public;

-- ----- demo clock -----------------------------------------------------------------------------------
-- The demo can run "on the delivery morning": an offset added to the clock wherever the plan is compared
-- with the present (late stops, due by now, Fresh at risk) and on the times phones record. Records the
-- server stamps itself (received, last signal) and ordering cutoffs stay on real time. Zero = real time.
INSERT INTO setting(key, value, note) VALUES
  ('demo_clock_offset_seconds', '0', 'Demo only: seconds added to the clock for plan-versus-now comparisons')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION app_now() RETURNS timestamptz LANGUAGE sql STABLE AS $$
  SELECT now() + make_interval(secs => COALESCE(wp.setting_int('demo_clock_offset_seconds'), 0))
$$;
GRANT EXECUTE ON FUNCTION app_now() TO waypoint_app;

-- Automatic 16:00 cutoff: the API calls this on a timer.
GRANT EXECUTE ON FUNCTION cutoff_sweep() TO waypoint_app;

-- ----- demand forecast (the Datathon Task 2A submission, loaded by backend/scripts/load_forecast.py) ---
CREATE TABLE IF NOT EXISTS demand_forecast (
  depot_id     smallint NOT NULL REFERENCES depot,
  brand_id     smallint NOT NULL REFERENCES brand,
  iso_year     smallint NOT NULL,
  iso_week     smallint NOT NULL CHECK (iso_week BETWEEN 1 AND 53),
  week_start   date NOT NULL,
  total_m3     numeric(9,1) NOT NULL CHECK (total_m3 >= 0),
  chilled_m3   numeric(9,1) NOT NULL CHECK (chilled_m3 >= 0),
  source       text NOT NULL,
  loaded_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (depot_id, brand_id, iso_year, iso_week)
);
GRANT SELECT ON demand_forecast TO waypoint_app;

-- ----- Live views on the demo clock ------------------------------------------------------------------
-- As in 005; only the comparisons of the plan with the present use app_now(). Device contact (no signal)
-- and server-stamped times stay on now().
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
       ou.name || ' is ' || floor(extract(epoch FROM wp.app_now() - s.planned_arrival) / 60)::int || ' min behind plan'
FROM live l JOIN stop s ON s.route_id = l.route_id AND s.removed_at IS NULL JOIN outlet ou ON ou.outlet_id = s.outlet_id
LEFT JOIN dev ON dev.user_id = l.driver_id
WHERE l.state = 'on_the_way'
  AND s.planned_arrival + make_interval(mins => setting_int('late_grace_minutes')) < wp.app_now()
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
         WHERE p.run_id = ru.run_id AND so.removed_at IS NULL AND s.planned_arrival <= wp.app_now()) AS orders_due_by_now,
       (SELECT count(DISTINCT so.order_id) FROM stop_order so JOIN stop s ON s.stop_id = so.stop_id JOIN plan p ON p.plan_id = so.plan_id
         JOIN order_header h ON h.order_id = so.order_id
         WHERE p.run_id = ru.run_id AND so.removed_at IS NULL AND s.deliver_by IS NOT NULL
           AND h.status NOT IN ('delivered','delivered_in_part','received')
           AND (s.planned_arrival > s.deliver_by OR s.deliver_by < wp.app_now() + interval '30 minutes' AND NOT EXISTS (SELECT 1 FROM stop_arrival a WHERE a.stop_id = s.stop_id))) AS fresh_at_risk,
       (SELECT count(*) FROM monitor_exceptions m WHERE m.run_id = ru.run_id) AS needs_attention,
       data_through() AS data_through
FROM run ru
WHERE EXISTS (SELECT 1 FROM app_user u WHERE u.user_id = me() AND (u.role = 'admin' OR u.all_depots OR u.depot_id = ru.depot_id));

-- ----- a week of history for the demo -----------------------------------------------------------------
-- demo_reset() places the demo day's orders, then calls this. The same outlets ordered on each of the
-- p_days working days before today, delivered by named drivers on released plans, and one earlier skip per
-- depot (OUT078 chilled at Kandy, OUT074 chilled at Peliyagoda), delivered the next day. So the history
-- strip, Records, the skip pill and the usual signers show real content in the demo. History trips record
-- no fuel: this week's quota (and the engine's fuel pacing) is not changed by made-up trips.
CREATE OR REPLACE FUNCTION seed_demo_history(p_days integer DEFAULT 5) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = wp, public, pg_temp AS $$
DECLARE
  days date[] := '{}'; d date; i integer; dep record; rid integer; pid integer; g record; veh record; tp record;
  route_id_ integer; stop_id_ integer; oc record; oid bigint; dev uuid; del uuid; ev uuid; tt timestamptz; depart timestamptz;
  dispatcher integer; mgr integer; drv integer; n integer := 0; seqn bigint := 0; skip_day date; stopno integer;
  nstops integer; factor numeric; skip_outlet text; tot_kg numeric; tot_m3 numeric; chosen integer[];
  signers text[] := ARRAY['Nimal Perera', 'Chathura Silva', 'Dilini Jayawardena', 'Mohamed Rizan', 'Kumari Herath',
                          'Lasantha Fernando', 'Ruwani Gunasekara', 'Thilina Bandara', 'Ayesha Nazeer', 'Sunil Rathnayake'];
  tables text[] := ARRAY['order_header', 'order_line', 'run', 'plan', 'route', 'stop', 'stop_order', 'device_event',
                         'delivery', 'delivery_line', 'deferral', 'store_receipt'];
  t text;
BEGIN
  SELECT user_id INTO dispatcher FROM wp.app_user WHERE email = 'dispatcher@example.com';
  d := (now() AT TIME ZONE 'Asia/Colombo')::date - 1;
  WHILE COALESCE(array_length(days, 1), 0) < p_days LOOP
    IF wp.is_working_day(d) THEN days := d || days; END IF;   -- oldest first
    d := d - 1;
  END LOOP;
  skip_day := days[GREATEST(1, p_days - 2)];                  -- three working days ago

  -- Finished days are written directly, as the record of what happened; the workflow guards (cutoff,
  -- status steps, locked lines) are for live work and would refuse a day in the past.
  SET CONSTRAINTS ALL IMMEDIATE;   -- run the demo day's deferred checks now, before the tables are altered
  FOREACH t IN ARRAY tables LOOP EXECUTE format('ALTER TABLE wp.%I DISABLE TRIGGER USER', t); END LOOP;

  CREATE TEMP TABLE IF NOT EXISTS hist_template (order_id bigint, outlet_id integer, brand_id smallint, temp wp.temp_class,
    weight_kg numeric, volume_m3 numeric, depot_id smallint, district_id smallint, van_only boolean,
    unload wp.unload_type, code text) ON COMMIT DROP;
  TRUNCATE hist_template;
  INSERT INTO hist_template
  SELECT h.order_id, h.outlet_id, h.brand_id, h.temp, h.weight_kg, h.volume_m3, ou.depot_id, ou.district_id,
         ou.van_only, ou.unload, ou.code
  FROM wp.order_header h JOIN wp.outlet ou ON ou.outlet_id = h.outlet_id;
  CREATE TEMP TABLE IF NOT EXISTS hist_day (order_id bigint, outlet_id integer, code text, brand_id smallint, district_id smallint,
                              cold boolean, van_only boolean, unload wp.unload_type, moved_from date,
                              kg numeric, m3 numeric, route_id integer) ON COMMIT DROP;
  CREATE TEMP TABLE IF NOT EXISTS hist_trips (vehicle_id integer PRIMARY KEY, trips integer, free_at timestamptz) ON COMMIT DROP;

  FOR i IN 1 .. array_length(days, 1) LOOP
    d := days[i];
    FOR dep IN SELECT depot_id, name FROM wp.depot ORDER BY depot_id LOOP
      skip_outlet := CASE dep.name WHEN 'Kandy' THEN 'OUT078' ELSE 'OUT074' END;
      TRUNCATE hist_day, hist_trips;
      INSERT INTO wp.run(depot_id, service_date, cutoff_at, state)
      VALUES (dep.depot_id, d, wp.run_cutoff(dep.depot_id, d), 'complete') RETURNING run_id INTO rid;
      INSERT INTO wp.plan(run_id, depot_id, service_date, state, version, dirty, edited_at, created_by, created_at)
      VALUES (rid, dep.depot_id, d, 'released', 1, false, ((d - 1) + time '17:20') AT TIME ZONE 'Asia/Colombo',
              dispatcher, ((d - 1) + time '16:05') AT TIME ZONE 'Asia/Colombo')
      RETURNING plan_id INTO pid;

      -- Orders: each template outlet orders again; the skipped chilled order moves to the next day.
      FOR tp IN SELECT * FROM hist_template WHERE depot_id = dep.depot_id ORDER BY code, temp LOOP
        CONTINUE WHEN d = skip_day AND tp.code = skip_outlet AND tp.temp = 'chilled';
        FOR oc IN SELECT x.moved_from FROM (VALUES (NULL::date), (skip_day)) x(moved_from)
                  WHERE x.moved_from IS NULL
                     OR (i > 1 AND days[i - 1] = skip_day AND tp.code = skip_outlet AND tp.temp = 'chilled') LOOP
          n := n + 1;
          factor := 0.85 + (abs(hashtext(tp.code || tp.temp::text || COALESCE(oc.moved_from, d)::text)) % 30) / 100.0;
          INSERT INTO wp.order_header(confirmation_no, client_request_id, outlet_id, brand_id, temp, delivery_date, run_id,
                                      status, source, placed_by, placed_at, original_delivery_date, deferral_count,
                                      weight_kg, volume_m3, updated_at)
          VALUES (format('WP-%s-H%s', to_char(COALESCE(oc.moved_from, d) - 1, 'YYMMDD'), lpad(n::text, 5, '0')),
                  gen_random_uuid(), tp.outlet_id, tp.brand_id, tp.temp, d, rid, 'received', 'store',
                  COALESCE((SELECT user_id FROM wp.app_user WHERE outlet_id = tp.outlet_id ORDER BY user_id LIMIT 1), dispatcher),
                  ((COALESCE(oc.moved_from, d) - 1) + time '09:30' + (n % 360) * interval '1 minute') AT TIME ZONE 'Asia/Colombo',
                  COALESCE(oc.moved_from, d), CASE WHEN oc.moved_from IS NULL THEN 0 ELSE 1 END,
                  round(tp.weight_kg * factor, 2), round(tp.volume_m3 * factor, 3), now())
          RETURNING order_id INTO oid;
          INSERT INTO wp.order_line(order_id, line_no, brand_id, temp, product_id, qty)
          SELECT oid, l.line_no, l.brand_id, l.temp, l.product_id, GREATEST(1, round(l.qty * factor))
          FROM wp.order_line l WHERE l.order_id = tp.order_id;
          INSERT INTO hist_day VALUES (oid, tp.outlet_id, tp.code, tp.brand_id, tp.district_id, tp.temp = 'chilled',
                                       tp.van_only, tp.unload, oc.moved_from, round(tp.weight_kg * factor, 2),
                                       round(tp.volume_m3 * factor, 3), NULL);
          IF oc.moved_from IS NOT NULL THEN
            INSERT INTO wp.deferral(order_id, outlet_id, temp, kind, from_date, to_date, reason_code, scope, consecutive_skip,
                                    decided_by, decided_at)
            VALUES (oid, tp.outlet_id, tp.temp, 'deferred', oc.moved_from, d,
                    CASE dep.name WHEN 'Kandy' THEN 'van_only_full' ELSE 'no_refrigerated' END, 'deferral', false,
                    dispatcher, ((oc.moved_from - 1) + time '17:40') AT TIME ZONE 'Asia/Colombo');
          END IF;
        END LOOP;
      END LOOP;

      -- Trips: brand, district, temperature and access travel together; each trip on the right kind of vehicle,
      -- within its weight and volume (a large group is split over several trips), two trips per vehicle at most.
      FOR g IN SELECT brand_id, district_id, cold, van_only FROM hist_day GROUP BY brand_id, district_id, cold, van_only
               ORDER BY van_only DESC, cold DESC, brand_id, district_id LOOP
        LOOP
          EXIT WHEN NOT EXISTS (SELECT 1 FROM hist_day h WHERE h.brand_id = g.brand_id AND h.district_id = g.district_id
                                AND h.cold = g.cold AND h.van_only = g.van_only AND h.route_id IS NULL);
          SELECT v.vehicle_id, v.max_weight_kg, v.max_volume_m3, COALESCE(ht.trips, 0) AS trips, ht.free_at INTO veh
          FROM wp.vehicle v JOIN wp.vehicle_class c USING (class_id) LEFT JOIN hist_trips ht USING (vehicle_id)
          WHERE v.depot_id = dep.depot_id AND COALESCE(ht.trips, 0) < 2
            AND (NOT g.cold OR c.carries_chilled) AND (NOT g.van_only OR c.is_van)
          ORDER BY (c.carries_chilled <> g.cold), (c.is_van <> g.van_only), COALESCE(ht.trips, 0), v.vehicle_id
          LIMIT 1;
          EXIT WHEN NOT FOUND;
          tot_kg := 0; tot_m3 := 0; chosen := '{}';
          FOR oc IN SELECT h.outlet_id, sum(h.kg) AS kg, sum(h.m3) AS m3 FROM hist_day h
                    WHERE h.brand_id = g.brand_id AND h.district_id = g.district_id AND h.cold = g.cold
                      AND h.van_only = g.van_only AND h.route_id IS NULL
                    GROUP BY h.outlet_id, h.code ORDER BY h.code LOOP
            EXIT WHEN cardinality(chosen) > 0 AND (tot_kg + oc.kg > veh.max_weight_kg OR tot_m3 + oc.m3 > veh.max_volume_m3);
            chosen := chosen || oc.outlet_id; tot_kg := tot_kg + oc.kg; tot_m3 := tot_m3 + oc.m3;
          END LOOP;
          nstops := cardinality(chosen);
          depart := GREATEST(((d + CASE WHEN g.brand_id = 1 THEN time '03:30' ELSE time '09:00' END) AT TIME ZONE 'Asia/Colombo'),
                             COALESCE(veh.free_at + interval '10 minutes', '-infinity'));
          SELECT user_id INTO drv FROM wp.app_user WHERE vehicle_id = veh.vehicle_id AND active ORDER BY user_id LIMIT 1;
          INSERT INTO wp.route(plan_id, depot_id, brand_id, district_id, vehicle_id, driver_id, seq, depart_at, return_at,
                               trip_minutes, state, departed_at)
          VALUES (pid, dep.depot_id, g.brand_id, g.district_id, veh.vehicle_id, drv, veh.trips + 1, depart,
                  depart + make_interval(mins => 30 + 25 * nstops), 30 + 25 * nstops, 'complete', depart + interval '3 minutes')
          RETURNING route_id INTO route_id_;
          INSERT INTO hist_trips VALUES (veh.vehicle_id, veh.trips + 1, depart + make_interval(mins => 30 + 25 * nstops))
          ON CONFLICT (vehicle_id) DO UPDATE SET trips = EXCLUDED.trips, free_at = EXCLUDED.free_at;
          UPDATE hist_day h SET route_id = route_id_
          WHERE h.brand_id = g.brand_id AND h.district_id = g.district_id AND h.cold = g.cold AND h.van_only = g.van_only
            AND h.route_id IS NULL AND h.outlet_id = ANY (chosen);
          dev := NULL;
          IF drv IS NOT NULL THEN
            SELECT device_id INTO dev FROM wp.device WHERE user_id = drv AND kind = 'driver_phone' ORDER BY device_id LIMIT 1;
            IF dev IS NULL THEN
              dev := gen_random_uuid();
              INSERT INTO wp.device(device_id, kind, label, depot_id, user_id) VALUES (dev, 'driver_phone', 'Driver phone', dep.depot_id, drv);
            END IF;
          END IF;

          stopno := 0;
          FOR oc IN SELECT DISTINCT h.outlet_id, h.code, h.unload FROM hist_day h WHERE h.route_id = route_id_ ORDER BY h.code LOOP
            stopno := stopno + 1;
            INSERT INTO wp.stop(route_id, plan_id, seq, outlet_id, planned_arrival, service_minutes)
            VALUES (route_id_, pid, stopno, oc.outlet_id, depart + make_interval(mins => 20 + 25 * (stopno - 1)), 15)
            RETURNING stop_id INTO stop_id_;
            -- Arrived a little early or late, as real days go; handed over after about 8 minutes.
            tt := depart + make_interval(mins => 28 + 25 * (stopno - 1) + (abs(hashtext(oc.code || d::text)) % 15) - 5);
            SELECT user_id INTO mgr FROM wp.app_user WHERE outlet_id = oc.outlet_id AND role = 'store_manager' ORDER BY user_id LIMIT 1;
            FOR oid IN SELECT h.order_id FROM hist_day h WHERE h.route_id = route_id_ AND h.outlet_id = oc.outlet_id LOOP
              INSERT INTO wp.stop_order(plan_id, service_date, stop_id, outlet_id, order_id, assigned_by, assigned_at)
              VALUES (pid, d, stop_id_, oc.outlet_id, oid, dispatcher, ((d - 1) + time '17:10') AT TIME ZONE 'Asia/Colombo');
              CONTINUE WHEN drv IS NULL;
              seqn := seqn + 1;
              del := gen_random_uuid();
              ev := gen_random_uuid();
              INSERT INTO wp.device_event(event_id, device_id, device_seq, user_id, type, route_id, stop_id, payload,
                                          device_time, received_at, state, applied_at)
              VALUES (ev, dev, seqn, drv, 'delivery', route_id_, stop_id_, jsonb_build_object('delivery_id', del),
                      tt, tt + interval '1 minute', 'applied', tt + interval '1 minute');
              INSERT INTO wp.delivery(delivery_id, event_id, order_id, stop_id, outcome, received_by, unload, driver_id,
                                      device_time, received_at)
              VALUES (del, ev, oid, stop_id_,
                      'delivered', signers[1 + (abs(hashtext(oc.code)) + i % 2) % array_length(signers, 1)], oc.unload, drv,
                      tt, tt + interval '1 minute');
              INSERT INTO wp.delivery_line(delivery_id, order_id, line_no, ordered_qty, expected_qty, delivered_qty)
              SELECT del, oid, l.line_no, l.qty, l.qty, l.qty FROM wp.order_line l WHERE l.order_id = oid;
              IF mgr IS NOT NULL THEN
                INSERT INTO wp.store_receipt(order_id, delivery_id, confirmed_by, confirmed_at, all_ok)
                VALUES (oid, del, mgr, tt + interval '50 minutes', true);
              END IF;
            END LOOP;
          END LOOP;
        END LOOP;
      END LOOP;
    END LOOP;
  END LOOP;

  FOREACH t IN ARRAY tables LOOP EXECUTE format('ALTER TABLE wp.%I ENABLE TRIGGER USER', t); END LOOP;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION seed_demo_history(integer) FROM PUBLIC;

-- ----- who usually signs at a store (driver phone) ----------------------------------------------------
-- The names that took deliveries at the stores on the calling driver's own trips, most frequent first.
-- Row-level security would show only deliveries this driver made; staff names at a store they are about to
-- visit are what they need, so this function reads them for those stores only.
CREATE OR REPLACE FUNCTION usual_signers(p_user integer)
RETURNS TABLE (outlet_code text, name text, times bigint) LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = wp, pg_temp AS $$
  SELECT ou.code, d.received_by, count(*)
  FROM wp.delivery d JOIN wp.order_header h ON h.order_id = d.order_id JOIN wp.outlet ou ON ou.outlet_id = h.outlet_id
  WHERE (wp.me() IS NULL OR wp.me() = p_user)
    AND d.received_by IS NOT NULL AND d.device_time > now() - interval '60 days'
    AND h.outlet_id IN (SELECT s.outlet_id FROM wp.stop s JOIN wp.route r ON r.route_id = s.route_id
                        WHERE r.driver_id = p_user AND s.removed_at IS NULL AND r.state <> 'cancelled')
  GROUP BY ou.code, d.received_by
  ORDER BY ou.code, count(*) DESC, d.received_by
$$;
REVOKE ALL ON FUNCTION usual_signers(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION usual_signers(integer) TO waypoint_app;

-- ----- where my delivery is (store manager) -----------------------------------------------------------
-- For one order the caller may see: its stop on the released trip, how many stops the trip has, whether the
-- van has left or reached the store, and an expected arrival: the plan plus how far behind plan the van was
-- at its latest stop before this one (or at departure). Stores cannot read trips themselves.
CREATE OR REPLACE FUNCTION delivery_progress(p_order bigint)
RETURNS TABLE (stop_seq integer, stops_total integer, route_state text, departed_at timestamptz,
               planned_arrival timestamptz, arrived_at timestamptz, eta timestamptz, behind_minutes integer,
               driver_name text, vehicle text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = wp, pg_temp AS $$
  SELECT s.seq::integer,
         (SELECT count(*) FROM wp.stop s2 WHERE s2.route_id = s.route_id AND s2.removed_at IS NULL)::integer,
         r.state::text, r.departed_at, s.planned_arrival, a.device_time,
         COALESCE(a.device_time, s.planned_arrival + make_interval(mins => GREATEST(0, COALESCE(lag.behind, 0))::integer)),
         GREATEST(0, COALESCE(lag.behind, 0))::integer,
         split_part(u.name, ' ', 1), v.source_id
  FROM wp.stop_order so
  JOIN wp.stop s ON s.stop_id = so.stop_id AND s.removed_at IS NULL
  JOIN wp.route r ON r.route_id = s.route_id
  JOIN wp.plan p ON p.plan_id = r.plan_id AND p.state = 'released'
  JOIN wp.vehicle v ON v.vehicle_id = r.vehicle_id
  LEFT JOIN wp.app_user u ON u.user_id = r.driver_id
  LEFT JOIN wp.stop_arrival a ON a.stop_id = s.stop_id
  LEFT JOIN LATERAL (
    SELECT round(extract(epoch FROM x.actual - x.planned) / 60) AS behind FROM (
      SELECT a2.device_time AS actual, s3.planned_arrival AS planned, s3.seq AS seq
      FROM wp.stop s3 JOIN wp.stop_arrival a2 ON a2.stop_id = s3.stop_id
      WHERE s3.route_id = s.route_id AND s3.seq < s.seq AND s3.removed_at IS NULL
      UNION ALL
      SELECT r.departed_at, r.depart_at, 0 WHERE r.departed_at IS NOT NULL) x
    ORDER BY x.seq DESC LIMIT 1) lag ON true
  WHERE so.order_id = p_order AND so.removed_at IS NULL AND wp.can_see_order(p_order)
  LIMIT 1
$$;
REVOKE ALL ON FUNCTION delivery_progress(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION delivery_progress(bigint) TO waypoint_app;
