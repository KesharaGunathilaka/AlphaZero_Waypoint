"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/waypoint/controls";
import { BrandMonogram, Eyebrow, RunHistory } from "@/components/waypoint/data";
import { StatusPill, type Tone } from "@/components/waypoint/status";
import { formatDay } from "@/lib/format";
import { cn } from "@/lib/utils";
import { BRAND, historyGlyphs, type PlanView, type Unplanned } from "./data";
import type { PlanActions } from "./dispatcher-app";

function skipPill(o: Unplanned): { state: Tone; label: string } {
  if (o.consecutive_skip) return { state: "warn", label: "Consecutive skip" };
  if (o.skips_last5 > 0) return { state: "info", label: `${o.skips_last5} skip${o.skips_last5 > 1 ? "s" : ""} in last 5` };
  return { state: "good", label: "No recent skips" };
}

/** D2 · Overflow & deferrals: record a reason for each order that cannot be served. */
export function Deferrals({
  date,
  plan,
  busy,
  actions,
  onGoToPlanBoard,
}: {
  date: string | null;
  plan: PlanView | null;
  busy: boolean;
  actions: PlanActions;
  onGoToPlanBoard: () => void;
}) {
  const [reasons, setReasons] = useState<Record<number, string>>({});
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [saved, setSaved] = useState(false);

  if (!plan) {
    return (
      <Page>
        <h1 className="text-[22px] leading-6 font-bold">Overflow &amp; deferrals</h1>
        <div className="text-wp-text-2">Close orders and let the engine propose a plan in D1 first.</div>
      </Page>
    );
  }

  const orders = plan.unplanned;
  const released = plan.plan.state === "released";
  const reasonOf = (o: Unplanned) => reasons[o.order_id] ?? o.drafted_reason ?? o.suggested_reason ?? "other";
  const noteOf = (o: Unplanned) => notes[o.order_id] ?? o.drafted_note ?? "";
  const needsNote = (o: Unplanned) => plan.reasons.find((r) => r.code === reasonOf(o))?.needs_note ?? false;
  const missingNotes = orders.filter((o) => needsNote(o) && !noteOf(o).trim()).length;
  const next = plan.next_operating_day ? formatDay(plan.next_operating_day) : "the next run";
  const onTrips = new Set(plan.routes.flatMap((r) => r.stops.map((s) => s.outlet_code)));

  async function confirm() {
    for (const o of orders) {
      const result = await actions.defer(o.order_id, reasonOf(o), noteOf(o).trim() || null);
      if (!result.ok) return;
    }
    setSaved(true);
  }

  if (orders.length === 0) {
    return (
      <Page>
        <h1 className="text-[22px] leading-6 font-bold">No orders waiting for a decision{date ? ` on ${formatDay(date)}` : ""}</h1>
        <div className="text-wp-text-2">
          {released
            ? "The plan is released. Deferrals made for this run are applied, stores are told, and every decision is in D4 · Record ledger."
            : "Every confirmed order is on a trip."}
        </div>
      </Page>
    );
  }

  const status = saved
    ? "Decisions saved. Release the plan in D1 to apply them and tell the stores."
    : missingNotes > 0
      ? `${missingNotes} order needs a written note before you can confirm.`
      : `All ${orders.length} orders have a reason. Ready to confirm.`;

  return (
    <Page>
      <div>
        <h1 className="text-[22px] leading-6 font-bold">
          {orders.length} {orders.length === 1 ? "order cannot" : "orders cannot"} be served on {date ? formatDay(date) : "this run"}
        </h1>
        <div className="mt-1 text-wp-text-2">
          Record a reason for each order, then confirm. The reason is pre-selected from what the system found.
        </div>
      </div>

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-4">
          {orders.map((order) => {
            const pill = skipPill(order);
            const reason = reasonOf(order);
            return (
              <div key={order.order_id}
                   className={cn("rounded-lg border bg-wp-surface p-4", order.consecutive_skip ? "border-wp-gauge-amber" : "border-wp-border")}>
                <div className="flex flex-wrap items-center gap-4">
                  <BrandMonogram brand={BRAND[order.brand_code]} outlet={`${order.district} ${order.outlet_code}`} />
                  <span className="text-xs text-wp-text-2">
                    {order.temp === "chilled" ? "Chilled · " : ""}{Number(order.weight_kg)} kg · {Number(order.volume_m3)} m³ · {order.confirmation_no}
                  </span>
                  <span className="ml-auto"><StatusPill state={pill.state}>{pill.label}</StatusPill></span>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="flex flex-col gap-3">
                    <div>
                      <Eyebrow>System found</Eyebrow>
                      <div className="mt-0.5">{order.suggested_label ?? "No trip of its brand and district can take it."}</div>
                    </div>
                    <div>
                      <Eyebrow>Last five runs</Eyebrow>
                      {order.history?.length ? <RunHistory history={historyGlyphs(order.history)} /> : <div className="text-wp-text-2">No earlier runs recorded</div>}
                      <div className="text-[11px] text-wp-muted">● delivered · ○ no order · ✕ deferred</div>
                    </div>
                    <div>
                      <Eyebrow>If deferred</Eyebrow>
                      <div className="mt-0.5">
                        {order.outlet_code} is told the reason and that the order moves to {next}.
                        {onTrips.has(order.outlet_code) ? " Its other order still arrives as planned." : ""}
                      </div>
                    </div>
                  </div>

                  <fieldset className="flex flex-col gap-2">
                    <legend className="mb-2"><Eyebrow>Reason</Eyebrow></legend>
                    {plan.reasons.map((r) => (
                      <label key={r.code}
                             className={cn("flex min-h-8 cursor-pointer items-center gap-2 rounded-md border bg-wp-surface px-3 py-2",
                                           reason === r.code ? "border-wp-action" : "border-wp-border")}>
                        <input type="radio" name={`reason-${order.order_id}`} checked={reason === r.code} disabled={released}
                               onChange={() => { setReasons({ ...reasons, [order.order_id]: r.code }); setSaved(false); }} />
                        <span>{r.label}</span>
                      </label>
                    ))}
                    {(needsNote(order) || order.consecutive_skip) && (
                      <div className="flex flex-col gap-1">
                        <label htmlFor={`note-${order.order_id}`} className="text-[11px] font-semibold text-wp-warn">
                          ▲ {needsNote(order) ? "A written note is required for this reason" : "Skipped on the previous run too: add a note for the record"}
                        </label>
                        <textarea id={`note-${order.order_id}`} value={noteOf(order)} disabled={released}
                                  onChange={(e) => { setNotes({ ...notes, [order.order_id]: e.target.value }); setSaved(false); }}
                                  placeholder="Why is this outlet being skipped?"
                                  className="min-h-14 rounded-md border border-wp-border bg-wp-surface p-2 text-wp-text" />
                      </div>
                    )}
                    <div className="mt-1">
                      <a href="#" onClick={(e) => { e.preventDefault(); onGoToPlanBoard(); }} className="text-xs text-wp-focus hover:text-wp-action">
                        Make room in D1 instead
                      </a>
                    </div>
                  </fieldset>
                </div>
              </div>
            );
          })}
        </div>

        <aside className="sticky top-4 flex flex-col gap-3 rounded-lg border border-wp-border bg-wp-surface p-4">
          <h2 className="text-[15px] leading-5 font-semibold">What confirming does</h2>
          <ol className="flex flex-col gap-2 text-wp-text-2">
            <li>1. Your reasons are saved against each order.</li>
            <li>2. When you release the plan, the orders move to {next} and store managers are told the reason.</li>
            <li>3. Each decision is logged with your name, the time and the reason (D4).</li>
          </ol>
          <div className="border-t border-wp-border pt-3 text-xs text-wp-text-2">{status}</div>
          <Button className="min-h-10 w-full" disabled={busy || missingNotes > 0 || released} onClick={() => void confirm()}>
            {saved ? "Saved · confirm again to update" : `Confirm ${orders.length} ${orders.length === 1 ? "deferral" : "deferrals"}`}
          </Button>
          {saved && (
            <Button variant="secondary" className="w-full" onClick={onGoToPlanBoard}>
              Go to D1 to release the plan
            </Button>
          )}
          <div className="text-[11px] text-wp-muted">
            Placing an order on a trip in D1 withdraws its deferral; nothing is sent to the store.
          </div>
        </aside>
      </div>
    </Page>
  );
}

function Page({ children }: { children: ReactNode }) {
  return <div className="mx-auto flex max-w-[1440px] flex-col gap-4 p-6">{children}</div>;
}
