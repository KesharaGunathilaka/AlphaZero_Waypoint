-- =============================================================================
-- 001: what the API needs on top of waypoint_schema.sql. Safe to run again.
--   * app_user.vehicle_id   the driver of each vehicle (booklet: "Each vehicle has a driver")
--   * attachment_blob       photo and signature bytes (attachment keeps key, size, hash)
--   * demo_reset()          products, role accounts and one demo delivery day (Kandy depot)
--   * pgcrypto              password hashes for the local sign-in (Docker; the deployed app uses Clerk)
-- =============================================================================
SET search_path = wp, public;

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;

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
DECLARE d date; dispatcher integer; o record; n integer := 0; kg numeric; m3 numeric; lines jsonb; base numeric;
BEGIN
  -- Wipe operational data first. TRUNCATE does not fire the append-only row triggers.
  TRUNCATE wp.attachment_blob, wp.attachment, wp.receipt_issue, wp.store_receipt, wp.delivery_line, wp.delivery,
           wp.stop_arrival, wp.load_confirmation, wp.route_release, wp.instruction, wp.flag, wp.plan_change_ack,
           wp.plan_change, wp.plan_conflict, wp.device_event, wp.notice, wp.deferral, wp.deferral_draft,
           wp.stop_order, wp.stop, wp.route, wp.plan_version, wp.plan, wp.order_status_history, wp.order_line,
           wp.order_draft, wp.outlet_usual_line, wp.order_header, wp.run, wp.prediction, wp.audit_log
           RESTART IDENTITY CASCADE;
  UPDATE wp.device SET last_seen_at = NULL, last_sync_at = NULL;

  -- Product catalogue (the booklet gives order totals only). Item names follow the Day 5 screens;
  -- "usual" is the quantity a typical order holds, used to build the demo order lines.
  CREATE TEMP TABLE IF NOT EXISTS demo_catalogue (brand_id smallint, sku text, name text, temp wp.temp_class, unit text,
    unit_kg numeric, unit_m3 numeric, fragile boolean, hanging boolean, high_value boolean, usual integer) ON COMMIT DROP;
  TRUNCATE demo_catalogue;
  INSERT INTO demo_catalogue VALUES
    (1, 'F-RICE5',  'Rice, 5 kg bag',          'ambient', 'bag',    5.1,  0.030, false, false, false, 12),
    (1, 'F-SUGAR',  'Sugar, 1 kg',             'ambient', 'pack',   1.0,  0.006, false, false, false, 20),
    (1, 'F-DHAL',   'Dhal, 1 kg',              'ambient', 'pack',   1.0,  0.006, false, false, false, 15),
    (1, 'F-COCOIL', 'Coconut oil, 1 L',        'ambient', 'bottle', 0.95, 0.006, false, false, false, 10),
    (1, 'F-TEA',    'Tea, 400 g',              'ambient', 'pack',   0.4,  0.004, false, false, false, 18),
    (1, 'F-FLOUR',  'Wheat flour, 1 kg',       'ambient', 'pack',   1.0,  0.006, false, false, false, 14),
    (1, 'F-SALT',   'Salt, 500 g',             'ambient', 'pack',   0.5,  0.003, false, false, false, 8),
    (1, 'F-CHICK',  'Chilled chicken, 1 kg',   'chilled', 'pack',   1.0,  0.008, false, false, false, 24),
    (1, 'F-MILK',   'Full-cream milk, 1 L',    'chilled', 'carton', 1.05, 0.004, false, false, false, 48),
    (1, 'F-CURD',   'Curd, 400 g',             'chilled', 'pot',    0.45, 0.003, false, false, false, 30),
    (1, 'F-EGGS',   'Eggs, tray of 30',        'chilled', 'tray',   1.9,  0.012, true,  false, false, 12),
    (1, 'F-BUTTER', 'Butter, 200 g',           'chilled', 'pack',   0.22, 0.002, false, false, false, 16),
    (1, 'F-CHEESE', 'Cheese slices, 200 g',    'chilled', 'pack',   0.22, 0.002, false, false, false, 10),
    (2, 'S-SHIRT',  'Shirts, carton of 12',    'ambient', 'carton', 6,    0.060, false, false, false, 10),
    (2, 'S-DENIM',  'Denim, carton of 10',     'ambient', 'carton', 9,    0.050, false, false, false, 8),
    (2, 'S-DRESS',  'Dresses, rail of 20',     'ambient', 'rail',   12,   0.250, false, true,  false, 6),
    (3, 'T-TV55',   'Television, 55 inch',     'ambient', 'box',    22,   0.250, true,  false, true,  2),
    (3, 'T-FRIDGE', 'Refrigerator, 350 L',     'ambient', 'box',    65,   0.800, true,  false, true,  1),
    (3, 'T-WASHER', 'Washing machine, 8 kg',   'ambient', 'box',    70,   0.600, true,  false, true,  1),
    (3, 'T-SMALL',  'Small appliances carton', 'ambient', 'carton', 8,    0.050, false, false, false, 6);
  DELETE FROM wp.product WHERE sku NOT IN (SELECT sku FROM demo_catalogue);
  INSERT INTO wp.product(brand_id, sku, name, temp, unit, unit_weight_kg, unit_volume_m3, fragile, hanging, high_value)
  SELECT brand_id, sku, name, temp, unit, unit_kg, unit_m3, fragile, hanging, high_value FROM demo_catalogue
  ON CONFLICT (sku) DO UPDATE SET name = EXCLUDED.name, temp = EXCLUDED.temp, unit = EXCLUDED.unit,
    unit_weight_kg = EXCLUDED.unit_weight_kg, unit_volume_m3 = EXCLUDED.unit_volume_m3, active = true;

  -- Accounts. Emails are the sign-in names (Clerk links them by email on first sign-in).
  -- Local sign-in (Docker): every demo account's password is 'waypoint-demo' (bcrypt hash).
  INSERT INTO wp.app_user(role, name, email, depot_id, outlet_id, vehicle_id, password_hash)
  SELECT v.role::wp.user_role, v.name, v.email,
         CASE WHEN v.role IN ('store_manager', 'admin') THEN NULL ELSE (SELECT depot_id FROM wp.depot WHERE name = 'Kandy') END,
         (SELECT outlet_id FROM wp.outlet WHERE code = v.outlet),
         (SELECT vehicle_id FROM wp.vehicle WHERE source_id = v.vehicle),
         public.crypt('waypoint-demo', public.gen_salt('bf', 8))
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
    outlet_id = EXCLUDED.outlet_id, vehicle_id = EXCLUDED.vehicle_id, active = true,
    password_hash = COALESCE(wp.app_user.password_hash, EXCLUDED.password_hash);

  -- Day 5 assumption: VEH058 (refrigerated van, Kandy) is in the workshop; all others available.
  UPDATE wp.vehicle SET active = (source_id <> 'VEH058');

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
    kg := o.kg;
    -- density: Fresh ~170 kg/m3, Style garments ~100 kg/m3 (volume fills first), Tech ~175 kg/m3
    m3 := COALESCE(o.m3, round(kg / CASE o.brand WHEN 'S' THEN 100 WHEN 'T' THEN 175 ELSE 170 END, 2));
    -- Lines: the usual mix of this brand and temperature, scaled to the order's weight.
    SELECT sum(c.usual * c.unit_kg) INTO base FROM demo_catalogue c
    WHERE c.brand_id = (SELECT brand_id FROM wp.brand WHERE code = o.brand) AND c.temp = o.temp;
    SELECT jsonb_agg(jsonb_build_object('product_id', p.product_id, 'qty', GREATEST(1, round(c.usual * kg / base)))
                     ORDER BY c.sku)
      INTO lines
    FROM demo_catalogue c JOIN wp.product p ON p.sku = c.sku
    WHERE c.brand_id = (SELECT brand_id FROM wp.brand WHERE code = o.brand) AND c.temp = o.temp;
    PERFORM wp.place_order(gen_random_uuid(), o.outlet_id, o.temp, lines, dispatcher, 'dispatcher', d, kg, m3);
    n := n + 1;
  END LOOP;

  -- A usual order for every Kandy outlet that has none yet (pre-fills the store manager's order form).
  INSERT INTO wp.outlet_usual_line(outlet_id, temp, product_id, qty)
  SELECT ou.outlet_id, c.temp, p.product_id, c.usual
  FROM wp.outlet ou JOIN demo_catalogue c ON c.brand_id = ou.brand_id JOIN wp.product p ON p.sku = c.sku
  WHERE ou.depot_id = (SELECT depot_id FROM wp.depot WHERE name = 'Kandy')
    AND NOT EXISTS (SELECT 1 FROM wp.outlet_usual_line u WHERE u.outlet_id = ou.outlet_id AND u.temp = c.temp)
  ON CONFLICT DO NOTHING;

  RETURN jsonb_build_object('service_date', d, 'orders', n,
                            'cutoff', wp.run_cutoff((SELECT depot_id FROM wp.depot WHERE name = 'Kandy'), d));
END $$;
