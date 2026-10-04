"use client";

import { useState, type ReactNode } from "react";
import { Button, Chip } from "@/components/waypoint/controls";
import { BrandMonogram, KpiTile } from "@/components/waypoint/data";
import { CapacityGauge, StatusPill } from "@/components/waypoint/status";
import { formatDay, formatDayTime, formatTime, timeLeft } from "@/lib/format";
import { cn } from "@/lib/utils";
import { BRAND, quickBlock, type PlanView, type Route, type Run, type Vehicle } from "./data";
import type { PlanActions } from "./dispatcher-app";

const CHIPS = ["All", "Chilled", "Van-only", "Fresh", "Style", "Tech"] as const;
type ChipFilter = (typeof CHIPS)[number];

/** An order the dispatcher has picked up to move: from the queue or from a stop on a trip. */
type Picked = { order_id: number; label: string; temp: string; van_only: boolean; kg: number; m3: number };

const LANE_COLUMNS = "grid grid-cols-[150px_minmax(0,1fr)_230px_80px] gap-4";
/** The lane time bar runs 03:00 to 18:00 Sri Lanka time; the dashed line marks Fresh's 08:00. */
const BAR_START = 3 * 60;
const BAR_END = 18 * 60;

function minutesOfDay(iso: string) {
  const [h, m] = formatTime(iso).split(":").map(Number);
  return h * 60 + m;
}
const barLeft = (iso: string) => `${Math.min(100, Math.max(0, ((minutesOfDay(iso) - BAR_START) / (BAR_END - BAR_START)) * 100))}%`;

