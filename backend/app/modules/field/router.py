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
from app import storage
from app.config import get_settings
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
    payload: dict[str, Any] = Field(default_factory=dict, max_length=50)
    device_time: datetime  # when it happened on the device (kept as the fact's time)


class SyncIn(BaseModel):
    device_id: UUID
    label: str = Field(default="Browser", max_length=80)
    client_now: datetime
    events: list[EventIn] = Field(default_factory=list, max_length=500)


@router.get("/me")
async def me(user: CurrentUserDep, db: DbSession):
    """Who is signed in, their role and where they work."""
    return await one(db, """
        SELECT u.user_id, u.role, u.name, u.email, dp.name AS depot, u.all_depots, o.code AS outlet_code, o.name AS outlet_name,
               v.source_id AS vehicle_source_id, v.code AS vehicle_code
        FROM app_user u LEFT JOIN depot dp ON dp.depot_id = u.depot_id LEFT JOIN outlet o ON o.outlet_id = u.outlet_id
        LEFT JOIN vehicle v ON v.vehicle_id = u.vehicle_id WHERE u.user_id = :u""", {"u": user.user_id})


# ---------------------------------------------------------------- loader ----
@router.get("/loader/routes")
async def loader_routes(user: Loader, db: DbSession):
    """Trips of released plans still to load or leave, earliest departure first, and plan changes
    the dock has not acknowledged yet (opening the vehicle acknowledges them with a plan_ack event)."""
    routes = await rows(db, """
        SELECT rb.*, v.source_id AS vehicle_source_id, pv.released_at AS plan_released_at
        FROM route_board rb JOIN vehicle v ON v.vehicle_id = rb.vehicle_id
        LEFT JOIN plan_version pv ON pv.plan_id = rb.plan_id AND pv.version = rb.plan_version
        WHERE rb.depot_id = :d AND rb.plan_version > 0 AND rb.state IN ('planned', 'loading', 'loaded')
        ORDER BY rb.depart_at""", {"d": user.depot_id})
    changes = await rows(db, """
        SELECT pc.change_id, pc.route_id, pc.version, pc.changed_stops, pc.changed_orders, pc.created_at,
               (pc.detail ->> 'route_header_changed')::boolean AS retimed
        FROM plan_change pc JOIN route r ON r.route_id = pc.route_id
        WHERE r.depot_id = :d AND r.state IN ('planned', 'loading', 'loaded')
          AND NOT EXISTS (SELECT 1 FROM plan_change_ack a WHERE a.change_id = pc.change_id AND a.audience = 'loader')
        ORDER BY pc.created_at DESC""", {"d": user.depot_id})
    return {"routes": routes, "changes": changes}


