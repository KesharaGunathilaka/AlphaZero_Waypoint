#!/bin/sh
# Create the schema and load data/general into any Postgres database (Neon, a local server, ...).
#
#   ./db/load.sh "$NEON_DATABASE_URL"            # empty database: schema + data
#   ./db/load.sh "$NEON_DATABASE_URL" --data     # schema already there: reload the CSVs only
#   ./db/load.sh "$NEON_DATABASE_URL" --reset    # drop schema wp (ALL app data) and start again
#
# Needs psql 16 or newer on PATH.
set -e

URL="$1"
MODE="${2:-full}"
if [ -z "$URL" ]; then
  echo "usage: $0 <database-url> [--data | --reset]" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [ "$MODE" = "--reset" ]; then
  echo "Dropping schema wp and everything in it"
  psql -v ON_ERROR_STOP=1 "$URL" -c "DROP SCHEMA IF EXISTS wp CASCADE;"
fi

if [ "$MODE" != "--data" ]; then
  echo "Creating schema"
  psql -v ON_ERROR_STOP=1 -q "$URL" -f "$ROOT/db/waypoint_schema.sql"
fi

echo "Loading data/general CSV files"
cd "$ROOT/data/general"
psql -v ON_ERROR_STOP=1 -q "$URL" -f "$ROOT/db/waypoint_import.sql"
