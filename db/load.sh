#!/bin/sh
# Create the schema and load data/general into any Postgres database (Neon, a local server, ...).
#
#   ./db/load.sh "$NEON_DATABASE_URL"             # empty database: schema + CSVs + migrations + demo day
#   ./db/load.sh "$NEON_DATABASE_URL" --migrate   # existing database: apply db/migrations only
#   ./db/load.sh "$NEON_DATABASE_URL" --demo      # wipe orders/plans/deliveries and seed a fresh demo day
#   ./db/load.sh "$NEON_DATABASE_URL" --data      # reload the CSVs only
#   ./db/load.sh "$NEON_DATABASE_URL" --reset     # drop schema wp (ALL app data) and rebuild everything
#
# Needs psql 16 or newer on PATH.
set -e

URL="$1"
MODE="${2:-full}"
if [ -z "$URL" ]; then
  echo "usage: $0 <database-url> [--migrate | --demo | --data | --reset]" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PSQL="psql -v ON_ERROR_STOP=1 -q"

schema()     { echo "Creating schema";  $PSQL "$URL" -f "$ROOT/db/waypoint_schema.sql"; }
csvs()       { echo "Loading data/general CSV files"; (cd "$ROOT/data/general" && $PSQL "$URL" -f "$ROOT/db/waypoint_import.sql"); }
migrations() { for f in "$ROOT"/db/migrations/*.sql; do echo "Applying $(basename "$f")"; $PSQL "$URL" -f "$f"; done; }
demo()       { echo "Seeding the demo day"; $PSQL "$URL" -tAc "SELECT wp.demo_reset();"; }

case "$MODE" in
  --reset)   $PSQL "$URL" -c "DROP SCHEMA IF EXISTS wp CASCADE;"; schema; csvs; migrations; demo ;;
  --migrate) migrations ;;
  --demo)    demo ;;
  --data)    csvs ;;
  full)      schema; csvs; migrations; demo ;;
  *)         echo "unknown mode $MODE" >&2; exit 2 ;;
esac
