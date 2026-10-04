"""Shared booklet checks for the API tests: every rule recomputed from data/general/*.csv, never
from the database, so a bug shared by the engine and the schema still shows up.

Used by rules_audit.py (rules, broken by hand) and day_scenario.py (a full delivery day)."""
import asyncio
import sys
import csv
import os
from collections import Counter, defaultdict
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path

import asyncpg

# Windows consoles default to cp1252; the reports use arrows and dots.
sys.stdout.reconfigure(encoding="utf-8")

DATA = Path(__file__).resolve().parents[2] / "data" / "general"
COLOMBO = timezone(timedelta(hours=5, minutes=30))
BRAND = {"Fresh": "F", "Style": "S", "Tech": "T"}
FRESH_BUDGET, DAY_BUDGET, FRESH_START = 270, 480, time(3, 30)
API = "/api/v1"
results: list[tuple[str, str, bool, str]] = []  # (part, check, passed, detail)


def check(part: str, name: str, passed: bool, detail: str = "") -> bool:
    results.append((part, name, passed, detail))
    print(f"  [{'PASS' if passed else 'FAIL'}] {name}" + (f" - {detail}" if detail else ""))
    return passed


def ok(r, code=200):
    assert r.status_code == code, f"{r.request.method} {r.request.url} -> {r.status_code} {r.text[:400]}"
    return r.json() if r.content else None


