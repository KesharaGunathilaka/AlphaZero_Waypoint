"""Loader tablet and driver phone: read the released plan, send work as idempotent events.

Offline model: the device stores every action as an event with its own UUID and replays the queue
when it is back online. POST /sync is idempotent (wp.ingest_event ignores an event_id it already
has), so a resend after a dropped connection never creates a second delivery.
"""

import hashlib
from datetime import datetime
from typing import Annotated, Any, Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile, status
from pydantic import BaseModel, Field

from app.dependencies import CurrentUser, CurrentUserDep, DbSession, require_roles
from app.modules.common import not_found, one, rows, scalar

router = APIRouter(tags=["Loader and driver"])
Loader = Annotated[CurrentUser, Depends(require_roles("loader", "dispatcher"))]
Driver = Annotated[CurrentUser, Depends(require_roles("driver"))]
FieldUser = Annotated[CurrentUser, Depends(require_roles("loader", "driver"))]

EventType = Literal["heartbeat", "depart", "arrive", "delivery", "flag", "load_confirm", "route_release",
                    "route_reopen", "plan_ack", "instruction_on_phone", "instruction_seen"]


class EventIn(BaseModel):
    event_id: UUID
    type: EventType
    route_id: int | None = None
    stop_id: int | None = None
    payload: dict[str, Any] = {}
    device_time: datetime  # when it happened on the device (kept as the fact's time)


class SyncIn(BaseModel):
    device_id: UUID
    label: str = "Browser"
    client_now: datetime
    events: list[EventIn] = Field(default_factory=list, max_length=500)


@router.get("/me")
async def me(user: CurrentUserDep, db: DbSession):
    """Who is signed in, their role and where they work."""
    return await one(db, """
        SELECT u.user_id, u.role, u.name, u.email, dp.name AS depot, o.code AS outlet_code, o.name AS outlet_name,
               v.source_id AS vehicle_source_id, v.code AS vehicle_code
        FROM app_user u LEFT JOIN depot dp ON dp.depot_id = u.depot_id LEFT JOIN outlet o ON o.outlet_id = u.outlet_id
        LEFT JOIN vehicle v ON v.vehicle_id = u.vehicle_id WHERE u.user_id = :u""", {"u": user.user_id})


# ---------------------------------------------------------------- loader ----
@router.get("/loader/routes")
async def loader_routes(user: Loader, db: DbSession):
    """Trips of released plans still to load or leave, earliest departure first."""
    return await rows(db, """
        SELECT * FROM route_board
        WHERE depot_id = :d AND plan_version > 0 AND state IN ('planned', 'loading', 'loaded')
        ORDER BY depart_at""", {"d": user.depot_id})


@router.get("/loader/routes/{route_id}")
async def load_list(route_id: int, user: Loader, db: DbSession):
    """Load list in reverse stop order (last stop loaded first) with flags and dispatcher replies."""
    route = await one(db, "SELECT * FROM route_board WHERE route_id = :r", {"r": route_id})
    if route is None:
        raise not_found("Route")
    route["lines"] = await rows(db, "SELECT * FROM load_list WHERE route_id = :r ORDER BY load_order, stop_id, order_id, line_no",
                                {"r": route_id})
    return route


# ---------------------------------------------------------------- driver ----
@router.get("/driver/run")
async def driver_run(user: Driver, db: DbSession):
    """The driver's trips from the latest released plan version, plus what is already done.
    Download at the depot; the phone keeps it for working without signal."""
    plans = await rows(db, """
        SELECT pv.plan_id, pv.version, p.service_date, pv.released_at,
               (SELECT COALESCE(jsonb_agg(r ORDER BY r ->> 'depart_at'), '[]') FROM jsonb_array_elements(pv.snapshot -> 'routes') r
                 WHERE (r ->> 'driver_id')::integer = :u) AS routes
        FROM plan p JOIN plan_version pv ON pv.plan_id = p.plan_id AND pv.version = p.version
        WHERE p.state = 'released' AND p.depot_id = (SELECT depot_id FROM app_user WHERE user_id = :u)
          AND p.service_date >= (now() AT TIME ZONE 'Asia/Colombo')::date - 1
        ORDER BY p.service_date""", {"u": user.user_id})
    done = await rows(db, """
        SELECT d.order_id, d.outcome, d.device_time FROM current_delivery d WHERE d.driver_id = :u""", {"u": user.user_id})
    routes = await rows(db, "SELECT route_id, state, departed_at FROM route WHERE driver_id = :u AND state <> 'cancelled'",
                        {"u": user.user_id})
    instructions = await rows(db, """
        SELECT i.instruction_id, i.route_id, i.stop_id, i.type, i.text, i.sent_at, i.state
        FROM instruction i JOIN route r USING (route_id)
        WHERE r.driver_id = :u AND i.state IN ('sent', 'on_phone')""", {"u": user.user_id})
    return {"plans": [p for p in plans if p["routes"]], "deliveries": done, "route_states": routes,
            "instructions": instructions, "server_time": await scalar(db, "SELECT now()")}


