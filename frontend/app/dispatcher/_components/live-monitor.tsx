"use client";

import { useState, type ReactNode } from "react";
import { Button, Chip } from "@/components/waypoint/controls";
import { Banner, StatusPill, type Tone } from "@/components/waypoint/status";
import { errorMessage, useApi, useApiData } from "@/lib/api/use-api";
import { formatDay, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { EXCEPTION_STYLE, type Closeout, type Exception, type FleetRow, type Monitor, type RunProgress } from "./data";

const FLEET_COLUMNS = "grid grid-cols-[96px_120px_110px_minmax(0,1fr)_64px_180px] gap-3";
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

const RUN_STATE: Record<string, { tone: Tone; label: string }> = {
  planned: { tone: "info", label: "Plan sent, at the depot" },
  in_progress: { tone: "good", label: "On the road" },
  complete: { tone: "good", label: "Day complete" },
};

function dots(f: FleetRow) {
  const done = "●".repeat(f.stops_done);
  const now = f.state === "on_the_way" && f.stops_done < f.stops_total ? "◉" : "";
  return done + now + "○".repeat(Math.max(0, f.stops_total - f.stops_done - now.length));
}

/**
 * Live: the planning office watches every depot on one screen. Planning stays one depot at a time
 * (Plan tab); watching does not need to. Each depot gets its own summary, attention is one list for
 * both, and the end of the day closes each run: failed deliveries move on, fuel is counted.
 */
export function LiveMonitor() {
  const [scope, setScope] = useState("all");
  const monitor = useApiData<Monitor>(`/dispatch/monitor?depot=${scope}`, 15_000);
  const request = useApi();
  const [selected, setSelected] = useState<number | null>(null);
  const [replies, setReplies] = useState<Record<string, string>>({});
  const [moved, setMoved] = useState<Record<number, string>>({});
  /** Finished trips fold away so the list leads with what still needs watching. */
  const [showDone, setShowDone] = useState(false);

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

  async function requeue(orderId: number) {
    setMoved((m) => ({ ...m, [orderId]: "Moving…" }));
    try {
      const r = await request<{ delivery_date: string; confirmation_no: string }>(`/dispatch/orders/${orderId}/requeue`,
                                                                                  { method: "POST", body: {} });
      setMoved((m) => ({ ...m, [orderId]: `✓ ${r.confirmation_no} moved to ${formatDay(r.delivery_date)}; the store is told.` }));
      await monitor.reload();
    } catch (err) {
      setMoved((m) => ({ ...m, [orderId]: errorMessage(err) }));
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
  const several = m.depots.length > 1;
  const showDepot = several && scope === "all";
  const fleet = [...m.fleet].sort((a, b) => vehicleStatus(a).risk - vehicleStatus(b).risk || a.vehicle_source_id.localeCompare(b.vehicle_source_id));
  const doneCount = fleet.filter((f) => f.state === "complete" && !f.no_signal && f.exception_count === 0).length;
  const shownFleet = showDone ? fleet : fleet.filter((f) => !(f.state === "complete" && !f.no_signal && f.exception_count === 0));
  const chosen = fleet.find((f) => f.route_id === selected);
  // Exception texts come from the database with fleet codes (RV-03); show the VEH ids used everywhere else.
  const codes = new Map(m.fleet.map((f) => [f.vehicle_code, f.vehicle_source_id]));
  const named = (text: string) => text
    .replace(/\b[A-Z]{2}-\d{2}\b/g, (code) => codes.get(code) ?? code)
    .replace(/\b(Short|Missing|Damaged) x(\d+(?:\.\d+)?)/g, (_, kind: string, n: string) => `${Number(n)} ${kind.toLowerCase()}`);
  const chosenStops = chosen ? m.stops.filter((s) => s.route_id === chosen.route_id) : [];

  return (
    <Page>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-[22px] leading-7 font-bold">Live{showDepot ? " · all depots" : m.runs[0] ? ` · ${m.runs[0].depot}` : ""}</h1>
        {monitor.error ? (
          <StatusPill state="offline">Not receiving updates since {formatTime(m.server_time)}</StatusPill>
        ) : (
          <StatusPill state="good">Live</StatusPill>
        )}
        <span className="text-[11px] text-wp-text-2">Updated {formatTime(m.server_time)} · events arrive as drivers and loaders sync</span>
        {several && (
          <div className="flex flex-wrap gap-1.5 sm:ml-auto" role="group" aria-label="Depots shown">
            <Chip active={scope === "all"} onClick={() => setScope("all")}>All depots</Chip>
            {m.depots.map((d) => (
              <Chip key={d.depot_id} active={scope === String(d.depot_id)} onClick={() => setScope(String(d.depot_id))}>{d.name}</Chip>
            ))}
          </div>
        )}
      </div>

      {m.runs.length === 0 ? (
        <Banner state="info">No plan sent yet. Send a plan from the Plan tab and its trips appear here.</Banner>
      ) : (
        <div className={cn("grid gap-3", m.runs.length > 1 && "lg:grid-cols-2")}>
          {m.runs.map((run) => (
            <DepotCard key={run.run_id} run={run} trips={m.fleet.filter((f) => f.run_id === run.run_id)}
                       attention={m.exceptions.filter((e) => e.depot === run.depot).length} />
          ))}
        </div>
      )}

      <section className="flex flex-col gap-2 rounded-lg border border-wp-border bg-wp-surface p-4">
        <h2 className="text-[15px] leading-5 font-semibold">Needs attention{showDepot ? " · both depots" : ""}</h2>
        {Object.values(moved).filter((t) => t.startsWith("✓")).map((t) => (
          <div key={t} className="rounded-md bg-wp-info-tint px-3 py-2 text-[12px] font-semibold text-wp-info">Moved today: {t.slice(2)}</div>
        ))}
        {m.exceptions.length === 0 && <div className="py-2 text-wp-text-2">Nothing needs attention right now.</div>}
        {m.exceptions.map((e, i) => {
          const style = EXCEPTION_STYLE[e.kind] ?? { label: e.kind, state: "info" as Tone };
          const isFlag = Boolean(e.flag_id) && (e.kind === "loader_flag" || e.kind === "driver_reported");
          return (
            <div key={`${e.kind}-${e.flag_id ?? e.route_id ?? i}-${e.stop_id ?? ""}-${e.order_id ?? ""}`} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-wp-border py-3">
              <div className="flex w-[180px] flex-none flex-wrap items-center gap-1.5">
                <StatusPill state={style.state}>{style.label}</StatusPill>
                {showDepot && e.depot && <span className="rounded border border-wp-border px-1.5 text-[11px] font-semibold text-wp-text-2">{e.depot}</span>}
              </div>
              <div className="min-w-[200px] flex-1">
                <div className="font-semibold">{named(e.detail)}</div>
                {e.kind === "no_signal" && (
                  <div className="text-[11px] text-wp-text-2">
                    The driver’s phone keeps recording offline. Stops after the last signal show as not confirmed until it syncs.
                  </div>
                )}
              </div>
              <div className="w-[56px] flex-none text-[11px] text-wp-text-2">{e.since ? formatTime(e.since) : ""}</div>
              {isFlag && (
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="secondary" onClick={() => void reply(e, "proceed_short", "Send partial")}>Send partial</Button>
                  <Button variant="secondary" onClick={() => void reply(e, "hold", "Hold the vehicle, replacement coming")}>Hold vehicle</Button>
                </div>
              )}
              {e.kind === "delivery_failed" && e.order_id && !moved[e.order_id] && (
                <Button variant="secondary" onClick={() => void requeue(e.order_id!)}>Move to next delivery day</Button>
              )}
              {e.route_id && (
                <Button variant="link" onClick={() => setSelected(e.route_id)}>See stops</Button>
              )}
              {e.flag_id && replies[e.flag_id] && <div className="basis-full text-[11px] font-semibold text-wp-info">{replies[e.flag_id]}</div>}
              {e.order_id && moved[e.order_id] && <div className="basis-full text-[11px] font-semibold text-wp-info">{moved[e.order_id]}</div>}
            </div>
          );
        })}
      </section>

      <div className={cn("grid items-start gap-4", chosen && "xl:grid-cols-[minmax(0,1fr)_460px]")}>
        <section className="flex flex-col gap-1 overflow-x-auto rounded-lg border border-wp-border bg-wp-surface p-4">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h2 className="text-[15px] leading-5 font-semibold">
              {showDone ? "All trips" : "Trips still running"} · most at risk first
            </h2>
            {doneCount > 0 && (
              <Button variant="link" className="ml-auto" onClick={() => setShowDone(!showDone)}>
                {showDone ? "Hide completed trips" : `Show ${doneCount} completed ${doneCount === 1 ? "trip" : "trips"}`}
              </Button>
            )}
          </div>
          {shownFleet.length === 0 && <div className="py-2 text-wp-text-2">Every trip is back at the depot.</div>}
          <div className="flex min-w-[700px] flex-col gap-1">
            <div className={cn(FLEET_COLUMNS, "px-2 text-[10px] font-semibold tracking-[.06em] text-wp-muted uppercase")}>
              <div>Depot</div><div>Vehicle</div><div>Stops</div><div>Next stop</div><div>Planned</div><div>Status</div>
            </div>
            {shownFleet.map((f) => {
              const status = vehicleStatus(f);
              return (
                <button key={f.route_id} type="button" onClick={() => setSelected(selected === f.route_id ? null : f.route_id)}
                        aria-pressed={selected === f.route_id}
                        className={cn(FLEET_COLUMNS, "min-h-10 cursor-pointer items-center border-t border-wp-border px-2 text-left",
                                      selected === f.route_id ? "bg-wp-info-tint" : "bg-transparent")}>
                  <div className="text-[12px] text-wp-text-2">{f.depot}</div>
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
              {chosen.depot} · driver {chosen.driver_name ?? "not assigned"} · last signal {chosen.last_seen_at ? formatTime(chosen.last_seen_at) : "none yet"}
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

      {m.closeout.length > 0 && (
        <section className="flex flex-col gap-3" aria-labelledby="eod">
          <div>
            <h2 id="eod" className="text-[17px] font-bold">End of the day</h2>
            <div className="text-[12px] text-wp-text-2">
              Each depot&apos;s run closes when every trip is done. Failed deliveries move to the next delivery day with the
              driver&apos;s reason; fuel counts the day&apos;s route distance (out, between stops and back) against each vehicle&apos;s weekly quota.
            </div>
          </div>
          <div className={cn("grid gap-3", m.closeout.length > 1 && "xl:grid-cols-2")}>
            {m.closeout.map((c) => <CloseoutCard key={c.run_id} c={c} moved={moved} onMove={requeue} />)}
          </div>
        </section>
      )}
    </Page>
  );
}

function DepotCard({ run, trips, attention }: { run: RunProgress; trips: FleetRow[]; attention: number }) {
  const state = RUN_STATE[run.state] ?? { tone: "info" as Tone, label: run.state };
  const atDepot = trips.filter((f) => ["planned", "loading", "loaded"].includes(f.state)).length;
  const stat = "flex flex-col gap-0.5";
  return (
    <div className="rounded-lg border border-wp-border bg-wp-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[16px] font-bold">{run.depot} depot</h2>
        <span className="text-[12px] text-wp-text-2">deliveries on {formatDay(run.service_date)}</span>
        <StatusPill state={state.tone} className="ml-auto">{state.label}</StatusPill>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className={stat}><span className="text-[10px] font-semibold tracking-[.06em] text-wp-muted uppercase">Trips departed</span>
          <b className="text-[20px]">{run.routes_departed} of {trips.length}</b><span className="text-[11px] text-wp-text-2">{atDepot} still at the depot</span></div>
        <div className={stat}><span className="text-[10px] font-semibold tracking-[.06em] text-wp-muted uppercase">Delivered</span>
          <b className="text-[20px]">{run.orders_delivered} of {run.orders_total}</b><span className="text-[11px] text-wp-text-2">{run.state === "complete" ? "day complete" : `plan says ${run.orders_due_by_now} by now`}</span></div>
        <div className={stat}><span className="text-[10px] font-semibold tracking-[.06em] text-wp-muted uppercase">Fresh at risk</span>
          <b className={cn("text-[20px]", run.fresh_at_risk > 0 && "text-wp-crit")}>{run.fresh_at_risk}</b><span className="text-[11px] text-wp-text-2">deadline close</span></div>
        <div className={stat}><span className="text-[10px] font-semibold tracking-[.06em] text-wp-muted uppercase">Needs attention</span>
          <b className={cn("text-[20px]", attention > 0 && "text-wp-warn")}>{attention}</b><span className="text-[11px] text-wp-text-2">see the list below</span></div>
      </div>
    </div>
  );
}

function CloseoutCard({ c, moved, onMove }: { c: Closeout; moved: Record<number, string>; onMove: (orderId: number) => Promise<void> }) {
  const total = c.delivered + c.delivered_in_part + c.not_delivered + c.not_yet;
  const done = c.state === "complete";
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-wp-border bg-wp-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[15px] font-bold">{c.depot} · {formatDay(c.service_date)}</h3>
        <StatusPill state={done ? "good" : "info"} className="ml-auto">{done ? "Day complete" : `${c.not_yet} of ${total} orders still to deliver`}</StatusPill>
      </div>
      <div className="grid grid-cols-2 gap-2 text-[13px] sm:grid-cols-4">
        <div><b className="text-[18px] text-wp-good">{c.delivered}</b><div className="text-wp-text-2">delivered in full</div></div>
        <div><b className="text-[18px] text-wp-warn">{c.delivered_in_part}</b><div className="text-wp-text-2">some items missing</div></div>
        <div><b className="text-[18px] text-wp-crit">{c.not_delivered}</b><div className="text-wp-text-2">not delivered</div></div>
        <div><b className="text-[18px]">{c.confirmed_by_store}</b><div className="text-wp-text-2">confirmed by the store · {c.awaiting_store} waiting</div></div>
      </div>

      {c.failed.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-md border border-wp-crit bg-wp-crit-tint/50 p-3">
          <div className="text-[12px] font-bold text-wp-crit">Not delivered · move each to the next delivery day</div>
          {c.failed.map((f) => (
            <div key={f.order_id} className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{f.outlet_code}</span>
              <span className="text-[12px] text-wp-text-2">{f.temp === "chilled" ? "❄ chilled" : "dry"} · {f.reason ?? f.reason_code}{f.note ? ` · “${f.note}”` : ""}</span>
              {moved[f.order_id] ? (
                <span className="text-[12px] font-semibold text-wp-info">{moved[f.order_id]}</span>
              ) : (
                <Button variant="secondary" className="ml-auto" onClick={() => void onMove(f.order_id)}>Move to next delivery day</Button>
              )}
            </div>
          ))}
        </div>
      )}

      {c.fuel.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[460px] text-[12px]">
            <thead>
              <tr className="text-left text-[10px] tracking-[.06em] text-wp-muted uppercase">
                <th className="py-1 font-semibold">Vehicle</th><th className="font-semibold">Today</th>
                <th className="font-semibold">Used this week</th><th className="font-semibold">Weekly quota</th><th className="font-semibold">Left this week</th>
              </tr>
            </thead>
            <tbody>
              {c.fuel.map((v) => {
                const left = v.left_week_l === null ? null : Number(v.left_week_l);
                const low = left !== null && v.quota_l !== null && left < Number(v.quota_l) * 0.2;
                return (
                  <tr key={v.vehicle_id} className="border-t border-wp-border">
                    <td className="py-1 font-semibold">{v.source_id}</td>
                    <td>{Number(v.today_l).toFixed(1)} L · {Number(v.today_km)} km</td>
                    <td>{Number(v.used_week_l).toFixed(1)} L</td>
                    <td>{v.quota_l === null ? "—" : `${Number(v.quota_l)} L`}</td>
                    <td className={cn("font-semibold", low ? "text-wp-crit" : "text-wp-good")}>{left === null ? "—" : `${left.toFixed(1)} L${low ? " · low" : ""}`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Page({ children }: { children: ReactNode }) {
  return <div className="mx-auto flex max-w-[1440px] flex-col gap-4 p-4 sm:p-6">{children}</div>;
}
