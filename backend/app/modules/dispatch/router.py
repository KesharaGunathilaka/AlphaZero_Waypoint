"""Dispatcher: close orders, let the engine propose, adjust, defer with a reason, release, monitor."""

from datetime import date, datetime, time
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
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


class DepotIn(BaseModel):
    depot_id: int


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


# ---------------------------------------------------------------- depots ----
@router.get("/depots")
async def depots(user: Dispatcher, db: DbSession):
    """Depots this dispatcher can plan, and the one they are working on now."""
    return {
        "current": user.depot_id,
        "depots": await rows(db, """
            SELECT depot_id, name FROM depot
            WHERE CAST(:all AS boolean) OR depot_id = :d ORDER BY name""", {"all": user.all_depots, "d": user.depot_id}),
    }


@router.post("/depot")
async def switch_depot(body: DepotIn, user: Dispatcher, db: DbSession):
    """Planning office: switch the depot this dispatcher is working on. Every screen then shows that depot."""
    if not user.all_depots:
        raise HTTPException(status.HTTP_403_FORBIDDEN, {"code": "depot", "message": "This account works at one depot only"})
    name = await scalar(db, "SELECT name FROM depot WHERE depot_id = :d", {"d": body.depot_id})
    if name is None:
        raise not_found("Depot")
    await rows(db, "UPDATE app_user SET depot_id = :d WHERE user_id = :u RETURNING 1", {"d": body.depot_id, "u": user.user_id})
    await db.commit()
    return {"depot_id": body.depot_id, "name": name}


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
            SELECT d::date FROM generate_series(CAST(:day AS date) + 1, CAST(:day AS date) + 14, interval '1 day') g(d)
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
    vehicle = await one(db, "SELECT code, depot_id, active FROM vehicle WHERE vehicle_id = :v", {"v": body.vehicle_id})
    if vehicle is None:
        raise not_found("Vehicle")
    if vehicle["depot_id"] != plan["depot_id"]:
        raise HTTPException(status.HTTP_409_CONFLICT, {"code": "depot", "message": f"{vehicle['code']} belongs to another depot"})
    if not vehicle["active"]:
        raise HTTPException(status.HTTP_409_CONFLICT, {"code": "vehicle_unavailable",
                                                       "message": f"{vehicle['code']} is in the workshop"})
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
    if not await scalar(db, "SELECT EXISTS (SELECT 1 FROM reason_code WHERE scope = 'deferral' AND code = :r AND active)",
                        {"r": body.reason_code}):
        raise HTTPException(status.HTTP_409_CONFLICT, {"code": "reason", "message": "Pick one of the deferral reasons"})
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
async def monitor(user: Dispatcher, db: DbSession, depot: str = "all"):
    """Live board for the depots this dispatcher watches ("all", or one depot id): the current run of each
    depot, every trip, what needs attention, stop-by-stop progress, and the end-of-day close-out."""
    visible = [r["depot_id"] for r in await rows(db, """
        SELECT depot_id FROM depot WHERE CAST(:all AS boolean) OR depot_id = :d ORDER BY name""",
        {"all": user.all_depots or user.role == "admin", "d": user.depot_id})]
    chosen = visible if depot == "all" else [d for d in visible if str(d) == depot]
    # Each depot's current run: the one on the road, else the next planned one, else the last finished one.
    runs = await rows(db, """
        SELECT DISTINCT ON (rp.depot_id) rp.*, dp.name AS depot
        FROM run_progress rp JOIN depot dp ON dp.depot_id = rp.depot_id
        WHERE rp.depot_id IN (SELECT value::int FROM jsonb_array_elements_text(CAST(:deps AS jsonb))) AND rp.state IN ('planned', 'in_progress', 'complete')
        ORDER BY rp.depot_id, CASE rp.state WHEN 'in_progress' THEN 0 WHEN 'planned' THEN 1 ELSE 2 END,
                 CASE WHEN rp.state = 'complete' THEN -(rp.service_date - DATE '2000-01-01')
                      ELSE rp.service_date - DATE '2000-01-01' END""", {"deps": chosen})
    run_ids = [r["run_id"] for r in runs]
    route_scope = "SELECT r.route_id FROM route r JOIN plan p ON p.plan_id = r.plan_id WHERE p.run_id IN (SELECT value::int FROM jsonb_array_elements_text(CAST(:runs AS jsonb)))"
    return {
        "depots": await rows(db, "SELECT depot_id, name FROM depot WHERE depot_id IN (SELECT value::int FROM jsonb_array_elements_text(CAST(:deps AS jsonb))) ORDER BY name", {"deps": visible}),
        "runs": runs,
        "fleet": await rows(db, f"""
            SELECT f.*, v.source_id AS vehicle_source_id, dp.name AS depot, di.name AS district, b.code AS brand_code,
                   r.return_at, r.trip_minutes
            FROM fleet_status f
            JOIN route r ON r.route_id = f.route_id JOIN vehicle v ON v.vehicle_id = r.vehicle_id
            JOIN depot dp ON dp.depot_id = r.depot_id JOIN district di ON di.district_id = r.district_id
            JOIN brand b ON b.brand_id = r.brand_id
            WHERE f.route_id IN ({route_scope})
            ORDER BY dp.name, v.source_id, f.route_seq""", {"runs": run_ids}),
        "exceptions": await rows(db, f"""
            SELECT e.*, dp.name AS depot FROM monitor_exceptions e
            LEFT JOIN run ru ON ru.run_id = e.run_id
            LEFT JOIN route rt ON rt.route_id = e.route_id
            LEFT JOIN depot dp ON dp.depot_id = COALESCE(ru.depot_id, rt.depot_id)
            WHERE e.run_id IN (SELECT value::int FROM jsonb_array_elements_text(CAST(:runs AS jsonb))) OR e.route_id IN ({route_scope})
            ORDER BY e.urgency, e.since""", {"runs": run_ids}),
        # Stop by stop for every trip: plan against what the phones have reported.
        "stops": await rows(db, f"""
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
            WHERE s.removed_at IS NULL AND s.route_id IN ({route_scope})
            ORDER BY s.route_id, s.seq""", {"runs": run_ids}),
        "closeout": await closeout(db, run_ids),
        "server_time": await scalar(db, "SELECT now()"),
    }