/** D1 · Plan board: close orders, let the engine propose, adjust trips, then release the plan. */
export function PlanBoard({
  date,
  run,
  plan,
  loading,
  busy,
  actions,
  onGoToDeferrals,
}: {
  date: string | null;
  run: Run | null;
  plan: PlanView | null;
  loading: boolean;
  busy: boolean;
  actions: PlanActions;
  onGoToDeferrals: () => void;
}) {
  const [chip, setChip] = useState<ChipFilter>("All");
  const [picked, setPicked] = useState<Picked | null>(null);
  const [showIdle, setShowIdle] = useState(false);

  if (!date) return <Page><div className="text-wp-text-2">Loading runs…</div></Page>;

  // Before the cutoff (or before anyone closed orders) there is no plan yet.
  if (!run?.plan_id || !plan) {
    return (
      <Page>
        <h1 className="text-[22px] leading-6 font-bold">Plan board · {formatDay(date)}, Kandy depot</h1>
        {loading && run?.plan_id ? (
          <div className="text-wp-text-2">Loading the plan…</div>
        ) : (
          <div className="flex flex-col gap-3 rounded-lg border border-wp-border bg-wp-surface p-4">
            <div className="text-[15px] font-semibold">
              {run ? `${run.orders} orders placed so far` : "No orders placed for this day yet"}
            </div>
            <div className="text-wp-text-2">
              {run
                ? `Store managers can order until ${formatDayTime(run.cutoff_at)} (${timeLeft(run.cutoff_at)}). Closing orders confirms them and opens planning. Orders placed after that join the next run.`
                : "Orders appear here as store managers place them."}
            </div>
            <div>
              <Button disabled={!run || busy} onClick={() => void actions.closeOrders()}>
                Close orders now and start planning
              </Button>
            </div>
          </div>
        )}
      </Page>
    );
  }

  const released = plan.plan.state === "released";
  const s = plan.summary;
  const conflicts = plan.violations.filter((v) => v.code !== "unplanned");
  const undecided = plan.unplanned.filter((u) => !u.drafted_reason);
  const routesByVehicle = new Map<number, Route[]>();
  for (const r of plan.routes) routesByVehicle.set(r.vehicle_id, [...(routesByVehicle.get(r.vehicle_id) ?? []), r]);
  const usedVehicles = plan.vehicles.filter((v) => routesByVehicle.has(v.vehicle_id));
  const idleVehicles = plan.vehicles.filter((v) => !routesByVehicle.has(v.vehicle_id));

  const queue = plan.unplanned.filter((o) => {
    switch (chip) {
      case "Chilled": return o.temp === "chilled";
      case "Van-only": return o.van_only;
      case "Fresh": return o.brand_code === "F";
      case "Style": return o.brand_code === "S";
      case "Tech": return o.brand_code === "T";
      default: return true;
    }
  });

  async function moveTo(vehicleId: number, seq: 1 | 2) {
    if (!picked) return;
    const result = await actions.move(picked.order_id, vehicleId, seq);
    if (result.ok) setPicked(null);
  }

  const releaseLabel = released
    ? plan.plan.dirty ? `Re-issue plan v${plan.plan.version + 1}` : `Plan v${plan.plan.version} released`
    : conflicts.length + undecided.length > 0
      ? `Release plan · ${conflicts.length + undecided.length} to resolve`
      : "Release plan";

  return (
    <Page>
      <div className="flex flex-wrap items-center gap-4">
        <div>
          <h1 className="text-[22px] leading-6 font-bold">Plan board · {formatDay(date)}, Kandy depot</h1>
          <div className="mt-1 text-[11px] text-wp-text-2">
            {released ? `Plan v${plan.plan.version} released` : "Draft, not released"}
            {plan.plan.dirty && released ? " · changes not yet re-issued" : ""} · Saved {formatTime(plan.plan.edited_at)} ·
            Every move is checked against the operating rules
          </div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {!released && (
            <Button variant="secondary" disabled={busy} onClick={() => void actions.propose()}>
              {plan.routes.length ? "Re-run the engine" : "Propose plan (engine)"}
            </Button>
          )}
          <Button
            disabled={busy || conflicts.length + undecided.length > 0 || (released && !plan.plan.dirty)}
            onClick={() => void actions.release()}
          >
            {releaseLabel}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiTile label="Orders planned" value={`${s?.orders_planned ?? 0} of ${s?.orders_confirmed ?? 0}`} context="Confirmed at the cutoff" />
        <KpiTile label="Cannot fit" value={plan.unplanned.length}
                 context={undecided.length ? `${undecided.length} without a decision · open D2` : plan.unplanned.length ? "All have a deferral reason" : "Every order has a trip"} />
        <KpiTile label="Rule conflicts" value={conflicts.length} context={conflicts.length ? "Fix before release" : "No vehicle over a limit"} />
        <KpiTile label="Refrigerated vehicles free" value={`${s?.refrigerated_free ?? 0} of ${s?.refrigerated_total ?? 0}`}
                 context="Available, with no trip yet" />
      </div>

      {conflicts.length > 0 && (
        <div className="flex flex-col gap-1 rounded-lg border border-wp-crit bg-wp-crit-tint p-3 text-wp-crit">
          <div className="text-[11px] font-semibold tracking-[.06em]">✕ RULE CONFLICTS</div>
          {conflicts.map((v, i) => (
            <div key={i} className="text-[13px]">{v.message}</div>
          ))}
        </div>
      )}

      {plan.routes.length === 0 && !released && (
        <div className="rounded-lg bg-wp-info-tint px-3 py-2 text-xs font-semibold text-wp-info">
          ● No trips yet. Let the engine propose a plan that already meets every rule, then adjust it.
        </div>
      )}

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(300px,360px)_minmax(0,1fr)]">
        <section className="flex flex-col gap-3 rounded-lg border border-wp-border bg-wp-surface p-4">
          <div className="flex items-baseline justify-between">
            <h2 className="text-[15px] leading-5 font-semibold">Unplanned orders · {plan.unplanned.length}</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {CHIPS.map((c) => (
              <Chip key={c} active={chip === c} onClick={() => setChip(c)}>
                {c}
              </Chip>
            ))}
          </div>
          {queue.map((order) => {
            const open = picked?.order_id === order.order_id;
            return (
              <div
                key={order.order_id}
                onClick={() => setPicked(open ? null : {
                  order_id: order.order_id, label: `${order.outlet_code} ${order.temp}`, temp: order.temp,
                  van_only: order.van_only, kg: Number(order.weight_kg), m3: Number(order.volume_m3),
                })}
                className={cn(
                  "cursor-pointer rounded-lg border bg-wp-surface p-3",
                  open ? "border-wp-action shadow-[0_0_0_1px_var(--wp-action)]" : "border-wp-border",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <BrandMonogram brand={BRAND[order.brand_code]} outlet={`${order.district} ${order.outlet_code}`} />
                  {order.drafted_reason ? <StatusPill state="warn">Deferral decided</StatusPill> : <StatusPill state="crit">Cannot fit</StatusPill>}
                </div>
                <div className="mt-2 text-[11px] text-wp-text-2">
                  {Number(order.weight_kg)} kg · {Number(order.volume_m3)} m³ · {order.temp === "chilled" ? "Chilled" : "Ambient"}
                  {order.van_only ? " · Van-only outlet" : ""}
                </div>
                <div className="text-[11px] text-wp-text-2">System found: {order.suggested_label ?? "—"}</div>
                {open && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-wp-text-2" onClick={(e) => e.stopPropagation()}>
                    Pick a trip on the right to place it, or
                    <Button variant="secondary" onClick={onGoToDeferrals}>Decide in D2</Button>
                  </div>
                )}
              </div>
            );
          })}
          {plan.unplanned.length === 0 && plan.routes.length > 0 && (
            <div className="py-2 font-semibold text-wp-good">✓ Every order is on a trip.</div>
          )}
        </section>

        <section className="flex flex-col gap-3 rounded-lg border border-wp-border bg-wp-surface p-4">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-[15px] leading-5 font-semibold">Vehicle lanes · {usedVehicles.length} in use</h2>
            <div className="text-[11px] text-wp-muted">
              {picked ? `Placing ${picked.label} (${picked.kg} kg · ${picked.m3} m³): choose a trip` : "Select an order to move it"}
            </div>
          </div>
          {picked && (
            <div className="flex items-center gap-2 rounded-md bg-wp-info-tint px-3 py-2 text-xs font-semibold text-wp-info">
              ● Moving {picked.label}. Dimmed vehicles cannot take it; the server checks every rule when you drop it.
              <button type="button" className="ml-auto cursor-pointer underline" onClick={() => setPicked(null)}>Cancel</button>
            </div>
          )}
          <div className={cn(LANE_COLUMNS, "px-3 text-[10px] font-semibold tracking-[.06em] text-wp-muted uppercase")}>
            <div>Vehicle</div>
            <div>Trips · 03:00 to 18:00</div>
            <div>Load against limit</div>
            <div>Fuel left</div>
          </div>

          {usedVehicles.map((v) => (
            <Lane key={v.vehicle_id} vehicle={v} routes={routesByVehicle.get(v.vehicle_id) ?? []} picked={picked}
                  busy={busy} released={released} onPick={setPicked} onMove={moveTo} onActive={actions.setVehicleActive} />
          ))}
          <button type="button" className="cursor-pointer text-left text-xs font-semibold text-wp-action underline"
                  onClick={() => setShowIdle(!showIdle)}>
            {showIdle ? "Hide" : "Show"} {idleVehicles.length} vehicles without a trip
            {idleVehicles.some((v) => !v.active) ? ` (${idleVehicles.filter((v) => !v.active).length} in the workshop)` : ""}
          </button>
          {(showIdle || picked) &&
            idleVehicles.map((v) => (
              <Lane key={v.vehicle_id} vehicle={v} routes={[]} picked={picked} busy={busy} released={released}
                    onPick={setPicked} onMove={moveTo} onActive={actions.setVehicleActive} />
            ))}
          <div className="text-[11px] text-wp-muted">
            One brand and one district per trip, at most two trips per vehicle, Fresh within 270 min from 03:30,
            Style and Tech within 480 min, weight and volume, refrigeration, van-only outlets and weekly fuel.
          </div>
        </section>
      </div>
    </Page>
  );
}

