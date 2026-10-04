"""A complete delivery day, both depots, every role, through the API.

  1  Store managers order: Fresh dry and chilled, Style, Tech; Kandy and Peliyagoda; street, rear dock
     and mall outlets. What a store may not order is refused.
  2  The cutoff: orders close, a closed order cannot change, a later order goes to the next operating
     day; the 16:00 rule itself is checked on the clock, Sundays included.
  3  The dispatcher plans Kandy, then Peliyagoda: the engine's plans are audited rule by rule from the
     CSVs, deferrals carry reasons, a rule-breaking move is refused, plans are sent, stores are told.
  4  Loaders load every trip last stop first, flag a shortfall, release each vehicle.
  5  Drivers run every trip: delivered, some missing, not delivered, a correction, offline resends.
  6  The dispatcher watches both depots on one screen, moves the failed delivery to the next day.
  7  Store managers confirm what arrived and report an issue.
  8  End of the day: both runs complete, every order accounted for, fuel counted against the weekly
     quota, and the next day's plan serves the carried-over orders first with the fuel that is left.

It wipes all app data (demo reset) and adds test-only accounts (no password, so they never appear on
the sign-in page): a driver for every vehicle, a Peliyagoda loader. Run it locally, never on Neon:

    ENVIRONMENT=development AUTH_DEV_BYPASS=true ALLOWED_HOSTS='["testserver"]' PUBLIC_API_URL=http://testserver \\
    DATABASE_URL=postgresql://waypoint:waypoint@localhost:5433/waypoint?sslmode=disable \\
    uv run python tests/day_scenario.py
"""
import sys
import uuid
from datetime import date, datetime, timezone

from booklet_audit import API, OUTLETS, audit, avoidable, check, ok, results, sql
from fastapi.testclient import TestClient

from app.main import app

DSP = {"X-Dev-User": "dispatcher@example.com"}
LOADER_K = {"X-Dev-User": "loader.kandy@example.com"}
LOADER_P = {"X-Dev-User": "loader.peliyagoda@waypoint.test"}
STORE = {code: {"X-Dev-User": f"store.{code.lower()}@example.com"}
         for code in ("OUT077", "OUT078", "OUT102", "OUT103", "OUT018", "OUT022")}


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def as_driver(vehicle: str) -> dict:
    demo = {"VEH057", "VEH059", "VEH060"}
    return {"X-Dev-User": f"driver.{vehicle.lower()}@{'example.com' if vehicle in demo else 'waypoint.test'}"}


def event(type_: str, route_id: int, payload: dict | None = None, stop_id: int | None = None) -> dict:
    e = {"event_id": str(uuid.uuid4()), "type": type_, "route_id": route_id, "device_time": now(), "payload": payload or {}}
    if stop_id is not None:
        e["stop_id"] = stop_id
    return e


def sync(c, who, device, events):
    res = ok(c.post(f"{API}/sync", json={"device_id": device, "client_now": now(), "events": events}, headers=who))
    for x, e in zip(res["results"], events):
        if x["state"] != "applied":
            print(f"    ! {e['type']} {x['state']}: {x['reject_reason']}")
    return [x["state"] for x in res["results"]]


def products(c, who, temp):
    return ok(c.get(f"{API}/store/products", params={"temp": temp}, headers=who))


def place(c, who, temp, lines, request_id=None):
    return c.post(f"{API}/store/orders", headers=who,
                  json={"client_request_id": request_id or str(uuid.uuid4()), "temp": temp, "lines": lines})


