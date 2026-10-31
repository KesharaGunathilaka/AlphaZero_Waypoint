"""Optimality certificate for one day's plan: the most orders ANY legal plan could serve.

booklet_audit.avoidable() tries each deferred order on its own. That finds a missed single insertion,
but not a better plan that needs several orders moved at once. This module answers the stronger question
exactly, with a mixed-integer program (the HiGHS solver) over the same booklet rules, recomputed from
data/general/*.csv like the rest of the audit:

  one brand + one district per trip; chilled only on reefers; van-only outlets only by vans; home depot;
  whole orders; weight AND volume per trip; at most two trips per vehicle; trip minutes = outbound +
  inter-stop x (orders - 1) + handling; Fresh <= 270 and Style + Tech <= 480 minutes per vehicle;
  weekly fuel left; delivery and mall windows (early vehicles wait); a vehicle's trips do not overlap.

Windows and overlap are not linear, so they are added lazily: solve, replay every trip with the audit's
own schedule() (stops in window-close order, the order the engine and the audit both use), and if a trip
or a pair of trips on one vehicle cannot keep its windows, cut that combination out and solve again.
A cut only removes plans that break a rule (arrivals only get later when stops are added), so the first
solution that replays cleanly is optimal. Its order count is the bound the engine is held to.

The search starts from the engine's own plan, so it only has to beat that plan or prove nothing can.

Usage: certify(orders, vehicles, day, depot, start) with
  orders   [{"id", "outlet", "temp", "kg", "m3", "deferred"}]   outlet = outlet code, temp = ambient | chilled,
           deferred = times already deferred (served first, as the engine does)
  vehicles [{"id", "fuel_left"}]                     vehicle code; litres left this week
"""
import os
import time as clock
from collections import defaultdict
from datetime import date, datetime, time, timedelta

import highspy
import numpy as np

from booklet_audit import (BRAND, COLOMBO, DAY_BUDGET, FRESH_BUDGET, FRESH_START, OUTLETS, TRAVEL, VEHICLES, check,
                           litres, schedule, sql, trip_minutes, window)

TRIPS = (0, 1)  # trip slots per vehicle


def _stops(outlets: list[str]) -> list[list[str]]:
    """Stops in window-close order, one stop per outlet (an outlet's orders share it)."""
    groups: dict[str, list[str]] = {}
    for o in sorted(outlets, key=lambda o: (window(OUTLETS[o])[1], window(OUTLETS[o])[0])):
        groups.setdefault(o, []).append(o)
    return list(groups.values())


def replay(day: date, outlets: list[str], earliest: datetime) -> datetime | None:
    """End of a trip serving these outlets' orders, leaving no earlier than `earliest`; None if a window is missed."""
    ou = OUTLETS[outlets[0]]
    brand, district = BRAND[ou["brand"]], ou["district"]
    stops = _stops(outlets)
    out = int(TRAVEL[district]["depot_to_district_freeflow_min"])
    depart = max(earliest, datetime.combine(day, window(OUTLETS[stops[0][0]])[0], COLOMBO) - timedelta(minutes=out))
    sched = schedule(day, depart, district, brand, stops)
    if sched is None:
        return None
    return max(sched[1], depart + timedelta(minutes=trip_minutes(brand, district, outlets)))


def _start(day: date, outlets: list[str]) -> datetime:
    fresh = BRAND[OUTLETS[outlets[0]]["brand"]] == "F"
    return datetime.combine(day, FRESH_START if fresh else time(0), COLOMBO)


def vehicle_ok(day: date, a: list[str], b: list[str] | None) -> bool:
    """Can one vehicle run trip a (and trip b) keeping every window, in some order?"""
    if b is None:
        return replay(day, a, _start(day, a)) is not None
    for first, second in ((a, b), (b, a)):
        end = replay(day, first, _start(day, first))
        if end is not None and replay(day, second, max(end, _start(day, second))) is not None:
            return True
    return False


