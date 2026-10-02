-- =============================================================================
-- Waypoint delivery platform: PostgreSQL 16 schema, version 2.3
-- Companion to Waypoint_Data_Architecture_v2.docx and Waypoint_Design_Plan.docx.
-- Reflects Constraints.docx and the supplied CSV files: one brand and one district per
-- trip, the trip-time formula with service allowances as the per-stop time budget,
-- per-vehicle capacity and fuel, district travel, road disruption.
--
-- Load into an empty database as the migration owner (one transaction, all or nothing):
--   psql -v ON_ERROR_STOP=1 -d waypoint -f waypoint_schema.sql
-- Then load the CSV data (run from the folder that holds the files):
--   psql -v ON_ERROR_STOP=1 -d waypoint -f waypoint_import.sql
-- The API connects as waypoint_app (create a LOGIN role that inherits it).
-- Requires PostgreSQL 16 or newer (tested on 16 and 18; Neon runs 18) and the contrib
-- extensions btree_gist and pgcrypto.
--
-- Business rules follow the Challenge Booklet only (operating constraints + Task 2B feasibility rules):
-- weight and volume per trip, chilled only on refrigerated vehicles, van-only outlets, home depot,
-- one brand and one district per trip, whole orders, at most two trips per vehicle, daily time
-- budgets (Fresh 270 min from 03:30, Style + Tech 480 min), the trip-time formula, delivery and
-- mall windows (early arrivals wait), weekly fuel quota, operating days, the 16:00 cutoff, and
-- deferrals recorded with a reason. Driver availability is not a constraint (booklet).
-- =============================================================================
\set ON_ERROR_STOP on
BEGIN;

-- Sized for 3 brands, 120 outlets, 2 depots, 60 vehicles and about 133 orders a night.

CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS wp;
SET search_path = wp, public;

-- ---------------------------------------------------------------- enums ----
CREATE TYPE temp_class      AS ENUM ('ambient', 'chilled', 'frozen');
CREATE TYPE unload_type     AS ENUM ('rear_dock', 'street', 'mall_bay');
CREATE TYPE user_role       AS ENUM ('dispatcher', 'loader', 'driver', 'store_manager', 'admin');
CREATE TYPE order_status    AS ENUM ('placed', 'confirmed', 'planned', 'loading', 'loaded',
                                     'on_the_way', 'delivered', 'delivered_in_part',
                                     'not_delivered', 'deferred', 'received');
CREATE TYPE plan_state      AS ENUM ('draft', 'released');
CREATE TYPE route_state     AS ENUM ('planned', 'loading', 'loaded', 'on_the_way', 'complete', 'cancelled');
CREATE TYPE source_kind     AS ENUM ('app', 'device', 'system');
CREATE TYPE value_source    AS ENUM ('standard', 'routing', 'predicted', 'manual');
CREATE TYPE flag_source     AS ENUM ('loader', 'driver');
CREATE TYPE flag_state      AS ENUM ('open', 'replied', 'resolved');
CREATE TYPE delivery_outcome AS ENUM ('delivered', 'delivered_in_part', 'not_delivered');
CREATE TYPE issue_type      AS ENUM ('short', 'damaged', 'wrong_item', 'not_received');
CREATE TYPE instruction_type AS ENUM ('skip_stop', 'reorder', 'hold', 'reassign', 'proceed_short', 'note');
CREATE TYPE instruction_state AS ENUM ('sent', 'on_phone', 'seen', 'no_action_needed');
CREATE TYPE event_state     AS ENUM ('applied', 'rejected');
CREATE TYPE notice_kind     AS ENUM ('order_confirmed', 'deferred', 'arrival_window', 'short_loaded',
                                     'delivered', 'not_delivered', 'receipt_needed', 'issue_logged');
CREATE TYPE reason_scope    AS ENUM ('deferral', 'not_delivered', 'part_delivery', 'flag_loader', 'flag_driver');
CREATE TYPE proof_kind      AS ENUM ('signature', 'photo');
CREATE TYPE run_state       AS ENUM ('open', 'closed', 'planned', 'in_progress', 'complete');

-- ------------------------------------------------------- generic helpers ---
CREATE FUNCTION touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

CREATE FUNCTION forbid_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'table %.% is append-only (% rejected)', TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'WP001';
END $$;

-- ============================================================ master data ==
CREATE TABLE brand (
  brand_id   smallint PRIMARY KEY,
  code       text NOT NULL UNIQUE CHECK (code ~ '^[A-Z]{1,3}$'),   -- F, S, T monograms
  name       text NOT NULL UNIQUE
);

CREATE TABLE depot (
  depot_id        smallint PRIMARY KEY,
  name            text NOT NULL UNIQUE,
  tz              text NOT NULL DEFAULT 'Asia/Colombo',
  order_cutoff    time NOT NULL DEFAULT '16:00',          -- local time, day before delivery
  fresh_deadline  time NOT NULL DEFAULT '08:00'           -- Fresh stores open
);

-- Districts and their travel figures (district_travel.csv). A trip goes to exactly one district.
CREATE TABLE district (
  district_id smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  depot_id    smallint NOT NULL REFERENCES depot,
  name        text NOT NULL UNIQUE,
  road_class  text,                                   -- urban, suburban, highway, hill
  free_flow_kmh smallint CHECK (free_flow_kmh > 0),
  depot_to_district_freeflow_min smallint NOT NULL CHECK (depot_to_district_freeflow_min > 0),
  depot_to_district_km  numeric(6,1) NOT NULL CHECK (depot_to_district_km > 0),
  inter_stop_freeflow_min smallint NOT NULL CHECK (inter_stop_freeflow_min > 0),
  inter_stop_km numeric(5,1) NOT NULL CHECK (inter_stop_km > 0),
  UNIQUE (district_id, depot_id)
);

-- Daily road disruption per district (road_conditions.csv): 100 = normal, lower = worse.
-- The supplied data runs 40 to 100. It affects travel time (ETAs), not which trips are allowed.
CREATE TABLE road_condition (
  district_id smallint NOT NULL REFERENCES district,
  day         date NOT NULL,
  disruption_index smallint NOT NULL CHECK (disruption_index BETWEEN 0 AND 100),
  PRIMARY KEY (district_id, day)
);

-- Speed as a share of free flow, by district, hour and monsoon (traffic_speed.csv).
-- Planning uses free-flow minutes, as the brief states; this feeds the prediction seam.
CREATE TABLE traffic_speed (
  district_id smallint NOT NULL REFERENCES district,
  hour        smallint NOT NULL CHECK (hour BETWEEN 0 AND 23),
  monsoon     boolean NOT NULL,
  speed_index smallint NOT NULL CHECK (speed_index BETWEEN 1 AND 100),
  PRIMARY KEY (district_id, hour, monsoon)
);

-- Operating calendar (calendar.csv). Days not listed default to Monday to Saturday.
CREATE TABLE calendar_day (
  day        date PRIMARY KEY,
  is_working boolean NOT NULL,
  is_payday  boolean NOT NULL DEFAULT false,
  is_holiday boolean NOT NULL DEFAULT false,
  monsoon    boolean NOT NULL DEFAULT false,
  festival   text,
  festival_ramp numeric(3,2) CHECK (festival_ramp BETWEEN 0 AND 1),   -- demand ramp around a festival
  note       text
);
CREATE FUNCTION is_working_day(d date) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT is_working FROM calendar_day WHERE day = d), EXTRACT(isodow FROM d) <> 7)
$$;

CREATE TABLE vehicle_class (
  class_id        smallint PRIMARY KEY,
  code_prefix     text NOT NULL UNIQUE CHECK (code_prefix ~ '^[A-Z]{2}$'),  -- RT, RV, DT, AV
  name            text NOT NULL,
  is_van          boolean NOT NULL,
  carries_chilled boolean NOT NULL,
  carries_frozen  boolean NOT NULL DEFAULT false,
  CHECK (carries_chilled OR NOT carries_frozen)
);

CREATE TABLE vehicle (
  vehicle_id  integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  depot_id    smallint NOT NULL REFERENCES depot,
  class_id    smallint NOT NULL REFERENCES vehicle_class,
  source_id   text NOT NULL UNIQUE CHECK (source_id ~ '^VEH[0-9]{3}$'),   -- vehicles.csv vehicle_id
  code        text NOT NULL UNIQUE CHECK (code ~ '^[A-Z]{2}-[0-9]{2,3}$'),    -- display code, e.g. RT-03
  max_weight_kg numeric(8,1) NOT NULL CHECK (max_weight_kg > 0),    -- weight_cap_kg
  max_volume_m3 numeric(6,2) NOT NULL CHECK (max_volume_m3 > 0),    -- volume_cap_m3
  fuel_type   text NOT NULL DEFAULT 'diesel',
  km_per_l    numeric(4,1) NOT NULL CHECK (km_per_l > 0),
  active      boolean NOT NULL DEFAULT true,
  UNIQUE (vehicle_id, depot_id)
);

CREATE TABLE fuel_quota (
  vehicle_id  integer NOT NULL REFERENCES vehicle,
  valid_from  date NOT NULL,
  litres_per_week numeric(7,1) NOT NULL CHECK (litres_per_week >= 0),
  PRIMARY KEY (vehicle_id, valid_from)
);

CREATE TABLE outlet (
  outlet_id   integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  brand_id    smallint NOT NULL REFERENCES brand,
  depot_id    smallint NOT NULL REFERENCES depot,
  district_id smallint NOT NULL,
  code        text NOT NULL UNIQUE,
  name        text NOT NULL,
  address     text,
  van_only    boolean NOT NULL DEFAULT false,
  unload      unload_type NOT NULL,
  access_note text,
  gate_contact_name  text,
  gate_contact_phone text,
  active      boolean NOT NULL DEFAULT true,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (outlet_id, brand_id),
  FOREIGN KEY (district_id, depot_id) REFERENCES district (district_id, depot_id)
);
CREATE INDEX outlet_district_idx ON outlet (district_id) WHERE active;
CREATE INDEX outlet_depot_idx ON outlet (depot_id) WHERE active;
CREATE TRIGGER outlet_touch BEFORE UPDATE ON outlet FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Delivery windows and mall access windows: several per outlet and weekday.
CREATE TABLE outlet_window (
  window_id  integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  outlet_id  integer NOT NULL REFERENCES outlet ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('delivery', 'mall_access')),
  isodow     smallint NOT NULL CHECK (isodow BETWEEN 1 AND 6),
  opens      time NOT NULL,
  closes     time NOT NULL,
  CHECK (opens < closes),
  EXCLUDE USING gist (outlet_id WITH =, kind WITH =, isodow WITH =,
                      tsrange(('2000-01-01'::date + opens), ('2000-01-01'::date + closes)) WITH &&)
);

-- Which proof of delivery the driver captures, by brand and unloading method (rules combine).
-- Informational only: it drives the proof screen and the proof_complete flag, it never blocks a delivery.
CREATE TABLE proof_rule (
  rule_id    smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  brand_id   smallint REFERENCES brand,
  unload     unload_type,
  need_signature boolean NOT NULL DEFAULT false,
  need_photo     boolean NOT NULL DEFAULT false,
  UNIQUE NULLS NOT DISTINCT (brand_id, unload)
);

CREATE TABLE product (
  product_id  integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  brand_id    smallint NOT NULL REFERENCES brand,
  sku         text NOT NULL UNIQUE,
  name        text NOT NULL,
  temp        temp_class NOT NULL DEFAULT 'ambient',
  unit        text NOT NULL DEFAULT 'each',
  unit_weight_kg numeric(8,3) NOT NULL CHECK (unit_weight_kg > 0),
  unit_volume_m3 numeric(8,5) NOT NULL CHECK (unit_volume_m3 > 0),
  fragile     boolean NOT NULL DEFAULT false,
  hanging     boolean NOT NULL DEFAULT false,
  high_value  boolean NOT NULL DEFAULT false,
  active      boolean NOT NULL DEFAULT true,
  UNIQUE (product_id, brand_id, temp)
);
CREATE INDEX product_brand_idx ON product (brand_id) WHERE active;

-- The time budget per stop, by brand and dock type (service_allowance.csv). It is a planning
-- allowance, not an observed duration: observed times are recorded separately (service_time_actual).
CREATE TABLE service_allowance (
  brand_id smallint NOT NULL REFERENCES brand,
  unload   unload_type NOT NULL,
  minutes  smallint NOT NULL CHECK (minutes > 0),
  PRIMARY KEY (brand_id, unload)
);


-- Controlled reason lists (wording is data, not an enum).
CREATE TABLE reason_code (
  code     text NOT NULL,
  scope    reason_scope NOT NULL,
  label    text NOT NULL,                 -- dispatcher wording
  store_label text NOT NULL,              -- store manager wording, a fact about the world
  needs_note boolean NOT NULL DEFAULT false,
  sort     smallint NOT NULL DEFAULT 0,
  active   boolean NOT NULL DEFAULT true,
  PRIMARY KEY (scope, code)
);

-- ================================================================ people ===
CREATE TABLE app_user (
  user_id    integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  role       user_role NOT NULL,
  name       text NOT NULL,
  email      text UNIQUE,
  phone      text,
  clerk_user_id text UNIQUE,                -- set when sign-in is handled by Clerk (the JWT "sub")
  password_hash text,                       -- set when sign-in is handled by the API itself
  depot_id   smallint REFERENCES depot,
  outlet_id  integer REFERENCES outlet,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((role = 'store_manager') = (outlet_id IS NOT NULL)),
  CHECK (role IN ('store_manager', 'admin') OR depot_id IS NOT NULL)
);

-- Registered devices: driver phones, loader tablets, store browsers are not registered.
CREATE TABLE device (
  device_id  uuid PRIMARY KEY,
  kind       text NOT NULL CHECK (kind IN ('driver_phone', 'loader_tablet')),
  label      text NOT NULL,
  depot_id   smallint NOT NULL REFERENCES depot,
  user_id    integer REFERENCES app_user,   -- driver phones belong to one driver
  push_endpoint text,                       -- Web Push subscription, if any
  last_seen_at timestamptz,                 -- any contact: heartbeat or event
  last_sync_at timestamptz,
  last_skew_seconds integer,
  active     boolean NOT NULL DEFAULT true
);
CREATE INDEX device_seen_idx ON device (last_seen_at) WHERE active;

-- Operating-day timestamp -> local date in the depot's zone.
CREATE FUNCTION depot_local_date(p_depot smallint, p_ts timestamptz) RETURNS date
LANGUAGE sql STABLE AS $$ SELECT (p_ts AT TIME ZONE (SELECT tz FROM depot WHERE depot_id = p_depot))::date $$;


-- ============================================================== settings ===
CREATE TABLE setting (
  key   text PRIMARY KEY,
  value text NOT NULL,
  note  text
);
INSERT INTO setting(key, value, note) VALUES
  ('arrival_window_minutes',  '15',  'Planned arrival +/- this many minutes shown to stores'),
  ('no_signal_minutes',       '20',  'Device silent for this long on a live route shows No signal'),
  ('late_grace_minutes',      '10',  'Minutes after planned arrival before a stop counts as Late'),
  ('clock_skew_tolerance_s',  '120', 'Device clock beyond this is accepted but flagged'),
  ('unconfirmed_receipt_hours','24', 'S1 keeps Needs you and D4 shows Awaiting store confirmation'),
  ('road_warn_at_or_below',   '50',  'D1 shows (does not block) days with disruption_index at or below this'),
  -- Daily time budgets per vehicle (booklet, Task 2B): Fresh trips 03:30-08:00 = 270 min;
  -- Style and Tech trips share one 480-minute trading-day budget.
  ('fresh_budget_minutes',    '270', 'Total trip minutes a vehicle may spend on Fresh trips in a day'),
  ('fresh_window_start',      '03:30', 'Fresh trips start no earlier than this (depot local time)'),
  ('daytime_budget_minutes',  '480', 'Total trip minutes a vehicle may spend on Style and Tech trips in a day');

CREATE FUNCTION setting_int(p_key text) RETURNS integer LANGUAGE sql STABLE AS
$$ SELECT value::integer FROM wp.setting WHERE key = p_key $$;

-- ================================================================== runs ===
-- A run is one depot's deliveries for one service date. It owns the cutoff.
CREATE TABLE run (
  run_id       integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  depot_id     smallint NOT NULL REFERENCES depot,
  service_date date NOT NULL CHECK (EXTRACT(isodow FROM service_date) <> 7),
  cutoff_at    timestamptz NOT NULL,
  state        run_state NOT NULL DEFAULT 'open',
  UNIQUE (depot_id, service_date),
  UNIQUE (run_id, service_date),
  UNIQUE (run_id, depot_id, service_date)
);

CREATE FUNCTION previous_working_day(d date) RETURNS date LANGUAGE plpgsql STABLE AS $$
DECLARE x date := d - 1;
BEGIN
  WHILE NOT wp.is_working_day(x) LOOP x := x - 1; END LOOP;
  RETURN x;
END $$;

-- Cutoff for a run: the depot's cutoff time on the previous working day, depot time zone.
CREATE FUNCTION run_cutoff(p_depot smallint, p_date date) RETURNS timestamptz LANGUAGE sql STABLE AS $$
  SELECT (wp.previous_working_day(p_date) + d.order_cutoff) AT TIME ZONE d.tz
  FROM wp.depot d WHERE d.depot_id = p_depot
$$;

-- Get or create the run for a depot and date.
CREATE FUNCTION get_run(p_depot smallint, p_date date) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE r integer;
BEGIN
  SELECT run_id INTO r FROM wp.run WHERE depot_id = p_depot AND service_date = p_date;
  IF FOUND THEN RETURN r; END IF;
  IF NOT wp.is_working_day(p_date) THEN
    RAISE EXCEPTION 'WP110: % is not a working day', p_date;
  END IF;
  INSERT INTO wp.run(depot_id, service_date, cutoff_at, state)
  VALUES (p_depot, p_date, wp.run_cutoff(p_depot, p_date),
          CASE WHEN wp.run_cutoff(p_depot, p_date) <= now() THEN 'closed'::wp.run_state ELSE 'open' END)
  ON CONFLICT (depot_id, service_date) DO NOTHING;
  SELECT run_id INTO r FROM wp.run WHERE depot_id = p_depot AND service_date = p_date;
  RETURN r;
END $$;

-- ================================================================= orders ===
CREATE SEQUENCE order_no_seq;

CREATE FUNCTION new_confirmation_no() RETURNS text LANGUAGE sql AS
$$ SELECT 'WP-' || to_char(now() AT TIME ZONE 'Asia/Colombo', 'YYMMDD') || '-'
          || lpad(nextval('wp.order_no_seq')::text, 5, '0') $$;

CREATE TABLE order_header (
  order_id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  confirmation_no text NOT NULL UNIQUE DEFAULT new_confirmation_no(),  -- the proof the order was received
  client_request_id uuid NOT NULL UNIQUE,                              -- makes a retry safe
  outlet_id       integer NOT NULL,
  brand_id        smallint NOT NULL,
  temp            temp_class NOT NULL,
  delivery_date   date NOT NULL CHECK (EXTRACT(isodow FROM delivery_date) <> 7),
  run_id          integer NOT NULL,
  status          order_status NOT NULL DEFAULT 'placed',
  source          text NOT NULL CHECK (source IN ('store', 'dispatcher')),
  placed_by       integer NOT NULL REFERENCES app_user,
  placed_at       timestamptz NOT NULL DEFAULT now(),
  original_delivery_date date NOT NULL,
  deferral_count  smallint NOT NULL DEFAULT 0 CHECK (deferral_count >= 0),
  weight_kg       numeric(10,2) NOT NULL DEFAULT 0 CHECK (weight_kg >= 0),   -- order_weight_kg
  volume_m3       numeric(8,3)  NOT NULL DEFAULT 0 CHECK (volume_m3 >= 0),   -- order_volume_m3
  note            text,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (outlet_id, brand_id) REFERENCES outlet (outlet_id, brand_id),
  FOREIGN KEY (run_id, delivery_date) REFERENCES run (run_id, service_date),
  UNIQUE (order_id, brand_id, temp),
  UNIQUE (order_id, outlet_id),
  UNIQUE (order_id, delivery_date)
);
-- Deferred is a transition, never a resting state: it must be gone by commit.
CREATE FUNCTION assert_not_deferred() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s wp.order_status;
BEGIN
  SELECT status INTO s FROM wp.order_header WHERE order_id = NEW.order_id;     -- current row, not the queued image
  IF s = 'deferred' THEN
    RAISE EXCEPTION 'WP132: order % left in deferred; defer_order() must requeue it', NEW.order_id USING ERRCODE = 'WP132';
  END IF;
  RETURN NULL;
END $$;
-- One regular order per outlet, day and temperature class. Moved orders (deferral_count > 0)
-- may share the day, because a deferral must never be refused for lack of a free slot.
CREATE UNIQUE INDEX order_one_regular ON order_header (outlet_id, delivery_date, temp)
  WHERE deferral_count = 0 AND status <> 'not_delivered';
CREATE INDEX order_run_status_idx ON order_header (run_id, status);
CREATE INDEX order_outlet_date_idx ON order_header (outlet_id, delivery_date DESC);
CREATE TRIGGER order_touch BEFORE UPDATE ON order_header FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE CONSTRAINT TRIGGER order_not_deferred AFTER INSERT OR UPDATE ON order_header
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_not_deferred();

CREATE TABLE order_line (
  order_id   bigint NOT NULL,
  line_no    smallint NOT NULL CHECK (line_no > 0),
  brand_id   smallint NOT NULL,
  temp       temp_class NOT NULL,
  product_id integer NOT NULL,
  qty        numeric(10,2) NOT NULL CHECK (qty > 0),
  PRIMARY KEY (order_id, line_no),
  UNIQUE (order_id, product_id),
  FOREIGN KEY (order_id, brand_id, temp) REFERENCES order_header (order_id, brand_id, temp) ON DELETE CASCADE,
  FOREIGN KEY (product_id, brand_id, temp) REFERENCES product (product_id, brand_id, temp)
);

-- Lines may change only while the order is still Placed (before cutoff).
CREATE FUNCTION lock_order_lines() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s wp.order_status; oid bigint := COALESCE(NEW.order_id, OLD.order_id);
BEGIN
  SELECT status INTO s FROM wp.order_header WHERE order_id = oid;
  IF s IS NOT NULL AND s <> 'placed' THEN
    RAISE EXCEPTION 'WP120: order % lines are locked once the order is %', oid, s USING ERRCODE = 'WP120';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER order_line_lock BEFORE INSERT OR UPDATE OR DELETE ON order_line
  FOR EACH ROW EXECUTE FUNCTION lock_order_lines();

