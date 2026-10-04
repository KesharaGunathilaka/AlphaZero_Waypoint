"use client";

import { ChevronDown, ChevronRight, Search, Snowflake, X } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button, Chip } from "@/components/waypoint/controls";
import { BrandMonogram } from "@/components/waypoint/data";
import { StatusPill } from "@/components/waypoint/status";
import { formatDay, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { BRAND, BRAND_NAME, quickBlock, type BrandCode, type PlanView, type Route, type Run, type Vehicle } from "./data";
import { DayProgress } from "./day-progress";
import type { PlanActions, Tab } from "./dispatcher-app";

const FILTERS = ["All", "Fresh", "Style", "Tech", "Chilled", "Vans"] as const;
type Filter = (typeof FILTERS)[number];

/** An order the dispatcher wants to put on another trip. */
type Moving = {
  order_id: number;
  label: string;
  temp: string;
  van_only: boolean;
  kg: number;
  m3: number;
  brand: BrandCode;
  district: string;
  from_route: number | null;
};

const ROW = "md:grid md:grid-cols-[minmax(150px,1fr)_minmax(150px,1fr)_104px_minmax(160px,1.5fr)_150px_64px_24px] md:items-center md:gap-3";

const pct = (r: Route) => Math.round(Math.max(Number(r.weight_pct), Number(r.volume_pct)));

/** Plan: the day's steps, then every trip in one scannable table. Details open on demand. */
export function PlanBoard({
  date,
  run,
  plan,
  loading,
  busy,
  actions,
  onTab,
  moveRequest,
  onMoveRequestHandled,
}: {
  date: string | null;
  run: Run | null;
  plan: PlanView | null;
  loading: boolean;
  busy: boolean;
  actions: PlanActions;
  onTab: (tab: Tab) => void;
  moveRequest: number | null;
  onMoveRequestHandled: () => void;
}) {
  const [filter, setFilter] = useState<Filter>("All");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [moving, setMoving] = useState<Moving | null>(null);
  const [showIdle, setShowIdle] = useState(false);

  // Opened from the Deferred tab: "Try to fit" this order.
  useEffect(() => {
    if (moveRequest === null || !plan) return;
    const u = plan.unplanned.find((x) => x.order_id === moveRequest);
    onMoveRequestHandled();
    if (u) {
      // A deliberate one-off hand-over from another tab, not derived state.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMoving({ order_id: u.order_id, label: `${u.outlet_code} ${u.temp}`, temp: u.temp, van_only: u.van_only,
                  kg: Number(u.weight_kg), m3: Number(u.volume_m3), brand: u.brand_code, district: u.district, from_route: null });
    }
  }, [moveRequest, plan, onMoveRequestHandled]);

  const vehicleOf = useMemo(() => new Map((plan?.vehicles ?? []).map((v) => [v.vehicle_id, v])), [plan]);

  if (!date) return <Page><div className="text-wp-text-2">Loading…</div></Page>;

  if (!run?.plan_id || !plan) {
    return (
      <Page>
        <Title date={date} subtitle={loading && run?.plan_id ? "Loading the plan…" : "Orders are still open for this day"} />
        <DayProgress run={run} plan={null} busy={busy} actions={actions} onTab={onTab} />
        <div className="rounded-lg border border-wp-border bg-wp-surface p-4 text-wp-text-2">
          Store managers place orders until the cutoff (16:00 the working day before). Closing orders confirms them;
          anything ordered later goes to the next delivery day.
        </div>
      </Page>
    );
  }

  const released = plan.plan.state === "released";
  // Before the engine runs nothing is "deferred" yet: every order is simply not planned.
  const built = plan.routes.length > 0;
  const deferred = built ? plan.unplanned : [];
  const conflicts = plan.violations.filter((v) => v.code !== "unplanned");
  const usedIds = new Set(plan.routes.map((r) => r.vehicle_id));
  const idle = plan.vehicles.filter((v) => !usedIds.has(v.vehicle_id));
  const q = query.trim().toLowerCase();

  const routes = [...plan.routes]
    .sort((a, b) => a.depart_at.localeCompare(b.depart_at) || a.vehicle_id - b.vehicle_id)
    .filter((r) => {
      const v = vehicleOf.get(r.vehicle_id);
      switch (filter) {
        case "Fresh": if (r.brand_code !== "F") return false; break;
        case "Style": if (r.brand_code !== "S") return false; break;
        case "Tech": if (r.brand_code !== "T") return false; break;
        case "Chilled": if (!r.stops.some((s) => s.orders?.some((o) => o.temp === "chilled"))) return false; break;
        case "Vans": if (!r.is_van) return false; break;
      }
      if (!q) return true;
      return [v?.source_id, r.vehicle_code, r.district_name, ...r.stops.map((s) => s.outlet_code)]
        .some((x) => x?.toLowerCase().includes(q));
    });

  function toggle(id: number) {
    const next = new Set(open);
    if (next.has(id)) next.delete(id); else next.add(id);
    setOpen(next);
  }

  const s = plan.summary;
  return (
    <Page>
      <Title
        date={date}
        subtitle={released
          ? `Plan v${plan.plan.version} sent${plan.plan.dirty ? " · you have changes not sent yet" : ""}`
          : "Draft · not sent yet · every change is checked against the operating rules"}
      />
      <DayProgress run={run} plan={plan} busy={busy} actions={actions} onTab={onTab} />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Orders on trips" value={`${s?.orders_planned ?? 0} / ${s?.orders_confirmed ?? 0}`} />
        <Stat label="Deferred" value={built ? deferred.length : "—"} tone={deferred.length ? "warn" : undefined}
              onClick={deferred.length ? () => onTab("deferrals") : undefined} />
        <Stat label="Trips" value={plan.routes.length} />
        <Stat label="Vehicles used" value={`${usedIds.size} / ${plan.vehicles.filter((v) => v.active).length}`} />
        <Stat label="Refrigerated free" value={`${s?.refrigerated_free ?? 0} / ${s?.refrigerated_total ?? 0}`} />
        <Stat label="Rule problems" value={conflicts.length} tone={conflicts.length ? "crit" : "good"} />
      </div>

      {conflicts.length > 0 && (
        <div role="alert" className="flex flex-col gap-1 rounded-lg border border-wp-crit bg-wp-crit-tint p-3 text-wp-crit">
          <div className="text-[12px] font-bold">Fix before sending · {conflicts.length} rule {conflicts.length === 1 ? "problem" : "problems"}</div>
          {conflicts.map((v, i) => <div key={i}>{v.message}</div>)}
        </div>
      )}

      {deferred.length > 0 && (
        <section className="rounded-lg border border-wp-gauge-amber bg-wp-warn-tint/60 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-wp-warn">
              ▲ {deferred.length} {deferred.length === 1 ? "order goes" : "orders go"} to{" "}
              {plan.next_operating_day ? formatDay(plan.next_operating_day) : "the next run"}
            </span>
            <span className="text-wp-text-2">No legal trip can take {deferred.length === 1 ? "it" : "them"} today.</span>
            <Button variant="link" className="ml-auto px-0" onClick={() => onTab("deferrals")}>Check reasons</Button>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {deferred.map((u) => (
              <span key={u.order_id} className="inline-flex items-center gap-2 rounded-md border border-wp-border bg-wp-surface px-2 py-1">
                <BrandMonogram brand={BRAND[u.brand_code]} outlet={u.outlet_code} />
                <span className="text-[12px] text-wp-text-2">{u.temp === "chilled" ? "❄ " : ""}{Number(u.weight_kg)} kg · {u.suggested_label ?? u.drafted_reason}</span>
                {!released && (
                  <button type="button" className="cursor-pointer text-[12px] font-semibold text-wp-focus underline"
                          onClick={() => setMoving({ order_id: u.order_id, label: `${u.outlet_code} ${u.temp}`, temp: u.temp, van_only: u.van_only,
                                                     kg: Number(u.weight_kg), m3: Number(u.volume_m3), brand: u.brand_code, district: u.district, from_route: null })}>
                    Try to fit
                  </button>
                )}
              </span>
            ))}
          </div>
        </section>
      )}

      <section className="rounded-lg border border-wp-border bg-wp-surface">
        <div className="flex flex-wrap items-center gap-2 border-b border-wp-border p-3">
          <h2 className="mr-2 text-[15px] font-semibold">Trips</h2>
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map((f) => (
              <Chip key={f} active={filter === f} onClick={() => setFilter(f)}>{f}</Chip>
            ))}
          </div>
          <label className="relative ml-auto w-full sm:w-56">
            <span className="sr-only">Find a vehicle, outlet or district</span>
            <Search aria-hidden className="pointer-events-none absolute top-2.5 left-2.5 size-3.5 text-wp-muted" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find vehicle, outlet, district"
                   className="h-9 w-full rounded-md border border-wp-border bg-wp-surface pr-2 pl-8 text-[13px] outline-none focus:border-wp-focus" />
          </label>
        </div>

        <div className={cn(ROW, "hidden border-b border-wp-border px-3 py-2 text-[10px] font-semibold tracking-[.06em] text-wp-muted uppercase md:grid")}>
          <div>Vehicle · trip</div><div>Goes to</div><div>Leaves – back</div><div>Stops in order</div><div title="The fuller of weight and volume">Load</div><div>Fuel left</div><div />
        </div>

        {routes.length === 0 && (
          <div className="p-4 text-wp-text-2">
            {built ? "No trip matches." : `No trips yet. “Build the plan” lets the engine place all ${plan.unplanned.length} orders it legally can.`}
          </div>
        )}
        {routes.map((r) => {
          const v = vehicleOf.get(r.vehicle_id);
          const isOpen = open.has(r.route_id);
          const chilled = r.stops.some((st) => st.orders?.some((o) => o.temp === "chilled"));
          const load = pct(r);
          return (
            <div key={r.route_id} className="border-b border-wp-border last:border-b-0">
              <button type="button" onClick={() => toggle(r.route_id)} aria-expanded={isOpen}
                      className={cn(ROW, "flex w-full cursor-pointer flex-col gap-1 px-3 py-2.5 text-left hover:bg-wp-surface-2/60", isOpen && "bg-wp-surface-2/60")}>
                <div className="flex w-full items-center justify-between gap-2 md:block">
                  <div>
                    <span className="text-[14px] font-bold">{v?.source_id ?? r.vehicle_code}</span>
                    <span className="text-wp-text-2"> · trip {r.route_seq}</span>
                    <div className="text-[11px] text-wp-muted">{r.vehicle_class}</div>
                  </div>
                  <span className="md:hidden">{isOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <BrandMonogram brand={BRAND[r.brand_code]} outlet={r.district_name} />
                  {chilled && <Snowflake aria-label="Carries chilled goods" className="size-3.5 text-wp-info" />}
                </div>
                <div className="font-semibold">{formatTime(r.depart_at)} – {formatTime(r.return_at)}</div>
                <div className="truncate text-wp-text-2" title={r.stops.map((st) => st.outlet_code).join(" → ")}>
                  {r.stops.length} · {r.stops.map((st) => st.outlet_code).join(" → ")}
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-2 w-16 flex-none overflow-hidden rounded bg-wp-surface-2" role="img" aria-label={`Load ${load} percent`}>
                    <div className={cn("h-full", load >= 100 ? "bg-wp-crit" : load >= 90 ? "bg-wp-gauge-amber" : "bg-wp-offline")} style={{ width: `${Math.min(load, 100)}%` }} />
                  </div>
                  <span className="text-[12px]"><b>{load}%</b> <span className="text-wp-muted">{Math.round(r.weight_kg)} kg</span></span>
                </div>
                <div className="text-[12px]">{r.fuel_left_l !== null ? `${Math.round(Number(r.fuel_left_l))} L` : "—"}</div>
                <div className="hidden md:block">{isOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}</div>
              </button>

              {isOpen && (
                <div className="flex flex-col gap-2 bg-wp-surface-2/40 px-3 pt-1 pb-3">
                  <div className="text-[12px] text-wp-text-2">
                    {r.trip_minutes} min of driving and unloading · {Math.round(r.weight_kg)} of {Math.round(r.max_weight_kg)} kg ·{" "}
                    {Number(r.volume_m3).toFixed(1)} of {Number(r.max_volume_m3).toFixed(1)} m³ · driver {r.driver_name ?? "not linked"}
                  </div>
                  <ol className="flex flex-col gap-1">
                    {r.stops.map((st) => (
                      <li key={st.stop_id} className="flex flex-wrap items-center gap-2 rounded-md bg-wp-surface px-2 py-1.5">
                        <span className="w-12 font-semibold">{formatTime(st.planned_arrival)}</span>
                        <span className="font-semibold">{st.seq}. {st.outlet_code}</span>
                        <span className="text-[12px] text-wp-muted">{st.unload.replace("_", " ")}{st.van_only ? " · van-only" : ""}</span>
                        <span className="ml-auto flex flex-wrap gap-1.5">
                          {(st.orders ?? []).map((o) => (
                            <span key={o.order_id} className="inline-flex items-center gap-1.5 rounded border border-wp-border px-1.5 py-0.5 text-[12px]">
                              {o.temp === "chilled" ? "❄ Chilled" : "Dry"} · {Number(o.kg)} kg
                              {!released && (
                                <button type="button" className="cursor-pointer font-semibold text-wp-focus underline"
                                        onClick={() => setMoving({ order_id: o.order_id, label: `${st.outlet_code} ${o.temp}`, temp: o.temp, van_only: st.van_only,
                                                                   kg: Number(o.kg), m3: Number(o.m3), brand: r.brand_code, district: r.district_name, from_route: r.route_id })}>
                                  Move
                                </button>
                              )}
                            </span>
                          ))}
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          );
        })}
      </section>

      <section className="rounded-lg border border-wp-border bg-wp-surface p-3">
        <button type="button" onClick={() => setShowIdle(!showIdle)} aria-expanded={showIdle}
                className="flex w-full cursor-pointer items-center gap-2 text-left font-semibold">
          {showIdle ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          {idle.length} vehicles without a trip
          {idle.some((v) => !v.active) && <StatusPill state="offline">{idle.filter((v) => !v.active).length} in the workshop</StatusPill>}
        </button>
        {showIdle && (
          <ul className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {idle.map((v) => (
              <li key={v.vehicle_id} className="flex items-center gap-2 rounded-md border border-wp-border px-3 py-2">
                <div className="flex-1">
                  <div className="font-semibold">{v.source_id} <span className="font-normal text-wp-muted">· {v.class}</span></div>
                  <div className="text-[12px] text-wp-text-2">{Number(v.max_weight_kg)} kg · {Number(v.max_volume_m3)} m³ · fuel {v.fuel_left_l !== null ? `${Math.round(Number(v.fuel_left_l))} L` : "—"}</div>
                </div>
                {!v.active && <StatusPill state="offline">Workshop</StatusPill>}
                {!released && (
                  <Button variant="secondary" disabled={busy} onClick={() => void actions.setVehicleActive(v.vehicle_id, !v.active)}>
                    {v.active ? "To workshop" : "Back in service"}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-[11px] text-wp-muted">
        Rules checked on every change: one brand and one district per trip · at most two trips per vehicle · Fresh within
        270 min from 03:30 · Style and Tech within 480 min · weight and volume · chilled only in refrigerated vehicles ·
        van-only outlets only by vans · delivery and mall windows · weekly fuel · vehicles in the workshop stay out.
      </p>

      {moving && (
        <MoveDialog moving={moving} plan={plan} busy={busy} onClose={() => setMoving(null)}
                    onMove={async (vehicleId, seq) => {
                      const result = await actions.move(moving.order_id, vehicleId, seq);
                      if (result.ok) setMoving(null);
                      return result.ok ? null : result.message;
                    }} />
      )}
    </Page>
  );
}

/** Pick a vehicle and trip for one order. Options that break a rule we can see are shown with the reason. */
function MoveDialog({
  moving,
  plan,
  busy,
  onClose,
  onMove,
}: {
  moving: Moving;
  plan: PlanView;
  busy: boolean;
  onClose: () => void;
  onMove: (vehicleId: number, seq: 1 | 2) => Promise<string | null>;
}) {
  const [error, setError] = useState<string | null>(null);

  type Option = { vehicle: Vehicle; seq: 1 | 2; ok: boolean; text: string; free: number };
  const options: Option[] = [];
  /** Vehicles that can never take this order, grouped by the rule (shown as one line each). */
  const blocked = new Map<string, string[]>();
  for (const v of plan.vehicles) {
    const block = quickBlock(moving, v);
    if (block) {
      blocked.set(block, [...(blocked.get(block) ?? []), v.source_id]);
      continue;
    }
    for (const seq of [1, 2] as const) {
      const trip = plan.routes.find((r) => r.vehicle_id === v.vehicle_id && r.route_seq === seq);
      if (trip?.route_id === moving.from_route) continue;
      if (!trip) {
        const other = plan.routes.find((r) => r.vehicle_id === v.vehicle_id);
        if (seq === 2 && !other) continue; // offer trip 1 first on an unused vehicle
        options.push({ vehicle: v, seq, ok: true, text: `New trip ${seq}${other ? ` after ${formatTime(other.return_at)}` : ""}`, free: Number(v.max_weight_kg) });
        continue;
      }
      if (trip.brand_code !== moving.brand || trip.district_name !== moving.district) {
        options.push({ vehicle: v, seq, ok: false, text: `Trip ${seq} goes to ${trip.district_name} with another ${trip.brand_code === moving.brand ? "district" : "brand"}`, free: -1 });
        continue;
      }
      const freeKg = Number(trip.max_weight_kg) - Number(trip.weight_kg);
      const freeM3 = Number(trip.max_volume_m3) - Number(trip.volume_m3);
      const fits = freeKg >= moving.kg && freeM3 >= moving.m3;
      options.push({ vehicle: v, seq, ok: fits, free: freeKg,
                     text: fits ? `Join trip ${seq} (${trip.stops.length} stops) · ${Math.round(freeKg)} kg free` : `Trip ${seq} is full (${Math.round(freeKg)} kg / ${freeM3.toFixed(1)} m³ free)` });
    }
  }
  options.sort((a, b) => Number(b.ok) - Number(a.ok) || b.free - a.free);

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="move-title" className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
         onClick={onClose}>
      <div className="flex max-h-[85vh] w-full max-w-[560px] flex-col rounded-t-xl bg-wp-surface shadow-xl sm:rounded-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3 border-b border-wp-border p-4">
          <div className="flex-1">
            <h2 id="move-title" className="text-[16px] font-bold">Put {moving.label} on a trip</h2>
            <div className="text-[12px] text-wp-text-2">
              {moving.kg} kg · {moving.m3} m³ · {BRAND_NAME[moving.brand]} {moving.district}
              {moving.temp === "chilled" ? " · needs a refrigerated vehicle" : ""}{moving.van_only ? " · van-only outlet" : ""}
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="cursor-pointer rounded p-1 hover:bg-wp-surface-2"><X className="size-4" /></button>
        </div>
        {error && <div role="alert" className="mx-4 mt-3 rounded-md bg-wp-crit-tint px-3 py-2 text-wp-crit">{error}</div>}
        {!options.some((o) => o.ok) && (
          <div className="mx-4 mt-3 rounded-md bg-wp-warn-tint px-3 py-2 font-semibold text-wp-warn">
            ▲ No vehicle can take it today without breaking a rule, so deferring it is unavoidable.
          </div>
        )}
        <ul className="flex-1 overflow-y-auto p-2">
          {options.map((o) => (
            <li key={`${o.vehicle.vehicle_id}-${o.seq}`}>
              <button type="button" disabled={!o.ok || busy}
                      onClick={async () => setError(await onMove(o.vehicle.vehicle_id, o.seq))}
                      className={cn("flex w-full items-center gap-3 rounded-md px-3 py-2 text-left",
                                    o.ok ? "cursor-pointer hover:bg-wp-info-tint" : "cursor-not-allowed opacity-55")}>
                <span className="w-20 font-bold">{o.vehicle.source_id}</span>
                <span className="flex-1">
                  <span className={o.ok ? "font-semibold" : ""}>{o.text}</span>
                  <span className="block text-[11px] text-wp-muted">{o.vehicle.class}</span>
                </span>
                {o.ok && <span className="text-[12px] font-semibold text-wp-focus">Choose</span>}
              </button>
            </li>
          ))}
          {[...blocked].map(([reason, ids]) => (
            <li key={reason} className="flex gap-3 px-3 py-2 opacity-70">
              <span className="w-20 flex-none font-bold">{ids.length} {ids.length === 1 ? "vehicle" : "vehicles"}</span>
              <span className="flex-1">
                <span className="font-semibold">{reason}</span>
                <span className="block text-[11px] text-wp-muted">{ids.join(", ")}</span>
              </span>
            </li>
          ))}
        </ul>
        <div className="border-t border-wp-border p-3 text-[11px] text-wp-muted">
          The server re-checks every rule (time budgets, windows, fuel) and refuses the move with the reason if one breaks.
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone, onClick }: { label: string; value: ReactNode; tone?: "warn" | "crit" | "good"; onClick?: () => void }) {
  const body = (
    <>
      <div className="text-[10px] font-semibold tracking-[.06em] text-wp-muted uppercase">{label}</div>
      <div className={cn("text-[20px] leading-6 font-bold", tone === "warn" && "text-wp-warn", tone === "crit" && "text-wp-crit", tone === "good" && "text-wp-good")}>
        {value}
      </div>
    </>
  );
  const className = "rounded-lg border border-wp-border bg-wp-surface px-3 py-2 text-left";
  return onClick ? (
    <button type="button" onClick={onClick} className={cn(className, "cursor-pointer hover:border-wp-focus")}>{body}</button>
  ) : (
    <div className={className}>{body}</div>
  );
}

function Title({ date, subtitle }: { date: string; subtitle: string }) {
  return (
    <div>
      <h1 className="text-[22px] leading-7 font-bold">Deliveries on {formatDay(date)}</h1>
      <div className="text-[12px] text-wp-text-2">{subtitle}</div>
    </div>
  );
}

function Page({ children }: { children: ReactNode }) {
  return <div className="mx-auto flex max-w-[1440px] flex-col gap-4 p-4 sm:p-6">{children}</div>;
}
