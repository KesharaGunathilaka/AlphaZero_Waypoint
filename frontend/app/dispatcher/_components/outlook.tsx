"use client";

import { Snowflake, Truck } from "lucide-react";
import type { ReactNode } from "react";
import { BrandMonogram } from "@/components/waypoint/data";
import { StatusPill, type Tone } from "@/components/waypoint/status";
import { useApiData } from "@/lib/api/use-api";
import { useNow } from "@/lib/clock";
import { formatDayTime, formatTime, plural, timeLeft } from "@/lib/format";
import { cn } from "@/lib/utils";
import { BRAND, BRAND_NAME, type BrandCode, type Outlook } from "./data";

/**
 * Before orders close: what the stores have asked for so far, set against what the available fleet can
 * carry in one round of trips. The dispatcher sees a squeeze coming while there is still time to act
 * (bring a vehicle back from the workshop, warn a brand) instead of an empty page until 16:00.
 */
export function OutlookPanel({ date }: { date: string }) {
  const outlook = useApiData<Outlook>(`/dispatch/runs/${date}/outlook`, 60_000);
  useNow(); // re-render the cutoff countdown (cutoffs run on real time, not the demo clock)
  const o = outlook.data;
  if (!o) {
    return (
      <div className="rounded-lg border border-wp-border bg-wp-surface p-4 text-wp-text-2">
        {outlook.error ?? "Loading the orders so far…"}
      </div>
    );
  }

  const sum = (rows: Outlook["demand"], k: "orders" | "kg" | "m3" | "van_only" | "moved_in") => rows.reduce((a, r) => a + Number(r[k]), 0);
  const chilled = o.demand.filter((d) => d.temp === "chilled");
  const totalM3 = sum(o.demand, "m3");
  const chilledM3 = sum(chilled, "m3");
  const vanOnly = sum(o.demand, "van_only");
  const movedIn = sum(o.demand, "moved_in");
  const orders = sum(o.demand, "orders");

  const fleet = (f: (r: Outlook["fleet"][number]) => boolean) => o.fleet.filter(f);
  const m3 = (rows: Outlook["fleet"]) => rows.reduce((a, r) => a + Number(r.m3_per_trip ?? 0), 0);
  const count = (rows: Outlook["fleet"]) => rows.reduce((a, r) => a + Number(r.available), 0);
  const all = fleet(() => true);
  const reefers = fleet((r) => r.carries_chilled);
  const vans = fleet((r) => r.is_van);
  const workshop = o.fleet.flatMap((r) => r.in_workshop);

  const brands = (["F", "S", "T"] as BrandCode[]).map((b) => {
    const rows = o.demand.filter((d) => d.brand === b);
    return { b, orders: sum(rows, "orders"), m3: sum(rows, "m3"), kg: sum(rows, "kg"),
             chilled: sum(rows.filter((r) => r.temp === "chilled"), "orders"), vanOnly: sum(rows, "van_only") };
  });

  return (
    <section aria-label="Orders so far" className="flex flex-col gap-3 rounded-lg border border-wp-border bg-wp-surface p-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-[15px] font-semibold">Orders so far against the fleet</h2>
        <span className="text-[12px] text-wp-text-2">
          Closes automatically at {formatTime(o.cutoff_at)} ({timeLeft(o.cutoff_at)}) · {formatDayTime(o.cutoff_at)}
        </span>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-left">
            <thead className="text-[10px] font-semibold tracking-[.06em] text-wp-muted uppercase">
              <tr className="border-b border-wp-border">
                <th className="py-1.5 font-semibold">Brand</th>
                <th className="py-1.5 text-right font-semibold">Orders</th>
                <th className="py-1.5 text-right font-semibold">Chilled</th>
                <th className="py-1.5 text-right font-semibold">Van-only</th>
                <th className="py-1.5 text-right font-semibold">Volume</th>
                <th className="py-1.5 text-right font-semibold">Weight</th>
              </tr>
            </thead>
            <tbody>
              {brands.map((r) => (
                <tr key={r.b} className="border-b border-wp-border/60">
                  <td className="py-1.5"><BrandMonogram brand={BRAND[r.b]} outlet={BRAND_NAME[r.b]} /></td>
                  <td className="py-1.5 text-right font-semibold">{r.orders}</td>
                  <td className="py-1.5 text-right">{r.chilled || "—"}</td>
                  <td className="py-1.5 text-right">{r.vanOnly || "—"}</td>
                  <td className="py-1.5 text-right">{r.m3.toFixed(1)} m³</td>
                  <td className="py-1.5 text-right">{Math.round(r.kg).toLocaleString("en-GB")} kg</td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td className="py-1.5">All</td>
                <td className="py-1.5 text-right">{orders}</td>
                <td className="py-1.5 text-right">{sum(chilled, "orders")}</td>
                <td className="py-1.5 text-right">{vanOnly}</td>
                <td className="py-1.5 text-right">{totalM3.toFixed(1)} m³</td>
                <td className="py-1.5 text-right">{Math.round(sum(o.demand, "kg")).toLocaleString("en-GB")} kg</td>
              </tr>
            </tbody>
          </table>
          {movedIn > 0 && (
            <div className="mt-2 text-[12px] text-wp-warn">▲ {plural(movedIn, "order")} moved in from an earlier day: they go first.</div>
          )}
        </div>

        <div className="flex flex-col gap-2.5">
          <Gauge icon={<Truck aria-hidden className="size-3.5" />} label="All goods" need={totalM3} have={m3(all)}
                 fleet={`${count(all)} vehicles`} />
          <Gauge icon={<Snowflake aria-hidden className="size-3.5" />} label="Chilled goods" need={chilledM3} have={m3(reefers)}
                 fleet={`${count(reefers)} refrigerated`} />
          <div className="flex flex-wrap items-center gap-2 text-[12px]">
            <span className="font-semibold">Van-only stores</span>
            <span className="text-wp-text-2">{plural(vanOnly, "order")} · {plural(count(vans), "van")} available</span>
          </div>
          {workshop.length > 0 && (
            <div className="text-[12px] text-wp-text-2">
              In the workshop: <b className="text-wp-text">{workshop.join(", ")}</b> (bring one back on the Plan tab after orders close).
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/** Demand as a share of one round of trips (every available vehicle once). Two rounds are possible. */
function Gauge({ icon, label, need, have, fleet }: { icon: ReactNode; label: string; need: number; have: number; fleet: string }) {
  const share = have > 0 ? need / have : need > 0 ? Infinity : 0;
  const pct = Math.round(share * 100);
  const [tone, text]: [Tone, string] =
    share <= 0.85 ? ["good", "fits in one round"] : share <= 1.7 ? ["warn", "needs second trips"] : ["crit", "more than two rounds"];
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        <span className="inline-flex items-center gap-1 font-semibold">{icon}{label}</span>
        <span className="text-wp-text-2">{need.toFixed(1)} of {have.toFixed(0)} m³ ({fleet}, one trip each)</span>
        <StatusPill state={tone} className="ml-auto">{text}</StatusPill>
      </div>
      <div className="relative h-2.5 overflow-hidden rounded-full bg-wp-surface-2" role="img" aria-label={`${label}: ${pct} percent of one round`}>
        <div className={cn("h-full", tone === "good" ? "bg-wp-good" : tone === "warn" ? "bg-wp-gauge-amber" : "bg-wp-crit")}
             style={{ width: `${Math.min(100, pct / 2)}%` }} />
        <div className="absolute inset-y-0 left-1/2 border-l-2 border-wp-surface" title="One round" />
      </div>
      <div className="flex justify-between text-[10px] text-wp-muted"><span>0</span><span>one round</span><span>two rounds</span></div>
    </div>
  );
}
