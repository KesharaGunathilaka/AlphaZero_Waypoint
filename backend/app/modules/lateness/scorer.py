"""Predicted lateness and handling time for Waypoint's plans, from our Datathon Task 1 model (task1.py).

A plan's trips are turned into the rows the model was trained on, one per order in visiting order, with the
Datathon's own planning rules: leave the depot at the trip's departure, free-flow minutes out and between stops,
the service allowance at each stop, no waiting in the plan (the model's ETA replay adds the waits). Reference
data comes from the database (calendar, traffic, road disruption); where the supplied tables stop (they end in
June 2026) it falls back to what the same data says about that month.

Per stop: the chance that the vehicle arrives after the window closes (the highest of its orders), the expected
handling minutes (the sum of its orders), the expected arrival, and a few plain reasons from the model's leading
features (§6.3: replayed slack, road disruption, stop position).
"""

import asyncio
import calendar as cal
import hashlib
import logging
from datetime import date, datetime, timedelta
from functools import lru_cache
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.modules.common import rows
from app.modules.lateness.task1 import Task1Model, add_static_features

logger = logging.getLogger(__name__)

LIKELY = 0.5   # shown as "likely late"
AT_RISK = 0.2  # shown as a risk with its percentage
JUMP = 0.2     # Live: how far a stop's chance must rise since release to raise an alert
MONSOON_MONTHS = {3, 4, 5, 6, 10, 11}  # every year of calendar.csv: March to June and October to November


@lru_cache(maxsize=1)
def get_model() -> Task1Model | None:
    model_dir = get_settings().LATENESS_MODEL_DIR
    if not model_dir:
        return None
    try:
        model = Task1Model.load(model_dir)
    except FileNotFoundError:
        logger.warning("LATENESS_MODEL_DIR=%s has no installed model: run scripts/install_lateness_model.py", model_dir)
        return None
    logger.info("Lateness model loaded: %s", model.version)
    return model


def _payday(d: date) -> bool:
    """calendar.csv's rule: the 25th and the last day of the month, a Sunday moved to the Saturday before."""
    last = cal.monthrange(d.year, d.month)[1]
    days = {25, last}
    return any(d == (x - timedelta(days=1) if x.isoweekday() == 7 else x) for x in (date(d.year, d.month, n) for n in days))


async def _reference(db: AsyncSession, days: list[date]) -> tuple[dict[str, pd.DataFrame], dict[date, dict]]:
    traffic = pd.DataFrame(await rows(db, """
        SELECT di.name AS district, t.hour::int AS hour, t.monsoon::int AS monsoon, t.speed_index::int AS speed_index
        FROM traffic_speed t JOIN district di USING (district_id)"""))
    road, calendar, info = [], [], {}
    for day in days:
        road += await rows(db, """
            SELECT di.name AS district, CAST(:d AS text) AS date,
                   COALESCE(rc.disruption_index, m.typical)::int AS disruption_index, rc.disruption_index IS NULL AS typical
            FROM district di
            LEFT JOIN road_condition rc ON rc.district_id = di.district_id AND rc.day = CAST(:d AS date)
            LEFT JOIN LATERAL (SELECT percentile_disc(0.5) WITHIN GROUP (ORDER BY x.disruption_index) AS typical
                               FROM road_condition x WHERE x.district_id = di.district_id
                                 AND EXTRACT(month FROM x.day) = EXTRACT(month FROM CAST(:d AS date))) m ON true""",
                          {"d": day})
        c = (await rows(db, """SELECT is_payday::int AS is_payday, COALESCE(festival_ramp, 0)::float AS festival_ramp,
                                      is_holiday::int AS is_holiday, monsoon::int AS monsoon
                               FROM calendar_day WHERE day = CAST(:d AS date)""", {"d": day})) or [{
            "is_payday": int(_payday(day)), "festival_ramp": 0.0, "is_holiday": 0, "monsoon": int(day.month in MONSOON_MONTHS)}]
        calendar.append({"date": str(day), **c[0]})
        info[day] = c[0]
    road_df = pd.DataFrame(road)
    ref = {"traffic": traffic, "road": road_df[["district", "date", "disruption_index"]],
           "calendar": pd.DataFrame(calendar)}
    return ref, {"calendar": info, "typical_road": {(r["district"], r["date"]) for r in road if r["typical"]}}


async def _route_rows(db: AsyncSession, routes: list[int], orders: list[int] | None = None) -> list[dict]:
    """Every stop and order on these routes (and on the routes carrying these orders), through
    model_route_rows(): a store manager may read the whole trip for the model, never in an answer."""
    found = await rows(db, "SELECT model_route_rows(ARRAY(SELECT value::int FROM jsonb_array_elements_text(CAST(:r AS jsonb))), "
                       "ARRAY(SELECT value::bigint FROM jsonb_array_elements_text(CAST(:o AS jsonb)))) AS row",
                       {"r": routes, "o": orders or []})
    out = [r["row"] for r in found]
    for r in out:
        r["service_date"] = date.fromisoformat(r["service_date"])
    return sorted(out, key=lambda r: (r["route_id"], r["stop_seq"], r["order_id"]))


