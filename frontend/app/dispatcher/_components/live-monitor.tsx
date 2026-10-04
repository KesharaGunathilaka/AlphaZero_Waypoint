"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/waypoint/controls";
import { KpiTile } from "@/components/waypoint/data";
import { Banner, StatusPill, type Tone } from "@/components/waypoint/status";
import { errorMessage, useApi, useApiData } from "@/lib/api/use-api";
import { formatDay, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { EXCEPTION_STYLE, type Exception, type FleetRow, type Monitor } from "./data";

const FLEET_COLUMNS = "grid grid-cols-[120px_120px_minmax(0,1fr)_64px_180px] gap-3";
const DETAIL_COLUMNS = "grid grid-cols-[minmax(0,1fr)_56px_96px_70px] gap-2";

/** How a vehicle is doing, worst first. No signal never shows as "on time": we do not know. */
function vehicleStatus(f: FleetRow): { state: Tone; label: string; risk: number } {
  if (f.no_signal) return { state: "offline", label: `No signal${f.last_seen_at ? ` since ${formatTime(f.last_seen_at)}` : ""}`, risk: 0 };
  if (f.exception_count > 0) return { state: "warn", label: "Needs attention", risk: 1 };
  switch (f.state) {
    case "on_the_way": return { state: "good", label: "On the way", risk: 2 };
    case "loaded": return { state: "info", label: "Loaded, not departed", risk: 3 };
    case "loading": return { state: "info", label: "Loading", risk: 4 };
    case "planned": return { state: "info", label: "Waiting to load", risk: 5 };
    case "complete": return { state: "good", label: "Complete", risk: 6 };
    default: return { state: "info", label: f.state, risk: 5 };
  }
}

function dots(f: FleetRow) {
  const done = "●".repeat(f.stops_done);
  const now = f.state === "on_the_way" && f.stops_done < f.stops_total ? "◉" : "";
  return done + now + "○".repeat(Math.max(0, f.stops_total - f.stops_done - now.length));
}

/** Live: what needs attention now, and every vehicle sorted by risk. */
export function LiveMonitor() {
  const monitor = useApiData<Monitor>("/dispatch/monitor", 15_000);
  const request = useApi();
  const [selected, setSelected] = useState<number | null>(null);
  const [replies, setReplies] = useState<Record<string, string>>({});

  async function reply(e: Exception, type: "proceed_short" | "hold", text: string) {
    if (!e.flag_id) return;
    setReplies((r) => ({ ...r, [e.flag_id!]: "Sending…" }));
    try {
      await request(`/dispatch/flags/${e.flag_id}/reply`, { method: "POST", body: { type, text, resolve: true } });
      setReplies((r) => ({ ...r, [e.flag_id!]: `Sent: “${text}”. It reaches the tablet or phone on its next sync.` }));
      await monitor.reload();
    } catch (err) {
      setReplies((r) => ({ ...r, [e.flag_id!]: errorMessage(err) }));
    }
  }

  if (!monitor.data) {
    return (
      <Page>
        {monitor.error ? <Banner state="crit">{monitor.error}</Banner> : <div className="text-wp-text-2">Loading the live run…</div>}
      </Page>
    );
  }

  const m = monitor.data;
  const run = m.runs[0];
  const fleet = [...m.fleet].sort((a, b) => vehicleStatus(a).risk - vehicleStatus(b).risk || a.vehicle_source_id.localeCompare(b.vehicle_source_id));
  const chosen = fleet.find((f) => f.route_id === selected);
  // Exception texts come from the database with fleet codes (RV-03); show the VEH ids used everywhere else.
  const codes = new Map(m.fleet.map((f) => [f.vehicle_code, f.vehicle_source_id]));
  const named = (text: string) => text.replace(/\b[A-Z]{2}-\d{2}\b/g, (code) => codes.get(code) ?? code);
  const chosenStops = chosen ? m.stops.filter((s) => s.route_id === chosen.route_id) : [];

  return (
    <Page>
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="text-[22px] leading-7 font-bold">Live{run ? ` · deliveries on ${formatDay(run.service_date)}` : ""}</h1>
        {monitor.error ? (
          <StatusPill state="offline">Not receiving updates since {formatTime(m.server_time)}</StatusPill>
        ) : (
          <StatusPill state="good">Live</StatusPill>
        )}
        <span className="text-[11px] text-wp-text-2">Updated {formatTime(m.server_time)} · Events arrive as drivers and loaders sync</span>
      </div>

      {!run ? (
        <Banner state="info">No plan sent yet. Send the plan from the Plan tab and its trips appear here.</Banner>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:gap-4 lg:grid-cols-4">
          <KpiTile label="Trips departed" value={`${run.routes_departed} of ${m.fleet.length}`} context={`${fleet.filter((f) => ["planned", "loading", "loaded"].includes(f.state)).length} still at the depot`} />
          <KpiTile label="Orders delivered" value={`${run.orders_delivered} of ${run.orders_total}`} context={`Plan says ${run.orders_due_by_now} by now`} />
          <KpiTile label="Fresh at risk of missing its window" value={run.fresh_at_risk} context="Not yet delivered, deadline close" />
          <KpiTile label="Needs attention" value={m.exceptions.length} context="Ranked by urgency" />
        </div>
      )}

      <section className="flex flex-col gap-2 rounded-lg border border-wp-border bg-wp-surface p-4">
        <h2 className="text-[15px] leading-5 font-semibold">Needs attention</h2>
        {m.exceptions.length === 0 && <div className="py-2 text-wp-text-2">Nothing needs attention right now.</div>}
        {m.exceptions.map((e, i) => {
          const style = EXCEPTION_STYLE[e.kind] ?? { label: e.kind, state: "info" as Tone };
          const isFlag = Boolean(e.flag_id) && (e.kind === "loader_flag" || e.kind === "driver_reported");
          return (
            <div key={`${e.kind}-${e.flag_id ?? e.route_id ?? i}-${e.stop_id ?? ""}`} className="flex flex-wrap items-center gap-4 border-t border-wp-border py-3">
              <div className="w-[150px] flex-none"><StatusPill state={style.state}>{style.label}</StatusPill></div>
              <div className="min-w-[220px] flex-1">
                <div className="font-semibold">{named(e.detail)}</div>
                {e.kind === "no_signal" && (
                  <div className="text-[11px] text-wp-text-2">
                    The driver’s phone keeps recording offline. Stops after the last signal show as not confirmed until it syncs.
                  </div>
                )}
              </div>
              <div className="w-[70px] flex-none text-[11px] text-wp-text-2">{e.since ? formatTime(e.since) : ""}</div>
              {isFlag && (
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="secondary" onClick={() => void reply(e, "proceed_short", "Send partial")}>Send partial</Button>
                  <Button variant="secondary" onClick={() => void reply(e, "hold", "Hold the vehicle, replacement coming")}>Hold vehicle</Button>
                </div>
              )}
              {e.route_id && (
                <Button variant="link" onClick={() => setSelected(e.route_id)}>See stops</Button>
              )}
              {e.flag_id && replies[e.flag_id] && <div className="basis-full text-[11px] font-semibold text-wp-info">{replies[e.flag_id]}</div>}
            </div>
          );
        })}
      </section>

      <div className={cn("grid items-start gap-4", chosen && "xl:grid-cols-[minmax(0,1fr)_460px]")}>
        <section className="flex flex-col gap-1 overflow-x-auto rounded-lg border border-wp-border bg-wp-surface p-4">
          <h2 className="mb-2 text-[15px] leading-5 font-semibold">All trips · most at risk first</h2>
          <div className="flex min-w-[620px] flex-col gap-1">
          <div className={cn(FLEET_COLUMNS, "px-2 text-[10px] font-semibold tracking-[.06em] text-wp-muted uppercase")}>
            <div>Vehicle</div><div>Stops</div><div>Next stop</div><div>Planned</div><div>Status</div>
          </div>
          {fleet.map((f) => {
            const status = vehicleStatus(f);
            return (
              <button key={f.route_id} type="button" onClick={() => setSelected(selected === f.route_id ? null : f.route_id)}
                      aria-pressed={selected === f.route_id}
                      className={cn(FLEET_COLUMNS, "min-h-10 cursor-pointer items-center border-t border-wp-border px-2 text-left",
                                    selected === f.route_id ? "bg-wp-info-tint" : "bg-transparent")}>
                <div className="font-semibold">{f.vehicle_source_id} · trip {f.route_seq}</div>
                <div className="text-xs tracking-[2px]">{dots(f)}</div>
                <div>{f.next_outlet ?? (f.state === "complete" ? "Back to depot" : "—")}</div>
                <div>{f.next_planned ? formatTime(f.next_planned) : "—"}</div>
                <div><StatusPill state={status.state}>{status.label}</StatusPill></div>
              </button>
            );
          })}
          </div>
          <div className="mt-2 text-[11px] text-wp-muted">● done · ◉ now · ○ to do</div>
        </section>

        {chosen && (
          <section className="flex flex-col gap-2 rounded-lg border border-wp-border bg-wp-surface p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-[15px] leading-5 font-semibold">
                {chosen.vehicle_source_id} trip {chosen.route_seq} · plan against actual
              </h2>
              <button type="button" onClick={() => setSelected(null)} className="cursor-pointer text-sm text-wp-muted">✕ Close</button>
            </div>
            <div className="text-[11px] text-wp-text-2">
              Driver {chosen.driver_name ?? "not assigned"} · Last signal {chosen.last_seen_at ? formatTime(chosen.last_seen_at) : "none yet"}
            </div>
            <div className={cn(DETAIL_COLUMNS, "text-[10px] font-semibold tracking-[.06em] text-wp-muted uppercase")}>
              <div>Stop</div><div>Plan</div><div>Actual</div><div>Proof</div>
            </div>
            {chosenStops.map((s) => {
              const failed = s.outcomes?.includes("not_delivered");
              const unknown = !s.delivered_at && chosen.no_signal;
              return (
                <div key={s.stop_id}
                     className={cn(DETAIL_COLUMNS, "items-center border-t border-wp-border py-2",
                                   unknown && "bg-[repeating-linear-gradient(45deg,transparent,transparent_6px,var(--wp-surface-2)_6px,var(--wp-surface-2)_12px)]")}>
                  <div>{s.delivered_at ? (failed ? "✕" : "●") : "○"} {s.outlet_code}</div>
                  <div>{formatTime(s.planned_arrival)}</div>
                  <div className={failed ? "font-semibold text-wp-crit" : unknown ? "text-wp-offline" : "text-wp-text"}>
                    {s.delivered_at ? (failed ? "Not delivered" : formatTime(s.delivered_at)) : unknown ? "Not confirmed" : s.arrived_at ? `Arrived ${formatTime(s.arrived_at)}` : "—"}
                  </div>
                  <div className="text-[11px] text-wp-text-2">{s.proof_files ? `${s.proof_files} file${s.proof_files > 1 ? "s" : ""}` : ""}</div>
                </div>
              );
            })}
            {chosen.no_signal && (
              <div className="rounded-md bg-wp-offline-tint px-3 py-2 text-[11px] font-semibold text-wp-offline">
                ⊘ No signal. Stops after the last record are expected by plan, not confirmed. Store managers see
                “confirmation pending”, never a false “delivered”.
              </div>
            )}
          </section>
        )}
      </div>
    </Page>
  );
}

function Page({ children }: { children: ReactNode }) {
  return <div className="mx-auto flex max-w-[1440px] flex-col gap-4 p-4 sm:p-6">{children}</div>;
}
