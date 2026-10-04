"use client";

import { useState } from "react";
import { Button, Chip, Select } from "@/components/waypoint/controls";
import { BrandMonogram, KpiTile } from "@/components/waypoint/data";
import { CapacityGauge, StatusPill } from "@/components/waypoint/status";
import { cn } from "@/lib/utils";
import { ORDERS, blockReason, formatMinutes, withAssignments, type Order } from "./data";

const CHIPS = ["All", "Chilled", "Van-only", "Style", "Tech"] as const;
type ChipFilter = (typeof CHIPS)[number];

function passesFilter(order: Order, chip: ChipFilter) {
  switch (chip) {
    case "All":
      return true;
    case "Chilled":
      return order.chilled;
    case "Van-only":
      return order.vanOnly;
    case "Style":
      return order.brand === "style";
    case "Tech":
      return order.brand === "tech";
  }
}

const LANE_COLUMNS = "grid grid-cols-[120px_minmax(0,1fr)_220px_90px] gap-4";

/** D1 · Plan board: assign unplanned orders to vehicle lanes, then release the plan. */
export function PlanBoard({
  assigned,
  onAssign,
  deferredIds,
  onGoToDeferrals,
}: {
  assigned: Record<string, string>;
  onAssign: (orderId: string, vehicleId: string) => void;
  deferredIds: string[];
  onGoToDeferrals: () => void;
}) {
  const [chip, setChip] = useState<ChipFilter>("All");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const lanes = withAssignments(assigned);
  const selected = ORDERS.find((o) => o.id === selectedId);
  const remaining = ORDERS.filter((o) => !assigned[o.id] && !deferredIds.includes(o.id));
  const queue = remaining.filter((o) => passesFilter(o, chip));
  const assignedCount = Object.keys(assigned).length;
  const releaseBlocked = remaining.length > 0;

  return (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-4 p-6">
      <div className="flex flex-wrap items-center gap-4">
        <div>
          <h1 className="text-[22px] leading-6 font-bold">Plan board · Wed 30 Sep, Fresh run</h1>
          <div className="mt-1 text-[11px] text-wp-text-2">
            Plan v3 · Saved 15:52 · Updates whenever an order or the plan changes
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[11px] text-wp-text-2">Depot</span>
          <Select aria-label="Depot">
            <option>All depots</option>
            <option>Colombo</option>
            <option>Kandy</option>
          </Select>
          <Button variant="secondary" onClick={() => setCopied(true)}>
            Start from yesterday&apos;s routes
          </Button>
          <Button variant="secondary">Enter order for outlet</Button>
          <Button disabled={releaseBlocked}>
            {releaseBlocked ? `Release plan · ${remaining.length} to resolve` : "Release plan"}
          </Button>
        </div>
      </div>

      {copied && (
        <div className="rounded-lg bg-wp-info-tint px-3 py-2 text-xs font-semibold text-wp-info">
          ▲ Yesterday&apos;s Fresh routes copied as a draft. Review stops before release.
        </div>
      )}

      <div className="grid grid-cols-4 gap-4">
        <KpiTile label="Orders planned" value={`${118 + assignedCount} of 123`} context="All 123 orders confirmed" />
        <KpiTile label="Cannot fit" value={deferredIds.length ? "0" : "3"} context="Open D2 to defer" />
        <KpiTile label="Rule conflicts" value="0" context="No vehicle over a limit" />
        <KpiTile label="Refrigerated vehicles free" value="1 of 3" context="Trucks 1 · vans 0" />
      </div>

      <div className="grid grid-cols-[minmax(300px,360px)_minmax(0,1fr)] items-start gap-4">
        <section className="flex flex-col gap-3 rounded-lg border border-wp-border bg-wp-surface p-4">
          <div className="flex items-baseline justify-between">
            <h2 className="text-[15px] leading-5 font-semibold">Unplanned orders · {remaining.length}</h2>
            <div className="text-[11px] text-wp-muted">Next run (after 16:00): 4, greyed</div>
          </div>
          <div className="flex flex-wrap gap-2">
            {CHIPS.map((c) => (
              <Chip key={c} active={chip === c} onClick={() => setChip(c)}>
                {c}
              </Chip>
            ))}
          </div>

          {queue.map((order) => {
            const open = selectedId === order.id;
            return (
              <div
                key={order.id}
                onClick={() => setSelectedId(open ? null : order.id)}
                className={cn(
                  "cursor-pointer rounded-lg border bg-wp-surface p-3",
                  open ? "border-wp-action shadow-[0_0_0_1px_var(--wp-action)]" : "border-wp-border",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <BrandMonogram brand={order.brand} outlet={order.outlet} />
                  {order.cannotFit && <StatusPill state="crit">Cannot fit</StatusPill>}
                </div>
                <div className="mt-2 text-[11px] text-wp-text-2">
                  {order.kg} kg · {order.m3} m³ · Window {order.window}
                </div>
                <div className="text-[11px] text-wp-text-2">{order.flags}</div>
                {open && (
                  <div className="mt-2 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    {order.cannotFit ? (
                      <Button variant="secondary" onClick={onGoToDeferrals}>
                        Defer in D2
                      </Button>
                    ) : (
                      <>
                        <span className="text-[11px] text-wp-text-2">Assign to</span>
                        <Select
                          defaultValue=""
                          aria-label={`Assign ${order.outlet} to vehicle`}
                          onChange={(e) => {
                            if (!e.target.value) return;
                            onAssign(order.id, e.target.value);
                            setSelectedId(null);
                          }}
                        >
                          <option value="">Choose vehicle</option>
                          {lanes.map((v) => {
                            const reason = blockReason(order, v);
                            return (
                              <option key={v.id} value={v.id} disabled={!!reason}>
                                {v.id}
                                {reason ? ` · ${reason}` : ""}
                              </option>
                            );
                          })}
                        </Select>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {remaining.length === 0 && (
            <div className="py-2 font-semibold text-wp-good">✓ Every order is assigned or deferred.</div>
          )}
        </section>

        <section className="flex flex-col gap-3 rounded-lg border border-wp-border bg-wp-surface p-4">
          <div className="flex items-baseline justify-between">
            <h2 className="text-[15px] leading-5 font-semibold">Vehicle lanes</h2>
            <div className="text-[11px] text-wp-muted">
              {selected
                ? `Showing fit for ${selected.outlet}`
                : "Select an order to see which vehicles can take it"}
            </div>
          </div>
          <div
            className={cn(
              LANE_COLUMNS,
              "px-3 text-[10px] font-semibold tracking-[.06em] text-wp-muted uppercase",
            )}
          >
            <div>Vehicle</div>
            <div>Route 1 · 06:00 to 12:00</div>
            <div>Load against limit</div>
            <div>Fuel left</div>
          </div>

          {lanes.map((v) => {
            const reason = selected ? blockReason(selected, v) : null;
            return (
              <div
                key={v.id}
                className={cn("rounded-lg border border-wp-border bg-wp-surface p-3", reason && "opacity-55")}
              >
                <div className={cn(LANE_COLUMNS, "items-center")}>
                  <div>
                    <div className="text-[15px] font-semibold">{v.id}</div>
                    <div className="text-[11px] text-wp-text-2">{v.type}</div>
                  </div>
                  <div className="relative h-10">
                    <div className="absolute inset-x-0 top-5 h-0.5 bg-wp-border" />
                    <div className="absolute top-1 bottom-0 left-1/3 border-l-2 border-dashed border-wp-action" />
                    <div className="absolute -top-0.5 left-[34.5%] text-[10px] font-semibold text-wp-action">08:00</div>
                    {v.stops.map((m, i) => (
                      <div
                        key={i}
                        title={`Stop ${i + 1} · ${formatMinutes(m)}`}
                        className="absolute top-[15px] -ml-[5px] size-2.5 rounded-full bg-wp-text-2"
                        style={{ left: `${((m - 360) / 360) * 100}%` }}
                      />
                    ))}
                  </div>
                  <div className="flex flex-col gap-1">
                    <CapacityGauge label="Weight" value={Math.round(v.w)} />
                    <CapacityGauge label="Volume" value={Math.round(v.v)} />
                    <div className="flex gap-4 text-[11px] text-wp-muted">
                      <span>
                        {Math.round((v.w / 100) * v.capKg)} of {v.capKg.toLocaleString()} kg
                      </span>
                      <span>
                        {((v.v / 100) * v.capM3).toFixed(1)} of {v.capM3} m³
                      </span>
                    </div>
                  </div>
                  <div className="font-semibold">{v.fuel} L</div>
                </div>
                {reason && <div className="mt-2 text-xs font-semibold text-wp-crit">⊘ {reason}</div>}
                <div className="mt-2 text-[11px] text-wp-muted">▸ Route 2 · {v.route2}</div>
              </div>
            );
          })}
          <div className="text-[11px] text-wp-muted">
            Rules are enforced when an order is dropped on a vehicle. Blocked vehicles refuse with the reason shown.
          </div>
        </section>
      </div>

      <div className="rounded-lg border border-wp-border bg-wp-surface px-4 py-3 text-[11px] text-wp-text-2">
        <b>After release:</b> if the plan is edited, the header reads “Plan v4 · 2 changes to re-issue” and lists the
        loaders and drivers to notify. Conflicts show an icon and text, never colour alone.
      </div>
    </div>
  );
}