def _model_rows(raw: list[dict], cal_info: dict, kg_per_unit: dict, now: dict | None = None) -> pd.DataFrame:
    """The Datathon's row for each order: its route leg and its planned times. With `now` (Live: the local date
    and minute at the depot), also where the van really is: when it left, which stops it reached and left."""
    out = []
    for route_id in dict.fromkeys(r["route_id"] for r in raw):
        trip = [r for r in raw if r["route_id"] == route_id]
        arrival = allowance = None
        for k, r in enumerate(trip):
            travel, dist = (r["out_min"], r["out_km"]) if k == 0 else (r["hop_min"], r["hop_km"])
            depart = r["depart_min"] if k == 0 else arrival + allowance
            arrival, allowance = depart + travel, r["allowance"]
            temp = "chilled" if r["temp"] in ("chilled", "frozen") else "ambient"
            day = r["service_date"]
            today = now is not None and now["date"] == day
            if r["departed_min"] is not None:
                start_delay = r["departed_min"] - r["depart_min"]
            elif today and r["route_state"] == "loaded" and now["min"] > r["depart_min"]:
                start_delay = now["min"] - r["depart_min"]  # still at the depot, already this late
            else:
                start_delay = np.nan
            prev = trip[k - 1] if k else None
            moving = today and r["route_state"] in ("loaded", "on_the_way") and r["arrived_min"] is None
            out.append({
                "route_id": route_id, "seq": k, "n_stops": len(trip), "stop_id": r["stop_id"], "date": pd.Timestamp(day),
                "dow": day.weekday(), "monsoon": cal_info[day]["monsoon"],
                "outlet_id": r["outlet_id"], "to_outlet": r["outlet_id"], "from_point": "DEPOT" if k == 0 else trip[k - 1]["outlet_id"],
                "brand": r["brand"], "district": r["district"], "depot": r["depot"], "dock_type": r["dock_type"],
                "parking_constraint": "van_only" if r["van_only"] else "mall_dock" if r["dock_type"] == "mall_bay" else "normal",
                "temp_requirement": temp, "dispatch_status": "deferred" if r["deferral_count"] else "attempted",
                "vehicle_id": r["vehicle_id"], "vehicle_type": "van" if r["is_van"] else "truck",
                "vehicle_temp": "reefer" if r["carries_chilled"] else "ambient",
                "weight_cap_kg": r["weight_cap_kg"], "volume_cap_m3": r["volume_cap_m3"],
                "order_units": max(1, round(r["kg"] / kg_per_unit.get(f"{r['brand']}|{temp}", 10.0))),
                "order_weight_kg": r["kg"], "order_volume_m3": r["m3"], "service_allowance_min": allowance,
                "distance_km": dist, "planned_depart_min": depart, "planned_travel_duration_min": travel,
                "planned_arrival_min": arrival, "window_open_min": _num(r["opens_min"]), "window_close_min": _num(r["closes_min"]),
                "start_delay": start_delay,
                "live_arrival_min": _num(r["arrived_min"]),
                "live_leave_min": _num(prev["done_min"]) if prev and prev["stop_id"] != r["stop_id"] else np.nan,
                "live_not_before_min": float(now["min"]) if moving else np.nan,
                "tz": r["tz"],
            })
    return pd.DataFrame(out)


def _num(x) -> float:
    return float(x) if x is not None else np.nan


def _clock(day: date, minutes: float, tz: str) -> str:
    return (datetime.combine(day, datetime.min.time(), ZoneInfo(tz)) + timedelta(minutes=round(float(minutes)))).isoformat()


def _stops(d: pd.DataFrame, typical_road: set) -> dict[int, dict]:
    out = {}
    for stop_id, g in d.groupby("stop_id", sort=False):
        worst = g.loc[g["p_late"].idxmax()]
        first = g.iloc[0]
        p, svc, allow = float(g["p_late"].max()), float(g["p_svc"].sum()), float(g["service_allowance_min"].sum())
        why = []
        slack = float(worst["eta2_slack_min"])
        why.append(f"expected {round(-slack)} min after the window closes" if slack < 0
                   else f"expected {round(slack)} min before the window closes")
        delay = float(first["start_delay"])
        if not np.isnan(delay) and delay >= 15:
            why.append(f"the van left {round(delay)} min late")
        if worst["disruption_index"] < 85:
            typical = (worst["district"], worst["date_str"]) in typical_road
            why.append(f"roads in {worst['district']} at {int(worst['disruption_index'])}/100"
                       + (" (usual for the month)" if typical else " today"))
        if worst["n_stops"] >= 4 and worst["seq_frac"] > 0.6:
            why.append(f"order {int(worst['seq']) + 1} of {int(worst['n_stops'])} on the trip: earlier delays add up")
        if svc > allow + 3:
            why.append(f"handling about {round(svc)} min against {round(allow)} planned")
        day = first["date"].date()
        out[int(stop_id)] = {
            "late_probability": round(p, 4),
            "level": "likely" if p >= LIKELY else "risk" if p >= AT_RISK else "ok",
            "service_minutes": round(svc, 1),
            "allowance_minutes": round(allow),
            "expected_arrival": _clock(day, first["eta2_min"], first["tz"]),
            "window_closes": None if np.isnan(first["window_close_min"]) else _clock(day, first["window_close_min"], first["tz"]),
            "why": why,
        }
    return out


