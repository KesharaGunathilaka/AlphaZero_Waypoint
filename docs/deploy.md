# Deploy guide

Two ways to run Waypoint, from the same `main` branch:

| | Docker delivery (judges, local) | Deployed app |
|---|---|---|
| Start | `docker compose up` at the repository root | Vercel builds `main` on every push |
| Database | PostgreSQL 18 container, loaded on first start | Neon (PostgreSQL 18) |
| Sign-in | Local: demo accounts, password `waypoint-demo` | Clerk |
| Photos | Stored in the database | Neon object storage (S3 API) |
| Demo controls (*Reset demo*, *Simulate no signal*) | Shown | Hidden; the API refuses the reset |
| Settings | `.env.example` (optional) | Vercel environment variables (listed in `backend/.env.example`, `frontend/.env.example`) |

## Env files: three in git, real values in Vercel

| File (in git) | What it lists | Used by |
|---|---|---|
| `.env.example` (root) | Docker Compose ports, database user, local sign-in | `docker compose up`. Optional: the same values are the defaults |
| `backend/.env.example` | Every API setting: a *Local* section and a *Deployed* section | Local: copy to `backend/.env`. Deployed: the variables of the Vercel API project |
| `frontend/.env.example` | Every web setting: a *Local* section and a *Deployed* section | Local: copy to `frontend/.env.local`. Deployed: the variables of the Vercel web project |

Only these three are committed; they hold no secrets. Every file with real values (`.env`,
`backend/.env`, `frontend/.env.local`, …) is git-ignored and stays on your PC.

**Sharing with the team.** The real deployed values live in one place: the **Environment Variables of
the two Vercel projects**. Invite teammates to the Vercel team instead of sending files; anyone with
access can read them there or pull them with `vercel env pull`. For a backup or a handover, keep them
in a password manager (Bitwarden, 1Password), never in git, chat or e-mail. What each place needs:

| Secret | Vercel API project | Vercel web project | Comes from |
|---|---|---|---|
| `DATABASE_URL` (pooled) | ✓ | | Neon → Connect |
| `CLERK_SECRET_KEY` | ✓ | ✓ | Clerk → API keys |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | | ✓ | Clerk → API keys |
| `CLERK_JWKS_URL`, `CLERK_ISSUER` | ✓ | | Clerk → API keys (Frontend API URL) |
| `AWS_ENDPOINT_URL_S3`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | ✓ | | Neon → object storage |
| Neon **direct** connection string | | | only for `db/load.sh` (migrations, demo reset) |

Docker needs no secrets at all: judges and teammates run `docker compose up` with nothing to share.

## 1. Docker delivery (what judges run)

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

### 2.1 Merge into `main`

`frontend_v2` contains all of `main`, so the merge is a fast-forward (no conflicts):

```bash
git checkout main
git pull
git merge --ff-only frontend_v2
git push origin main
```

Or open a pull request `frontend_v2 → main` on GitHub and merge it.

### 2.2 Neon (database and photo storage)

The Neon database already has the schema, the CSVs and migrations 001–005. Only for a **new, empty**
Neon database (needs `psql` 16+; with Docker instead, see the last line):

```bash
./db/load.sh "$NEON_DATABASE_URL"            # schema + CSVs + migrations + demo day
./db/load.sh "$NEON_DATABASE_URL" --migrate  # later: apply db/migrations only (safe to repeat)
./db/load.sh "$NEON_DATABASE_URL" --demo     # wipe orders/plans/deliveries, seed a fresh demo day
# Without psql: docker run --rm -v "$PWD":/w -w /w postgres:18-alpine sh db/load.sh "$NEON_DATABASE_URL" --demo
```

Use the **direct** connection string for `load.sh` and the **pooled** one (`-pooler` in the host) for
the API. The deployed dispatcher has no *Reset demo* button, so `--demo` is how to reset Neon before a
presentation. Never run `backend/tests/*` against Neon: they wipe the data.

