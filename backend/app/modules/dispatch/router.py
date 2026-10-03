"""Dispatcher: close orders, let the engine propose, adjust, defer with a reason, release, monitor."""

from datetime import date, datetime, time
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from app.dependencies import CurrentUser, DbSession, require_roles
from app.modules.common import not_found, one, rows, scalar
from app.modules.dispatch.engine import propose

router = APIRouter(prefix="/dispatch", tags=["Dispatcher"])
Dispatcher = Annotated[CurrentUser, Depends(require_roles("dispatcher"))]


class MoveIn(BaseModel):
    order_id: int
    vehicle_id: int
    seq: Literal[1, 2]


class DeferIn(BaseModel):
    order_id: int
    reason_code: str
    note: str | None = None


class DepartIn(BaseModel):
    depart_at: datetime


class VehicleIn(BaseModel):
    active: bool


class ReplyIn(BaseModel):
    type: Literal["skip_stop", "reorder", "hold", "reassign", "proceed_short", "note"] = "note"
    text: str | None = None
    resolve: bool = True


def _depot(user: CurrentUser) -> int:
    if user.depot_id is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This account is not attached to a depot")
    return user.depot_id


async def _plan(db, plan_id: int, user: CurrentUser) -> dict:
    plan = await one(db, "SELECT * FROM plan WHERE plan_id = :p", {"p": plan_id})
    if plan is None or (user.role != "admin" and plan["depot_id"] != user.depot_id):
        raise not_found("Plan")
    return plan


async def _tidy(db, plan_id: int, user: CurrentUser) -> None:
    """Drop stops left without orders, then retime every live route of the plan."""
    await rows(db, """
        UPDATE stop s SET removed_at = now(), removed_reason = 'no orders left'
        WHERE s.plan_id = :p AND s.removed_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM stop_order so WHERE so.stop_id = s.stop_id AND so.removed_at IS NULL)
        RETURNING 1""", {"p": plan_id})
    await rows(db, """
        UPDATE route r SET state = 'cancelled'
        WHERE r.plan_id = :p AND r.state = 'planned'
          AND NOT EXISTS (SELECT 1 FROM stop s WHERE s.route_id = r.route_id AND s.removed_at IS NULL)
        RETURNING 1""", {"p": plan_id})
    for r in await rows(db, "SELECT route_id FROM route WHERE plan_id = :p AND state = 'planned'", {"p": plan_id}):
        await scalar(db, "SELECT retime_route(:r, :u)", {"r": r["route_id"], "u": user.user_id})


# ------------------------------------------------------------------ runs ----
@router.get("/runs")
async def runs(user: Dispatcher, db: DbSession):
    """The next open service date plus recent and upcoming runs of the depot."""
    depot = _depot(user)
    return {
        "next_open_date": await scalar(db, "SELECT next_open_service_date(CAST(:d AS smallint))", {"d": depot}),
        "runs": await rows(db, """
            SELECT r.run_id, r.service_date, r.state, r.cutoff_at, p.plan_id, p.state AS plan_state, p.version,
                   (SELECT count(*) FROM order_header h WHERE h.run_id = r.run_id) AS orders
            FROM run r LEFT JOIN plan p ON p.run_id = r.run_id
            WHERE r.depot_id = :d ORDER BY r.service_date DESC LIMIT 14""", {"d": depot}),
    }


@router.post("/runs/{service_date}/close")
async def close_orders(service_date: date, user: Dispatcher, db: DbSession):
    """Close orders now (normally automatic at the 16:00 cutoff): confirms placed orders, opens the plan."""
    depot = _depot(user)
    run_id = await scalar(db, "SELECT get_run(CAST(:d AS smallint), :day)", {"d": depot, "day": service_date})
    confirmed = await scalar(db, "SELECT close_run(:r)", {"r": run_id})
    plan_id = await scalar(db, "SELECT create_plan(:r, :u)", {"r": run_id, "u": user.user_id})
    await db.commit()
    return {"run_id": run_id, "plan_id": plan_id, "orders_confirmed": confirmed}


