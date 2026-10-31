"""Security audit: every protection, attacked through the API and straight at the database.

  Part A  The API's database role: not the owner, append-only tables stay append-only, row-level security.
  Part B  Attachments: real images only, only on your own delivery / flag / issue, never replaced, safe to view.
  Part C  Sign-in tokens: forged, unsigned, expired and incomplete tokens are refused.
  Part D  Sign-in: field limits and the per-account throttle against password guessing.
  Part E  Depots: a dispatcher cannot change another depot's trips or plans.
  Part F  Response headers and request limits.

It wipes all app data (demo reset). Run it against a local or throwaway database, with the API as the
restricted role and the owner for set-up:

    ENVIRONMENT=development AUTH_DEV_BYPASS=true AUTH_MODE=local LOCAL_AUTH_SECRET=<32+ chars> \
    ALLOWED_HOSTS='["testserver"]' PUBLIC_API_URL=http://testserver \
    DATABASE_URL=postgresql://waypoint_api:waypoint-api-local@localhost:5433/waypoint?sslmode=disable \
    ADMIN_DATABASE_URL=postgresql://waypoint:waypoint@localhost:5433/waypoint?sslmode=disable \
    uv run python tests/security_audit.py
"""
import asyncio
import base64
import json
import os
import sys
import uuid
from datetime import UTC, datetime, timedelta

import asyncpg
import jwt
from booklet_audit import check, ok, results, sql
from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import app
from app.security.rate_limit import limiter

SETTINGS = get_settings()
DSP = {"X-Dev-User": "dispatcher@example.com"}
LDR = {"X-Dev-User": "loader.kandy@example.com"}
DRV = {"X-Dev-User": "driver.veh057@example.com"}
DRV_OTHER = {"X-Dev-User": "driver.veh059@example.com"}
SM = {"X-Dev-User": "store.out077@example.com"}
SM_OTHER = {"X-Dev-User": "store.out078@example.com"}
JPEG = b"\xff\xd8\xff\xe0" + b"proof-photo" * 20
PNG = b"\x89PNG\r\n\x1a\n" + b"signature" * 20


def now() -> str:
    return datetime.now(UTC).isoformat()


def event(kind: str, route_id: int, **extra) -> dict:
    return {"event_id": str(uuid.uuid4()), "type": kind, "route_id": route_id, "device_time": now(), **extra}


def app_sql(query: str, *args, user_id: int | None = None):
    """Run SQL as the API's own database login (DATABASE_URL), optionally as a signed-in user."""
    async def run():
        conn = await asyncpg.connect(os.environ["DATABASE_URL"].split("?")[0])
        try:
            async with conn.transaction():
                await conn.execute("SELECT set_config('search_path', 'wp, public', true), "
                                   "set_config('wp.user_id', $1, true)", "" if user_id is None else str(user_id))
                return await conn.fetch(query, *args)
        finally:
            await conn.close()
    return asyncio.run(run())


def refused(query: str, *args, user_id: int | None = None) -> str:
    """The database's error for a statement that must fail, or "" if it ran."""
    try:
        app_sql(query, *args, user_id=user_id)
        return ""
    except asyncpg.PostgresError as exc:
        return f"{type(exc).__name__}: {str(exc).splitlines()[0][:90]}"


def token(claims: dict, key: str | None = None, alg: str = "HS256") -> str:
    return jwt.encode(claims, key or SETTINGS.LOCAL_AUTH_SECRET.get_secret_value(), algorithm=alg)


def unsigned(claims: dict) -> str:
    part = lambda d: base64.urlsafe_b64encode(json.dumps(d, default=str).encode()).rstrip(b"=").decode()
    return f"{part({'alg': 'none', 'typ': 'JWT'})}.{part(claims)}."