-- Usual order per outlet and temperature class: pre-fills S2. Refreshed on every placed order.
CREATE TABLE outlet_usual_line (
  outlet_id  integer NOT NULL REFERENCES outlet ON DELETE CASCADE,
  temp       temp_class NOT NULL,
  product_id integer NOT NULL REFERENCES product,
  qty        numeric(10,2) NOT NULL CHECK (qty > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (outlet_id, temp, product_id)
);

-- Server-side drafts so a half-filled order follows the manager across devices.
CREATE TABLE order_draft (
  draft_id   uuid PRIMARY KEY,
  outlet_id  integer NOT NULL REFERENCES outlet ON DELETE CASCADE,
  temp       temp_class NOT NULL,
  delivery_date date NOT NULL,
  lines      jsonb NOT NULL CHECK (jsonb_typeof(lines) = 'array'),
  user_id    integer NOT NULL REFERENCES app_user,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (outlet_id, temp, delivery_date)
);

-- Legal status changes. Held as data and enforced by a trigger.
CREATE TABLE order_status_transition (
  from_status order_status NOT NULL,
  to_status   order_status NOT NULL,
  PRIMARY KEY (from_status, to_status)
);
INSERT INTO order_status_transition VALUES
  ('placed','confirmed'),
  ('confirmed','planned'), ('confirmed','deferred'),
  ('planned','confirmed'), ('planned','loading'), ('planned','deferred'),
  ('loading','loaded'), ('loading','planned'),
  ('loaded','on_the_way'), ('loaded','loading'),
  ('on_the_way','delivered'), ('on_the_way','delivered_in_part'),
  ('on_the_way','not_delivered'), ('on_the_way','deferred'),
  ('delivered','received'), ('delivered_in_part','received'),
  ('delivered','delivered_in_part'), ('delivered_in_part','delivered'),   -- driver correction before sync
  ('delivered','not_delivered'), ('delivered_in_part','not_delivered'),
  ('not_delivered','delivered'), ('not_delivered','delivered_in_part'),
  ('not_delivered','confirmed'),                                          -- requeued by dispatcher
  ('deferred','confirmed');                                                -- transient, same transaction

CREATE TABLE order_status_history (
  history_id  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id    bigint NOT NULL REFERENCES order_header,
  from_status order_status,
  to_status   order_status NOT NULL,
  actor_id    integer REFERENCES app_user,
  source      source_kind NOT NULL DEFAULT 'app',
  note        text,
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX osh_order_idx ON order_status_history (order_id, history_id);
CREATE TRIGGER osh_append_only BEFORE UPDATE OR DELETE ON order_status_history
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

CREATE FUNCTION current_actor() RETURNS integer LANGUAGE sql STABLE AS
$$ SELECT NULLIF(current_setting('wp.actor_id', true), '')::integer $$;
CREATE FUNCTION current_source() RETURNS source_kind LANGUAGE sql STABLE AS
$$ SELECT COALESCE(NULLIF(current_setting('wp.source', true), ''), 'app')::wp.source_kind $$;

CREATE FUNCTION order_status_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'placed' THEN
      RAISE EXCEPTION 'WP130: a new order must start as placed' USING ERRCODE = 'WP130';
    END IF;
    INSERT INTO wp.order_status_history(order_id, from_status, to_status, actor_id, source)
    VALUES (NEW.order_id, NULL, NEW.status, COALESCE(wp.current_actor(), NEW.placed_by), wp.current_source());
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT EXISTS (SELECT 1 FROM wp.order_status_transition
                   WHERE from_status = OLD.status AND to_status = NEW.status) THEN
      RAISE EXCEPTION 'WP131: illegal status change % -> % on order %', OLD.status, NEW.status, OLD.order_id
        USING ERRCODE = 'WP131';
    END IF;
    INSERT INTO wp.order_status_history(order_id, from_status, to_status, actor_id, source, note)
    VALUES (NEW.order_id, OLD.status, NEW.status, wp.current_actor(), wp.current_source(),
            NULLIF(current_setting('wp.note', true), ''));
  END IF;
  RETURN NEW;
END $$;
-- History insert needs the order row to exist for the FK, so inserts use AFTER.
CREATE TRIGGER order_status_ins AFTER INSERT ON order_header
  FOR EACH ROW EXECUTE FUNCTION order_status_guard();
CREATE TRIGGER order_status_upd BEFORE UPDATE OF status ON order_header
  FOR EACH ROW EXECUTE FUNCTION order_status_guard();

-- ============================================================== planning ===
CREATE TABLE plan (
  plan_id      integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id       integer NOT NULL,
  depot_id     smallint NOT NULL,
  service_date date NOT NULL,
  state        plan_state NOT NULL DEFAULT 'draft',   -- draft until first release; released after
  version      smallint NOT NULL DEFAULT 0,           -- last released version, 0 = never
  dirty        boolean NOT NULL DEFAULT true,         -- live edits not yet released
  edited_at    timestamptz NOT NULL DEFAULT now(),    -- last live edit, shown as Saved on D1
  created_by   integer NOT NULL REFERENCES app_user,
  created_at   timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (run_id, depot_id, service_date) REFERENCES run (run_id, depot_id, service_date),
  UNIQUE (run_id),                       -- one plan per run; versions are snapshots
  UNIQUE (plan_id, depot_id),
  UNIQUE (plan_id, service_date),
  CHECK ((state = 'draft') = (version = 0))
);

-- Immutable snapshots, one per release. Phones and tablets are served the latest.
CREATE TABLE plan_version (
  plan_id     integer NOT NULL REFERENCES plan,
  version     smallint NOT NULL CHECK (version > 0),
  snapshot    jsonb NOT NULL,
  change_summary jsonb NOT NULL DEFAULT '[]',
  released_by integer NOT NULL REFERENCES app_user,
  released_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (plan_id, version)
);
CREATE TRIGGER plan_version_append_only BEFORE UPDATE OR DELETE ON plan_version
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

CREATE TABLE route (
  route_id     integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  plan_id      integer NOT NULL,
  depot_id     smallint NOT NULL,
  brand_id     smallint NOT NULL REFERENCES brand,      -- a trip carries one brand
  district_id  smallint NOT NULL,                       -- and goes to one district
  vehicle_id   integer NOT NULL,
  driver_id    integer REFERENCES app_user,
  seq          smallint NOT NULL CHECK (seq IN (1, 2)),
  depart_at    timestamptz NOT NULL,
  return_at    timestamptz NOT NULL,
  est_distance_km numeric(7,1) CHECK (est_distance_km >= 0),
  est_fuel_l      numeric(7,2) CHECK (est_fuel_l >= 0),
  estimate_source value_source NOT NULL DEFAULT 'standard',
  trip_minutes integer CHECK (trip_minutes > 0),      -- outbound + inter-stop + handling; set by retime_route
  state        route_state NOT NULL DEFAULT 'planned',
  departed_at  timestamptz,                  -- fact copied from the device event
  CHECK (depart_at < return_at),
  FOREIGN KEY (plan_id, depot_id) REFERENCES plan (plan_id, depot_id),
  FOREIGN KEY (vehicle_id, depot_id) REFERENCES vehicle (vehicle_id, depot_id),
  FOREIGN KEY (district_id, depot_id) REFERENCES district (district_id, depot_id),
  UNIQUE (plan_id, vehicle_id, seq),
  UNIQUE (route_id, plan_id),
  -- A vehicle's two trips cannot overlap in time. (No driver rule: the booklet gives every vehicle a driver.)
  EXCLUDE USING gist (plan_id WITH =, vehicle_id WITH =, tstzrange(depart_at, return_at) WITH &&)
    WHERE (state <> 'cancelled')
);
CREATE INDEX route_driver_idx ON route (driver_id) WHERE driver_id IS NOT NULL;
CREATE INDEX route_vehicle_idx ON route (vehicle_id, depart_at);

CREATE TABLE stop (
  stop_id      integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  route_id     integer NOT NULL,
  plan_id      integer NOT NULL,
  seq          smallint NOT NULL CHECK (seq > 0),
  outlet_id    integer NOT NULL REFERENCES outlet,
  planned_arrival timestamptz NOT NULL,
  arrival_source  value_source NOT NULL DEFAULT 'standard',
  service_minutes smallint NOT NULL CHECK (service_minutes > 0),
  service_source  value_source NOT NULL DEFAULT 'standard',
  deliver_by   timestamptz,                   -- Fresh 08:00, mall close, etc.
  removed_at   timestamptz,
  removed_reason text,
  FOREIGN KEY (route_id, plan_id) REFERENCES route (route_id, plan_id),
  UNIQUE (stop_id, plan_id),
  UNIQUE (stop_id, outlet_id),
  CHECK ((removed_at IS NULL) = (removed_reason IS NULL))
);
CREATE UNIQUE INDEX stop_route_seq ON stop (route_id, seq) WHERE removed_at IS NULL;
CREATE UNIQUE INDEX stop_route_outlet ON stop (route_id, outlet_id) WHERE removed_at IS NULL;
CREATE INDEX stop_outlet_idx ON stop (outlet_id);

-- An order sits on one stop per plan. Removal is soft so facts and history survive.
CREATE TABLE stop_order (
  stop_order_id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  plan_id      integer NOT NULL,
  service_date date NOT NULL,
  stop_id      integer NOT NULL,
  outlet_id    integer NOT NULL,
  order_id     bigint NOT NULL,
  assigned_by  integer REFERENCES app_user,
  assigned_at  timestamptz NOT NULL DEFAULT now(),
  removed_at   timestamptz,
  removed_reason text,
  FOREIGN KEY (stop_id, plan_id) REFERENCES stop (stop_id, plan_id),
  FOREIGN KEY (stop_id, outlet_id) REFERENCES stop (stop_id, outlet_id),
  FOREIGN KEY (plan_id, service_date) REFERENCES plan (plan_id, service_date),
  FOREIGN KEY (order_id, outlet_id) REFERENCES order_header (order_id, outlet_id),
  CHECK ((removed_at IS NULL) = (removed_reason IS NULL))
);
CREATE UNIQUE INDEX stop_order_one_live ON stop_order (plan_id, order_id) WHERE removed_at IS NULL;
CREATE INDEX stop_order_order_idx ON stop_order (order_id);
CREATE INDEX stop_order_stop_idx ON stop_order (stop_id) WHERE removed_at IS NULL;

-- Tentative deferral decisions made on D2, held until the dispatcher confirms.
CREATE TABLE deferral_draft (
  plan_id     integer NOT NULL REFERENCES plan,
  order_id    bigint NOT NULL REFERENCES order_header,
  reason_code text NOT NULL,
  note        text,
  decided_by  integer NOT NULL REFERENCES app_user,
  decided_at  timestamptz NOT NULL DEFAULT now(),
  scope       reason_scope NOT NULL DEFAULT 'deferral' CHECK (scope = 'deferral'),
  PRIMARY KEY (plan_id, order_id),
  FOREIGN KEY (scope, reason_code) REFERENCES reason_code (scope, code)
);


-- =========================================================== sync inbox ===
-- Every action on a phone or tablet is one event. Ingest is idempotent.
CREATE TABLE device_event (
  event_id    uuid PRIMARY KEY,
  device_id   uuid NOT NULL REFERENCES device,
  device_seq  bigint NOT NULL,
  user_id     integer NOT NULL REFERENCES app_user,
  type        text NOT NULL CHECK (type IN
                ('heartbeat','depart','arrive','delivery','flag','load_confirm',
                 'route_release','route_reopen','plan_ack','instruction_on_phone','instruction_seen')),
  route_id    integer REFERENCES route,
  stop_id     integer REFERENCES stop,
  payload     jsonb NOT NULL DEFAULT '{}',
  device_time timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  skew_seconds integer NOT NULL DEFAULT 0,
  skew_flag   boolean NOT NULL DEFAULT false,
  state       event_state,                  -- NULL until applied or rejected
  reject_reason text,
  applied_at  timestamptz,
  UNIQUE (device_id, device_seq),
  CHECK ((state = 'rejected') = (reject_reason IS NOT NULL))
);
CREATE INDEX device_event_route_idx ON device_event (route_id, device_time);
CREATE INDEX device_event_pending_idx ON device_event (received_at) WHERE state IS NULL;
CREATE INDEX device_event_rejected_idx ON device_event (received_at) WHERE state = 'rejected';

-- Payload and identity never change; only the processing outcome may be set, once.
CREATE FUNCTION device_event_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'table wp.device_event is append-only' USING ERRCODE = 'WP001';
  END IF;
  IF (NEW.event_id, NEW.device_id, NEW.device_seq, NEW.user_id, NEW.type, NEW.route_id, NEW.stop_id,
      NEW.payload, NEW.device_time, NEW.received_at, NEW.skew_seconds, NEW.skew_flag)
     IS DISTINCT FROM
     (OLD.event_id, OLD.device_id, OLD.device_seq, OLD.user_id, OLD.type, OLD.route_id, OLD.stop_id,
      OLD.payload, OLD.device_time, OLD.received_at, OLD.skew_seconds, OLD.skew_flag)
     OR (OLD.state IS NOT NULL AND NEW.state IS DISTINCT FROM OLD.state) THEN
    RAISE EXCEPTION 'device_event is append-only; only its outcome may be set, once' USING ERRCODE = 'WP001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER device_event_guard_trg BEFORE UPDATE OR DELETE ON device_event
  FOR EACH ROW EXECUTE FUNCTION device_event_guard();

-- ========================================================= execution facts ==
CREATE TABLE stop_arrival (
  stop_id     integer PRIMARY KEY REFERENCES stop,
  event_id    uuid NOT NULL UNIQUE REFERENCES device_event,
  device_time timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER stop_arrival_append_only BEFORE UPDATE OR DELETE ON stop_arrival
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

CREATE TABLE load_confirmation (
  confirmation_id uuid PRIMARY KEY,
  event_id    uuid NOT NULL REFERENCES device_event,
  route_id    integer NOT NULL REFERENCES route,
  order_id    bigint NOT NULL,
  line_no     smallint NOT NULL,
  qty_loaded  numeric(10,2) NOT NULL CHECK (qty_loaded >= 0),
  plan_version smallint NOT NULL,
  loaded_by   integer NOT NULL REFERENCES app_user,
  device_time timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (order_id, line_no) REFERENCES order_line (order_id, line_no)
);
CREATE INDEX load_conf_line_idx ON load_confirmation (order_id, line_no, device_time DESC);
CREATE INDEX load_conf_route_idx ON load_confirmation (route_id);
CREATE TRIGGER load_conf_append_only BEFORE UPDATE OR DELETE ON load_confirmation
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- Departure release and reopen, signed by the loader's PIN session.
CREATE TABLE route_release (
  release_id  uuid PRIMARY KEY,
  event_id    uuid NOT NULL REFERENCES device_event,
  route_id    integer NOT NULL REFERENCES route,
  kind        text NOT NULL CHECK (kind IN ('release', 'reopen')),
  plan_version smallint NOT NULL,
  loaded_by   integer NOT NULL REFERENCES app_user,
  lines_total smallint,
  lines_confirmed smallint,
  final_weight_kg numeric(8,1),
  final_volume_m3 numeric(6,2),
  device_time timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX route_release_route_idx ON route_release (route_id, device_time);
CREATE TRIGGER route_release_append_only BEFORE UPDATE OR DELETE ON route_release
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- Loader shortfalls and driver problem reports.
CREATE TABLE flag (
  flag_id     uuid PRIMARY KEY,
  event_id    uuid NOT NULL UNIQUE REFERENCES device_event,
  source      flag_source NOT NULL,
  scope       reason_scope GENERATED ALWAYS AS (
                CASE source WHEN 'loader' THEN 'flag_loader'::wp.reason_scope
                            ELSE 'flag_driver'::wp.reason_scope END) STORED,
  type        text NOT NULL,
  route_id    integer NOT NULL REFERENCES route,
  stop_id     integer REFERENCES stop,
  order_id    bigint REFERENCES order_header,
  line_no     smallint,
  qty         numeric(10,2) CHECK (qty >= 0),
  minutes_late smallint CHECK (minutes_late > 0),
  note        text,
  state       flag_state NOT NULL DEFAULT 'open',
  raised_by   integer NOT NULL REFERENCES app_user,
  device_time timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  FOREIGN KEY (scope, type) REFERENCES reason_code (scope, code),
  FOREIGN KEY (order_id, line_no) REFERENCES order_line (order_id, line_no),
  CHECK (line_no IS NULL OR order_id IS NOT NULL)
);
CREATE INDEX flag_open_idx ON flag (route_id, received_at) WHERE state <> 'resolved';

CREATE TABLE instruction (
  instruction_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id    integer NOT NULL REFERENCES route,
  stop_id     integer REFERENCES stop,
  flag_id     uuid REFERENCES flag,
  type        instruction_type NOT NULL,
  payload     jsonb NOT NULL DEFAULT '{}',
  text        text,
  sent_by     integer NOT NULL REFERENCES app_user,
  sent_at     timestamptz NOT NULL DEFAULT now(),
  on_phone_at timestamptz,
  seen_at     timestamptz,
  state       instruction_state NOT NULL DEFAULT 'sent',
  CHECK (type <> 'note' OR text IS NOT NULL)
);
CREATE INDEX instruction_route_idx ON instruction (route_id, sent_at);
CREATE INDEX instruction_unseen_idx ON instruction (route_id) WHERE state IN ('sent', 'on_phone');

-- Plan re-issue after release: who must look at what changed.
CREATE TABLE plan_change (
  change_id   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  plan_id     integer NOT NULL REFERENCES plan,
  version     smallint NOT NULL,
  route_id    integer NOT NULL REFERENCES route,
  changed_stops smallint NOT NULL DEFAULT 0,
  changed_orders smallint NOT NULL DEFAULT 0,
  detail      jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (plan_id, version) REFERENCES plan_version
);
CREATE TABLE plan_change_ack (
  change_id   bigint NOT NULL REFERENCES plan_change,
  audience    text NOT NULL CHECK (audience IN ('loader', 'driver')),
  user_id     integer NOT NULL REFERENCES app_user,
  event_id    uuid REFERENCES device_event,
  acked_at    timestamptz NOT NULL,
  PRIMARY KEY (change_id, audience)
);
CREATE INDEX plan_change_route_idx ON plan_change (route_id, change_id);

-- A plan edit that lost to a fact recorded on a phone (facts win).
CREATE TABLE plan_conflict (
  conflict_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  plan_id     integer NOT NULL REFERENCES plan,
  stop_id     integer REFERENCES stop,
  order_id    bigint REFERENCES order_header,
  detail      text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  acknowledged_by integer REFERENCES app_user,
  acknowledged_at timestamptz
);

-- ================================================================ deliveries
CREATE TABLE delivery (
  delivery_id uuid PRIMARY KEY,                       -- generated on the phone
  event_id    uuid NOT NULL UNIQUE REFERENCES device_event,
  order_id    bigint NOT NULL REFERENCES order_header,
  stop_id     integer NOT NULL REFERENCES stop,
  outcome     delivery_outcome NOT NULL,
  reason_code text,
  reason_scope reason_scope GENERATED ALWAYS AS (
                CASE outcome WHEN 'not_delivered' THEN 'not_delivered'::wp.reason_scope
                             ELSE 'part_delivery'::wp.reason_scope END) STORED,
  received_by text,
  unload      unload_type NOT NULL,
  note        text,
  supersedes_id uuid,
  driver_id   integer NOT NULL REFERENCES app_user,
  device_time timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (delivery_id, order_id),
  FOREIGN KEY (supersedes_id, order_id) REFERENCES delivery (delivery_id, order_id),
  FOREIGN KEY (reason_scope, reason_code) REFERENCES reason_code (scope, code),
  CHECK (outcome <> 'not_delivered' OR reason_code IS NOT NULL),     -- part-delivery reasons live on the lines
  CHECK (outcome = 'not_delivered' OR received_by IS NOT NULL),
  CHECK (supersedes_id IS DISTINCT FROM delivery_id)
);
CREATE UNIQUE INDEX delivery_one_head ON delivery (order_id) WHERE supersedes_id IS NULL;
CREATE UNIQUE INDEX delivery_one_successor ON delivery (supersedes_id) WHERE supersedes_id IS NOT NULL;
CREATE INDEX delivery_stop_idx ON delivery (stop_id);
CREATE TRIGGER delivery_append_only BEFORE UPDATE OR DELETE ON delivery
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

CREATE TABLE delivery_line (
  delivery_id uuid NOT NULL,
  order_id    bigint NOT NULL,
  line_no     smallint NOT NULL,
  ordered_qty numeric(10,2) NOT NULL,
  expected_qty numeric(10,2) NOT NULL,       -- ordered minus any loader shortfall
  delivered_qty numeric(10,2) NOT NULL,
  reason_code text,
  reason_scope reason_scope NOT NULL DEFAULT 'part_delivery' CHECK (reason_scope = 'part_delivery'),
  PRIMARY KEY (delivery_id, line_no),
  FOREIGN KEY (delivery_id, order_id) REFERENCES delivery (delivery_id, order_id),
  FOREIGN KEY (order_id, line_no) REFERENCES order_line (order_id, line_no),
  FOREIGN KEY (reason_scope, reason_code) REFERENCES reason_code (scope, code),
  CHECK (delivered_qty >= 0 AND delivered_qty <= expected_qty AND expected_qty <= ordered_qty),
  CHECK (delivered_qty = expected_qty OR reason_code IS NOT NULL)
);
CREATE TRIGGER delivery_line_append_only BEFORE UPDATE OR DELETE ON delivery_line
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- A delivery and its lines must agree, checked once all rows are in.
CREATE FUNCTION assert_delivery_consistent() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE n_lines integer; n_order integer; n_short integer; n_zero integer;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE delivered_qty < expected_qty),
         count(*) FILTER (WHERE delivered_qty = 0)
    INTO n_lines, n_short, n_zero FROM wp.delivery_line WHERE delivery_id = NEW.delivery_id;
  SELECT count(*) INTO n_order FROM wp.order_line WHERE order_id = NEW.order_id;
  IF NEW.outcome = 'not_delivered' THEN
    IF n_lines <> 0 THEN
      RAISE EXCEPTION 'WP140: a not-delivered record carries no lines' USING ERRCODE = 'WP140';
    END IF;
    RETURN NULL;
  END IF;
  IF n_lines <> n_order THEN
    RAISE EXCEPTION 'WP141: delivery % must record all % order lines (got %)', NEW.delivery_id, n_order, n_lines
      USING ERRCODE = 'WP141';
  END IF;
  IF NEW.outcome = 'delivered' AND n_short > 0 THEN
    RAISE EXCEPTION 'WP142: delivered in full cannot have short lines' USING ERRCODE = 'WP142';
  END IF;
  IF NEW.outcome = 'delivered_in_part' AND n_short = 0 THEN
    RAISE EXCEPTION 'WP143: delivered in part needs at least one short line' USING ERRCODE = 'WP143';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER delivery_consistent AFTER INSERT ON delivery
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_delivery_consistent();

-- ============================================================== store receipts
CREATE TABLE store_receipt (
  receipt_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    bigint NOT NULL UNIQUE REFERENCES order_header,
  delivery_id uuid NOT NULL,
  confirmed_by integer NOT NULL REFERENCES app_user,
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  all_ok      boolean NOT NULL,
  FOREIGN KEY (delivery_id, order_id) REFERENCES delivery (delivery_id, order_id)
);
CREATE TRIGGER store_receipt_append_only BEFORE UPDATE OR DELETE ON store_receipt
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

CREATE SEQUENCE issue_ref_seq;
CREATE TABLE receipt_issue (
  issue_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_no text NOT NULL UNIQUE DEFAULT ('IS-' || lpad(nextval('wp.issue_ref_seq')::text, 6, '0')),
  receipt_id  uuid NOT NULL REFERENCES store_receipt,
  order_id    bigint NOT NULL,
  line_no     smallint NOT NULL,
  type        issue_type NOT NULL,
  qty         numeric(10,2) CHECK (qty > 0),
  note        text,
  FOREIGN KEY (order_id, line_no) REFERENCES order_line (order_id, line_no),
  UNIQUE (receipt_id, line_no),
  CHECK (type = 'not_received' OR qty IS NOT NULL)
);
CREATE TRIGGER receipt_issue_append_only BEFORE UPDATE OR DELETE ON receipt_issue
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- Photos and signatures live in object storage; the database keeps key, size, hash.
CREATE TABLE attachment (
  attachment_id uuid PRIMARY KEY,                     -- generated on the device
  kind        text NOT NULL CHECK (kind IN ('signature', 'photo')),
  delivery_id uuid REFERENCES delivery,
  flag_id     uuid REFERENCES flag,
  issue_id    uuid REFERENCES receipt_issue,
  storage_key text NOT NULL UNIQUE,
  content_type text NOT NULL,
  bytes       integer NOT NULL CHECK (bytes > 0),
  sha256      text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  uploaded_by integer NOT NULL REFERENCES app_user,
  device_time timestamptz NOT NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(delivery_id, flag_id, issue_id) = 1),
  CHECK (kind = 'photo' OR delivery_id IS NOT NULL)
);
CREATE INDEX attachment_delivery_idx ON attachment (delivery_id) WHERE delivery_id IS NOT NULL;
CREATE TRIGGER attachment_append_only BEFORE UPDATE OR DELETE ON attachment
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- ============================================================ deferrals =====
CREATE TABLE deferral (
  deferral_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id    bigint NOT NULL REFERENCES order_header,
  outlet_id   integer NOT NULL REFERENCES outlet,
  temp        temp_class NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('deferred', 'requeued_after_failure')),
  from_date   date NOT NULL,
  to_date     date NOT NULL CHECK (to_date > from_date),
  reason_code text NOT NULL,
  scope       reason_scope NOT NULL,
  note        text,
  consecutive_skip boolean NOT NULL DEFAULT false,   -- second skip in a row, decided by function
  decided_by  integer NOT NULL REFERENCES app_user,
  decided_at  timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (scope, reason_code) REFERENCES reason_code (scope, code),
  CHECK ((kind = 'deferred' AND scope = 'deferral') OR (kind = 'requeued_after_failure' AND scope = 'not_delivered'))
);
CREATE INDEX deferral_outlet_idx ON deferral (outlet_id, from_date DESC);
CREATE INDEX deferral_order_idx ON deferral (order_id);
CREATE TRIGGER deferral_append_only BEFORE UPDATE OR DELETE ON deferral
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- Store notifications: when the store was told and when it read it.
CREATE TABLE notice (
  notice_id   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  outlet_id   integer NOT NULL REFERENCES outlet,
  order_id    bigint REFERENCES order_header,
  deferral_id bigint REFERENCES deferral,
  kind        notice_kind NOT NULL,
  title       text NOT NULL,
  body        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  pushed_at   timestamptz,
  read_at     timestamptz
);
CREATE INDEX notice_outlet_idx ON notice (outlet_id, created_at DESC);
CREATE INDEX notice_unread_idx ON notice (outlet_id) WHERE read_at IS NULL;

-- ================================================================ seam ======
CREATE TABLE prediction (
  prediction_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  subject     text NOT NULL CHECK (subject IN ('service_minutes', 'lateness_minutes', 'demand_qty')),
  stop_id     integer REFERENCES stop,
  outlet_id   integer REFERENCES outlet,
  product_id  integer REFERENCES product,
  target_date date,
  value       numeric NOT NULL,
  model_version text NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(stop_id, outlet_id) >= 1)
);
CREATE INDEX prediction_stop_idx ON prediction (stop_id, subject) WHERE stop_id IS NOT NULL;
CREATE INDEX prediction_outlet_idx ON prediction (outlet_id, subject, target_date) WHERE outlet_id IS NOT NULL;