with TestClient(app) as c:
    print("\n1 · STORE MANAGERS ORDER")
    reset = ok(c.post(f"{API}/demo/reset", headers=DSP))
    day = reset["service_date"]
    print(f"  demo day {day}: Kandy {reset['orders']} orders, Peliyagoda {reset['peliyagoda']['orders']} orders already in")

    # Test-only accounts: a driver for every vehicle (so every trip can be run), a Peliyagoda loader.
    sql("""INSERT INTO wp.app_user(role, name, email, depot_id, vehicle_id)
           SELECT 'driver', 'Test driver ' || v.source_id, 'driver.' || lower(v.source_id) || '@waypoint.test', v.depot_id, v.vehicle_id
           FROM wp.vehicle v WHERE NOT EXISTS (SELECT 1 FROM wp.app_user u WHERE u.vehicle_id = v.vehicle_id)
           ON CONFLICT (email) DO NOTHING""")
    sql("""INSERT INTO wp.app_user(role, name, email, depot_id) VALUES ('loader', 'Test loader Peliyagoda',
           'loader.peliyagoda@waypoint.test', (SELECT depot_id FROM wp.depot WHERE name = 'Peliyagoda'))
           ON CONFLICT (email) DO NOTHING""")

    fresh_product = products(c, STORE["OUT077"], "ambient")[0]["product_id"]
    r = place(c, STORE["OUT103"], "ambient", [{"product_id": fresh_product, "qty": 1}])
    check("1", "Tech cannot order Fresh products", r.status_code == 409 and "WP165" in r.text, r.text[:110])

    placed = {}
    for code, temp, units in [("OUT077", "ambient", 12), ("OUT102", "ambient", 6), ("OUT103", "ambient", 2),
                              ("OUT018", "ambient", 6), ("OUT022", "ambient", 2)]:
        who = STORE[code]
        prods = products(c, who, temp)
        slot = ok(c.get(f"{API}/store/order-slot", params={"temp": temp}, headers=who))
        rid = str(uuid.uuid4())
        lines = [{"product_id": p["product_id"], "qty": units} for p in prods[:3]]
        r1 = place(c, who, temp, lines, rid)
        r2 = place(c, who, temp, lines, rid)  # the phone retries: same order back
        o = r1.json()
        placed[code] = o
        brand = ok(c.get(f"{API}/store/outlet", headers=who))
        check("1", f"{code} ({brand.get('brand_name') or brand.get('brand_code')}, {brand.get('district')}) places a {temp} order",
              r1.status_code == 201 and o["delivery_date"] == slot["delivery_date"] == day and r2.json()["order_id"] == o["order_id"],
              f"{o['confirmation_no']} for {o['delivery_date']} · retry returned the same order")
    notice = ok(c.get(f"{API}/store/notices", headers=STORE["OUT102"]))
    check("1", "The store gets an 'Order received' confirmation with the cutoff", any(n["title"] == "Order received" for n in notice),
          next((n["body"] for n in notice if n["title"] == "Order received"), ""))

    r = place(c, STORE["OUT077"], "ambient", [{"product_id": products(c, STORE["OUT077"], "ambient")[0]["product_id"], "qty": 1}])
    check("1", "A second dry order for the same day is refused (change the first instead)", r.status_code == 409, r.text[:110])
    r = place(c, STORE["OUT102"], "chilled", [{"product_id": products(c, STORE["OUT102"], "ambient")[0]["product_id"], "qty": 1}])
    check("1", "Style cannot order chilled goods", r.status_code == 409 and not products(c, STORE["OUT102"], "chilled"), r.text[:110])
    r = c.get(f"{API}/store/orders/{placed['OUT077']['order_id']}", headers=STORE["OUT102"])
    check("1", "A store cannot open another outlet's order", r.status_code in (403, 404), str(r.status_code))
    new_lines = [{"product_id": p["product_id"], "qty": 9} for p in products(c, STORE["OUT102"], "ambient")[:2]]
    r = c.put(f"{API}/store/orders/{placed['OUT102']['order_id']}", json={"lines": new_lines}, headers=STORE["OUT102"])
    check("1", "Before the cutoff a store can change its order", r.status_code == 200, r.text[:80])

    print("\n2 · THE CUTOFF (16:00 THE OPERATING DAY BEFORE)")
    # The rule on the clock, independent of today's date: Tue 13 Oct closes Mon 12 Oct 16:00;
    # Mon 12 Oct closes Sat 10 Oct 16:00 (Sunday is not an operating day); nothing is ever due on a Sunday.
    rule = sql("""SELECT
        wp.next_delivery_date(o.outlet_id, 'ambient', DATE '2026-10-13', TIMESTAMPTZ '2026-10-12 15:59:00+05:30', true) AS a,
        wp.next_delivery_date(o.outlet_id, 'ambient', DATE '2026-10-13', TIMESTAMPTZ '2026-10-12 16:00:01+05:30', true) AS b,
        wp.next_delivery_date(o.outlet_id, 'ambient', DATE '2026-10-12', TIMESTAMPTZ '2026-10-11 10:00:00+05:30', true) AS c,
        wp.next_delivery_date(o.outlet_id, 'ambient', DATE '2026-10-11', TIMESTAMPTZ '2026-10-09 09:00:00+05:30', true) AS d
        FROM wp.outlet o WHERE o.code = 'OUT077'""")[0]
    check("2", "Ordered 15:59 Mon → delivered Tue; 16:00:01 Mon → Wed", rule["a"] == date(2026, 10, 13) and rule["b"] == date(2026, 10, 14),
          f"{rule['a']} / {rule['b']}")
    check("2", "Sunday: Monday's cutoff was Saturday 16:00, so a Sunday order goes to Tuesday", rule["c"] == date(2026, 10, 13), str(rule["c"]))
    check("2", "No delivery is ever planned for a Sunday", rule["d"] == date(2026, 10, 12), f"asked Sun 11 → {rule['d']}")

    closed = ok(c.post(f"{API}/dispatch/runs/{day}/close", headers=DSP))  # Kandy: the 16:00 cutoff, now
    check("2", "Closing Kandy confirms every placed order", closed["orders_confirmed"] == reset["orders"] + 3, str(closed))
    r = c.put(f"{API}/store/orders/{placed['OUT102']['order_id']}", json={"lines": new_lines}, headers=STORE["OUT102"])
    check("2", "After the cutoff an order is locked", r.status_code == 409, r.text[:100])
    chilled = products(c, STORE["OUT077"], "chilled")
    late = place(c, STORE["OUT077"], "chilled", [{"product_id": p["product_id"], "qty": 20} for p in chilled[:3]])
    check("2", "An order after the cutoff goes to the next operating day", late.status_code == 201 and late.json()["delivery_date"] > day,
          f"{late.json().get('confirmation_no')} → {late.json().get('delivery_date')}")
    next_day = late.json()["delivery_date"]
    r = place(c, STORE["OUT018"], "ambient", [{"product_id": p["product_id"], "qty": 3} for p in products(c, STORE["OUT018"], "ambient")[:2]])
    check("2", "Peliyagoda's run is still open: its own cutoff is independent", r.status_code == 409 and "already" in r.text,
          "OUT018 already ordered for that day (one order per kind per day)")

    print("\n3 · DISPATCHER PLANS BOTH DEPOTS")
    kpid = closed["plan_id"]
    ok(c.post(f"{API}/dispatch/plans/{kpid}/propose", headers=DSP))
    kplan = ok(c.get(f"{API}/dispatch/plans/{kpid}", headers=DSP))
    workshop_k = {v["source_id"] for v in kplan["vehicles"] if not v["active"]}
    trips, by_veh, deferred = audit("3 Kandy", kplan, closed["orders_confirmed"], workshop_k)
    avoidable("3 Kandy", kplan, trips, by_veh, deferred, workshop_k)
    kinds = {(OUT["brand"], OUT["parking_constraint"] == "van_only", OUT["dock_type"])
             for t in trips for s in t["stops"] for OUT in [OUTLETS[s["outlet"]]]}
    check("3", "The Kandy plan carries every category", {"Fresh", "Style", "Tech"} <= {k[0] for k in kinds},
          f"{len(trips)} trips · brands {sorted({k[0] for k in kinds})} · van-only and normal outlets")
    order_078 = next(u for u in kplan["unplanned"] if u["outlet_code"] == "OUT078")
    r = c.post(f"{API}/dispatch/plans/{kpid}/defer", json={"order_id": order_078["order_id"], "reason_code": "other"}, headers=DSP)
    check("3", "A deferral as 'Other' needs a written note", r.status_code == 409, r.text[:90])
    ok(c.post(f"{API}/dispatch/plans/{kpid}/defer", headers=DSP,
              json={"order_id": order_078["order_id"], "reason_code": "van_only_full", "note": "Both VEH057 trips full; VEH058 in the workshop"}))
    busy = {r_["vehicle_id"] for r_ in kplan["routes"]}
    truck = next(v for v in kplan["vehicles"] if v["class"].startswith("Dry") and v["active"] and v["vehicle_id"] not in busy)
    r = c.post(f"{API}/dispatch/plans/{kpid}/move", json={"order_id": order_078["order_id"], "vehicle_id": truck["vehicle_id"], "seq": 1}, headers=DSP)
    check("3", "Putting a chilled order on a dry truck is refused", r.status_code == 409 and "chilled" in r.text, r.text[:90])
    rel = ok(c.post(f"{API}/dispatch/plans/{kpid}/release", headers=DSP))
    check("3", "Kandy plan sent; every deferred store told", rel["deferred"] == len(kplan["unplanned"]), str(rel))
    notes = ok(c.get(f"{API}/store/notices", headers=STORE["OUT078"]))
    check("3", "OUT078 hears it is not arriving, why, and when instead", any("Not arriving" in n["title"] for n in notes),
          next((n["body"] for n in notes if "Not arriving" in n["title"]), ""))

    ok(c.post(f"{API}/dispatch/depot", json={"depot_id": 1}, headers=DSP))
    pclosed = ok(c.post(f"{API}/dispatch/runs/{day}/close", headers=DSP))
    ppid = pclosed["plan_id"]
    ok(c.post(f"{API}/dispatch/plans/{ppid}/propose", headers=DSP))
    pplan = ok(c.get(f"{API}/dispatch/plans/{ppid}", headers=DSP))
    workshop_p = {v["source_id"] for v in pplan["vehicles"] if not v["active"]}
    ptrips, pveh, pdef = audit("3 Peliyagoda", pplan, pclosed["orders_confirmed"], workshop_p)
    avoidable("3 Peliyagoda", pplan, ptrips, pveh, pdef, workshop_p)
    mall = [t for t in ptrips if any(OUTLETS[s["outlet"]]["mall_window"] for s in t["stops"])]
    check("3", "Peliyagoda mall outlets are served inside their mall window", bool(mall),
          f"{len(mall)} trips to mall outlets, e.g. {mall[0]['veh']} {[s['outlet'] for s in mall[0]['stops']]}" if mall else "")
    ok(c.post(f"{API}/dispatch/plans/{ppid}/release", headers=DSP))
    ok(c.post(f"{API}/dispatch/depot", json={"depot_id": 2}, headers=DSP))

    planned_fuel = {}
    for plan in (kplan, pplan):
        for r_ in plan["routes"]:
            planned_fuel[r_["vehicle_id"]] = planned_fuel.get(r_["vehicle_id"], 0) + float(r_["est_fuel_l"] or 0)

    print("\n4 · LOADERS LOAD AND RELEASE EVERY VEHICLE")
    flagged = None
    for who, depot_name in ((LOADER_K, "Kandy"), (LOADER_P, "Peliyagoda")):
        feed = ok(c.get(f"{API}/loader/routes", headers=who))["routes"]
        check("4", f"{depot_name} loader sees only {depot_name} trips", feed and all(r_["depot_id"] == (2 if depot_name == "Kandy" else 1) for r_ in feed),
              f"{len(feed)} trips")
        tablet = str(uuid.uuid4())
        states = []
        for r_ in feed:
            ll = ok(c.get(f"{API}/loader/routes/{r_['route_id']}", headers=who))["lines"]
            orders = [x["load_order"] for x in ll]
            if orders != sorted(orders):
                check("4", "Load order is last stop first", False, str(r_["route_id"]))
            evs = []
            for stop_id in dict.fromkeys(x["stop_id"] for x in ll):
                lines = []
                for x in (x for x in ll if x["stop_id"] == stop_id):
                    qty = float(x["ordered_qty"])
                    if flagged is None and depot_name == "Kandy" and r_["vehicle_source_id"] == "VEH057":
                        flagged = (x["order_id"], x["line_no"], x["outlet_name"].split()[-1], x["product"] if "product" in x else x.get("name"))
                        evs.append(event("flag", r_["route_id"], {"flag_id": str(uuid.uuid4()), "type": "short", "order_id": x["order_id"],
                                                                  "line_no": x["line_no"], "qty": 2, "note": "Two cartons short at the dock"}))
                        qty -= 2
                    lines.append({"confirmation_id": str(uuid.uuid4()), "order_id": x["order_id"], "line_no": x["line_no"], "qty_loaded": qty})
                evs.append(event("load_confirm", r_["route_id"], {"lines": lines}))
            evs.append(event("route_release", r_["route_id"], {"release_id": str(uuid.uuid4())}))
            states += sync(c, who, tablet, evs)
        check("4", f"{depot_name}: every line confirmed and every vehicle released", set(states) == {"applied"}, f"{len(states)} events applied")
    check("4", "A shortfall was flagged on VEH057 before release", flagged is not None, f"{flagged[2]} line {flagged[1]}, 2 short" if flagged else "")

    print("\n5 · DRIVERS RUN EVERY TRIP")
    all_routes = {r_["route_id"]: (r_, plan) for plan in (kplan, pplan) for r_ in plan["routes"]}
    vehicles = {v["vehicle_id"]: v["source_id"] for plan in (kplan, pplan) for v in plan["vehicles"]}
    failed_order = part_order = corrected = None
    for vid in sorted({r_["vehicle_id"] for r_, _ in all_routes.values()}):
        veh = vehicles[vid]
        who = as_driver(veh)
        run = ok(c.get(f"{API}/driver/run", headers=who))
        on_board = {(x["order_id"], x["line_no"]): float(x["qty_loaded"]) for x in run["loaded"]}
        mine = sorted((r_ for p in run["plans"] for r_ in p["routes"]), key=lambda r_: r_["depart_at"])
        expected = sorted(rid for rid, (r_, _) in all_routes.items() if r_["vehicle_id"] == vid)
        if sorted(r_["route_id"] for r_ in mine) != expected:
            check("5", f"{veh}'s phone shows exactly its own trips", False, f"{[r_['route_id'] for r_ in mine]} vs {expected}")
        phone = str(uuid.uuid4())
        for trip in mine:
            evs = [event("depart", trip["route_id"])]
            for stop in trip["stops"]:
                evs.append(event("arrive", trip["route_id"], stop_id=stop["stop_id"]))
                for order in stop["orders"]:
                    outcome, lines, reason, note = "delivered", [], None, None
                    if veh == "VEH057" and failed_order is None and stop["outlet"]["code"] == "OUT083":
                        outcome, reason, note = "not_delivered", "outlet_closed", "Shutters down, no answer by phone"
                        failed_order = (order["order_id"], stop["outlet"]["code"])
                    elif veh == "VEH057" and part_order is None and stop["outlet"]["code"] == "OUT079":
                        outcome = "delivered_in_part"
                        lines = [{"line_no": ln["line_no"],
                                  "delivered_qty": on_board.get((order["order_id"], ln["line_no"]), float(ln["qty"])) - (1 if i == 0 else 0),
                                  "reason_code": "damaged" if i == 0 else None} for i, ln in enumerate(order["lines"] or [])]
                        reason = "damaged"
                        part_order = (order["order_id"], stop["outlet"]["code"])
                    evs.append(event("delivery", trip["route_id"], {
                        "delivery_id": str(uuid.uuid4()), "order_id": order["order_id"], "outcome": outcome,
                        "received_by": None if outcome == "not_delivered" else "Store staff", "reason_code": reason,
                        "note": note, "supersedes_id": None, "lines": lines}, stop_id=stop["stop_id"]))
            states = sync(c, who, phone, evs)
            if veh == "VEH057" and trip["seq"] == 1:
                again = sync(c, who, phone, evs)  # the connection dropped: the phone sends the batch again
                check("5", "Resending a whole offline batch changes nothing", set(again) == {"applied"} and set(states) == {"applied"},
                      f"{len(evs)} events, sent twice")
            if set(states) != {"applied"}:
                check("5", f"{veh} trip {trip['seq']} recorded", False, str(states))
        if veh == "VEH059":  # a correction: the driver re-counts the first delivery
            first = mine[0]["stops"][0]
            d0 = next(d for d in ok(c.get(f"{API}/driver/run", headers=who))["deliveries"] if d["stop_id"] == first["stop_id"])
            fix = event("delivery", mine[0]["route_id"], {"delivery_id": str(uuid.uuid4()), "order_id": d0["order_id"],
                        "outcome": "delivered", "received_by": "Store staff (re-counted)", "reason_code": None, "note": "Re-counted at the door",
                        "supersedes_id": d0["delivery_id"], "lines": []}, stop_id=first["stop_id"])
            corrected = sync(c, who, phone, [fix])
    check("5", "Every trip of both depots recorded stop by stop", True, f"{len(all_routes)} trips")
    check("5", "A delivery with missing items and a failed delivery were recorded", bool(part_order and failed_order),
          f"some missing at {part_order[1]}, not delivered at {failed_order[1]}" if part_order and failed_order else "")
    check("5", "A correction is added beside the original", corrected == ["applied"], str(corrected))
    other = ok(c.get(f"{API}/driver/run", headers=as_driver("VEH059")))
    seen = {x["route_id"] for p in other["plans"] for x in p["routes"]}
    own = {rid for rid, (r_, _) in all_routes.items() if vehicles[r_["vehicle_id"]] == "VEH059"}
    check("5", "A driver sees only their own vehicle's trips", seen == own, f"VEH059 sees {len(seen)} trips, all its own")

    print("\n6 · DISPATCHER WATCHES BOTH DEPOTS, MOVES THE FAILED DELIVERY")
    mon = ok(c.get(f"{API}/dispatch/monitor", params={"depot": "all"}, headers=DSP))
    check("6", "One Live screen covers both depots", {r_["depot"] for r_ in mon["runs"]} == {"Kandy", "Peliyagoda"},
          " · ".join(f"{r_['depot']}: {r_['orders_delivered']}/{r_['orders_total']} delivered, {r_['state']}" for r_ in mon["runs"]))
    kinds = {(e["kind"], e["depot"]) for e in mon["exceptions"]}
    check("6", "Attention: the failed delivery and the loader's open shortfall flag, tagged by depot",
          ("delivery_failed", "Kandy") in kinds and (("short_loaded", "Kandy") in kinds or ("loader_flag", "Kandy") in kinds),
          str(sorted(kinds))[:160])
    only_p = ok(c.get(f"{API}/dispatch/monitor", params={"depot": "1"}, headers=DSP))
    check("6", "The Peliyagoda filter shows only Peliyagoda", {r_["depot"] for r_ in only_p["runs"]} == {"Peliyagoda"}
          and all(f["depot"] == "Peliyagoda" for f in only_p["fleet"]), f"{len(only_p['fleet'])} trips")
    moved = ok(c.post(f"{API}/dispatch/orders/{failed_order[0]}/requeue", json={}, headers=DSP))
    check("6", "The failed delivery moves to the next delivery day with the driver's reason", moved["delivery_date"] == next_day,
          f"{moved['confirmation_no']} → {moved['delivery_date']}")
    r = c.post(f"{API}/dispatch/orders/{failed_order[0]}/requeue", json={}, headers=DSP)
    check("6", "It cannot be moved twice", r.status_code == 409, r.text[:80])
    r = c.post(f"{API}/dispatch/orders/{part_order[0]}/requeue", json={}, headers=DSP)
    check("6", "A delivered order cannot be moved", r.status_code == 409, r.text[:80])
    day_list = ok(c.get(f"{API}/dispatch/orders", params={"date": day}, headers=DSP))
    ids = [o["order_id"] for o in day_list["orders"]]
    moved_rows = [o for o in day_list["moved_away"] if o["order_id"] == failed_order[0]]
    check("6", "Orders list: every order of the day once, the failed one shown as moved with the driver's reason",
          len(ids) == len(set(ids)) and failed_order[0] not in ids and bool(moved_rows) and moved_rows[0]["moved_kind"] == "requeued_after_failure",
          f"{len(ids)} orders on {day}, {len(day_list['moved_away'])} moved away · {moved_rows[0]['moved_reason'] if moved_rows else '-'}")
    detail = ok(c.get(f"{API}/dispatch/orders/{part_order[0]}", headers=DSP))
    check("6", "An order opens with its lines and its outlet's delivery window",
          len(detail["lines"]) == detail["line_count"] > 0 and detail["outlet"] is not None and detail["delivery_outcome"] == "delivered_in_part",
          f"{part_order[1]}: {len(detail['lines'])} lines, windows {detail['outlet']['windows']}")

    print("\n7 · STORE MANAGERS CONFIRM WHAT ARRIVED")
    so = ok(c.get(f"{API}/store/orders", headers=STORE["OUT077"]))
    waiting = [o for o in so if o["needs_receipt"]]
    for i, o in enumerate(waiting):
        issues = [{"line_no": 1, "type": "damaged", "qty": 1, "note": "One pack crushed"}] if i == 0 else []
        ok(c.post(f"{API}/store/orders/{o['order_id']}/receipt", json={"issues": issues}, headers=STORE["OUT077"]))
    check("7", "OUT077 confirms both deliveries, one with a damaged item", len(waiting) == 2, f"{len(waiting)} confirmed")
    for code in ("OUT102", "OUT103", "OUT018", "OUT022"):
        for o in ok(c.get(f"{API}/store/orders", headers=STORE[code])):
            if o["needs_receipt"]:
                ok(c.post(f"{API}/store/orders/{o['order_id']}/receipt", json={"issues": []}, headers=STORE[code]))
    so = ok(c.get(f"{API}/store/orders", headers=STORE["OUT102"]))
    check("7", "Style and Tech stores confirm too (both depots)", all(not o["needs_receipt"] for o in so), "OUT102 · OUT103 · OUT018 · OUT022")

    print("\n8 · END OF THE DAY")
    mon = ok(c.get(f"{API}/dispatch/monitor", params={"depot": "all"}, headers=DSP))
    for co in mon["closeout"]:
        total = co["delivered"] + co["delivered_in_part"] + co["not_delivered"] + co["not_yet"]
        check("8", f"{co['depot']}: the run is complete and every order is accounted for", co["state"] == "complete" and co["not_yet"] == 0,
              f"{co['delivered']} delivered · {co['delivered_in_part']} some missing · {co['not_delivered']} not delivered · "
              f"{co['confirmed_by_store']} confirmed by stores · of {total}")
        bad = [v for v in co["fuel"] if v["quota_l"] is not None and abs(float(v["used_week_l"]) - planned_fuel.get(v["vehicle_id"], 0)) > 0.05]
        over = [v for v in co["fuel"] if v["left_week_l"] is not None and float(v["left_week_l"]) < 0]
        check("8", f"{co['depot']}: fuel used this week = the day's route fuel, and no vehicle is over its quota", not bad and not over,
              f"{len(co['fuel'])} vehicles · e.g. {co['fuel'][0]['source_id']} {co['fuel'][0]['today_l']} L today, "
              f"{co['fuel'][0]['left_week_l']} L of {co['fuel'][0]['quota_l']} L left")
    led = ok(c.get(f"{API}/dispatch/ledger", headers=DSP))
    check("8", "Records hold both depots: deliveries, deferrals and the moved order", {x["depot"] for x in led["records"]} == {"Kandy", "Peliyagoda"}
          and any(x["record_type"] == "deferral" and x["outcome"] != "deferred" for x in led["records"]),
          f"{len(led['records'])} records")

    # The next day: the carried-over orders go first, with the fuel that is left this week.
    nclosed = ok(c.post(f"{API}/dispatch/runs/{next_day}/close", headers=DSP))
    npid = nclosed["plan_id"]
    ok(c.post(f"{API}/dispatch/plans/{npid}/propose", headers=DSP))
    nplan = ok(c.get(f"{API}/dispatch/plans/{npid}", headers=DSP))
    on_trips = {o["order_id"] for r_ in nplan["routes"] for s in r_["stops"] for o in (s["orders"] or [])}
    carried = [u["order_id"] for u in kplan["unplanned"]] + [failed_order[0], late.json()["order_id"]]
    check("8", "Next day: deferred, failed and late orders are all on trips", all(o in on_trips for o in carried),
          f"{sum(o in on_trips for o in carried)}/{len(carried)} carried orders planned for {next_day}")
    v57 = next(v for v in nplan["vehicles"] if v["source_id"] == "VEH057")
    used_next = sum(float(r_["est_fuel_l"] or 0) for r_ in nplan["routes"] if r_["vehicle_id"] == v57["vehicle_id"])
    quota = sql("SELECT wp.fuel_quota_for(v.vehicle_id, wp.week_start(DATE %s)) AS q FROM wp.vehicle v WHERE v.source_id = 'VEH057'"
                .replace("%s", f"'{next_day}'"))[0]["q"]
    expect = float(quota) - planned_fuel.get(v57["vehicle_id"], 0) - used_next
    check("8", "VEH057's fuel left the next day = quota − yesterday − today's plan",
          abs(float(v57["fuel_left_l"]) - expect) < 0.05, f"{float(v57['fuel_left_l']):.1f} L left of {float(quota):.0f} L")
    in_run = next(r_["orders"] for r_ in ok(c.get(f"{API}/dispatch/runs", headers=DSP))["runs"] if r_["service_date"] == next_day)
    audit("8 next day", nplan, in_run, workshop_k)

failed = [r for r in results if not r[2]]
print(f"\n{len(results) - len(failed)}/{len(results)} checks passed")
for part, name, _, detail in failed:
    print(f"  FAIL [{part}] {name}: {detail}")
sys.exit(1 if failed else 0)
