"""Allocation engine: proposes trips for one plan. The database validates (plan_violations).

Rules come from the Challenge Booklet only:
  one brand + one district per trip, chilled only on refrigerated vehicles, van-only outlets only by
  vans, home depot, whole orders, weight AND volume per trip, at most two trips per vehicle,
  trip minutes = outbound + inter-stop x (orders - 1) + service allowance per order,
  Fresh trips <= 270 min in total and not before 03:30, Style + Tech trips <= 480 min in total,
  delivery/mall windows (an early vehicle waits), weekly fuel quota, workshop vehicles excluded.

Strategy (greedy, explainable):
  1. Scarcest resource first: van-only chilled, van-only ambient, other chilled, other ambient.
  2. Inside a pool, orders that were already deferred go first, then Fresh, then the earliest window
     close, then the largest order.
  3. Each trip starts from the highest-priority order left in its brand + district group and takes the
     vehicle that can carry the most of that group; stops are visited earliest window close first.
  4. Whatever cannot be placed is drafted as a deferral with the reason the database suggests.
"""

from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.common import rows, scalar

COLOMBO = timezone(timedelta(hours=5, minutes=30))  # Sri Lanka has no daylight saving


@dataclass
class Order:
    order_id: int
    outlet_id: int
    outlet_code: str
    brand: str  # F, S, T
    brand_id: int
    district_id: int
    temp: str
    kg: float
    m3: float
    van_only: bool
    unload: str
    opens: time | None
    closes: time | None
    deferral_count: int

    @property
    def pool(self) -> int:
        chilled = self.temp != "ambient"
        return (0 if chilled else 1) if self.van_only else (2 if chilled else 3)

    def priority(self):
        return (-self.deferral_count, self.brand != "F", self.closes or time(23, 59), -self.kg)


@dataclass
class Vehicle:
    vehicle_id: int
    code: str
    is_van: bool
    reefer: bool
    max_kg: float
    max_m3: float
    km_per_l: float
    fuel_left: float
    driver_id: int | None
    trips: list = field(default_factory=list)  # (fresh?, minutes, end datetime)

    def fresh_minutes(self):
        return sum(m for fresh, m, _ in self.trips if fresh)

    def day_minutes(self):
        return sum(m for fresh, m, _ in self.trips if not fresh)

    def free_at(self):
        return max((end for _, _, end in self.trips), default=None)

    def can_carry(self, o: Order) -> bool:
        return (self.reefer or o.temp == "ambient") and (self.is_van or not o.van_only)


@dataclass
class District:
    outbound_min: int
    inter_min: int
    outbound_km: float
    inter_km: float


@dataclass
class Trip:
    vehicle: Vehicle
    orders: list[Order]
    depart: datetime
    minutes: int
    end: datetime
    stops: list[tuple[int, datetime]]  # (outlet_id, planned arrival)