async def closeout(db, run_ids: list[int]) -> list[dict]:
    """End of the day, per run: what happened to every order, failed deliveries still to move to the next
    run, and each vehicle's fuel (the day's route distance against its weekly quota)."""
    out = []
    for run_id in run_ids:
        counts = await one(db, """
            SELECT ru.run_id, ru.service_date, ru.state, dp.name AS depot,
                   count(*) FILTER (WHERE h.status IN ('delivered', 'received') AND d.outcome = 'delivered') AS delivered,
                   count(*) FILTER (WHERE d.outcome = 'delivered_in_part') AS delivered_in_part,
                   count(*) FILTER (WHERE d.outcome = 'not_delivered') AS not_delivered,
                   count(*) FILTER (WHERE d.delivery_id IS NULL) AS not_yet,
                   count(*) FILTER (WHERE h.status = 'received') AS confirmed_by_store,
                   count(*) FILTER (WHERE d.outcome IN ('delivered', 'delivered_in_part') AND h.status <> 'received') AS awaiting_store
            FROM run ru JOIN depot dp ON dp.depot_id = ru.depot_id
            JOIN plan p ON p.run_id = ru.run_id
            JOIN stop_order so ON so.plan_id = p.plan_id AND so.removed_at IS NULL
            JOIN order_header h ON h.order_id = so.order_id
            LEFT JOIN current_delivery d ON d.order_id = so.order_id
            WHERE ru.run_id = :r
            GROUP BY ru.run_id, ru.service_date, ru.state, dp.name""", {"r": run_id})
        if counts is None:
            continue
        counts["failed"] = await rows(db, """
            SELECT h.order_id, h.confirmation_no, ou.code AS outlet_code, ou.name AS outlet_name, h.temp,
                   d.reason_code, rc.label AS reason, d.note, d.device_time
            FROM order_header h JOIN outlet ou ON ou.outlet_id = h.outlet_id
            JOIN current_delivery d ON d.order_id = h.order_id
            LEFT JOIN reason_code rc ON rc.scope = d.reason_scope AND rc.code = d.reason_code
            WHERE h.run_id = :r AND h.status = 'not_delivered' ORDER BY ou.code""", {"r": run_id})
        counts["fuel"] = await rows(db, """
            SELECT v.vehicle_id, v.source_id, round(sum(rt.est_fuel_l), 1) AS today_l,
                   round(sum(rt.est_distance_km), 0) AS today_km,
                   fuel_quota_for(v.vehicle_id, week_start(ru.service_date)) AS quota_l,
                   round(fuel_used_week(v.vehicle_id, week_start(ru.service_date)), 1) AS used_week_l,
                   round(fuel_quota_for(v.vehicle_id, week_start(ru.service_date))
                         - fuel_used_week(v.vehicle_id, week_start(ru.service_date)), 1) AS left_week_l
            FROM route rt JOIN plan p ON p.plan_id = rt.plan_id JOIN run ru ON ru.run_id = p.run_id
            JOIN vehicle v ON v.vehicle_id = rt.vehicle_id
            WHERE ru.run_id = :r AND rt.state <> 'cancelled' AND p.state = 'released'
            GROUP BY v.vehicle_id, v.source_id, ru.service_date ORDER BY v.source_id""", {"r": run_id})
        out.append(counts)
    return out