-- =============================================================== audit ======
CREATE TABLE audit_log (
  audit_id    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at          timestamptz NOT NULL DEFAULT now(),
  actor_id    integer,
  table_name  text NOT NULL,
  op          text NOT NULL,
  row_pk      text NOT NULL,
  old_row     jsonb,
  new_row     jsonb
);
CREATE INDEX audit_table_idx ON audit_log (table_name, row_pk, audit_id);
CREATE INDEX audit_actor_idx ON audit_log (actor_id, at);
CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- order_header is not audited here: order_status_history records every status change, and
-- lines lock at confirmation, so a row image per change would only duplicate it.
-- The row's primary key is passed as a trigger argument (comma-separated column names).
CREATE FUNCTION audit_row() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o jsonb; n jsonb; pk text := '';
        c text;
BEGIN
  IF TG_OP <> 'INSERT' THEN o := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN n := to_jsonb(NEW); END IF;
  FOREACH c IN ARRAY TG_ARGV LOOP
    pk := pk || CASE WHEN pk = '' THEN '' ELSE ',' END || COALESCE((COALESCE(n, o)) ->> c, '');
  END LOOP;
  IF TG_OP = 'UPDATE' AND o = n THEN RETURN NULL; END IF;
  INSERT INTO wp.audit_log(actor_id, table_name, op, row_pk, old_row, new_row)
  VALUES (wp.current_actor(), TG_TABLE_NAME, TG_OP, pk, o, n);
  RETURN NULL;
END $$;

DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT * FROM (VALUES
      ('plan','plan_id'), ('route','route_id'), ('stop','stop_id'), ('stop_order','stop_order_id'),
      ('deferral_draft','plan_id,order_id'), ('instruction','instruction_id'),
      ('outlet','outlet_id'), ('outlet_window','window_id'),
      ('vehicle','vehicle_id'), ('vehicle_class','class_id'), ('fuel_quota','vehicle_id,valid_from'),
      ('product','product_id'), ('app_user','user_id'), ('device','device_id'),
      ('plan_conflict','conflict_id'), ('reason_code','scope,code'),
      ('setting','key'), ('proof_rule','rule_id'), ('depot','depot_id'),
      ('district','district_id'), ('service_allowance','brand_id,unload')
    ) AS v(tbl, pk)
  LOOP
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON wp.%I
                    FOR EACH ROW EXECUTE FUNCTION wp.audit_row(%s)',
                   'audit_' || t.tbl, t.tbl,
                   (SELECT string_agg(quote_literal(x), ',') FROM unnest(string_to_array(t.pk, ',')) x));
  END LOOP;
END $$;


-- ====================================================== reason-note rule ====
-- A reason flagged needs_note must come with a note, on every table that carries one.
CREATE FUNCTION require_reason_note() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE j jsonb := to_jsonb(NEW); sc text; cd text; nt text; need boolean;
BEGIN
  sc := COALESCE(j ->> 'scope', j ->> 'reason_scope');
  cd := COALESCE(j ->> 'reason_code', j ->> 'type');
  nt := j ->> 'note';
  IF cd IS NULL THEN RETURN NEW; END IF;
  SELECT needs_note INTO need FROM wp.reason_code WHERE scope = sc::wp.reason_scope AND code = cd;
  IF need AND NULLIF(btrim(COALESCE(nt, '')), '') IS NULL THEN
    RAISE EXCEPTION 'WP150: reason "%" needs a written note', cd USING ERRCODE = 'WP150';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER deferral_note       BEFORE INSERT OR UPDATE ON deferral       FOR EACH ROW EXECUTE FUNCTION require_reason_note();
CREATE TRIGGER deferral_draft_note BEFORE INSERT OR UPDATE ON deferral_draft FOR EACH ROW EXECUTE FUNCTION require_reason_note();
CREATE TRIGGER flag_note           BEFORE INSERT ON flag                      FOR EACH ROW EXECUTE FUNCTION require_reason_note();
CREATE TRIGGER delivery_note       BEFORE INSERT ON delivery                  FOR EACH ROW EXECUTE FUNCTION require_reason_note();

-- ============================================================ scheduling ====
-- First eligible delivery date for an outlet on or after p_from: an operating day (calendar.csv)
-- whose cutoff (16:00 on the previous operating day) has not passed. The booklet sets no other
-- ordering-day rule, so p_temp is kept only for the signature and the error message.
CREATE FUNCTION next_delivery_date(p_outlet integer, p_temp temp_class, p_from date,
                                   p_now timestamptz DEFAULT now(),
                                   p_respect_cutoff boolean DEFAULT true) RETURNS date
LANGUAGE plpgsql STABLE AS $$
DECLARE d date := p_from; dep smallint; i integer := 0;
BEGIN
  SELECT depot_id INTO dep FROM wp.outlet WHERE outlet_id = p_outlet;
  WHILE i < 60 LOOP
    IF wp.is_working_day(d)
       AND (NOT p_respect_cutoff OR p_now < wp.run_cutoff(dep, d)) THEN
      RETURN d;
    END IF;
    d := d + 1; i := i + 1;
  END LOOP;
  RAISE EXCEPTION 'WP160: outlet % has no % delivery day in the next 60 days', p_outlet, p_temp USING ERRCODE = 'WP160';
END $$;

-- ============================================================= placing =====
-- Weight and volume of an order: summed from its lines, or supplied (phone orders and imports
-- that only carry totals). Capacity checks read these two columns.
CREATE FUNCTION recompute_order_totals(p_order bigint, p_weight numeric DEFAULT NULL, p_volume numeric DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE w numeric; v numeric;
BEGIN
  SELECT COALESCE(p_weight, sum(l.qty * p.unit_weight_kg)), COALESCE(p_volume, sum(l.qty * p.unit_volume_m3))
    INTO w, v FROM wp.order_line l JOIN wp.product p USING (product_id) WHERE l.order_id = p_order;
  IF COALESCE(w, 0) <= 0 OR COALESCE(v, 0) <= 0 THEN
    RAISE EXCEPTION 'WP169: order % needs a weight and a volume', p_order USING ERRCODE = 'WP169';
  END IF;
  UPDATE wp.order_header SET weight_kg = round(w, 2), volume_m3 = round(v, 3) WHERE order_id = p_order;
END $$;

-- p_lines: [{"product_id": 12, "qty": 4}, ...]. Idempotent on p_request_id.
-- Returns the confirmation number. An order is stored only once it has one.
CREATE FUNCTION place_order(p_request_id uuid, p_outlet integer, p_temp temp_class, p_lines jsonb,
                            p_user integer, p_source text DEFAULT 'store', p_date date DEFAULT NULL,
                            p_weight_kg numeric DEFAULT NULL, p_volume_m3 numeric DEFAULT NULL)
RETURNS TABLE (order_id bigint, confirmation_no text, delivery_date date, joined_later_run boolean, created boolean)
LANGUAGE plpgsql AS $$
DECLARE o wp.outlet%ROWTYPE; d date; r integer; rs wp.run_state; rc timestamptz; oid bigint; cno text;
        wanted date; n integer; bad integer;
BEGIN
  SELECT * INTO o FROM wp.outlet WHERE outlet_id = p_outlet AND active;
  IF NOT FOUND THEN RAISE EXCEPTION 'WP161: unknown or inactive outlet %', p_outlet USING ERRCODE = 'WP161'; END IF;
  IF p_source = 'store' THEN
    PERFORM wp.assert_role(p_user, ARRAY['store_manager']);
    IF NOT EXISTS (SELECT 1 FROM wp.app_user WHERE user_id = p_user AND outlet_id = p_outlet) THEN
      RAISE EXCEPTION 'WP010: user % does not manage outlet %', p_user, p_outlet USING ERRCODE = 'WP010';
    END IF;
  ELSE
    PERFORM wp.assert_role(p_user, ARRAY['dispatcher','admin']);
    PERFORM wp.assert_depot(p_user, o.depot_id);
  END IF;

  SELECT h.order_id, h.confirmation_no, h.delivery_date INTO order_id, confirmation_no, delivery_date
  FROM wp.order_header h WHERE h.client_request_id = p_request_id AND h.outlet_id = p_outlet;
  IF FOUND THEN joined_later_run := false; created := false; RETURN NEXT; RETURN; END IF;
  IF jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'WP162: an order needs at least one line' USING ERRCODE = 'WP162';
  END IF;

  -- Delivery day: the requested one if its cutoff is open, else the next scheduled day.
  wanted := COALESCE(p_date, current_date);
  d := wp.next_delivery_date(p_outlet, p_temp, wanted, now(), p_source = 'store');
  IF p_source = 'dispatcher' THEN
    d := wp.next_delivery_date(p_outlet, p_temp, wanted, now(), false);
    r := wp.get_run(o.depot_id, d);
    SELECT state INTO rs FROM wp.run WHERE run_id = r;
    IF rs <> 'open' THEN                       -- run already closed: next scheduled day
      d := wp.next_delivery_date(p_outlet, p_temp, d + 1, now(), false);
    END IF;
  END IF;
  joined_later_run := (p_date IS NOT NULL AND d <> p_date);
  r := wp.get_run(o.depot_id, d);
  SELECT state, cutoff_at INTO rs, rc FROM wp.run WHERE run_id = r;
  IF rs <> 'open' THEN
    RAISE EXCEPTION 'WP163: the run for % is closed', d USING ERRCODE = 'WP163';
  END IF;

  IF EXISTS (SELECT 1 FROM wp.order_header h WHERE h.outlet_id = p_outlet AND h.delivery_date = d AND h.temp = p_temp
             AND h.deferral_count = 0 AND h.status <> 'not_delivered') THEN
    RAISE EXCEPTION 'WP168: outlet already has a % order for % (change it instead)', p_temp, d USING ERRCODE = 'WP168';
  END IF;

  -- Lines must be unique products of this brand and temperature class.
  SELECT count(*), count(DISTINCT (e ->> 'product_id')) INTO n, bad
  FROM jsonb_array_elements(p_lines) e;
  IF n <> bad THEN RAISE EXCEPTION 'WP164: a product appears twice' USING ERRCODE = 'WP164'; END IF;
  SELECT count(*) INTO bad FROM jsonb_array_elements(p_lines) e
  LEFT JOIN wp.product p ON p.product_id = (e ->> 'product_id')::integer
       AND p.brand_id = o.brand_id AND p.temp = p_temp AND p.active
  WHERE p.product_id IS NULL;
  IF bad > 0 THEN RAISE EXCEPTION 'WP165: % line(s) are not active % products of this brand', bad, p_temp USING ERRCODE = 'WP165'; END IF;

  BEGIN
    INSERT INTO wp.order_header(client_request_id, outlet_id, brand_id, temp, delivery_date, run_id,
                                source, placed_by, original_delivery_date)
    VALUES (p_request_id, p_outlet, o.brand_id, p_temp, d, r, p_source, p_user, d)
    RETURNING order_header.order_id, order_header.confirmation_no INTO oid, cno;
  EXCEPTION WHEN unique_violation THEN
    -- A concurrent retry of the same request won the race: return its result.
    SELECT h.order_id, h.confirmation_no, h.delivery_date INTO order_id, confirmation_no, delivery_date
    FROM wp.order_header h WHERE h.client_request_id = p_request_id AND h.outlet_id = p_outlet;
    IF FOUND THEN joined_later_run := false; created := false; RETURN NEXT; RETURN; END IF;
    RAISE EXCEPTION 'WP168: outlet already has a % order for % (change it instead)', p_temp, d USING ERRCODE = 'WP168';
  END;

  INSERT INTO wp.order_line(order_id, line_no, brand_id, temp, product_id, qty)
  SELECT oid, row_number() OVER (ORDER BY ord)::smallint, o.brand_id, p_temp,
         (e ->> 'product_id')::integer, (e ->> 'qty')::numeric
  FROM jsonb_array_elements(p_lines) WITH ORDINALITY AS t(e, ord);

  PERFORM wp.recompute_order_totals(oid, p_weight_kg, p_volume_m3);

  -- Refresh the usual order that pre-fills S2.
  DELETE FROM wp.outlet_usual_line WHERE outlet_id = p_outlet AND temp = p_temp;
  INSERT INTO wp.outlet_usual_line(outlet_id, temp, product_id, qty)
  SELECT p_outlet, p_temp, product_id, qty FROM wp.order_line WHERE order_line.order_id = oid;

  DELETE FROM wp.order_draft WHERE outlet_id = p_outlet AND temp = p_temp AND order_draft.delivery_date = d;

  INSERT INTO wp.notice(outlet_id, order_id, kind, title, body)
  VALUES (p_outlet, oid, 'order_confirmed', 'Order received',
          'Order ' || cno || ' is confirmed for ' || to_char(d, 'Dy DD Mon') ||
          '. Your arrival window appears after the ' || to_char(rc AT TIME ZONE (SELECT tz FROM wp.depot WHERE depot_id = o.depot_id), 'HH24:MI') || ' cutoff.');

  order_id := oid; confirmation_no := cno; delivery_date := d; created := true;
  RETURN NEXT;
END $$;

-- Change a placed order before cutoff (S2 "change order").
CREATE FUNCTION amend_order(p_order bigint, p_lines jsonb, p_user integer) RETURNS void LANGUAGE plpgsql AS $$
DECLARE h wp.order_header%ROWTYPE; rc timestamptz; bad integer;
BEGIN
  SELECT * INTO h FROM wp.order_header WHERE order_id = p_order FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WP166: order % not found', p_order USING ERRCODE = 'WP166'; END IF;
  IF NOT EXISTS (SELECT 1 FROM wp.app_user WHERE user_id = p_user AND active AND
                 ((role = 'store_manager' AND outlet_id = h.outlet_id)
                  OR (role IN ('dispatcher','admin') AND (role = 'admin' OR depot_id = (SELECT depot_id FROM wp.outlet WHERE outlet_id = h.outlet_id))))) THEN
    RAISE EXCEPTION 'WP010: user % may not change order %', p_user, h.confirmation_no USING ERRCODE = 'WP010';
  END IF;
  SELECT cutoff_at INTO rc FROM wp.run WHERE run_id = h.run_id;
  IF h.status <> 'placed' OR (h.source = 'store' AND now() >= rc) THEN
    RAISE EXCEPTION 'WP167: order % can no longer be changed (cutoff passed)', h.confirmation_no USING ERRCODE = 'WP167';
  END IF;
  IF jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'WP162: an order needs at least one line' USING ERRCODE = 'WP162';
  END IF;
  SELECT count(*) INTO bad FROM jsonb_array_elements(p_lines) e
  LEFT JOIN wp.product p ON p.product_id = (e ->> 'product_id')::integer
       AND p.brand_id = h.brand_id AND p.temp = h.temp AND p.active
  WHERE p.product_id IS NULL;
  IF bad > 0 THEN RAISE EXCEPTION 'WP165: % line(s) are not active products for this order', bad USING ERRCODE = 'WP165'; END IF;
  PERFORM set_config('wp.actor_id', p_user::text, true);
  DELETE FROM wp.order_line WHERE order_id = p_order;
  INSERT INTO wp.order_line(order_id, line_no, brand_id, temp, product_id, qty)
  SELECT p_order, row_number() OVER (ORDER BY ord)::smallint, h.brand_id, h.temp,
         (e ->> 'product_id')::integer, (e ->> 'qty')::numeric
  FROM jsonb_array_elements(p_lines) WITH ORDINALITY AS t(e, ord);
  PERFORM wp.recompute_order_totals(p_order);
  DELETE FROM wp.outlet_usual_line WHERE outlet_id = h.outlet_id AND temp = h.temp;
  INSERT INTO wp.outlet_usual_line(outlet_id, temp, product_id, qty)
  SELECT h.outlet_id, h.temp, product_id, qty FROM wp.order_line WHERE order_id = p_order;
END $$;

-- At cutoff: close the run and confirm every placed order. Safe to call repeatedly.
CREATE FUNCTION close_run(p_run integer) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  UPDATE wp.run SET state = 'closed' WHERE run_id = p_run AND state = 'open';
  PERFORM set_config('wp.source', 'system', true);
  UPDATE wp.order_header SET status = 'confirmed' WHERE run_id = p_run AND status = 'placed';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

CREATE FUNCTION cutoff_sweep() RETURNS integer LANGUAGE plpgsql AS $$
DECLARE r record; n integer := 0;
BEGIN
  FOR r IN SELECT run_id FROM wp.run WHERE state = 'open' AND cutoff_at <= now() ORDER BY cutoff_at LOOP
    PERFORM wp.close_run(r.run_id); n := n + 1;
  END LOOP;
  RETURN n;
END $$;


-- ========================================================= load and limits ==
CREATE FUNCTION order_load(p_order bigint) RETURNS TABLE (weight_kg numeric, volume_m3 numeric)
LANGUAGE sql STABLE AS $$
  SELECT h.weight_kg, h.volume_m3 FROM wp.order_header h WHERE h.order_id = p_order
$$;

-- Live load of a route: orders on its live stops.
CREATE FUNCTION route_load(p_route integer) RETURNS TABLE (weight_kg numeric, volume_m3 numeric)
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(sum(h.weight_kg), 0), COALESCE(sum(h.volume_m3), 0)
  FROM wp.stop s
  JOIN wp.stop_order so ON so.stop_id = s.stop_id AND so.removed_at IS NULL
  JOIN wp.order_header h ON h.order_id = so.order_id
  WHERE s.route_id = p_route AND s.removed_at IS NULL
$$;

CREATE FUNCTION route_limits(p_route integer) RETURNS TABLE (max_weight_kg numeric, max_volume_m3 numeric)
LANGUAGE sql STABLE AS $$
  SELECT v.max_weight_kg, v.max_volume_m3 FROM wp.route r JOIN wp.vehicle v USING (vehicle_id) WHERE r.route_id = p_route
$$;

CREATE FUNCTION week_start(d date) RETURNS date LANGUAGE sql IMMUTABLE AS $$ SELECT date_trunc('week', d)::date $$;

-- Quota in force for a vehicle in the week starting p_week; NULL means none set.
CREATE FUNCTION fuel_quota_for(p_vehicle integer, p_week date) RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT litres_per_week FROM wp.fuel_quota
  WHERE vehicle_id = p_vehicle AND valid_from <= p_week ORDER BY valid_from DESC LIMIT 1
$$;

-- Fuel already committed that week by released plans, optionally excluding one plan
-- (the plan being re-released must not count against itself).
CREATE FUNCTION fuel_used_week(p_vehicle integer, p_week date, p_exclude_plan integer DEFAULT NULL) RETURNS numeric
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(sum(r.est_fuel_l), 0)
  FROM wp.route r JOIN wp.plan p USING (plan_id)
  WHERE r.vehicle_id = p_vehicle AND r.state <> 'cancelled' AND p.state = 'released'
    AND p.service_date >= p_week AND p.service_date < p_week + 7
    AND p.plan_id IS DISTINCT FROM p_exclude_plan
$$;

-- Fuel left this week for a vehicle once the given plan's own routes are counted.
CREATE FUNCTION fuel_left(p_vehicle integer, p_plan integer) RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT wp.fuel_quota_for(p_vehicle, wp.week_start(pl.service_date))
         - wp.fuel_used_week(p_vehicle, wp.week_start(pl.service_date), p_plan)
         - COALESCE((SELECT sum(est_fuel_l) FROM wp.route
                     WHERE plan_id = p_plan AND vehicle_id = p_vehicle AND state <> 'cancelled'), 0)
  FROM wp.plan pl WHERE pl.plan_id = p_plan
$$;

-- ============================================================ fit checks ====
-- Static rules for putting one order on one route. Used live by D1 (dimming, refused drops)
-- and again by plan_violations() at release. Returns no rows when the order fits.
CREATE FUNCTION fit_violations(p_order bigint, p_route integer)
RETURNS TABLE (code text, message text) LANGUAGE plpgsql STABLE AS $$
DECLARE o wp.order_header%ROWTYPE; ou wp.outlet%ROWTYPE; r wp.route%ROWTYPE; c wp.vehicle_class%ROWTYPE;
        v wp.vehicle%ROWTYPE; ow numeric; ov numeric; rw numeric; rv numeric; lw numeric; lv numeric;
        already boolean; left_l numeric;
BEGIN
  SELECT * INTO o FROM wp.order_header WHERE order_id = p_order;
  SELECT * INTO ou FROM wp.outlet WHERE outlet_id = o.outlet_id;
  SELECT * INTO r FROM wp.route WHERE route_id = p_route;
  SELECT * INTO v FROM wp.vehicle WHERE vehicle_id = r.vehicle_id;
  SELECT * INTO c FROM wp.vehicle_class WHERE class_id = v.class_id;

  IF ou.brand_id <> r.brand_id THEN
    code := 'brand'; message := 'Trip carries another brand'; RETURN NEXT;
  END IF;
  IF ou.district_id <> r.district_id THEN
    code := 'district'; message := 'Trip goes to another district'; RETURN NEXT;
  END IF;
  IF ou.depot_id <> r.depot_id THEN
    code := 'depot'; message := 'Outlet is served from another depot'; RETURN NEXT;
  END IF;
  IF o.temp = 'chilled' AND NOT c.carries_chilled THEN
    code := 'temperature'; message := 'Can''t carry chilled goods'; RETURN NEXT;
  ELSIF o.temp = 'frozen' AND NOT c.carries_frozen THEN
    code := 'temperature'; message := 'Can''t carry frozen goods'; RETURN NEXT;
  END IF;
  IF ou.van_only AND NOT c.is_van THEN
    code := 'van_only'; message := 'Van-only outlet'; RETURN NEXT;
  END IF;

  SELECT EXISTS (SELECT 1 FROM wp.stop_order so JOIN wp.stop s USING (stop_id)
                 WHERE so.order_id = p_order AND so.removed_at IS NULL AND s.route_id = p_route) INTO already;
  IF NOT already THEN
    SELECT weight_kg, volume_m3 INTO ow, ov FROM wp.order_load(p_order);
    SELECT weight_kg, volume_m3 INTO rw, rv FROM wp.route_load(p_route);
    SELECT max_weight_kg, max_volume_m3 INTO lw, lv FROM wp.route_limits(p_route);
    IF rw + ow > lw THEN
      code := 'weight'; message := format('Weight full: %s kg of %s kg', round(rw + ow), round(lw)); RETURN NEXT;
    END IF;
    IF rv + ov > lv THEN
      code := 'volume'; message := format('Volume full: %s m³ of %s m³', round(rv + ov, 1), round(lv, 1)); RETURN NEXT;
    END IF;
  END IF;

  left_l := wp.fuel_left(r.vehicle_id, r.plan_id);
  IF left_l IS NOT NULL AND left_l < 0 THEN
    code := 'fuel'; message := format('Fuel quota short by %s L this week', round(-left_l, 1)); RETURN NEXT;
  END IF;
END $$;

-- ===================================================== plan-wide validation ==
-- Every blocking problem in a plan. Empty means the plan can be released.
CREATE FUNCTION plan_violations(p_plan integer)
RETURNS TABLE (code text, route_id integer, stop_id integer, order_id bigint, message text)
LANGUAGE plpgsql STABLE AS $$
DECLARE pl wp.plan%ROWTYPE; tz text;
BEGIN
  SELECT * INTO pl FROM wp.plan WHERE plan_id = p_plan;
  SELECT d.tz INTO tz FROM wp.depot d WHERE d.depot_id = pl.depot_id;

  -- Order-to-route rules, set-based: depot, temperature, van-only (capacity and fuel are route-level below).
  RETURN QUERY
  SELECT v.code, s.route_id, s.stop_id, so.order_id, v.msg || ': order ' || h.confirmation_no || ' on ' || ve.code
  FROM wp.stop_order so
  JOIN wp.stop s ON s.stop_id = so.stop_id AND s.removed_at IS NULL
  JOIN wp.route r ON r.route_id = s.route_id AND r.state <> 'cancelled'
  JOIN wp.vehicle ve ON ve.vehicle_id = r.vehicle_id
  JOIN wp.vehicle_class c ON c.class_id = ve.class_id
  JOIN wp.order_header h ON h.order_id = so.order_id
  JOIN wp.outlet ou ON ou.outlet_id = h.outlet_id
  CROSS JOIN LATERAL (VALUES
      ('depot'::text, 'Outlet is served from another depot'::text, ou.depot_id <> r.depot_id),
      ('temperature', CASE h.temp WHEN 'chilled' THEN 'Can''t carry chilled goods' ELSE 'Can''t carry frozen goods' END,
         (h.temp = 'chilled' AND NOT c.carries_chilled) OR (h.temp = 'frozen' AND NOT c.carries_frozen)),
      ('van_only', 'Van-only outlet', ou.van_only AND NOT c.is_van)) v(code, msg, bad)
  WHERE so.plan_id = p_plan AND so.removed_at IS NULL AND v.bad;

  -- Capacity per route.
  RETURN QUERY
  SELECT 'weight'::text, r.route_id, NULL::integer, NULL::bigint,
         format('Weight over limit on %s route %s: %s kg of %s kg', ve.code, r.seq, round(l.weight_kg), round(lim.max_weight_kg))
  FROM wp.route r JOIN wp.vehicle ve USING (vehicle_id)
  CROSS JOIN LATERAL wp.route_load(r.route_id) l CROSS JOIN LATERAL wp.route_limits(r.route_id) lim
  WHERE r.plan_id = p_plan AND r.state <> 'cancelled' AND l.weight_kg > lim.max_weight_kg;
  RETURN QUERY
  SELECT 'volume'::text, r.route_id, NULL::integer, NULL::bigint,
         format('Volume over limit on %s route %s: %s m³ of %s m³', ve.code, r.seq, round(l.volume_m3, 1), round(lim.max_volume_m3, 1))
  FROM wp.route r JOIN wp.vehicle ve USING (vehicle_id)
  CROSS JOIN LATERAL wp.route_load(r.route_id) l CROSS JOIN LATERAL wp.route_limits(r.route_id) lim
  WHERE r.plan_id = p_plan AND r.state <> 'cancelled' AND l.volume_m3 > lim.max_volume_m3;

  -- Only available vehicles may run (a vehicle in the workshop is set inactive).
  RETURN QUERY
  SELECT 'vehicle_unavailable'::text, r.route_id, NULL::integer, NULL::bigint,
         ve.code || ' is not available (workshop)'
  FROM wp.route r JOIN wp.vehicle ve USING (vehicle_id)
  WHERE r.plan_id = p_plan AND r.state <> 'cancelled' AND NOT ve.active;

  -- Daily time budgets per vehicle (booklet): Fresh trips together within 270 min, starting
  -- no earlier than 03:30; Style and Tech trips together within 480 min. Same trip-time formula.
  RETURN QUERY
  SELECT 'time_budget'::text, x.first_route, NULL::integer, NULL::bigint,
         format('%s: %s trips total %s min, budget %s min', x.vehicle_code, x.budget, x.minutes, x.limit_min)
  FROM (
    SELECT ve.code AS vehicle_code, min(r.route_id) AS first_route,
           CASE WHEN b.code = 'F' THEN 'Fresh' ELSE 'Style + Tech' END AS budget,
           sum(wp.trip_minutes(r.route_id)) AS minutes,
           CASE WHEN b.code = 'F' THEN wp.setting_int('fresh_budget_minutes')
                ELSE wp.setting_int('daytime_budget_minutes') END AS limit_min
    FROM wp.route r JOIN wp.vehicle ve USING (vehicle_id) JOIN wp.brand b ON b.brand_id = r.brand_id
    WHERE r.plan_id = p_plan AND r.state <> 'cancelled'
    GROUP BY ve.vehicle_id, ve.code, b.code = 'F'
  ) x
  WHERE x.minutes > x.limit_min;
  RETURN QUERY
  SELECT 'fresh_window'::text, r.route_id, NULL::integer, NULL::bigint,
         format('%s Fresh trip %s departs %s, before the %s start', ve.code, r.seq,
                to_char(r.depart_at AT TIME ZONE tz, 'HH24:MI'),
                (SELECT value FROM wp.setting WHERE key = 'fresh_window_start'))
  FROM wp.route r JOIN wp.vehicle ve USING (vehicle_id) JOIN wp.brand b ON b.brand_id = r.brand_id
  WHERE r.plan_id = p_plan AND r.state <> 'cancelled' AND b.code = 'F'
    AND (r.depart_at AT TIME ZONE tz)::time < (SELECT value::time FROM wp.setting WHERE key = 'fresh_window_start');

  -- A trip must be scheduled long enough for its trip time: outbound travel, inter-stop travel
  -- and the per-stop service allowances. (Two trips of one vehicle cannot overlap: exclusion constraint.)
  RETURN QUERY
  SELECT 'trip_time'::text, r.route_id, NULL::integer, NULL::bigint,
         format('%s trip %s is scheduled for %s min but needs %s', ve.code, r.seq,
                round(extract(epoch FROM r.return_at - r.depart_at) / 60), wp.trip_minutes(r.route_id))
  FROM wp.route r JOIN wp.vehicle ve USING (vehicle_id)
  WHERE r.plan_id = p_plan AND r.state <> 'cancelled'
    AND r.return_at < r.depart_at + make_interval(mins => wp.trip_minutes(r.route_id));

  -- Weekly fuel quota (hard; see open item in the architecture document).
  RETURN QUERY
  SELECT 'fuel'::text, min(r.route_id), NULL::integer, NULL::bigint,
         format('Fuel quota exceeded for %s: %s L left this week', ve.code, round(wp.fuel_left(ve.vehicle_id, p_plan), 1))
  FROM wp.route r JOIN wp.vehicle ve USING (vehicle_id)
  WHERE r.plan_id = p_plan AND r.state <> 'cancelled' AND wp.fuel_left(ve.vehicle_id, p_plan) < 0
  GROUP BY ve.vehicle_id, ve.code;

  -- Windows: every kind of window the outlet has for that weekday must contain the arrival.
  RETURN QUERY
  SELECT 'window'::text, s.route_id, s.stop_id, NULL::bigint,
         format('%s arrival %s is outside its %s window', ou.name,
                to_char(s.planned_arrival AT TIME ZONE tz, 'HH24:MI'), k.kind)
  FROM wp.stop s
  JOIN wp.route r ON r.route_id = s.route_id AND r.state <> 'cancelled'
  JOIN wp.outlet ou ON ou.outlet_id = s.outlet_id
  CROSS JOIN LATERAL (
     SELECT w.kind FROM wp.outlet_window w
     WHERE w.outlet_id = s.outlet_id AND w.isodow = EXTRACT(isodow FROM s.planned_arrival AT TIME ZONE tz)::smallint
     GROUP BY w.kind
  ) k
  WHERE s.plan_id = p_plan AND s.removed_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM wp.outlet_window w
                    WHERE w.outlet_id = s.outlet_id AND w.kind = k.kind
                      AND w.isodow = EXTRACT(isodow FROM s.planned_arrival AT TIME ZONE tz)::smallint
                      AND (s.planned_arrival AT TIME ZONE tz)::time BETWEEN w.opens AND w.closes);

  -- Deliver-by deadlines (Fresh before store opening).
  RETURN QUERY
  SELECT 'deadline'::text, s.route_id, s.stop_id, NULL::bigint,
         format('%s planned %s is after its deliver-by time %s', ou.name,
                to_char(s.planned_arrival AT TIME ZONE tz, 'HH24:MI'), to_char(s.deliver_by AT TIME ZONE tz, 'HH24:MI'))
  FROM wp.stop s JOIN wp.route r ON r.route_id = s.route_id AND r.state <> 'cancelled'
  JOIN wp.outlet ou ON ou.outlet_id = s.outlet_id
  WHERE s.plan_id = p_plan AND s.removed_at IS NULL AND s.deliver_by IS NOT NULL AND s.planned_arrival > s.deliver_by;

  -- Stops must sit inside their route's time span; no empty stops.
  RETURN QUERY
  SELECT 'stop_time'::text, s.route_id, s.stop_id, NULL::bigint,
         'Stop time falls outside the route''s departure and return'::text
  FROM wp.stop s JOIN wp.route r ON r.route_id = s.route_id AND r.state <> 'cancelled'
  WHERE s.plan_id = p_plan AND s.removed_at IS NULL
    AND (s.planned_arrival < r.depart_at OR s.planned_arrival > r.return_at);
  RETURN QUERY
  SELECT 'empty_stop'::text, s.route_id, s.stop_id, NULL::bigint, ou.name || ' has a stop with no orders'
  FROM wp.stop s JOIN wp.outlet ou ON ou.outlet_id = s.outlet_id
  WHERE s.plan_id = p_plan AND s.removed_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM wp.stop_order so WHERE so.stop_id = s.stop_id AND so.removed_at IS NULL);

  -- A vehicle cannot also be on a released route of another plan at the same time.
  RETURN QUERY
  SELECT 'vehicle_overlap'::text, r.route_id, NULL::integer, NULL::bigint,
         ve.code || ' overlaps a released route of another plan'
  FROM wp.route r JOIN wp.vehicle ve USING (vehicle_id)
  JOIN wp.route r2 ON r2.vehicle_id = r.vehicle_id AND r2.plan_id <> r.plan_id AND r2.state <> 'cancelled'
  JOIN wp.plan p2 ON p2.plan_id = r2.plan_id AND p2.state = 'released'
  WHERE r.plan_id = p_plan AND r.state <> 'cancelled'
    AND tstzrange(r.depart_at, r.return_at) && tstzrange(r2.depart_at, r2.return_at);

  -- Orders already loaded or on the road cannot be pulled off their route.
  RETURN QUERY
  SELECT 'order_locked'::text, NULL::integer, NULL::integer, h.order_id,
         'Order ' || h.confirmation_no || ' is ' || h.status || ' and cannot be removed from the plan'
  FROM wp.order_header h
  WHERE h.run_id = pl.run_id AND h.status IN ('loading', 'loaded', 'on_the_way')
    AND NOT EXISTS (SELECT 1 FROM wp.stop_order so WHERE so.order_id = h.order_id AND so.plan_id = p_plan AND so.removed_at IS NULL);
  RETURN QUERY
  SELECT DISTINCT 'order_locked'::text, lc.route_id, NULL::integer, so.order_id,
         'Order ' || h.confirmation_no || ' was loaded on another route; ask the loader to reopen loading'
  FROM wp.stop_order so JOIN wp.stop s ON s.stop_id = so.stop_id
  JOIN wp.order_header h ON h.order_id = so.order_id
  JOIN wp.load_confirmation lc ON lc.order_id = so.order_id AND lc.route_id <> s.route_id
  WHERE so.plan_id = p_plan AND so.removed_at IS NULL AND h.status IN ('loading', 'loaded');

  -- Every confirmed order of the run is either on a stop or deliberately deferred.
  RETURN QUERY
  SELECT 'unplanned'::text, NULL::integer, NULL::integer, h.order_id,
         'Order ' || h.confirmation_no || ' has no vehicle and no deferral decision'
  FROM wp.order_header h
  WHERE h.run_id = pl.run_id AND h.status IN ('confirmed', 'planned')
    AND NOT EXISTS (SELECT 1 FROM wp.stop_order so WHERE so.order_id = h.order_id AND so.plan_id = p_plan AND so.removed_at IS NULL)
    AND NOT EXISTS (SELECT 1 FROM wp.deferral_draft dd WHERE dd.plan_id = p_plan AND dd.order_id = h.order_id);