class Planner:
    def __init__(self, service_date: date, districts, allowance, budgets):
        self.day = service_date
        self.districts: dict[int, District] = districts
        self.allowance: dict[tuple[int, str], int] = allowance
        self.fresh_budget, self.day_budget, self.fresh_start = budgets

    def at(self, t: time) -> datetime:
        return datetime.combine(self.day, t, COLOMBO)

    def simulate(self, v: Vehicle, orders: list[Order]) -> Trip | None:
        """Trip for these orders on this vehicle, or None if any booklet rule fails."""
        if not orders or len(v.trips) >= 2:
            return None
        if any(not v.can_carry(o) for o in orders):
            return None
        if sum(o.kg for o in orders) > v.max_kg or sum(o.m3 for o in orders) > v.max_m3:
            return None
        d = self.districts[orders[0].district_id]
        fresh = orders[0].brand == "F"
        n = len(orders)
        minutes = d.outbound_min + d.inter_min * (n - 1) + sum(self.allowance[(o.brand_id, o.unload)] for o in orders)
        if fresh and v.fresh_minutes() + minutes > self.fresh_budget:
            return None
        if not fresh and v.day_minutes() + minutes > self.day_budget:
            return None
        fuel = (2 * d.outbound_km + d.inter_km * (n - 1)) / v.km_per_l  # route distance incl. the return
        if fuel > v.fuel_left:  # fuel_left already excludes this vehicle's earlier trips
            return None

        # Visit stops earliest window close first; one stop per outlet.
        by_outlet: dict[int, list[Order]] = {}
        for o in sorted(orders, key=lambda o: (o.closes or time(23, 59), o.opens or time(0))):
            by_outlet.setdefault(o.outlet_id, []).append(o)
        first = next(iter(by_outlet.values()))[0]
        earliest = self.at(self.fresh_start) if fresh else self.at(time(0))
        if v.free_at():
            earliest = max(earliest, v.free_at())
        depart = earliest
        if first.opens:  # leave so the vehicle reaches the first stop as it opens, not earlier
            depart = max(depart, self.at(first.opens) - timedelta(minutes=d.outbound_min))

        t = depart + timedelta(minutes=d.outbound_min)
        stops: list[tuple[int, datetime]] = []
        for i, (outlet_id, group) in enumerate(by_outlet.items()):
            if i:
                t += timedelta(minutes=d.inter_min)
            o = group[0]
            if o.opens and t < self.at(o.opens):
                t = self.at(o.opens)  # early: wait for the window
            if o.closes and t > self.at(o.closes):
                return None  # window missed
            stops.append((outlet_id, t))
            t += timedelta(minutes=sum(self.allowance[(x.brand_id, x.unload)] for x in group)
                           + d.inter_min * (len(group) - 1))
        end = max(t, depart + timedelta(minutes=minutes))
        return Trip(v, orders, depart, minutes, end, stops)

    def fill(self, v: Vehicle, group: list[Order]) -> Trip | None:
        """Start with the first order of the group, then add every further order that still fits."""
        chosen: list[Order] = []
        best: Trip | None = None
        for o in group:
            trial = self.simulate(v, chosen + [o])
            if trial is not None:
                chosen.append(o)
                best = trial
            elif not chosen:
                return None  # this vehicle cannot even take the group's top order
        return best

    def plan(self, orders: list[Order], vehicles: list[Vehicle]) -> tuple[list[Trip], list[Order]]:
        trips: list[Trip] = []
        left: list[Order] = []
        for pool in range(4):
            groups: dict[tuple[str, int], list[Order]] = {}
            for o in sorted((o for o in orders if o.pool == pool), key=Order.priority):
                groups.setdefault((o.brand, o.district_id), []).append(o)
            for group in sorted(groups.values(), key=lambda g: g[0].priority()):
                while group:
                    candidates = []
                    for v in vehicles:
                        trip = self.fill(v, group)
                        if trip:
                            served = sum(o.kg for o in trip.orders)
                            # carry the most; then save vans and refrigerated vehicles for the work only they can do
                            wasted = (v.is_van and not any(o.van_only for o in trip.orders)) + \
                                     (v.reefer and all(o.temp == "ambient" for o in trip.orders))
                            candidates.append((-served, wasted, v.max_kg, v.vehicle_id, trip))
                    if not candidates:
                        left.append(group.pop(0))  # nothing can take the top order: it waits
                        continue
                    trip = min(candidates, key=lambda c: c[:4])[4]
                    trip.vehicle.trips.append((trip.orders[0].brand == "F", trip.minutes, trip.end))
                    d = self.districts[trip.orders[0].district_id]
                    trip.vehicle.fuel_left -= (2 * d.outbound_km + d.inter_km * (len(trip.orders) - 1)) / trip.vehicle.km_per_l
                    trips.append(trip)
                    taken = {o.order_id for o in trip.orders}
                    group[:] = [o for o in group if o.order_id not in taken]
        return trips, left