# ------------------------------------------------------------------ sync ----
@router.post("/sync")
async def sync(body: SyncIn, user: FieldUser, db: DbSession):
    """Upload queued events (any order, any number of times). Returns the outcome of each."""
    kind = "driver_phone" if user.role == "driver" else "loader_tablet"
    await rows(db, """
        INSERT INTO device(device_id, kind, label, depot_id, user_id)
        VALUES (:id, :k, :l, :d, CASE WHEN CAST(:k AS text) = 'driver_phone' THEN CAST(:u AS integer) END)
        ON CONFLICT (device_id) DO UPDATE SET user_id = CASE WHEN EXCLUDED.kind = 'driver_phone' THEN EXCLUDED.user_id
                                                             ELSE device.user_id END
        RETURNING 1""", {"id": body.device_id, "k": kind, "l": body.label, "d": user.depot_id, "u": user.user_id})
    results = []
    for e in sorted(body.events, key=lambda e: e.device_time):
        seq = await scalar(db, "SELECT COALESCE(max(device_seq), 0) + 1 FROM device_event WHERE device_id = :d",
                           {"d": body.device_id})
        await scalar(db, """
            SELECT ingest_event(:e, :d, :seq, :u, :t, :r, :s, CAST(:p AS jsonb), :dt, :now)""",
            {"e": e.event_id, "d": body.device_id, "seq": seq, "u": user.user_id, "t": e.type, "r": e.route_id,
             "s": e.stop_id, "p": e.payload, "dt": e.device_time, "now": body.client_now})
        results.append(await one(db, "SELECT event_id, state, reject_reason FROM device_event WHERE event_id = :e",
                                 {"e": e.event_id}))
    await db.commit()
    return {"results": results, "server_time": await scalar(db, "SELECT now()")}


# ----------------------------------------------------------- attachments ----
@router.post("/attachments", status_code=201)
async def upload(
    user: CurrentUserDep,
    db: DbSession,
    file: UploadFile = File(...),
    kind: Literal["photo", "signature"] = Form(...),
    attachment_id: UUID | None = Form(None),
    delivery_id: UUID | None = Form(None),
    flag_id: UUID | None = Form(None),
    issue_id: UUID | None = Form(None),
    device_time: datetime | None = Form(None),
):
    """Proof-of-delivery photo or signature, a flag photo, or a store issue photo (uploaded after the
    event it belongs to has synced). Re-uploading the same attachment_id is a no-op."""
    data = await file.read()
    if not data or len(data) > 5 * 1024 * 1024:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Files up to 5 MB")
    aid = attachment_id or uuid4()
    key = f"att/{aid}"
    await rows(db, "INSERT INTO attachment_blob(storage_key, data) VALUES (:k, :b) ON CONFLICT DO NOTHING RETURNING 1",
               {"k": key, "b": data})
    await rows(db, """
        INSERT INTO attachment(attachment_id, kind, delivery_id, flag_id, issue_id, storage_key, content_type, bytes,
                               sha256, uploaded_by, device_time)
        VALUES (:a, :k, :d, :f, :i, :key, :ct, :n, :h, :u, COALESCE(:dt, now()))
        ON CONFLICT (attachment_id) DO NOTHING RETURNING 1""",
        {"a": aid, "k": kind, "d": delivery_id, "f": flag_id, "i": issue_id, "key": key,
         "ct": file.content_type or "application/octet-stream", "n": len(data),
         "h": hashlib.sha256(data).hexdigest(), "u": user.user_id, "dt": device_time})
    await db.commit()
    return {"attachment_id": aid}


@router.get("/attachments/{attachment_id}")
async def download(attachment_id: UUID, user: CurrentUserDep, db: DbSession):
    row = await one(db, """
        SELECT a.content_type, b.data FROM attachment a JOIN attachment_blob b ON b.storage_key = a.storage_key
        WHERE a.attachment_id = :a""", {"a": attachment_id})
    if row is None:
        raise not_found("Attachment")
    return Response(content=bytes(row["data"]), media_type=row["content_type"])


# ------------------------------------------------------------------ demo ----
@router.post("/demo/reset")
async def demo_reset(user: Annotated[CurrentUser, Depends(require_roles("dispatcher"))], db: DbSession):
    """Wipe orders, plans and deliveries and seed a fresh demo day (next open service date)."""
    result = await scalar(db, "SELECT demo_reset()")
    await db.commit()
    return result
