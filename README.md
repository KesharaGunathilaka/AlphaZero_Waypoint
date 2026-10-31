<div align="center">

<img src="frontend/public/waypoint-logo.png" alt="Waypoint" width="180">

# Waypoint

**Every order planned, explained and tracked to the shelf.**

Delivery planning, loading and live run tracking for three retail brands and two depots,
with the intelligence built in and every rule enforced where nothing can bypass it.

Team AlphaZero · Tech-Triathlon 2026 (Designathon → Hackathon → Datathon → Grand Finale)

![Next.js](https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=000)
![FastAPI](https://img.shields.io/badge/FastAPI-Python-009688?logo=fastapi&logoColor=fff)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-18-4169E1?logo=postgresql&logoColor=fff)
![LightGBM](https://img.shields.io/badge/LightGBM-models-9ACD32)
![Docker](https://img.shields.io/badge/Docker-one%20command-2496ED?logo=docker&logoColor=fff)

![Tests](https://img.shields.io/badge/rules%20audit-118%2F118-2ea44f)
![Tests](https://img.shields.io/badge/full--day%20scenario-118%2F118-2ea44f)
![Tests](https://img.shields.io/badge/security%20attacks%20refused-61%2F61-2ea44f)

</div>

<p align="center"><img src="docs/images/live.jpg" alt="Live: both depots on one screen, the fleet timeline and Needs attention" width="900"></p>

---

## Contents

[Why Waypoint](#why-waypoint) · [The four apps](#one-system-four-roles-one-record) · [The intelligence](#the-intelligence-and-the-proof) ·
[By the numbers](#by-the-numbers) · [Run it](#run-it-in-one-command) · [Demo in ten minutes](#show-a-delivery-day-in-ten-minutes) ·
[Architecture](#architecture) · [Rules](#every-booklet-rule-enforced-in-the-database) · [Tests](#tests) · [Deploy](#deploy) ·
[Repository](#repository) · [Docs](#documentation)

## Why Waypoint

Waypoint (the case company) delivers **Fresh** groceries (dry and chilled), **Style** clothing and **Tech** electronics to
**120 stores** from two depots, **Peliyagoda** and **Kandy**, with **60 vehicles** across 12 districts. Orders close at
16:00, the first vans leave at 03:30, and Fresh stores must be stocked before they open. Today the plan lives in a
spreadsheet and one person's head, nobody sees the vans after they leave, and nobody sees next month's demand.

Waypoint closes those three blind spots:

| | |
|---|---|
| **Plan** | The engine places every order the fleet can legally carry in about 18 ms, explains every one it can't, and is proven optimal on our test days. |
| **Anticipate** | A 10-week demand forecast sizes refrigerated capacity, and a per-stop model warns before a running van lets a store down. |
| **Connect** | Store, dispatcher, loader and driver share one record. Field work continues with no signal and syncs exactly once. |

## One system, four roles, one record

```
Store orders  →  Dispatcher plans  →  Loader loads  →  Driver delivers  →  Store confirms
   (16:00)         (engine + rules)     (last stop first)   (offline, proof)     (line by line)
```

### Dispatcher · plan, watch, decide

<table>
<tr>
<td width="50%"><img src="docs/images/plan.jpg" alt="Plan tab"></td>
<td width="50%"><img src="docs/images/try-to-fit.jpg" alt="Try to fit"></td>
</tr>
<tr>
<td><b>Plan.</b> Close orders → Build the plan → Check what can't go → Send to depot. 69 of 70 Kandy orders on 22 trips,
every booklet rule checked, the day timeline per vehicle.</td>
<td><b>Try to fit.</b> For an order that can't go: every vehicle and the rule that stops it, and <i>what would fix
it</i> (here, the van in the workshop). Every option is tried on the server first.</td>
</tr>
<tr>
<td><img src="docs/images/needs-attention.jpg" alt="Needs attention"></td>
<td><img src="docs/images/capacity.jpg" alt="Capacity"></td>
</tr>
<tr>
<td><b>Live.</b> Both depots on one screen. Trip colour follows the worst alert (red: failed delivery or driver's report;
amber: flagged or late; hatched: no signal). Needs attention is ranked critical → warning → information, oldest first,
each alert with its action. Refreshes every 15 s and chimes for new alerts.</td>
<td><b>Capacity.</b> The Datathon forecast for the next 10 weeks, per depot and brand: vehicles a day, refrigerated
space and a plain conclusion. <b>End of day</b> and <b>Records</b> close the loop: outcomes, fuel against the weekly
quota, and who decided what, when and why (CSV export).</td>
</tr>
</table>

### Loader, driver and store manager

<table>
<tr>
<td width="40%"><img src="docs/images/loader.jpg" alt="Loader flags a line"></td>
<td width="20%"><img src="docs/images/driver.jpg" alt="Driver trip summary"></td>
<td width="20%"><img src="docs/images/store-late.jpg" alt="Store late notice"></td>
<td width="20%"><img src="docs/images/store-confirm.jpg" alt="Store confirms receipt"></td>
</tr>
<tr>
<td><b>Loader</b> (dock tablet): vehicles by departure, load list last stop first, flag Missing / Short / Damaged, departure
check, release to the driver.</td>
<td><b>Driver</b> (own phone): Start trip → I'm here → delivered, with name, signature and photo. Works with no signal.</td>
<td><b>Store</b>: sees when it's coming; if likely late, answers “we'll receive until…”.</td>
<td>Confirms what arrived, line by line, and reports any issue.</td>
</tr>
</table>

## The intelligence, and the proof

| The brief asks the product to… | Where Waypoint does it | Proof |
|---|---|---|
| **Work** | Allocation engine: scarcest capacity first, repeat deferrals first, Fresh, earliest window | ~18 ms per depot-day; Kandy 69 of 70, **proven optimal** by an exact solver (HiGHS MILP) |
| **Predict** | Demand 10 weeks ahead (Task 2A); handling time and lateness per stop (Task 1) | **2.1%** chilled / **3.1%** total error over 49 backtests; handling time **3.9 vs 7.4 min**; lateness AUC **0.98** |
| **Recommend** | Try to fit and “what would fix it”; Capacity's plain conclusions | The what-if re-runs the real engine |
| **Automate** | 16:00 cutoff; stores told of deferrals; illegal plans refused by the database | Rules audit 118/118 |
| **Respond** | Live ranks problems within ~15 s of a phone syncing; early warning when a van is likely to miss a window | Full-day scenario 118/118 |
| **Support decisions** | Reasons on every deferral; Records of who decided; no outlet skipped twice | Records, engine priority rule |

- **Fast engine, exact audit.** A greedy, explainable engine plans in milliseconds; a mixed-integer program over the same
  rules asks whether *any* legal plan serves more. Building that check exposed a real weakness (a vehicle's two trips
  in the wrong order). Fixing it took Kandy from 67 to 69 of 70 and cut deferrals by 41% in a two-year replay.
- **Forecast (Task 2A).** Expected orders × predicted size: Poisson GLM with a regularised LightGBM correction; P10–P90
  ranges with 78–80% coverage. Shown honestly as ranges for erratic brands.
- **Stops (Task 1).** LightGBM over three seeds, leakage-safe history features, calibrated (ECE < 0.01). In Live, the
  chance at plan time is compared with the chance replayed from where the van really is; an alert needs **+20 points
  and ≥ 50%**, so it reacts to today's delays, not a store's history.

## By the numbers

| | |
|---|---|
| **~18 ms** | to plan a peak depot-day |
| **69 / 70** | Kandy demo day, proven optimal |
| **76 / 85** | Datathon peak day S1 (simple priority heuristic: 67; exact optimum: 77), organisers' checker passed |
| **−41%** | deferrals in a two-year replay with two refrigerated vehicles out (2,038 → 1,212) |
| **92,307** | orders replayed over 1,318 depot-days of history |
| **< 2 s** | per Live refresh with both depots running |
| **118 · 118 · 61** | rules audit · full-day scenario · security attacks refused, all passing |

## Run it in one command

Needs Docker Desktop, nothing else: database, seed data and sign-in are inside.

```bash
docker compose up --build
```

Open **http://localhost:3000**. The first start loads the schema, the seven competition CSVs from `data/general/` and a
demo delivery day (about a minute). No `.env` is needed; copy `.env.example` to `.env` only to change ports or passwords.

| Service | URL |
|---|---|
| Web app | http://localhost:3000 |
| API (OpenAPI docs) | http://localhost:8000/docs |
| Database | `postgresql://waypoint:waypoint@localhost:5433/waypoint` (owner login; the API itself uses a restricted role) |

Start again from nothing: `docker compose down -v`, then `docker compose up --build`.

### Demo accounts

Tap an account on the sign-in page. Every account's password is **`waypoint-demo`**.

| Role | Kandy | Peliyagoda |
|---|---|---|
| Dispatcher (both depots) | Ruwan Perera · `dispatcher@example.com` | (same account; switch depot in the header) |
| Loader | Kasun Jayasinghe · `loader.kandy@example.com` | Tharaka Gunawardena · `loader.peliyagoda@example.com` |
| Driver | Nuwan (VEH057), Saman (VEH059), Pradeep (VEH060) | Roshan Fernando (VEH001) |
| Store manager | Fresh: OUT077, OUT078 · Style OUT102 · Tech OUT103 | Fresh OUT007 · Style OUT018 · Tech OUT022 |

The deployed app signs in with Clerk instead (`AUTH_MODE=clerk`) and hides the demo controls.

## Show a delivery day in ten minutes

Use one browser profile per role so the sign-ins don't log each other out. Live refreshes every 15 seconds.

1. **Dispatcher** → *Reset demo* → *Plan* → **Close orders now** → **Build the plan** → **Send plan to depot**. Switch the
   depot to Peliyagoda and repeat. (Kandy: OUT078 can't go, and *Try to fit* shows why and what would fix it.)
2. **Demo clock** → **Delivery morning, 04:30**. Live shows vans that haven't left yet.
3. **Loader** → VEH057 → flag a line **Short** → confirm each stop → **Departure check** → release.
4. **Driver** (Saman) → **Problem** → **Vehicle problem** → save. Live: red at the top → **Reply to driver**.
5. **Demo clock** to about **07:15** with VEH057 not started. Live: “likely to miss window”. **Store** (Fathima, OUT077)
   answers **We'll receive until …**.
6. **Driver** (Roshan, VEH001) → **Start trip** → **I'm here** → **Not delivered** → reason. Live: red with ✕ →
   **Move to next delivery day**.
7. **Driver** (Nuwan) → *Menu* → **Simulate no signal**; Demo clock +15 min twice. Live: hatched, “No signal”.
8. **Live › End of day** and **Records**: outcomes, fuel, every decision with who and why.

## Architecture

```mermaid
flowchart LR
  subgraph Devices
    S[Store manager] & D[Dispatcher] & L[Loader tablet] & R[Driver phone]
  end
  subgraph Web["Next.js 16 web app"]
    UI[Four role screens]
    OB[Offline outbox<br/>local storage + IndexedDB]
  end
  subgraph API["FastAPI (stateless)"]
    EN[Allocation engine]
    ML[LightGBM models<br/>Task 1 · Task 2A]
    AU[Sign-in, role and depot checks]
  end
  DB[(PostgreSQL 18<br/>rules as triggers · append-only facts<br/>row-level security)]
  S & D --> UI
  L & R --> OB --> API
  UI --> API --> DB
```

| Layer | Technology |
|---|---|
| Web | Next.js 16, React 19, TypeScript, Tailwind CSS 4; a service worker opens the driver app with no signal |
| API | FastAPI, async SQLAlchemy, asyncpg, slowapi (rate limits), PyJWT |
| Intelligence | Greedy allocation engine; HiGHS MILP audit (tests); LightGBM 4.7, pandas, NumPy |
| Database | PostgreSQL 18: booklet rules in triggers and functions, append-only facts, row-level security, views for Live and Records |
| Hosting | Docker (local and demo); Vercel (web and API), Neon (Postgres and object storage), Clerk (sign-in) when deployed |

**Offline, exactly once.** Every tap on a phone or tablet becomes an event with its own ID, the device time and a
sequence number. It is saved on the device first and sent when the server answers; repeats are ignored, and events that
arrive early wait for what they depend on. No double deliveries, true timelines, nothing lost in dead zones.

**Security in five layers.** Sign-in tokens checked for issuer and app → role and depot checks in the API → the same
checks again inside the database's workflow functions → a restricted database role that can't edit history → row-level
security, so each store, loader and driver sees only their own rows. Photos: owner checked, type read from the bytes,
never overwritten. 61 attacks, all refused. Details: [docs/security.md](docs/security.md).

## Every booklet rule, enforced in the database

A plan that breaks a rule can't be sent, and a manual move that breaks one is refused with the reason.

| Rule | ✓ |
|---|---|
| One brand and one district per trip; whole orders; at most two trips per vehicle | ✓ |
| Home depot only; weight **and** volume per trip | ✓ |
| Chilled only on refrigerated vehicles; van-only outlets only by vans | ✓ |
| Trip minutes = outbound + inter-stop × (orders − 1) + service allowance | ✓ |
| Fresh ≤ 270 min per vehicle from 03:30; Style + Tech ≤ 480 min | ✓ |
| Delivery and mall windows (an early vehicle waits) | ✓ |
| Weekly fuel quota, route distance including the return | ✓ |
| Workshop vehicles not used; orders close 16:00 the day before | ✓ |
| Every deferral carries a reason, and the store is told | ✓ |

## Tests

Run against the Docker database (`docker compose up` first); each script resets the demo data.

```bash
cd backend
ENVIRONMENT=development AUTH_DEV_BYPASS=true ALLOWED_HOSTS='["testserver"]' \
DATABASE_URL="postgresql://waypoint_api:waypoint-api-local@localhost:5433/waypoint?sslmode=disable" \
ADMIN_DATABASE_URL="postgresql://waypoint:waypoint@localhost:5433/waypoint?sslmode=disable" \
uv run python tests/security_audit.py
```

Each script's header gives its exact command. Never point them at a deployed database: they reset it.

| Suite | Checks | What it proves |
|---|---|---|
| `tests/rules_audit.py` | 118 | Recomputes every booklet rule from the CSVs; tries every illegal move through the API; checks whether any deferral was avoidable |
| `tests/day_scenario.py` | 118 | One complete day at both depots: orders, cutoff, plans, loading, failed / short / offline deliveries, receipts, end of day with fuel |
| `tests/security_audit.py` | 61 | Attacks every protection: database role, row-level security, attachments, tokens, sign-in throttle, cross-depot edits |
| `tests/walkthrough.py` | end to end | The four roles through the API, including offline sync, resends and corrections |
| `tests/optimality.py` | exact | MILP (HiGHS) asks whether any legal plan serves more: **proven** on the Kandy days |

Frontend: `cd frontend && pnpm lint && npx tsc --noEmit`.

## Deploy

| Part | Where |
|---|---|
| Database | Neon (PostgreSQL 18): `./db/load.sh "$NEON_DATABASE_URL"` once, then `--migrate` after schema changes |
| Photos | Neon object storage (S3 API) |
| API | Vercel, root directory `backend` (see the *Deployed* section of `backend/.env.example`) |
| Web | Vercel, root directory `frontend` (see `frontend/.env.example`) |
| Sign-in | Clerk organization with roles `dispatcher`, `loader`, `driver`, `store_manager` |

## Repository

```
backend/        FastAPI API, allocation engine, lateness and forecast models, local sign-in, tests
frontend/       Next.js app: /dispatcher, /loader, /driver, /store-manager
db/             schema, CSV import, migrations (001–010), demo seed, load.sh
data/general/   the seven competition CSVs (the only competition data in the repo)
docs/           architecture, data flow, security, engine changes, walkthroughs, screenshots
docker-compose.yml, .env.example
```

## Documentation

- [Architecture](docs/architecture.md) · [Data flow](docs/data-flow.md) · [Security](docs/security.md)
- [Allocation engine changes and benchmarks](docs/engine-changes.md)
- [A full delivery day, screen by screen](docs/walkthrough/waypoint-delivery-day.html) · [UI changes since the Designathon](docs/ui_update/ui_update.md)
- [AI disclosure](docs/ai-disclosure.md)

---

<div align="center">

Built by **Team AlphaZero** for the Tech-Triathlon 2026. Results are on the competition's synthetic data.

</div>