async def propose(db: AsyncSession, plan_id: int, actor_id: int) -> dict:
    """Replace the plan's unreleased trips with the engine's proposal and draft deferrals for the rest."""
    plan = (await rows(db, "SELECT plan_id, run_id, depot_id, service_date, state FROM plan WHERE plan_id = :p",
                       {"p": plan_id}))[0]

    # Start clean: drop this plan's draft trips and deferral drafts (orders return to the queue).
    await rows(db, "DELETE FROM deferral_draft WHERE plan_id = :p RETURNING 1", {"p": plan_id})
    await rows(db, "DELETE FROM stop_order WHERE plan_id = :p RETURNING 1", {"p": plan_id})
    await rows(db, "DELETE FROM stop WHERE plan_id = :p RETURNING 1", {"p": plan_id})
    await rows(db, "DELETE FROM route WHERE plan_id = :p RETURNING 1", {"p": plan_id})

    isodow = plan["service_date"].isoweekday()
    orders = [Order(**r) for r in await rows(db, """
        SELECT h.order_id, ou.outlet_id, ou.code AS outlet_code, b.code AS brand, b.brand_id, ou.district_id,
               h.temp::text AS temp, h.weight_kg::float AS kg, h.volume_m3::float AS m3, ou.van_only,
               ou.unload::text AS unload, w.opens, w.closes, h.deferral_count
        FROM order_header h JOIN outlet ou ON ou.outlet_id = h.outlet_id JOIN brand b ON b.brand_id = ou.brand_id
        LEFT JOIN LATERAL (SELECT min(opens) AS opens, max(closes) AS closes FROM outlet_window
                           WHERE outlet_id = ou.outlet_id AND isodow = :dow) w ON true
        WHERE h.run_id = :run AND h.status IN ('confirmed', 'planned')""",
        {"run": plan["run_id"], "dow": isodow})]
    vehicles = [Vehicle(**r) for r in await rows(db, """
        SELECT v.vehicle_id, v.code, c.is_van, c.carries_chilled AS reefer, v.max_weight_kg::float AS max_kg,
               v.max_volume_m3::float AS max_m3, v.km_per_l::float AS km_per_l,
               COALESCE(fuel_left(v.vehicle_id, :p), 1e9)::float AS fuel_left,
               (SELECT user_id FROM app_user u WHERE u.vehicle_id = v.vehicle_id AND u.active) AS driver_id
        FROM vehicle v JOIN vehicle_class c USING (class_id)
        WHERE v.depot_id = :depot AND v.active ORDER BY v.vehicle_id""",
        {"p": plan_id, "depot": plan["depot_id"]})]
    districts = {r["district_id"]: District(r["o"], r["i"], float(r["ok"]), float(r["ik"])) for r in await rows(db, """
        SELECT district_id, depot_to_district_freeflow_min AS o, inter_stop_freeflow_min AS i,
               depot_to_district_km AS ok, inter_stop_km AS ik FROM district""")}
    allowance = {(r["brand_id"], r["unload"]): r["minutes"] for r in
                 await rows(db, "SELECT brand_id, unload::text AS unload, minutes FROM service_allowance")}
    budgets = (int(await scalar(db, "SELECT setting_int('fresh_budget_minutes')")),
               int(await scalar(db, "SELECT setting_int('daytime_budget_minutes')")),
               time.fromisoformat(await scalar(db, "SELECT value FROM setting WHERE key = 'fresh_window_start'")))

    planner = Planner(plan["service_date"], districts, allowance, budgets)
    trips, left = planner.plan(orders, vehicles)

    # Write the trips through the workflow functions, so every database rule is checked again.
    for trip in sorted(trips, key=lambda t: (t.vehicle.vehicle_id, t.depart)):
        seq = 1 + sum(1 for t in trips if t.vehicle is trip.vehicle and t.depart < trip.depart)
        first = trip.orders[0]
        route_id = await scalar(db, """
            INSERT INTO route(plan_id, depot_id, brand_id, district_id, vehicle_id, driver_id, seq, depart_at, return_at)
            VALUES (:p, :depot, :brand, :district, :v, :driver, :seq, CAST(:dep AS timestamptz), CAST(:dep AS timestamptz) + interval '1 minute') RETURNING route_id""",
            {"p": plan_id, "depot": plan["depot_id"], "brand": first.brand_id, "district": first.district_id,
             "v": trip.vehicle.vehicle_id, "driver": trip.vehicle.driver_id, "seq": seq, "dep": trip.depart})
        for stop_seq, (outlet_id, arrival) in enumerate(trip.stops, start=1):
            stop_id = await scalar(db, """
                INSERT INTO stop(route_id, plan_id, seq, outlet_id, planned_arrival, service_minutes)
                VALUES (:r, :p, :s, :o, :a, 1) RETURNING stop_id""",
                {"r": route_id, "p": plan_id, "s": stop_seq, "o": outlet_id, "a": arrival})
            for o in trip.orders:
                if o.outlet_id == outlet_id:
                    await scalar(db, "SELECT assign_order(:o, :s, :u)", {"o": o.order_id, "s": stop_id, "u": actor_id})
        await scalar(db, "SELECT retime_route(:r, :u)", {"r": route_id, "u": actor_id})

    for o in left:
        reason = await scalar(db, "SELECT suggested_reason(:o, :p)", {"o": o.order_id, "p": plan_id})
        await scalar(db, "SELECT draft_deferral(:p, :o, :r, NULL, :u)",
                     {"p": plan_id, "o": o.order_id, "r": reason, "u": actor_id})

    return {"trips": len(trips), "orders_planned": sum(len(t.orders) for t in trips),
            "orders_deferred": [{"order_id": o.order_id, "outlet": o.outlet_code, "temp": o.temp, "kg": o.kg}
                                for o in left]}