END $$;

-- ============================================================ plan editing ==
CREATE FUNCTION mark_plan_dirty() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE wp.plan SET dirty = true, edited_at = now()
  WHERE plan_id = COALESCE(NEW.plan_id, OLD.plan_id) AND (NOT dirty OR edited_at < now() - interval '1 second');
  RETURN NULL;
END $$;
CREATE TRIGGER route_dirty_ins AFTER INSERT ON route FOR EACH ROW EXECUTE FUNCTION mark_plan_dirty();
CREATE TRIGGER route_dirty_upd AFTER UPDATE OF vehicle_id, driver_id, seq, depart_at, return_at ON route
  FOR EACH ROW EXECUTE FUNCTION mark_plan_dirty();
CREATE TRIGGER stop_dirty_ins AFTER INSERT ON stop FOR EACH ROW EXECUTE FUNCTION mark_plan_dirty();
CREATE TRIGGER stop_dirty_upd AFTER UPDATE OF seq, outlet_id, planned_arrival, service_minutes, deliver_by, removed_at ON stop
  FOR EACH ROW EXECUTE FUNCTION mark_plan_dirty();
CREATE TRIGGER so_dirty_ins AFTER INSERT ON stop_order FOR EACH ROW EXECUTE FUNCTION mark_plan_dirty();
CREATE TRIGGER so_dirty_upd AFTER UPDATE OF stop_id, removed_at ON stop_order FOR EACH ROW EXECUTE FUNCTION mark_plan_dirty();

-- Orders loaded or moving cannot be pulled off a stop unless a fact on a phone forces it.
CREATE FUNCTION stop_order_lock() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s wp.order_status;
BEGIN
  IF NEW.removed_at IS NOT NULL AND OLD.removed_at IS NULL
     AND COALESCE(current_setting('wp.facts_win', true), '') <> 'on' THEN
    SELECT status INTO s FROM wp.order_header WHERE order_id = NEW.order_id;
    IF s IN ('loading', 'loaded', 'on_the_way', 'delivered', 'delivered_in_part', 'received') THEN
      RAISE EXCEPTION 'WP211: order % is % and cannot be moved off its stop', NEW.order_id, s USING ERRCODE = 'WP211';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER stop_order_lock_trg BEFORE UPDATE ON stop_order FOR EACH ROW EXECUTE FUNCTION stop_order_lock();

CREATE FUNCTION stop_order_date_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d date;
BEGIN
  SELECT delivery_date INTO d FROM wp.order_header WHERE order_id = NEW.order_id;
  IF d <> NEW.service_date THEN
    RAISE EXCEPTION 'WP212: order % is for % but the plan is for %', NEW.order_id, d, NEW.service_date USING ERRCODE = 'WP212';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER stop_order_date_trg BEFORE INSERT ON stop_order FOR EACH ROW EXECUTE FUNCTION stop_order_date_check();

CREATE FUNCTION create_plan(p_run integer, p_actor integer) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE pid integer;
BEGIN
  PERFORM wp.assert_role(p_actor, ARRAY['dispatcher','admin']);
  PERFORM wp.assert_depot(p_actor, (SELECT depot_id FROM wp.run WHERE run_id = p_run));
  PERFORM set_config('wp.actor_id', p_actor::text, true);
  INSERT INTO wp.plan(run_id, depot_id, service_date, created_by)
  SELECT run_id, depot_id, service_date, p_actor FROM wp.run WHERE run_id = p_run
  ON CONFLICT (run_id) DO NOTHING;
  SELECT plan_id INTO pid FROM wp.plan WHERE run_id = p_run;
  RETURN pid;
END $$;

-- Put an order on a stop. Refused with the reason in words if the vehicle cannot take it.
CREATE FUNCTION assign_order(p_order bigint, p_stop integer, p_actor integer) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE s wp.stop%ROWTYPE; h wp.order_header%ROWTYPE; v record; id integer; pl wp.plan%ROWTYPE;
BEGIN
  PERFORM wp.assert_role(p_actor, ARRAY['dispatcher','admin']);
  PERFORM set_config('wp.actor_id', p_actor::text, true);
  SELECT * INTO s FROM wp.stop WHERE stop_id = p_stop AND removed_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'WP213: stop % does not exist', p_stop USING ERRCODE = 'WP213'; END IF;
  SELECT * INTO h FROM wp.order_header WHERE order_id = p_order FOR UPDATE;
  IF h.outlet_id <> s.outlet_id THEN
    RAISE EXCEPTION 'WP214: order % belongs to a different outlet than stop %', p_order, p_stop USING ERRCODE = 'WP214';
  END IF;
  IF h.status NOT IN ('confirmed', 'planned') THEN
    RAISE EXCEPTION 'WP215: order % is % and cannot be assigned', h.confirmation_no, h.status USING ERRCODE = 'WP215';
  END IF;
  SELECT * INTO pl FROM wp.plan WHERE plan_id = s.plan_id;
  PERFORM wp.assert_depot(p_actor, pl.depot_id);
  IF pl.run_id <> h.run_id THEN
    RAISE EXCEPTION 'WP216: order % is not part of this run', h.confirmation_no USING ERRCODE = 'WP216';
  END IF;
  FOR v IN SELECT * FROM wp.fit_violations(p_order, s.route_id) LOOP
    RAISE EXCEPTION 'WP210: %', v.message USING ERRCODE = 'WP210';
  END LOOP;
  UPDATE wp.stop_order SET removed_at = now(), removed_reason = 'moved'
  WHERE plan_id = s.plan_id AND order_id = p_order AND removed_at IS NULL AND stop_id <> p_stop;
  SELECT stop_order_id INTO id FROM wp.stop_order WHERE plan_id = s.plan_id AND order_id = p_order AND removed_at IS NULL;
  IF id IS NULL THEN
    INSERT INTO wp.stop_order(plan_id, service_date, stop_id, outlet_id, order_id, assigned_by)
    VALUES (s.plan_id, pl.service_date, p_stop, s.outlet_id, p_order, p_actor) RETURNING stop_order_id INTO id;
  END IF;
  DELETE FROM wp.deferral_draft WHERE plan_id = s.plan_id AND order_id = p_order;
  RETURN id;
END $$;

CREATE FUNCTION unassign_order(p_plan integer, p_order bigint, p_actor integer, p_reason text DEFAULT 'removed')
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM wp.assert_role(p_actor, ARRAY['dispatcher','admin']);
  PERFORM wp.assert_depot(p_actor, (SELECT depot_id FROM wp.plan WHERE plan_id = p_plan));
  PERFORM set_config('wp.actor_id', p_actor::text, true);
  UPDATE wp.stop_order SET removed_at = now(), removed_reason = p_reason
  WHERE plan_id = p_plan AND order_id = p_order AND removed_at IS NULL;
END $$;

-- Tentative deferral decision on D2; nothing is sent until confirm_deferrals().
CREATE FUNCTION draft_deferral(p_plan integer, p_order bigint, p_reason text, p_note text, p_actor integer)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM wp.assert_role(p_actor, ARRAY['dispatcher','admin']);
  PERFORM wp.assert_depot(p_actor, (SELECT depot_id FROM wp.plan WHERE plan_id = p_plan));
  PERFORM set_config('wp.actor_id', p_actor::text, true);
  PERFORM wp.unassign_order(p_plan, p_order, p_actor, 'deferred');
  INSERT INTO wp.deferral_draft(plan_id, order_id, reason_code, note, decided_by)
  VALUES (p_plan, p_order, p_reason, p_note, p_actor)
  ON CONFLICT (plan_id, order_id) DO UPDATE
    SET reason_code = EXCLUDED.reason_code, note = EXCLUDED.note, decided_by = EXCLUDED.decided_by, decided_at = now();
END $$;

-- Consecutive-skip signal for an order about to be deferred.
CREATE FUNCTION is_consecutive_skip(p_order bigint) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT h.deferral_count >= 1 OR EXISTS (
           SELECT 1 FROM wp.deferral d
           WHERE d.outlet_id = h.outlet_id AND d.temp = h.temp
             AND d.from_date = wp.previous_working_day(h.delivery_date))
  FROM wp.order_header h WHERE h.order_id = p_order
$$;

-- Move an order to its next delivery day, record the decision and tell the store.
CREATE FUNCTION defer_order(p_order bigint, p_reason text, p_note text, p_actor integer)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE h wp.order_header%ROWTYPE; nd date; did bigint; consec boolean; rc record; dep smallint; tz text;
BEGIN
  PERFORM wp.assert_role(p_actor, ARRAY['dispatcher','admin']);
  PERFORM set_config('wp.actor_id', p_actor::text, true);
  SELECT * INTO h FROM wp.order_header WHERE order_id = p_order FOR UPDATE;
  IF h.status NOT IN ('confirmed', 'planned') THEN
    RAISE EXCEPTION 'WP220: order % is % and cannot be deferred', h.confirmation_no, h.status USING ERRCODE = 'WP220';
  END IF;
  IF EXISTS (SELECT 1 FROM wp.stop_order WHERE order_id = p_order AND removed_at IS NULL) THEN
    RAISE EXCEPTION 'WP221: order % is still on a stop; remove it first', h.confirmation_no USING ERRCODE = 'WP221';
  END IF;
  SELECT depot_id INTO dep FROM wp.outlet WHERE outlet_id = h.outlet_id;
  PERFORM wp.assert_depot(p_actor, dep);
  nd := wp.next_delivery_date(h.outlet_id, h.temp, h.delivery_date + 1, now(), false);
  consec := wp.is_consecutive_skip(p_order);

  INSERT INTO wp.deferral(order_id, outlet_id, temp, kind, from_date, to_date, reason_code, scope, note, consecutive_skip, decided_by)
  VALUES (p_order, h.outlet_id, h.temp, 'deferred', h.delivery_date, nd, p_reason, 'deferral', p_note, consec, p_actor)
  RETURNING deferral_id INTO did;

  PERFORM set_config('wp.note', 'Deferred: ' || p_reason, true);
  UPDATE wp.order_header SET status = 'deferred' WHERE order_id = p_order;
  UPDATE wp.order_header SET status = 'confirmed', delivery_date = nd,
         run_id = wp.get_run(dep, nd), deferral_count = deferral_count + 1
  WHERE order_id = p_order;
  PERFORM set_config('wp.note', '', true);

  SELECT store_label INTO rc FROM wp.reason_code WHERE scope = 'deferral' AND code = p_reason;
  INSERT INTO wp.notice(outlet_id, order_id, deferral_id, kind, title, body)
  VALUES (h.outlet_id, p_order, did, 'deferred',
          'Not arriving on ' || to_char(h.delivery_date, 'FMDay'),
          rc.store_label || ' Your order ' || h.confirmation_no || ' moves to ' || to_char(nd, 'FMDay DD Mon') || '.');

  DELETE FROM wp.deferral_draft WHERE order_id = p_order;
  RETURN did;
END $$;

-- Apply all drafted decisions at once (D2 confirm button). All or nothing.
CREATE FUNCTION confirm_deferrals(p_plan integer, p_actor integer) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE d record; n integer := 0;
BEGIN
  PERFORM wp.assert_role(p_actor, ARRAY['dispatcher','admin']);
  PERFORM wp.assert_depot(p_actor, (SELECT depot_id FROM wp.plan WHERE plan_id = p_plan));
  PERFORM set_config('wp.actor_id', p_actor::text, true);
  FOR d IN SELECT order_id, reason_code, note FROM wp.deferral_draft WHERE plan_id = p_plan ORDER BY order_id LOOP
    PERFORM wp.defer_order(d.order_id, d.reason_code, d.note, p_actor);
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;

-- An order the driver could not deliver goes back into the next run.
CREATE FUNCTION requeue_order(p_order bigint, p_reason text, p_note text, p_actor integer)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE h wp.order_header%ROWTYPE; nd date; did bigint; dep smallint;
BEGIN
  PERFORM wp.assert_role(p_actor, ARRAY['dispatcher','admin']);
  PERFORM set_config('wp.actor_id', p_actor::text, true);
  SELECT * INTO h FROM wp.order_header WHERE order_id = p_order FOR UPDATE;
  IF h.status <> 'not_delivered' THEN
    RAISE EXCEPTION 'WP222: order % is % and cannot be requeued', h.confirmation_no, h.status USING ERRCODE = 'WP222';
  END IF;
  SELECT depot_id INTO dep FROM wp.outlet WHERE outlet_id = h.outlet_id;
  PERFORM wp.assert_depot(p_actor, dep);
  nd := wp.next_delivery_date(h.outlet_id, h.temp, h.delivery_date + 1, now(), false);
  INSERT INTO wp.deferral(order_id, outlet_id, temp, kind, from_date, to_date, reason_code, scope, note, consecutive_skip, decided_by)
  VALUES (p_order, h.outlet_id, h.temp, 'requeued_after_failure', h.delivery_date, nd, p_reason, 'not_delivered',
          p_note, wp.is_consecutive_skip(p_order), p_actor) RETURNING deferral_id INTO did;
  UPDATE wp.order_header SET status = 'confirmed', delivery_date = nd, run_id = wp.get_run(dep, nd),
         deferral_count = deferral_count + 1 WHERE order_id = p_order;
  INSERT INTO wp.notice(outlet_id, order_id, deferral_id, kind, title, body)
  VALUES (h.outlet_id, p_order, did, 'deferred', 'Delivery moved',
          'Order ' || h.confirmation_no || ' could not be delivered and moves to ' || to_char(nd, 'FMDay DD Mon') || '.');
  RETURN did;
