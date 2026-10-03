"use client";

import { useState } from "react";
import { Button, Select } from "@/components/waypoint/controls";
import { Logo } from "@/components/waypoint/logo";
import { Banner } from "@/components/waypoint/status";
import { errorMessage, useApi, useApiData } from "@/lib/api/use-api";
import { formatDay, todayIso } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Me, PlanView, Runs, Violation } from "./data";
import { Deferrals } from "./deferrals";
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

/** What a dispatcher action returns to the screen: a message to show, and rule problems if any. */
export type ActionResult = { ok: boolean; message: string; violations?: Violation[] };

export type PlanActions = {
  closeOrders: () => Promise<ActionResult>;
  propose: () => Promise<ActionResult>;
  move: (orderId: number, vehicleId: number, seq: 1 | 2) => Promise<ActionResult>;
  defer: (orderId: number, reasonCode: string, note: string | null) => Promise<ActionResult>;
  release: () => Promise<ActionResult>;
  setVehicleActive: (vehicleId: number, active: boolean) => Promise<ActionResult>;
};

export function DispatcherApp() {
  const request = useApi();
  const me = useApiData<Me>("/me");
  const runs = useApiData<Runs>("/dispatch/runs", 30_000);
  const [tab, setTab] = useState<Tab>("plan");
  const [chosenDate, setChosenDate] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<ActionResult | null>(null);

  // Default run: the latest planned run from today on, otherwise the next date still taking orders.
  const today = todayIso();
  const runList = runs.data?.runs ?? [];
  const defaultDate =
    runList.filter((r) => r.plan_id !== null && r.service_date >= today).map((r) => r.service_date).sort()[0] ??
    runs.data?.next_open_date ??
    null;
  const date = chosenDate ?? defaultDate;
  const run = runList.find((r) => r.service_date === date) ?? null;
  const plan = useApiData<PlanView>(run?.plan_id ? `/dispatch/plans/${run.plan_id}` : null);

  const dates = Array.from(new Set([...(runs.data ? [runs.data.next_open_date] : []), ...runList.map((r) => r.service_date)])).sort();

  /** Run an API call, refresh what it changes, and turn the outcome into a message. */
  async function act(call: () => Promise<unknown>, success: (result: never) => string): Promise<ActionResult> {
    setBusy(true);
    try {
      const result = await call();
      await Promise.all([runs.reload(), plan.reload()]);
      const violations = (result as { violations?: Violation[] } | undefined)?.violations;
      const outcome = { ok: true, message: success(result as never), violations };
      setNotice(outcome);
      return outcome;
    } catch (e) {
      const outcome = { ok: false, message: errorMessage(e) };
      setNotice(outcome);
      return outcome;
    } finally {
      setBusy(false);
    }
  }

  const planId = run?.plan_id;
  const actions: PlanActions = {
    closeOrders: () =>
      act(
        () => request(`/dispatch/runs/${date}/close`, { method: "POST" }),
        (r: { orders_confirmed: number }) => `Orders closed. ${r.orders_confirmed} orders confirmed for planning.`,
      ),
    propose: () =>
      act(
        () => request(`/dispatch/plans/${planId}/propose`, { method: "POST" }),
        (r: { trips: number; orders_planned: number; orders_deferred: unknown[] }) =>
          `The engine proposed ${r.trips} trips carrying ${r.orders_planned} orders. ${r.orders_deferred.length} cannot fit: review them in D2.`,
      ),
    move: (orderId, vehicleId, seq) =>
      act(
        () => request(`/dispatch/plans/${planId}/move`, { method: "POST", body: { order_id: orderId, vehicle_id: vehicleId, seq } }),
        () => "Order moved. Arrival times recalculated.",
      ),
    defer: (orderId, reasonCode, note) =>
      act(
        () => request(`/dispatch/plans/${planId}/defer`, { method: "POST", body: { order_id: orderId, reason_code: reasonCode, note } }),
        () => "Deferral recorded. It is applied, and the store told, when you release the plan.",
      ),
    release: () =>
      act(
        () => request(`/dispatch/plans/${planId}/release`, { method: "POST" }),
        (r: { version: number; deferred: number }) =>
          `Plan v${r.version} released to loaders and drivers. ${r.deferred} deferred ${r.deferred === 1 ? "order" : "orders"} applied and stores told.`,
      ),
    setVehicleActive: (vehicleId, active) =>
      act(
        () => request(`/dispatch/vehicles/${vehicleId}`, { method: "PATCH", body: { active } }),
        () => (active ? "Vehicle back in service." : "Vehicle marked as in the workshop."),
      ),
  };

  async function resetDemo() {
    if (!window.confirm("Reset the demo? This deletes every order, plan and delivery and seeds a fresh demo day.")) return;
    await act(() => request("/demo/reset", { method: "POST" }), (r: { orders: number; service_date: string }) =>
      `Demo reset: ${r.orders} orders seeded for ${formatDay(r.service_date)}.`);
    setChosenDate(null);
  }

  return (
    <div className="min-h-screen bg-wp-canvas text-[13px] leading-[18px] text-wp-text tabular-nums">
      <header className="flex min-h-12 flex-wrap items-center gap-x-6 border-b border-wp-border bg-wp-surface px-6">
        <Logo />
        <nav className="flex h-12 gap-1">
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
              {key === "deferrals" && plan.data && plan.data.unplanned.length > 0 && ` · ${plan.data.unplanned.length}`}
            </button>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3 py-2">
          {(tab === "plan" || tab === "deferrals") && dates.length > 0 && (
            <Select aria-label="Service date" value={date ?? ""} onChange={(e) => setChosenDate(e.target.value)}>
              {dates.map((d) => (
                <option key={d} value={d}>
                  Run for {formatDay(d)}
                </option>
              ))}
            </Select>
          )}
          <Button variant="secondary" onClick={resetDemo} disabled={busy}>
            Reset demo
          </Button>
          <span className="text-[11px] text-wp-muted">
            {me.data ? `${me.data.name} · ${me.data.depot ?? "all"} depot` : ""}
          </span>
        </div>
      </header>

      {(me.error || runs.error) && (
        <div className="mx-auto max-w-[1440px] px-6 pt-4">
          <Banner state="crit" action="Try again" onAction={() => { void me.reload(); void runs.reload(); }}>
            {me.error ?? runs.error}
          </Banner>
        </div>
      )}
      {notice && (
        <div className="mx-auto max-w-[1440px] px-6 pt-4">
          <Banner state={notice.ok ? "good" : "crit"} action="Dismiss" onAction={() => setNotice(null)}>
            {notice.message}
          </Banner>
        </div>
      )}

      {tab === "plan" && (
        <PlanBoard date={date} run={run} plan={plan.data ?? null} loading={plan.loading || runs.loading} busy={busy}
                   actions={actions} onGoToDeferrals={() => setTab("deferrals")} />
      )}
      {tab === "deferrals" && (
        <Deferrals date={date} plan={plan.data ?? null} busy={busy} actions={actions} onGoToPlanBoard={() => setTab("plan")} />
      )}
      {tab === "live" && <LiveMonitor />}
      {tab === "ledger" && <Ledger />}
    </div>
  );
}