_CACHE: dict[str, dict] = {}


def _score(model: Task1Model, d: pd.DataFrame, ref: dict, live: bool, typical_road: set) -> dict[int, dict]:
    key = hashlib.sha256(pd.util.hash_pandas_object(d.drop(columns=["date"]), index=False).values.tobytes()
                         + str(live).encode()).hexdigest()
    if key not in _CACHE:
        if len(_CACHE) > 64:
            _CACHE.clear()
        ref = {**ref, "vehicles": d[["vehicle_id", "weight_cap_kg", "volume_cap_m3"]].drop_duplicates("vehicle_id"),
               "outlets": d[["outlet_id", "dock_type"]].drop_duplicates("outlet_id").assign(
                   mall_window=lambda x: np.where(x.dock_type.eq("mall_bay"), "mall", None))}
        feats = add_static_features(d.drop(columns=["weight_cap_kg", "volume_cap_m3"]), ref)
        feats = model.features(feats, live=live)
        _CACHE[key] = _stops(feats.join(model.predict(feats)), typical_road)
    return _CACHE[key]


async def _routes_of(db: AsyncSession, plan_ids: list[int], unfinished: bool = False) -> list[int]:
    """The plans' trips; `unfinished`: only today's trips that are not back yet (all Live needs)."""
    if not plan_ids:
        return []
    return [r["route_id"] for r in await rows(db, """
        SELECT r.route_id FROM route r JOIN plan p ON p.plan_id = r.plan_id JOIN depot dp ON dp.depot_id = r.depot_id
        WHERE r.plan_id IN (SELECT value::int FROM jsonb_array_elements_text(CAST(:p AS jsonb)))
          AND (NOT :u OR (r.state IN ('planned', 'loading', 'loaded', 'on_the_way')
                          AND p.service_date = (app_now() AT TIME ZONE dp.tz)::date))""",
        {"p": plan_ids, "u": unfinished})]


async def _now(db: AsyncSession, tz: str) -> dict:
    """The present at the depot (the demo clock when it runs): its date and minute of the day."""
    at = (await rows(db, "SELECT app_now() AS t"))[0]["t"].astimezone(ZoneInfo(tz))
    return {"date": at.date(), "min": at.hour * 60 + at.minute}


async def _scored(db: AsyncSession, model: Task1Model, raw: list[dict], now: dict | None) -> dict[int, dict]:
    ref, extra = await _reference(db, sorted({r["service_date"] for r in raw}))
    d = _model_rows(raw, extra["calendar"], model.history.get("kg_per_unit", {}), now)
    return await asyncio.to_thread(_score, model, d, ref, now is not None, extra["typical_road"])


async def predict_plans(db: AsyncSession, plan_ids: list[int]) -> dict | None:
    """Per stop of these plans, as planned (before any van leaves): late probability, expected handling and
    arrival, reasons. None without a model."""
    model = get_model()
    if model is None or not plan_ids:
        return None
    raw = await _route_rows(db, await _routes_of(db, plan_ids))
    result = {"model": model.version, "history_cutoff": model.history["cutoff"], "stops": {}}
    if raw:
        result["stops"] = await _scored(db, model, raw, None)
    return result


