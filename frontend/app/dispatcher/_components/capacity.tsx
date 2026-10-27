"use client";

import { useState, type ReactNode } from "react";
import { Chip } from "@/components/waypoint/controls";
import { StatusPill, type Tone } from "@/components/waypoint/status";
import { useApiData } from "@/lib/api/use-api";
import { appToday } from "@/lib/clock";
import { formatDay } from "@/lib/format";
import { cn } from "@/lib/utils";
import { BRAND_NAME, type BrandCode, type Capacity as CapacityData } from "./data";

const BRANDS: BrandCode[] = ["F", "S", "T"];
const FILL: Record<BrandCode, string> = { F: "bg-wp-brand-fresh", S: "bg-wp-brand-style", T: "bg-wp-brand-tech" };
const label = "text-[10px] font-semibold tracking-[.06em] text-wp-muted uppercase";

/** Vehicles a day would need against those in service, and what that means for the week. */
function verdict(need: number, inService: number): [Tone, string] {
  const spare = Math.floor(inService - need);
  if (spare >= 3) return ["good", `${spare} vehicles free for the workshop`];
  if (spare >= 1) return ["info", `Tight: ${spare} spare`];
  if (spare === 0) return ["warn", "Every vehicle needed"];
  return ["crit", `Short of ${-spare}: hire or move orders`];
}

/**
 * Plan future capacity, the last stage of the workflow: our demand forecast (Datathon Task 2A) for the
 * depot, week by week, turned into a daily need and set against the fleet. The dispatcher sees which
 * weeks have room for maintenance and which need every vehicle (or more) well before the week starts.
 */