# ------------------------------------------------------------------ plan ----
@router.get("/plans/{plan_id}")
async def plan_view(plan_id: int, user: Dispatcher, db: DbSession):
    """Everything the plan board needs: summary, trips with stops, unplanned orders, rule problems."""
    plan = await _plan(db, plan_id, user)
    routes = await rows(db, "SELECT * FROM route_board WHERE plan_id = :p ORDER BY vehicle_code, route_seq", {"p": plan_id})
    stops = await rows(db, """
        SELECT s.route_id, s.stop_id, s.seq, ou.code AS outlet_code, ou.name AS outlet_name, s.planned_arrival,
               s.service_minutes, ou.unload, ou.van_only,
               (SELECT jsonb_agg(jsonb_build_object('order_id', h.order_id, 'ref', h.confirmation_no, 'temp', h.temp,
                                                    'kg', h.weight_kg, 'm3', h.volume_m3, 'status', h.status))
                  FROM stop_order so JOIN order_header h ON h.order_id = so.order_id
                 WHERE so.stop_id = s.stop_id AND so.removed_at IS NULL) AS orders
        FROM stop s JOIN outlet ou ON ou.outlet_id = s.outlet_id
        WHERE s.plan_id = :p AND s.removed_at IS NULL ORDER BY s.route_id, s.seq""", {"p": plan_id})
    for r in routes:
        r["stops"] = [s for s in stops if s["route_id"] == r["route_id"]]
    return {
        "plan": plan,
        "summary": await one(db, "SELECT * FROM plan_summary WHERE plan_id = :p", {"p": plan_id}),
        "routes": routes,
        "unplanned": await rows(db, """
            SELECT oc.*, ou.code AS outlet_code, ou.van_only, ou.unload, d.name AS district,
                   rc.label AS suggested_label, h.delivery_date
            FROM overflow_candidates oc JOIN outlet ou ON ou.outlet_id = oc.outlet_id
            JOIN district d ON d.district_id = ou.district_id JOIN order_header h ON h.order_id = oc.order_id
            LEFT JOIN reason_code rc ON rc.scope = 'deferral' AND rc.code = oc.suggested_reason
            WHERE oc.plan_id = :p ORDER BY oc.fcfs_rank""", {"p": plan_id}),
        "next_operating_day": await scalar(db, """
            SELECT d FROM generate_series(CAST(:day AS date) + 1, CAST(:day AS date) + 14, interval '1 day') g(d)
            WHERE is_working_day(d::date) ORDER BY d LIMIT 1""", {"day": plan["service_date"]}),
        "violations": await rows(db, "SELECT * FROM plan_violations(:p)", {"p": plan_id}),
        "vehicles": await rows(db, """
            SELECT v.vehicle_id, v.code, v.source_id, c.name AS class, c.is_van, c.carries_chilled, v.active,
                   v.max_weight_kg, v.max_volume_m3, fuel_left(v.vehicle_id, :p) AS fuel_left_l
            FROM vehicle v JOIN vehicle_class c USING (class_id) WHERE v.depot_id = :d ORDER BY v.vehicle_id""",
            {"p": plan_id, "d": plan["depot_id"]}),
        "reasons": await rows(db, "SELECT code, label, needs_note FROM reason_code WHERE scope = 'deferral' AND active ORDER BY sort"),
    }


@router.post("/plans/{plan_id}/propose")
async def engine_propose(plan_id: int, user: Dispatcher, db: DbSession):
    """Run the allocation engine. Replaces the current draft; only before the first release."""
    plan = await _plan(db, plan_id, user)
    if plan["state"] != "draft":
        raise HTTPException(status.HTTP_409_CONFLICT, "The plan is already released; adjust it instead")
    result = await propose(db, plan_id, user.user_id)
    result["violations"] = await rows(db, "SELECT * FROM plan_violations(:p)", {"p": plan_id})
    await db.commit()
    return result


