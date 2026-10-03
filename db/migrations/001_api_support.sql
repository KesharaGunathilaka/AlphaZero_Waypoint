-- =============================================================================
-- 001: what the API needs on top of waypoint_schema.sql. Safe to run again.
--   * app_user.vehicle_id   the driver of each vehicle (booklet: "Each vehicle has a driver")
--   * attachment_blob       photo and signature bytes (attachment keeps key, size, hash)
--   * demo_reset()          products, role accounts and one demo delivery day (Kandy depot)
-- =============================================================================
SET search_path = wp, public;

ALTER TABLE app_user ADD COLUMN IF NOT EXISTS vehicle_id integer REFERENCES vehicle;
CREATE UNIQUE INDEX IF NOT EXISTS app_user_vehicle_uq ON app_user (vehicle_id) WHERE vehicle_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS attachment_blob (
  storage_key text PRIMARY KEY,
  data        bytea NOT NULL
);

-- First service date whose order cutoff is still open (the next run store managers order into).
CREATE OR REPLACE FUNCTION next_open_service_date(p_depot smallint) RETURNS date
LANGUAGE plpgsql STABLE AS $$
DECLARE d date := (now() AT TIME ZONE 'Asia/Colombo')::date; i integer := 0;
BEGIN
  WHILE i < 30 LOOP
    IF wp.is_working_day(d) AND now() < wp.run_cutoff(p_depot, d) THEN RETURN d; END IF;
    d := d + 1; i := i + 1;
  END LOOP;
  RAISE EXCEPTION 'WP900: no open service date in the next 30 days';
END $$;