export function Capacity() {
  const cap = useApiData<CapacityData>("/dispatch/capacity");
  const [picked, setPicked] = useState<string | null>(null);
  if (!cap.data) {
    return <Page><div className="text-wp-text-2">{cap.error ?? "Loading the forecast…"}</div></Page>;
  }
  const { fleet, recent } = cap.data;
  // One forecast per source: our scored submission (the competition's weeks) and, when loaded, the same models
  // run on the weeks after today. The upcoming one opens first.
  const sources = [...new Set(cap.data.forecast.map((f) => f.source))].map((src) => {
    const starts = cap.data!.forecast.filter((f) => f.source === src).map((f) => f.week_start).sort();
    return { src, first: starts[0], last: starts[starts.length - 1] };
  }).sort((a, b) => b.first.localeCompare(a.first));
  const today = appToday();
  const chosen = sources.find((x) => x.src === picked) ?? sources.find((x) => x.last >= today) ?? sources[0];
  const forecast = chosen ? cap.data.forecast.filter((f) => f.source === chosen.src) : [];
  const active = fleet.filter((v) => v.active);
  const roundM3 = active.reduce((a, v) => a + v.m3, 0);
  const reeferM3 = active.filter((v) => v.carries_chilled).reduce((a, v) => a + v.m3, 0);
  const workshop = fleet.filter((v) => !v.active).map((v) => v.vehicle);
  // Vehicles a cubic metre took on recent days (brand and district splits included); without history,
  // fall back to every vehicle making one full trip.
  const perM3 = recent.vehicles && recent.m3 ? recent.vehicles / recent.m3 : active.length / Math.max(1, roundM3);
  const calibrated = Boolean(recent.vehicles && recent.m3);

  if (forecast.length === 0) {
    return (
      <Page>
        <Header />
        <div className="rounded-lg border border-wp-border bg-wp-surface p-4 text-wp-text-2">
          No forecast is loaded for this depot yet. Load it with <code>backend/scripts/load_forecast.py</code>.
        </div>
      </Page>
    );
  }

  const weeks = [...new Set(forecast.map((f) => f.week_start))].sort().map((start) => {
    const rows = forecast.filter((f) => f.week_start === start);
    const days = Math.max(1, Number(rows[0].operating_days));
    const byBrand = Object.fromEntries(BRANDS.map((b) => [b, Number(rows.find((r) => r.brand === b)?.total_m3 ?? 0) / days])) as Record<BrandCode, number>;
    const daily = BRANDS.reduce((a, b) => a + byBrand[b], 0);
    const chilled = rows.reduce((a, r) => a + Number(r.chilled_m3), 0) / days;
    return { start, year: rows[0].iso_year, week: rows[0].iso_week, days, byBrand, daily, chilled, need: daily * perM3,
             festival: rows[0].festival, payday: rows[0].payday };
  });
  const peak = weeks.reduce((a, w) => (w.daily > a.daily ? w : a), weeks[0]);
  const quiet = weeks.reduce((a, w) => (w.daily < a.daily ? w : a), weeks[0]);
  const recentM3 = recent.m3 ?? 0;
  const scale = Math.max(recentM3, ...weeks.map((w) => w.daily)) * 1.15;
  const source = forecast[0].source;

  return (
    <Page>
      <Header source={source} first={weeks[0]} last={weeks[weeks.length - 1]} />
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-wp-border bg-wp-surface px-3 py-2">
        <span className={label}>Forecast weeks</span>
        {sources.map((x) => (
          <Chip key={x.src} active={x.src === chosen?.src} onClick={() => setPicked(x.src)}>
            {x.last < today ? "Competition weeks" : "Next 10 weeks"} · {formatDay(x.first)} to {formatDay(x.last)}
          </Chip>
        ))}
        <span className="basis-full text-[12px] text-wp-text-2">{aboutSource(source, today)}</span>
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Tile name="Fleet in service" value={`${active.length} vehicles`} note={`${Math.round(roundM3)} m³ one round · ${Math.round(reeferM3)} m³ refrigerated${workshop.length ? ` · ${workshop.join(", ")} in the workshop` : ""}`} />
        <Tile name="Recent days" value={calibrated ? `${Math.round(recentM3)} m³ · ${recent.vehicles} vehicles` : "No history yet"}
              note={calibrated ? `Average of the last ${recent.days} released plans (${recent.trips} trips a day)` : "Estimates assume one full trip per vehicle"} />
        <Tile name="Busiest week" value={`W${peak.week} · ${Math.round(peak.daily)} m³/day`} note={`About ${Math.ceil(peak.need)} vehicles a day${peak.festival ? ` · ${festivalName(peak.festival)}` : ""}`} />
        <Tile name="Quietest week" value={`W${quiet.week} · ${Math.round(quiet.daily)} m³/day`} note={`About ${Math.ceil(quiet.need)} vehicles a day: best week for planned maintenance`} />
      </div>

      <section className="rounded-lg border border-wp-border bg-wp-surface">
        <div className="flex flex-wrap items-center gap-3 border-b border-wp-border p-3">
          <h2 className="text-[15px] font-semibold">Forecast need per working day, by week</h2>
          <span className="ml-auto flex flex-wrap gap-3 text-[11px] text-wp-text-2">
            {BRANDS.map((b) => <span key={b} className="flex items-center gap-1"><span className={cn("size-2.5 rounded-sm", FILL[b])} />{BRAND_NAME[b]}</span>)}
            {calibrated && <span className="flex items-center gap-1"><span className="h-3 border-l-2 border-wp-text" />Recent days</span>}
          </span>
        </div>
        <div className={cn(ROW, "hidden border-b border-wp-border px-3 py-2 md:grid")}>
          <div className={label}>Week</div><div className={label}>Volume a working day</div><div className={label}>Vehicles a day</div>
          <div className={label}>Chilled a day</div><div className={label}>What it means</div>
        </div>
        {weeks.map((w) => {
          const chilledShare = reeferM3 ? w.chilled / reeferM3 : 0;
          const [tone, text] = verdict(w.need, active.length);
          const change = recentM3 ? Math.round((w.daily / recentM3 - 1) * 100) : null;
          return (
            <div key={w.start} className={cn(ROW, "grid grid-cols-1 gap-1 border-b border-wp-border px-3 py-2 last:border-b-0")}>
              <div>
                <b>W{w.week}</b> <span className="text-wp-text-2">{formatDay(w.start)}</span>
                <div className="text-[11px] text-wp-muted">
                  {w.days} working days{w.payday ? " · payday" : ""}{w.festival ? ` · ${festivalName(w.festival)}` : ""}
                </div>
              </div>
              <div className="relative h-5 rounded bg-wp-surface-2" role="img"
                   aria-label={`Week ${w.week}: ${Math.round(w.daily)} cubic metres a working day`}>
                <div className="flex h-full overflow-hidden rounded">
                  {BRANDS.map((b) => (
                    <div key={b} className={FILL[b]} style={{ width: `${(w.byBrand[b] / scale) * 100}%` }}
                         title={`${BRAND_NAME[b]} ${w.byBrand[b].toFixed(1)} m³ a day`} />
                  ))}
                </div>
                {calibrated && <div className="absolute -inset-y-0.5 border-l-2 border-wp-text" style={{ left: `${(recentM3 / scale) * 100}%` }} />}
              </div>
              <div className="text-[12px]">
                <b>about {Math.ceil(w.need)}</b> <span className="text-wp-text-2">of {active.length}</span>
                <div className="text-[11px] text-wp-text-2">
                  {Math.round(w.daily)} m³{change !== null ? ` · ${change > 0 ? "+" : ""}${change}% vs recent` : ""}
                </div>
              </div>
              <div className={cn("text-[12px]", chilledShare > 0.85 && "font-semibold text-wp-warn")}>
                {Math.round(w.chilled)} m³
                <div className="text-[11px] text-wp-text-2">{Math.round(chilledShare * 100)}% of refrigerated space</div>
              </div>
              <div><StatusPill state={tone}>{text}</StatusPill></div>
            </div>
          );
        })}
      </section>

      <p className="text-[11px] text-wp-muted">
        Need a working day = the week&apos;s forecast volume ÷ its working days (Sundays and public holidays off). Vehicles a day
        scales that volume by how many vehicles the same volume took on recent days, since trips split by brand and district and
        Fresh trips must finish within 270 min. Refrigerated space is one trip per refrigerated vehicle. Source: {source}.
      </p>
    </Page>
  );
}