def certify(orders: list[dict], vehicles: list[dict], day: date, depot: str, start: list | None = None,
            time_limit: float = 120.0) -> dict:
    """Most orders any legal plan serves, earlier deferrals first.

    start: a legal plan to begin from, [(vehicle, [order ids]), ...] in trip order (the engine's plan), so the
    search only has to beat it or prove it cannot be beaten. time_limit is for the whole search, in seconds.
    Returns {"best", "proven", "bound", "deferred_served", "rounds", "cuts", "plan": {vehicle: [[order ids]]}}."""
    od = {o["id"]: o for o in orders}
    group = {o["id"]: (BRAND[OUTLETS[o["outlet"]]["brand"]], OUTLETS[o["outlet"]]["district"]) for o in orders}
    vh_fuel = {v["id"]: float(v["fuel_left"]) for v in vehicles}

    # Order-vehicle pairs that pass every rule on their own (alone, as the vehicle's first trip).
    def alone_ok(o, vid):
        veh, ou = VEHICLES[vid], OUTLETS[o["outlet"]]
        b, dist = group[o["id"]]
        return (veh["depot"] == depot and ou["depot"] == depot
                and (o["temp"] == "ambient" or veh["temp"] == "reefer")
                and (ou["parking_constraint"] != "van_only" or veh["type"] == "van")
                and o["kg"] <= float(veh["weight_cap_kg"]) + 1e-9 and o["m3"] <= float(veh["volume_cap_m3"]) + 1e-9
                and trip_minutes(b, dist, [o["outlet"]]) <= (FRESH_BUDGET if b == "F" else DAY_BUDGET)
                and litres(dist, 1, veh) <= vh_fuel[vid] + 1e-9
                and replay(day, [o["outlet"]], _start(day, [o["outlet"]])) is not None)

    pairs = [(o["id"], v) for o in orders for v in vh_fuel if alone_ok(o, v)]
    servable = {oid for oid, _ in pairs}                                    # orders some vehicle can take alone

    # Variables: x[o,v,k] order o on trip k of vehicle v; y[v,k,g] trip k of v serves group g (brand, district).
    xi, yi = {}, {}
    for (oid, v) in pairs:
        for k in TRIPS:
            xi[(oid, v, k)] = len(xi)
    n_x = len(xi)
    for (oid, v) in pairs:
        for k in TRIPS:
            yi.setdefault((v, k, group[oid]), n_x + len(yi))
    n = n_x + len(yi)

    h = highspy.Highs()
    h.setOptionValue("output_flag", False)
    h.setOptionValue("mip_rel_gap", 0.0)
    h.addVars(n, np.zeros(n), np.ones(n))
    h.changeColsIntegrality(n, np.arange(n, dtype=np.int32), np.full(n, highspy.HighsVarType.kInteger))
    pending: list[tuple[dict, float]] = []
    n_rows = 0

    def add(coefs: dict[int, float], ub: float):
        pending.append((coefs, ub))

    def flush():
        nonlocal n_rows
        if not pending:
            return
        starts, idx, val = [], [], []
        for coefs, _ in pending:
            starts.append(len(idx))
            idx += list(coefs)
            val += list(coefs.values())
        h.addRows(len(pending), np.full(len(pending), -highspy.kHighsInf), np.array([u for _, u in pending], float),
                  len(idx), np.array(starts, np.int32), np.array(idx, np.int32), np.array(val, float))
        n_rows += len(pending)
        pending.clear()

    by_order, trip_x, trip_y = defaultdict(list), defaultdict(list), defaultdict(list)
    for (oid, v, k), i in xi.items():
        by_order[oid].append(i)
        trip_x[(v, k)].append((oid, i))
        add({i: 1.0, yi[(v, k, group[oid])]: -1.0}, 0)                     # only on a trip of its own group
    for (v, k, g), i in yi.items():
        trip_y[(v, k)].append((g, i))
    for idx in by_order.values():
        add({i: 1.0 for i in idx}, 1)                                       # served at most once (whole order)
    for v in vh_fuel:
        veh = VEHICLES[v]
        for k in TRIPS:
            if (v, k) not in trip_y:
                continue
            ys = [i for _, i in trip_y[(v, k)]]
            add({i: 1.0 for i in ys}, 1)                                    # one brand + district per trip
            for field, cap in (("kg", "weight_cap_kg"), ("m3", "volume_cap_m3")):
                c = {i: od[o][field] for o, i in trip_x[(v, k)]}              # capacity, only on a trip in use
                c.update({i: -float(veh[cap]) for i in ys})
                add(c, 0)
        if (v, 1) in trip_y and (v, 0) in trip_y:                           # trip 2 only if trip 1 (symmetry)
            c = {i: 1.0 for _, i in trip_y[(v, 1)]}
            c.update({i: -1.0 for _, i in trip_y[(v, 0)]})
            add(c, 0)
        # Time budgets: minutes = (outbound - inter) per trip + (inter + allowance) per order.
        for fresh, budget in ((True, FRESH_BUDGET), (False, DAY_BUDGET)):
            c = {}
            for k in TRIPS:
                for (b, dist), i in trip_y.get((v, k), []):
                    if (b == "F") == fresh:
                        t = TRAVEL[dist]
                        c[i] = int(t["depot_to_district_freeflow_min"]) - int(t["inter_stop_freeflow_min"])
                for o, i in trip_x.get((v, k), []):
                    b, dist = group[o]
                    if (b == "F") == fresh:
                        c[i] = int(TRAVEL[dist]["inter_stop_freeflow_min"]) + trip_minutes(b, dist, [od[o]["outlet"]]) \
                               - int(TRAVEL[dist]["depot_to_district_freeflow_min"])
            if c:
                add(c, budget)
        # Slot 0 is the vehicle's earlier trip. A Fresh trip leaves at 03:30 at the earliest, so a Fresh order
        # on slot 1 is reached no sooner than 03:30 + slot 0's minutes + the drive out to its district, and
        # that must be before its window closes. (Off when slot 0 is a Style or Tech trip.)
        if (v, 1) in trip_y and (v, 0) in trip_y:
            first = {}
            for (b, dist), i in trip_y[(v, 0)]:
                if b == "F":
                    t = TRAVEL[dist]
                    first[i] = int(t["depot_to_district_freeflow_min"]) - int(t["inter_stop_freeflow_min"])
            for o, i in trip_x[(v, 0)]:
                b, dist = group[o]
                if b == "F":
                    first[i] = int(TRAVEL[dist]["inter_stop_freeflow_min"]) + trip_minutes(b, dist, [od[o]["outlet"]]) \
                               - int(TRAVEL[dist]["depot_to_district_freeflow_min"])
            not_fresh = [i for (b, _), i in trip_y[(v, 0)] if b != "F"]
            fresh_start = FRESH_START.hour * 60 + FRESH_START.minute
            for o, i in trip_x[(v, 1)]:
                b, dist = group[o]
                if b != "F":
                    continue
                closes = window(OUTLETS[od[o]["outlet"]])[1]
                slack = closes.hour * 60 + closes.minute - fresh_start - int(TRAVEL[dist]["depot_to_district_freeflow_min"])
                big = FRESH_BUDGET + max(0, -slack)
                c = dict(first)
                c[i] = c.get(i, 0) + big
                c.update({j: -big for j in not_fresh})
                add(c, slack + big)
        # Weekly fuel left: (2 x outbound - inter) km per trip + inter km per order, over km per litre.
        c, kpl = {}, float(veh["km_per_l"])
        for k in TRIPS:
            for (_, dist), i in trip_y.get((v, k), []):
                t = TRAVEL[dist]
                c[i] = (2 * float(t["depot_to_district_km"]) - float(t["inter_stop_km"])) / kpl
            for o, i in trip_x.get((v, k), []):
                c[i] = float(TRAVEL[group[o][1]]["inter_stop_km"]) / kpl
        if c:
            add(c, vh_fuel[v])

    # Window conflicts between two orders, known before solving (the lazy cuts below catch the rest):
    # two orders of one group that no single trip can serve keeping both windows, and two orders that no
    # vehicle can serve at all, on one trip or on two. Valid for every larger set, since arrivals only get later.
    ids = [o["id"] for o in orders]
    on_vehicle = defaultdict(list)                                           # (order, vehicle) -> x columns
    for (oid, v, k), i in xi.items():
        on_vehicle[(oid, v)].append(i)
    for a_i, a in enumerate(ids):
        for b in ids[a_i + 1:]:
            pa, pb = [od[a]["outlet"]], [od[b]["outlet"]]
            same_trip = group[a] == group[b] and replay(day, pa + pb, _start(day, pa)) is not None
            if group[a] == group[b] and not same_trip:
                for v in vh_fuel:
                    for k in TRIPS:
                        if (a, v, k) in xi and (b, v, k) in xi:
                            add({xi[(a, v, k)]: 1.0, xi[(b, v, k)]: 1.0}, 1)
            if not same_trip and not vehicle_ok(day, pa, pb):
                for v in vh_fuel:
                    if on_vehicle[(a, v)] and on_vehicle[(b, v)]:
                        add({i: 1.0 for i in on_vehicle[(a, v)] + on_vehicle[(b, v)]}, 1)
    flush()
    base_rows = n_rows

    # Objective, in strict priority (each weight is worth more than everything below it):
    #   1. orders deferred before (the booklet's "same outlet unserved on consecutive runs"), as the engine;
    #   2. orders served;  3. the fewest trips.
    weight = len(orders) + 1
    cost = np.zeros(n)
    for (oid, v, k), i in xi.items():
        cost[i] = -(weight if od[oid].get("deferred", 0) else 1.0)
    cost[n_x:] = 1.0 / (len(yi) + 1)
    h.changeColsCost(n, np.arange(n, dtype=np.int32), cost)

    def vector(plan_trips: dict) -> np.ndarray:
        x = np.zeros(n)
        for (v, k), ids in plan_trips.items():
            for o in ids:
                x[xi[(o, v, k)]] = 1
                x[yi[(v, k, group[o])]] = 1
        return x

    incumbent = None                                                        # best plan known to keep every rule
    if start:
        slots: dict = {}
        for v, ids in start:
            k = sum(1 for (w, _) in slots if w == v)
            slots[(v, k)] = list(ids)
        incumbent = vector(slots)

    deadline = clock.monotonic() + time_limit
    result = {"best": None, "proven": False, "bound": None, "rounds": 0, "plan": {}, "servable": servable}
    proven, bound_w = False, None
    while True:
        left = deadline - clock.monotonic()
        if left <= 0:
            break
        h.setOptionValue("time_limit", left)
        if incumbent is not None:
            sol = highspy.HighsSolution()
            sol.col_value = list(incumbent)
            h.setSolution(sol)
        h.run()
        result["rounds"] += 1
        info = h.getInfo()
        if np.isfinite(info.mip_dual_bound):
            bound_w = info.mip_dual_bound
        if info.primal_solution_status != 2:                                # no solution at all
            break
        x = np.round(np.array(h.getSolution().col_value)).astype(int)
        trips = defaultdict(list)
        for (oid, v, k), i in xi.items():
            if x[i]:
                trips[(v, k)].append(oid)
        outl = lambda ids: [od[i]["outlet"] for i in ids]
        cuts = 0
        for v in vh_fuel:
            a, b = trips.get((v, 0)), trips.get((v, 1))
            if not a:
                continue
            bad = [s for s in (a, b) if s and replay(day, outl(s), _start(day, outl(s))) is None]
            for s in bad:                    # this set of orders breaks a window on any vehicle: cut it everywhere
                for w in vh_fuel:
                    for k in TRIPS:
                        idx = [xi[(o, w, k)] for o in s if (o, w, k) in xi]
                        if len(idx) == len(s):
                            add({i: 1.0 for i in idx}, len(s) - 1)
                cuts += 1
            if not bad and b and not vehicle_ok(day, outl(a), outl(b)):
                for w in vh_fuel:            # these two trips cannot share a vehicle, in either order
                    for k1, k2 in ((0, 1), (1, 0)):
                        idx = [xi[(o, w, k1)] for o in a if (o, w, k1) in xi] + \
                              [xi[(o, w, k2)] for o in b if (o, w, k2) in xi]
                        if len(idx) == len(a) + len(b):
                            add({i: 1.0 for i in idx}, len(a) + len(b) - 1)
                cuts += 1
        if cuts:
            flush()
            continue
        if incumbent is None or cost @ x < cost @ incumbent - 1e-9:
            incumbent = x
        proven = h.getModelStatus() == highspy.HighsModelStatus.kOptimal
        break

    if incumbent is None:
        return result
    served = {oid for (oid, _, _), i in xi.items() if incumbent[i] > 0.5}
    d_served = sum(1 for o in served if od[o].get("deferred", 0))
    plan = defaultdict(list)
    for (v, k) in sorted({(v, k) for (o, v, k), i in xi.items() if incumbent[i] > 0.5}):
        plan[v].append(sorted(o for (o, w, kk), i in xi.items() if w == v and kk == k and incumbent[i] > 0.5))
    # Bound for plans that serve as many previously deferred orders: the trip term totals under 1, so the
    # weighted order count is at most ceil(-dual bound); take the deferred orders' extra weight back out.
    bound = len(served) if proven else (d_served + int(np.ceil(-bound_w - 1e-6)) - d_served * weight
                                        if bound_w is not None else None)
    proven = proven or (bound is not None and bound <= len(served))         # the bound met the best plan found
    result.update(best=len(served), proven=proven, bound=bound, deferred_served=d_served, plan=dict(plan),
                  cuts=n_rows - base_rows)
    return result


