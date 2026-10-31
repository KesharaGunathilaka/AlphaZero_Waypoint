#!/bin/sh
# Create the schema and load data/general into any Postgres database (Neon, a local server, ...).
#
#   ./db/load.sh "$NEON_DATABASE_URL"             # empty database: schema + CSVs + migrations + demo day
#   ./db/load.sh "$NEON_DATABASE_URL" --migrate   # existing database: apply db/migrations only
#   ./db/load.sh "$NEON_DATABASE_URL" --demo      # wipe orders/plans/deliveries and seed a fresh demo day
#   ./db/load.sh "$NEON_DATABASE_URL" --data      # reload the CSVs only
#   ./db/load.sh "$NEON_DATABASE_URL" --reset     # drop schema wp (ALL app data) and rebuild everything
#   WAYPOINT_API_PASSWORD=... ./db/load.sh "$NEON_DATABASE_URL" --api-role
#                                                  # create the API's restricted login (waypoint_api); then point the
#                                                  # API's DATABASE_URL at it instead of the owner
#
# Needs psql 16 or newer on PATH.
set -e

URL="$1"
MODE="${2:-full}"
if [ -z "$URL" ]; then
  echo "usage: $0 <database-url> [--migrate | --demo | --data | --reset | --api-role]" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PSQL="psql -v ON_ERROR_STOP=1 -q"

schema()     { echo "Creating schema";  $PSQL "$URL" -f "$ROOT/db/waypoint_schema.sql"; }
csvs()       { echo "Loading data/general CSV files"; (cd "$ROOT/data/general" && $PSQL "$URL" -f "$ROOT/db/waypoint_import.sql"); }
migrations() { for f in "$ROOT"/db/migrations/*.sql; do echo "Applying $(basename "$f")"; $PSQL "$URL" -f "$f"; done; }
demo()       { echo "Seeding the demo day"; $PSQL "$URL" -tAc "SELECT wp.demo_reset();"; }
api_role() {
  if [ -z "$WAYPOINT_API_PASSWORD" ]; then echo "set WAYPOINT_API_PASSWORD" >&2; exit 2; fi
  echo "Creating the API login role ${WAYPOINT_API_USER:-waypoint_api}"
  $PSQL "$URL" -v api_user="${WAYPOINT_API_USER:-waypoint_api}" -v api_pw="$WAYPOINT_API_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L IN ROLE waypoint_app', :'api_user', :'api_pw')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'api_user') \gexec
SQL
}

case "$MODE" in
  --reset)   $PSQL "$URL" -c "DROP SCHEMA IF EXISTS wp CASCADE;"; schema; csvs; migrations; demo ;;
  --migrate) migrations ;;
  --demo)    demo ;;
  --data)    csvs ;;
  --api-role) api_role ;;
  full)      schema; csvs; migrations; demo ;;
  *)         echo "unknown mode $MODE" >&2; exit 2 ;;
esac
