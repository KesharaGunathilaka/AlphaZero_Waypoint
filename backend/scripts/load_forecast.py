"""Load our Datathon Task 2A forecast into wp.demand_forecast, for the dispatcher's Capacity screen.

The forecast is derived from the competition data, so it is not kept in this repository: point the script at
the files on your machine. Run it once per database (it replaces what was loaded before):

    cd backend
    uv run python scripts/load_forecast.py \
        --db postgresql://waypoint:waypoint@localhost:5433/waypoint \
        --submission ../../AlphaZero_Datathon/submissions/submission_task2a.csv \
        --inputs "../../Datathon/data/Test Data/task2a_test_inputs.csv"

--db must be the owner (the API's restricted role may only read the table).
"""
import argparse
import asyncio
import csv
from datetime import date

import asyncpg

BRANDS = {"Fresh": "F", "Style": "S", "Tech": "T"}


async def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--db", required=True, help="owner connection string")
    ap.add_argument("--submission", required=True, help="submission_task2a.csv (row_id, pred_total_volume_m3, pred_chilled_volume_m3)")
    ap.add_argument("--inputs", required=True, help="task2a_test_inputs.csv (row_id, depot, brand, iso_year, iso_week)")
    ap.add_argument("--source", default="Datathon Task 2A forecast (Team AlphaZero)")
    args = ap.parse_args()

    with open(args.inputs, newline="", encoding="utf-8") as f:
        keys = {r["row_id"]: r for r in csv.DictReader(f)}
    with open(args.submission, newline="", encoding="utf-8") as f:
        preds = list(csv.DictReader(f))
    missing = [p["row_id"] for p in preds if p["row_id"] not in keys]
    if missing:
        raise SystemExit(f"{len(missing)} forecast rows have no matching input row, e.g. {missing[:3]}")

    conn = await asyncpg.connect(args.db.split("?")[0])
    try:
        depots = {r["name"]: r["depot_id"] for r in await conn.fetch("SELECT depot_id, name FROM wp.depot")}
        brands = {r["code"]: r["brand_id"] for r in await conn.fetch("SELECT brand_id, code FROM wp.brand")}
        rows = []
        for p in preds:
            k = keys[p["row_id"]]
            year, week = int(k["iso_year"]), int(k["iso_week"])
            rows.append((depots[k["depot"]], brands[BRANDS[k["brand"]]], year, week, date.fromisocalendar(year, week, 1),
                         round(float(p["pred_total_volume_m3"]), 1), round(float(p["pred_chilled_volume_m3"]), 1), args.source))
        async with conn.transaction():
            await conn.execute("DELETE FROM wp.demand_forecast")
            await conn.executemany("""
                INSERT INTO wp.demand_forecast(depot_id, brand_id, iso_year, iso_week, week_start, total_m3, chilled_m3, source)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)""", rows)
    finally:
        await conn.close()
    weeks = sorted({(r[2], r[3]) for r in rows})
    print(f"Loaded {len(rows)} forecast rows: {len(weeks)} weeks, {weeks[0][0]} W{weeks[0][1]} to {weeks[-1][0]} W{weeks[-1][1]}.")


if __name__ == "__main__":
    asyncio.run(main())
