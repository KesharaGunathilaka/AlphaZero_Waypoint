# Deploy guide

Two ways to run Waypoint, from the same `main` branch:

| | Docker delivery (judges, local) | Deployed app |
|---|---|---|
| Start | `docker compose up` at the repository root | Vercel builds `main` on every push |
| Address | http://localhost:3000 | Web: `https://alpha-zero-waypoint.vercel.app` · API: https://alphazero-waypoint-api-pink.vercel.app |
| Database | PostgreSQL 18 container, loaded on first start | Neon, AWS Asia Pacific (Singapore) |
| Sign-in | Local: demo accounts, password `waypoint-demo` | Clerk (Development instance), same demo e-mails, Clerk password |
| Photos and signatures | Stored in the database | Stored in the database (Neon), `STORAGE_BACKEND=db` |
| Demo controls (*Reset demo*, *Simulate no signal*) | Shown | Hidden; the API refuses the reset (reset with `db/load.sh --demo`) |
| Settings | `.env.example` (optional) | Vercel environment variables (section 2.3, 2.4) |

Everything in the deployed app runs on free plans: Neon Free, Vercel Hobby (two projects), Clerk
Development instance.

## Env files: three in git, real values in Vercel

| File (in git) | What it lists | Used by |
|---|---|---|
| `.env.example` (root) | Docker Compose ports, database user, local sign-in | `docker compose up`. Optional: the same values are the defaults |
| `backend/.env.example` | Every API setting: a *Local* section and a *Deployed* section | Local: copy to `backend/.env`. Deployed: see section 2.3 |
| `frontend/.env.example` | Every web setting: a *Local* section and a *Deployed* section | Local: copy to `frontend/.env.local`. Deployed: see section 2.4 |

Only these three are committed; they hold no secrets. Every file with real values (`.env`,
`backend/.env`, `frontend/.env.local`, …) is git-ignored and stays on your PC.

**Sharing with the team.** The real deployed values live in one place: the **Environment Variables of
the two Vercel projects**. Invite teammates to the Vercel team instead of sending files; anyone with
access can read them there or pull them with `vercel env pull`. For a backup or a handover, keep them
in a password manager (Bitwarden, 1Password), never in git, chat or e-mail. What each place needs:

| Secret | Vercel API project | Vercel web project | Comes from |
|---|---|---|---|
| `DATABASE_URL` (pooled) | ✓ | | Neon → Connect (host contains `-pooler`) |
| `CLERK_SECRET_KEY` | ✓ | ✓ | Clerk → API keys |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | | ✓ | Clerk → API keys |
| `CLERK_JWKS_URL`, `CLERK_ISSUER` | ✓ | | Clerk → API keys (Frontend API URL) |
| `URL_SIGNING_SECRET` | ✓ | | Generated: `python -c "import secrets; print(secrets.token_hex(32))"` |
| Neon **direct** connection string | | | Only for `db/load.sh` (migrations, demo reset) |

Docker needs no secrets at all: judges and teammates run `docker compose up` with nothing to share.

## 1. Docker delivery 

```bash
git clone <repo> && cd AlphaZero_Waypoint
docker compose up --build
```

Open http://localhost:3000. The first start creates schema `wp`, loads the seven CSVs from
`data/general/`, applies `db/migrations/*.sql` and seeds a demo delivery day (about a minute). No
`.env` is needed; `cp .env.example .env` only to change ports or passwords. Start from nothing again:
`docker compose down -v && docker compose up --build`.

Checked from a clean copy of the repository (no `.env`, no `node_modules`, no `.venv`): all three
services healthy, 120 outlets, 60 vehicles, 70 Kandy + 114 Peliyagoda demo orders, 11 demo accounts on
the sign-in page, and a plan built and sent (67 of 70 orders, 3 deferrals with reasons).

## 2. Deployed app