-- -----------------------------------------------------------------------------
-- Demo data. Wipes ALL operational data (orders, plans, deliveries, devices' events),
-- keeps reference data and accounts, then seeds orders for the next open service date.
-- Order sizes are illustrative (the booklet supplies no orders for the app); the Kandy
-- van-only outlets use the Day 5 worked example: 2,290 kg of chilled demand against one
-- available refrigerated van (VEH058 in the workshop) = 2,080 kg, so one order must wait.
-- OUT077's dry order is left for the judge to place as the store manager.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION demo_reset() RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE d date; dispatcher integer; o record; prod integer; n integer := 0; kg numeric; m3 numeric; per numeric;
BEGIN
  -- Products (a small catalogue per brand; the booklet gives order totals only).
  INSERT INTO wp.product(brand_id, sku, name, temp, unit, unit_weight_kg, unit_volume_m3, fragile, hanging, high_value) VALUES
    (1, 'F-DRY-01', 'Dry groceries crate',    'ambient', 'crate',  10, 0.057, false, false, false),
    (1, 'F-CHL-01', 'Dairy crate (chilled)',  'chilled', 'crate',  12.5, 0.075, false, false, false),
    (2, 'S-CTN-01', 'Garment carton',         'ambient', 'carton', 10, 0.100, false, false, false),
    (2, 'S-HNG-01', 'Hanging garment rail',   'ambient', 'rail',   15, 0.300, false, true,  false),
    (3, 'T-APP-01', 'Appliance box',          'ambient', 'box',    35, 0.200, true,  false, true)
  ON CONFLICT (sku) DO NOTHING;

  -- Accounts. Emails are the sign-in names (Clerk links them by email on first sign-in).
  INSERT INTO wp.app_user(role, name, email, depot_id, outlet_id, vehicle_id)
  SELECT v.role::wp.user_role, v.name, v.email,
         CASE WHEN v.role IN ('store_manager', 'admin') THEN NULL ELSE (SELECT depot_id FROM wp.depot WHERE name = 'Kandy') END,
         (SELECT outlet_id FROM wp.outlet WHERE code = v.outlet),
         (SELECT vehicle_id FROM wp.vehicle WHERE source_id = v.vehicle)
  FROM (VALUES
    ('dispatcher',    'Ruwan Perera',      'dispatcher@waypoint.demo',     NULL,     NULL),
    ('loader',        'Kasun Jayasinghe',  'loader.kandy@waypoint.demo',   NULL,     NULL),
    ('driver',        'Nuwan Bandara',     'driver.veh057@waypoint.demo',  NULL,     'VEH057'),
    ('driver',        'Saman Kumara',      'driver.veh059@waypoint.demo',  NULL,     'VEH059'),
    ('driver',        'Pradeep Silva',     'driver.veh060@waypoint.demo',  NULL,     'VEH060'),
    ('store_manager', 'Fathima Rizwan',    'store.out077@waypoint.demo',   'OUT077', NULL),
    ('store_manager', 'Dilani Fernando',   'store.out078@waypoint.demo',   'OUT078', NULL),
    ('admin',         'Waypoint Admin',    'admin@waypoint.demo',          NULL,     NULL)
  ) AS v(role, name, email, outlet, vehicle)
  ON CONFLICT (email) DO UPDATE SET role = EXCLUDED.role, name = EXCLUDED.name, depot_id = EXCLUDED.depot_id,
    outlet_id = EXCLUDED.outlet_id, vehicle_id = EXCLUDED.vehicle_id, active = true;

  -- Day 5 assumption: VEH058 (refrigerated van, Kandy) is in the workshop; all others available.
  UPDATE wp.vehicle SET active = (source_id <> 'VEH058');

  -- Wipe operational data. TRUNCATE does not fire the append-only row triggers.
  TRUNCATE wp.attachment_blob, wp.attachment, wp.receipt_issue, wp.store_receipt, wp.delivery_line, wp.delivery,
           wp.stop_arrival, wp.load_confirmation, wp.route_release, wp.instruction, wp.flag, wp.plan_change_ack,
           wp.plan_change, wp.plan_conflict, wp.device_event, wp.notice, wp.deferral, wp.deferral_draft,
           wp.stop_order, wp.stop, wp.route, wp.plan_version, wp.plan, wp.order_status_history, wp.order_line,
           wp.order_draft, wp.outlet_usual_line, wp.order_header, wp.run, wp.prediction, wp.audit_log
           RESTART IDENTITY CASCADE;
  UPDATE wp.device SET last_seen_at = NULL, last_sync_at = NULL;

  d := wp.next_open_service_date((SELECT depot_id FROM wp.depot WHERE name = 'Kandy'));
  SELECT user_id INTO dispatcher FROM wp.app_user WHERE email = 'dispatcher@waypoint.demo';
  PERFORM set_config('wp.user_id', dispatcher::text, true);

  FOR o IN
    WITH demo(code, temp, kg, m3) AS (VALUES
      -- Kandy van-only Fresh outlets (Day 5 worked example)
      ('OUT076','chilled',340,2.0), ('OUT077','chilled',300,1.8), ('OUT078','chilled',260,1.6), ('OUT079','chilled',300,1.8),
      ('OUT081','chilled',330,2.0), ('OUT082','chilled',330,2.1), ('OUT083','chilled',430,2.6),
      ('OUT076','ambient',280,1.6), ('OUT078','ambient',290,1.7), ('OUT079','ambient',280,1.6), ('OUT080','ambient',280,1.6),
      ('OUT081','ambient',280,1.6), ('OUT082','ambient',280,1.6), ('OUT083','ambient',280,1.6),
      ('OUT088','ambient',620,6.2), ('OUT093','ambient',210,1.2))
    SELECT ou.outlet_id, ou.code, b.code AS brand, x.temp::wp.temp_class AS temp, x.kg, x.m3
    FROM demo x JOIN wp.outlet ou ON ou.code = x.code JOIN wp.brand b ON b.brand_id = ou.brand_id
    UNION ALL
    -- Every other Kandy-depot outlet: Fresh dry + chilled daily, Style and Tech on some outlets.
    SELECT ou.outlet_id, ou.code, b.code, t.temp,
           CASE b.code WHEN 'F' THEN CASE t.temp WHEN 'chilled' THEN 180 + abs(hashtext(ou.code || 'c')) % 220
                                                  ELSE 250 + abs(hashtext(ou.code || 'd')) % 350 END
                       WHEN 'S' THEN 300 + abs(hashtext(ou.code)) % 500
                       ELSE 150 + abs(hashtext(ou.code)) % 450 END,
           NULL
    FROM wp.outlet ou JOIN wp.brand b ON b.brand_id = ou.brand_id
    CROSS JOIN LATERAL (SELECT unnest(CASE WHEN b.code = 'F' THEN ARRAY['ambient','chilled'] ELSE ARRAY['ambient'] END)::wp.temp_class AS temp) t
    WHERE ou.depot_id = (SELECT depot_id FROM wp.depot WHERE name = 'Kandy') AND ou.code NOT BETWEEN 'OUT076' AND 'OUT083'
      AND ou.code NOT IN ('OUT088', 'OUT093') AND (b.code = 'F' OR abs(hashtext(ou.code)) % 3 <> 0)
  LOOP
    SELECT product_id, unit_weight_kg INTO prod, per FROM wp.product p
    WHERE p.brand_id = (SELECT brand_id FROM wp.brand WHERE code = o.brand) AND p.temp = o.temp ORDER BY sku LIMIT 1;
    kg := o.kg;
    -- density: Fresh ~170 kg/m3, Style garments ~100 kg/m3 (volume fills first), Tech ~175 kg/m3
    m3 := COALESCE(o.m3, round(kg / CASE o.brand WHEN 'S' THEN 100 WHEN 'T' THEN 175 ELSE 170 END, 2));
    PERFORM wp.place_order(gen_random_uuid(), o.outlet_id, o.temp,
              jsonb_build_array(jsonb_build_object('product_id', prod, 'qty', GREATEST(1, round(kg / per)))),
              dispatcher, 'dispatcher', d, kg, m3);
    n := n + 1;
  END LOOP;

  RETURN jsonb_build_object('service_date', d, 'orders', n,
                            'cutoff', wp.run_cutoff((SELECT depot_id FROM wp.depot WHERE name = 'Kandy'), d));
END $$;