class RequeueIn(BaseModel):
    note: str | None = None


@router.post("/orders/{order_id}/requeue")
async def requeue(order_id: int, body: RequeueIn, user: Dispatcher, db: DbSession):
    """A delivery that failed goes into the next run, with the driver's reason; the store is told the new day."""
    reason = await one(db, "SELECT reason_code, note FROM current_delivery WHERE order_id = :o AND outcome = 'not_delivered'",
                       {"o": order_id})
    if reason is None:
        raise HTTPException(status.HTTP_409_CONFLICT, {"code": "WP222", "message": "Only an order the driver could not deliver can be moved"})
    await scalar(db, "SELECT requeue_order(:o, :r, :n, :u)",
                 {"o": order_id, "r": reason["reason_code"] or "other", "n": body.note or reason["note"] or "Moved at the end of the day",
                  "u": user.user_id})
    moved = await one(db, "SELECT delivery_date, confirmation_no FROM order_header WHERE order_id = :o", {"o": order_id})
    await db.commit()
    return moved


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


# One row per order. A trip or delivery result counts only when it belongs to the order's current delivery
# day: after a failed delivery is moved on, the old attempt shows as failed_before, not as where it is now.
_ORDER_ROW = """
    SELECT * FROM (
      SELECT DISTINCT ON (b.order_id)
             b.order_id, b.confirmation_no, b.status, b.temp, b.delivery_date, b.deferral_count, b.original_delivery_date,
             b.source, b.placed_at, b.outlet_id, b.outlet_code, b.outlet_name, b.depot_id, b.van_only, b.unload,
             b.brand_code, b.brand_name, di.name AS district, b.weight_kg, b.volume_m3, b.line_count,
             CASE WHEN c.cur THEN b.route_id END AS route_id, CASE WHEN c.cur THEN b.route_seq END AS route_seq,
             CASE WHEN c.cur THEN b.stop_seq END AS stop_seq, CASE WHEN c.cur THEN b.planned_arrival END AS planned_arrival,
             CASE WHEN c.cur THEN v.source_id END AS vehicle,
             CASE WHEN c.cur THEN cd.outcome END AS delivery_outcome, CASE WHEN c.cur THEN cd.device_time END AS delivered_at,
             b.receipt_at, b.receipt_ok, rc.label AS draft_reason,
             EXISTS (SELECT 1 FROM current_delivery f WHERE f.order_id = b.order_id AND f.outcome = 'not_delivered'
                       AND (NOT c.cur OR f.stop_id IS DISTINCT FROM b.stop_id)) AS failed_before
      FROM order_board b JOIN district di ON di.district_id = b.district_id
      LEFT JOIN vehicle v ON v.vehicle_id = b.vehicle_id
      LEFT JOIN reason_code rc ON rc.scope = 'deferral' AND rc.code = b.draft_defer_reason
      CROSS JOIN LATERAL (SELECT COALESCE((b.planned_arrival AT TIME ZONE 'Asia/Colombo')::date = b.delivery_date, true) AS cur) c
      LEFT JOIN LATERAL (SELECT d.outcome, d.device_time FROM current_delivery d
                         WHERE d.order_id = b.order_id AND d.stop_id = b.stop_id ORDER BY d.device_time DESC LIMIT 1) cd ON true
      ORDER BY b.order_id, b.planned_arrival DESC NULLS LAST
    ) x"""