The two Vercel projects are imported from the GitHub repository
[`tharUmesh/AlphaZero_Waypoint`](https://github.com/tharUmesh/AlphaZero_Waypoint), branch `main`.
Every push to that branch redeploys both projects. Changes made in
`KesharaGunathilaka/AlphaZero_Waypoint` reach the deployed app only after they are synced into that
repository (GitHub → *Sync fork*, or a pull request).

### 2.1 Neon (database)

Project region: **AWS Asia Pacific (Singapore)**, the closest to Sri Lanka. Neon → **Connect** gives two
connection strings: the **direct** one (no `-pooler` in the host) for `load.sh`, and the **pooled** one
(`-pooler` in the host) for the API. The Neon CLI setup prompt shown when the project is created
(`neon link`, `neon.ts`, `neon deploy`) is not needed.

The database is loaded with `db/load.sh` (needs `psql` 16+, or Docker as below):

```bash
./db/load.sh "$NEON_DIRECT_URL"            # new, empty database: schema + CSVs + migrations + demo day
./db/load.sh "$NEON_DIRECT_URL" --migrate  # later: apply db/migrations only (safe to repeat)
./db/load.sh "$NEON_DIRECT_URL" --demo     # wipe orders/plans/deliveries, seed a fresh demo day
```

Without `psql`, run the same commands through Docker. Keep the URL in quotes (it contains `?` and `&`):

```bash
# macOS / Linux
docker run --rm -v "$PWD":/w -w /w postgres:18-alpine sh db/load.sh "$NEON_DIRECT_URL" --demo
# Windows PowerShell
docker run --rm -v "${PWD}:/w" -w /w postgres:18-alpine sh db/load.sh "<direct URL>" --demo
```

Check in the Neon **SQL Editor**: `SELECT count(*) FROM wp.outlet;` → 120, `wp.vehicle` → 60.

The deployed dispatcher has no *Reset demo* button, so `--demo` is how to reset Neon before a
presentation (the demo day is the next open delivery day, so reset shortly before). Never run
`backend/tests/*` against Neon: they wipe the data.

Neon Free pauses the database after about 5 minutes without traffic; the first request afterwards is
slow and `/health` can answer 503 once. Open the app a minute before a presentation.

### 2.2 Clerk

Use the **Development** instance: it works on `*.vercel.app` domains (a Production instance needs a
domain of your own). The sign-in card shows a small *Development mode* label; that is expected.

1. **User & authentication**: sign-in with **e-mail address** and **password**.
2. **Protect → Rules → Device Trust → Manage**: toggle off **Enable**, **Save**. Device Trust asks for an
   e-mail code when a password sign-in comes from a new device; the `@example.com` demo addresses
   cannot receive it, so sign-in would stop at "Check your email".
3. **Configure → Organizations**: on (personal accounts off). Create one organization (*Waypoint*).
4. **Roles & Permissions**: add the roles `dispatcher`, `loader`, `driver`, `store_manager` (Clerk shows
   them as `org:dispatcher`, …; the web app expects exactly these keys).
5. **Users → Create user**: each user with the same e-mail as a Waypoint account and a password, then
   add them to the organization with the matching role:

   | E-mail | Clerk role | Waypoint account |
   |---|---|---|
   | `dispatcher@example.com` | `dispatcher` | both depots |
   | `loader.kandy@example.com` | `loader` | Kandy depot |
   | `driver.veh057@example.com` | `driver` | VEH057 |
   | `driver.veh059@example.com`, `driver.veh060@example.com` | `driver` | VEH059, VEH060 |
   | `store.out077@example.com`, `store.out078@example.com` | `store_manager` | OUT077, OUT078 |

   The **web app** chooses the screen from the Clerk role; the **API** checks the Waypoint account's
   role and depot/vehicle/outlet from the database. Both must agree. On a user's first sign-in the API
   links the Clerk user to the Waypoint account with the same e-mail (it needs `CLERK_SECRET_KEY`).
   More accounts (other stores, the Peliyagoda loader) exist in the database; add them in Clerk the
   same way when needed.
6. **API keys**: the publishable key (`pk_test_…`) and secret key (`sk_test_…`); the **Frontend API
   URL** (`https://<instance>.clerk.accounts.dev`) gives `CLERK_ISSUER` and, with
   `/.well-known/jwks.json` appended, `CLERK_JWKS_URL`.

### 2.3 Vercel: API project

Vercel → **Add New → Project** → the repository. Vercel detects both apps and offers a multi-service
project (*Services*); do **not** use it. Choose **Import single project** on the **backend** row.

| Setting | Value |
|---|---|
| Project name | `alphazero-waypoint-api` → https://alphazero-waypoint-api-pink.vercel.app |
| Root Directory | `backend` |
| Framework Preset | FastAPI (detected; entrypoint `main.py` → `app.main:app`) |
| Production Branch (Settings → Git) | `main` |
| Function Region (Settings → Functions) | Singapore (`sin1`), next to Neon; redeploy after changing it |

Environment variables. Vercel accepts the whole list at once: paste it into the first **Key** field
and it creates one row per line.

```dotenv
ENVIRONMENT=production
DATABASE_URL=<Neon pooled connection string>
AUTH_MODE=clerk
CLERK_SECRET_KEY=sk_test_...
CLERK_ISSUER=https://<instance>.clerk.accounts.dev
CLERK_JWKS_URL=https://<instance>.clerk.accounts.dev/.well-known/jwks.json
CLERK_AUTHORIZED_PARTIES=["https://alpha-zero-waypoint.vercel.app/"]
CORS_ORIGINS=["https://alpha-zero-waypoint.vercel.app"]
ALLOWED_HOSTS=["alphazero-waypoint-api-pink.vercel.app"]
PUBLIC_API_URL=https://alphazero-waypoint-api-pink.vercel.app
STORAGE_BACKEND=db
URL_SIGNING_SECRET=<64 random hex characters>
RATE_LIMIT_DEFAULT=1000/minute
```

- `CORS_ORIGINS` and `CLERK_AUTHORIZED_PARTIES` = the web app's address; `ALLOWED_HOSTS` and
  `PUBLIC_API_URL` = the API's own domain. No trailing slash. Preview deployments have other domains:
  add them too if you use previews.
- `STORAGE_BACKEND=db` keeps photos and signatures in Neon (no object storage needed). To use S3
  instead, see the S3 block in `backend/.env.example`.
- `URL_SIGNING_SECRET` must be set: without it each serverless instance makes its own random key and
  photo links break between instances.
- `RATE_LIMIT_DEFAULT` is raised from 100/minute because several users behind the same proxy share
  one limit.

The API refuses to start in production if `CLERK_AUTHORIZED_PARTIES`, `CORS_ORIGINS` or
`ALLOWED_HOSTS` is missing, so a configuration mistake shows as a failed deployment, not a silent hole.
Changed variables take effect only after **Deployments → ⋯ → Redeploy**.

### 2.4 Vercel: web project

Import the same repository again and choose **Import single project** on the **frontend** row. Vercel
offers a **Clerk integration** under *Optional Integrations*: skip it (**Cancel**). It would create a
new, empty Clerk application or add its own Clerk variables; the keys below already point at the
configured instance.

| Setting | Value |
|---|---|
| Root Directory | `frontend` |
| Framework Preset | Next.js (pnpm, from `pnpm-lock.yaml`) |
| Production Branch (Settings → Git) | `main` |
| Function Region (Settings → Functions) | Singapore (`sin1`) |

```dotenv
NEXT_PUBLIC_API_URL=https://alphazero-waypoint-api-pink.vercel.app
NEXT_PUBLIC_AUTH_MODE=clerk
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL=/
NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL=/
```

`NEXT_PUBLIC_*` values are built into the pages: after changing one, **redeploy**. If the web project's
domain changes, update `CORS_ORIGINS` and `CLERK_AUTHORIZED_PARTIES` in the API project and redeploy it.

### 2.5 After each deployment

1. `https://alphazero-waypoint-api-pink.vercel.app/health` → `{"status":"ok"}` (the API reaches Neon).
   `/docs` is off in production.
2. Open the web app → Clerk sign-in → sign in as `dispatcher@example.com` → the dispatcher screen, with
   no *Reset demo* button.
3. Sign in as the store manager, loader and driver: each lands on their own app with data.

| Symptom | Cause |
|---|---|
| Sign-in stops at "Check your email" ("signing in from a new device") | Clerk Device Trust is on: turn it off (section 2.2, step 2) |
| `Invalid token: RS256 requires 'cryptography'` | API built from an old commit: redeploy `main` (needs `pyjwt[crypto]`) |
| "This sign-in has no Waypoint account" | No Waypoint account with that e-mail, `CLERK_SECRET_KEY` missing on the API, or a personal Clerk account was used instead of a demo e-mail |
| "No Waypoint account" after a Clerk user was deleted and created again | The account is still linked to the old Clerk user: in the Neon SQL Editor, `UPDATE wp.app_user SET clerk_user_id = NULL WHERE email = '<e-mail>';` |
| Lands on "Choose depot" | The Clerk user is not in the organization |
| "You don't have permission" | The Clerk organization role is not one of the four roles |
| Browser shows a CORS error | `CORS_ORIGINS` on the API is not exactly the web app's address (no trailing slash) |
| API answers 400 "Invalid host header" | `ALLOWED_HOSTS` does not contain the API's domain |
| `/health` returns 503 | `DATABASE_URL` wrong or not the pooled Neon string, or Neon was paused (refresh) |
| Photos or signatures do not load | `URL_SIGNING_SECRET` missing on the API |
| API answers 429 | `RATE_LIMIT_DEFAULT` too low |
| Web build fails with a pnpm version error | Add `ENABLE_EXPERIMENTAL_COREPACK=1` to the web project and redeploy |