END $$;

-- ============================================ trips: one brand, one district ===
CREATE FUNCTION stop_matches_route() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r wp.route%ROWTYPE; ou wp.outlet%ROWTYPE;
BEGIN
  SELECT * INTO r FROM wp.route WHERE route_id = NEW.route_id;
  SELECT * INTO ou FROM wp.outlet WHERE outlet_id = NEW.outlet_id;
  IF ou.brand_id <> r.brand_id OR ou.district_id <> r.district_id THEN
    RAISE EXCEPTION 'WP240: a trip serves one brand and one district; outlet % is another brand or district', ou.code
      USING ERRCODE = 'WP240';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER stop_matches_route_trg BEFORE INSERT OR UPDATE OF route_id, outlet_id ON stop
  FOR EACH ROW EXECUTE FUNCTION stop_matches_route();

CREATE FUNCTION route_matches_stops() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM wp.stop s JOIN wp.outlet ou ON ou.outlet_id = s.outlet_id
             WHERE s.route_id = NEW.route_id AND s.removed_at IS NULL
               AND (ou.brand_id <> NEW.brand_id OR ou.district_id <> NEW.district_id)) THEN
    RAISE EXCEPTION 'WP240: route % has stops of another brand or district', NEW.route_id USING ERRCODE = 'WP240';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER route_matches_stops_trg BEFORE UPDATE OF brand_id, district_id ON route
  FOR EACH ROW EXECUTE FUNCTION route_matches_stops();

-- trip_minutes = outbound travel (once) + inter-stop travel x (orders - 1) + handling for every order.
-- The return journey is not added. Travel uses free-flow minutes, as the brief states.
CREATE FUNCTION trip_minutes(p_route integer) RETURNS integer LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN n.orders = 0 THEN 0
         ELSE (d.depot_to_district_freeflow_min + d.inter_stop_freeflow_min * (n.orders - 1) + n.handling)::integer END
  FROM wp.route r
  JOIN wp.district d ON d.district_id = r.district_id
  CROSS JOIN LATERAL (
     SELECT count(*)::integer AS orders, COALESCE(sum(sa.minutes), 0) AS handling
     FROM wp.stop s
     JOIN wp.stop_order so ON so.stop_id = s.stop_id AND so.removed_at IS NULL
     JOIN wp.outlet ou ON ou.outlet_id = s.outlet_id
     LEFT JOIN wp.service_allowance sa ON sa.brand_id = r.brand_id AND sa.unload = ou.unload
     WHERE s.route_id = r.route_id AND s.removed_at IS NULL) n
  WHERE r.route_id = p_route
$$;

-- Assisted planning: set every stop's planned arrival, the trip's return time, distance and fuel
-- from the district table and the service allowances. Deterministic; no optimiser involved.
-- A vehicle that arrives before the outlet's window opens waits until it opens (booklet), so the
-- planned arrival is never before the window; the return time covers any waiting.
CREATE FUNCTION retime_route(p_route integer, p_actor integer) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE r wp.route%ROWTYPE; d wp.district%ROWTYPE; v wp.vehicle%ROWTYPE; tz text; opens_at timestamptz;
        t timestamptz; s record; first boolean := true; tm integer; norders integer := 0; svc integer;
BEGIN
  PERFORM wp.assert_role(p_actor, ARRAY['dispatcher', 'admin']);
  SELECT * INTO r FROM wp.route WHERE route_id = p_route FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WP250: route % not found', p_route USING ERRCODE = 'WP250'; END IF;
  PERFORM wp.assert_depot(p_actor, r.depot_id);
  PERFORM set_config('wp.actor_id', p_actor::text, true);
  SELECT * INTO d FROM wp.district WHERE district_id = r.district_id;
  SELECT * INTO v FROM wp.vehicle WHERE vehicle_id = r.vehicle_id;
  SELECT dp.tz INTO tz FROM wp.depot dp WHERE dp.depot_id = r.depot_id;
  t := r.depart_at + make_interval(mins => d.depot_to_district_freeflow_min);
  FOR s IN
    SELECT st.stop_id, st.outlet_id,
           (SELECT count(*) FROM wp.stop_order so WHERE so.stop_id = st.stop_id AND so.removed_at IS NULL)::integer AS m,
           (SELECT COALESCE(sum(sa.minutes), 0) FROM wp.stop_order so
              JOIN wp.service_allowance sa ON sa.brand_id = r.brand_id AND sa.unload = ou.unload
             WHERE so.stop_id = st.stop_id AND so.removed_at IS NULL)::integer AS handling
    FROM wp.stop st JOIN wp.outlet ou ON ou.outlet_id = st.outlet_id
    WHERE st.route_id = p_route AND st.removed_at IS NULL ORDER BY st.seq
  LOOP
    CONTINUE WHEN s.m = 0;
    IF NOT first THEN t := t + make_interval(mins => d.inter_stop_freeflow_min); END IF;
    first := false;
    SELECT min(((t AT TIME ZONE tz)::date + w.opens) AT TIME ZONE tz) INTO opens_at
    FROM wp.outlet_window w
    WHERE w.outlet_id = s.outlet_id AND w.isodow = EXTRACT(isodow FROM t AT TIME ZONE tz)::smallint;
    IF opens_at IS NOT NULL AND t < opens_at THEN t := opens_at; END IF;     -- wait for the window
    svc := s.handling + (s.m - 1) * d.inter_stop_freeflow_min;   -- handling plus legs between orders at this stop
    UPDATE wp.stop SET planned_arrival = t, arrival_source = 'standard',
           service_minutes = GREATEST(1, svc)::smallint, service_source = 'standard'
    WHERE stop_id = s.stop_id;
    t := t + make_interval(mins => svc);
    norders := norders + s.m;
  END LOOP;
  tm := wp.trip_minutes(p_route);
  UPDATE wp.route SET
    trip_minutes = NULLIF(tm, 0),
    return_at = GREATEST(depart_at + make_interval(mins => GREATEST(tm, 1)), t),   -- t: end of the last stop
    -- Route distance (out, between stops, back) is what consumes the weekly fuel quota.
    est_distance_km = CASE WHEN norders = 0 THEN 0 ELSE 2 * d.depot_to_district_km + d.inter_stop_km * (norders - 1) END,
    est_fuel_l = CASE WHEN norders = 0 THEN 0
                 ELSE round(((2 * d.depot_to_district_km + d.inter_stop_km * (norders - 1)) / v.km_per_l)::numeric, 2) END,
    estimate_source = 'standard'
  WHERE route_id = p_route;
  RETURN tm;
END $$;


-- ========================================================= proof rules ======
-- Rules combine: any matching row can require a signature or a photo.
CREATE FUNCTION proof_required(p_brand smallint, p_unload unload_type)
RETURNS TABLE (need_signature boolean, need_photo boolean) LANGUAGE sql STABLE AS $$
  SELECT COALESCE(bool_or(need_signature), false), COALESCE(bool_or(need_photo), false)
  FROM wp.proof_rule
  WHERE (brand_id IS NULL OR brand_id = p_brand) AND (unload IS NULL OR unload = p_unload)
$$;

-- ===================================================== plan snapshot ========
-- Everything a phone or tablet needs to work offline for one plan version.
CREATE FUNCTION build_plan_snapshot(p_plan integer, p_version smallint) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'plan_id', pl.plan_id, 'version', p_version, 'run_id', pl.run_id,
    'depot_id', pl.depot_id, 'service_date', pl.service_date,
    'routes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'route_id', r.route_id, 'seq', r.seq, 'vehicle_id', r.vehicle_id, 'vehicle_code', ve.code,
        'vehicle_class', vc.name, 'refrigerated', vc.carries_chilled,
        'brand_id', r.brand_id, 'district_id', r.district_id,
        'driver_id', r.driver_id, 'depart_at', r.depart_at, 'return_at', r.return_at,
        'stops', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'stop_id', s.stop_id, 'seq', s.seq, 'planned_arrival', s.planned_arrival,
            'deliver_by', s.deliver_by, 'service_minutes', s.service_minutes,
            'outlet', jsonb_build_object('outlet_id', ou.outlet_id, 'code', ou.code, 'name', ou.name,
                        'brand', b.code, 'address', ou.address, 'unload', ou.unload,
                        'access_note', ou.access_note, 'contact_name', ou.gate_contact_name,
                        'contact_phone', ou.gate_contact_phone),
            'proof', (SELECT to_jsonb(x) FROM wp.proof_required(ou.brand_id, ou.unload) x),
            'orders', COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                'order_id', h.order_id, 'ref', h.confirmation_no, 'temp', h.temp,
                'deferral_count', h.deferral_count,
                'lines', (SELECT jsonb_agg(jsonb_build_object(
                            'line_no', l.line_no, 'product_id', l.product_id, 'sku', pr.sku, 'name', pr.name,
                            'qty', l.qty, 'unit', pr.unit, 'fragile', pr.fragile, 'hanging', pr.hanging,
                            'temp', pr.temp) ORDER BY l.line_no)
                          FROM wp.order_line l JOIN wp.product pr USING (product_id) WHERE l.order_id = h.order_id)
              ) ORDER BY h.order_id)
              FROM wp.stop_order so JOIN wp.order_header h ON h.order_id = so.order_id
              WHERE so.stop_id = s.stop_id AND so.removed_at IS NULL), '[]'::jsonb)
          ) ORDER BY s.seq)
          FROM wp.stop s JOIN wp.outlet ou ON ou.outlet_id = s.outlet_id JOIN wp.brand b ON b.brand_id = ou.brand_id
          WHERE s.route_id = r.route_id AND s.removed_at IS NULL), '[]'::jsonb)
      ) ORDER BY r.depart_at, r.route_id)
      FROM wp.route r JOIN wp.vehicle ve ON ve.vehicle_id = r.vehicle_id
      JOIN wp.vehicle_class vc ON vc.class_id = ve.class_id
      WHERE r.plan_id = pl.plan_id AND r.state <> 'cancelled'), '[]'::jsonb))
  FROM wp.plan pl WHERE pl.plan_id = p_plan
$$;

-- Flatten a snapshot to comparable tuples: one per order on a stop, plus one per route header.
CREATE FUNCTION snapshot_tuples(p_snap jsonb)
RETURNS TABLE (route_id integer, stop_id integer, order_id bigint, arrival text, detail text)
LANGUAGE sql IMMUTABLE AS $$
  SELECT (r ->> 'route_id')::integer, (s ->> 'stop_id')::integer, (o ->> 'order_id')::bigint,
         s ->> 'planned_arrival', (s ->> 'seq')
  FROM jsonb_array_elements(p_snap -> 'routes') r,
       jsonb_array_elements(r -> 'stops') s,
       jsonb_array_elements(s -> 'orders') o
  UNION ALL
  SELECT (r ->> 'route_id')::integer, NULL, NULL,
         concat_ws('|', r ->> 'vehicle_id', r ->> 'driver_id', r ->> 'depart_at', r ->> 'return_at'), 'route'
  FROM jsonb_array_elements(p_snap -> 'routes') r
$$;

-- ================================================================ release ===
-- Validate, snapshot, mark orders planned, and queue acknowledgements for changed routes.
CREATE FUNCTION release_plan(p_plan integer, p_actor integer) RETURNS smallint LANGUAGE plpgsql AS $$
DECLARE pl wp.plan%ROWTYPE; v smallint; prev jsonb; snap jsonb; n integer; first_msg text; all_msg text;
        tz text; win integer := wp.setting_int('arrival_window_minutes');
BEGIN
  PERFORM wp.assert_role(p_actor, ARRAY['dispatcher','admin']);
  PERFORM set_config('wp.actor_id', p_actor::text, true);
  SELECT * INTO pl FROM wp.plan WHERE plan_id = p_plan FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WP200: plan % not found', p_plan USING ERRCODE = 'WP200'; END IF;
  PERFORM wp.assert_depot(p_actor, pl.depot_id);
  IF pl.state = 'released' AND NOT pl.dirty THEN RETURN pl.version; END IF;   -- nothing to re-issue
  SELECT d.tz INTO tz FROM wp.depot d WHERE d.depot_id = pl.depot_id;

  SELECT count(*), min(message), string_agg(message, E'\n' ORDER BY code, message)
    INTO n, first_msg, all_msg FROM wp.plan_violations(p_plan);
  IF n > 0 THEN
    RAISE EXCEPTION 'WP201: % problem(s) block release. First: %', n, first_msg
      USING ERRCODE = 'WP201', DETAIL = all_msg;
  END IF;

  v := pl.version + 1;
  SELECT snapshot INTO prev FROM wp.plan_version WHERE plan_id = p_plan AND version = pl.version;
  snap := wp.build_plan_snapshot(p_plan, v);

  INSERT INTO wp.plan_version(plan_id, version, snapshot, released_by) VALUES (p_plan, v, snap, p_actor);

  -- Per-route change records, only from the second release on.
  IF prev IS NOT NULL THEN
    INSERT INTO wp.plan_change(plan_id, version, route_id, changed_stops, changed_orders, detail)
    SELECT p_plan, v, x.route_id,
           count(DISTINCT x.stop_id) FILTER (WHERE x.stop_id IS NOT NULL)::smallint,
           count(DISTINCT x.order_id) FILTER (WHERE x.order_id IS NOT NULL)::smallint,
           jsonb_build_object('stops', COALESCE(jsonb_agg(DISTINCT x.stop_id) FILTER (WHERE x.stop_id IS NOT NULL), '[]'),
                              'orders', COALESCE(jsonb_agg(DISTINCT x.order_id) FILTER (WHERE x.order_id IS NOT NULL), '[]'),
                              'route_header_changed', bool_or(x.stop_id IS NULL))
    FROM (
      SELECT route_id, stop_id, order_id FROM (
        (SELECT * FROM wp.snapshot_tuples(snap) EXCEPT SELECT * FROM wp.snapshot_tuples(prev))
        UNION ALL
        (SELECT * FROM wp.snapshot_tuples(prev) EXCEPT SELECT * FROM wp.snapshot_tuples(snap))
      ) d
    ) x
    WHERE x.route_id IN (SELECT route_id FROM wp.route WHERE plan_id = p_plan)
    GROUP BY x.route_id;
  END IF;

  -- Arrival-window notices for orders newly planned or whose arrival moved.
  INSERT INTO wp.notice(outlet_id, order_id, kind, title, body)
  SELECT h.outlet_id, h.order_id, 'arrival_window', 'Arrival window',
         'Order ' || h.confirmation_no || ' arrives ' || to_char(s.planned_arrival AT TIME ZONE tz - make_interval(mins => win), 'HH24:MI')
         || '–' || to_char(s.planned_arrival AT TIME ZONE tz + make_interval(mins => win), 'HH24:MI')
         || ' on ' || to_char(pl.service_date, 'FMDay DD Mon') || '.'
  FROM wp.stop_order so JOIN wp.stop s ON s.stop_id = so.stop_id
  JOIN wp.order_header h ON h.order_id = so.order_id
  WHERE so.plan_id = p_plan AND so.removed_at IS NULL AND s.removed_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM wp.snapshot_tuples(prev) t
                    WHERE prev IS NOT NULL AND t.order_id = so.order_id AND t.arrival = s.planned_arrival::text);

  -- Statuses: kept orders become planned; dropped orders return to confirmed.
  UPDATE wp.order_header h SET status = 'planned'
  WHERE h.run_id = pl.run_id AND h.status = 'confirmed'
    AND EXISTS (SELECT 1 FROM wp.stop_order so WHERE so.order_id = h.order_id AND so.plan_id = p_plan AND so.removed_at IS NULL);
  UPDATE wp.order_header h SET status = 'confirmed'
  WHERE h.run_id = pl.run_id AND h.status = 'planned'
    AND NOT EXISTS (SELECT 1 FROM wp.stop_order so WHERE so.order_id = h.order_id AND so.plan_id = p_plan AND so.removed_at IS NULL);

  UPDATE wp.plan SET state = 'released', version = v, dirty = false WHERE plan_id = p_plan;
  UPDATE wp.run SET state = 'planned' WHERE run_id = pl.run_id AND state IN ('open', 'closed');
  RETURN v;
END $$;

-- "Start from yesterday's routes": copy a source plan's routes and stops for one brand,
-- shift them to this plan's date, then attach this run's confirmed orders where they fit.
CREATE FUNCTION seed_plan_from_previous(p_plan integer, p_source_plan integer, p_brand smallint, p_actor integer)
RETURNS TABLE (routes_copied integer, orders_attached integer, orders_skipped integer)
LANGUAGE plpgsql AS $$
DECLARE pl wp.plan%ROWTYPE; src wp.plan%ROWTYPE; shift interval; sr record; nr integer; ss record; nst integer;
        o record; a integer := 0; k integer := 0; rc integer := 0;
BEGIN
  PERFORM wp.assert_role(p_actor, ARRAY['dispatcher','admin']);
  PERFORM set_config('wp.actor_id', p_actor::text, true);
  SELECT * INTO pl FROM wp.plan WHERE plan_id = p_plan FOR UPDATE;
  SELECT * INTO src FROM wp.plan WHERE plan_id = p_source_plan;
  PERFORM wp.assert_depot(p_actor, pl.depot_id);
  IF pl.depot_id <> src.depot_id THEN RAISE EXCEPTION 'WP230: source plan is for another depot' USING ERRCODE = 'WP230'; END IF;
  IF EXISTS (SELECT 1 FROM wp.route WHERE plan_id = p_plan) THEN
    RAISE EXCEPTION 'WP231: plan % already has routes', p_plan USING ERRCODE = 'WP231';
  END IF;
  shift := make_interval(days => pl.service_date - src.service_date);

  FOR sr IN
    SELECT r.* FROM wp.route r
    WHERE r.plan_id = p_source_plan AND r.state <> 'cancelled'
      AND r.brand_id = p_brand
      AND (SELECT active FROM wp.vehicle WHERE vehicle_id = r.vehicle_id)
    ORDER BY r.depart_at
  LOOP
    INSERT INTO wp.route(plan_id, depot_id, brand_id, district_id, vehicle_id, driver_id, seq, depart_at, return_at,
                         est_distance_km, est_fuel_l, estimate_source, trip_minutes)
    VALUES (p_plan, pl.depot_id, sr.brand_id, sr.district_id, sr.vehicle_id, sr.driver_id, sr.seq, sr.depart_at + shift, sr.return_at + shift,
            sr.est_distance_km, sr.est_fuel_l, sr.estimate_source, sr.trip_minutes)
    RETURNING route_id INTO nr;
    rc := rc + 1;
    FOR ss IN SELECT s.* FROM wp.stop s JOIN wp.outlet ou USING (outlet_id)
              WHERE s.route_id = sr.route_id AND s.removed_at IS NULL AND ou.brand_id = p_brand ORDER BY s.seq LOOP
      INSERT INTO wp.stop(route_id, plan_id, seq, outlet_id, planned_arrival, service_minutes, deliver_by)
      VALUES (nr, p_plan, ss.seq, ss.outlet_id, ss.planned_arrival + shift, ss.service_minutes, ss.deliver_by + shift)
      RETURNING stop_id INTO nst;
      FOR o IN SELECT h.order_id FROM wp.order_header h
               WHERE h.run_id = pl.run_id AND h.outlet_id = ss.outlet_id AND h.status IN ('confirmed', 'planned')
                 AND NOT EXISTS (SELECT 1 FROM wp.stop_order x WHERE x.order_id = h.order_id AND x.plan_id = p_plan AND x.removed_at IS NULL)
      LOOP
        BEGIN
          PERFORM wp.assign_order(o.order_id, nst, p_actor);
          a := a + 1;
        EXCEPTION WHEN SQLSTATE 'WP210' THEN k := k + 1;   -- stays in the unplanned queue
        END;
      END LOOP;
    END LOOP;
  END LOOP;
  routes_copied := rc; orders_attached := a; orders_skipped := k;
  RETURN NEXT;
END $$;