@router.get("/loader/routes/{route_id}")
async def load_list(route_id: int, user: Loader, db: DbSession):
    """Load list in reverse stop order (last stop loaded first) with flags and dispatcher replies."""
    route = await one(db, """
        SELECT rb.*, v.source_id AS vehicle_source_id FROM route_board rb JOIN vehicle v ON v.vehicle_id = rb.vehicle_id
        WHERE rb.route_id = :r""", {"r": route_id})
    if route is None:
        raise not_found("Route")
    route["lines"] = await rows(db, """
        SELECT ll.*, s.planned_arrival, p.unit_weight_kg, p.unit_volume_m3, f.qty AS flag_qty, f.note AS flag_note,
               (SELECT count(*) FROM attachment a WHERE a.flag_id = ll.flag_id) AS flag_photos
        FROM load_list ll JOIN stop s ON s.stop_id = ll.stop_id JOIN product p ON p.sku = ll.sku
        LEFT JOIN flag f ON f.flag_id = ll.flag_id
        WHERE ll.route_id = :r ORDER BY ll.load_order, ll.stop_id, ll.order_id, ll.line_no""", {"r": route_id})
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
        SELECT d.delivery_id, d.order_id, d.stop_id, d.outcome, d.device_time FROM current_delivery d
        WHERE d.driver_id = :u""", {"u": user.user_id})
    routes = await rows(db, "SELECT route_id, state, departed_at FROM route WHERE driver_id = :u AND state <> 'cancelled'",
                        {"u": user.user_id})
    instructions = await rows(db, """
        SELECT i.instruction_id, i.route_id, i.stop_id, i.type, i.text, i.sent_at, i.state
        FROM instruction i JOIN route r USING (route_id)
        WHERE r.driver_id = :u AND i.state IN ('sent', 'on_phone')""", {"u": user.user_id})
    # What the loader actually put on board (a shortfall changes what the driver can hand over).
    loaded = await rows(db, """
        SELECT DISTINCT ON (lc.order_id, lc.line_no) lc.order_id, lc.line_no, lc.qty_loaded
        FROM load_confirmation lc JOIN route r ON r.route_id = lc.route_id
        WHERE r.driver_id = :u ORDER BY lc.order_id, lc.line_no, lc.device_time DESC, lc.received_at DESC""",
        {"u": user.user_id})
    # Each stop's delivery (or mall) window on its service day: the "deliver by" the driver works to.
    windows = await rows(db, """
        SELECT s.stop_id, min(w.opens) AS opens, max(w.closes) AS closes
        FROM stop s JOIN route r ON r.route_id = s.route_id JOIN plan p ON p.plan_id = r.plan_id
        JOIN outlet_window w ON w.outlet_id = s.outlet_id AND w.isodow = EXTRACT(isodow FROM p.service_date)::smallint
        WHERE r.driver_id = :u AND s.removed_at IS NULL GROUP BY s.stop_id""", {"u": user.user_id})
    me = await one(db, """
        SELECT u.name, v.source_id AS vehicle_source_id, v.code AS vehicle_code, c.name AS vehicle_class,
               (SELECT name FROM depot WHERE depot_id = u.depot_id) AS depot
        FROM app_user u LEFT JOIN vehicle v ON v.vehicle_id = u.vehicle_id LEFT JOIN vehicle_class c ON c.class_id = v.class_id
        WHERE u.user_id = :u""", {"u": user.user_id})
    return {"driver": me, "plans": [p for p in plans if p["routes"]], "deliveries": done, "route_states": routes,
            "loaded": loaded, "windows": windows, "instructions": instructions,
            "server_time": await scalar(db, "SELECT now()")}


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
    # Events that arrived before the record they depend on (a depart before the loader's release)
    # wait as pending; every sync gives them another try, in device order.
    await scalar(db, "SELECT apply_pending_events()")
    for e in body.events:
        results.append(await one(db, "SELECT event_id, state, reject_reason FROM device_event WHERE event_id = :e",
                                 {"e": e.event_id}))
    await db.commit()
    return {"results": results, "server_time": await scalar(db, "SELECT now()")}


# ----------------------------------------------------------- attachments ----
MAX_FILE_BYTES = 5 * 1024 * 1024


def image_type(data: bytes) -> str | None:
    """The image type from the file's own first bytes, never from what the browser claims (a page could
    otherwise store HTML or SVG and have it served back as a document)."""
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    if data[4:8] == b"ftyp" and data[8:12] in (b"heic", b"heix", b"hevc", b"mif1", b"msf1", b"heif"):
        return "image/heic"
    return None


# What the uploader must own: the driver's own delivery, a flag they raised, an issue on their outlet's order.
_OWNS = {
    "delivery_id": "SELECT 1 FROM delivery WHERE delivery_id = :id AND (driver_id = :u OR :admin)",
    "flag_id": "SELECT 1 FROM flag WHERE flag_id = :id AND (raised_by = :u OR :admin)",
    "issue_id": """SELECT 1 FROM receipt_issue i JOIN order_header h ON h.order_id = i.order_id
                   WHERE i.issue_id = :id AND (h.outlet_id = CAST(:outlet AS integer) OR :admin)""",
}


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
    event it belongs to has synced). Re-uploading the same attachment_id by its uploader is a no-op."""
    links = {k: v for k, v in (("delivery_id", delivery_id), ("flag_id", flag_id), ("issue_id", issue_id)) if v}
    if len(links) != 1:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Attach the file to one delivery, flag or issue")
    ((link, link_id),) = links.items()
    if kind == "signature" and link != "delivery_id":
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "A signature belongs to a delivery")
    data = await file.read(MAX_FILE_BYTES + 1)
    if not data or len(data) > MAX_FILE_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Files up to 5 MB")
    content_type = image_type(data)
    if content_type is None:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                            "Photos and signatures only (JPEG, PNG, WebP, GIF or HEIC)")
    if await one(db, _OWNS[link], {"id": link_id, "u": user.user_id, "outlet": user.outlet_id,
                                   "admin": user.role == "admin"}) is None:
        raise not_found("Delivery, flag or issue")

    aid = attachment_id or uuid4()
    key = f"attachments/{aid}"
    digest = hashlib.sha256(data).hexdigest()
    existing = await one(db, "SELECT uploaded_by, sha256, storage_key FROM attachment WHERE attachment_id = :a",
                         {"a": aid})
    if existing is not None:
        # A resend after a dropped connection: same person, same file. Anything else may not replace it.
        if existing["uploaded_by"] != user.user_id or existing["sha256"] != digest:
            raise HTTPException(status.HTTP_409_CONFLICT, "This file is already stored and cannot be replaced")
        return {"attachment_id": aid, "url": await storage.view_url(str(aid), existing["storage_key"])}

    await rows(db, """
        INSERT INTO attachment(attachment_id, kind, delivery_id, flag_id, issue_id, storage_key, content_type, bytes,
                               sha256, uploaded_by, device_time)
        VALUES (:a, :k, :d, :f, :i, :key, :ct, :n, :h, :u, COALESCE(:dt, now()))
        ON CONFLICT (attachment_id) DO NOTHING RETURNING 1""",
        {"a": aid, "k": kind, "d": delivery_id, "f": flag_id, "i": issue_id, "key": key,
         "ct": content_type, "n": len(data), "h": digest, "u": user.user_id, "dt": device_time})
    await storage.put(db, key, data, content_type)  # only once the record is accepted: no orphan or replaced files
    await db.commit()
    return {"attachment_id": aid, "url": await storage.view_url(str(aid), key)}


