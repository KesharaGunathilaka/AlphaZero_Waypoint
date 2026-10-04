"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { flagLabel, flagSummary, flaggedLines, isFullyLoaded, progressOf, type LoadStop, type LoadingVehicle } from "./data";
import { CARD, LiveStatus, Meter, PRIMARY_TOUCH_BUTTON, TOUCH_BUTTON, TabletPill, TabletScreen, type Outbox } from "./tablet-ui";

function kg(value: number) {
  return Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * L3 · Departure check: review shortfalls and final load, then release the vehicle to the driver.
 * The release is signed by the loader's own sign-in (the Day 5 design used a PIN on a shared tablet).
 */
export function DepartureCheck({
  vehicle,
  stops,
  who,
  outbox,
  released,
  onRelease,
  onReopen,
  onBack,
}: {
  vehicle: LoadingVehicle;
  stops: LoadStop[];
  who: string;
  outbox: Outbox;
  released: boolean;
  onRelease: () => void;
  onReopen: () => void;
  onBack: () => void;
}) {
  const progress = progressOf(stops);
  const shortfalls = flaggedLines(stops);
  const weightPercent = Math.round((progress.weightKg / vehicle.capacityKg) * 100);
  const volumePercent = Math.round((progress.volumeM3 / vehicle.capacityM3) * 100);
  const ready = isFullyLoaded(progress);
  const [checkedAt] = useState(() =>
    new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }),
  );

  return (
    <TabletScreen label="L3 Departure check">
      <header className="flex h-[72px] flex-none items-center justify-between border-b border-wp-border bg-wp-surface px-6">
        <div className="flex items-center gap-5">
          <button type="button" onClick={onBack} className={cn(TOUCH_BUTTON, "h-11")}>
            ‹ Vehicles
          </button>
          <div className="text-xl font-bold">Departure check · {vehicle.label}</div>
        </div>
        <LiveStatus who={who} outbox={outbox} />
      </header>

      <div className="grid flex-1 grid-cols-[minmax(0,1fr)_400px] gap-6 p-6">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-3">
            <TabletPill tone="good" className="h-12 px-5 text-[17px]">
              ✓ {progress.stopsConfirmed} of {progress.stops} stops loaded
            </TabletPill>
            <TabletPill tone="good" className="h-12 px-5 text-[17px]">
              ✓ {progress.confirmed} of {progress.lines} lines confirmed
            </TabletPill>
          </div>

          {shortfalls.length > 0 ? (
            <div className="flex flex-col gap-3 rounded-[10px] border-2 border-wp-warn bg-wp-warn-tint p-5">
              <div className="text-[13px] font-semibold tracking-[.06em] text-wp-warn">
                ▲ SHORTFALL · {shortfalls.length} {shortfalls.length === 1 ? "LINE" : "LINES"}
              </div>
              {shortfalls.map(({ stop, line }) => (
                <div key={`${stop.stop}-${line.id}`} className="border-t border-wp-warn pt-3 first:border-t-0 first:pt-0">
                  <div className="text-3xl leading-8 font-bold">{flagLabel(line)}</div>
                  <div>
                    {line.product} · Stop {stop.stop} · {stop.outlet} · {flagSummary(line)}
                  </div>
                  <div className="text-wp-text-2">
                    Flagged {line.flag?.at}
                    {line.flag?.photo && " with a photo"} · shown to the driver at Stop {stop.stop}, and to{" "}
                    {stop.outlet} on its order.
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex min-h-16 items-center gap-3 rounded-[10px] border border-wp-good bg-wp-good-tint px-5">
              <span className="text-wp-good">✓</span>
              <span>No shortfalls flagged. Every ordered line is on board.</span>
            </div>
          )}

          <div className={cn(CARD, "flex flex-col gap-4 p-5")}>
            <div className="text-[13px] font-semibold tracking-[.06em] text-wp-muted">FINAL LOAD</div>
            <div className="grid grid-cols-2 gap-6">
              <Meter
                label="Weight"
                value={`${kg(progress.weightKg)} of ${kg(vehicle.capacityKg)} kg · ${weightPercent}%`}
                percent={Math.min(weightPercent, 100)}
                fillClassName="bg-wp-gauge-amber"
              />
              <Meter
                label="Volume"
                value={`${progress.volumeM3.toFixed(1)} of ${vehicle.capacityM3.toFixed(1)} m³ · ${volumePercent}%`}
                percent={Math.min(volumePercent, 100)}
                fillClassName="bg-wp-gauge-amber"
              />
            </div>
            <div className="grid grid-cols-3 gap-4 border-t border-wp-border pt-4">
              {[
                ["Loaded by", who],
                ["Checked", checkedAt],
                ["Departure", vehicle.departs],
              ].map(([label, value]) => (
                <div key={label}>
                  <div className="text-[13px] text-wp-muted">{label}</div>
                  <div className="font-semibold">{value}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className={cn(CARD, "flex flex-col gap-4 self-start p-6")}>
          <div>
            <div className="text-xl leading-[26px] font-semibold">
              {released ? `${vehicle.label} is released` : "Release to the driver"}
            </div>
            <div className="text-sm text-wp-text-2">
              Signed as {who || "you"}: the release is recorded against your sign-in, with the time.
            </div>
          </div>
          {!ready && !released && (
            <div className="rounded-lg border border-wp-warn bg-wp-warn-tint p-3 text-[15px] text-wp-warn">
              ▲ Every line must be loaded or flagged, and every stop signed off, before release.
            </div>
          )}
          <button
            type="button"
            disabled={!ready || released}
            onClick={onRelease}
            className={cn(PRIMARY_TOUCH_BUTTON, "h-16 text-[17px] disabled:cursor-not-allowed disabled:opacity-60")}
          >
            {released ? `✓ ${vehicle.label} released to driver` : `Release ${vehicle.label} to driver`}
          </button>
          {released && outbox.pending > 0 && (
            <div className="text-center text-[13px] text-wp-text-2">
              {outbox.online ? "Sending the release…" : "Saved on the tablet. It is sent when the dock is back online."}
            </div>
          )}
          {released ? (
            <>
              <button type="button" onClick={onBack} className={TOUCH_BUTTON}>
                Back to vehicles
              </button>
              <button type="button" onClick={onReopen} className={cn(TOUCH_BUTTON, "text-wp-text-2")}>
                Reopen loading (before the driver leaves)
              </button>
            </>
          ) : (
            <button type="button" onClick={onReopen} className={TOUCH_BUTTON}>
              Back to the load list
            </button>
          )}
          <div className="text-center text-[13px] text-wp-muted">
            Sets {vehicle.label} to Loaded on the driver’s phone and the dispatcher’s monitor. Shortfalls are shown
            to the driver at each stop and to the store on its order.
          </div>
        </div>
      </div>
    </TabletScreen>
  );
}
