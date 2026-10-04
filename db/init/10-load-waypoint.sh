#!/bin/sh
# Runs once, inside the postgres container, the first time its data volume is empty.
# docker-compose.yml mounts db/ at /waypoint-db and data/general/ at /waypoint-data.
set -e
PSQL="psql -v ON_ERROR_STOP=1 -q --username $POSTGRES_USER --dbname $POSTGRES_DB"

echo "Waypoint: creating schema"
$PSQL -f /waypoint-db/waypoint_schema.sql

echo "Waypoint: loading data/general CSV files"
cd /waypoint-data
$PSQL -f /waypoint-db/waypoint_import.sql

for f in /waypoint-db/migrations/*.sql; do
  echo "Waypoint: applying $(basename "$f")"
  $PSQL -f "$f"
done

echo "Waypoint: seeding the demo day"
$PSQL -tAc "SELECT wp.demo_reset();"