@router.get("/attachments/{attachment_id}")
async def view(attachment_id: UUID, user: CurrentUserDep, db: DbSession):
    """A short-lived link to show the image (an <img> tag cannot send the sign-in token), only for people
    who may see the delivery, flag or issue it belongs to."""
    row = await one(db, """
        SELECT a.attachment_id, a.kind, a.content_type, a.storage_key FROM attachment a
        LEFT JOIN delivery d ON d.delivery_id = a.delivery_id
        LEFT JOIN flag f ON f.flag_id = a.flag_id
        LEFT JOIN receipt_issue i ON i.issue_id = a.issue_id
        WHERE a.attachment_id = :a
          AND (a.uploaded_by = :u OR can_see_order(d.order_id) OR can_see_route(f.route_id)
               OR can_see_order(i.order_id))""",
        {"a": attachment_id, "u": user.user_id})
    if row is None:
        raise not_found("Attachment")
    return {"attachment_id": attachment_id, "kind": row["kind"], "content_type": row["content_type"],
            "url": await storage.view_url(str(attachment_id), row["storage_key"])}


_SAFE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif", "image/heic"}


@router.get("/attachments/{attachment_id}/raw", include_in_schema=False)
async def raw(attachment_id: UUID, expires: int, signature: str, db: DbSession):
    """Image bytes for the "db" storage backend, behind the signed link from GET /attachments/{id}."""
    if not storage.link_is_valid(str(attachment_id), expires, signature):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Link expired or invalid")
    row = await one(db, "SELECT content_type, storage_key FROM attachment WHERE attachment_id = :a", {"a": attachment_id})
    data = await storage.get(db, row["storage_key"]) if row else None
    if data is None:
        raise not_found("Attachment")
    # Never rendered as a page: an image, or else a download; no scripts, nothing embedded.
    media = row["content_type"] if row["content_type"] in _SAFE_TYPES else "application/octet-stream"
    return Response(content=data, media_type=media, headers={
        "Cache-Control": "private, max-age=3600",
        "Content-Disposition": f'{"inline" if media in _SAFE_TYPES else "attachment"}; filename="{attachment_id}"',
        "Content-Security-Policy": "default-src 'none'; sandbox",
    })


# ------------------------------------------------------------------ demo ----
@router.post("/demo/reset")
async def demo_reset(user: Annotated[CurrentUser, Depends(require_roles("dispatcher"))], db: DbSession):
    """Wipe orders, plans and deliveries and seed a fresh demo day (next open service date).

    Only for the Docker delivery (local sign-in) and local test runs: the deployed app (Clerk) never wipes its data.
    """
    s = get_settings()
    if s.AUTH_MODE != "local" and not (s.AUTH_DEV_BYPASS and s.ENVIRONMENT == "development"):
        raise not_found("Page")
    result = await scalar(db, "SELECT demo_reset()")
    await db.commit()
    return result
