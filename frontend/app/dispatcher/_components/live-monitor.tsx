"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Select } from "@/components/waypoint/controls";
import { KpiTile } from "@/components/waypoint/data";
import { StatusPill } from "@/components/waypoint/status";
import { cn } from "@/lib/utils";
import { ATTENTION, FLEET, stopDetail } from "./data";

/** Actions that open a call or message instead of sending an instruction to the driver's phone. */
const NON_INSTRUCTION_ACTIONS = new Set(["Call driver", "Tell store"]);
/** VN-12 has no signal, so instructions to it never reach the phone. */
const OFFLINE_ALERT_ID = "a2";

const FLEET_COLUMNS = "grid grid-cols-[80px_130px_minmax(0,1fr)_70px_140px] gap-3";
const DETAIL_COLUMNS = "grid grid-cols-[minmax(0,1fr)_56px_56px_90px] gap-2";

/** D3 · Live run monitor: what needs attention now, and every vehicle sorted by risk. */
export function LiveMonitor() {
  const [instructionStatus, setInstructionStatus] = useState<Record<string, string>>({});
  const [selectedVehicle, setSelectedVehicle] = useState<string | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  // Simulates delivery receipts: Sent → On phone → Seen by driver.
  function sendInstruction(alertId: string) {
    const offline = alertId === OFFLINE_ALERT_ID;
    const update = (status: string) => setInstructionStatus((s) => ({ ...s, [alertId]: status }));
    update("Sent");
    timers.current.push(
      setTimeout(() => update(offline ? "Waiting for signal" : "On phone"), 1200),
      setTimeout(() => update(offline ? "Waiting for signal" : "Seen by driver"), 2600),
    );
  }

  const selected = FLEET.find((f) => f.id === selectedVehicle);

  return (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-4 p-6">
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="text-[22px] leading-6 font-bold">Live run monitor · Wed 30 Sep, Fresh run</h1>
        <StatusPill state="good">Live</StatusPill>
        <span className="text-[11px] text-wp-text-2">Updated 05:58:10 · Events arrive as drivers sync</span>
        <Select aria-label="Depot" className="ml-auto">
          <option>All depots</option>
          <option>Colombo</option>
          <option>Kandy</option>
        </Select>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <KpiTile label="Vehicles departed" value="41 of 44" context="3 loading at Colombo" />
        <KpiTile label="Stops delivered" value="62 of 118" context="Plan says 70 by now · 8 behind" />
        <KpiTile label="Fresh at risk of missing 08:00" value="4" context="Of 31 Fresh stops due by 08:00" />
        <KpiTile label="Needs attention" value={ATTENTION.length} context="Ranked by urgency" />
      </div>

      <section className="flex flex-col gap-2 rounded-lg border border-wp-border bg-wp-surface p-4">
        <h2 className="text-[15px] leading-5 font-semibold">Needs attention</h2>
        {ATTENTION.map((alert) => (
          <div key={alert.id} className="flex flex-wrap items-center gap-4 border-t border-wp-border py-3">
            <div className="w-[150px] flex-none">
              <StatusPill state={alert.state}>{alert.type}</StatusPill>
            </div>
            <div className="min-w-[220px] flex-1">
              <div className="font-semibold">{alert.what}</div>
              <div className="text-[11px] text-wp-text-2">{alert.detail}</div>
            </div>
            <div className="w-[70px] flex-none text-[11px] text-wp-text-2">{alert.age}</div>
            <div className="flex flex-wrap items-center gap-2">
              {alert.actions.map((action) => (
                <Button
                  key={action}
                  variant="secondary"
                  onClick={NON_INSTRUCTION_ACTIONS.has(action) ? undefined : () => sendInstruction(alert.id)}
                >
                  {action}
                </Button>
              ))}
            </div>
            {instructionStatus[alert.id] && (
              <div className="basis-full text-[11px] font-semibold text-wp-info">
                Instruction: {instructionStatus[alert.id]}
              </div>
            )}
          </div>
        ))}
        <div className="text-[11px] text-wp-muted">
          Instructions (skip stop, reorder, hold, reassign) show Sent → On phone → Seen. An offline driver shows
          “waiting for signal”.
        </div>
      </section>

      <div
        className="grid items-start gap-4"
        style={{ gridTemplateColumns: `minmax(0,1fr) minmax(0,${selected ? "420px" : "0px"})` }}
      >
        <section className="flex flex-col gap-1 rounded-lg border border-wp-border bg-wp-surface p-4">
          <h2 className="mb-2 text-[15px] leading-5 font-semibold">All vehicles · sorted by risk</h2>
          <div
            className={cn(FLEET_COLUMNS, "px-2 text-[10px] font-semibold tracking-[.06em] text-wp-muted uppercase")}
          >
            <div>Vehicle</div>
            <div>Stops</div>
            <div>Next stop</div>
            <div>Planned</div>
            <div>Status</div>
          </div>
          {FLEET.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setSelectedVehicle(selectedVehicle === f.id ? null : f.id)}
              aria-pressed={selectedVehicle === f.id}
              className={cn(
                FLEET_COLUMNS,
                "min-h-10 cursor-pointer items-center border-t border-wp-border px-2 text-left",
                selectedVehicle === f.id ? "bg-wp-info-tint" : "bg-transparent",
              )}
            >
              <div className="font-semibold">{f.id}</div>
              <div className="text-xs tracking-[2px]">{f.dots}</div>
              <div>{f.next}</div>
              <div>{f.planned}</div>
              <div>
                <StatusPill state={f.state}>{f.status}</StatusPill>
              </div>
            </button>
          ))}
          <div className="mt-2 text-[11px] text-wp-muted">● done · ◉ now · ○ to do · ✕ problem</div>
        </section>

        {selected && (
          <section className="flex flex-col gap-2 rounded-lg border border-wp-border bg-wp-surface p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-[15px] leading-5 font-semibold">
                {selected.id} · stop by stop, plan against actual
              </h2>
              <button
                type="button"
                onClick={() => setSelectedVehicle(null)}
                className="cursor-pointer text-sm text-wp-muted"
              >
                ✕ Close
              </button>
            </div>
            <div
              className={cn(DETAIL_COLUMNS, "text-[10px] font-semibold tracking-[.06em] text-wp-muted uppercase")}
            >
              <div>Stop</div>
              <div>Plan</div>
              <div>Actual</div>
              <div>Proof</div>
            </div>
            {stopDetail(selected).map((d, i) => (
              <div key={i} className={cn(DETAIL_COLUMNS, "items-center border-t border-wp-border py-2")}>
                <div>
                  {d.glyph} {d.name}
                </div>
                <div>{d.plan}</div>
                <div className={d.failed ? "font-semibold text-wp-crit" : "text-wp-text"}>{d.actual}</div>
                <div className="text-[11px] text-wp-text-2">{d.proof}</div>
              </div>
            ))}
          </section>
        )}
      </div>

      <div className="text-[11px] text-wp-muted">
        If the dispatcher&apos;s connection drops, Live becomes “Not receiving updates since 05:52”. Quiet morning:
        “Nothing needs attention” with the next planned event.
      </div>
    </div>
  );
}
