# Waypoint · Team AlphaZero

Delivery planning, loading and run tracking for Waypoint's three brands (Fresh, Style, Tech) and two
depots (Peliyagoda, Kandy). Tech-Triathlon 2026, Hackathon phase.

One system, four role apps:

| Role | Device | What it does |
|---|---|---|
| **Dispatcher** | Desktop / laptop (works on a phone) | Closes orders, lets the allocation engine build the plan, checks deferrals, sends the plan, watches the run live, keeps the record |
| **Loader** | Dock tablet (portrait or landscape) | Loads each vehicle last-stop-first, ticks lines, flags missing / short / damaged, releases the vehicle |
| **Driver** | Own phone, works with no signal | Start trip → I'm here → Deliver, proof (name, signature, photo), problems, corrections |
| **Store manager** | Phone or PC | Orders before the cutoff, sees what is coming (or deferred, and why), confirms what arrived |

Why each screen looks the way it does, with screenshots from a full run: [docs/ux-by-role.md](docs/ux-by-role.md).

## Run it (Docker)

Needs Docker Desktop. Nothing else: the database, the seed data and the sign-in are all inside.

```bash
docker compose up --build
```

No `.env` is needed; copy `.env.example` to `.env` only to change ports or passwords.
Open **http://localhost:3000** (or the `WEB_PORT` in `.env`). First start loads the schema, the seven
CSVs from `data/general/` and a demo delivery day; it takes about a minute.

| Service | URL | Notes |
|---|---|---|
| Web app | http://localhost:3000 | Next.js 16 |
| API | http://localhost:8000/docs | FastAPI, OpenAPI docs |
| Database | `postgresql://waypoint:waypoint@localhost:5433/waypoint` | PostgreSQL 18, schema `wp` (owner login) |

The API itself does not use the owner login: it connects as `waypoint_api`, a restricted role that
row-level security and the append-only rules apply to ([docs/security.md](docs/security.md)).

Start again from nothing: `docker compose down -v`, then `docker compose up --build`. **Do this once after
updating from an older version**: the API's role is created when the database is first built.

### Sign in

The Docker build signs in locally (no outside account). The sign-in page lists the demo accounts;
tap one to sign in. All use the password **`waypoint-demo`**.

| Account | Role | Scope |
|---|---|---|
| `dispatcher@example.com` | Dispatcher | Both depots: the planning office switches between Kandy and Peliyagoda in the header (starts on Kandy) |
| `loader.kandy@example.com` | Loader | Kandy depot |
| `driver.veh057@example.com` | Driver | VEH057 (refrigerated van) |
| `driver.veh059@example.com`, `driver.veh060@example.com` | Driver | VEH059, VEH060 (ambient vans) |
| `store.out077@example.com`, `store.out078@example.com` | Store manager | Fresh Kandy OUT077, OUT078 |

The database also holds an `admin@example.com` account (demo reset places the seed orders as it); it is
not listed on the sign-in page because it has no depot, vehicle or outlet of its own.