with TestClient(app) as c:
    # ------------------------------------------------------------------ set-up: one delivery day
    reset = ok(c.post("/api/v1/demo/reset", headers=DSP))
    kday = ok(c.get("/api/v1/dispatch/runs", headers=DSP))["next_open_date"]
    kplan_id = ok(c.post(f"/api/v1/dispatch/runs/{kday}/close", headers=DSP))["plan_id"]
    ok(c.post(f"/api/v1/dispatch/plans/{kplan_id}/propose", headers=DSP))
    kplan = ok(c.get(f"/api/v1/dispatch/plans/{kplan_id}", headers=DSP))
    ok(c.post(f"/api/v1/dispatch/plans/{kplan_id}/release", headers=DSP))
    rt = next(r for r in kplan["routes"] if any(s["outlet_code"] == "OUT077" for s in r["stops"])
              and r["vehicle_code"].startswith("RV"))
    lines = ok(c.get(f"/api/v1/loader/routes/{rt['route_id']}", headers=LDR))["lines"]
    flag_id = str(uuid.uuid4())
    loads = [{"confirmation_id": str(uuid.uuid4()), "order_id": x["order_id"], "line_no": x["line_no"],
              "qty_loaded": float(x["ordered_qty"])} for x in lines]
    ok(c.post("/api/v1/sync", headers=LDR, json={"device_id": str(uuid.uuid4()), "client_now": now(), "events": [
        event("load_confirm", rt["route_id"], payload={"lines": loads}),
        event("flag", rt["route_id"], payload={"flag_id": flag_id, "type": "damaged", "order_id": lines[0]["order_id"],
                                               "line_no": lines[0]["line_no"], "qty": 1, "note": "Crushed box"}),
        event("route_release", rt["route_id"], payload={"release_id": str(uuid.uuid4())})]}))
    trip = next(r for p in ok(c.get("/api/v1/driver/run", headers=DRV))["plans"] for r in p["routes"]
                if r["route_id"] == rt["route_id"])
    stop = next(s for s in trip["stops"] if s["outlet"]["code"] == "OUT077")
    order_id, delivery_id = stop["orders"][0]["order_id"], str(uuid.uuid4())
    ok(c.post("/api/v1/sync", headers=DRV, json={"device_id": str(uuid.uuid4()), "client_now": now(), "events": [
        event("depart", rt["route_id"]), event("arrive", rt["route_id"], stop_id=stop["stop_id"]),
        event("delivery", rt["route_id"], stop_id=stop["stop_id"], payload={
            "delivery_id": delivery_id, "order_id": order_id, "outcome": "delivered", "received_by": "Fathima"})]}))
    receipt = ok(c.post(f"/api/v1/store/orders/{order_id}/receipt", headers=SM,
                        json={"issues": [{"line_no": 1, "type": "damaged", "qty": 1, "note": "Dented tin"}]}))
    issue_id = receipt["issues"][0]["issue_id"] if receipt["issues"] else None
    check("setup", "Delivery day set up: delivery, loader flag and store issue exist", bool(issue_id),
          f"delivery {delivery_id[:8]}, flag {flag_id[:8]}, issue {(issue_id or '-')[:8]}")

    users = {r["email"]: r["user_id"] for r in sql("SELECT email, user_id FROM wp.app_user")}

    # ------------------------------------------------------------------ Part A: the database role
    print("\nPART A - the API's database role")
    role = app_sql("""SELECT current_user AS role, r.rolsuper AS superuser,
                             pg_has_role(current_user, (SELECT nspowner FROM pg_namespace WHERE nspname = 'wp'), 'USAGE') AS owner
                      FROM pg_roles r WHERE r.rolname = current_user""")[0]
    restricted = not role["superuser"] and not role["owner"]
    check("A", "The API connects as a restricted role, not the owner", restricted, f"connected as {role['role']}")
    if restricted:
        for name, stmt in [("UPDATE a delivery (append-only)", "UPDATE wp.delivery SET received_by = 'someone else'"),
                           ("DELETE an audit record", "DELETE FROM wp.audit_log"),
                           ("TRUNCATE the audit log", "TRUNCATE wp.audit_log"),
                           ("DELETE a trip", "DELETE FROM wp.route"),
                           ("UPDATE a proof file record", "UPDATE wp.attachment SET storage_key = 'x'"),
                           ("Change the schema", "CREATE TABLE wp.intruder (x int)")]:
            err = refused(stmt, user_id=users["dispatcher@example.com"])
            check("A", f"Refused at the database: {name}", bool(err), err or "IT RAN")
        err = refused("SELECT wp.demo_reset()")
        check("A", "Refused: wiping the data as the API role with no signed-in user", "WP010" in err, err or "IT RAN")
        err = refused("SELECT wp.demo_reset()", user_id=users["store.out077@example.com"])
        check("A", "Refused: wiping the data as a store manager", "WP010" in err, err or "IT RAN")
        nobody = app_sql("SELECT count(*) AS n FROM wp.order_header")[0]["n"]
        check("A", "With no signed-in user, row-level security shows no orders", nobody == 0, f"{nobody} visible")
        mine = app_sql("SELECT count(DISTINCT outlet_id) AS n, min(outlet_id) AS o FROM wp.order_header",
                       user_id=users["store.out077@example.com"])[0]
        own = sql("SELECT outlet_id FROM wp.app_user WHERE email = 'store.out077@example.com'")[0]["outlet_id"]
        check("A", "A store manager's session sees only their own outlet's orders", mine["n"] == 1 and mine["o"] == own,
              f"{mine['n']} outlet(s) visible")
        err = refused("INSERT INTO wp.route(plan_id, depot_id, brand_id, district_id, vehicle_id, seq, depart_at, return_at) "
                      "SELECT plan_id, depot_id, 1, 1, 1, 1, now(), now() + interval '1 minute' FROM wp.plan LIMIT 1",
                      user_id=users["driver.veh057@example.com"])
        check("A", "Refused: a driver creating a trip directly in the database", bool(err), err or "IT RAN")

    # ------------------------------------------------------------------ Part B: attachments
    print("\nPART B - attachments")
    up = lambda who, data, ctype="image/jpeg", **form: c.post(
        "/api/v1/attachments", headers=who, files={"file": ("f", data, ctype)}, data={"kind": "photo", **form})
    r = up(DRV, b"<html><script>alert(1)</script></html>", delivery_id=delivery_id)
    check("B", "An HTML page disguised as a JPEG is refused", r.status_code == 415, f"{r.status_code}")
    r = up(DRV, b"<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>", "image/svg+xml",
           delivery_id=delivery_id)
    check("B", "An SVG (can carry script) is refused", r.status_code == 415, f"{r.status_code}")
    r = up(DRV, JPEG)
    check("B", "A file attached to nothing is refused", r.status_code == 422, f"{r.status_code}")
    r = up(DRV, JPEG, delivery_id=delivery_id, flag_id=flag_id)
    check("B", "A file attached to two records is refused", r.status_code == 422, f"{r.status_code}")
    r = up(DRV_OTHER, JPEG, delivery_id=delivery_id)
    check("B", "Another driver cannot add proof to this driver's delivery", r.status_code == 404, f"{r.status_code}")
    r = up(SM_OTHER, JPEG, issue_id=issue_id)
    check("B", "Another store cannot add a photo to this store's issue", r.status_code == 404, f"{r.status_code}")
    r = up(DRV, JPEG, flag_id=flag_id)
    check("B", "A driver cannot add a photo to a loader's flag", r.status_code == 404, f"{r.status_code}")
    r = c.post("/api/v1/attachments", headers=DRV, files={"file": ("s.png", PNG, "image/png")},
               data={"kind": "signature", "issue_id": issue_id})
    check("B", "A signature on anything but a delivery is refused", r.status_code == 422, f"{r.status_code}")

    photo = ok(up(DRV, JPEG, delivery_id=delivery_id), 201)
    again = up(DRV, JPEG, delivery_id=delivery_id, attachment_id=photo["attachment_id"])
    check("B", "Resending the same photo (dropped connection) is accepted once", again.status_code == 201
          and again.json()["attachment_id"] == photo["attachment_id"], f"{again.status_code}")
    r = up(DRV, JPEG + b"edited", delivery_id=delivery_id, attachment_id=photo["attachment_id"])
    check("B", "The same uploader cannot replace a stored proof photo with another file", r.status_code == 409,
          f"{r.status_code}")
    r = up(SM, JPEG, issue_id=issue_id, attachment_id=photo["attachment_id"])
    check("B", "Someone else cannot overwrite a stored proof photo by reusing its id", r.status_code == 409,
          f"{r.status_code}")
    stored = sql("SELECT content_type, uploaded_by FROM wp.attachment WHERE attachment_id = $1::uuid", photo["attachment_id"])[0]
    check("B", "The stored type comes from the file's bytes, not the browser's claim",
          stored["content_type"] == "image/jpeg", stored["content_type"])
    r = c.get(f"/api/v1/attachments/{photo['attachment_id']}", headers=SM_OTHER)
    check("B", "Another store cannot get a link to this store's proof photo", r.status_code == 404, f"{r.status_code}")
    link = ok(c.get(f"/api/v1/attachments/{photo['attachment_id']}", headers=SM))["url"]
    check("B", "The receiving store can get a link to its proof photo", bool(link))
    raw = c.get(link)
    h = raw.headers
    check("B", "The photo is served as an image, sandboxed, never sniffed or framed",
          raw.status_code == 200 and h.get("content-type") == "image/jpeg" and "sandbox" in h.get("content-security-policy", "")
          and h.get("x-content-type-options") == "nosniff", f"{raw.status_code} {h.get('content-type')} csp={h.get('content-security-policy')}")
    r = c.get(link.replace("signature=", "signature=0"))
    check("B", "A tampered photo link is refused", r.status_code == 403, f"{r.status_code}")

    # ------------------------------------------------------------------ Part C: tokens
    print("\nPART C - sign-in tokens (local mode)")
    if SETTINGS.AUTH_MODE != "local":
        check("C", "Token checks need AUTH_MODE=local", False, f"AUTH_MODE={SETTINGS.AUTH_MODE}")
    else:
        uid = str(users["dispatcher@example.com"])
        base = {"sub": uid, "role": "dispatcher", "iss": "waypoint-local", "aud": "waypoint", "iat": datetime.now(UTC),
                "exp": datetime.now(UTC) + timedelta(hours=1)}
        me = lambda t: c.get("/api/v1/me", headers={"Authorization": f"Bearer {t}"}).status_code
        check("C", "A correctly signed token works", me(token(base)) == 200, f"{me(token(base))}")
        cases = [("signed with another key", token(base, key="x" * 40)),
                 ("unsigned (alg none)", unsigned(base)),
                 ("expired", token({**base, "exp": datetime.now(UTC) - timedelta(minutes=1)})),
                 ("without an expiry", token({k: v for k, v in base.items() if k != "exp"})),
                 ("for another audience", token({**base, "aud": "someone-else"})),
                 ("from another issuer", token({**base, "iss": "attacker"})),
                 ("for a user that does not exist", token({**base, "sub": "999999"})),
                 ("garbage", "not.a.token")]
        for name, t in cases:
            code = me(t)
            check("C", f"Refused: a token {name}", code in (401, 403), f"{code}")
        code = c.get("/api/v1/me").status_code
        check("C", "Refused: no token at all", code == 401, f"{code}")

    # ------------------------------------------------------------------ Part D: sign-in
    print("\nPART D - sign-in")
    if SETTINGS.AUTH_MODE == "local":
        limiter.enabled = False  # isolate the per-account throttle from the per-address limit
        login = lambda email, pw: c.post("/api/v1/auth/login", json={"email": email, "password": pw})
        code = login("loader.kandy@example.com", "x" * 129).status_code
        check("D", "A password over 128 characters is refused before any work", code == 422, f"{code}")
        good = login("driver.veh059@example.com", "waypoint-demo").status_code
        check("D", "The right password signs in", good == 200, f"{good}")
        codes = [login("loader.kandy@example.com", f"wrong-{i}").status_code for i in range(10)]
        locked = login("loader.kandy@example.com", "waypoint-demo")
        check("D", "After 10 wrong passwords the account waits, even for the right password",
              codes == [401] * 10 and locked.status_code == 429 and locked.headers.get("retry-after"),
              f"{codes[-1]} then {locked.status_code} retry-after {locked.headers.get('retry-after')}")
        other = login("store.out078@example.com", "waypoint-demo").status_code
        check("D", "Other accounts are not affected", other == 200, f"{other}")
        case = login("LOADER.KANDY@example.com ", "waypoint-demo").status_code
        check("D", "The throttle cannot be dodged by changing case or adding spaces", case == 429, f"{case}")
        limiter.enabled = True
        msgs = [login("nobody@example.com", "x").json().get("detail") for _ in range(1)]
        check("D", "A wrong email and a wrong password get the same answer", msgs == ["Email or password is wrong"], str(msgs))

    # ------------------------------------------------------------------ Part E: depots
    print("\nPART E - depots")
    ok(c.post("/api/v1/dispatch/depot", json={"depot_id": 1}, headers=DSP))  # planning office: Peliyagoda for a moment
    pday = reset["peliyagoda"]["service_date"]
    pplan_id = ok(c.post(f"/api/v1/dispatch/runs/{pday}/close", headers=DSP))["plan_id"]
    ok(c.post(f"/api/v1/dispatch/plans/{pplan_id}/propose", headers=DSP))
    pplan = ok(c.get(f"/api/v1/dispatch/plans/{pplan_id}", headers=DSP))
    p_route = pplan["routes"][0]
    p_order = p_route["stops"][0]["orders"][0]["order_id"]
    ok(c.post("/api/v1/dispatch/depot", json={"depot_id": 2}, headers=DSP))  # back to Kandy
    r = c.patch(f"/api/v1/dispatch/routes/{p_route['route_id']}", json={"depart_at": now()}, headers=DSP)
    check("E", "Working on Kandy, a dispatcher cannot change a Peliyagoda trip's departure", r.status_code == 404,
          f"{r.status_code}")
    r = c.patch(f"/api/v1/dispatch/routes/{rt['route_id']}", json={"depart_at": now()}, headers=DSP)  # on the road now
    check("E", "Nor change the departure of a trip that is already on the road", r.status_code in (404, 409),
          f"{r.status_code}")
    vehicle = next(v for v in kplan["vehicles"] if v["active"])
    r = c.post(f"/api/v1/dispatch/plans/{kplan_id}/move", json={"order_id": p_order, "vehicle_id": vehicle["vehicle_id"],
                                                                  "seq": 2}, headers=DSP)
    check("E", "A Peliyagoda order cannot be moved onto a Kandy plan", r.status_code == 404, f"{r.status_code}")
    r = c.get(f"/api/v1/dispatch/plans/{pplan_id}", headers=DSP)
    check("E", "A Peliyagoda plan does not open while working on Kandy", r.status_code == 404, f"{r.status_code}")
    r = c.post(f"/api/v1/dispatch/plans/{pplan_id}/propose", headers=DSP)
    check("E", "Nor can its plan be rebuilt", r.status_code == 404, f"{r.status_code}")
    r = c.get("/api/v1/dispatch/runs", headers=SM)
    check("E", "A store manager cannot use the dispatcher's endpoints", r.status_code == 403, f"{r.status_code}")

    # ------------------------------------------------------------------ Part F: headers and limits
    print("\nPART F - response headers and request limits")
    h = c.get("/api/v1/me", headers=SM).headers
    check("F", "Data responses are never cached", h.get("cache-control") == "no-store", h.get("cache-control"))
    check("F", "Frames, content sniffing and device features are off",
          h.get("x-frame-options") == "DENY" and h.get("x-content-type-options") == "nosniff"
          and "camera=()" in h.get("permissions-policy", ""), f"{h.get('x-frame-options')} {h.get('permissions-policy')}")
    r = c.post(f"/api/v1/dispatch/plans/{kplan_id}/defer", headers=DSP,
               json={"order_id": order_id, "reason_code": "other", "note": "x" * 1001})
    check("F", "Over-long free text is refused", r.status_code == 422, f"{r.status_code}")
    r = c.post("/api/v1/store/orders", headers=SM, json={"client_request_id": str(uuid.uuid4()), "temp": "ambient",
                                                          "lines": [{"product_id": 1, "qty": 10_000_000}]})
    check("F", "Absurd quantities are refused", r.status_code == 422, f"{r.status_code}")
    r = c.post("/api/v1/sync", headers=DRV, json={"device_id": str(uuid.uuid4()), "client_now": now(),
                                                  "label": "x" * 500, "events": []})
    check("F", "Over-long device labels are refused", r.status_code == 422, f"{r.status_code}")

    # ------------------------------------------------------------------ Part G: the late notice and its answer
    print("\nPART G - the store's answer to a late notice, and the trip the lateness model reads")
    sm77, sm78 = (app_sql("SELECT user_id FROM wp.app_user WHERE email = $1", e)[0]["user_id"]
                  for e in ("store.out077@example.com", "store.out078@example.com"))
    r = c.post(f"/api/v1/store/orders/{order_id}/receiving", headers=SM_OTHER, json={"answer": "cannot_receive"})
    check("G", "A store cannot answer for another store's delivery", r.status_code in (403, 409), f"{r.status_code} {r.text[:80]}")
    r = c.post(f"/api/v1/store/orders/{order_id}/receiving", headers=SM, json={"answer": "cannot_receive"})
    check("G", "Nor answer for a delivery that has already arrived", r.status_code == 409, f"{r.status_code} {r.text[:80]}")
    n = app_sql("SELECT count(*) AS n FROM wp.model_route_rows(ARRAY[$1]::integer[], '{}')", rt["route_id"], user_id=sm78)[0]["n"]
    check("G", "The lateness model's trip rows stay hidden from a store with no order on the trip", n == 0, f"{n} rows")
    n = app_sql("SELECT count(*) AS n FROM wp.model_route_rows('{}', ARRAY[$1]::bigint[])", order_id, user_id=sm78)[0]["n"]
    check("G", "Naming another store's order does not reveal its trip", n == 0, f"{n} rows")
    err = refused("""INSERT INTO wp.receiving_reply (order_id, stop_id, answer, replied_by)
                     VALUES ($1, $2, 'cannot_receive', $3)""", order_id, stop["stop_id"], sm77, user_id=sm77)
    check("G", "Answers are written only through the checked function", bool(err), err or "insert ran")

failed = [r for r in results if not r[2]]
print(f"\n{len(results) - len(failed)}/{len(results)} checks passed")
for part, name, _, detail in failed:
    print(f"  FAIL [{part}] {name}: {detail}")
sys.exit(1 if failed else 0)
