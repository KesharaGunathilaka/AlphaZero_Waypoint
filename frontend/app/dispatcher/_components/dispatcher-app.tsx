"use client";

import { useState } from "react";
import { AccountButton } from "@/components/waypoint/account-button";
import { Button, Select } from "@/components/waypoint/controls";
import { Logo } from "@/components/waypoint/logo";
import { Banner } from "@/components/waypoint/status";
import { errorMessage, useApi, useApiData } from "@/lib/api/use-api";
import { formatDay, todayIso } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Depots, Me, PlanView, Runs, Violation } from "./data";
import { Deferrals } from "./deferrals";
import { Ledger } from "./ledger";
import { LiveMonitor } from "./live-monitor";
import { PlanBoard } from "./plan-board";

/** Plain names, in the order of the dispatcher's day: plan it, settle what can't go, watch it run, look back. */
const TABS = [
  ["plan", "Plan"],
  ["deferrals", "Deferred"],
  ["live", "Live"],
  ["ledger", "Records"],
] as const;
export type Tab = (typeof TABS)[number][0];

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
  const depots = useApiData<Depots>("/dispatch/depots");
  /** Bumped on a depot switch so Live and Records remount and load the new depot. */
  const [depotKey, setDepotKey] = useState(0);
  const [tab, setTab] = useState<Tab>("plan");
  const [chosenDate, setChosenDate] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<ActionResult | null>(null);
  /** An order to open in the "move to a trip" dialog when the Plan tab shows (from the Deferred tab). */
  const [moveRequest, setMoveRequest] = useState<number | null>(null);

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
  const deferredCount = plan.data?.routes.length ? plan.data.unplanned.length : 0;

  /** Run an API call, refresh what it changes, and turn the outcome into a message. */
  async function act(call: () => Promise<unknown>, success: (result: never) => string, quiet = false): Promise<ActionResult> {
    setBusy(true);
    try {
      const result = await call();
      await Promise.all([runs.reload(), plan.reload()]);
      const violations = (result as { violations?: Violation[] } | undefined)?.violations;
      const outcome = { ok: true, message: success(result as never), violations };
      if (!quiet) setNotice(outcome);
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
        (r: { orders_confirmed: number }) => `Orders closed: ${r.orders_confirmed} orders confirmed. Next: build the plan.`,
      ),
    propose: () =>
      act(
        () => request(`/dispatch/plans/${planId}/propose`, { method: "POST" }),
        (r: { trips: number; orders_planned: number; orders_deferred: unknown[] }) =>
          `Plan built: ${r.trips} trips carry ${r.orders_planned} orders.` +
          (r.orders_deferred.length
            ? ` ${r.orders_deferred.length} cannot go on this run; each already has a reason (see Deferred).`
            : " Every order fits."),
      ),
    move: (orderId, vehicleId, seq) =>
      act(
        () => request(`/dispatch/plans/${planId}/move`, { method: "POST", body: { order_id: orderId, vehicle_id: vehicleId, seq } }),
        () => "Order moved. Arrival times recalculated and every rule checked.",
      ),
    defer: (orderId, reasonCode, note) =>
      act(
        () => request(`/dispatch/plans/${planId}/defer`, { method: "POST", body: { order_id: orderId, reason_code: reasonCode, note } }),
        () => "Reason saved. The store is told when you release the plan.",
        true,
      ),
    release: () =>
      act(
        () => request(`/dispatch/plans/${planId}/release`, { method: "POST" }),
        (r: { version: number; deferred: number }) =>
          `Plan v${r.version} sent to loaders and drivers.` +
          (r.deferred ? ` ${r.deferred} ${r.deferred === 1 ? "store was" : "stores were"} told about a deferred order.` : ""),
      ),
    setVehicleActive: (vehicleId, active) =>
      act(
        () => request(`/dispatch/vehicles/${vehicleId}`, { method: "PATCH", body: { active } }),
        () => (active ? "Vehicle back in service." : "Vehicle marked as in the workshop."),
      ),
  };

  /** Planning office: work on another depot. Every tab then shows that depot's runs, trips and records. */
  async function switchDepot(depotId: number) {
    const outcome = await act(
      () => request("/dispatch/depot", { method: "POST", body: { depot_id: depotId } }),
      (r: { name: string }) => `Now planning ${r.name} depot.`,
    );
    if (outcome.ok) {
      setChosenDate(null);
      await Promise.all([me.reload(), depots.reload()]);
      setDepotKey((k) => k + 1);
    }
  }

  async function resetDemo() {
    if (!window.confirm("Reset the demo? This deletes every order, plan and delivery and seeds a fresh demo day.")) return;
    await act(() => request("/demo/reset", { method: "POST" }),
      (r: { orders: number; service_date: string; peliyagoda?: { orders: number } }) =>
        `Demo reset: ${r.orders} Kandy${r.peliyagoda ? ` and ${r.peliyagoda.orders} Peliyagoda` : ""} orders seeded for ${formatDay(r.service_date)}.`);
    setChosenDate(null);
    setTab("plan");
  }

  return (
    <div className="min-h-screen bg-wp-canvas text-[13px] leading-[18px] text-wp-text tabular-nums">
      <header className="sticky top-0 z-30 border-b border-wp-border bg-wp-surface">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 sm:px-6">
          <Logo />
          {depots.data && depots.data.depots.length > 1 ? (
            <Select aria-label="Depot" value={depots.data.current ?? ""} disabled={busy}
                    onChange={(e) => void switchDepot(Number(e.target.value))} className="h-9 text-[13px] font-semibold">
              {depots.data.depots.map((d) => (
                <option key={d.depot_id} value={d.depot_id}>{d.name} depot</option>
              ))}
            </Select>
          ) : (
            <div className="text-[13px] font-semibold">{me.data?.depot ?? "…"} depot</div>
          )}
          <div className="hidden text-[11px] leading-4 text-wp-text-2 lg:block">{me.data?.name}</div>
          <div className="ml-auto flex items-center gap-2">
            {(tab === "plan" || tab === "deferrals") && dates.length > 0 && (
              <Select aria-label="Delivery day" value={date ?? ""} onChange={(e) => setChosenDate(e.target.value)} className="h-9 text-[13px]">
                {dates.map((d) => (
                  <option key={d} value={d}>
                    Deliveries on {formatDay(d)}
                  </option>
                ))}
              </Select>
            )}
            <Button variant="secondary" className="hidden h-9 md:inline-flex" onClick={resetDemo} disabled={busy} title="Demo only: wipe and seed a fresh day">
              Reset demo
            </Button>
            <AccountButton />
          </div>
        </div>
        <nav aria-label="Dispatcher sections" className="mx-auto flex max-w-[1440px] gap-1 overflow-x-auto px-2 sm:px-4">
          {TABS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              aria-current={tab === key ? "page" : undefined}
              className={cn(
                "flex h-11 shrink-0 cursor-pointer items-center gap-2 border-b-[3px] px-3 text-[14px] font-semibold",
                tab === key ? "border-wp-action text-wp-action" : "border-transparent text-wp-text-2 hover:text-wp-text",
              )}
            >
              {label}
              {key === "deferrals" && deferredCount > 0 && (
                <span className="rounded-full bg-wp-warn-tint px-2 text-[11px] text-wp-warn">{deferredCount}</span>
              )}
            </button>
          ))}
          <button type="button" onClick={resetDemo} disabled={busy}
                  className="ml-auto h-11 shrink-0 cursor-pointer px-3 text-[12px] font-semibold text-wp-text-2 underline md:hidden">
            Reset demo
          </button>
        </nav>
      </header>

      {(me.error || runs.error) && (
        <div className="mx-auto max-w-[1440px] px-4 pt-4 sm:px-6">
          <Banner state="crit" action="Try again" onAction={() => { void me.reload(); void runs.reload(); }}>
            {me.error ?? runs.error}
          </Banner>
        </div>
      )}
      {notice && (
        <div className="mx-auto max-w-[1440px] px-4 pt-4 sm:px-6">
          <Banner state={notice.ok ? "good" : "crit"} action="Dismiss" onAction={() => setNotice(null)}>
            {notice.message}
          </Banner>
        </div>
      )}

      {tab === "plan" && (
        <PlanBoard date={date} run={run} plan={plan.data ?? null} loading={plan.loading || runs.loading} busy={busy}
                   actions={actions} onTab={setTab} moveRequest={moveRequest} onMoveRequestHandled={() => setMoveRequest(null)} />
      )}
      {tab === "deferrals" && (
        <Deferrals date={date} plan={plan.data ?? null} busy={busy} actions={actions}
                   onTryToFit={(orderId) => { setMoveRequest(orderId); setTab("plan"); }} onTab={setTab} />
      )}
      {tab === "live" && <LiveMonitor key={depotKey} />}
      {tab === "ledger" && <Ledger key={depotKey} />}
    </div>
  );
}