-- =========================================================== sync ingest ====
-- Not-ready errors keep an event pending instead of rejecting it (for example a depart
-- event that reaches the server before the loader tablet's release has synced).
CREATE FUNCTION not_ready(p_msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '%', p_msg USING ERRCODE = 'WP399'; END $$;

CREATE FUNCTION ingest_event(p_event_id uuid, p_device uuid, p_seq bigint, p_user integer, p_type text,
                             p_route integer, p_stop integer, p_payload jsonb,
                             p_device_time timestamptz, p_client_now timestamptz)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE d wp.device%ROWTYPE; u wp.app_user%ROWTYPE; skew integer; bad text; rid integer; sid integer; ins integer;
BEGIN
  SELECT * INTO d FROM wp.device WHERE device_id = p_device AND active;
  IF NOT FOUND THEN RAISE EXCEPTION 'WP300: unregistered or inactive device' USING ERRCODE = 'WP300'; END IF;
  SELECT * INTO u FROM wp.app_user WHERE user_id = p_user AND active;
  IF NOT FOUND THEN RAISE EXCEPTION 'WP301: unknown or inactive user' USING ERRCODE = 'WP301'; END IF;
  IF d.kind = 'driver_phone' AND (u.role <> 'driver' OR d.user_id IS DISTINCT FROM p_user) THEN
    RAISE EXCEPTION 'WP302: this phone belongs to another driver' USING ERRCODE = 'WP302';
  END IF;
  IF d.kind = 'loader_tablet' AND u.role <> 'loader' THEN
    RAISE EXCEPTION 'WP303: only a signed-in loader may act on a dock tablet' USING ERRCODE = 'WP303';
  END IF;

  skew := round(EXTRACT(epoch FROM (p_client_now - now())))::integer;
  rid := p_route; sid := p_stop;
  IF rid IS NOT NULL AND NOT EXISTS (SELECT 1 FROM wp.route WHERE route_id = rid) THEN
    bad := 'route ' || rid || ' does not exist'; rid := NULL;
  END IF;
  IF sid IS NOT NULL AND NOT EXISTS (SELECT 1 FROM wp.stop WHERE stop_id = sid) THEN
    bad := COALESCE(bad || '; ', '') || 'stop ' || sid || ' does not exist'; sid := NULL;
  END IF;

  INSERT INTO wp.device_event(event_id, device_id, device_seq, user_id, type, route_id, stop_id, payload,
                              device_time, skew_seconds, skew_flag, state, reject_reason, applied_at)
  VALUES (p_event_id, p_device, p_seq, p_user, p_type, rid, sid, COALESCE(p_payload, '{}'), p_device_time, skew,
          abs(skew) > wp.setting_int('clock_skew_tolerance_s'),
          CASE WHEN bad IS NULL THEN NULL ELSE 'rejected'::wp.event_state END, bad,
          CASE WHEN bad IS NULL THEN NULL ELSE now() END)
  ON CONFLICT (event_id) DO NOTHING;
  GET DIAGNOSTICS ins = ROW_COUNT;

  UPDATE wp.device SET last_seen_at = now(), last_sync_at = now(), last_skew_seconds = skew WHERE device_id = p_device;
  IF ins = 0 THEN RETURN false; END IF;               -- repeat: ignored, still acknowledged
  IF bad IS NULL THEN PERFORM wp.apply_event(p_event_id); END IF;
  RETURN true;
END $$;

-- Cheap contact signal for D3's No signal state (any authenticated request may call it).
CREATE FUNCTION touch_device(p_device uuid) RETURNS void LANGUAGE sql AS
$$ UPDATE wp.device SET last_seen_at = now() WHERE device_id = p_device $$;

CREATE FUNCTION apply_event(p_event_id uuid) RETURNS text LANGUAGE plpgsql AS $$
DECLARE e wp.device_event%ROWTYPE;
BEGIN
  SELECT * INTO e FROM wp.device_event WHERE event_id = p_event_id FOR UPDATE;
  IF e.state IS NOT NULL THEN RETURN e.state::text; END IF;
  BEGIN
    PERFORM set_config('wp.actor_id', e.user_id::text, true);
    PERFORM set_config('wp.source', 'device', true);
    CASE e.type
      WHEN 'heartbeat' THEN NULL;
      WHEN 'depart' THEN PERFORM wp.apply_depart(e);
      WHEN 'arrive' THEN PERFORM wp.apply_arrive(e);
      WHEN 'delivery' THEN PERFORM wp.apply_delivery(e);
      WHEN 'flag' THEN PERFORM wp.apply_flag(e);
      WHEN 'load_confirm' THEN PERFORM wp.apply_load_confirm(e);
      WHEN 'route_release' THEN PERFORM wp.apply_route_release(e);
      WHEN 'route_reopen' THEN PERFORM wp.apply_route_reopen(e);
      WHEN 'plan_ack' THEN PERFORM wp.apply_plan_ack(e);
      WHEN 'instruction_on_phone', 'instruction_seen' THEN PERFORM wp.apply_instruction_seen(e);
    END CASE;
    UPDATE wp.device_event SET state = 'applied', applied_at = now() WHERE event_id = p_event_id;
    RETURN 'applied';
  EXCEPTION
    WHEN SQLSTATE 'WP399' THEN RETURN 'pending';
    WHEN OTHERS THEN
      UPDATE wp.device_event SET state = 'rejected', reject_reason = SQLERRM, applied_at = now() WHERE event_id = p_event_id;
      RETURN 'rejected';
  END;
END $$;

-- Job: retry pending events in device order; reject any that wait more than 6 hours.
CREATE FUNCTION apply_pending_events() RETURNS integer LANGUAGE plpgsql AS $$
DECLARE r record; n integer := 0; res text;
BEGIN
  FOR r IN SELECT event_id, received_at FROM wp.device_event WHERE state IS NULL ORDER BY device_time, device_seq LOOP
    res := wp.apply_event(r.event_id);
    IF res = 'pending' AND r.received_at < now() - interval '6 hours' THEN
      UPDATE wp.device_event SET state = 'rejected', applied_at = now(),
             reject_reason = 'WP398: the record this event depends on never arrived' WHERE event_id = r.event_id;
    ELSIF res <> 'pending' THEN n := n + 1; END IF;
  END LOOP;
  RETURN n;
END $$;

-- ------------------------------------------------------------ handlers ----
CREATE FUNCTION assert_driver_stop(e wp.device_event) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM wp.stop s JOIN wp.route r ON r.route_id = s.route_id
                 WHERE s.stop_id = e.stop_id AND r.route_id = e.route_id AND r.driver_id = e.user_id) THEN
    RAISE EXCEPTION 'WP310: stop % is not on a route driven by user %', e.stop_id, e.user_id USING ERRCODE = 'WP310';
  END IF;
END $$;

CREATE FUNCTION apply_depart(e wp.device_event) RETURNS void LANGUAGE plpgsql AS $$
DECLARE rt wp.route%ROWTYPE;
BEGIN
  SELECT * INTO rt FROM wp.route WHERE route_id = e.route_id AND driver_id = e.user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'WP310: route % is not driven by user %', e.route_id, e.user_id USING ERRCODE = 'WP310'; END IF;
  IF rt.state IN ('on_the_way', 'complete') THEN RETURN; END IF;
  IF rt.state <> 'loaded' THEN PERFORM wp.not_ready('route ' || e.route_id || ' is not yet released by the loader'); END IF;
  UPDATE wp.route SET state = 'on_the_way', departed_at = e.device_time WHERE route_id = rt.route_id;
  UPDATE wp.order_header h SET status = 'on_the_way'
  WHERE h.status = 'loaded' AND h.order_id IN
        (SELECT so.order_id FROM wp.stop_order so JOIN wp.stop s ON s.stop_id = so.stop_id
         WHERE s.route_id = rt.route_id AND so.removed_at IS NULL);
  UPDATE wp.run SET state = 'in_progress' WHERE run_id = (SELECT run_id FROM wp.plan WHERE plan_id = rt.plan_id) AND state = 'planned';
END $$;

CREATE FUNCTION apply_arrive(e wp.device_event) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM wp.assert_driver_stop(e);
  INSERT INTO wp.stop_arrival(stop_id, event_id, device_time) VALUES (e.stop_id, e.event_id, e.device_time)
  ON CONFLICT (stop_id) DO NOTHING;
END $$;

-- Walk an order forward through the spine so its status matches a recorded fact.
CREATE FUNCTION advance_order(p_order bigint, p_target wp.order_status) RETURNS void LANGUAGE plpgsql AS $$
DECLARE s wp.order_status; spine wp.order_status[] := ARRAY['confirmed','planned','loading','loaded','on_the_way']::wp.order_status[];
        i integer; j integer;
BEGIN
  SELECT status INTO s FROM wp.order_header WHERE order_id = p_order FOR UPDATE;
  IF s = p_target THEN RETURN; END IF;
  i := array_position(spine, s); j := array_position(spine, p_target);
  IF i IS NOT NULL AND j IS NOT NULL AND i < j THEN
    WHILE i < j LOOP
      i := i + 1;
      PERFORM set_config('wp.note', 'Advanced to match a recorded fact', true);
      UPDATE wp.order_header SET status = spine[i] WHERE order_id = p_order;
    END LOOP;
    PERFORM set_config('wp.note', '', true);
  ELSE
    UPDATE wp.order_header SET status = p_target WHERE order_id = p_order;
  END IF;
END $$;

CREATE FUNCTION apply_delivery(e wp.device_event) RETURNS void LANGUAGE plpgsql AS $$
DECLARE pj jsonb := e.payload; did uuid := (pj ->> 'delivery_id')::uuid; oid bigint := (pj ->> 'order_id')::bigint;
        outc wp.delivery_outcome := (pj ->> 'outcome')::wp.delivery_outcome;
        st wp.stop%ROWTYPE; h wp.order_header%ROWTYPE; ou wp.outlet%ROWTYPE; un wp.unload_type;
        x record; exp numeric; del numeric; rcode text; moved boolean := false; tz text; n_open integer; plid integer;
BEGIN
  PERFORM wp.assert_driver_stop(e);
  SELECT * INTO st FROM wp.stop WHERE stop_id = e.stop_id;
  SELECT * INTO h FROM wp.order_header WHERE order_id = oid FOR UPDATE;
  IF NOT FOUND OR h.outlet_id <> st.outlet_id THEN
    RAISE EXCEPTION 'WP311: order % does not belong to this stop''s outlet', oid USING ERRCODE = 'WP311';
  END IF;
  IF h.status = 'received' THEN
    RAISE EXCEPTION 'WP312: order % was already confirmed received by the store', h.confirmation_no USING ERRCODE = 'WP312';
  END IF;
  SELECT * INTO ou FROM wp.outlet WHERE outlet_id = h.outlet_id;
  un := COALESCE((pj ->> 'unload')::wp.unload_type, ou.unload);

  INSERT INTO wp.delivery(delivery_id, event_id, order_id, stop_id, outcome, reason_code, received_by, unload, note,
                          supersedes_id, driver_id, device_time)
  VALUES (did, e.event_id, oid, e.stop_id, outc, NULLIF(pj ->> 'reason_code', ''), NULLIF(pj ->> 'received_by', ''),
          un, pj ->> 'note', NULLIF(pj ->> 'supersedes_id', '')::uuid, e.user_id, e.device_time)
  ON CONFLICT (delivery_id) DO NOTHING;

  IF outc <> 'not_delivered' THEN
    FOR x IN SELECT l.line_no, l.qty AS ordered,
                    COALESCE((SELECT lc.qty_loaded FROM wp.load_confirmation lc
                              WHERE lc.order_id = l.order_id AND lc.line_no = l.line_no
                              ORDER BY lc.device_time DESC, lc.received_at DESC LIMIT 1), l.qty) AS expected,
                    j ->> 'delivered_qty' AS dq, j ->> 'reason_code' AS rc
             FROM wp.order_line l
             LEFT JOIN LATERAL (SELECT j FROM jsonb_array_elements(COALESCE(pj -> 'lines', '[]')) j
                                WHERE (j ->> 'line_no')::smallint = l.line_no) jj ON true
             WHERE l.order_id = oid ORDER BY l.line_no
    LOOP
      exp := LEAST(x.expected, x.ordered);
      del := COALESCE(x.dq::numeric, exp);
      INSERT INTO wp.delivery_line(delivery_id, order_id, line_no, ordered_qty, expected_qty, delivered_qty, reason_code)
      VALUES (did, oid, x.line_no, x.ordered, exp, del, CASE WHEN del < exp THEN COALESCE(NULLIF(x.rc, ''), NULLIF(pj ->> 'reason_code', '')) END)
      ON CONFLICT (delivery_id, line_no) DO NOTHING;
    END LOOP;
  END IF;
  SET CONSTRAINTS wp.delivery_consistent IMMEDIATE;   -- surface inconsistency now, inside this event
  SET CONSTRAINTS wp.delivery_consistent DEFERRED;

  -- Status follows the fact.
  IF h.status NOT IN ('delivered', 'delivered_in_part', 'not_delivered') THEN
    PERFORM wp.advance_order(oid, 'on_the_way');
  END IF;
  PERFORM wp.advance_order(oid, outc::text::wp.order_status);

  -- Facts win: any other live assignment of this order loses to what happened on the phone.
  IF EXISTS (SELECT 1 FROM wp.stop_order WHERE order_id = oid AND removed_at IS NULL AND stop_id <> e.stop_id)
     OR NOT EXISTS (SELECT 1 FROM wp.stop_order WHERE order_id = oid AND removed_at IS NULL AND stop_id = e.stop_id) THEN
    PERFORM set_config('wp.facts_win', 'on', true);
    UPDATE wp.stop_order SET removed_at = now(), removed_reason = 'delivered on phone'
    WHERE order_id = oid AND removed_at IS NULL AND stop_id <> e.stop_id;
    PERFORM set_config('wp.facts_win', 'off', true);
    INSERT INTO wp.plan_conflict(plan_id, stop_id, order_id, detail)
    VALUES (st.plan_id, e.stop_id, oid,
            'Order ' || h.confirmation_no || ' was delivered at stop ' || e.stop_id || ' before a plan change reached the phone. The delivery stands.');
  END IF;

  UPDATE wp.instruction SET state = 'no_action_needed'
  WHERE route_id = e.route_id AND (stop_id = e.stop_id OR stop_id IS NULL AND type = 'skip_stop') AND state IN ('sent', 'on_phone');

  SELECT d.tz INTO tz FROM wp.depot d WHERE d.depot_id = ou.depot_id;
  IF outc = 'not_delivered' THEN
    INSERT INTO wp.notice(outlet_id, order_id, kind, title, body)
    VALUES (h.outlet_id, oid, 'not_delivered', 'Delivery not completed',
            'Order ' || h.confirmation_no || ' could not be delivered. The dispatch desk will confirm a new day.');
  ELSE
    INSERT INTO wp.notice(outlet_id, order_id, kind, title, body)
    VALUES (h.outlet_id, oid, 'receipt_needed',
            CASE outc WHEN 'delivered' THEN 'Delivered' ELSE 'Delivered in part' END,
            'Order ' || h.confirmation_no || ' was delivered at ' || to_char(e.device_time AT TIME ZONE tz, 'HH24:MI')
            || '. Please confirm what you received.');
  END IF;

  -- Route is complete when every live order on it has a delivery record.
  SELECT count(*) INTO n_open FROM wp.stop_order so JOIN wp.stop s ON s.stop_id = so.stop_id
  WHERE s.route_id = e.route_id AND so.removed_at IS NULL AND s.removed_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM wp.delivery dl WHERE dl.order_id = so.order_id);
  IF n_open = 0 THEN
    UPDATE wp.route SET state = 'complete' WHERE route_id = e.route_id AND state = 'on_the_way';
    SELECT plan_id INTO plid FROM wp.route WHERE route_id = e.route_id;
    UPDATE wp.run SET state = 'complete'
    WHERE run_id = (SELECT run_id FROM wp.plan WHERE plan_id = plid) AND state = 'in_progress'
      AND NOT EXISTS (SELECT 1 FROM wp.route r WHERE r.plan_id = plid AND r.state NOT IN ('complete', 'cancelled'));
  END IF;
END $$;

CREATE FUNCTION apply_flag(e wp.device_event) RETURNS void LANGUAGE plpgsql AS $$
DECLARE pj jsonb := e.payload; u wp.app_user%ROWTYPE;
BEGIN
  SELECT * INTO u FROM wp.app_user WHERE user_id = e.user_id;
  IF u.role NOT IN ('loader', 'driver') THEN RAISE EXCEPTION 'WP313: only loaders and drivers raise flags' USING ERRCODE = 'WP313'; END IF;
  IF u.role = 'driver' AND NOT EXISTS (SELECT 1 FROM wp.route WHERE route_id = e.route_id AND driver_id = e.user_id) THEN
    RAISE EXCEPTION 'WP310: route % is not driven by user %', e.route_id, e.user_id USING ERRCODE = 'WP310';
  END IF;
  INSERT INTO wp.flag(flag_id, event_id, source, type, route_id, stop_id, order_id, line_no, qty, minutes_late,
                      note, raised_by, device_time)
  VALUES ((pj ->> 'flag_id')::uuid, e.event_id, u.role::text::wp.flag_source, pj ->> 'type', e.route_id,
          e.stop_id, NULLIF(pj ->> 'order_id', '')::bigint, NULLIF(pj ->> 'line_no', '')::smallint,
          NULLIF(pj ->> 'qty', '')::numeric, NULLIF(pj ->> 'minutes_late', '')::smallint, pj ->> 'note',
          e.user_id, e.device_time)
  ON CONFLICT (flag_id) DO NOTHING;
END $$;

CREATE FUNCTION apply_load_confirm(e wp.device_event) RETURNS void LANGUAGE plpgsql AS $$
DECLARE rt wp.route%ROWTYPE; l jsonb; ver smallint; oid bigint; ln smallint;
BEGIN
  SELECT * INTO rt FROM wp.route WHERE route_id = e.route_id;
  IF rt.state IN ('loaded', 'on_the_way', 'complete') THEN
    RAISE EXCEPTION 'WP320: route % is already released; reopen loading first', e.route_id USING ERRCODE = 'WP320';
  END IF;
  SELECT version INTO ver FROM wp.plan WHERE plan_id = rt.plan_id;
  FOR l IN SELECT * FROM jsonb_array_elements(e.payload -> 'lines') LOOP
    oid := (l ->> 'order_id')::bigint; ln := (l ->> 'line_no')::smallint;
    IF NOT EXISTS (SELECT 1 FROM wp.stop_order so JOIN wp.stop s ON s.stop_id = so.stop_id
                   WHERE so.order_id = oid AND so.removed_at IS NULL AND s.route_id = e.route_id) THEN
      RAISE EXCEPTION 'WP321: order % is not on route %', oid, e.route_id USING ERRCODE = 'WP321';
    END IF;
    INSERT INTO wp.load_confirmation(confirmation_id, event_id, route_id, order_id, line_no, qty_loaded, plan_version, loaded_by, device_time)
    VALUES ((l ->> 'confirmation_id')::uuid, e.event_id, e.route_id, oid, ln, (l ->> 'qty_loaded')::numeric, ver, e.user_id, e.device_time)
    ON CONFLICT (confirmation_id) DO NOTHING;
    UPDATE wp.order_header SET status = 'loading' WHERE order_id = oid AND status = 'planned';
  END LOOP;
  UPDATE wp.route SET state = 'loading' WHERE route_id = e.route_id AND state = 'planned';
END $$;

-- Lines on a route that still lack a confirmation made against the current assignment.
CREATE FUNCTION unconfirmed_lines(p_route integer) RETURNS integer LANGUAGE sql STABLE AS $$
  SELECT count(*)::integer
  FROM wp.stop_order so JOIN wp.stop s ON s.stop_id = so.stop_id AND s.removed_at IS NULL
  JOIN wp.order_line l ON l.order_id = so.order_id
  WHERE s.route_id = p_route AND so.removed_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM wp.load_confirmation lc
                    WHERE lc.order_id = l.order_id AND lc.line_no = l.line_no AND lc.route_id = p_route)
$$;

CREATE FUNCTION apply_route_release(e wp.device_event) RETURNS void LANGUAGE plpgsql AS $$
DECLARE rt wp.route%ROWTYPE; pj jsonb := e.payload; un integer; tot integer; ver smallint; fw numeric; fv numeric; ch integer;
BEGIN
  SELECT * INTO rt FROM wp.route WHERE route_id = e.route_id FOR UPDATE;
  IF rt.state IN ('loaded', 'on_the_way', 'complete') THEN RETURN; END IF;
  un := wp.unconfirmed_lines(e.route_id);
  IF un > 0 THEN
    PERFORM wp.not_ready(format('%s line(s) on route %s are not confirmed yet', un, e.route_id));
  END IF;
  SELECT count(*) INTO ch FROM wp.plan_change pc
  WHERE pc.route_id = e.route_id AND NOT EXISTS (SELECT 1 FROM wp.plan_change_ack a WHERE a.change_id = pc.change_id AND a.audience = 'loader');
  IF ch > 0 THEN
    RAISE EXCEPTION 'WP322: review the % changed plan(s) on route % before release', ch, e.route_id USING ERRCODE = 'WP322';
  END IF;
  SELECT version INTO ver FROM wp.plan WHERE plan_id = rt.plan_id;
  SELECT count(*), COALESCE(sum(l.qty), 0) INTO tot, fw FROM (
     SELECT l.qty FROM wp.stop_order so JOIN wp.stop s ON s.stop_id = so.stop_id AND s.removed_at IS NULL
     JOIN wp.order_line l ON l.order_id = so.order_id WHERE s.route_id = e.route_id AND so.removed_at IS NULL) l;
  SELECT COALESCE(sum(lc.qty_loaded * p.unit_weight_kg), 0), COALESCE(sum(lc.qty_loaded * p.unit_volume_m3), 0)
    INTO fw, fv
  FROM wp.stop_order so JOIN wp.stop s ON s.stop_id = so.stop_id AND s.removed_at IS NULL
  JOIN wp.order_line l ON l.order_id = so.order_id JOIN wp.product p ON p.product_id = l.product_id
  JOIN LATERAL (SELECT qty_loaded FROM wp.load_confirmation x WHERE x.order_id = l.order_id AND x.line_no = l.line_no
                ORDER BY x.device_time DESC, x.received_at DESC LIMIT 1) lc ON true
  WHERE s.route_id = e.route_id AND so.removed_at IS NULL;

  INSERT INTO wp.route_release(release_id, event_id, route_id, kind, plan_version, loaded_by, lines_total,
                               lines_confirmed, final_weight_kg, final_volume_m3, device_time)
  VALUES ((pj ->> 'release_id')::uuid, e.event_id, e.route_id, 'release', ver, e.user_id, tot, tot,
          round(fw, 1), round(fv, 2), e.device_time)
  ON CONFLICT (release_id) DO NOTHING;
  UPDATE wp.route SET state = 'loaded' WHERE route_id = e.route_id;
  UPDATE wp.order_header h SET status = 'loaded'
  WHERE h.status = 'loading' AND h.order_id IN
        (SELECT so.order_id FROM wp.stop_order so JOIN wp.stop s ON s.stop_id = so.stop_id
         WHERE s.route_id = e.route_id AND so.removed_at IS NULL);

  -- Tell each store about any shortfall the loader recorded, once, before the truck arrives.
  INSERT INTO wp.notice(outlet_id, order_id, kind, title, body)
  SELECT h.outlet_id, h.order_id, 'short_loaded', 'Delivery may be short',
         'Order ' || h.confirmation_no || ': ' || count(*) || ' line(s) were loaded short. The driver will confirm quantities on arrival.'
  FROM wp.stop_order so JOIN wp.stop s ON s.stop_id = so.stop_id AND s.removed_at IS NULL
  JOIN wp.order_header h ON h.order_id = so.order_id
  JOIN wp.order_line l ON l.order_id = so.order_id
  JOIN LATERAL (SELECT qty_loaded FROM wp.load_confirmation x WHERE x.order_id = l.order_id AND x.line_no = l.line_no
                ORDER BY x.device_time DESC, x.received_at DESC LIMIT 1) lc ON lc.qty_loaded < l.qty
  WHERE s.route_id = e.route_id AND so.removed_at IS NULL
  GROUP BY h.outlet_id, h.order_id, h.confirmation_no;
END $$;

CREATE FUNCTION apply_route_reopen(e wp.device_event) RETURNS void LANGUAGE plpgsql AS $$
DECLARE rt wp.route%ROWTYPE; ver smallint;
BEGIN
  SELECT * INTO rt FROM wp.route WHERE route_id = e.route_id FOR UPDATE;
  IF rt.state <> 'loaded' THEN
    RAISE EXCEPTION 'WP323: route % is % and cannot be reopened', e.route_id, rt.state USING ERRCODE = 'WP323';
  END IF;
  SELECT version INTO ver FROM wp.plan WHERE plan_id = rt.plan_id;
  INSERT INTO wp.route_release(release_id, event_id, route_id, kind, plan_version, loaded_by, device_time)
  VALUES (COALESCE(NULLIF(e.payload ->> 'release_id', '')::uuid, gen_random_uuid()), e.event_id, e.route_id, 'reopen', ver, e.user_id, e.device_time)
  ON CONFLICT (release_id) DO NOTHING;
  UPDATE wp.route SET state = 'loading' WHERE route_id = e.route_id;
  UPDATE wp.order_header h SET status = 'loading'
  WHERE h.status = 'loaded' AND h.order_id IN
        (SELECT so.order_id FROM wp.stop_order so JOIN wp.stop s ON s.stop_id = so.stop_id
         WHERE s.route_id = e.route_id AND so.removed_at IS NULL);
END $$;

CREATE FUNCTION apply_plan_ack(e wp.device_event) RETURNS void LANGUAGE plpgsql AS $$
DECLARE aud text; u wp.app_user%ROWTYPE; cid bigint := (e.payload ->> 'change_id')::bigint;
BEGIN
  SELECT * INTO u FROM wp.app_user WHERE user_id = e.user_id;
  aud := CASE u.role WHEN 'loader' THEN 'loader' WHEN 'driver' THEN 'driver' END;
  IF aud IS NULL THEN RAISE EXCEPTION 'WP330: only loaders and drivers acknowledge plan changes' USING ERRCODE = 'WP330'; END IF;
  IF NOT EXISTS (SELECT 1 FROM wp.plan_change WHERE change_id = cid) THEN
    RAISE EXCEPTION 'WP331: plan change % does not exist', cid USING ERRCODE = 'WP331';
  END IF;
  INSERT INTO wp.plan_change_ack(change_id, audience, user_id, event_id, acked_at)
  VALUES (cid, aud, e.user_id, e.event_id, e.device_time) ON CONFLICT DO NOTHING;
END $$;

CREATE FUNCTION apply_instruction_seen(e wp.device_event) RETURNS void LANGUAGE plpgsql AS $$
DECLARE iid uuid := (e.payload ->> 'instruction_id')::uuid;
BEGIN
  UPDATE wp.instruction SET
    on_phone_at = COALESCE(on_phone_at, e.device_time),
    seen_at = CASE WHEN e.type = 'instruction_seen' THEN COALESCE(seen_at, e.device_time) ELSE seen_at END,
    state = CASE WHEN state = 'no_action_needed' THEN state
                 WHEN e.type = 'instruction_seen' THEN 'seen'::wp.instruction_state
                 WHEN state = 'sent' THEN 'on_phone'::wp.instruction_state ELSE state END
  WHERE instruction_id = iid AND route_id = e.route_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'WP332: instruction % is not on route %', iid, e.route_id USING ERRCODE = 'WP332'; END IF;
END $$;

-- ========================================================= dispatcher acts ==
CREATE FUNCTION send_instruction(p_route integer, p_stop integer, p_flag uuid, p_type instruction_type,
                                 p_payload jsonb, p_text text, p_actor integer) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE iid uuid := gen_random_uuid(); served boolean := false;
BEGIN
  PERFORM wp.assert_role(p_actor, ARRAY['dispatcher','admin']);
  PERFORM wp.assert_depot(p_actor, (SELECT depot_id FROM wp.route WHERE route_id = p_route));
  PERFORM set_config('wp.actor_id', p_actor::text, true);
  IF p_stop IS NOT NULL THEN
    SELECT EXISTS (SELECT 1 FROM wp.stop_order so JOIN wp.delivery d ON d.order_id = so.order_id
                   WHERE so.stop_id = p_stop AND so.removed_at IS NULL) INTO served;
  END IF;
  INSERT INTO wp.instruction(instruction_id, route_id, stop_id, flag_id, type, payload, text, sent_by, state)
  VALUES (iid, p_route, p_stop, p_flag, p_type, COALESCE(p_payload, '{}'), p_text, p_actor,
          CASE WHEN served THEN 'no_action_needed'::wp.instruction_state ELSE 'sent' END);
  IF p_flag IS NOT NULL THEN UPDATE wp.flag SET state = 'replied' WHERE flag_id = p_flag AND state = 'open'; END IF;
  RETURN iid;
