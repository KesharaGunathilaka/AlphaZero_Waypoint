"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { DEFERRABLE_ORDER_IDS } from "./data";
import { Deferrals, INITIAL_DEFERRAL_STATE, type DeferralState } from "./deferrals";
import { Ledger } from "./ledger";
import { LiveMonitor } from "./live-monitor";
import { PlanBoard } from "./plan-board";

const TABS = [
  ["plan", "D1 · Plan board"],
  ["deferrals", "D2 · Overflow & deferrals"],
  ["live", "D3 · Live run monitor"],
  ["ledger", "D4 · Record ledger"],
] as const;
type Tab = (typeof TABS)[number][0];

export function DispatcherApp() {
  const [tab, setTab] = useState<Tab>("plan");
  // Shared between D1 and D2: confirming deferrals in D2 removes those orders from D1's queue.
  const [assigned, setAssigned] = useState<Record<string, string>>({});
  const [deferrals, setDeferrals] = useState<DeferralState>(INITIAL_DEFERRAL_STATE);

  return (
    <div className="min-h-screen bg-wp-canvas text-[13px] leading-[18px] text-wp-text tabular-nums">
      <header className="flex h-12 items-center gap-6 border-b border-wp-border bg-wp-surface px-6">
        <div className="text-[15px] font-bold">Waypoint</div>
        <nav className="flex h-full gap-1">
          {TABS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              aria-current={tab === key ? "page" : undefined}
              className={cn(
                "cursor-pointer border-b-2 px-3 text-[13px] font-semibold",
                tab === key ? "border-wp-action text-wp-action" : "border-transparent text-wp-text-2",
              )}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="ml-auto text-[11px] text-wp-muted">Kasun · Colombo depot</div>
      </header>

      {tab === "plan" && (
        <PlanBoard
          assigned={assigned}
          onAssign={(orderId, vehicleId) => setAssigned((a) => ({ ...a, [orderId]: vehicleId }))}
          deferredIds={deferrals.confirmed ? DEFERRABLE_ORDER_IDS : []}
          onGoToDeferrals={() => setTab("deferrals")}
        />
      )}
      {tab === "deferrals" && (
        <Deferrals
          state={deferrals}
          onChange={setDeferrals}
          onConfirm={() => setDeferrals((d) => ({ ...d, confirmed: true }))}
          onGoToPlanBoard={() => setTab("plan")}
        />
      )}
      {tab === "live" && <LiveMonitor />}
      {tab === "ledger" && <Ledger />}
    </div>
  );
}
