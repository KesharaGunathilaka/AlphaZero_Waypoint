# Waypoint API

FastAPI, Python 3.12, [uv](https://docs.astral.sh/uv/). Schema and rules live in the database
(`../db/`); this service is the HTTP layer, the allocation engine (`app/modules/dispatch/engine.py`)
and sign-in (local demo accounts or Clerk).

```bash
docker compose up db              # from the repository root: the database with demo data
cp .env.example .env              # local sign-in against that database
uv sync
uv run fastapi dev app/main.py    # http://localhost:8000/docs
```

| | |
|---|---|
| `app/main.py` | the app (`main.py` re-exports it for hosts that look for `main:app`) |
| `app/modules/` | `auth` (local sign-in), `dispatch`, `field` (loader, driver, sync, photos), `store` |
| `tests/` | `rules_audit.py`, `day_scenario.py`, `walkthrough.py`: run against a local database only (they reset it) |
| `.env.example` | running on your PC |
| `.env.production.example` | the Vercel project's variables ([deploy guide](../docs/deploy.md)) |
