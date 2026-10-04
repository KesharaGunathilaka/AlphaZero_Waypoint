#!/bin/sh
# Runs once, inside the postgres container, the first time its data volume is empty.
# docker-compose.yml mounts db/ at /waypoint-db and data/general/ at /waypoint-data.
set -e

echo "Waypoint: creating schema"
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -f /waypoint-db/waypoint_schema.sql

echo "Waypoint: loading data/general CSV files"
cd /waypoint-data
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -f /waypoint-db/waypoint_import.sql
