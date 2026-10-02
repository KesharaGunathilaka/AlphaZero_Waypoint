-- =============================================================================
-- Waypoint: load the supplied CSV files into the schema.
--
--   cd data/general
--   psql -v ON_ERROR_STOP=1 -d waypoint -f ../../db/waypoint_import.sql
-- (db/load.sh and the docker db container run this for you.)
--
-- Run from the folder that holds the CSV files (psql reads them by relative name).
-- Run after waypoint_schema.sql. One transaction: any mismatch rolls everything back.
-- Safe to run again (for a new calendar or road-conditions file): rows are updated in place,
-- and names, addresses and contacts edited by an admin are not overwritten.
-- Files: district_travel, service_allowance, vehicles, outlets, calendar, road_conditions,
-- traffic_speed. Orders are not supplied; they are placed in the app.
-- =============================================================================
\set ON_ERROR_STOP on
BEGIN;
SET search_path = wp, public;


-- free_flow_kmh is numeric: the CSV holds values like "30.0", which COPY rejects for an int column.
CREATE TEMP TABLE stg_district (district text, depot text, road_class text, free_flow_kmh numeric, depot_to_district_km numeric,
  depot_to_district_freeflow_min int, inter_stop_km numeric, inter_stop_freeflow_min int) ON COMMIT DROP;
CREATE TEMP TABLE stg_allow (brand text, dock_type text, minutes int) ON COMMIT DROP;
CREATE TEMP TABLE stg_vehicle (vehicle_id text, type text, temp text, weight_cap_kg numeric, volume_cap_m3 numeric,
  fuel_type text, km_per_l numeric, weekly_fuel_quota_l numeric, depot text) ON COMMIT DROP;
CREATE TEMP TABLE stg_outlet (outlet_id text, brand text, district text, depot text, dock_type text,
  parking_constraint text, mall_window text, open_t text, close_t text) ON COMMIT DROP;
CREATE TEMP TABLE stg_cal (d date, dow int, dow_name text, is_weekend int, iso_year int, iso_week int, is_payday int,
  festival text, festival_ramp numeric, is_holiday int, monsoon int, is_operating int) ON COMMIT DROP;
CREATE TEMP TABLE stg_road (district text, d date, idx int) ON COMMIT DROP;
CREATE TEMP TABLE stg_traffic (district text, hour int, monsoon int, speed int) ON COMMIT DROP;

\copy stg_district FROM 'district_travel.csv' WITH (FORMAT csv, HEADER true)
\copy stg_allow    FROM 'service_allowance.csv'    WITH (FORMAT csv, HEADER true)
\copy stg_vehicle  FROM 'vehicles.csv'  WITH (FORMAT csv, HEADER true)
\copy stg_outlet   FROM 'outlets.csv'   WITH (FORMAT csv, HEADER true)
\copy stg_cal      FROM 'calendar.csv'      WITH (FORMAT csv, HEADER true)
\copy stg_road     FROM 'road_conditions.csv'     WITH (FORMAT csv, HEADER true)
\copy stg_traffic  FROM 'traffic_speed.csv'  WITH (FORMAT csv, HEADER true)

-- ---- districts and service allowances -------------------------------------
DO $$ DECLARE n int; m int; BEGIN
  SELECT count(*) INTO m FROM stg_district;
  INSERT INTO wp.district(depot_id, name, road_class, free_flow_kmh, depot_to_district_km, depot_to_district_freeflow_min,
                          inter_stop_km, inter_stop_freeflow_min)
  SELECT d.depot_id, s.district, s.road_class, s.free_flow_kmh, s.depot_to_district_km, s.depot_to_district_freeflow_min,
         s.inter_stop_km, s.inter_stop_freeflow_min
  FROM stg_district s JOIN wp.depot d ON d.name = s.depot
  ON CONFLICT (name) DO UPDATE SET depot_id = EXCLUDED.depot_id, road_class = EXCLUDED.road_class,
    free_flow_kmh = EXCLUDED.free_flow_kmh, depot_to_district_km = EXCLUDED.depot_to_district_km,
    depot_to_district_freeflow_min = EXCLUDED.depot_to_district_freeflow_min,
    inter_stop_km = EXCLUDED.inter_stop_km, inter_stop_freeflow_min = EXCLUDED.inter_stop_freeflow_min;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> m THEN RAISE EXCEPTION 'district_travel.csv: only % of % rows name a known depot', n, m; END IF;

  SELECT count(*) INTO m FROM stg_allow;
  INSERT INTO wp.service_allowance(brand_id, unload, minutes)
  SELECT b.brand_id, s.dock_type::wp.unload_type, s.minutes FROM stg_allow s JOIN wp.brand b ON b.name = 'Waypoint ' || s.brand
  ON CONFLICT (brand_id, unload) DO UPDATE SET minutes = EXCLUDED.minutes;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> m THEN RAISE EXCEPTION 'service_allowance.csv: only % of % rows name a known brand', n, m; END IF;
