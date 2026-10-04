"""Rules audit: every Challenge Booklet constraint, checked end to end through the API.

The engine plans, the database validates, and this script checks the result a third time on its own:
it recomputes every rule straight from data/general/*.csv (not from the database's functions), so a
bug shared by the engine and the schema still shows up here.

  Part A  Kandy demo day: engine plan audited rule by rule, plus a "was any deferral avoidable?" search.
  Part B  Peliyagoda peak day (every outlet orders, two refrigerated vehicles in the workshop): same audit.
  Part C  Breaking the rules by hand (manual moves, departures, deferrals): each one must be refused.
  Part D  Cutoff and operating days, release, deferral record + store notice, deferred orders first next run.

It wipes all app data (demo reset) and adds a test dispatcher for Peliyagoda
(dispatcher.peliyagoda@waypoint.test). Run it against a throwaway or local database, never the deployed one:

    ENVIRONMENT=development AUTH_DEV_BYPASS=true ALLOWED_HOSTS='["testserver"]' \
    DATABASE_URL=postgresql://waypoint:waypoint@localhost:5433/waypoint?sslmode=disable \
    uv run python tests/rules_audit.py
"""
import asyncio
import csv
import os
import random
import sys
import uuid
from collections import Counter, defaultdict
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path

import asyncpg
from fastapi.testclient import TestClient

from app.main import app

DATA = Path(__file__).resolve().parents[2] / "data" / "general"
COLOMBO = timezone(timedelta(hours=5, minutes=30))
BRAND = {"Fresh": "F", "Style": "S", "Tech": "T"}
FRESH_BUDGET, DAY_BUDGET, FRESH_START = 270, 480, time(3, 30)
API = "/api/v1"
KANDY_DSP = {"X-Dev-User": "dispatcher@example.com"}
PEL_DSP = {"X-Dev-User": "dispatcher.peliyagoda@waypoint.test"}

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


def seed_peliyagoda_peak() -> tuple[int, str]:
    """Every Peliyagoda outlet orders (Fresh dry + chilled, Style, Tech), heavy volumes, for the open
    delivery day after the one demo_reset() seeds. Returns (orders, service date)."""
    sql("""INSERT INTO wp.app_user(role, name, email, depot_id) VALUES ('dispatcher', 'Peliyagoda Test', $1, 1)
           ON CONFLICT (email) DO UPDATE SET active = true""", PEL_DSP["X-Dev-User"])
    rng = random.Random(2026)
    plan = []
    for code, o in OUTLETS.items():
        if o["depot"] != "Peliyagoda":
            continue
        b = BRAND[o["brand"]]
        for temp in (["ambient", "chilled"] if b == "F" else ["ambient"]):
            kg = {"F": rng.randint(200, 650), "S": rng.randint(300, 1400), "T": rng.randint(300, 2200)}[b]
            plan.append((code, temp, kg, round(kg / {"F": 170, "S": 100, "T": 175}[b], 2)))
    sql("""
        DO $$ DECLARE x record; uid integer; d date; lines jsonb;
        BEGIN
          SELECT user_id INTO uid FROM wp.app_user WHERE email = 'dispatcher.peliyagoda@waypoint.test';
          PERFORM set_config('wp.user_id', uid::text, true);
          d := wp.next_open_service_date(1::smallint);
          d := wp.next_delivery_date((SELECT min(outlet_id) FROM wp.outlet WHERE depot_id = 1), 'ambient', d + 1, now(), true);
          FOR x IN SELECT * FROM jsonb_to_recordset('""" + str([
              {"code": c, "temp": t, "kg": k, "m3": m} for c, t, k, m in plan]).replace("'", '"') + """'::jsonb)
                   AS j(code text, temp text, kg numeric, m3 numeric) LOOP
            SELECT jsonb_agg(jsonb_build_object('product_id', p.product_id, 'qty', 1)) INTO lines
            FROM (SELECT product_id FROM wp.product p JOIN wp.outlet ou ON ou.brand_id = p.brand_id
                  WHERE ou.code = x.code AND p.temp::text = x.temp AND p.active ORDER BY sku LIMIT 1) p;
            PERFORM wp.place_order(gen_random_uuid(), (SELECT outlet_id FROM wp.outlet WHERE code = x.code),
                                   x.temp::wp.temp_class, lines, uid, 'dispatcher', d, x.kg, x.m3);
          END LOOP;
        END $$""")
    day = sql("""SELECT wp.next_delivery_date((SELECT min(outlet_id) FROM wp.outlet WHERE depot_id = 1), 'ambient',
                                              wp.next_open_service_date(1::smallint) + 1, now(), true) AS d""")[0]["d"]
    return len(plan), day.isoformat()