@router.post("/plans/{plan_id}/move")
async def move_order(plan_id: int, body: MoveIn, user: Dispatcher, db: DbSession):
    """Manual adjustment: put an order on a vehicle's trip 1 or 2. Refused with the rule if it breaks one."""
    plan = await _plan(db, plan_id, user)
    order = await one(db, """
        SELECT h.order_id, ou.outlet_id, ou.brand_id, ou.district_id, b.code AS brand
        FROM order_header h JOIN outlet ou USING (outlet_id) JOIN brand b ON b.brand_id = ou.brand_id
        WHERE h.order_id = :o""", {"o": body.order_id})
    if order is None:
        raise not_found("Order")
    route = await one(db, "SELECT * FROM route WHERE plan_id = :p AND vehicle_id = :v AND seq = :s AND state <> 'cancelled'",
                      {"p": plan_id, "v": body.vehicle_id, "s": body.seq})
    if route is None:
        # New trip: Fresh leaves at 03:30, Style/Tech at 09:00, or after the vehicle's other trip returns.
        start = time(3, 30) if order["brand"] == "F" else time(9, 0)
        route_id = await scalar(db, """
            INSERT INTO route(plan_id, depot_id, brand_id, district_id, vehicle_id, driver_id, seq, depart_at, return_at)
            SELECT :p, :depot, :b, :di, :v, (SELECT user_id FROM app_user WHERE vehicle_id = :v AND active), :s, x.dep,
                   x.dep + interval '1 minute'
            FROM (SELECT GREATEST((CAST(:day AS date) + CAST(:start AS time)) AT TIME ZONE 'Asia/Colombo',
                                  COALESCE((SELECT max(return_at) FROM route WHERE plan_id = :p AND vehicle_id = :v
                                            AND state <> 'cancelled'), '-infinity')) AS dep) x
            RETURNING route_id""",
            {"p": plan_id, "depot": plan["depot_id"], "b": order["brand_id"], "di": order["district_id"],
             "v": body.vehicle_id, "s": body.seq, "day": plan["service_date"], "start": start})
    else:
        route_id = route["route_id"]
    stop_id = await scalar(db, "SELECT stop_id FROM stop WHERE route_id = :r AND outlet_id = :o AND removed_at IS NULL",
                           {"r": route_id, "o": order["outlet_id"]})
    if stop_id is None:
        # stop_matches_route refuses another brand or district here (WP240)
        stop_id = await scalar(db, """
            INSERT INTO stop(route_id, plan_id, seq, outlet_id, planned_arrival, service_minutes)
            SELECT :r, :p, COALESCE(max(seq), 0) + 1, :o, (SELECT depart_at FROM route WHERE route_id = :r), 1
            FROM stop WHERE route_id = :r AND removed_at IS NULL RETURNING stop_id""",
            {"r": route_id, "p": plan_id, "o": order["outlet_id"]})
    await scalar(db, "SELECT assign_order(:o, :s, :u)", {"o": body.order_id, "s": stop_id, "u": user.user_id})
    await _tidy(db, plan_id, user)
    violations = await rows(db, "SELECT * FROM plan_violations(:p)", {"p": plan_id})
    await db.commit()
    return {"route_id": route_id, "stop_id": stop_id, "violations": violations}


@router.post("/plans/{plan_id}/defer")
async def defer(plan_id: int, body: DeferIn, user: Dispatcher, db: DbSession):
    """Decide to defer an order (drafted; applied when the plan is released)."""
    await _plan(db, plan_id, user)
    await scalar(db, "SELECT draft_deferral(:p, :o, :r, :n, :u)",
                 {"p": plan_id, "o": body.order_id, "r": body.reason_code, "n": body.note, "u": user.user_id})
    await _tidy(db, plan_id, user)
    await db.commit()
    return {"violations": await rows(db, "SELECT * FROM plan_violations(:p)", {"p": plan_id})}


@router.patch("/routes/{route_id}")
async def set_departure(route_id: int, body: DepartIn, user: Dispatcher, db: DbSession):
    await rows(db, "UPDATE route SET depart_at = CAST(:d AS timestamptz), return_at = CAST(:d AS timestamptz) + interval '1 minute' WHERE route_id = :r RETURNING 1",
               {"d": body.depart_at, "r": route_id})
    minutes = await scalar(db, "SELECT retime_route(:r, :u)", {"r": route_id, "u": user.user_id})
    await db.commit()
    return {"trip_minutes": minutes}


@router.post("/plans/{plan_id}/release")
async def release(plan_id: int, user: Dispatcher, db: DbSession):
    """Apply the drafted deferrals (stores are told) and publish the plan to loaders and drivers."""
    await _plan(db, plan_id, user)
    deferred = await scalar(db, "SELECT confirm_deferrals(:p, :u)", {"p": plan_id, "u": user.user_id})
    version = await scalar(db, "SELECT release_plan(:p, :u)", {"p": plan_id, "u": user.user_id})
    await db.commit()
    return {"version": version, "deferred": deferred}


@router.get("/plans/{plan_id}/violations")
async def violations(plan_id: int, user: Dispatcher, db: DbSession):
    await _plan(db, plan_id, user)
    return await rows(db, "SELECT * FROM plan_violations(:p)", {"p": plan_id})


@router.patch("/vehicles/{vehicle_id}")
async def vehicle_availability(vehicle_id: int, body: VehicleIn, user: Dispatcher, db: DbSession):
    """Mark a vehicle in the workshop (inactive) or back in service."""
    found = await rows(db, "UPDATE vehicle SET active = :a WHERE vehicle_id = :v AND depot_id = :d RETURNING vehicle_id",
                       {"a": body.active, "v": vehicle_id, "d": _depot(user)})
    if not found:
        raise not_found("Vehicle")
    await db.commit()
    return {"vehicle_id": vehicle_id, "active": body.active}


