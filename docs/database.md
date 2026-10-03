# Database: schema and seed data

PostgreSQL **18** everywhere (Neon runs 18; Docker uses `postgres:18-alpine`). All tables live in schema **`wp`**.

| File | What it does |
|---|---|
| `db/waypoint_schema.sql` | Creates schema `wp`: tables, relationships, the booklet's rules (triggers + `plan_violations()`), workflow functions, views, roles, and fixed reference rows not in the CSVs (brands, depots, vehicle classes, proof rule, reason codes). Run **once** on an empty database. |
| `db/waypoint_import.sql` | Loads the 7 CSVs in `data/general/`. Safe to run again (updates rows in place). |
| `db/init/10-load-waypoint.sh` | Runs both automatically inside the Docker `db` container on its first start. |
| `db/migrations/*.sql` | Changes after the base schema (001: driver per vehicle, photo storage, `demo_reset()`). Safe to re-run. |
| `db/load.sh` | Runs all of it against any database URL (Neon). |

## Local: Docker

```bash
docker compose up --build
```

First start (empty volume): `db` creates the schema and loads the CSVs, then `api` starts (`/health` → 200).
From your PC the database is on port **5433**: `postgresql://waypoint:waypoint@localhost:5433/waypoint`.
Wipe and reload: `docker compose down -v`, then `docker compose up --build`.

## Neon

Needs `psql` 16+. Use the **direct** connection string for loading (Neon → Connect → pooling **off**).

```bash
# .env.neon (git-ignored), single quotes because the URL contains '&':
#   NEON_DATABASE_URL='postgresql://USER:PASSWORD@ep-xxxx.REGION.aws.neon.tech/neondb?sslmode=require&channel_binding=require'
set -a; . ./.env.neon; set +a

./db/load.sh "$NEON_DATABASE_URL"            # empty database: schema + CSVs + migrations + demo day
./db/load.sh "$NEON_DATABASE_URL" --migrate  # existing database: apply db/migrations/*.sql (safe to re-run)
./db/load.sh "$NEON_DATABASE_URL" --demo     # wipe orders/plans/deliveries, seed a fresh demo day
./db/load.sh "$NEON_DATABASE_URL" --data     # reload the CSVs only
./db/load.sh "$NEON_DATABASE_URL" --reset    # drop schema wp (ALL app data) and rebuild everything
```

The deployed API uses the **pooled** string (host contains `-pooler`) as `DATABASE_URL`.
Check: Neon SQL Editor → `SELECT count(*) FROM wp.outlet;` → 120 (Tables page: pick schema `wp`).

## Backend connection

- `DATABASE_URL` (Neon) or the `POSTGRES_*` parts (Docker) — see `backend/.env.example`.
- `get_db()` starts every transaction with `begin_transaction()`: `search_path = wp, public` and
  `wp.user_id` (the signed-in user that `wp.me()` and the row-level policies read). Both are
  transaction-local, which keeps them correct behind Neon's PgBouncer pooler. After a `commit()`,
  call `begin_transaction(session, user_id)` again before the next statement.
- Use the workflow functions instead of writing the tables directly: `place_order`, `close_run`,
  `create_plan`, `assign_order`, `retime_route`, `plan_violations`, `draft_deferral`,
  `confirm_deferrals`, `release_plan`, `ingest_event`, `confirm_receipt`, ...; read through the views
  (`order_board`, `route_board`, `load_list`, `monitor_exceptions`, `store_orders`, ...).
- Alembic is not used for `wp`. A later schema change is a new SQL file run the same way.

## Rules in the database = the booklet's constraints

| Booklet constraint | Where it is enforced |
|---|---|
| Weight **and** volume per trip | `fit_violations` (on assign), `plan_violations` (on release) |
| Chilled only on refrigerated vehicles | `fit_violations`, `plan_violations` |
| Van-only outlets only by vans | `fit_violations`, `plan_violations` |
| Home depot only | FK route→vehicle depot, `fit_violations` |
| One brand + one district per trip | trigger `stop_matches_route` |
| Whole orders (one vehicle, one trip) | unique live `stop_order` per order |
| At most two trips per vehicle | `route.seq IN (1,2)` + unique (plan, vehicle, seq) |
| Trip time = outbound + inter-stop × (orders−1) + service allowances | `trip_minutes()` |
| Fresh 270 min from 03:30; Style + Tech 480 min | `plan_violations` (`time_budget`, `fresh_window`) |
| Delivery / mall windows; early vehicles wait | `retime_route` (waits), `plan_violations` (`window`) |
| Weekly fuel quota (route distance) | `fuel_left`, `plan_violations` (`fuel`) |
| Vehicles in the workshop cannot run | `vehicle.active`, `plan_violations` (`vehicle_unavailable`) |
| Operating days; orders close 16:00 for the next operating day | `is_working_day`, `run_cutoff`, `next_delivery_date` |
| Deferrals recorded with a reason, store told | `defer_order` → `deferral` + `notice` |

## Changes from the team's original SQL (and why)

Removed — not in the booklet:
- `outlet_schedule` (fixed order weekdays per outlet). Orders go to the next operating day whose cutoff is open.
- Driver overlap rule and "route has no driver" check (booklet: driver availability is not a constraint).
- "Road closed" rule and `road_closed` reason (disruption slows travel; it never forbids a trip). The D1 banner view is now `road_disruptions`.
- Per-dock proof rules (signature at rear dock, photo at street, both for Tech) → one rule for all outlets, photo + signature as in the Day 5 design. It never blocks a delivery.
- Loader PIN requirement on `app_user` (sign-in method is undecided); added `clerk_user_id`.

Added — in the booklet but missing:
- Daily time budgets: Fresh ≤ 270 min starting 03:30, Style + Tech ≤ 480 min per vehicle.
- Early arrival waits for the window to open (planned arrival = window opening).
- Workshop vehicles cannot be planned.
- Route distance includes the return leg (it is what uses the fuel quota).

Fixed: `free_flow_kmh` staged as `numeric` (the CSV holds `30.0`).