END $$;

-- ---- vehicles ---------------------------------------------------------------
-- Class: truck or van, reefer or ambient. Display code RT-01, RV-01, DT-01, AV-01 by order of vehicle_id.
DO $$ DECLARE n int; m int; bad text; BEGIN
  SELECT string_agg(DISTINCT type || '/' || temp, ', ') INTO bad FROM stg_vehicle
   WHERE type NOT IN ('truck', 'van') OR temp NOT IN ('reefer', 'ambient');
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'vehicles.csv: unknown type or temp: %', bad; END IF;
  SELECT count(*) INTO m FROM stg_vehicle;

  INSERT INTO wp.vehicle(depot_id, class_id, code, source_id, max_weight_kg, max_volume_m3, fuel_type, km_per_l)
  SELECT d.depot_id, x.class_id,
         c.code_prefix || '-' || lpad((x.k + COALESCE((SELECT max(substring(v.code FROM 4)::int) FROM wp.vehicle v WHERE v.class_id = x.class_id), 0))::text, 2, '0'),
         x.vehicle_id, x.weight_cap_kg, x.volume_cap_m3, x.fuel_type, x.km_per_l
  FROM (SELECT s.*, CASE WHEN type = 'truck' AND temp = 'reefer' THEN 1 WHEN type = 'van' AND temp = 'reefer' THEN 2
                         WHEN type = 'truck' THEN 3 ELSE 4 END AS class_id,
               row_number() OVER (PARTITION BY (CASE WHEN type = 'truck' AND temp = 'reefer' THEN 1 WHEN type = 'van' AND temp = 'reefer' THEN 2
                                                     WHEN type = 'truck' THEN 3 ELSE 4 END) ORDER BY vehicle_id) AS k
        FROM stg_vehicle s WHERE NOT EXISTS (SELECT 1 FROM wp.vehicle w WHERE w.source_id = s.vehicle_id)) x
  JOIN wp.depot d ON d.name = x.depot JOIN wp.vehicle_class c ON c.class_id = x.class_id;

  UPDATE wp.vehicle v SET depot_id = d.depot_id, max_weight_kg = s.weight_cap_kg, max_volume_m3 = s.volume_cap_m3,
         fuel_type = s.fuel_type, km_per_l = s.km_per_l
  FROM stg_vehicle s JOIN wp.depot d ON d.name = s.depot WHERE v.source_id = s.vehicle_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> m THEN RAISE EXCEPTION 'vehicles.csv: only % of % rows matched a depot', n, m; END IF;

  INSERT INTO wp.fuel_quota(vehicle_id, valid_from, litres_per_week)
  SELECT v.vehicle_id, DATE '2024-01-01', s.weekly_fuel_quota_l FROM stg_vehicle s JOIN wp.vehicle v ON v.source_id = s.vehicle_id
  ON CONFLICT (vehicle_id, valid_from) DO UPDATE SET litres_per_week = EXCLUDED.litres_per_week;
END $$;