# ---------------------------------------------------------------------------------- run ----
with TestClient(app) as c:
    # ---------------------------------------------------------------- Part A: Kandy demo day
    print("\nPART A - Kandy demo day (engine plan, independent audit)")
    ok(c.post(f"{API}/demo/reset", headers=KANDY_DSP))
    kday = ok(c.get(f"{API}/dispatch/runs", headers=KANDY_DSP))["next_open_date"]
    closed = ok(c.post(f"{API}/dispatch/runs/{kday}/close", headers=KANDY_DSP))
    kpid = closed["plan_id"]
    ok(c.post(f"{API}/dispatch/plans/{kpid}/propose", headers=KANDY_DSP))
    kplan = ok(c.get(f"{API}/dispatch/plans/{kpid}", headers=KANDY_DSP))
    workshop_k = {v["source_id"] for v in kplan["vehicles"] if not v["active"]}
    print(f"  {kday}: {closed['orders_confirmed']} orders, workshop: {sorted(workshop_k)}")
    ktrips, kveh, kdef = audit("A", kplan, closed["orders_confirmed"], workshop_k)
    avoidable("A", kplan, ktrips, kveh, kdef, workshop_k)
    van057 = sorted((t for t in ktrips if t["veh"] == "VEH057"), key=lambda t: t["seq"])
    check("A", "Day 5 worked example reproduced (VEH057 two Fresh chilled van trips, OUT078 deferred)",
          [[s["outlet"] for s in t["stops"]] for t in van057] == [["OUT077", "OUT083", "OUT079"], ["OUT076", "OUT082", "OUT081"]]
          and any(u["outlet_code"] == "OUT078" and u["temp"] == "chilled" for u in kdef.values()),
          " | ".join(f"T{t['seq']} {'>'.join(s['outlet'] for s in t['stops'])}" for t in van057))

    # ---------------------------------------------------------------- Part B: Peliyagoda peak
    print("\nPART B - Peliyagoda peak day (all outlets order, 2 reefers in the workshop)")
    n_orders, pday = seed_peliyagoda_peak()
    reefers = sql("""SELECT v.vehicle_id, v.source_id FROM wp.vehicle v JOIN wp.vehicle_class c USING (class_id)
                     WHERE v.depot_id = 1 AND c.carries_chilled ORDER BY c.is_van DESC, v.vehicle_id LIMIT 2""")
    for r in reefers:
        ok(c.patch(f"{API}/dispatch/vehicles/{r['vehicle_id']}", json={"active": False}, headers=PEL_DSP))
    workshop_p = {r["source_id"] for r in reefers}
    closed_p = ok(c.post(f"{API}/dispatch/runs/{pday}/close", headers=PEL_DSP))
    ppid = closed_p["plan_id"]
    ok(c.post(f"{API}/dispatch/plans/{ppid}/propose", headers=PEL_DSP))
    pplan = ok(c.get(f"{API}/dispatch/plans/{ppid}", headers=PEL_DSP))
    print(f"  {pday}: {closed_p['orders_confirmed']} orders (seeded {n_orders}), workshop: {sorted(workshop_p)}")
    ptrips, pveh, pdef = audit("B", pplan, closed_p["orders_confirmed"], workshop_p)
    avoidable("B", pplan, ptrips, pveh, pdef, workshop_p)
    check("B", "A dispatcher working on Kandy cannot open a Peliyagoda plan",
          c.get(f"{API}/dispatch/plans/{ppid}", headers=KANDY_DSP).status_code == 404)
    # Planning office: the dispatcher plans both depots by switching; single-depot accounts cannot switch.
    deps = ok(c.get(f"{API}/dispatch/depots", headers=KANDY_DSP))
    check("B", "Planning-office dispatcher can choose either depot", len(deps["depots"]) == 2, str([d["name"] for d in deps["depots"]]))
    ok(c.post(f"{API}/dispatch/depot", json={"depot_id": 1}, headers=KANDY_DSP))
    check("B", "After switching to Peliyagoda: its plan opens, Kandy's does not",
          c.get(f"{API}/dispatch/plans/{ppid}", headers=KANDY_DSP).status_code == 200
          and c.get(f"{API}/dispatch/plans/{kpid}", headers=KANDY_DSP).status_code == 404)
    ok(c.post(f"{API}/dispatch/depot", json={"depot_id": 2}, headers=KANDY_DSP))
    r = c.post(f"{API}/dispatch/depot", json={"depot_id": 2}, headers=PEL_DSP)
    check("B", "A single-depot dispatcher cannot switch depot", r.status_code == 403, f"{r.status_code}")
    r = c.post(f"{API}/dispatch/depot", json={"depot_id": 1}, headers={"X-Dev-User": "loader.kandy@example.com"})
    check("B", "A loader cannot switch depot", r.status_code == 403, f"{r.status_code}")

    # ---------------------------------------------------------------- Part C: breaking rules
    print("\nPART C - breaking the rules by hand (Kandy plan): each must be refused")
    vid = {v["source_id"]: v["vehicle_id"] for v in kplan["vehicles"]}
    used = {t["veh"] for t in ktrips}
    order_at = {(s["outlet"], o["temp"]): o["order_id"] for t in ktrips for s in t["stops"] for o in s["orders"]}
    order_at.update({(u["outlet_code"], u["temp"]): u["order_id"] for u in kdef.values()})
    idle_ambient_truck = next(v for v, d in VEHICLES.items() if d["depot"] == "Kandy" and d["type"] == "truck"
                              and d["temp"] == "ambient" and v not in used)
    idle_reefer_truck = next((v for v, d in VEHICLES.items() if d["depot"] == "Kandy" and d["type"] == "truck"
                              and d["temp"] == "reefer" and v not in used), None)
    normal_fresh_chilled = next(k for k in order_at if k[1] == "chilled" and OUTLETS[k[0]]["parking_constraint"] != "van_only")
    van_only_ambient = next(k for k in order_at if k[1] == "ambient" and OUTLETS[k[0]]["parking_constraint"] == "van_only")

    def refused(name, body, expect=(409,), word=""):
        r = c.post(f"{API}/dispatch/plans/{kpid}/move", json=body, headers=KANDY_DSP)
        text = r.text
        check("C", name, r.status_code in expect and word.lower() in text.lower(), f"{r.status_code} {text[:110]}")

    refused("Chilled order onto an ambient truck", {"order_id": order_at[normal_fresh_chilled],
            "vehicle_id": vid[idle_ambient_truck], "seq": 1}, word="chilled")
    if idle_reefer_truck:
        refused("Van-only outlet onto a truck", {"order_id": order_at[van_only_ambient],
                "vehicle_id": vid[idle_reefer_truck], "seq": 1}, word="van-only")
    style_trip = next(t for t in ktrips if t["brand"] == "S")
    refused("Fresh order onto a Style trip (one brand per trip)", {"order_id": order_at[normal_fresh_chilled],
            "vehicle_id": vid[style_trip["veh"]], "seq": style_trip["seq"]}, word="brand")
    fresh_k = next(k for k in order_at if OUTLETS[k[0]]["brand"] == "Fresh" and k[1] == "ambient")
    other_district = next((t for t in ktrips if t["brand"] == "F" and t["district"] != OUTLETS[fresh_k[0]]["district"]), None)
    if other_district:
        refused("Fresh order onto a Fresh trip to another district", {"order_id": order_at[fresh_k],
                "vehicle_id": vid[other_district["veh"]], "seq": other_district["seq"]}, word="district")
    r = c.post(f"{API}/dispatch/plans/{kpid}/move", json={"order_id": order_at[fresh_k], "vehicle_id": vid[style_trip["veh"]], "seq": 3},
               headers=KANDY_DSP)
    check("C", "Third trip for a vehicle", r.status_code == 422, f"{r.status_code} (seq must be 1 or 2)")
    out078 = order_at[("OUT078", "chilled")]
    refused("Over capacity: deferred OUT078 chilled onto full VEH057 trip 1", {"order_id": out078,
            "vehicle_id": vid["VEH057"], "seq": 1}, word="full")
    pel_vehicle = sql("SELECT vehicle_id FROM wp.vehicle WHERE depot_id = 1 ORDER BY vehicle_id LIMIT 1")[0]["vehicle_id"]
    refused("Kandy order onto a Peliyagoda vehicle (home depot)", {"order_id": order_at[fresh_k], "vehicle_id": pel_vehicle, "seq": 1},
            expect=(404, 409, 403), word="")

    # Workshop vehicle: the move is refused at once
    refused("Order onto VEH058 (in the workshop)", {"order_id": out078, "vehicle_id": vid["VEH058"], "seq": 1}, word="workshop")

    # Time budget: one truck's two Fresh trips to the district whose Fresh orders need the most minutes
    groups = defaultdict(list)
    kg_of = {o["order_id"]: float(o["kg"]) for t in ktrips for s in t["stops"] for o in s["orders"]}
    for k, oid in order_at.items():
        o = OUTLETS[k[0]]
        if o["brand"] == "Fresh" and k[1] == "ambient" and o["parking_constraint"] != "van_only" and oid in kg_of:
            groups[o["district"]].append((k[0], oid))
    district, big = max(groups.items(), key=lambda g: trip_minutes("F", g[0], [x[0] for x in g[1]]))
    truck = max((v for v, d in VEHICLES.items() if d["depot"] == "Kandy" and d["type"] == "truck" and v not in used),
                key=lambda v: float(VEHICLES[v]["weight_cap_kg"]))
    half = len(big) // 2
    need = trip_minutes("F", district, [x[0] for x in big[:half]]) + trip_minutes("F", district, [x[0] for x in big[half:]])
    codes = []
    for i, (_, oid) in enumerate(big):
        r = c.post(f"{API}/dispatch/plans/{kpid}/move", json={"order_id": oid, "vehicle_id": vid[truck], "seq": 1 if i < half else 2},
                   headers=KANDY_DSP)
        if r.status_code == 200:
            codes = [v["code"] for v in r.json()["violations"]]
    check("C", "Two Fresh trips over 270 min together are flagged (time_budget)", "time_budget" in codes,
          f"{len(big)} {district} orders on {truck} trips 1+2 = {need} min; violations: {sorted(set(codes))}")
    r = c.post(f"{API}/dispatch/plans/{kpid}/release", headers=KANDY_DSP)
    check("C", "Release refused while any rule is broken", r.status_code == 409, r.text[:140])

    # Departures: Fresh before 03:30, Style late enough to miss the mall/delivery windows, overlapping trips
    ok(c.post(f"{API}/dispatch/plans/{kpid}/propose", headers=KANDY_DSP))
    plan2 = ok(c.get(f"{API}/dispatch/plans/{kpid}", headers=KANDY_DSP))
    fr = next(r for r in plan2["routes"] if r["brand_code"] == "F")
    day_ = date.fromisoformat(kday)
    r = ok(c.patch(f"{API}/dispatch/routes/{fr['route_id']}", headers=KANDY_DSP,
                   json={"depart_at": datetime.combine(day_, time(2, 30), COLOMBO).isoformat()}))
    v = [x["code"] for x in ok(c.get(f"{API}/dispatch/plans/{kpid}/violations", headers=KANDY_DSP))]
    check("C", "Fresh trip leaving 02:30 is flagged (fresh_window)", "fresh_window" in v, str(sorted(set(v))))
    ok(c.patch(f"{API}/dispatch/routes/{fr['route_id']}", headers=KANDY_DSP, json={"depart_at": fr["depart_at"]}))
    st = next(r for r in plan2["routes"] if r["brand_code"] == "S")
    ok(c.patch(f"{API}/dispatch/routes/{st['route_id']}", headers=KANDY_DSP,
               json={"depart_at": datetime.combine(day_, time(20, 0), COLOMBO).isoformat()}))
    v = [x["code"] for x in ok(c.get(f"{API}/dispatch/plans/{kpid}/violations", headers=KANDY_DSP))]
    check("C", "Style trip leaving 20:00 misses its windows (window)", "window" in v, str(sorted(set(v))))
    ok(c.patch(f"{API}/dispatch/routes/{st['route_id']}", headers=KANDY_DSP, json={"depart_at": st["depart_at"]}))
    two = next(vh for vh in {r["vehicle_id"] for r in plan2["routes"]}
               if sum(1 for r in plan2["routes"] if r["vehicle_id"] == vh) == 2)
    t1, t2 = sorted((r for r in plan2["routes"] if r["vehicle_id"] == two), key=lambda r: r["depart_at"])
    r = c.patch(f"{API}/dispatch/routes/{t2['route_id']}", headers=KANDY_DSP, json={"depart_at": t1["depart_at"]})
    check("C", "Second trip moved on top of the first is refused (overlap)", r.status_code == 409, r.text[:120])

    # Deferral reasons
    some = plan2["routes"][0]["stops"][0]["orders"][0]["order_id"]
    r = c.post(f"{API}/dispatch/plans/{kpid}/defer", json={"order_id": some, "reason_code": "because"}, headers=KANDY_DSP)
    check("C", "Deferral with an unknown reason is refused", r.status_code in (409, 422), f"{r.status_code} {r.text[:100]}")
    r = c.post(f"{API}/dispatch/plans/{kpid}/defer", json={"order_id": some, "reason_code": "other"}, headers=KANDY_DSP)
    check("C", "Deferral as 'other' without a note is refused", r.status_code in (409, 422), f"{r.status_code} {r.text[:100]}")
    v = ok(c.get(f"{API}/dispatch/plans/{kpid}/violations", headers=KANDY_DSP))
    check("C", "Plan clean again after the experiments", not v, str([x["message"] for x in v][:2]))
    plan3 = ok(c.get(f"{API}/dispatch/plans/{kpid}", headers=KANDY_DSP))
    audit("C (re-proposed plan)", plan3, closed["orders_confirmed"], workshop_k)

    # ---------------------------------------------------------------- Part D: cutoff, release, records
    print("\nPART D - cutoff, release, deferral record, next run")
    SM = {"X-Dev-User": "store.out077@example.com"}
    SM78 = {"X-Dev-User": "store.out078@example.com"}
    prods = ok(c.get(f"{API}/store/products", params={"temp": "ambient"}, headers=SM))
    slot = ok(c.get(f"{API}/store/order-slot", params={"temp": "ambient"}, headers=SM))
    sd = date.fromisoformat(slot["delivery_date"])
    check("D", "After orders close, a new order goes to the next operating day", sd > day_ and CALENDAR.get(sd.isoformat(), sd.isoweekday() != 7),
          f"run {kday} closed -> slot {sd} ({sd:%a}), cutoff {slot['cutoff_at']}")
    cut = local(slot["cutoff_at"])
    prev = sd - timedelta(days=1)
    while not CALENDAR.get(prev.isoformat(), prev.isoweekday() != 7):
        prev -= timedelta(days=1)
    check("D", "Cutoff is 16:00 on the previous operating day", cut.time() == time(16, 0) and cut.date() == prev, f"{cut:%a %Y-%m-%d %H:%M}")
    late = ok(c.post(f"{API}/store/orders", headers=SM, json={"client_request_id": str(uuid.uuid4()), "temp": "ambient",
                                                              "lines": [{"product_id": prods[0]["product_id"], "qty": 20}]}), 201)
    check("D", "Order placed after the close joins the later run", late["delivery_date"] == sd.isoformat(), f"{late['confirmation_no']} -> {late['delivery_date']}")
    closed_order = ok(c.get(f"{API}/store/orders", headers=SM))
    in_closed = next((o for o in closed_order if o["delivery_date"] == kday), None)
    if in_closed:
        r = c.put(f"{API}/store/orders/{in_closed['order_id']}", headers=SM,
                  json={"lines": [{"product_id": prods[0]["product_id"], "qty": 1}]})
        check("D", "A confirmed order cannot be changed after the cutoff", r.status_code in (403, 409), f"{r.status_code} {r.text[:100]}")

    rel = ok(c.post(f"{API}/dispatch/plans/{kpid}/release", headers=KANDY_DSP))
    check("D", "Release applies the drafted deferrals", rel["deferred"] == len(plan3["unplanned"]), str(rel))
    rec = ok(c.get(f"{API}/dispatch/orders/{out078}", headers=KANDY_DSP))
    d0 = rec["deferrals"][0] if rec["deferrals"] else {}
    check("D", "Deferral recorded with reason, decider and new date", bool(d0.get("reason")) and bool(d0.get("decided_by"))
          and d0.get("to_date") == sd.isoformat(), f"{d0.get('from_date')} -> {d0.get('to_date')} '{d0.get('reason')}' by {d0.get('decided_by')}")
    notes = ok(c.get(f"{API}/store/notices", headers=SM78))
    check("D", "The store is told about its deferred order", any(n.get("order_id") == out078 for n in notes) or bool(rec["notices"]),
          "; ".join(n["title"] for n in rec["notices"]))
    led = ok(c.get(f"{API}/dispatch/ledger", headers=KANDY_DSP))
    deferral_rows = [x for x in led["records"] if x["record_type"] == "deferral"]
    check("D", "Ledger lists every deferral with its reason and decider",
          len(deferral_rows) >= rel["deferred"] and all(x["reason"] and x["decided_by"] for x in deferral_rows),
          "; ".join(f"{x['outlet_name'].split()[-1]} {x['reason']}" for x in deferral_rows))
    # Next run: the deferred orders are planned first
    closed2 = ok(c.post(f"{API}/dispatch/runs/{sd.isoformat()}/close", headers=KANDY_DSP))
    ok(c.post(f"{API}/dispatch/plans/{closed2['plan_id']}/propose", headers=KANDY_DSP))
    nplan = ok(c.get(f"{API}/dispatch/plans/{closed2['plan_id']}", headers=KANDY_DSP))
    carried = [u["order_id"] for u in plan3["unplanned"]]
    on_trips = {o["order_id"] for r in nplan["routes"] for s in r["stops"] for o in (s["orders"] or [])}
    check("D", "Deferred orders are served first on the next run", all(o in on_trips for o in carried),
          f"{sum(o in on_trips for o in carried)}/{len(carried)} carried orders on trips")
    in_run = next(r["orders"] for r in ok(c.get(f"{API}/dispatch/runs", headers=KANDY_DSP))["runs"] if r["service_date"] == sd.isoformat())
    audit("D (next run)", nplan, in_run, workshop_k)

    ok(c.post(f"{API}/demo/reset", headers=KANDY_DSP))

failed = [r for r in results if not r[2]]
print(f"\n{len(results) - len(failed)}/{len(results)} checks passed")
for part, name, _, detail in failed:
    print(f"  FAIL [{part}] {name}: {detail}")
sys.exit(1 if failed else 0)
