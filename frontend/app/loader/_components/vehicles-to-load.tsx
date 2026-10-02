"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { VEHICLES, type LoadingVehicle } from "./data";
import { CARD, LiveStatus, TabletPill, TabletScreen } from "./tablet-ui";

const FILTERS = {
  all: { label: "All vehicles", match: () => true },
  loading: { label: "Loading", match: (v: LoadingVehicle) => v.loaded > 0 && v.loaded < v.lines },
  ready: { label: "Ready to leave", match: (v: LoadingVehicle) => v.loaded === v.lines },
};
type Filter = keyof typeof FILTERS;

function progressFill(v: LoadingVehicle) {
  return v.loaded === v.lines ? "bg-wp-good" : "bg-wp-text-2";
}

/** L1 · Vehicles to load, in departure order. */
export function VehiclesToLoad({ onOpenVehicle }: { onOpenVehicle: (id: string) => void }) {
  const [filter, setFilter] = useState<Filter>("all");
  const vehicles = VEHICLES.filter(FILTERS[filter].match);

  return (
    <TabletScreen label="L1 Vehicles to load">
      <header className="flex h-[72px] flex-none items-center justify-between border-b border-wp-border bg-wp-surface px-6">
        <div className="flex items-baseline gap-4">
          <span className="text-xl font-bold">Waypoint</span>
          <span className="text-wp-text-2">Dock 2 · Wed 30 Sep</span>
        </div>
        <LiveStatus />
      </header>

      <div className="flex flex-1 flex-col gap-4 p-6">
        <div className="flex min-h-16 items-center gap-4 rounded-[10px] border border-wp-warn bg-wp-warn-tint px-4 text-wp-text">
          <span className="text-xl text-wp-warn">▲</span>
          <div className="flex-1">
            <b>RT-05 plan changed.</b> 2 of 7 stops changed. Open the new load list before loading.
          </div>
          <span className="inline-flex h-11 items-center px-4 text-[15px] font-semibold text-wp-warn">
            Opens in RT-05
          </span>
        </div>

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
              {FILTERS[key].label} <span>{VEHICLES.filter(FILTERS[key].match).length}</span>
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-4">
          {vehicles.map((v) => (
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
                  <div className="text-3xl leading-8 font-bold">{v.id}</div>
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
                {v.loaded > 0 && (
                  <div
                    className={cn("h-2 rounded", progressFill(v))}
                    style={{ width: `${Math.round((v.loaded / v.lines) * 100)}%` }}
                  />
                )}
              </div>
              <div className="flex w-full items-center justify-between">
                <span>
                  {v.loaded} of {v.lines} lines loaded
                </span>
                <TabletPill tone={v.status.tone}>{v.status.label}</TabletPill>
              </div>
            </button>
          ))}
        </div>
      </div>
    </TabletScreen>
  );
}