const ROW = "md:grid-cols-[140px_minmax(0,1fr)_130px_150px_220px] md:items-center md:gap-3";

/** What a forecast is, in a line: the dispatcher should never take past weeks for the coming ones. */
function aboutSource(source: string, today: string): string {
  if (source.includes("extended calendar")) {
    return `Our saved Datathon Task 2A model, unchanged, run on the weeks after today. The competition calendar ends on 28 June 2026, so this one is extended with its own rules (Sundays off, paydays on the 25th and the month's last day, the monsoon months, a 9-day build-up before each festival); the festival dates are ours: Deepavali 8 Nov, Christmas 25 Dec, Thai Pongal 15 Jan.`;
  }
  return `Our scored Datathon submission: the competition's forecast weeks${today > "2026-06-07" ? ", which are before today's date" : ""}. Shown for its accuracy (2.1% error on chilled volume in backtests).`;
}

/** "new_year" -> "New year" */
const festivalName = (f: string) => f.split(", ").map((x) => x.charAt(0).toUpperCase() + x.slice(1).replaceAll("_", " ")).join(", ");

function Header({ source, first, last }: { source?: string; first?: { week: number; year: number }; last?: { week: number; year: number } }) {
  return (
    <div>
      <h1 className="text-[22px] leading-7 font-bold">Plan future capacity</h1>
      <div className="text-[12px] text-wp-text-2">
        {source && first && last
          ? `Demand forecast ${first.year} W${first.week}–${last.year !== first.year ? `${last.year} ` : ""}W${last.week} against the fleet in service today`
          : "Demand forecast against the fleet"}
      </div>
    </div>
  );
}

function Tile({ name, value, note }: { name: string; value: string; note: string }) {
  return (
    <div className="rounded-lg border border-wp-border bg-wp-surface px-3 py-2">
      <div className={label}>{name}</div>
      <div className="text-[18px] leading-6 font-bold">{value}</div>
      <div className="text-[11px] text-wp-text-2">{note}</div>
    </div>
  );
}

function Page({ children }: { children: ReactNode }) {
  return <div className="mx-auto flex max-w-[1440px] flex-col gap-4 p-4 sm:p-6">{children}</div>;
}