-- ---- outlets and windows --------------------------------------------------------
-- parking_constraint: van_only -> van-only outlet; mall_dock <-> dock type mall_bay <-> a fixed mall window.
DO $$ DECLARE n int; m int; bad text; BEGIN
  SELECT string_agg(outlet_id, ', ') INTO bad FROM stg_outlet
   WHERE (parking_constraint = 'mall_dock') <> (dock_type = 'mall_bay') OR (parking_constraint = 'mall_dock') <> (mall_window IS NOT NULL)
      OR parking_constraint NOT IN ('normal', 'van_only', 'mall_dock') OR open_t::time >= close_t::time;
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'outlets.csv: inconsistent parking, dock or window for %', bad; END IF;
  SELECT count(*) INTO m FROM stg_outlet;

  INSERT INTO wp.outlet(brand_id, depot_id, district_id, code, name, unload, van_only)
  SELECT b.brand_id, di.depot_id, di.district_id, s.outlet_id, s.brand || ' ' || s.district || ' ' || s.outlet_id,
         s.dock_type::wp.unload_type, s.parking_constraint = 'van_only'
  FROM stg_outlet s JOIN wp.brand b ON b.name = 'Waypoint ' || s.brand JOIN wp.district di ON di.name = s.district
  JOIN wp.depot dp ON dp.name = s.depot AND dp.depot_id = di.depot_id
  WHERE NOT EXISTS (SELECT 1 FROM wp.outlet o WHERE o.code = s.outlet_id);

  UPDATE wp.outlet o SET brand_id = b.brand_id, depot_id = di.depot_id, district_id = di.district_id,
         unload = s.dock_type::wp.unload_type, van_only = (s.parking_constraint = 'van_only')
  FROM stg_outlet s JOIN wp.brand b ON b.name = 'Waypoint ' || s.brand JOIN wp.district di ON di.name = s.district
  JOIN wp.depot dp ON dp.name = s.depot AND dp.depot_id = di.depot_id
  WHERE o.code = s.outlet_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> m THEN RAISE EXCEPTION 'outlets.csv: only % of % rows matched a brand, district and depot together', n, m; END IF;

  -- One window per outlet, the same Monday to Saturday. A mall outlet's window is its fixed access window.
  DELETE FROM wp.outlet_window WHERE outlet_id IN (SELECT o.outlet_id FROM wp.outlet o JOIN stg_outlet s ON s.outlet_id = o.code);
  INSERT INTO wp.outlet_window(outlet_id, kind, isodow, opens, closes)
  SELECT o.outlet_id, CASE WHEN s.mall_window IS NOT NULL THEN 'mall_access' ELSE 'delivery' END, d, s.open_t::time, s.close_t::time
  FROM stg_outlet s JOIN wp.outlet o ON o.code = s.outlet_id CROSS JOIN generate_series(1, 6) d;
END $$;

-- ---- calendar, roads, traffic -------------------------------------------------------
INSERT INTO wp.calendar_day(day, is_working, is_payday, is_holiday, monsoon, festival, festival_ramp)
SELECT d, is_operating = 1, is_payday = 1, is_holiday = 1, monsoon = 1, NULLIF(festival, ''), festival_ramp FROM stg_cal
ON CONFLICT (day) DO UPDATE SET is_working = EXCLUDED.is_working, is_payday = EXCLUDED.is_payday, is_holiday = EXCLUDED.is_holiday,
  monsoon = EXCLUDED.monsoon, festival = EXCLUDED.festival, festival_ramp = EXCLUDED.festival_ramp;

DO $$ DECLARE n int; m int; BEGIN
  SELECT count(*) INTO m FROM stg_road;
  INSERT INTO wp.road_condition(district_id, day, disruption_index)
  SELECT di.district_id, s.d, s.idx FROM stg_road s JOIN wp.district di ON di.name = s.district
  ON CONFLICT (district_id, day) DO UPDATE SET disruption_index = EXCLUDED.disruption_index;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> m THEN RAISE EXCEPTION 'road_conditions.csv: only % of % rows name a known district', n, m; END IF;

  SELECT count(*) INTO m FROM stg_traffic;
  INSERT INTO wp.traffic_speed(district_id, hour, monsoon, speed_index)
  SELECT di.district_id, s.hour, s.monsoon = 1, s.speed FROM stg_traffic s JOIN wp.district di ON di.name = s.district
  ON CONFLICT (district_id, hour, monsoon) DO UPDATE SET speed_index = EXCLUDED.speed_index;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> m THEN RAISE EXCEPTION 'traffic_speed.csv: only % of % rows name a known district', n, m; END IF;
END $$;

SELECT 'district' AS loaded, count(*) FROM wp.district UNION ALL SELECT 'service_allowance', count(*) FROM wp.service_allowance
UNION ALL SELECT 'vehicle', count(*) FROM wp.vehicle UNION ALL SELECT 'fuel_quota', count(*) FROM wp.fuel_quota
UNION ALL SELECT 'outlet', count(*) FROM wp.outlet UNION ALL SELECT 'outlet_window', count(*) FROM wp.outlet_window
UNION ALL SELECT 'calendar_day', count(*) FROM wp.calendar_day
UNION ALL SELECT 'road_condition', count(*) FROM wp.road_condition UNION ALL SELECT 'traffic_speed', count(*) FROM wp.traffic_speed;
COMMIT;
