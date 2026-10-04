"""End-to-end judge walkthrough through the HTTP API, all four roles.

Run against a database loaded with db/load.sh (it calls /demo/reset first, so all app data is replaced):

    ENVIRONMENT=development AUTH_DEV_BYPASS=true ALLOWED_HOSTS='["testserver"]' \
    DATABASE_URL=postgresql://waypoint:waypoint@localhost:5433/waypoint?sslmode=disable \
    uv run python tests/walkthrough.py
"""
import uuid
from datetime import datetime, timezone

from fastapi.testclient import TestClient

from app.main import app


def as_(email):
    return {"X-Dev-User": email}


SM, DSP, LDR, DRV = (as_("store.out077@waypoint.demo"), as_("dispatcher@waypoint.demo"),
                     as_("loader.kandy@waypoint.demo"), as_("driver.veh057@waypoint.demo"))
def now():
    return datetime.now(timezone.utc).isoformat()


def ok(r, code=200):
    assert r.status_code == code, f"{r.request.method} {r.request.url} -> {r.status_code} {r.text[:500]}"
    return r.json() if r.content else None


with TestClient(app) as c:
    print("1 reset:", ok(c.post("/api/v1/demo/reset", headers=DSP)))

    # Store manager places OUT077's dry order
    me = ok(c.get("/api/v1/me", headers=SM))
    print("2 me:", me["name"], me["outlet_code"])
    prods = ok(c.get("/api/v1/store/products", params={"temp": "ambient"}, headers=SM))
    slot = ok(c.get("/api/v1/store/order-slot", params={"temp": "ambient"}, headers=SM))
    print("  slot:", slot["delivery_date"], slot["cutoff_at"])
    rid = str(uuid.uuid4())
    body = {"client_request_id": rid, "temp": "ambient", "lines": [{"product_id": prods[0]["product_id"], "qty": 28}]}
    o1 = ok(c.post("/api/v1/store/orders", json=body, headers=SM), 201)
    o2 = ok(c.post("/api/v1/store/orders", json=body, headers=SM), 201)  # retry = same order
    print("  placed:", o1["confirmation_no"], o1["delivery_date"], "retry same:", o1["order_id"] == o2["order_id"])
    r = c.post("/api/v1/store/orders", json={**body, "client_request_id": str(uuid.uuid4())}, headers=SM)
    print("  duplicate dry order refused:", r.status_code, r.json()["detail"])
    assert c.get("/api/v1/dispatch/runs", headers=SM).status_code == 403

    # Dispatcher closes orders, engine proposes, release
    runs = ok(c.get("/api/v1/dispatch/runs", headers=DSP))
    day = runs["next_open_date"]
    closed = ok(c.post(f"/api/v1/dispatch/runs/{day}/close", headers=DSP))
    print("3 closed:", closed)
    pid = closed["plan_id"]
    prop = ok(c.post(f"/api/v1/dispatch/plans/{pid}/propose", headers=DSP))
    print("  engine:", prop["trips"], "trips,", prop["orders_planned"], "orders; deferred:", prop["orders_deferred"])
    print("  violations:", [(v["code"], v["message"]) for v in prop["violations"]])
    plan = ok(c.get(f"/api/v1/dispatch/plans/{pid}", headers=DSP))
    for rt in plan["routes"]:
        if rt["vehicle_code"].startswith(("RV", "AV")):
            print(f"   {rt['vehicle_code']} T{rt['route_seq']} {rt['brand_code']} {rt['district_name']} {rt['trip_minutes']}min "
                  f"{round(rt['weight_kg'])}kg dep {rt['depart_at'][11:16]}Z:",
                  " -> ".join(f"{s['outlet_code']}@{s['planned_arrival'][11:16]}" for s in rt["stops"]))
    # Manual move that breaks a rule: van-only outlet onto a truck
    truck = next(v for v in plan["vehicles"] if not v["is_van"] and v["carries_chilled"])
    oo77 = next(o for rt in plan["routes"] for s in rt["stops"] for o in s["orders"] if s["outlet_code"] == "OUT077" and o["temp"] == "chilled")
    r = c.post(f"/api/v1/dispatch/plans/{pid}/move", json={"order_id": oo77["order_id"], "vehicle_id": truck["vehicle_id"], "seq": 2}, headers=DSP)
    print("  move van-only to truck:", r.status_code, r.json()["detail"])
    rel = ok(c.post(f"/api/v1/dispatch/plans/{pid}/release", headers=DSP))
    print("  released:", rel)

    # OUT078's manager sees the deferral notice
    n78 = ok(c.get("/api/v1/store/notices", headers=as_("store.out078@waypoint.demo")))
    print("4 OUT078 notices:", [n["title"] + " | " + n["body"] for n in n78 if n["kind"] == "deferred"])

    # Loader loads VEH057's trip with OUT077, short 2 crates on OUT079
    routes = ok(c.get("/api/v1/loader/routes", headers=LDR))["routes"]
    print("5 loader sees", len(routes), "trips")
    rt = next(r for r in plan["routes"] if any(s["outlet_code"] == "OUT077" for s in r["stops"]) and r["vehicle_code"].startswith("RV"))
    ll = ok(c.get(f"/api/v1/loader/routes/{rt['route_id']}", headers=LDR))
    print("  load order:", [(x["load_order"], x["outlet_name"].split()[-1]) for x in ll["lines"]])
    dev_l = str(uuid.uuid4())
    lines, flag_id = [], str(uuid.uuid4())
    short_line = None
    for line in ll["lines"]:
        qty = float(line["ordered_qty"])
        if line["outlet_name"].endswith("OUT079") and short_line is None:
            qty -= 2
            short_line = line
        lines.append({"confirmation_id": str(uuid.uuid4()), "order_id": line["order_id"], "line_no": line["line_no"], "qty_loaded": qty})
    events = [
        {"event_id": str(uuid.uuid4()), "type": "load_confirm", "route_id": rt["route_id"], "payload": {"lines": lines}, "device_time": now()},
        {"event_id": str(uuid.uuid4()), "type": "flag", "route_id": rt["route_id"], "device_time": now(),
         "payload": {"flag_id": flag_id, "type": "short", "order_id": short_line["order_id"], "line_no": short_line["line_no"], "qty": 2, "note": "Milk out of stock"}},
        {"event_id": str(uuid.uuid4()), "type": "route_release", "route_id": rt["route_id"], "payload": {"release_id": str(uuid.uuid4())}, "device_time": now()},
    ]
    res = ok(c.post("/api/v1/sync", json={"device_id": dev_l, "client_now": now(), "events": events}, headers=LDR))
    print("  loader sync:", [(x["state"], x["reject_reason"]) for x in res["results"]])
    ok(c.post(f"/api/v1/dispatch/flags/{flag_id}/reply", json={"type": "proceed_short", "text": "Send partial"}, headers=DSP))
    print("  dispatcher replied 'Send partial'")

    # Driver: depart, arrive OUT077, deliver (event sent twice = offline retry), photo
    run = ok(c.get("/api/v1/driver/run", headers=DRV))
    my = [r for p in run["plans"] for r in p["routes"]]
    print("6 driver trips:", [(r["vehicle_code"], r["seq"], [s["outlet"]["code"] for s in r["stops"]]) for r in my])
    trip = next(r for r in my if r["route_id"] == rt["route_id"])
    stop = next(s for s in trip["stops"] if s["outlet"]["code"] == "OUT077")
    order = stop["orders"][0]
    dev_d, delivery_id = str(uuid.uuid4()), str(uuid.uuid4())
    evs = [
        {"event_id": str(uuid.uuid4()), "type": "depart", "route_id": trip["route_id"], "device_time": now()},
        {"event_id": str(uuid.uuid4()), "type": "arrive", "route_id": trip["route_id"], "stop_id": stop["stop_id"], "device_time": now()},
        {"event_id": str(uuid.uuid4()), "type": "delivery", "route_id": trip["route_id"], "stop_id": stop["stop_id"], "device_time": now(),
         "payload": {"delivery_id": delivery_id, "order_id": order["order_id"], "outcome": "delivered", "received_by": "Fathima"}},
    ]
    r1 = ok(c.post("/api/v1/sync", json={"device_id": dev_d, "client_now": now(), "events": evs}, headers=DRV))
    r2 = ok(c.post("/api/v1/sync", json={"device_id": dev_d, "client_now": now(), "events": evs}, headers=DRV))
    print("  driver sync:", [x["state"] for x in r1["results"]], "| resend:", [x["state"] for x in r2["results"]])
    att = ok(c.post("/api/v1/attachments", headers=DRV, files={"file": ("pod.jpg", b"\xff\xd8fakejpeg", "image/jpeg")},
                    data={"kind": "photo", "delivery_id": delivery_id}), 201)
    link = ok(c.get(f"/api/v1/attachments/{att['attachment_id']}", headers=SM))["url"]
    print("  photo:", att["attachment_id"], "signed link serves:", c.get(link).status_code,
          "| tampered link:", c.get(link[:-4] + "0000").status_code)

    # Store manager confirms receipt with one damaged crate
    orders = ok(c.get("/api/v1/store/orders", headers=SM))
    delivered = next(o for o in orders if o["order_id"] == order["order_id"])
    print("7 store sees:", delivered["status"], delivered["needs_receipt"])
    rc = ok(c.post(f"/api/v1/store/orders/{order['order_id']}/receipt",
                   json={"issues": [{"line_no": 1, "type": "damaged", "qty": 1, "note": "1 crate damaged"}]}, headers=SM))
    print("  receipt:", rc)

    mon = ok(c.get("/api/v1/dispatch/monitor", headers=DSP))
    print("8 monitor exceptions:", [(e["kind"], e["detail"]) for e in mon["exceptions"]][:5])
    led = ok(c.get("/api/v1/dispatch/ledger", headers=DSP))
    print("  ledger:", [(x["record_type"], x["outlet_name"], x["outcome"], x["reason"]) for x in led["records"]][:4])
    print("ALL STEPS PASSED")
