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
cp .env.example .env
docker compose up --build
```

Open **http://localhost:3000** (or the `WEB_PORT` in `.env`). First start loads the schema, the seven
CSVs from `data/general/` and a demo delivery day; it takes about a minute.

| Service | URL | Notes |
|---|---|---|
| Web app | http://localhost:3000 | Next.js 16 |
| API | http://localhost:8000/docs | FastAPI, OpenAPI docs |
| Database | `postgresql://waypoint:waypoint@localhost:5433/waypoint` | PostgreSQL 18, schema `wp` |

Start again from nothing: `docker compose down -v`, then `docker compose up --build`.

### Sign in

The Docker build signs in locally (no outside account). The sign-in page lists the demo accounts;
tap one to sign in. All use the password **`waypoint-demo`**.

| Account | Role | Scope |
|---|---|---|
| `dispatcher@waypoint.demo` | Dispatcher | Kandy depot |
| `loader.kandy@waypoint.demo` | Loader | Kandy depot |
| `driver.veh057@waypoint.demo` | Driver | VEH057 (refrigerated van) |
| `driver.veh059@waypoint.demo`, `driver.veh060@waypoint.demo` | Driver | VEH059, VEH060 (ambient vans) |
| `store.out077@waypoint.demo`, `store.out078@waypoint.demo` | Store manager | Fresh Kandy OUT077, OUT078 |
| `admin@waypoint.demo` | Admin | Every role's app (open `/loader`, `/driver`, `/store-manager` directly) |

The deployed app uses Clerk for sign-in instead (`AUTH_MODE=clerk`); see [Deploy](#deploy).

## Walk through a delivery day (about 10 minutes)

The demo day is **the next open delivery day for Kandy**: 70 orders across Fresh (dry and chilled),
Style and Tech, including the Day 5 worked example (seven van-only chilled orders, 2,290 kg, against one
refrigerated van with VEH058 in the workshop).

1. **Store manager** (`store.out077`) → *Order* → place the dry-groceries order (the usual order is
   pre-filled). Note the cutoff: 16:00 the working day before.
2. **Dispatcher** → *Plan*. Follow the step strip; the main button is always the next step:
   1. **Close orders now** (normally automatic at the cutoff). Later orders go to the next day.
   2. **Build the plan**: the engine places every order it legally can (21 trips, 67 orders).
   3. **Check what can't go**: 3 orders, each with the reason the store will see. *Try to fit* lists
      every vehicle and the rule that stops it (OUT078: both VEH057 trips full, trucks can't reach a
      van-only outlet, VEH058 in the workshop, dry vehicles can't carry chilled).
   4. **Send plan to depot**: loaders and drivers get their trips; the 3 stores are told.
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

*Reset demo* (dispatcher header) wipes the day and seeds a fresh one.

## The rules (Challenge Booklet) and where they are enforced

Every booklet constraint is enforced in the database (`db/waypoint_schema.sql`: triggers,
`fit_violations`, `plan_violations`) and respected by the engine (`backend/app/modules/dispatch/engine.py`).
A plan that breaks a rule cannot be sent; a manual move that breaks one is refused with the reason.

| Rule | |
|---|---|
| One brand and one district per trip; whole orders; at most two trips per vehicle | ✓ |
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
# needs the Docker database running (docker compose up db); both scripts reset the demo data
ENVIRONMENT=development AUTH_DEV_BYPASS=true ALLOWED_HOSTS='["testserver"]' PUBLIC_API_URL=http://testserver \
DATABASE_URL="postgresql://waypoint:waypoint@localhost:5433/waypoint?sslmode=disable" uv run python tests/rules_audit.py
```

- `tests/rules_audit.py`: **112 checks**. Recomputes every booklet rule from the CSVs (not from the
  database) for the Kandy demo day, a Peliyagoda peak day (all 75 outlets order, two refrigerated
  vehicles in the workshop) and the next day's run; searches for any avoidable deferral; tries every
  way of breaking a rule by hand through the API (each must be refused); checks the cutoff, release,
  deferral records and store notices.
- `tests/walkthrough.py`: the four roles end to end through the API, including offline sync,
  idempotent resends, corrections and photo links.

Frontend: `cd frontend && pnpm lint && npx tsc --noEmit`.

## Deploy

| Part | Where | Settings |
|---|---|---|
| Database | Neon (PostgreSQL 18) | `./db/load.sh "$NEON_DATABASE_URL"` once; `--migrate` after schema changes |
| Photos | Neon object storage (S3 API) | `STORAGE_BACKEND=s3`, `AWS_*` from `.env.aws` |
| API | Vercel (FastAPI) | `DATABASE_URL` (pooled), `AUTH_MODE=clerk`, `CLERK_*`, `CORS_ORIGINS`, `ALLOWED_HOSTS` |
| Web | Vercel (Next.js) | `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_AUTH_MODE=clerk`, Clerk keys |

With Clerk, create users with the demo e-mail addresses above; the API links a Clerk sign-in to its
Waypoint account by e-mail on first use. Roles come from the Waypoint database, not from Clerk.

## Repository

```
backend/    FastAPI API, allocation engine, local sign-in, tests
frontend/   Next.js 16 app: /dispatcher, /loader, /driver, /store-manager
db/         schema, CSV import, migrations, demo seed, load.sh (Neon)
data/general/   the seven General Data CSVs (the only competition data in the repo)
docs/       database, API, UX by role (+ screenshots)
docker-compose.yml, .env.example
```

## AI assistance

Parts of this project were written with an AI coding assistant (Claude Code, Anthropic): schema
review against the booklet, the allocation engine, API endpoints, frontend wiring, tests and
documentation. Every change was reviewed, run and tested by the team; design decisions are the team's.
