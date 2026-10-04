"use client";

import { ChevronLeft, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/waypoint/controls";
import { StatusPill } from "@/components/waypoint/status";
import { formatDay, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { BRAND_NAME, type FleetRow, type Monitor, type RunProgress } from "./data";
import { AttentionRow, MovedToday, TripStops, dots, vehicleStatus, type LiveActions } from "./live-monitor";

/** Where a trip is, for the charts: one bucket each, worst first. */
type Bucket = "nosignal" | "attention" | "road" | "depot" | "back";
const BUCKETS: { key: Bucket; label: string; color: string; bar: string }[] = [
  { key: "nosignal", label: "No signal", color: "var(--wp-offline)", bar: "bg-wp-offline-tint border-wp-offline border-dashed" },
  { key: "attention", label: "Needs attention", color: "var(--wp-warn)", bar: "bg-wp-warn-tint border-wp-warn" },
  { key: "road", label: "On the road", color: "var(--wp-info)", bar: "bg-wp-info-tint border-wp-info" },
  { key: "depot", label: "At the depot", color: "var(--wp-border)", bar: "bg-wp-surface-2 border-wp-border" },
  { key: "back", label: "Back, done", color: "var(--wp-good)", bar: "bg-wp-good-tint border-wp-good" },
];
const FILL: Record<Bucket, string> = {
  nosignal: "bg-wp-offline/50", attention: "bg-wp-warn/45", road: "bg-wp-info/45", depot: "bg-wp-muted/30", back: "bg-wp-good/45",
};

function bucket(f: FleetRow): Bucket {
  if (f.no_signal) return "nosignal";
  if (f.exception_count > 0) return "attention";
  if (f.state === "on_the_way") return "road";
  if (f.state === "complete") return "back";
  return "depot";
}

type Detail = { kind: "trip"; routeId: number; from?: Detail } | { kind: "district"; name: string };
const HOUR = 3_600_000;
const label = "text-[10px] font-semibold tracking-[.06em] text-wp-muted uppercase";

/**
 * The Live overview: everything the dispatcher watches all day on one screen. On a large display it fits
 * the window with no page scrolling (only long lists scroll inside their own panel); clicking a trip,
 * district or alert opens its detail beside the charts without leaving the screen.
 */
export function LiveOverview({ m, actions, showDepot, onView }: {
  m: Monitor; actions: LiveActions; showDepot: boolean; onView: (v: "trips" | "day") => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [focus, setFocus] = useState<Bucket | null>(null);

  // Fill the window below the header on large screens; smaller screens stack and scroll as usual.
  useEffect(() => {
    const fit = () => {
      const el = root.current;
      if (!el) return;
      if (window.innerWidth < 1024) { el.style.height = ""; return; }
      const top = el.getBoundingClientRect().top + window.scrollY;
      el.style.height = `${Math.max(560, window.innerHeight - top - 20)}px`;
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setDetail(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const openTrip = (routeId: number) => setDetail((d) => ({ kind: "trip", routeId, from: d?.kind === "district" ? d : undefined }));

  return (
    <div ref={root} className="relative flex flex-col gap-3 lg:min-h-0">
      <div className={cn("grid shrink-0 gap-3", m.runs.length > 1 && "xl:grid-cols-2")}>
        {m.runs.map((run) => (
          <DepotStrip key={run.run_id} run={run} trips={m.fleet.filter((f) => f.run_id === run.run_id)}
                      attention={m.exceptions.filter((e) => e.depot === run.depot).length} onView={onView} />
        ))}
      </div>

      <div className="grid gap-3 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_340px] 2xl:grid-cols-[minmax(0,1fr)_400px]">
        <Timeline m={m} showDepot={showDepot} focus={focus} selected={detail?.kind === "trip" ? detail.routeId : null} onOpen={openTrip} />
        <Panel title={`Needs attention · ${m.exceptions.length}`} action={<Button variant="link" onClick={() => onView("trips")}>All trips</Button>}
               className="max-h-[480px] lg:max-h-none">
          <MovedToday actions={actions} />
          {m.exceptions.length === 0 && <div className="py-2 text-wp-text-2">Nothing needs attention right now.</div>}
          {m.exceptions.map((e, i) => (
            <AttentionRow key={`${e.kind}-${e.flag_id ?? e.route_id ?? i}-${e.stop_id ?? ""}-${e.order_id ?? ""}`} e={e} actions={actions}
                          showDepot={showDepot} compact onOpen={e.route_id ? () => openTrip(e.route_id!) : undefined} />
          ))}
        </Panel>
      </div>

      <div className="grid shrink-0 gap-3 md:grid-cols-2 lg:h-[176px] lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)] 2xl:h-[210px]">
        <Districts m={m} onOpen={(name) => setDetail({ kind: "district", name })} />
        <StatusDonut fleet={m.fleet} focus={focus} onFocus={(b) => setFocus(focus === b ? null : b)} />
        <FuelWatch m={m} onView={onView} />
      </div>

      {detail && <Drawer m={m} detail={detail} showDepot={showDepot} onOpen={openTrip} onSet={setDetail} />}
    </div>
  );
}

function Panel({ title, action, children, className }: { title: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("flex min-h-0 flex-col rounded-lg border border-wp-border bg-wp-surface", className)}>
      <div className="flex shrink-0 items-center gap-2 px-3 pt-2.5 pb-1.5">
        <h2 className="text-[14px] leading-5 font-semibold">{title}</h2>
        {action && <div className="ml-auto">{action}</div>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-2.5">{children}</div>
    </section>
  );
}

// ------------------------------------------------------------------ depot KPIs ----

function Ring({ value, total, size = 64 }: { value: number; total: number; size?: number }) {
  const r = size / 2 - 6;
  const c = 2 * Math.PI * r;
  const share = total ? value / total : 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${value} of ${total} delivered`} className="shrink-0">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--wp-surface-2)" strokeWidth={8} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--wp-good)" strokeWidth={8} strokeLinecap="round"
              strokeDasharray={`${share * c} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" className="fill-wp-text text-[14px] font-bold">
        {Math.round(share * 100)}%
      </text>
    </svg>
  );
}

function DepotStrip({ run, trips, attention, onView }: {
  run: RunProgress; trips: FleetRow[]; attention: number; onView: (v: "trips" | "day") => void;
}) {
  const count = (b: Bucket) => trips.filter((f) => bucket(f) === b).length;
  const back = count("back");
  const road = trips.filter((f) => f.state === "on_the_way").length;
  const depot = trips.length - back - road;
  const noSignal = count("nosignal");
  const behind = run.orders_due_by_now - run.orders_delivered;
  const complete = run.state === "complete";
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-wp-border bg-wp-surface px-4 py-2">
      <div className="flex min-w-[104px] flex-col">
        <span className="text-[16px] font-bold">{run.depot}</span>
        <span className="text-[11px] text-wp-text-2">{formatDay(run.service_date)}</span>
        {complete ? (
          <button type="button" onClick={() => onView("day")} className="cursor-pointer text-left text-[11px] font-semibold text-wp-good underline">
            Day complete
          </button>
        ) : run.state === "planned" ? (
          <span className="text-[11px] font-semibold text-wp-info">Not departed</span>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <Ring value={run.orders_delivered} total={run.orders_total} size={58} />
        <div className="flex flex-col">
          <span className={label}>Delivered</span>
          <b className="text-[18px] leading-6">{run.orders_delivered} of {run.orders_total}</b>
          <span className={cn("text-[11px]", !complete && behind > 0 ? "font-semibold text-wp-warn" : "text-wp-text-2")}>
            {complete ? "all trips back" : behind > 0 ? `${behind} behind plan` : run.orders_due_by_now > 0 ? "on plan" : "none due yet by plan"}
          </span>
        </div>
      </div>
      <div className="flex min-w-[150px] flex-1 flex-col gap-1">
        <span className={label}>Trips · {trips.length}</span>
        <div className="flex h-3 overflow-hidden rounded-full bg-wp-surface-2" role="img"
             aria-label={`${back} back, ${road} on the road, ${depot} at the depot`}>
          <div className="bg-wp-good" style={{ width: `${(back / Math.max(1, trips.length)) * 100}%` }} />
          <div className="bg-wp-info" style={{ width: `${(road / Math.max(1, trips.length)) * 100}%` }} />
        </div>
        <span className="text-[11px] whitespace-nowrap text-wp-text-2">
          <b className="text-wp-good">{back}</b> back · <b className="text-wp-info">{road}</b> on road · <b>{depot}</b> at depot
        </span>
      </div>
      <div className="grid grid-cols-[auto_auto] gap-x-2 text-[12px] leading-[17px]">
        <Kpi name="Fresh at risk" value={run.fresh_at_risk} tone={run.fresh_at_risk > 0 ? "text-wp-crit" : ""} />
        <Kpi name="Attention" value={attention} tone={attention > 0 ? "text-wp-warn" : ""} />
        <Kpi name="No signal" value={noSignal} tone={noSignal > 0 ? "text-wp-offline" : ""} />
      </div>
    </div>
  );
}

function Kpi({ name, value, tone }: { name: string; value: number; tone: string }) {
  return (
    <>
      <span className="text-wp-text-2">{name}</span>
      <b className={cn("text-right", tone)}>{value}</b>
    </>
  );
}

// -------------------------------------------------------------- fleet timeline ----

/** One lane per vehicle, a bar per trip from planned departure to planned return; the fill is stops done. */
function Timeline({ m, showDepot, focus, selected, onOpen }: {
  m: Monitor; showDepot: boolean; focus: Bucket | null; selected: number | null; onOpen: (routeId: number) => void;
}) {
  const times = m.fleet.flatMap((f) => [Date.parse(f.depart_at), Date.parse(f.return_at ?? f.depart_at)]).filter(Number.isFinite);
  if (times.length === 0) return <Panel title="Fleet today"><div className="text-wp-text-2">No trips yet.</div></Panel>;
  const start = Math.min(...times) - HOUR / 4;
  const end = Math.max(...times) + HOUR / 4;
  const x = (t: number) => ((t - start) / (end - start)) * 100;
  // Colombo is UTC+05:30 all year, so its whole hours fall on the half hour in UTC.
  const ticks: number[] = [];
  for (let t = Math.ceil((start - HOUR / 2) / HOUR) * HOUR + HOUR / 2; t <= end; t += HOUR) ticks.push(t);
  const now = Date.parse(m.server_time);
  const showNow = now >= start && now <= end;
  const groups = showDepot ? m.runs.map((r) => r.depot) : [null];

  return (
    <Panel title="Fleet today · planned trips and stops done"
           action={<span className="text-[11px] text-wp-text-2">{showNow ? `now ${formatTime(m.server_time)}` : `day of ${formatDay(m.runs[0].service_date)}`}</span>}
           className="min-h-[420px] lg:min-h-0">
      <div className={cn("grid gap-x-5 gap-y-3 lg:h-full lg:min-h-0", groups.length > 1 && "xl:grid-cols-2")}>
        {groups.map((depot) => {
          const fleet = m.fleet.filter((f) => !depot || f.depot === depot);
          const lanes = [...new Set(fleet.map((f) => f.vehicle_source_id))].sort();
          return (
            <div key={depot ?? "one"} className="flex min-h-0 flex-col">
              {depot && <div className="mb-0.5 text-[12px] font-bold">{depot}</div>}
              <div className="flex shrink-0 pl-[74px]">
                <div className="relative h-4 flex-1 text-[10px] text-wp-muted">
                  {ticks.map((t, i) => (
                    <span key={t} className={cn("absolute -translate-x-1/2", i % 2 === 1 && "max-sm:hidden", i % 2 === 1 && groups.length > 1 && "xl:max-2xl:hidden")}
                          style={{ left: `${x(t)}%` }}>{formatTime(new Date(t))}</span>
                  ))}
                </div>
              </div>
              <div className="relative flex min-h-0 flex-1 flex-col">
                <div className="pointer-events-none absolute inset-y-0 right-0 left-[74px]">
                  {ticks.map((t) => <div key={t} className="absolute inset-y-0 border-l border-wp-border/60" style={{ left: `${x(t)}%` }} />)}
                  {showNow && (
                    <div className="absolute inset-y-0 z-10 border-l-2 border-wp-crit" style={{ left: `${x(now)}%` }}>
                      <span className="absolute -top-0.5 -translate-x-1/2 rounded bg-wp-crit px-1 text-[9px] font-bold text-white">NOW</span>
                    </div>
                  )}
                </div>
                {lanes.map((vehicle) => (
                  <div key={vehicle} className="flex min-h-[18px] flex-1 items-center border-t border-wp-border/40 first:border-t-0 lg:max-h-[38px] lg:min-h-[14px]">
                    <div className="w-[74px] shrink-0 truncate pr-2 text-[11px] font-semibold">{vehicle}</div>
                    <div className="relative h-full flex-1">
                      {fleet.filter((f) => f.vehicle_source_id === vehicle).map((f) => (
                        <TripBar key={f.route_id} f={f} left={x(Date.parse(f.depart_at))} right={x(Date.parse(f.return_at ?? f.depart_at))}
                                 dim={focus !== null && bucket(f) !== focus} selected={selected === f.route_id} onOpen={onOpen} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

function TripBar({ f, left, right, dim, selected, onOpen }: {
  f: FleetRow; left: number; right: number; dim: boolean; selected: boolean; onOpen: (routeId: number) => void;
}) {
  const b = bucket(f);
  const style = BUCKETS.find((s) => s.key === b)!;
  const status = vehicleStatus(f);
  const done = f.stops_total ? f.stops_done / f.stops_total : 0;
  return (
    <button type="button" onClick={() => onOpen(f.route_id)}
            title={`${f.vehicle_source_id} trip ${f.route_seq} · ${f.district} · ${BRAND_NAME[f.brand_code]} · ${formatTime(f.depart_at)}–${formatTime(f.return_at)} · ${f.stops_done}/${f.stops_total} stops · ${status.label}`}
            aria-label={`${f.vehicle_source_id} trip ${f.route_seq}, ${f.district}, ${f.stops_done} of ${f.stops_total} stops, ${status.label}`}
            className={cn("absolute top-[10%] bottom-[10%] flex cursor-pointer items-center overflow-hidden rounded border text-left transition-opacity",
                          style.bar, dim && "opacity-25", selected && "ring-2 ring-wp-focus ring-offset-1")}
            style={{ left: `${left}%`, width: `${Math.max(0.8, right - left)}%` }}>
      <div className={cn("absolute inset-y-0 left-0", FILL[b])} style={{ width: `${done * 100}%` }} />
      <span className="relative block truncate px-1 text-[10px] leading-none font-semibold">
        {f.district} {f.stops_done}/{f.stops_total}
      </span>
    </button>
  );
}

// ------------------------------------------------------------- bottom charts ----

/** Stops by district: delivered, failed, still to go. Built from the trips' stops. */
function Districts({ m, onOpen }: { m: Monitor; onOpen: (name: string) => void }) {
  const district = new Map(m.fleet.map((f) => [f.route_id, f.district]));
  const rows = new Map<string, { done: number; failed: number; total: number }>();
  for (const s of m.stops) {
    const name = district.get(s.route_id);
    if (!name) continue;
    const r = rows.get(name) ?? { done: 0, failed: 0, total: 0 };
    r.total += 1;
    if (s.outcomes?.includes("not_delivered")) r.failed += 1;
    else if (s.delivered_at) r.done += 1;
    rows.set(name, r);
  }
  const list = [...rows.entries()].sort((a, b) => b[1].total - a[1].total);
  return (
    <Panel title="Stops by district" action={<Legend items={[["bg-wp-good", "done"], ["bg-wp-crit", "failed"], ["bg-wp-surface-2", "to go"]]} />}>
      <div className={cn("grid gap-x-4 gap-y-0.5 2xl:gap-y-1", list.length > 5 && "xl:grid-cols-2")}>
        {list.map(([name, r]) => (
          <button key={name} type="button" onClick={() => onOpen(name)}
                  className="grid cursor-pointer grid-cols-[96px_minmax(0,1fr)_52px] items-center gap-2 rounded px-1 text-left hover:bg-wp-surface-2 2xl:py-0.5">
            <span className="truncate text-[12px] leading-4 font-semibold">{name}</span>
            <span className="flex h-3 overflow-hidden rounded-full bg-wp-surface-2">
              <span className="bg-wp-good" style={{ width: `${(r.done / r.total) * 100}%` }} />
              <span className="bg-wp-crit" style={{ width: `${(r.failed / r.total) * 100}%` }} />
            </span>
            <span className="text-right text-[11px] text-wp-text-2">{r.done + r.failed}/{r.total}</span>
          </button>
        ))}
      </div>
    </Panel>
  );
}

function Legend({ items }: { items: [string, string][] }) {
  return (
    <span className="flex gap-2 text-[10px] text-wp-text-2">
      {items.map(([c, t]) => <span key={t} className="flex items-center gap-1"><span className={cn("size-2 rounded-full", c)} />{t}</span>)}
    </span>
  );
}

/** Trips by status. Clicking a status highlights those trips on the timeline. */
function StatusDonut({ fleet, focus, onFocus }: { fleet: FleetRow[]; focus: Bucket | null; onFocus: (b: Bucket) => void }) {
  const size = 120;
  const r = 44;
  const c = 2 * Math.PI * r;
  const counts = BUCKETS.map((b) => ({ ...b, n: fleet.filter((f) => bucket(f) === b.key).length }));
  const segments = counts.filter((b) => b.n > 0).map((b) => ({ ...b, len: (b.n / Math.max(1, fleet.length)) * c }))
    .map((b, i, all) => ({ ...b, offset: all.slice(0, i).reduce((sum, a) => sum + a.len, 0) }));
  return (
    <Panel title="Trips by status" action={focus && <Button variant="link" onClick={() => onFocus(focus)}>Show all</Button>}>
      <div className="flex h-full items-center gap-4">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Trips by status" className="shrink-0">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--wp-surface-2)" strokeWidth={16} />
          {segments.map((b) => (
            <circle key={b.key} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={b.color} strokeWidth={focus === b.key ? 20 : 16}
                    strokeDasharray={`${b.len} ${c - b.len}`} strokeDashoffset={-b.offset} transform={`rotate(-90 ${size / 2} ${size / 2})`}
                    opacity={focus && focus !== b.key ? 0.3 : 1} className="cursor-pointer" onClick={() => onFocus(b.key)} />
          ))}
          <text x="50%" y="46%" dominantBaseline="central" textAnchor="middle" className="fill-wp-text text-[22px] font-bold">{fleet.length}</text>
          <text x="50%" y="62%" dominantBaseline="central" textAnchor="middle" className="fill-wp-text-2 text-[10px]">trips</text>
        </svg>
        <div className="flex flex-col gap-0.5">
          {counts.map((b) => (
            <button key={b.key} type="button" onClick={() => onFocus(b.key)} aria-pressed={focus === b.key} disabled={b.n === 0}
                    className={cn("flex cursor-pointer items-center gap-2 rounded px-1.5 py-0.5 text-left text-[12px] disabled:cursor-default disabled:opacity-50",
                                  focus === b.key ? "bg-wp-surface-2 font-semibold" : "hover:bg-wp-surface-2")}>
              <span className="size-2.5 rounded-sm" style={{ background: b.color }} />
              <span>{b.label}</span>
              <b className="ml-auto pl-3">{b.n}</b>
            </button>
          ))}
        </div>
      </div>
    </Panel>
  );
}

/** Vehicles closest to their weekly fuel quota, counting today's planned distance. */
function FuelWatch({ m, onView }: { m: Monitor; onView: (v: "trips" | "day") => void }) {
  const rows = m.closeout
    .flatMap((c) => c.fuel.map((v) => ({ ...v, depot: c.depot })))
    .filter((v) => v.quota_l !== null && Number(v.quota_l) > 0)
    .map((v) => ({ ...v, share: Number(v.used_week_l) / Number(v.quota_l) }))
    .sort((a, b) => b.share - a.share)
    .slice(0, 6);
  return (
    <Panel title="Fuel this week · closest to quota" action={<Button variant="link" onClick={() => onView("day")}>All vehicles</Button>}>
      {rows.length === 0 && <div className="text-wp-text-2">No fuel recorded yet.</div>}
      <div className="flex flex-col gap-0.5 2xl:gap-1">
        {rows.map((v) => {
          const left = Number(v.left_week_l ?? 0);
          const low = v.share > 0.8;
          return (
            <div key={`${v.depot}-${v.vehicle_id}`} className="grid grid-cols-[64px_minmax(0,1fr)_74px] items-center gap-2" title={`${v.depot}`}>
              <span className="text-[12px] font-semibold">{v.source_id}</span>
              <span className="h-3 overflow-hidden rounded-full bg-wp-surface-2">
                <span className={cn("block h-full", low ? "bg-wp-crit" : "bg-wp-info")} style={{ width: `${Math.min(100, v.share * 100)}%` }} />
              </span>
              <span className={cn("text-right text-[11px]", low ? "font-semibold text-wp-crit" : "text-wp-text-2")}>{left.toFixed(0)} L left</span>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

// ------------------------------------------------------------------- drawer ----

function Drawer({ m, detail, showDepot, onOpen, onSet }: {
  m: Monitor; detail: Detail; showDepot: boolean; onOpen: (routeId: number) => void; onSet: (d: Detail | null) => void;
}) {
  let title: ReactNode;
  let body: ReactNode;
  if (detail.kind === "trip") {
    const trip = m.fleet.find((f) => f.route_id === detail.routeId);
    if (!trip) return null;
    const status = vehicleStatus(trip);
    title = <>{trip.vehicle_source_id} trip {trip.route_seq} · plan against actual</>;
    body = (
      <>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill state={status.state}>{status.label}</StatusPill>
          <span className="text-[12px] text-wp-text-2">
            {BRAND_NAME[trip.brand_code]} · {formatTime(trip.depart_at)}–{formatTime(trip.return_at)} · {trip.stops_done} of {trip.stops_total} stops
          </span>
        </div>
        {m.exceptions.filter((e) => e.route_id === trip.route_id).map((e, i) => (
          <div key={i} className="rounded-md bg-wp-warn-tint px-3 py-1.5 text-[12px] font-semibold text-wp-warn">{e.detail}</div>
        ))}
        <TripStops trip={trip} stops={m.stops.filter((s) => s.route_id === trip.route_id)} />
      </>
    );
  } else {
    const trips = m.fleet.filter((f) => f.district === detail.name)
      .sort((a, b) => vehicleStatus(a).risk - vehicleStatus(b).risk);
    title = <>{detail.name} · {trips.length} {trips.length === 1 ? "trip" : "trips"}</>;
    body = trips.map((f) => {
      const status = vehicleStatus(f);
      return (
        <button key={f.route_id} type="button" onClick={() => onOpen(f.route_id)}
                className="flex cursor-pointer flex-col gap-1 rounded-md border border-wp-border p-2.5 text-left hover:bg-wp-surface-2">
          <div className="flex items-center gap-2">
            <b>{f.vehicle_source_id} · trip {f.route_seq}</b>
            {showDepot && <span className="rounded border border-wp-border px-1.5 text-[11px] text-wp-text-2">{f.depot}</span>}
            <StatusPill state={status.state} className="ml-auto">{status.label}</StatusPill>
          </div>
          <div className="text-xs tracking-[2px]">{dots(f)}</div>
          <div className="text-[11px] text-wp-text-2">
            {BRAND_NAME[f.brand_code]} · next {f.next_outlet ?? (f.state === "complete" ? "back to depot" : "—")}
            {f.next_planned ? ` at ${formatTime(f.next_planned)}` : ""}
          </div>
        </button>
      );
    });
  }
  const back = detail.kind === "trip" ? detail.from : undefined;
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20" onClick={() => onSet(null)} aria-hidden />
      <aside role="dialog" aria-modal="true" aria-label="Details"
             className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[480px] flex-col border-l border-wp-border bg-wp-surface shadow-xl">
        <div className="flex items-center gap-2 border-b border-wp-border px-4 py-3">
          {back && (
            <button type="button" onClick={() => onSet(back)} className="cursor-pointer text-wp-text-2" aria-label="Back">
              <ChevronLeft className="size-4" aria-hidden />
            </button>
          )}
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <button type="button" onClick={() => onSet(null)} className="ml-auto cursor-pointer text-wp-muted" aria-label="Close details">
            <X className="size-4" aria-hidden />
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-4">{body}</div>
      </aside>
    </>
  );
}