# --------------------------------------------------------------- monitor ----
@router.get("/monitor")
async def monitor(user: Dispatcher, db: DbSession):
    """Live board: progress per run, every vehicle (with last signal), and what needs attention."""
    return {
        "runs": await rows(db, "SELECT * FROM run_progress WHERE state IN ('planned', 'in_progress', 'complete') "
                               "ORDER BY service_date DESC LIMIT 3"),
        "fleet": await rows(db, "SELECT * FROM fleet_status ORDER BY vehicle_code, route_seq"),
        "exceptions": await rows(db, "SELECT * FROM monitor_exceptions ORDER BY urgency, since"),
        # Stop by stop for every live trip: plan against what the phones have reported.
        "stops": await rows(db, """
            SELECT s.route_id, s.stop_id, s.seq, ou.code AS outlet_code, ou.name AS outlet_name, s.planned_arrival,
                   a.device_time AS arrived_at,
                   (SELECT min(d.device_time) FROM stop_order so JOIN current_delivery d ON d.order_id = so.order_id
                     WHERE so.stop_id = s.stop_id AND so.removed_at IS NULL) AS delivered_at,
                   (SELECT string_agg(DISTINCT d.outcome::text, ',') FROM stop_order so JOIN current_delivery d ON d.order_id = so.order_id
                     WHERE so.stop_id = s.stop_id AND so.removed_at IS NULL) AS outcomes,
                   (SELECT count(*) FROM stop_order so JOIN current_delivery d ON d.order_id = so.order_id
                     JOIN attachment at ON at.delivery_id = d.delivery_id
                     WHERE so.stop_id = s.stop_id AND so.removed_at IS NULL) AS proof_files
            FROM stop s JOIN outlet ou ON ou.outlet_id = s.outlet_id
            LEFT JOIN stop_arrival a ON a.stop_id = s.stop_id
            WHERE s.removed_at IS NULL AND s.route_id IN (SELECT route_id FROM fleet_status)
            ORDER BY s.route_id, s.seq"""),
        "server_time": await scalar(db, "SELECT now()"),
    }


@router.post("/flags/{flag_id}/reply")
async def reply_to_flag(flag_id: UUID, body: ReplyIn, user: Dispatcher, db: DbSession):
    """Answer a loader or driver flag (e.g. 'proceed_short' for a shortfall)."""
    flag = await one(db, "SELECT route_id, stop_id FROM flag WHERE flag_id = :f", {"f": flag_id})
    if flag is None:
        raise not_found("Flag")
    instruction = await scalar(db, "SELECT send_instruction(:r, :s, :f, CAST(:t AS instruction_type), '{}'::jsonb, :x, :u)",
                               {"r": flag["route_id"], "s": flag["stop_id"], "f": flag_id, "t": body.type,
                                "x": body.text, "u": user.user_id})
    if body.resolve:
        await scalar(db, "SELECT resolve_flag(:f, :u)", {"f": flag_id, "u": user.user_id})
    await db.commit()
    return {"instruction_id": instruction}


@router.get("/orders/{order_id}")
async def order_record(order_id: int, user: Dispatcher, db: DbSession):
    """One order's full record: status trail, deferrals, delivery proof and the outlet's last runs."""
    order = await one(db, "SELECT * FROM order_board WHERE order_id = :o", {"o": order_id})
    if order is None:
        raise not_found("Order")
    order["timeline"] = await rows(db, "SELECT * FROM order_timeline WHERE order_id = :o ORDER BY history_id", {"o": order_id})
    order["deferrals"] = await rows(db, """
        SELECT d.from_date, d.to_date, rc.label AS reason, d.note, d.consecutive_skip, u.name AS decided_by, d.decided_at
        FROM deferral d JOIN reason_code rc ON rc.scope = d.scope AND rc.code = d.reason_code
        JOIN app_user u ON u.user_id = d.decided_by WHERE d.order_id = :o ORDER BY d.decided_at""", {"o": order_id})
    order["notices"] = await rows(db, "SELECT kind, title, created_at, read_at FROM notice WHERE order_id = :o ORDER BY created_at",
                                  {"o": order_id})
    order["proof"] = await rows(db, """
        SELECT a.attachment_id, a.kind, a.device_time FROM attachment a JOIN current_delivery d ON d.delivery_id = a.delivery_id
        WHERE d.order_id = :o ORDER BY a.device_time""", {"o": order_id})
    order["history"] = await rows(db, "SELECT day, outcome FROM outlet_run_history WHERE outlet_id = :ou ORDER BY day",
                                  {"ou": order["outlet_id"]})
    return order


@router.get("/ledger")
async def ledger(user: Dispatcher, db: DbSession):
    """Every deferral and delivery: the record of who was skipped, why, and what arrived."""
    return {
        "headline": await one(db, "SELECT * FROM ledger_headline"),
        "records": await rows(db, "SELECT * FROM ledger ORDER BY at DESC LIMIT 200"),
        "per_day": await rows(db, "SELECT day, is_working, deferred FROM deferrals_per_day ORDER BY day"),
    }