@router.get("/orders")
async def day_orders(user: Dispatcher, db: DbSession, day: Annotated[date, Query(alias="date")]):
    """Every order of the depot's delivery day, where it is now, and the orders moved away from that day."""
    depot = _depot(user)
    return {
        "date": day,
        "orders": await rows(db, _ORDER_ROW + " WHERE x.depot_id = :d AND x.delivery_date = :day ORDER BY x.outlet_code, x.temp",
                             {"d": depot, "day": day}),
        "moved_away": await rows(db, """
            SELECT o.*, d.to_date, d.kind AS moved_kind, rc.label AS moved_reason, d.note AS moved_note
            FROM deferral d JOIN (""" + _ORDER_ROW + """) o ON o.order_id = d.order_id
            JOIN reason_code rc ON rc.scope = d.scope AND rc.code = d.reason_code
            WHERE d.from_date = :day AND o.depot_id = :d ORDER BY o.outlet_code""", {"d": depot, "day": day}),
    }


@router.get("/orders/{order_id}")
async def order_record(order_id: int, user: Dispatcher, db: DbSession):
    """One order's full record: what is in it, its outlet, where it is now, status trail, deferrals, proof and runs."""
    order = await one(db, _ORDER_ROW + " WHERE x.order_id = :o", {"o": order_id})
    if order is None:
        raise not_found("Order")
    order["lines"] = await rows(db, """
        SELECT l.line_no, p.sku, p.name, p.unit, l.qty, round(l.qty * p.unit_weight_kg, 2) AS kg,
               round(l.qty * p.unit_volume_m3, 3) AS m3, p.fragile, p.high_value
        FROM order_line l JOIN product p ON p.product_id = l.product_id WHERE l.order_id = :o ORDER BY l.line_no""",
        {"o": order_id})
    order["outlet"] = await one(db, """
        SELECT ou.address, ou.access_note, ou.gate_contact_name, dp.name AS depot,
               (SELECT jsonb_agg(jsonb_build_object('kind', w.kind, 'opens', w.opens, 'closes', w.closes) ORDER BY w.kind, w.opens)
                  FROM outlet_window w WHERE w.outlet_id = ou.outlet_id
                   AND w.isodow = EXTRACT(isodow FROM CAST(:day AS date))) AS windows
        FROM outlet ou JOIN depot dp ON dp.depot_id = ou.depot_id WHERE ou.outlet_id = :ou""",
        {"ou": order["outlet_id"], "day": order["delivery_date"]})
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
        "records": await rows(db, """
            SELECT l.*, dp.name AS depot FROM ledger l JOIN outlet ou ON ou.outlet_id = l.outlet_id
            JOIN depot dp ON dp.depot_id = ou.depot_id ORDER BY l.at DESC LIMIT 300"""),
        "per_day": await rows(db, "SELECT day, is_working, deferred FROM deferrals_per_day ORDER BY day"),
    }