END $$;

CREATE FUNCTION resolve_flag(p_flag uuid, p_actor integer) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM wp.assert_role(p_actor, ARRAY['dispatcher','admin']);
  PERFORM wp.assert_depot(p_actor, (SELECT r.depot_id FROM wp.flag f JOIN wp.route r USING (route_id) WHERE f.flag_id = p_flag));
  PERFORM set_config('wp.actor_id', p_actor::text, true);
  UPDATE wp.flag SET state = 'resolved', resolved_at = now() WHERE flag_id = p_flag AND state <> 'resolved';
END $$;

-- ====================================================== store confirms ======
-- p_issues: [{"line_no":2,"type":"short","qty":3,"note":"..."}]. Empty array means all as shown.
CREATE FUNCTION confirm_receipt(p_order bigint, p_user integer, p_issues jsonb DEFAULT '[]')
RETURNS TABLE (receipt_id uuid, issue_refs jsonb) LANGUAGE plpgsql AS $$
DECLARE h wp.order_header%ROWTYPE; u wp.app_user%ROWTYPE; did uuid; rid uuid; ok boolean;
BEGIN
  PERFORM set_config('wp.actor_id', p_user::text, true);
  SELECT * INTO u FROM wp.app_user WHERE user_id = p_user AND role = 'store_manager' AND active;
  SELECT * INTO h FROM wp.order_header WHERE order_id = p_order FOR UPDATE;
  IF NOT FOUND OR u.user_id IS NULL OR u.outlet_id <> h.outlet_id THEN
    RAISE EXCEPTION 'WP340: this order is not yours to confirm' USING ERRCODE = 'WP340';
  END IF;
  SELECT r.receipt_id INTO rid FROM wp.store_receipt r WHERE r.order_id = p_order;
  IF FOUND THEN
    receipt_id := rid;
    SELECT COALESCE(jsonb_agg(jsonb_build_object('line_no', i.line_no, 'reference_no', i.reference_no)), '[]')
      INTO issue_refs FROM wp.receipt_issue i WHERE i.receipt_id = rid;
    RETURN NEXT; RETURN;
  END IF;
  IF h.status NOT IN ('delivered', 'delivered_in_part') THEN
    RAISE EXCEPTION 'WP341: order % is % and cannot be confirmed yet', h.confirmation_no, h.status USING ERRCODE = 'WP341';
  END IF;
  SELECT d.delivery_id INTO did FROM wp.delivery d
  WHERE d.order_id = p_order AND NOT EXISTS (SELECT 1 FROM wp.delivery s WHERE s.supersedes_id = d.delivery_id);
  ok := jsonb_array_length(p_issues) = 0;
  INSERT INTO wp.store_receipt(order_id, delivery_id, confirmed_by, all_ok) VALUES (p_order, did, p_user, ok)
  RETURNING store_receipt.receipt_id INTO rid;
  INSERT INTO wp.receipt_issue(receipt_id, order_id, line_no, type, qty, note)
  SELECT rid, p_order, (i ->> 'line_no')::smallint, (i ->> 'type')::wp.issue_type,
         NULLIF(i ->> 'qty', '')::numeric, i ->> 'note'
  FROM jsonb_array_elements(p_issues) i;
  UPDATE wp.order_header SET status = 'received' WHERE order_id = p_order;
  receipt_id := rid;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('line_no', i.line_no, 'reference_no', i.reference_no)), '[]')
    INTO issue_refs FROM wp.receipt_issue i WHERE i.receipt_id = rid;
  RETURN NEXT;
END $$;

-- ========================================================= device sync pull =
-- What a phone or tablet needs after reconnecting: latest plan for its routes, plan changes
-- not yet acknowledged, and instructions not yet seen. Facts it sent are never re-sent.
CREATE FUNCTION device_sync_payload(p_device uuid) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE d wp.device%ROWTYPE; out jsonb;
BEGIN
  SELECT * INTO d FROM wp.device WHERE device_id = p_device AND active;
  IF NOT FOUND THEN RAISE EXCEPTION 'WP300: unregistered or inactive device' USING ERRCODE = 'WP300'; END IF;
  SELECT jsonb_build_object(
    'server_time', now(),
    'plans', COALESCE((
       SELECT jsonb_agg(jsonb_build_object('plan_id', pv.plan_id, 'version', pv.version, 'service_date', p.service_date,
              'routes', (SELECT COALESCE(jsonb_agg(r), '[]') FROM jsonb_array_elements(pv.snapshot -> 'routes') r
                         WHERE d.kind = 'loader_tablet' OR (r ->> 'driver_id')::integer = d.user_id)))
       FROM wp.plan p JOIN wp.plan_version pv ON pv.plan_id = p.plan_id AND pv.version = p.version
       WHERE p.depot_id = d.depot_id AND p.state = 'released' AND p.service_date >= current_date - 1), '[]'),
    'changes', COALESCE((
       SELECT jsonb_agg(jsonb_build_object('change_id', pc.change_id, 'route_id', pc.route_id, 'version', pc.version,
              'changed_stops', pc.changed_stops, 'changed_orders', pc.changed_orders, 'detail', pc.detail))
       FROM wp.plan_change pc JOIN wp.route r ON r.route_id = pc.route_id
       WHERE (d.kind = 'loader_tablet' OR r.driver_id = d.user_id) AND r.depot_id = d.depot_id
         AND NOT EXISTS (SELECT 1 FROM wp.plan_change_ack a WHERE a.change_id = pc.change_id
                         AND a.audience = CASE d.kind WHEN 'loader_tablet' THEN 'loader' ELSE 'driver' END)), '[]'),
    'instructions', COALESCE((
       SELECT jsonb_agg(jsonb_build_object('instruction_id', i.instruction_id, 'route_id', i.route_id, 'stop_id', i.stop_id,
              'type', i.type, 'payload', i.payload, 'text', i.text, 'sent_at', i.sent_at, 'state', i.state))
       FROM wp.instruction i JOIN wp.route r ON r.route_id = i.route_id
       WHERE r.depot_id = d.depot_id AND (d.kind = 'loader_tablet' OR r.driver_id = d.user_id)
         AND i.state IN ('sent', 'on_phone')), '[]')) INTO out;
  RETURN out;
END $$;


-- =============================================================================
-- Access control: identity helpers, row-level security, roles and grants.
-- The API sets, per transaction:   SET LOCAL wp.user_id = '<id>';
-- Workflow functions are SECURITY DEFINER and check the caller's role themselves.
-- =============================================================================
CREATE FUNCTION me() RETURNS integer LANGUAGE sql STABLE AS
$$ SELECT NULLIF(current_setting('wp.user_id', true), '')::integer $$;

CREATE FUNCTION me_row() RETURNS wp.app_user LANGUAGE sql STABLE SECURITY DEFINER SET search_path = wp, pg_temp AS
$$ SELECT * FROM wp.app_user WHERE user_id = wp.me() AND active $$;

CREATE FUNCTION can_see_route(p_route integer) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = wp, pg_temp AS $$
  SELECT CASE u.role
           WHEN 'admin' THEN true
           WHEN 'dispatcher' THEN r.depot_id = u.depot_id
           WHEN 'loader' THEN r.depot_id = u.depot_id
           WHEN 'driver' THEN r.driver_id = u.user_id
           ELSE false END
  FROM wp.app_user u, wp.route r
  WHERE u.user_id = wp.me() AND u.active AND r.route_id = p_route
$$;

CREATE FUNCTION can_see_order(p_order bigint) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = wp, pg_temp AS $$
  SELECT CASE u.role
           WHEN 'admin' THEN true
           WHEN 'dispatcher' THEN ou.depot_id = u.depot_id
           WHEN 'loader' THEN ou.depot_id = u.depot_id
           WHEN 'store_manager' THEN h.outlet_id = u.outlet_id
           WHEN 'driver' THEN EXISTS (SELECT 1 FROM wp.stop_order so JOIN wp.stop s ON s.stop_id = so.stop_id
                                      JOIN wp.route r ON r.route_id = s.route_id
                                      WHERE so.order_id = h.order_id AND r.driver_id = u.user_id)
           ELSE false END
  FROM wp.app_user u, wp.order_header h JOIN wp.outlet ou ON ou.outlet_id = h.outlet_id
  WHERE u.user_id = wp.me() AND u.active AND h.order_id = p_order
$$;

CREATE FUNCTION can_see_outlet(p_outlet integer) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = wp, pg_temp AS $$
  SELECT CASE u.role WHEN 'admin' THEN true
           WHEN 'store_manager' THEN u.outlet_id = p_outlet
           ELSE (SELECT depot_id FROM wp.outlet WHERE outlet_id = p_outlet) = u.depot_id END
  FROM wp.app_user u WHERE u.user_id = wp.me() AND u.active
$$;

-- ----- role checks used by the workflow functions ----------------------------
CREATE FUNCTION assert_role(p_user integer, p_roles text[]) RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = wp, pg_temp AS $$
DECLARE u wp.app_user%ROWTYPE;
BEGIN
  SELECT * INTO u FROM wp.app_user WHERE user_id = p_user AND active;
  IF NOT FOUND OR NOT (u.role::text = ANY (p_roles)) THEN
    RAISE EXCEPTION 'WP010: user % may not perform this action', p_user USING ERRCODE = 'WP010';
  END IF;
  IF wp.me() IS NOT NULL AND wp.me() <> p_user THEN
    RAISE EXCEPTION 'WP011: acting user does not match the signed-in session' USING ERRCODE = 'WP011';
  END IF;
END $$;

CREATE FUNCTION assert_depot(p_user integer, p_depot smallint) RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = wp, pg_temp AS $$
DECLARE u wp.app_user%ROWTYPE;
BEGIN
  SELECT * INTO u FROM wp.app_user WHERE user_id = p_user AND active;
  IF NOT FOUND OR (u.role <> 'admin' AND u.depot_id IS DISTINCT FROM p_depot) THEN
    RAISE EXCEPTION 'WP012: user % does not work at depot %', p_user, p_depot USING ERRCODE = 'WP012';
  END IF;
END $$;


-- =============================================================================
-- Read models. Screens read these, never the base tables, and every response
-- carries data_through() so freshness is on every screen.
-- Visibility: each view ends in wp.can_see_order() or wp.can_see_route() so it is safe
-- to expose to any signed-in role even though views run with their owner's rights.
-- =============================================================================
CREATE FUNCTION data_through() RETURNS timestamptz LANGUAGE sql STABLE AS $$
  SELECT GREATEST((SELECT max(received_at) FROM wp.device_event),
                  (SELECT max(at) FROM wp.order_status_history))
$$;

-- Latest delivery in each correction chain.
CREATE VIEW current_delivery AS
SELECT d.* FROM delivery d
WHERE NOT EXISTS (SELECT 1 FROM delivery s WHERE s.supersedes_id = d.delivery_id);

-- Proof captured against what the outlet rules require.
CREATE VIEW delivery_proof_status AS
SELECT d.delivery_id, d.order_id, d.stop_id, pr.need_signature, pr.need_photo,
       EXISTS (SELECT 1 FROM attachment a WHERE a.delivery_id = d.delivery_id AND a.kind = 'signature') AS has_signature,
       EXISTS (SELECT 1 FROM attachment a WHERE a.delivery_id = d.delivery_id AND a.kind = 'photo')     AS has_photo,
       d.outcome = 'not_delivered'
         OR ((NOT pr.need_signature OR EXISTS (SELECT 1 FROM attachment a WHERE a.delivery_id = d.delivery_id AND a.kind = 'signature'))
         AND (NOT pr.need_photo     OR EXISTS (SELECT 1 FROM attachment a WHERE a.delivery_id = d.delivery_id AND a.kind = 'photo'))) AS proof_complete
FROM current_delivery d
JOIN order_header h ON h.order_id = d.order_id
JOIN outlet ou ON ou.outlet_id = h.outlet_id
CROSS JOIN LATERAL proof_required(ou.brand_id, d.unload) pr
WHERE can_see_order(d.order_id);

-- D1, D2, D3, S1: one row per order with its place in the plan and its facts.
CREATE VIEW order_board AS
SELECT h.order_id, h.confirmation_no, h.status, h.temp, h.delivery_date, h.run_id, h.deferral_count,
       h.original_delivery_date, h.source, h.placed_at,
       ou.outlet_id, ou.code AS outlet_code, ou.name AS outlet_name, ou.depot_id, ou.district_id, ou.van_only, ou.unload,
       b.brand_id, b.code AS brand_code, b.name AS brand_name,
       ol.weight_kg, ol.volume_m3, ln.line_count,
       so.stop_id, s.route_id, s.seq AS stop_seq, s.planned_arrival, s.deliver_by,
       r.vehicle_id, ve.code AS vehicle_code, r.seq AS route_seq,
       cd.outcome AS delivery_outcome, cd.device_time AS delivered_at, cd.received_at AS delivery_received_at,
       rc.confirmed_at AS receipt_at, rc.all_ok AS receipt_ok,
       dd.reason_code AS draft_defer_reason
FROM order_header h
JOIN outlet ou ON ou.outlet_id = h.outlet_id
JOIN brand b ON b.brand_id = h.brand_id
CROSS JOIN LATERAL order_load(h.order_id) ol
CROSS JOIN LATERAL (SELECT count(*)::integer AS line_count FROM order_line l WHERE l.order_id = h.order_id) ln
LEFT JOIN stop_order so ON so.order_id = h.order_id AND so.removed_at IS NULL
LEFT JOIN stop s ON s.stop_id = so.stop_id
LEFT JOIN route r ON r.route_id = s.route_id
LEFT JOIN vehicle ve ON ve.vehicle_id = r.vehicle_id
LEFT JOIN current_delivery cd ON cd.order_id = h.order_id
LEFT JOIN store_receipt rc ON rc.order_id = h.order_id
LEFT JOIN deferral_draft dd ON dd.order_id = h.order_id
WHERE can_see_order(h.order_id);

-- D1 lanes and L1 queue: a route with both gauges, fuel and progress.
CREATE VIEW route_board AS
SELECT r.route_id, r.plan_id, p.run_id, p.service_date, r.depot_id, r.seq AS route_seq, r.state,
       r.brand_id, br.code AS brand_code, r.district_id, di.name AS district_name, trip_minutes(r.route_id) AS trip_minutes,
       r.vehicle_id, ve.code AS vehicle_code, vc.name AS vehicle_class, vc.is_van, vc.carries_chilled,
       r.driver_id, du.name AS driver_name, r.depart_at, r.return_at, r.est_distance_km, r.est_fuel_l,
       l.weight_kg, l.volume_m3, lim.max_weight_kg, lim.max_volume_m3,
       round(100 * l.weight_kg / lim.max_weight_kg) AS weight_pct,
       round(100 * l.volume_m3 / lim.max_volume_m3) AS volume_pct,
       fuel_left(r.vehicle_id, r.plan_id) AS fuel_left_l,
       (SELECT count(*) FROM stop s WHERE s.route_id = r.route_id AND s.removed_at IS NULL) AS stop_count,
       lines.total AS lines_total,
       lines.total - unconfirmed_lines(r.route_id) AS lines_confirmed,
       p.version AS plan_version, p.dirty AS plan_dirty,
       (SELECT count(*) FROM plan_change pc WHERE pc.route_id = r.route_id AND NOT EXISTS
          (SELECT 1 FROM plan_change_ack a WHERE a.change_id = pc.change_id AND a.audience = 'loader')) AS unacked_loader_changes,
       (SELECT count(*) FROM plan_change pc WHERE pc.route_id = r.route_id AND NOT EXISTS
          (SELECT 1 FROM plan_change_ack a WHERE a.change_id = pc.change_id AND a.audience = 'driver')) AS unacked_driver_changes,
       (SELECT count(*) FROM flag f WHERE f.route_id = r.route_id AND f.state <> 'resolved') AS open_flags
FROM route r
JOIN plan p ON p.plan_id = r.plan_id
JOIN brand br ON br.brand_id = r.brand_id
JOIN district di ON di.district_id = r.district_id
JOIN vehicle ve ON ve.vehicle_id = r.vehicle_id
JOIN vehicle_class vc ON vc.class_id = ve.class_id
LEFT JOIN app_user du ON du.user_id = r.driver_id
CROSS JOIN LATERAL route_load(r.route_id) l
CROSS JOIN LATERAL route_limits(r.route_id) lim
CROSS JOIN LATERAL (
   SELECT count(*)::integer AS total FROM stop s
   JOIN stop_order so ON so.stop_id = s.stop_id AND so.removed_at IS NULL
   JOIN order_line ol ON ol.order_id = so.order_id
   WHERE s.route_id = r.route_id AND s.removed_at IS NULL) lines
WHERE r.state <> 'cancelled' AND can_see_route(r.route_id);

-- D1 headline strip, per plan.
CREATE VIEW plan_summary AS
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
WHERE EXISTS (SELECT 1 FROM app_user u WHERE u.user_id = me() AND (u.role = 'admin' OR u.depot_id = p.depot_id));

-- D2 evidence: the five working days before an order's delivery date, per outlet.
CREATE VIEW outlet_run_history AS
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
              AND (u.role = 'admin' OR u.depot_id = (SELECT depot_id FROM outlet WHERE outlet_id = x.outlet_id)
                   OR u.outlet_id = x.outlet_id));

-- Streak of deferred days counting back from the most recent day with any intent.
CREATE FUNCTION outlet_skip_streak(p_outlet integer) RETURNS integer LANGUAGE sql STABLE AS $$
  WITH h AS (SELECT outcome, rn FROM wp.outlet_run_history WHERE outlet_id = p_outlet AND outcome <> 'no_order'),
       first_ok AS (SELECT COALESCE(min(rn), 6) AS rn FROM h WHERE outcome = 'delivered')
  SELECT count(*)::integer FROM h, first_ok
  WHERE h.outcome = 'deferred' AND h.rn < first_ok.rn
$$;

-- D2: orders in a run that have no vehicle, with what the system found and the outlet's history.
CREATE FUNCTION suggested_reason(p_order bigint, p_plan integer) RETURNS text LANGUAGE plpgsql STABLE AS $$
DECLARE o wp.order_header%ROWTYPE; ou wp.outlet%ROWTYPE; pl wp.plan%ROWTYPE; rt record;
        codes text[] := '{}'; cs text[]; n_routes integer := 0; n_ok integer := 0;
BEGIN
  SELECT * INTO o FROM wp.order_header WHERE order_id = p_order;
  SELECT * INTO ou FROM wp.outlet WHERE outlet_id = o.outlet_id;
  SELECT * INTO pl FROM wp.plan WHERE plan_id = p_plan;
  -- Only trips of the order's own brand and district could ever take it.
  FOR rt IN SELECT route_id FROM wp.route WHERE plan_id = p_plan AND state <> 'cancelled'
                                              AND brand_id = ou.brand_id AND district_id = ou.district_id LOOP
    n_routes := n_routes + 1;
    SELECT array_agg(code) INTO cs FROM wp.fit_violations(p_order, rt.route_id);
    IF cs IS NULL THEN n_ok := n_ok + 1; ELSE codes := codes || cs; END IF;
  END LOOP;
  IF n_ok > 0 THEN RETURN 'window_unmet'; END IF;                 -- a trip fits; the problem is time
  IF ou.van_only THEN RETURN 'van_only_full'; END IF;
  IF o.temp <> 'ambient' THEN RETURN 'no_refrigerated'; END IF;
  IF 'fuel' = ANY (codes) THEN RETURN 'fuel_exhausted'; END IF;
  IF n_routes = 0 THEN RETURN 'no_vehicle'; END IF;
  RETURN 'volume_full';
END $$;

CREATE VIEW overflow_candidates AS
SELECT p.plan_id, h.order_id, h.confirmation_no, h.temp, h.deferral_count, ou.outlet_id, ou.name AS outlet_name,
       h.placed_at, row_number() OVER (PARTITION BY p.plan_id ORDER BY h.placed_at, h.order_id) AS fcfs_rank,
       b.code AS brand_code, ol.weight_kg, ol.volume_m3,
       suggested_reason(h.order_id, p.plan_id) AS suggested_reason,
       dd.reason_code AS drafted_reason, dd.note AS drafted_note,
       (SELECT count(*) FROM outlet_run_history x WHERE x.outlet_id = ou.outlet_id AND x.outcome = 'deferred') AS skips_last5,
       outlet_skip_streak(ou.outlet_id) AS skip_streak,
       is_consecutive_skip(h.order_id) AS consecutive_skip,
       (SELECT jsonb_agg(jsonb_build_object('day', x.day, 'outcome', x.outcome) ORDER BY x.day)
          FROM outlet_run_history x WHERE x.outlet_id = ou.outlet_id) AS history
FROM plan p
JOIN order_header h ON h.run_id = p.run_id AND h.status IN ('confirmed', 'planned')
JOIN outlet ou ON ou.outlet_id = h.outlet_id
JOIN brand b ON b.brand_id = h.brand_id
CROSS JOIN LATERAL order_load(h.order_id) ol
LEFT JOIN deferral_draft dd ON dd.plan_id = p.plan_id AND dd.order_id = h.order_id
WHERE NOT EXISTS (SELECT 1 FROM stop_order so WHERE so.order_id = h.order_id AND so.plan_id = p.plan_id AND so.removed_at IS NULL)
  AND can_see_order(h.order_id);

-- L2: the load list. Last stop is loaded first, so stops come back in reverse order.
CREATE VIEW load_list AS
SELECT s.route_id, s.stop_id, s.seq AS stop_seq, dense_rank() OVER (PARTITION BY s.route_id ORDER BY s.seq DESC) AS load_order,
       ou.name AS outlet_name, ou.unload, s.deliver_by,
       h.order_id, h.confirmation_no, l.line_no, pr.sku, pr.name AS product_name, pr.unit, l.qty AS ordered_qty,
       pr.temp AS line_temp, pr.fragile, pr.hanging,
       lc.qty_loaded, lc.plan_version AS confirmed_in_version,
       CASE WHEN lc.confirmation_id IS NULL THEN 'to_load'
            WHEN lc.qty_loaded < l.qty THEN 'short' ELSE 'loaded' END AS line_state,
       f.flag_id, f.type AS flag_type, f.state AS flag_state, f.received_at AS flagged_at,
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

-- D3: the needs-attention list. Ranked by urgency, then age.
CREATE VIEW monitor_exceptions AS
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
  AND EXISTS (SELECT 1 FROM app_user u WHERE u.user_id = me() AND (u.role = 'admin' OR u.depot_id = (SELECT depot_id FROM plan WHERE plan_id = c.plan_id)))
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

-- D3 headline strip, per run.
CREATE VIEW run_progress AS
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
WHERE EXISTS (SELECT 1 FROM app_user u WHERE u.user_id = me() AND (u.role = 'admin' OR u.depot_id = ru.depot_id));

-- D3 all-vehicles table.
CREATE VIEW fleet_status AS
SELECT rb.route_id, rb.run_id, rb.vehicle_code, rb.route_seq, rb.state, rb.driver_name, rb.depart_at,
       (SELECT count(*) FROM stop s WHERE s.route_id = rb.route_id AND s.removed_at IS NULL) AS stops_total,
       (SELECT count(*) FROM stop s WHERE s.route_id = rb.route_id AND s.removed_at IS NULL
          AND EXISTS (SELECT 1 FROM stop_order so JOIN delivery d ON d.order_id = so.order_id WHERE so.stop_id = s.stop_id AND so.removed_at IS NULL)) AS stops_done,
       nx.stop_id AS next_stop_id, nx.outlet_name AS next_outlet, nx.planned_arrival AS next_planned,
       dev.last_seen_at,
       (dev.last_seen_at IS NULL OR dev.last_seen_at < now() - make_interval(mins => setting_int('no_signal_minutes'))) AND rb.state = 'on_the_way' AS no_signal,
       (SELECT count(*) FROM monitor_exceptions m WHERE m.route_id = rb.route_id) AS exception_count
FROM route_board rb
LEFT JOIN LATERAL (
   SELECT s.stop_id, ou.name AS outlet_name, s.planned_arrival FROM stop s JOIN outlet ou ON ou.outlet_id = s.outlet_id
   WHERE s.route_id = rb.route_id AND s.removed_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM stop_order so JOIN delivery d ON d.order_id = so.order_id WHERE so.stop_id = s.stop_id AND so.removed_at IS NULL)
   ORDER BY s.seq LIMIT 1) nx ON true