The deployed app uses Clerk for sign-in instead (`AUTH_MODE=clerk`); see [Deploy](#deploy).

## Walk through a delivery day (about 10 minutes)

The demo day is **the next open delivery day**: 70 Kandy orders across Fresh (dry and chilled), Style
and Tech, including the Day 5 worked example (seven van-only chilled orders, 2,290 kg, against one
refrigerated van with VEH058 in the workshop), and 114 Peliyagoda orders. The walkthrough follows Kandy;
the dispatcher switches to Peliyagoda with the depot selector in the header.

1. **Store manager** (`store.out077`) → *Order* → place the dry-groceries order (the usual order is
   pre-filled). Note the cutoff: 16:00 the working day before.
2. **Dispatcher** → *Plan*. Follow the step strip; the main button is always the next step:
   1. **Close orders now** (normally automatic at the cutoff). Later orders go to the next day.
   2. **Build the plan**: the engine places every order it legally can (22 trips, 69 of 70 orders; the
      tests prove no legal plan serves more).
   3. **Check what can't go**: 1 order, with the reason the store will see. *Try to fit* lists
      every vehicle and the rule that stops it (OUT078: both VEH057 trips full, trucks can't reach a
      van-only outlet, VEH058 in the workshop, dry vehicles can't carry chilled).
   4. **Send plan to depot**: loaders and drivers get their trips; the store is told.
3. **Loader** → open **VEH057 · trip 1** → load stop 3 first; *Flag* one line as Short → confirm
   the stops → **Departure check** → release to the driver (signed with the loader's account).
4. **Driver** (`driver.veh057`) → **Start trip** → **I'm here** → *All delivered*, name, signature →
   **Save delivery** → **Next stop**. Open *Menu* → *Simulate no signal*, deliver the next stop: it
   is kept on the phone ("Not sent yet"); switch the signal back and it sends by itself. Stop 3 shows
   the loader's shortfall.
5. **Dispatcher** → *Live*: trips by risk, the short-load and the loader's flag (*Send partial* /
   *Hold vehicle*).
6. **Store manager** (`store.out077`) → *Confirm*: ordered / driver delivered / received per line;
   *Report issue* on a line. `store.out078` sees "Not arriving on Tuesday" and the reason.
7. **Dispatcher** → *Records*: every deferral and delivery with who decided, when and why (CSV export).

*Reset demo* (dispatcher header) wipes the day and seeds a fresh one. *Reset demo* and the driver's
*Simulate no signal* are demo controls: they exist only with local sign-in (this Docker delivery); the
deployed app (Clerk) hides them and its API refuses the reset.

## The rules (Challenge Booklet) and where they are enforced

Every booklet constraint is enforced in the database (`db/waypoint_schema.sql`: triggers,
`fit_violations`, `plan_violations`) and respected by the engine (`backend/app/modules/dispatch/engine.py`).
A plan that breaks a rule cannot be sent; a manual move that breaks one is refused with the reason.

| Rule | |
|---|---|
| One brand and one district per trip; whole orders; at most two trips per vehicle | ✓ |
| Home depot only (a dispatcher plans one depot at a time; loaders and drivers see only their own) | ✓ |
| Weight **and** volume per trip | ✓ |
| Chilled only on refrigerated vehicles; van-only outlets only by vans; home depot only | ✓ |
| Trip minutes = outbound + inter-stop × (orders − 1) + service allowance | ✓ |
| Fresh ≤ 270 min per vehicle, departing from 03:30; Style + Tech ≤ 480 min | ✓ |
| Delivery and mall windows; an early vehicle waits | ✓ |
| Weekly fuel quota (route distance incl. return) | ✓ |
| Vehicles in the workshop are not used | ✓ |
| Orders close 16:00 the operating day before; later orders join the next run | ✓ |
| Deferrals carry a reason; the store is told | ✓ |

Details: [docs/database.md](docs/database.md). API: [docs/api.md](docs/api.md).

## Tests

```bash
cd backend
# needs the Docker database running (docker compose up db); every script resets the demo data
ENVIRONMENT=development AUTH_DEV_BYPASS=true AUTH_MODE=local LOCAL_AUTH_SECRET=test-only-local-secret-0123456789abcdef \
ALLOWED_HOSTS='["testserver"]' PUBLIC_API_URL=http://testserver \
DATABASE_URL="postgresql://waypoint_api:waypoint-api-local@localhost:5433/waypoint?sslmode=disable" \
ADMIN_DATABASE_URL="postgresql://waypoint:waypoint@localhost:5433/waypoint?sslmode=disable" \
uv run python tests/rules_audit.py
```

The API under test connects as the restricted role (`DATABASE_URL`), exactly as in Docker; test set-up uses
the owner (`ADMIN_DATABASE_URL`).

- `tests/security_audit.py`: **56 checks** that attack every protection: the API's database role (append-only
  tables, row-level security, no schema changes), attachments (real images only, only on your own record,
  never replaced), forged and expired tokens, the sign-in throttle, cross-depot edits, headers and request
  limits. See [docs/security.md](docs/security.md).

- `tests/rules_audit.py`: **118 checks**. Recomputes every booklet rule from the CSVs (not from the
  database) for the Kandy demo day, a Peliyagoda peak day (all 75 outlets order, two refrigerated
  vehicles in the workshop) and the next day's run; checks whether any deferral was avoidable (below); tries every
  way of breaking a rule by hand through the API (each must be refused); checks the cutoff, release,
  deferral records, store notices and depot switching.
- `tests/day_scenario.py`: **one complete delivery day, both depots** (118 checks): store orders of every
  category, the 16:00 cutoff on the clock, both plans audited rule by rule, every trip loaded and driven
  (failed, short and offline deliveries), failed orders moved on, receipts, the end-of-day close with fuel
  against the weekly quota, and the next day serving everything carried over. Screens of the same day:
  [docs/walkthrough/waypoint-delivery-day.html](docs/walkthrough/waypoint-delivery-day.html).
- `tests/walkthrough.py`: the four roles end to end through the API, including offline sync,
  idempotent resends, corrections and photo links.

**Was any deferral avoidable?** Two checks per planned day. A quick one tries each deferred order on
every trip and free vehicle slot. An exact one (`tests/optimality.py`) asks whether *any* legal plan serves
more orders, putting outlets deferred before first: a mixed-integer program over the same booklet rules
(HiGHS, a test-only dependency: `uv sync` installs it, the Docker image does not), started from the engine's
plan, with time windows checked by replaying every trip and cut out lazily. It reports **proven**, a
**better plan** (the check fails and names the orders), or **not proven** in the time limit with an upper
bound (`WP_EXACT_SECONDS`, default 120 per plan). Today: both Kandy days are proven optimal; the
Peliyagoda peak days, with two reefers in the workshop, are not proven within the limit and no better
plan is found.

Frontend: `cd frontend && pnpm lint && npx tsc --noEmit`.

## Deploy

| Part | Where | Settings |
|---|---|---|
| Database | Neon (PostgreSQL 18) | `./db/load.sh "$NEON_DATABASE_URL"` once; `--migrate` after schema changes |
| Photos | Neon object storage (S3 API) | in the API's variables |
| API | Vercel, Root Directory `backend` | *Deployed* section of [`backend/.env.example`](backend/.env.example) |
| Web | Vercel, Root Directory `frontend` | *Deployed* section of [`frontend/.env.example`](frontend/.env.example) |
| Sign-in | Clerk organization, roles `dispatcher` · `loader` · `driver` · `store_manager` | users with the demo e-mails above |

Step by step, with the checks after each deployment: [docs/deploy.md](docs/deploy.md).

## Repository

```
backend/    FastAPI API, allocation engine, local sign-in, tests
frontend/   Next.js 16 app: /dispatcher, /loader, /driver, /store-manager
db/         schema, CSV import, migrations, demo seed, load.sh (Neon)
data/general/   the seven General Data CSVs (the only competition data in the repo)
docs/       deploy guide, database, API, UX by role (+ screenshots)
docker-compose.yml, .env.example   Docker delivery (docker compose up)
```
