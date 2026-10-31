"use client";

import { ChevronDown, ChevronRight, Search, Snowflake, X } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button, Chip } from "@/components/waypoint/controls";
import { BrandMonogram } from "@/components/waypoint/data";
import { StatusPill } from "@/components/waypoint/status";
import { TimeWindow } from "@/components/waypoint/time-window";
import { errorMessage, useApi, useApiData } from "@/lib/api/use-api";
import { formatDay, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { BRAND, BRAND_NAME, quickBlock, type BrandCode, type PlanView, type Route, type Run, type Vehicle, type WhatIf } from "./data";
import { DayProgress } from "./day-progress";
import { ForecastLine, LateRisk, ModelNote, countLevel, forecastOf, percent, worstStop } from "./late-risk";
import { LaneTimeline, type Lane } from "./lane-timeline";
import { OutlookPanel } from "./outlook";
import { OrderLink } from "./order-panel";
import type { PlanActions, Tab } from "./dispatcher-app";

const FILTERS = ["All", "Fresh", "Style", "Tech", "Chilled", "Vans", "Late risk"] as const;
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

const ROW = "md:grid md:grid-cols-[minmax(150px,1fr)_minmax(150px,1fr)_104px_minmax(160px,1.5fr)_180px_64px_24px] md:items-center md:gap-3";

const pct = (r: Route) => Math.round(Math.max(Number(r.weight_pct), Number(r.volume_pct)));
/** Which limit the trip reaches first: that is the one that stops more orders going on it. */
const bindingBy = (r: Route) => (Number(r.volume_pct) >= Number(r.weight_pct) ? "volume" : "weight");
/** The planned time of the trip's last delivery. */
const lastDrop = (r: Route) => r.stops[r.stops.length - 1]?.planned_arrival ?? null;

const BRAND_BAR: Record<BrandCode, string> = {
  F: "border-wp-brand-fresh bg-wp-brand-fresh/15",
  S: "border-wp-brand-style bg-wp-brand-style/15",
  T: "border-wp-brand-tech bg-wp-brand-tech/15",
};
const BRAND_FILL: Record<BrandCode, string> = { F: "bg-wp-brand-fresh/35", S: "bg-wp-brand-style/35", T: "bg-wp-brand-tech/35" };

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
  const [showTimeline, setShowTimeline] = useState(true);
  // Predicted lateness is folded away: before vans leave it mostly repeats each store's history.
  const [showLate, setShowLate] = useState(false);

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
        <OutlookPanel date={date} />
        <p className="text-[11px] text-wp-muted">
          Store managers place orders until the cutoff (16:00 the working day before). Orders close on their own then;
          anything ordered later goes to the next delivery day.
        </p>
      </Page>
    );
  }

  const released = plan.plan.state === "released";
  const late = showLate || filter === "Late risk" ? plan.lateness : null;
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
        case "Late risk": if (!r.stops.some((st) => (forecastOf(plan.lateness, st.stop_id)?.level ?? "ok") !== "ok")) return false; break;
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

  /** From the timeline: open the trip's row in the table and bring it into view. */
  function reveal(id: number) {
    setFilter("All");
    setQuery("");
    setOpen((o) => new Set(o).add(id));
    requestAnimationFrame(() => document.getElementById(`trip-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }

  const lanes: Lane[] = [...new Set(plan.routes.map((r) => r.vehicle_id))]
    .map((id) => plan.routes.filter((r) => r.vehicle_id === id).sort((a, b) => a.route_seq - b.route_seq))
    .sort((a, b) => a[0].depart_at.localeCompare(b[0].depart_at))
    .map((trips) => {
      const v = vehicleOf.get(trips[0].vehicle_id);
      return {
        key: String(trips[0].vehicle_id),
        label: v?.source_id ?? trips[0].vehicle_code,
        bars: trips.map((r) => {
          const chilledTrip = r.stops.some((st) => st.orders?.some((o) => o.temp === "chilled"));
          const ids = r.stops.map((st) => st.stop_id);
          const likely = countLevel(late, ids, "likely");
          const atRisk = countLevel(late, ids, "risk");
          return {
            risk: likely ? "likely" as const : atRisk ? "risk" as const : undefined,
            id: r.route_id,
            start: Date.parse(r.depart_at),
            end: Date.parse(r.return_at),
            text: `${chilledTrip ? "❄ " : ""}${r.district_name} · ${r.stops.length}`,
            title: `${v?.source_id ?? r.vehicle_code} trip ${r.route_seq} · ${BRAND_NAME[r.brand_code]} ${r.district_name} · ${formatTime(r.depart_at)}–${formatTime(r.return_at)} · ${r.stops.length} stops · load ${pct(r)}% by ${bindingBy(r)}${likely ? ` · ${likely} likely late` : atRisk ? ` · ${atRisk} at risk of lateness` : ""}`,
            ariaLabel: `${v?.source_id ?? r.vehicle_code} trip ${r.route_seq}, ${BRAND_NAME[r.brand_code]} ${r.district_name}, ${formatTime(r.depart_at)} to ${formatTime(r.return_at)}`,
            className: BRAND_BAR[r.brand_code],
            fillClassName: BRAND_FILL[r.brand_code],
            fill: pct(r) / 100,
            selected: open.has(r.route_id),
            onClick: () => reveal(r.route_id),
          };
        }),
      };
    });

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
                <OrderLink orderId={u.order_id} className="text-[12px]">Details</OrderLink>
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

      {built && plan.lateness && (
        <LatenessPanel plan={plan} vehicleOf={vehicleOf} onReveal={reveal} open={showLate} onToggle={() => setShowLate(!showLate)} />
      )}

      {built && (
        <section className="rounded-lg border border-wp-border bg-wp-surface p-3">
          <button type="button" onClick={() => setShowTimeline(!showTimeline)} aria-expanded={showTimeline}
                  className="flex w-full cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 text-left">
            {showTimeline ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
            <h2 className="text-[15px] font-semibold">Day timeline</h2>
            <span className="text-[12px] text-wp-text-2">
              one lane per vehicle · shading = how full{late ? " · dot = predicted late stop" : ""} · click a trip to open it
            </span>
            <span className="ml-auto flex gap-3 text-[11px] text-wp-text-2">
              {(["F", "S", "T"] as BrandCode[]).map((b) => (
                <span key={b} className="flex items-center gap-1"><span className={cn("size-2.5 rounded-sm border", BRAND_BAR[b])} />{BRAND_NAME[b]}</span>
              ))}
            </span>
          </button>
          {showTimeline && <div className="mt-2"><LaneTimeline lanes={lanes} compact /></div>}
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
          <div>Vehicle · trip</div><div>Goes to</div><div>Leaves – back</div><div>Stops in order</div><div title="The limit the trip reaches first">Load · tightest limit</div><div>Fuel left</div><div />
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
          const ids = r.stops.map((st) => st.stop_id);
          const likely = countLevel(late, ids, "likely");
          const atRisk = countLevel(late, ids, "risk");
          return (
            <div key={r.route_id} id={`trip-${r.route_id}`} className="scroll-mt-28 border-b border-wp-border last:border-b-0">
              <button type="button" onClick={() => toggle(r.route_id)} aria-expanded={isOpen}
                      aria-label={`${v?.source_id ?? r.vehicle_code} trip ${r.route_seq}, ${BRAND_NAME[r.brand_code]} ${r.district_name}, ${r.stops.length} stops, load ${load}%`}
                      className={cn(ROW, "flex w-full cursor-pointer flex-col gap-1 px-3 py-2.5 text-left hover:bg-wp-surface-2/60", isOpen && "bg-wp-surface-2/60")}>
                <div className="flex w-full items-center justify-between gap-2 md:block">
                  <div>
                    <span className="text-[14px] font-bold">{v?.source_id ?? r.vehicle_code}</span>
                    <span className="text-wp-text-2"> · trip {r.route_seq}</span>
                    <div className="text-[11px] text-wp-muted">{r.vehicle_class}</div>
                    <div className="text-[11px] text-wp-text-2">{r.driver_name ? `Driver ${r.driver_name}` : "No driver linked"}</div>
                  </div>
                  <span className="md:hidden">{isOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <BrandMonogram brand={BRAND[r.brand_code]} outlet={r.district_name} />
                  {chilled && <Snowflake aria-label="Carries chilled goods" className="size-3.5 text-wp-info" />}
                </div>
                <div>
                  <div className="font-semibold">{formatTime(r.depart_at)} – {formatTime(r.return_at)}</div>
                  {lastDrop(r) && <div className="text-[11px] text-wp-text-2">last drop {formatTime(lastDrop(r)!)}</div>}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-wp-text-2" title={r.stops.map((st) => st.outlet_code).join(" → ")}>
                    {r.stops.length} · {r.stops.map((st) => st.outlet_code).join(" → ")}
                  </div>
                  {(likely > 0 || atRisk > 0) && (
                    <div className={cn("text-[11px] font-semibold", likely ? "text-wp-crit" : "text-wp-warn")}>
                      {likely ? `◆ ${likely} likely late` : ""}{likely && atRisk ? " · " : ""}{atRisk ? `▲ ${atRisk} at risk` : ""}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-2 w-16 flex-none overflow-hidden rounded bg-wp-surface-2" role="img" aria-label={`Load ${load} percent`}>
                    <div className={cn("h-full", load >= 100 ? "bg-wp-crit" : load >= 90 ? "bg-wp-gauge-amber" : "bg-wp-offline")} style={{ width: `${Math.min(load, 100)}%` }} />
                  </div>
                  <span className="text-[12px] leading-4">
                    <b>{load}%</b> <span className="text-wp-text-2">by {bindingBy(r)}</span>
                    <span className="block text-[11px] text-wp-muted">
                      {bindingBy(r) === "volume"
                        ? `${Number(r.volume_m3).toFixed(1)} of ${Number(r.max_volume_m3).toFixed(1)} m³`
                        : `${Math.round(r.weight_kg)} of ${Math.round(r.max_weight_kg)} kg`}
                    </span>
                  </span>
                </div>
                <div className="text-[12px]">{r.fuel_left_l !== null ? `${Math.round(Number(r.fuel_left_l))} L` : "—"}</div>
                <div className="hidden md:block">{isOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}</div>
              </button>

              {isOpen && (
                <div className="flex flex-col gap-2 bg-wp-surface-2/40 px-3 pt-1 pb-3">
                  <div className="text-[12px] text-wp-text-2">
                    {r.trip_minutes} min of driving and unloading · {Math.round(r.weight_kg)} of {Math.round(r.max_weight_kg)} kg ·{" "}
                    {Number(r.volume_m3).toFixed(1)} of {Number(r.max_volume_m3).toFixed(1)} m³ · driver <b className="text-wp-text">{r.driver_name ?? "not linked"}</b>
                  </div>
                  <ol className="flex flex-col gap-1">
                    {r.stops.map((st) => (
                      <li key={st.stop_id} className="flex flex-wrap items-center gap-2 rounded-md bg-wp-surface px-2 py-1.5">
                        <span className="w-12 font-semibold">{formatTime(st.planned_arrival)}</span>
                        <span className="font-semibold">{st.seq}. {st.outlet_code}</span>
                        <TimeWindow planned={st.planned_arrival} opens={st.window_opens} closes={st.window_closes} showPlanned={false} />
                        <LateRisk f={forecastOf(late, st.stop_id)} />
                        <span className="text-[12px] text-wp-muted">{st.unload.replace("_", " ")}{st.van_only ? " · van-only" : ""}</span>
                        <span className="ml-auto flex flex-wrap gap-1.5">
                          {(st.orders ?? []).map((o) => (
                            <span key={o.order_id} className="inline-flex items-center gap-1.5 rounded border border-wp-border px-1.5 py-0.5 text-[12px]">
                              <OrderLink orderId={o.order_id} className="font-normal text-wp-text no-underline hover:underline">
                                {o.temp === "chilled" ? "❄ Chilled" : "Dry"} · {Number(o.kg)} kg
                              </OrderLink>
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
                        <ForecastLine f={forecastOf(late, st.stop_id)} className="basis-full md:pl-14" />
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
                    onBringBack={async (vehicleId) => {
                      const back = await actions.setVehicleActive(vehicleId, true);
                      if (!back.ok) return back.message;
                      const rebuilt = await actions.propose();
                      if (rebuilt.ok) setMoving(null);
                      return rebuilt.ok ? null : rebuilt.message;
                    }}
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
  onBringBack,
}: {
  moving: Moving;
  plan: PlanView;
  busy: boolean;
  onClose: () => void;
  onMove: (vehicleId: number, seq: 1 | 2) => Promise<string | null>;
  onBringBack: (vehicleId: number) => Promise<string | null>;
}) {
  const [error, setError] = useState<string | null>(null);
  // Only for an order no trip took: would a vehicle back from the workshop change that?
  const askWhatIf = moving.from_route === null && plan.plan.state !== "released";
  const whatIf = useApiData<WhatIf>(askWhatIf ? `/dispatch/plans/${plan.plan.plan_id}/orders/${moving.order_id}/what-if` : null);

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

  // What the browser can't see (delivery windows, time budgets, fuel): the server tries each remaining choice
  // without keeping it, one at a time, and a choice that would break a rule is shown with that rule.
  const request = useApi();
  const [checks, setChecks] = useState<Record<string, string | null>>({});
  const names = new Map(plan.vehicles.map((v) => [v.code, v.source_id]));
  const candidates = options.filter((o) => o.ok).map((o) => `${o.vehicle.vehicle_id}-${o.seq}`).join(",");
  useEffect(() => {
    let stop = false;
    void (async () => {
      for (const key of candidates ? candidates.split(",") : []) {
        if (stop) return;
        const [vehicleId, seq] = key.split("-").map(Number);
        try {
          const r = await request<{ violations: { code: string; message: string }[] }>(`/dispatch/plans/${plan.plan.plan_id}/move`, {
            method: "POST", body: { order_id: moving.order_id, vehicle_id: vehicleId, seq, check_only: true } });
          const broken = r.violations.filter((v) => v.code !== "unplanned"
            && !plan.violations.some((p) => p.code === v.code && p.message === v.message));
          if (!stop) setChecks((c) => ({ ...c, [key]: broken.length ? broken[0].message.replace(/\b[A-Z]{2}-\d{2}\b/g, (x) => names.get(x) ?? x) : null }));
        } catch (err) {
          if (!stop) setChecks((c) => ({ ...c, [key]: errorMessage(err) }));
        }
      }
    })();
    return () => { stop = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-check only when the choices themselves change
  }, [candidates, plan.plan.plan_id, moving.order_id]);
  const checked = options.map((o) => {
    const key = `${o.vehicle.vehicle_id}-${o.seq}`;
    if (!o.ok) return { ...o, checking: false };
    if (!(key in checks)) return { ...o, ok: false, checking: true };
    const why = checks[key]?.replace(`${o.vehicle.source_id}: `, "");
    return checks[key] === null ? { ...o, checking: false } : { ...o, ok: false, checking: false, text: `${o.text} · ${why}` };
  }).sort((a, b) => Number(b.ok) - Number(a.ok) || Number(b.checking) - Number(a.checking) || b.free - a.free);

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
        {!checked.some((o) => o.ok || o.checking) && (
          <div className="mx-4 mt-3 rounded-md bg-wp-warn-tint px-3 py-2 font-semibold text-wp-warn">
            ▲ No vehicle in service can take it today without breaking a rule.
          </div>
        )}
        {askWhatIf && <WhatIfBox whatIf={whatIf.data} loading={whatIf.loading} error={whatIf.error} busy={busy}
                                  onBringBack={async (id, name) => {
                                    if (!window.confirm(`Put ${name} back in service and rebuild the plan? Manual changes to the draft are dropped.`)) return;
                                    setError(await onBringBack(id));
                                  }} />}
        <ul className="flex-1 overflow-y-auto p-2">
          {checked.map((o) => (
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
                {o.checking && <span className="text-[12px] text-wp-muted">Checking…</span>}
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
          Every choice is first tried on the server against all the rules (windows, time budgets, fuel); one that would break a rule shows which.
        </div>
      </div>
    </div>
  );
}

/** "What would fix it": the engine re-run with each suitable workshop vehicle back in service. */
function WhatIfBox({ whatIf, loading, error, busy, onBringBack }: {
  whatIf: WhatIf | undefined; loading: boolean; error: string | null; busy: boolean;
  onBringBack: (vehicleId: number, name: string) => void;
}) {
  if (loading) return <div className="mx-4 mt-3 rounded-md bg-wp-surface-2 px-3 py-2 text-[12px] text-wp-text-2">Checking what would let it go…</div>;
  if (error || !whatIf) return null;
  const fixes = whatIf.options.filter((o) => o.serves_order);
  return (
    <div className="mx-4 mt-3 flex flex-col gap-1.5 rounded-md border border-wp-info bg-wp-info-tint/50 px-3 py-2">
      <div className="text-[12px] font-bold text-wp-info">What would fix it</div>
      {fixes.length === 0 && (
        <div className="text-[12px] text-wp-text-2">
          {whatIf.options.length
            ? `Even with ${whatIf.options.map((o) => o.vehicle).join(", ")} back from the workshop, no trip can take it.`
            : "No vehicle in the workshop could carry it either."}{" "}
          Deferring it is the right call.
        </div>
      )}
      {fixes.map((o) => (
        <div key={o.vehicle_id} className="flex flex-wrap items-center gap-2 text-[12px]">
          <span>
            <b>{o.vehicle}</b> is in the workshop. Back in service, the engine places this order
            {whatIf.today ? ` (${o.orders_served} of ${o.orders_total} orders go, now ${whatIf.today.orders_served})` : ""}.
          </span>
          <Button className="ml-auto" disabled={busy} onClick={() => onBringBack(o.vehicle_id, o.vehicle)}>
            Put {o.vehicle} back and rebuild
          </Button>
        </div>
      ))}
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

/**
 * Before the vans leave: which stops our Datathon model expects after their window, worst trips first. Folded
 * away by default and worded as what it is: before departure the model mostly repeats how each store's deliveries
 * ran in the past. Live raises an alert when today's delays add to it.
 */
function LatenessPanel({ plan, vehicleOf, onReveal, open, onToggle }: {
  plan: PlanView; vehicleOf: Map<number, Vehicle>; onReveal: (routeId: number) => void; open: boolean; onToggle: () => void;
}) {
  const l = plan.lateness!;
  const trips = plan.routes
    .map((r) => {
      const ids = r.stops.map((st) => st.stop_id);
      return { r, worst: worstStop(l, ids), likely: countLevel(l, ids, "likely"), risk: countLevel(l, ids, "risk") };
    })
    .filter((t) => t.likely + t.risk > 0)
    .sort((a, b) => (b.worst?.f.late_probability ?? 0) - (a.worst?.f.late_probability ?? 0));
  const likely = trips.reduce((n, t) => n + t.likely, 0);
  const risk = trips.reduce((n, t) => n + t.risk, 0);
  const stops = plan.routes.reduce((n, r) => n + r.stops.length, 0);
  return (
    <section aria-label="Predicted lateness" className="rounded-lg border border-wp-border bg-wp-surface p-3">
      <button type="button" onClick={onToggle} aria-expanded={open}
              className="flex w-full cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 text-left">
        {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        <h2 className="text-[15px] font-semibold">Predicted lateness</h2>
        <span className="text-[12px] text-wp-text-2">from history, our Datathon Task 1 model · {open ? "hide" : "show"}</span>
      </button>
      {open && <>
      <p className="mt-2 text-[12px] text-wp-text-2">
        Before vans leave, this mostly reflects how these stores’ deliveries ran in the past. Live warns you, and the store,
        only when today’s delays raise a stop’s chance of missing its window.
      </p>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-semibold">
          {likely + risk === 0
            ? `All ${stops} stops expected inside their window`
            : `${likely} of ${stops} stops with a history of late arrivals${risk ? ` · ${risk} more at some risk` : ""} · on ${trips.length} ${trips.length === 1 ? "trip" : "trips"}`}
        </span>
        <span className="text-[12px] text-wp-text-2">
          The plan times trips at free-flow speed, as the brief sets. The model adds the hour’s traffic, the day’s road disruption and each outlet’s handling history.
        </span>
      </div>
      {trips.length > 0 && (
        <ul className="mt-2 grid gap-1.5 lg:grid-cols-2">
          {trips.slice(0, 6).map(({ r, worst, likely: n, risk: m }) => {
            const st = r.stops.find((x) => x.stop_id === worst?.stopId);
            return (
              <li key={r.route_id}>
                <button type="button" onClick={() => onReveal(r.route_id)}
                        className="flex w-full cursor-pointer flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md border border-wp-border bg-wp-surface px-2.5 py-1.5 text-left hover:bg-wp-surface-2">
                  <b>{vehicleOf.get(r.vehicle_id)?.source_id ?? r.vehicle_code}</b>
                  <span className="text-wp-text-2">trip {r.route_seq} · {BRAND_NAME[r.brand_code]} {r.district_name}</span>
                  <LateRisk f={worst?.f} className="ml-auto" />
                  <span className="basis-full text-[11px] text-wp-text-2">
                    {n ? `${n} likely late` : ""}{n && m ? " · " : ""}{m ? `${m} at risk` : ""}
                    {st && worst && <> · worst {st.outlet_code}: {percent(worst.f.late_probability)}, arrives ~{formatTime(worst.f.expected_arrival)}
                      {st.window_closes ? `, window to ${st.window_closes.slice(0, 5)}` : ""}</>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {trips.length > 6 && <div className="mt-1 text-[11px] text-wp-text-2">and {trips.length - 6} more: filter the trips by “Late risk”.</div>}
      <ModelNote l={l} className="mt-2" />
      </>}
    </section>
  );
}
