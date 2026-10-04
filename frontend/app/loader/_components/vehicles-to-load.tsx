"use client";

import { useState } from "react";
import { Logo } from "@/components/waypoint/logo";
import { formatDay } from "@/lib/format";
import { cn } from "@/lib/utils";
import { isFullyLoaded, vehicleStatus, type LoadProgress, type LoadingVehicle } from "./data";
import { CARD, LiveStatus, TabletPill, TabletScreen, type Outbox } from "./tablet-ui";

const FILTERS = {
  all: { label: "All vehicles", match: () => true },
  loading: { label: "Loading", match: (p: LoadProgress) => p.confirmed > 0 && !isFullyLoaded(p) },
  ready: { label: "Ready to leave", match: isFullyLoaded },
};
type Filter = keyof typeof FILTERS;

/** L1 · Vehicles to load, in departure order. */
export function VehiclesToLoad({
  vehicles,
  progress,
  plan,
  depot,
  who,
  outbox,
  loading,
  error,
  onOpenVehicle,
}: {
  vehicles: LoadingVehicle[];
  progress: Record<string, LoadProgress>;
  plan: { version: string; serviceDate: string } | null;
  depot: string | null;
  who: string;
  outbox: Outbox;
  loading: boolean;
  error: string | null;
  onOpenVehicle: (id: string) => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const runs = vehicles.map((vehicle) => ({ vehicle, progress: progress[vehicle.id] }));
  const changed = vehicles.filter((v) => v.planChanged);
  const shown = runs.filter(({ progress }) => FILTERS[filter].match(progress));

  return (
    <TabletScreen label="L1 Vehicles to load">
      <header className="flex h-[72px] flex-none items-center justify-between border-b border-wp-border bg-wp-surface px-6">
        <div className="flex items-center gap-4">
          <Logo variant="light" className="h-9" />
          <span className="text-wp-text-2">
            {depot ?? ""} depot{plan ? ` · ${formatDay(plan.serviceDate)}` : ""}
          </span>
        </div>
        <LiveStatus who={who} outbox={outbox} plan={plan} />
      </header>

      <div className="flex flex-1 flex-col gap-4 p-6">
        {/* Always mounted, so a plan change arriving mid-shift is announced. */}
        <div role="status" aria-live="polite" className="flex flex-col gap-3 empty:hidden">
          {changed.map((vehicle) => (
            <PlanChangeBanner key={vehicle.id} vehicle={vehicle} plan={plan} onOpen={() => onOpenVehicle(vehicle.id)} />
          ))}
        </div>
        {error && <div className="rounded-[10px] border border-wp-crit bg-wp-crit-tint p-4 text-wp-crit">{error}</div>}
        {loading && <div className="text-wp-text-2">Loading the dock queue…</div>}
        {!loading && !error && vehicles.length === 0 && (
          <div className={cn(CARD, "p-6 text-wp-text-2")}>
            No released trips to load. They appear here as soon as the dispatcher releases the plan.
          </div>
        )}

        <div className="flex gap-2">
          {(Object.keys(FILTERS) as Filter[]).map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}
              className={cn(
                "inline-flex h-14 cursor-pointer items-center gap-2 rounded-full px-6 font-semibold",
                filter === key
                  ? "bg-wp-action text-wp-on-action"
                  : "border border-wp-border bg-wp-surface text-wp-text",
              )}
            >
              {FILTERS[key].label}{" "}
              <span>{runs.filter(({ progress }) => FILTERS[key].match(progress)).length}</span>
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-4">
          {shown.map(({ vehicle: v, progress }) => {
            const status = vehicleStatus(v, progress);
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => onOpenVehicle(v.id)}
                className={cn(
                  CARD,
                  "flex min-h-[150px] cursor-pointer flex-col gap-3 p-5 text-left",
                  v.planChanged && "border-2 border-wp-warn p-[19px]",
                )}
              >
                <div className="flex w-full items-start justify-between">
                  <div>
                    <div className="text-3xl leading-8 font-bold">{v.label}</div>
                    <div className="mt-1 text-wp-text-2">
                      {v.type} · {v.stops} stops
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[13px] text-wp-muted">Departs</div>
                    <div className="text-3xl leading-8 font-bold">{v.departs}</div>
                  </div>
                </div>
                <div className="h-2 w-full rounded bg-wp-surface-2">
                  {progress.confirmed > 0 && (
                    <div
                      className={cn("h-2 rounded", isFullyLoaded(progress) ? "bg-wp-good" : "bg-wp-text-2")}
                      style={{ width: `${Math.round((progress.confirmed / progress.lines) * 100)}%` }}
                    />
                  )}
                </div>
                <div className="flex w-full items-center justify-between">
                  <span>
                    {progress.confirmed} of {progress.lines} lines loaded
                    {progress.flags > 0 && <span className="text-wp-warn"> · ▲ {progress.flags} flagged</span>}
                  </span>
                  <TabletPill tone={status.tone}>{status.label}</TabletPill>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </TabletScreen>
  );
}

/**
 * What the dispatcher re-issued, in the loader's terms: changed stops say the load list has to be read
 * again before anything goes on board. Opening the vehicle acknowledges the change.
 */
function PlanChangeBanner({
  vehicle,
  plan,
  onOpen,
}: {
  vehicle: LoadingVehicle;
  plan: { version: string } | null;
  onOpen: () => void;
}) {
  return (
    <div className="flex min-h-16 items-center gap-4 rounded-[10px] border border-wp-warn bg-wp-warn-tint px-4 text-wp-text">
      <span className="text-xl text-wp-warn">▲</span>
      <div className="flex-1">
        <b>
          {vehicle.label} · plan {plan?.version ?? ""} changed.
        </b>{" "}
        {vehicle.changedStops ? `${vehicle.changedStops} of ${vehicle.stops} stops changed. ` : ""}Departs {vehicle.departs}.
        Open the new load list before loading.
      </div>
      <button
        type="button"
        onClick={onOpen}
        className="inline-flex h-11 cursor-pointer items-center rounded-lg border border-wp-warn px-4 text-[15px] font-semibold text-wp-warn"
      >
        Open {vehicle.label}
      </button>
    </div>
  );
}