async def watch(db: AsyncSession, plan_ids: list[int] | None = None, orders: list[int] | None = None) -> dict | None:
    """Live: every stop scored again from where its van really is, and an alert where the chance of missing the
    window has risen since the plan was sent (JUMP or more, to LIKELY or more), for a stop not reached yet on a
    trip that has left or is late leaving. Before departure the model mostly repeats each stop's history; the
    rise is what today's delays add. The store's answer, if any, rides on the alert."""
    model = get_model()
    if model is None or not (plan_ids or orders):
        return None
    raw = await _route_rows(db, await _routes_of(db, plan_ids or [], unfinished=True), orders)
    result = {"model": model.version, "history_cutoff": model.history["cutoff"], "stops": {}, "alerts": {}}
    if not raw:
        return result
    now = await _now(db, raw[0]["tz"])
    live = await _scored(db, model, raw, now)
    stop_ids = list(live)
    base = {r["stop_id"]: float(r["value"]) for r in await rows(db, """
        SELECT DISTINCT ON (stop_id) stop_id, value FROM prediction
        WHERE subject = 'late_probability' AND stop_id IN (SELECT value::int FROM jsonb_array_elements_text(CAST(:s AS jsonb)))
        ORDER BY stop_id, generated_at""", {"s": stop_ids})}
    if len(base) < len(stop_ids):  # released before the model was installed: score the plan as it was sent
        planned = await _scored(db, model, raw, None)
        base = {s: base.get(s, planned[s]["late_probability"]) for s in stop_ids}
    replies = {r["stop_id"]: r for r in await rows(db, """
        SELECT DISTINCT ON (stop_id) stop_id, answer, receive_until, replied_at FROM receiving_reply
        WHERE stop_id IN (SELECT value::int FROM jsonb_array_elements_text(CAST(:s AS jsonb))) ORDER BY stop_id, replied_at DESC""", {"s": stop_ids})}
    first: dict[int, dict] = {}
    for r in raw:
        first.setdefault(r["stop_id"], r)
    for sid, f in live.items():
        r = first[sid]
        today = now["date"] == r["service_date"]
        watched = today and (r["route_state"] == "on_the_way"
                             or (r["route_state"] == "loaded" and r["departed_min"] is None and now["min"] > r["depart_min"]))
        rose = f["late_probability"] - base[sid]
        alert = watched and r["arrived_min"] is None and f["late_probability"] >= LIKELY and rose >= JUMP
        result["stops"][str(sid)] = {**f, "level": "likely" if alert else "ok", "was": round(base[sid], 4)}
        if alert:
            reply = replies.get(sid)
            result["alerts"][str(sid)] = {
                **f, "was": round(base[sid], 4), "stop_id": sid, "route_id": r["route_id"], "run_id": r["run_id"],
                "outlet_code": r["outlet_id"], "outlet_name": r["outlet_name"], "depot": r["depot_name"],
                "reply": None if reply is None else {k: reply[k] for k in ("answer", "receive_until", "replied_at")},
            }
    return result


async def notices(db: AsyncSession, order_ids: list[int]) -> dict[int, dict]:
    """For a store's own orders on the road: the model's expected arrival and, when the dispatcher has the alert,
    that it is likely to be after the window, with the store's answer so far."""
    found = await watch(db, orders=order_ids) if order_ids else None
    if not found:
        return {}
    stop_of = {r["order_id"]: r["stop_id"] for r in await rows(db, """
        SELECT order_id, stop_id FROM stop_order WHERE order_id IN (SELECT value::bigint FROM jsonb_array_elements_text(CAST(:o AS jsonb))) AND removed_at IS NULL""",
        {"o": order_ids})}
    replies = {r["order_id"]: r for r in await rows(db, """
        SELECT DISTINCT ON (order_id) order_id, answer, receive_until, replied_at FROM receiving_reply
        WHERE order_id IN (SELECT value::bigint FROM jsonb_array_elements_text(CAST(:o AS jsonb))) ORDER BY order_id, replied_at DESC""", {"o": order_ids})}
    out = {}
    for oid in order_ids:
        sid = stop_of.get(oid)
        f = found["stops"].get(str(sid)) if sid else None
        if f is None:
            continue
        alert = found["alerts"].get(str(sid))
        reply = replies.get(oid)
        out[oid] = {"expected_arrival": f["expected_arrival"], "window_closes": f["window_closes"],
                    "likely_late": alert is not None, "late_probability": alert["late_probability"] if alert else None,
                    "reply": None if reply is None else {k: reply[k] for k in ("answer", "receive_until", "replied_at")}}
    return out


async def record(db: AsyncSession, plan_id: int) -> int:
    """Keep what the model says about each stop at release, before any vehicle leaves (append-only): the
    baseline Live measures today's rise against."""
    found = await predict_plans(db, [plan_id])
    if not found or not found["stops"]:
        return 0
    values = []
    for stop_id, s in found["stops"].items():
        values += [{"s": stop_id, "k": "late_probability", "v": s["late_probability"]},
                   {"s": stop_id, "k": "service_minutes", "v": s["service_minutes"]}]
    await rows(db, """
        INSERT INTO prediction (subject, stop_id, target_date, value, model_version)
        SELECT x->>'k', (x->>'s')::int, p.service_date, (x->>'v')::numeric, :m
        FROM jsonb_array_elements(CAST(:vals AS jsonb)) x CROSS JOIN plan p WHERE p.plan_id = :p
        RETURNING prediction_id""", {"vals": values, "m": found["model"], "p": plan_id})
    return len(found["stops"])