LEFT JOIN LATERAL (SELECT d.last_seen_at FROM device d WHERE d.user_id = rb.driver_id AND d.active
                   ORDER BY d.last_seen_at DESC NULLS LAST LIMIT 1) dev ON true;

-- D4: one record per deferral or delivery.
CREATE VIEW ledger AS
SELECT 'deferral'::text AS record_type, d.deferral_id::text AS record_id, d.order_id, h.confirmation_no, d.outlet_id,
       ou.name AS outlet_name, b.code AS brand_code, d.temp, d.from_date AS service_date,
       CASE d.kind WHEN 'deferred' THEN 'deferred' ELSE 'not_delivered' END AS outcome,
       rc.label AS reason, d.note, u.name AS decided_by, d.decided_at AS at, NULL::timestamptz AS received_at,
       d.consecutive_skip, false AS awaiting_store, false AS disputed, NULL::boolean AS proof_complete
FROM deferral d JOIN order_header h ON h.order_id = d.order_id JOIN outlet ou ON ou.outlet_id = d.outlet_id
JOIN brand b ON b.brand_id = ou.brand_id JOIN reason_code rc ON rc.scope = d.scope AND rc.code = d.reason_code
JOIN app_user u ON u.user_id = d.decided_by
WHERE can_see_order(d.order_id)
UNION ALL
SELECT 'delivery', cd.delivery_id::text, cd.order_id, h.confirmation_no, h.outlet_id, ou.name, b.code, h.temp, h.delivery_date,
       cd.outcome::text, rc.label, cd.note, du.name, cd.device_time, cd.received_at, false,
       cd.outcome <> 'not_delivered' AND h.status <> 'received'
         AND cd.received_at < now() - make_interval(hours => setting_int('unconfirmed_receipt_hours')),
       EXISTS (SELECT 1 FROM receipt_issue i WHERE i.order_id = cd.order_id AND i.type = 'not_received'),
       (SELECT proof_complete FROM delivery_proof_status ps WHERE ps.delivery_id = cd.delivery_id)
FROM current_delivery cd JOIN order_header h ON h.order_id = cd.order_id JOIN outlet ou ON ou.outlet_id = h.outlet_id
JOIN brand b ON b.brand_id = h.brand_id JOIN app_user du ON du.user_id = cd.driver_id
LEFT JOIN reason_code rc ON rc.scope = cd.reason_scope AND rc.code = cd.reason_code
WHERE can_see_order(cd.order_id);

-- S3 timeline: the status spine for an order, with moves.
CREATE VIEW order_timeline AS
SELECT s.order_id, s.history_id, s.from_status, s.to_status, s.at, s.note
FROM order_status_history s
WHERE can_see_order(s.order_id)
  AND NOT (s.to_status = 'deferred');                        -- the move is shown through its deferral row

-- S1/S3: what the store manager sees per order.
CREATE VIEW store_orders AS
SELECT h.order_id, h.confirmation_no, h.outlet_id, b.code AS brand_code, h.temp, h.status, h.delivery_date,
       h.original_delivery_date, h.deferral_count, h.placed_at,
       CASE WHEN pl.state = 'released' THEN s.planned_arrival - make_interval(mins => setting_int('arrival_window_minutes')) END AS window_start,
       CASE WHEN pl.state = 'released' THEN s.planned_arrival + make_interval(mins => setting_int('arrival_window_minutes')) END AS window_end,
       ou.unload,
       ld.from_date AS moved_from, ld.to_date AS moved_to, rc.store_label AS moved_reason, ld.consecutive_skip AS moved_consecutive,
       cd.outcome AS delivery_outcome, cd.device_time AS delivered_at,
       (h.status IN ('delivered', 'delivered_in_part')) AS needs_receipt,
       rc2.confirmed_at AS receipt_at,
       CASE WHEN r.state = 'on_the_way' THEN
         (SELECT count(*) FROM stop s2
           WHERE s2.route_id = s.route_id AND s2.seq < s.seq AND s2.removed_at IS NULL
             AND NOT EXISTS (SELECT 1 FROM stop_order so2 JOIN delivery d2 ON d2.order_id = so2.order_id
                             WHERE so2.stop_id = s2.stop_id AND so2.removed_at IS NULL)) END AS stops_before_yours,
       data_through() AS data_through
FROM order_header h
JOIN outlet ou ON ou.outlet_id = h.outlet_id JOIN brand b ON b.brand_id = h.brand_id
LEFT JOIN stop_order so ON so.order_id = h.order_id AND so.removed_at IS NULL
LEFT JOIN stop s ON s.stop_id = so.stop_id
LEFT JOIN route r ON r.route_id = s.route_id
LEFT JOIN plan pl ON pl.plan_id = so.plan_id
LEFT JOIN LATERAL (SELECT * FROM deferral d WHERE d.order_id = h.order_id ORDER BY d.decided_at DESC LIMIT 1) ld ON true
LEFT JOIN reason_code rc ON rc.scope = ld.scope AND rc.code = ld.reason_code
LEFT JOIN current_delivery cd ON cd.order_id = h.order_id
LEFT JOIN store_receipt rc2 ON rc2.order_id = h.order_id
WHERE can_see_order(h.order_id);

-- S4: ordered, delivered and received side by side.
CREATE VIEW receipt_comparison AS
SELECT cd.order_id, cd.delivery_id, l.line_no, pr.name AS product_name, pr.unit,
       dl.ordered_qty, dl.expected_qty, dl.delivered_qty,
       dl.expected_qty < dl.ordered_qty AS short_loaded,
       ri.type AS issue_type, ri.qty AS issue_qty, ri.reference_no,
       CASE WHEN ri.issue_id IS NOT NULL THEN 'issue'
            WHEN dl.delivered_qty < dl.expected_qty THEN 'short_delivered'
            WHEN dl.expected_qty < dl.ordered_qty THEN 'short_loaded'
            ELSE 'ok' END AS line_state
FROM current_delivery cd
JOIN order_line l ON l.order_id = cd.order_id
JOIN product pr ON pr.product_id = l.product_id
LEFT JOIN delivery_line dl ON dl.delivery_id = cd.delivery_id AND dl.line_no = l.line_no
LEFT JOIN store_receipt rc ON rc.order_id = cd.order_id
LEFT JOIN receipt_issue ri ON ri.receipt_id = rc.receipt_id AND ri.line_no = l.line_no
WHERE can_see_order(cd.order_id);

-- S2: pre-fill sources.
CREATE VIEW order_form_defaults AS
SELECT u.outlet_id, u.temp, u.product_id, p.name AS product_name, p.unit, u.qty, 'usual'::text AS source
FROM outlet_usual_line u JOIN product p USING (product_id)
WHERE p.active AND EXISTS (SELECT 1 FROM app_user m WHERE m.user_id = me()
                           AND (m.outlet_id = u.outlet_id OR m.role IN ('dispatcher', 'admin')));

-- D1 per-vehicle fuel position.
CREATE VIEW fuel_week AS
SELECT ve.vehicle_id, ve.code, w.week_start, fuel_quota_for(ve.vehicle_id, w.week_start) AS quota_l,
       fuel_used_week(ve.vehicle_id, w.week_start) AS used_l,
       fuel_quota_for(ve.vehicle_id, w.week_start) - fuel_used_week(ve.vehicle_id, w.week_start) AS left_l
FROM vehicle ve CROSS JOIN LATERAL (SELECT week_start(current_date) AS week_start) w
WHERE ve.active AND EXISTS (SELECT 1 FROM app_user u WHERE u.user_id = me() AND (u.role = 'admin' OR u.depot_id = ve.depot_id));

-- D1 queue: orders in the run with no vehicle yet. Light on purpose; D2 adds the evidence.
CREATE VIEW unplanned_orders AS
SELECT p.plan_id, h.order_id, h.confirmation_no, h.temp, h.deferral_count, ou.outlet_id, ou.name AS outlet_name,
       h.placed_at, row_number() OVER (PARTITION BY p.plan_id ORDER BY h.placed_at, h.order_id) AS fcfs_rank,
       ou.van_only, ou.unload, b.code AS brand_code, ol.weight_kg, ol.volume_m3,
       (SELECT min(w.opens) FROM outlet_window w WHERE w.outlet_id = ou.outlet_id
          AND w.isodow = EXTRACT(isodow FROM h.delivery_date)::smallint) AS window_opens,
       (dd.order_id IS NOT NULL) AS deferral_drafted
FROM plan p
JOIN order_header h ON h.run_id = p.run_id AND h.status IN ('confirmed', 'planned')
JOIN outlet ou ON ou.outlet_id = h.outlet_id
JOIN brand b ON b.brand_id = h.brand_id
CROSS JOIN LATERAL order_load(h.order_id) ol
LEFT JOIN deferral_draft dd ON dd.plan_id = p.plan_id AND dd.order_id = h.order_id
WHERE NOT EXISTS (SELECT 1 FROM stop_order so WHERE so.order_id = h.order_id AND so.plan_id = p.plan_id AND so.removed_at IS NULL)
  AND can_see_order(h.order_id);

-- S2: the next slot an outlet can order for, and whether the one just missed was closed.
CREATE FUNCTION order_slot(p_outlet integer, p_temp temp_class)
RETURNS TABLE (delivery_date date, cutoff_at timestamptz, closes_in interval, closed_date date,
               joins_later_run boolean, existing_order_id bigint, existing_status order_status)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = wp, pg_temp AS $$
DECLARE d date; dep smallint; c date;
BEGIN
  IF NOT wp.can_see_outlet(p_outlet) THEN RETURN; END IF;
  SELECT depot_id INTO dep FROM wp.outlet WHERE outlet_id = p_outlet;
  c := wp.next_delivery_date(p_outlet, p_temp, current_date, now(), false);   -- first scheduled day, cutoff ignored
  d := wp.next_delivery_date(p_outlet, p_temp, current_date, now(), true);    -- first day still open
  delivery_date := d; cutoff_at := wp.run_cutoff(dep, d); closes_in := cutoff_at - now();
  closed_date := CASE WHEN c <> d THEN c END; joins_later_run := (c <> d);
  SELECT h.order_id, h.status INTO existing_order_id, existing_status FROM wp.order_header h
   WHERE h.outlet_id = p_outlet AND h.delivery_date = d AND h.temp = p_temp AND h.deferral_count = 0 AND h.status <> 'not_delivered';
  RETURN NEXT;
END $$;

-- D4 headline strip and chart. Closed days come back flagged, never as zero.
CREATE VIEW deferrals_per_day AS
SELECT g.day::date AS day, is_working_day(g.day::date) AS is_working,
       CASE WHEN is_working_day(g.day::date) THEN count(d.deferral_id) FILTER (WHERE d.kind = 'deferred') END AS deferred
FROM generate_series(current_date - 13, current_date, interval '1 day') g(day)
LEFT JOIN deferral d ON d.from_date = g.day::date AND can_see_outlet(d.outlet_id)
GROUP BY g.day;

CREATE VIEW ledger_headline AS
SELECT count(*) FILTER (WHERE d.from_date > current_date - 7 AND d.kind = 'deferred') AS deferred_last_7d,
       count(*) FILTER (WHERE d.from_date <= current_date - 7 AND d.from_date > current_date - 14 AND d.kind = 'deferred') AS deferred_prev_7d,
       (SELECT count(*) FROM outlet o WHERE can_see_outlet(o.outlet_id) AND outlet_skip_streak(o.outlet_id) >= 2) AS outlets_skipped_twice_running,
       (SELECT count(DISTINCT ri.order_id) FROM receipt_issue ri JOIN store_receipt sr ON sr.receipt_id = ri.receipt_id
         WHERE sr.confirmed_at > now() - interval '7 days' AND can_see_order(ri.order_id)) AS delivered_with_issue_last_7d,
       data_through() AS data_through
FROM deferral d WHERE can_see_outlet(d.outlet_id);

-- D1 banner: upcoming days with heavy road disruption, for the signed-in dispatcher's depot.
-- Information only; disruption slows travel, it does not forbid a trip.
CREATE VIEW road_disruptions AS
SELECT rc.district_id, d.name AS district, d.depot_id, rc.day, rc.disruption_index
FROM road_condition rc JOIN district d ON d.district_id = rc.district_id
WHERE rc.day >= current_date AND rc.disruption_index <= setting_int('road_warn_at_or_below')
  AND EXISTS (SELECT 1 FROM app_user u WHERE u.user_id = me() AND (u.role = 'admin' OR u.depot_id = d.depot_id));

-- Observed handling time beside the planning allowance, per delivery. The allowance (service_allowance)
-- is what planning uses; this is what actually happened, the input a later model learns from.
CREATE VIEW service_time_actual AS
SELECT d.order_id, d.stop_id, s.route_id, h.brand_id, ou.unload, sa.minutes AS allowance_min,
       round(extract(epoch FROM d.device_time - a.device_time) / 60)::integer AS actual_min,
       a.device_time AS arrived_at, d.device_time AS delivered_at
FROM delivery d
JOIN stop_arrival a ON a.stop_id = d.stop_id
JOIN stop s ON s.stop_id = d.stop_id
JOIN order_header h ON h.order_id = d.order_id
JOIN outlet ou ON ou.outlet_id = h.outlet_id
LEFT JOIN service_allowance sa ON sa.brand_id = h.brand_id AND sa.unload = ou.unload
WHERE d.supersedes_id IS NULL AND d.device_time >= a.device_time AND can_see_order(d.order_id);

-- ----- row-level security ----------------------------------------------------
ALTER TABLE order_header ENABLE ROW LEVEL SECURITY;
CREATE POLICY order_read ON order_header FOR SELECT USING (can_see_order(order_id));
ALTER TABLE order_line ENABLE ROW LEVEL SECURITY;
CREATE POLICY order_line_read ON order_line FOR SELECT USING (can_see_order(order_id));
ALTER TABLE order_status_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY osh_read ON order_status_history FOR SELECT USING (can_see_order(order_id));
ALTER TABLE route ENABLE ROW LEVEL SECURITY;
CREATE POLICY route_read ON route FOR SELECT USING (can_see_route(route_id));
ALTER TABLE stop ENABLE ROW LEVEL SECURITY;
CREATE POLICY stop_read ON stop FOR SELECT USING (can_see_route(route_id));
ALTER TABLE stop_order ENABLE ROW LEVEL SECURITY;
CREATE POLICY stop_order_read ON stop_order FOR SELECT USING (can_see_order(order_id));
ALTER TABLE delivery ENABLE ROW LEVEL SECURITY;
CREATE POLICY delivery_read ON delivery FOR SELECT USING (can_see_order(order_id));
ALTER TABLE delivery_line ENABLE ROW LEVEL SECURITY;
CREATE POLICY delivery_line_read ON delivery_line FOR SELECT USING (can_see_order(order_id));
ALTER TABLE store_receipt ENABLE ROW LEVEL SECURITY;
CREATE POLICY receipt_read ON store_receipt FOR SELECT USING (can_see_order(order_id));
ALTER TABLE receipt_issue ENABLE ROW LEVEL SECURITY;
CREATE POLICY issue_read ON receipt_issue FOR SELECT USING (can_see_order(order_id));
ALTER TABLE deferral ENABLE ROW LEVEL SECURITY;
CREATE POLICY deferral_read ON deferral FOR SELECT USING (can_see_order(order_id));
ALTER TABLE notice ENABLE ROW LEVEL SECURITY;
CREATE POLICY notice_read ON notice FOR SELECT USING (can_see_outlet(outlet_id));
CREATE POLICY notice_mark_read ON notice FOR UPDATE USING (can_see_outlet(outlet_id)) WITH CHECK (can_see_outlet(outlet_id));
ALTER TABLE flag ENABLE ROW LEVEL SECURITY;
CREATE POLICY flag_read ON flag FOR SELECT USING (can_see_route(route_id));
ALTER TABLE instruction ENABLE ROW LEVEL SECURITY;
CREATE POLICY instruction_read ON instruction FOR SELECT USING (can_see_route(route_id));
ALTER TABLE device_event ENABLE ROW LEVEL SECURITY;
CREATE POLICY event_read ON device_event FOR SELECT USING (user_id = me() OR (me_row()).role IN ('dispatcher', 'admin'));

-- ----- database roles ---------------------------------------------------------
-- Migrations run as the owner. The API connects as waypoint_app: no ownership, no TRUNCATE,
-- no UPDATE or DELETE on append-only tables, row-level security applies.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'waypoint_app') THEN CREATE ROLE waypoint_app NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'waypoint_worker') THEN CREATE ROLE waypoint_worker NOLOGIN BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'waypoint_readonly') THEN CREATE ROLE waypoint_readonly NOLOGIN; END IF;
END $$;

GRANT USAGE ON SCHEMA wp TO waypoint_app, waypoint_worker, waypoint_readonly;
REVOKE ALL ON ALL TABLES IN SCHEMA wp FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA wp FROM PUBLIC;

-- App: read everything it has a policy or view for; write only where the design needs it.
GRANT SELECT ON ALL TABLES IN SCHEMA wp TO waypoint_app, waypoint_readonly;
GRANT INSERT, UPDATE ON brand, depot, calendar_day, traffic_speed, vehicle_class, vehicle, fuel_quota, outlet, outlet_window,
      proof_rule, product, service_allowance, district, road_condition, reason_code, app_user, device, setting TO waypoint_app;
GRANT DELETE ON outlet_window, fuel_quota TO waypoint_app;
GRANT INSERT, UPDATE ON route, stop, plan, outlet_usual_line TO waypoint_app;       -- dispatcher edits; stop and route are never deleted
GRANT DELETE ON outlet_usual_line, order_draft, deferral_draft TO waypoint_app;
GRANT INSERT, UPDATE ON order_draft, deferral_draft, instruction, flag, notice, plan_conflict, plan_change_ack TO waypoint_app;
GRANT INSERT ON attachment, device_event TO waypoint_app;                            -- uploads and sync inbox are insert-only
GRANT USAGE ON ALL SEQUENCES IN SCHEMA wp TO waypoint_app, waypoint_worker;

-- Workflow functions the API may call.
GRANT EXECUTE ON FUNCTION place_order, amend_order, create_plan, assign_order, unassign_order, draft_deferral,
      confirm_deferrals, defer_order, requeue_order, release_plan, seed_plan_from_previous, send_instruction,
      resolve_flag, confirm_receipt, ingest_event, touch_device, device_sync_payload, plan_violations, fit_violations,
      suggested_reason, route_load, route_limits, order_load, fuel_left, fuel_used_week, fuel_quota_for,
      next_delivery_date, data_through, me, me_row, can_see_order, can_see_route, can_see_outlet,
      is_working_day, week_start, setting_int, outlet_skip_streak, is_consecutive_skip, proof_required,
      unconfirmed_lines, previous_working_day, run_cutoff, order_slot, trip_minutes, retime_route
   TO waypoint_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA wp TO waypoint_worker;
GRANT SELECT ON ALL TABLES IN SCHEMA wp TO waypoint_worker;
GRANT INSERT, UPDATE ON ALL TABLES IN SCHEMA wp TO waypoint_worker;
REVOKE UPDATE, DELETE, TRUNCATE ON audit_log, order_status_history, delivery, delivery_line, store_receipt,
       receipt_issue, attachment, deferral, plan_version, load_confirmation, route_release, stop_arrival FROM waypoint_worker, waypoint_app;

-- Workflow functions run with the owner's rights; they do their own role checks.
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'place_order','amend_order','close_run','cutoff_sweep','get_run','create_plan','assign_order','unassign_order',
    'draft_deferral','defer_order','confirm_deferrals','requeue_order','release_plan','seed_plan_from_previous',
    'send_instruction','resolve_flag','confirm_receipt','ingest_event','apply_event','apply_pending_events',
    'touch_device','device_sync_payload','advance_order','retime_route'] LOOP
    EXECUTE (SELECT string_agg(format('ALTER FUNCTION %s SECURITY DEFINER SET search_path = wp, pg_temp', p.oid::regprocedure), '; ')
             FROM pg_proc p WHERE p.pronamespace = 'wp'::regnamespace AND p.proname = f);
  END LOOP;
END $$;


-- =============================================================================
-- Reference data that is not in the CSV files: brands, depots, vehicle classes, proof rules, reasons.
-- =============================================================================
INSERT INTO brand(brand_id, code, name) VALUES (1, 'F', 'Waypoint Fresh'), (2, 'S', 'Waypoint Style'), (3, 'T', 'Waypoint Tech');
INSERT INTO depot(depot_id, name) VALUES (1, 'Peliyagoda'), (2, 'Kandy');

-- Capacities, fuel and quotas live on each vehicle (vehicles.csv). Reefer vehicles are
-- assumed to carry frozen goods as well as chilled; the data distinguishes only reefer and ambient.
INSERT INTO vehicle_class(class_id, code_prefix, name, is_van, carries_chilled, carries_frozen) VALUES
  (1, 'RT', 'Refrigerated truck', false, true,  true),
  (2, 'RV', 'Refrigerated van',   true,  true,  true),
  (3, 'DT', 'Dry-box truck',      false, false, false),
  (4, 'AV', 'Ambient van',        true,  false, false);

-- Districts, travel times, service allowances, vehicles, outlets, windows, the calendar,
-- road conditions and traffic speeds come from the supplied CSV files: see waypoint_import.sql.

-- The booklet asks for proof of delivery without saying which kind. One rule for every outlet,
-- matching the Day 5 design (DR3: photo and signature). Informational, never blocks a delivery.
INSERT INTO proof_rule(brand_id, unload, need_signature, need_photo) VALUES
  (NULL, NULL, true, true);

INSERT INTO reason_code(scope, code, label, store_label, needs_note, sort) VALUES
  ('deferral', 'no_refrigerated', 'No refrigerated capacity',      'No refrigerated vehicle that can reach your store was free.', false, 1),
  ('deferral', 'van_only_full',   'Van-only outlet and vans full', 'No van that can reach your store was free.',                  false, 2),
  ('deferral', 'window_unmet',    'Delivery window cannot be met', 'We could not reach your store inside its delivery window.',   false, 3),
  ('deferral', 'fuel_exhausted',  'Fuel quota exhausted',          'The vehicle for your area had no fuel allowance left this week.', false, 4),
  ('deferral', 'volume_full',     'Vehicle volume full',           'The delivery vehicles for your area were full.',              false, 5),
  ('deferral', 'no_vehicle',      'No vehicle left for this district', 'No vehicle was left to serve your area.',                 false, 7),
  ('deferral', 'other',           'Other (note required)',         'Your delivery was moved by the dispatch desk.',               true,  9),
  ('not_delivered', 'outlet_closed',   'Outlet closed',     'The store was closed.',               false, 1),
  ('not_delivered', 'access_blocked',  'Access blocked',    'The vehicle could not get access.',   false, 2),
  ('not_delivered', 'refused',         'Refused',           'The delivery was refused.',           false, 3),
  ('not_delivered', 'window_missed',   'Window missed',     'The delivery window was missed.',     false, 4),
  ('not_delivered', 'other',           'Other (note required)', 'The delivery could not be completed.', true, 9),
  ('part_delivery', 'not_on_vehicle',  'Not on the vehicle', 'The item was not on the vehicle.',  false, 1),
  ('part_delivery', 'damaged',         'Damaged',           'The item was damaged.',               false, 2),
  ('part_delivery', 'refused_item',    'Refused by store',  'The store refused the item.',         false, 3),
  ('part_delivery', 'other',           'Other (note required)', 'Some items were not delivered.', true, 9),
  ('flag_loader', 'missing', 'Missing', 'Missing', false, 1),
  ('flag_loader', 'short',   'Short',   'Short',   false, 2),
  ('flag_loader', 'damaged', 'Damaged', 'Damaged', false, 3),
  ('flag_driver', 'running_late',    'Running late',        'Running late',        false, 1),
  ('flag_driver', 'cannot_reach',    'Cannot reach outlet', 'Cannot reach outlet', false, 2),
  ('flag_driver', 'outlet_closed',   'Outlet closed',       'Outlet closed',       false, 3),
  ('flag_driver', 'vehicle_problem', 'Vehicle problem',     'Vehicle problem',     false, 4),
  ('flag_driver', 'load_problem',    'Load problem',        'Load problem',        false, 5),
  ('flag_driver', 'other',           'Something else (note required)', 'Something else', true, 9);

-- Every new connection to this database looks in schema wp first, so the API can write
-- "SELECT * FROM outlet". Set on the database (not per connection) because Neon's proxy and
-- its PgBouncer pooler do not pass a per-connection search_path through.
DO $$ BEGIN
  EXECUTE format('ALTER DATABASE %I SET search_path = wp, public', current_database());
END $$;

COMMIT;