# ---------------------------------------------------------------- booklet data (CSV only) ----
def read(name):
    with open(DATA / name, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


OUTLETS = {r["outlet_id"]: r for r in read("outlets.csv")}
VEHICLES = {r["vehicle_id"]: r for r in read("vehicles.csv")}
TRAVEL = {r["district"]: r for r in read("district_travel.csv")}
ALLOWANCE = {(BRAND[r["brand"]], r["dock_type"]): int(r["service_allowance_min"]) for r in read("service_allowance.csv")}
CALENDAR = {r["date"]: r["is_operating"] == "1" for r in read("calendar.csv")}


def hm(s: str) -> time:
    return time.fromisoformat(s)


def local(ts: str) -> datetime:
    return datetime.fromisoformat(ts).astimezone(COLOMBO)


def window(outlet: dict) -> tuple[time, time] | None:
    """Requested delivery window; a mall outlet must also be inside the mall's access window."""
    opens, closes = hm(outlet["window_open_time"]), hm(outlet["window_close_time"])
    if outlet["mall_window"]:
        mo, mc = (hm(x) for x in outlet["mall_window"].split("-"))
        opens, closes = max(opens, mo), min(closes, mc)
    return opens, closes


def trip_minutes(brand: str, district: str, outlet_ids: list[str]) -> int:
    """Booklet Task 2B: outbound + inter-stop x (orders - 1) + handling per order (one entry per order)."""
    t = TRAVEL[district]
    return (int(t["depot_to_district_freeflow_min"]) + int(t["inter_stop_freeflow_min"]) * (len(outlet_ids) - 1)
            + sum(ALLOWANCE[(brand, OUTLETS[o]["dock_type"])] for o in outlet_ids))


def litres(district: str, n_orders: int, vehicle: dict) -> float:
    """Route distance (out, between stops, back) over km per litre. The booklet says only 'route distance'."""
    t = TRAVEL[district]
    return (2 * float(t["depot_to_district_km"]) + float(t["inter_stop_km"]) * (n_orders - 1)) / float(vehicle["km_per_l"])


def schedule(day: date, depart: datetime, district: str, brand: str, stops: list[list[str]]):
    """Arrival per stop when leaving at `depart` (early vehicles wait); None if a window is missed."""
    t = TRAVEL[district]
    out, inter = int(t["depot_to_district_freeflow_min"]), int(t["inter_stop_freeflow_min"])
    clock = depart + timedelta(minutes=out)
    arrivals = []
    for i, outlet_orders in enumerate(stops):
        if i:
            clock += timedelta(minutes=inter)
        opens, closes = window(OUTLETS[outlet_orders[0]])
        clock = max(clock, datetime.combine(day, opens, COLOMBO))
        if clock > datetime.combine(day, closes, COLOMBO):
            return None
        arrivals.append(clock)
        clock += timedelta(minutes=sum(ALLOWANCE[(brand, OUTLETS[o]["dock_type"])] for o in outlet_orders)
                           + inter * (len(outlet_orders) - 1))
    return arrivals, clock


# ------------------------------------------------------------------------------ the audit ----
def audit(part: str, plan: dict, orders_in_run: int, workshop: set[str]):
    day = date.fromisoformat(plan["plan"]["service_date"])
    depot = {1: "Peliyagoda", 2: "Kandy"}[plan["plan"]["depot_id"]]
    vcode = {v["vehicle_id"]: v["source_id"] for v in plan["vehicles"]}
    trips = []
    for r in plan["routes"]:
        stops = [{"outlet": s["outlet_code"], "arrival": local(s["planned_arrival"]),
                  "orders": s["orders"] or []} for s in sorted(r["stops"], key=lambda s: s["seq"])]
        trips.append({"veh": vcode[r["vehicle_id"]], "seq": r["route_seq"], "brand": r["brand_code"],
                      "district": r["district_name"], "depart": local(r["depart_at"]), "return": local(r["return_at"]),
                      "db_minutes": r["trip_minutes"], "stops": stops})
    fails = defaultdict(list)

    # Operating day
    iso = day.isoformat()
    working = CALENDAR.get(iso, day.isoweekday() != 7)
    check(part, "Service date is an operating day", working, f"{iso} ({day:%a}); calendar.csv ends 2026-06-28, after that Sundays are closed")

    served: Counter = Counter()
    for t in trips:
        name = f"{t['veh']} T{t['seq']}"
        veh = VEHICLES[t["veh"]]
        outlets = [OUTLETS[s["outlet"]] for s in t["stops"]]
        orders = [(s["outlet"], o) for s in t["stops"] for o in s["orders"]]
        for _, o in orders:
            served[o["order_id"]] += 1
        # 1 brand and district
        if {BRAND[o["brand"]] for o in outlets} != {t["brand"]} or {o["district"] for o in outlets} != {t["district"]}:
            fails["1 One brand + one district per trip"].append(name)
        # 2 refrigeration
        if any(o["temp"] != "ambient" for _, o in orders) and veh["temp"] != "reefer":
            fails["2 Chilled only on reefer vehicles"].append(name)
        # 3 van-only access
        if any(o["parking_constraint"] == "van_only" for o in outlets) and veh["type"] != "van":
            fails["3 Van-only outlets only by vans"].append(name)
        # 4 home depot
        if veh["depot"] != depot or any(o["depot"] != depot for o in outlets):
            fails["4 Home depot only"].append(name)
        # 6 capacity, weight AND volume
        kg, m3 = sum(float(o["kg"]) for _, o in orders), sum(float(o["m3"]) for _, o in orders)
        if kg > float(veh["weight_cap_kg"]) + 1e-6 or m3 > float(veh["volume_cap_m3"]) + 1e-6:
            fails["6 Capacity (weight and volume)"].append(f"{name} {kg:.0f}kg/{veh['weight_cap_kg']} {m3:.2f}m3/{veh['volume_cap_m3']}")
        # 7 trip time formula
        mins = trip_minutes(t["brand"], t["district"], [ou for ou, _ in orders])
        t["minutes"] = mins
        if mins != t["db_minutes"]:
            fails["7 Trip minutes = outbound + inter-stop x (orders-1) + handling"].append(f"{name} csv {mins} db {t['db_minutes']}")
        # Fresh operating window starts 03:30
        if t["brand"] == "F" and t["depart"].time() < FRESH_START:
            fails["7 Fresh trips depart at or after 03:30"].append(f"{name} {t['depart']:%H:%M}")
        # windows (requested + mall), early vehicles wait; recomputed from the departure
        sched = schedule(day, t["depart"], t["district"], t["brand"], [[s["outlet"]] * len(s["orders"]) for s in t["stops"]])
        if sched is None:
            fails["Delivery and mall windows (early vehicles wait)"].append(name)
        else:
            arrivals, end = sched
            t["end"] = end
            off = [s["outlet"] for s, a in zip(t["stops"], arrivals) if abs((s["arrival"] - a).total_seconds()) > 60]
            if off:
                fails["Planned arrivals match the recomputed schedule"].append(f"{name} {off}")
            if t["return"] < max(end, t["depart"] + timedelta(minutes=mins)):
                fails["Trip end covers travel, handling and waiting"].append(name)
        if t["veh"] in workshop:
            fails["Workshop vehicles not used"].append(name)

    # 5 whole orders, every order served once or deferred with a reason
    split = [o for o, n in served.items() if n > 1]
    if split:
        fails["5 Whole orders (one vehicle, one trip)"].append(str(split))
    deferred = {u["order_id"]: u for u in plan["unplanned"]}
    both = set(deferred) & set(served)
    no_reason = [u["confirmation_no"] for u in deferred.values() if not u["drafted_reason"]]
    reasons = {r["code"] for r in plan["reasons"]}
    bad_reason = [u["drafted_reason"] for u in deferred.values() if u["drafted_reason"] and u["drafted_reason"] not in reasons]
    accounted = len(served) + len(deferred) == orders_in_run and not both

    # 7 per vehicle: at most two trips, budgets, no overlap; fuel quota
    by_veh = defaultdict(list)
    for t in trips:
        by_veh[t["veh"]].append(t)
    for v, ts in by_veh.items():
        if len(ts) > 2:
            fails["7 At most two trips per vehicle"].append(v)
        fresh = sum(t["minutes"] for t in ts if t["brand"] == "F")
        day_min = sum(t["minutes"] for t in ts if t["brand"] != "F")
        if fresh > FRESH_BUDGET:
            fails["7 Fresh budget 270 min per vehicle"].append(f"{v} {fresh}")
        if day_min > DAY_BUDGET:
            fails["7 Style + Tech budget 480 min per vehicle"].append(f"{v} {day_min}")
        ts.sort(key=lambda t: t["depart"])
        if len(ts) == 2 and ts[1]["depart"] < ts[0].get("end", ts[0]["return"]):
            fails["A vehicle's trips do not overlap"].append(v)
        fuel = sum(litres(t["district"], sum(len(s["orders"]) for s in t["stops"]), VEHICLES[v]) for t in ts)
        if fuel > float(VEHICLES[v]["weekly_fuel_quota_l"]):
            fails["Weekly fuel quota"].append(f"{v} {fuel:.1f} L")

    names = ["1 One brand + one district per trip", "2 Chilled only on reefer vehicles", "3 Van-only outlets only by vans",
             "4 Home depot only", "5 Whole orders (one vehicle, one trip)", "6 Capacity (weight and volume)",
             "7 At most two trips per vehicle", "7 Trip minutes = outbound + inter-stop x (orders-1) + handling",
             "7 Fresh budget 270 min per vehicle", "7 Style + Tech budget 480 min per vehicle",
             "7 Fresh trips depart at or after 03:30", "Delivery and mall windows (early vehicles wait)",
             "Planned arrivals match the recomputed schedule", "Trip end covers travel, handling and waiting",
             "A vehicle's trips do not overlap", "Weekly fuel quota", "Workshop vehicles not used"]
    for n in names:
        check(part, n, not fails[n], ", ".join(fails[n][:6]) if fails[n] else f"{len(trips)} trips checked")
    check(part, "Every order served or deferred, never both", accounted,
          f"{len(served)} served + {len(deferred)} deferred = {orders_in_run} orders in the run")
    check(part, "Every deferral has a valid reason", not no_reason and not bad_reason,
          ", ".join(sorted({u['drafted_reason'] for u in deferred.values()} - {None})) or "no deferrals")
    check(part, "Database plan_violations() agrees: none", not plan["violations"],
          "; ".join(v["message"] for v in plan["violations"][:3]))
    used = len(by_veh)
    kg = sum(float(o["kg"]) for t in trips for s in t["stops"] for o in s["orders"])
    print(f"  summary: {len(trips)} trips on {used} vehicles, {len(served)} orders ({kg:,.0f} kg) served, "
          f"{len(deferred)} deferred: " + ", ".join(f"{u['outlet_code']} {u['temp']} {u['drafted_reason']}" for u in deferred.values()))
    return trips, by_veh, deferred


def avoidable(part: str, plan: dict, trips, by_veh, deferred, workshop: set[str]):
    """Could a deferred order have gone on any trip, or on a vehicle's free trip slot, without breaking a rule?"""
    day = date.fromisoformat(plan["plan"]["service_date"])
    depot = {1: "Peliyagoda", 2: "Kandy"}[plan["plan"]["depot_id"]]
    found = []
    for u in deferred.values():
        ou = OUTLETS[u["outlet_code"]]
        brand, district = BRAND[ou["brand"]], ou["district"]
        kg, m3 = float(u["weight_kg"]), float(u["volume_m3"])

        def fits(veh_id, others, fresh_used, day_used, fuel_used, earliest, latest_end):
            veh = VEHICLES[veh_id]
            if u["temp"] != "ambient" and veh["temp"] != "reefer":
                return False
            if ou["parking_constraint"] == "van_only" and veh["type"] != "van":
                return False
            all_orders = others + [(u["outlet_code"], kg, m3)]
            if sum(x[1] for x in all_orders) > float(veh["weight_cap_kg"]) or sum(x[2] for x in all_orders) > float(veh["volume_cap_m3"]):
                return False
            mins = trip_minutes(brand, district, [x[0] for x in all_orders])
            if (brand == "F" and fresh_used + mins > FRESH_BUDGET) or (brand != "F" and day_used + mins > DAY_BUDGET):
                return False
            if fuel_used + litres(district, len(all_orders), veh) > float(veh["weekly_fuel_quota_l"]):
                return False
            groups: dict[str, list[str]] = {}
            for o in sorted(all_orders, key=lambda x: window(OUTLETS[x[0]])[1]):
                groups.setdefault(o[0], []).append(o[0])
            stops = list(groups.values())
            first_open = window(OUTLETS[stops[0][0]])[0]
            depart = max(earliest, datetime.combine(day, first_open, COLOMBO)
                         - timedelta(minutes=int(TRAVEL[district]["depot_to_district_freeflow_min"])))
            sched = schedule(day, depart, district, brand, stops)
            return sched is not None and sched[1] <= latest_end

        for veh_id, veh in VEHICLES.items():
            if veh["depot"] != depot or veh_id in workshop:
                continue
            ts = by_veh.get(veh_id, [])
            fresh_used = sum(t["minutes"] for t in ts if t["brand"] == "F")
            day_used = sum(t["minutes"] for t in ts if t["brand"] != "F")
            fuel_used = sum(litres(t["district"], sum(len(s["orders"]) for s in t["stops"]), veh) for t in ts)
            start = datetime.combine(day, FRESH_START if brand == "F" else time(0), COLOMBO)
            far = datetime.combine(day + timedelta(days=1), time(0), COLOMBO)
            # join one of this vehicle's trips (same brand and district)
            for t in ts:
                if t["brand"] != brand or t["district"] != district:
                    continue
                others = [(s["outlet"], float(o["kg"]), float(o["m3"])) for s in t["stops"] for o in s["orders"]]
                other_trips = [x for x in ts if x is not t]
                lo = max([start] + [x["end"] for x in other_trips if x["depart"] < t["depart"]])
                hi = min([far] + [x["depart"] for x in other_trips if x["depart"] > t["depart"]])
                if fits(veh_id, others, fresh_used - (t["minutes"] if brand == "F" else 0),
                        day_used - (t["minutes"] if brand != "F" else 0),
                        fuel_used - litres(t["district"], len(others), veh), lo, hi):
                    found.append(f"{u['outlet_code']} {u['temp']} -> {veh_id} T{t['seq']}")
                    break
            else:
                # a free trip slot, before or after the vehicle's other trip
                if len(ts) < 2:
                    slots = [(start, far)] if not ts else [(start, ts[0]["depart"]), (max(start, ts[0]["end"]), far)]
                    if any(fits(veh_id, [], fresh_used, day_used, fuel_used, lo, hi) for lo, hi in slots if lo < hi):
                        found.append(f"{u['outlet_code']} {u['temp']} -> {veh_id} new trip")
            if found and found[-1].startswith(u["outlet_code"] + " " + u["temp"]):
                break
    check(part, "No deferral was avoidable (single-order search over every trip and free vehicle slot)",
          not found, ", ".join(found) if found else f"{len(deferred)} deferral(s) confirmed unavoidable")


# ---------------------------------------------------------------- direct database helper ----
def db_url() -> str:
    url = os.environ["DATABASE_URL"]
    return url.split("?")[0].replace("postgresql+asyncpg://", "postgresql://")


def sql(query: str, *args):
    async def run():
        conn = await asyncpg.connect(db_url())
        try:
            async with conn.transaction():
                return await conn.fetch(query, *args)
        finally:
            await conn.close()
    return asyncio.run(run())