Photos: Neon object storage, bucket `images`; its endpoint and keys go in the API project's variables.

### 2.3 Clerk

1. **Configure → Organizations**: on. Create one organization (e.g. *Waypoint*).
2. **Roles & Permissions**: add the roles `dispatcher`, `loader`, `driver`, `store_manager` (Clerk shows
   them as `org:dispatcher`, …; the web app expects exactly these keys).
3. **Users**: create each user with the same e-mail as a Waypoint account, and add them to the
   organization with the matching role:

   | E-mail | Clerk role | Waypoint account |
   |---|---|---|
   | `dispatcher@example.com` | `dispatcher` | both depots |
   | `loader.kandy@example.com` | `loader` | Kandy depot |
   | `driver.veh057@example.com` | `driver` | VEH057 |
   | `store.out077@example.com`, `store.out078@example.com` | `store_manager` | OUT077, OUT078 |

   The **web app** chooses the screen from the Clerk role; the **API** checks the Waypoint account's
   role and depot/vehicle/outlet from the database. Both must agree. On a user's first sign-in the API
   links the Clerk user to the Waypoint account with the same e-mail (it needs `CLERK_SECRET_KEY`).
   More accounts (other drivers, stores, the Peliyagoda loader) exist in the database; add them in
   Clerk the same way when needed.
4. **API keys**: the publishable key (`pk_…`) and secret key (`sk_…`); the **Frontend API URL** gives
   `CLERK_ISSUER` and, with `/.well-known/jwks.json` appended, `CLERK_JWKS_URL`.

### 2.4 Vercel: API project

| Setting | Value |
|---|---|
| Root Directory | `backend` |
| Framework Preset | FastAPI (detected; entrypoint `main.py` → `app.main:app`) |
| Production Branch (Settings → Git) | `main` |
| Environment Variables | the *Deployed* section of `backend/.env.example`, with real values |

Values that must match the other project: `CORS_ORIGINS` and `CLERK_AUTHORIZED_PARTIES` = the web
app's address; `ALLOWED_HOSTS` and `PUBLIC_API_URL` = the API's own domain. Preview deployments have
other domains: add them to `ALLOWED_HOSTS` / `CORS_ORIGINS` if you use previews.

The API refuses to start in production if `CLERK_AUTHORIZED_PARTIES`, `CORS_ORIGINS` or
`ALLOWED_HOSTS` is missing, so a configuration mistake shows as a failed deployment, not a silent hole.

### 2.5 Vercel: web project

| Setting | Value |
|---|---|
| Root Directory | `frontend` |
| Framework Preset | Next.js (pnpm, from `pnpm-lock.yaml`) |
| Production Branch (Settings → Git) | `main` |
| Environment Variables | the *Deployed* section of `frontend/.env.example`, with real values |

`NEXT_PUBLIC_*` values are built into the pages: after changing one, **redeploy**.

### 2.6 After each deployment

1. `https://<api-domain>/health` → `{"status":"ok"}` (the API reaches Neon). `/docs` is off in production.
2. Open the web app → Clerk sign-in → sign in as `dispatcher@example.com` → the dispatcher screen, with
   no *Reset demo* button.
3. Sign in as the store manager, loader and driver: each lands on their own app with data.

| Symptom | Cause |
|---|---|
| `Invalid token: RS256 requires 'cryptography'` | API built from an old commit: redeploy `main` (needs `pyjwt[crypto]`) |
| "This sign-in has no Waypoint account" | No Waypoint account with that e-mail, or `CLERK_SECRET_KEY` missing on the API |
| Lands on "Choose depot" | The Clerk user is not in the organization |
| "You don't have permission" | The Clerk organization role is not one of the four roles |
| Browser shows a CORS error | `CORS_ORIGINS` on the API is not exactly the web app's address (no trailing slash) |
| API answers 400 "Invalid host header" | `ALLOWED_HOSTS` does not contain the API's domain |
| `/health` returns 503 | `DATABASE_URL` wrong, or not the pooled Neon string |