function Lane({
  vehicle,
  routes,
  picked,
  busy,
  released,
  onPick,
  onMove,
  onActive,
}: {
  vehicle: Vehicle;
  routes: Route[];
  picked: Picked | null;
  busy: boolean;
  released: boolean;
  onPick: (p: Picked | null) => void;
  onMove: (vehicleId: number, seq: 1 | 2) => Promise<void>;
  onActive: (vehicleId: number, active: boolean) => Promise<unknown>;
}) {
  const block = picked ? quickBlock(picked, vehicle) : null;
  const heaviest = routes.reduce<Route | null>((a, r) => (!a || r.weight_pct > a.weight_pct ? r : a), null);
  return (
    <div className={cn("rounded-lg border border-wp-border bg-wp-surface p-3", block && "opacity-55")}>
      <div className={cn(LANE_COLUMNS, "items-center")}>
        <div>
          <div className="text-[15px] font-semibold">{vehicle.source_id}</div>
          <div className="text-[11px] text-wp-text-2">{vehicle.class} · {vehicle.code}</div>
          {!vehicle.active && <StatusPill state="offline">In workshop</StatusPill>}
        </div>
        <div className="relative h-10">
          <div className="absolute inset-x-0 top-5 h-0.5 bg-wp-border" />
          <div className="absolute top-1 bottom-0 border-l-2 border-dashed border-wp-action" style={{ left: `${((8 * 60 - BAR_START) / (BAR_END - BAR_START)) * 100}%` }} />
          {routes.map((r) =>
            r.stops.map((stop) => (
              <div key={stop.stop_id} title={`Trip ${r.route_seq} · ${stop.outlet_code} ${formatTime(stop.planned_arrival)}`}
                   className="absolute top-[15px] -ml-[5px] size-2.5 rounded-full bg-wp-text-2" style={{ left: barLeft(stop.planned_arrival) }} />
            )),
          )}
        </div>
        <div className="flex flex-col gap-1">
          {heaviest ? (
            <>
              <CapacityGauge label="Weight" value={Math.round(Number(heaviest.weight_pct))} />
              <CapacityGauge label="Volume" value={Math.round(Number(heaviest.volume_pct))} />
              <div className="text-[11px] text-wp-muted">Fullest trip · {Math.round(heaviest.weight_kg)} of {Math.round(heaviest.max_weight_kg)} kg</div>
            </>
          ) : (
            <div className="text-[11px] text-wp-muted">{Number(vehicle.max_weight_kg)} kg · {Number(vehicle.max_volume_m3)} m³ per trip</div>
          )}
        </div>
        <div className="font-semibold">{vehicle.fuel_left_l !== null ? `${Math.round(Number(vehicle.fuel_left_l))} L` : "—"}</div>
      </div>

      {routes.sort((a, b) => a.route_seq - b.route_seq).map((r) => (
        <div key={r.route_id} className="mt-2 flex flex-wrap items-center gap-2 border-t border-wp-border pt-2 text-[11px]">
          <span className="font-semibold">Trip {r.route_seq}</span>
          <BrandMonogram brand={BRAND[r.brand_code]} outlet={r.district_name} />
          <span className="text-wp-text-2">
            {formatTime(r.depart_at)}–{formatTime(r.return_at)} · {r.trip_minutes} min · {Math.round(r.weight_kg)} kg · {Number(r.volume_m3).toFixed(1)} m³
          </span>
          {r.stops.map((stop) => (
            <span key={stop.stop_id} className="flex items-center gap-1">
              <span className="text-wp-muted">→</span>
              {(stop.orders ?? []).map((o) => (
                <button
                  key={o.order_id}
                  type="button"
                  disabled={released}
                  title={released ? undefined : "Pick up this order to move it"}
                  onClick={() => onPick({ order_id: o.order_id, label: `${stop.outlet_code} ${o.temp}`, temp: o.temp,
                                          van_only: stop.van_only, kg: Number(o.kg), m3: Number(o.m3) })}
                  className={cn("rounded border px-1.5 py-0.5 font-semibold", released ? "border-wp-border" : "cursor-pointer border-wp-border hover:border-wp-action",
                                picked?.order_id === o.order_id && "border-wp-action bg-wp-info-tint")}
                >
                  {stop.outlet_code}{o.temp === "chilled" ? " ❄" : ""} {formatTime(stop.planned_arrival)}
                </button>
              ))}
            </span>
          ))}
        </div>
      ))}

      {picked && !released && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {block ? (
            <span className="text-xs font-semibold text-wp-crit">⊘ {block}</span>
          ) : (
            ([1, 2] as const).map((seq) => (
              <Button key={seq} variant="secondary" disabled={busy} onClick={() => void onMove(vehicle.vehicle_id, seq)}>
                Put on trip {seq}
              </Button>
            ))
          )}
        </div>
      )}
      {!picked && !released && routes.length === 0 && (
        <div className="mt-2">
          <Button variant="link" className="px-0" disabled={busy} onClick={() => void onActive(vehicle.vehicle_id, !vehicle.active)}>
            {vehicle.active ? "Mark as in the workshop" : "Back in service"}
          </Button>
        </div>
      )}
    </div>
  );
}

function Page({ children }: { children: ReactNode }) {
  return <div className="mx-auto flex max-w-[1440px] flex-col gap-4 p-6">{children}</div>;
}