def chilled_ceiling(orders: list[dict], vehicles: list[dict], day: date, depot: str, start: list | None,
                    time_limit: float) -> int | None:
    """Most chilled orders any plan can serve, or None if not proven in time.

    Chilled orders can only ride on refrigerated vehicles, so the chilled orders alone on the reefers alone is a
    smaller problem whose optimum is a ceiling for every full plan: dropping the ambient orders can only free
    capacity, time and fuel. Deferral priority is ignored here, so this is a ceiling on the count only."""
    chilled = [{**o, "deferred": 0} for o in orders if o["temp"] != "ambient"]
    reefers = [v for v in vehicles if VEHICLES[v["id"]]["temp"] == "reefer"]
    ids = {o["id"] for o in chilled}
    sub_start = [(v, [o for o in ids_ if o in ids]) for v, ids_ in (start or []) if VEHICLES[v]["temp"] == "reefer"]
    sub_start = [(v, ids_) for v, ids_ in sub_start if ids_]
    if not chilled:
        return 0
    r = certify(chilled, reefers, day, depot, start=sub_start, time_limit=time_limit)
    return r["best"] if r["proven"] else None


def certificate(part: str, plan: dict, trips: list, deferred: dict, workshop: set[str], time_limit: float | None = None):
    """Audit check: does any legal plan serve more orders than the engine's, putting earlier deferrals first?

    PASS with "proven" when the solver closes the gap; PASS without it when the time limit stops the search
    first (the detail gives the bound); FAIL with the better plan's deferrals when one exists.
    Time limit: WP_EXACT_SECONDS (default 120) per plan.

    `trips` and `deferred` are what booklet_audit.audit() returned for this plan. Weekly fuel already used by
    other released plans and each order's deferral count are history, so they come from the database."""
    time_limit = time_limit or float(os.environ.get("WP_EXACT_SECONDS", "120"))
    day = date.fromisoformat(plan["plan"]["service_date"])
    depot = {1: "Peliyagoda", 2: "Kandy"}[plan["plan"]["depot_id"]]
    orders = [{"id": o["order_id"], "outlet": s["outlet"], "temp": o["temp"], "kg": float(o["kg"]), "m3": float(o["m3"])}
              for t in trips for s in t["stops"] for o in s["orders"]]
    orders += [{"id": u["order_id"], "outlet": u["outlet_code"], "temp": u["temp"], "kg": float(u["weight_kg"]),
                "m3": float(u["volume_m3"])} for u in deferred.values()]
    counts = {r["order_id"]: r["deferral_count"] for r in sql(
        "SELECT order_id, deferral_count FROM wp.order_header WHERE order_id = ANY($1::bigint[])", [o["id"] for o in orders])}
    for o in orders:
        o["deferred"] = counts[o["id"]]
    used = {r["source_id"]: float(r["used"]) for r in sql("""
        SELECT v.source_id, wp.fuel_used_week(v.vehicle_id, wp.week_start($1::date), $2) AS used
        FROM wp.vehicle v WHERE v.depot_id = $3""", day, plan["plan"]["plan_id"], plan["plan"]["depot_id"])}
    vehicles = [{"id": v, "fuel_left": float(VEHICLES[v]["weekly_fuel_quota_l"]) - used.get(v, 0.0)}
                for v in VEHICLES if VEHICLES[v]["depot"] == depot and v not in workshop]

    engine = len(orders) - len(deferred)
    engine_repeat = sum(1 for o in orders if o["deferred"] and o["id"] not in deferred)
    start = [(t["veh"], [o["order_id"] for s in t["stops"] for o in s["orders"]]) for t in sorted(trips, key=lambda t: t["depart"])]
    r = certify(orders, vehicles, day, depot, start=start, time_limit=time_limit)
    name = "No legal plan serves more orders (exact search over every plan)"
    if r["best"] is None:
        return check(part, name, False, f"no answer within {time_limit:.0f} s")
    better = (r["deferred_served"], r["best"]) > (engine_repeat, engine)
    if not better and not r["proven"] and engine_repeat == sum(1 for o in orders if o["deferred"] and o["id"] in r["servable"]):
        # Ceiling from the chilled orders on the reefers: every ambient order some vehicle can take, plus the most
        # chilled orders the reefers can carry. If the engine reaches it, no plan does better.
        ceiling = chilled_ceiling(orders, vehicles, day, depot, start, time_limit)
        ambient = sum(1 for o in orders if o["temp"] == "ambient" and o["id"] in r["servable"])
        if ceiling is not None and ambient + ceiling <= engine:
            r["proven"] = True
            r["how"] = f"{ambient} ambient orders any vehicle can take + at most {ceiling} chilled on the reefers"
    if better:
        served = {o for ts in r["plan"].values() for t in ts for o in t}
        where = {o["id"]: f"{o['outlet']} {o['temp']}" for o in orders}
        gains = sorted(where[o] for o in deferred if o in served)
        losses = sorted(where[o["id"]] for o in orders if o["id"] not in deferred and o["id"] not in served)
        detail = (f"a legal plan serves {r['best']} of {len(orders)}, the engine {engine}: it serves {', '.join(gains)}"
                  + (f" and defers {', '.join(losses)} instead" if losses else ""))
    elif r["proven"]:
        detail = (f"proven: no legal plan serves more than {engine} of {len(orders)} ("
                  + (r.get("how") or f"{r['rounds']} rounds, {r['cuts']} window cuts") + ")")
    else:
        detail = (f"NOT proven: search stopped at {time_limit:.0f} s with no better plan; "
                  f"any plan serves at most {r.get('bound')} of {len(orders)} (engine {engine})")
    return check(part, name, not better, detail)
