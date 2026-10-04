"use client";

import { useState, type ReactNode } from "react";
import { Button, Select } from "@/components/waypoint/controls";
import { BrandMonogram, RunHistory } from "@/components/waypoint/data";
import { StatusPill } from "@/components/waypoint/status";
import { formatDay } from "@/lib/format";
import { cn } from "@/lib/utils";
import { BRAND, historyGlyphs, type PlanView, type Unplanned } from "./data";
import type { PlanActions, Tab } from "./dispatcher-app";
import { OrderLink } from "./order-panel";

/**
 * Deferred: the orders that cannot go on this run. The engine already picked a reason for each one;
 * the dispatcher checks it, changes it if needed (it saves straight away) or tries to fit the order.
 * Nothing reaches a store until the plan is sent.
 */
export function Deferrals({
  date,
  plan,
  busy,
  actions,
  onTryToFit,
  onTab,
}: {
  date: string | null;
  plan: PlanView | null;
  busy: boolean;
  actions: PlanActions;
  onTryToFit: (orderId: number) => void;
  onTab: (tab: Tab) => void;
}) {
  const [notes, setNotes] = useState<Record<number, string>>({});
  /** A reason picked that needs a note: held here until the note is typed, then saved together. */
  const [pending, setPending] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState<number | null>(null);

  if (!plan) {
    return (
      <Page>
        <h1 className="text-[22px] leading-7 font-bold">Deferred orders</h1>
        <div className="text-wp-text-2">Close orders and build the plan first (Plan tab).</div>
      </Page>
    );
  }

  const released = plan.plan.state === "released";
  if (plan.routes.length === 0) {
    return (
      <Page>
        <h1 className="text-[22px] leading-7 font-bold">Deferred orders</h1>
        <div className="text-wp-text-2">Build the plan first (Plan tab). Orders that cannot fit then show here, each with a reason.</div>
      </Page>
    );
  }
  const orders = plan.unplanned;
  const next = plan.next_operating_day ? formatDay(plan.next_operating_day) : "the next run";
  const needsNote = (code: string | null) => plan.reasons.find((r) => r.code === code)?.needs_note ?? false;

  async function save(o: Unplanned, reason: string, note: string | null) {
    setSaving(o.order_id);
    const result = await actions.defer(o.order_id, reason, note);
    if (result.ok) {
      setPending((p) => {
        const next = { ...p };
        delete next[o.order_id];
        return next;
      });
    }
    setSaving(null);
  }

  function pick(o: Unplanned, reason: string, note: string) {
    if (needsNote(reason) && !note.trim()) {
      setPending({ ...pending, [o.order_id]: reason });
      return;
    }
    void save(o, reason, needsNote(reason) ? note.trim() : null);
  }

  if (orders.length === 0) {
    return (
      <Page>
        <h1 className="text-[22px] leading-7 font-bold">Nothing deferred{date ? ` on ${formatDay(date)}` : ""}</h1>
        <div className="text-wp-text-2">
          {released ? "Every order of this run is on a trip. Past decisions are in Records." : "Every confirmed order is on a trip."}
        </div>
      </Page>
    );
  }

  return (
    <Page>
      <div>
        <h1 className="text-[22px] leading-7 font-bold">
          {orders.length} {orders.length === 1 ? "order goes" : "orders go"} to {next}
        </h1>
        <div className="mt-1 max-w-[760px] text-wp-text-2">
          No trip can take {orders.length === 1 ? "it" : "them"} today without breaking an operating rule. The reason
          below is what the system found; change it if you know better (it saves at once).{" "}
          {released ? "Stores were told when the plan was sent." : "Stores are told when you send the plan."}
        </div>
      </div>

      <section className="overflow-hidden rounded-lg border border-wp-border bg-wp-surface">
        <div className="hidden grid-cols-[minmax(180px,1.2fr)_150px_110px_minmax(220px,1.5fr)_110px] gap-3 border-b border-wp-border px-4 py-2 text-[10px] font-semibold tracking-[.06em] text-wp-muted uppercase lg:grid">
          <div>Outlet</div><div>Order</div><div>Last 5 runs</div><div>Reason (sent to the store)</div><div />
        </div>
        {orders.map((o) => {
          const reason = pending[o.order_id] ?? o.drafted_reason ?? o.suggested_reason ?? "";
          const note = notes[o.order_id] ?? o.drafted_note ?? "";
          const noteMissing = needsNote(reason) && !note.trim();
          return (
            <div key={o.order_id}
                 className={cn("flex flex-col gap-2 border-b border-wp-border px-4 py-3 last:border-b-0 lg:grid lg:grid-cols-[minmax(180px,1.2fr)_150px_110px_minmax(220px,1.5fr)_110px] lg:items-center lg:gap-3",
                               o.consecutive_skip && "bg-wp-warn-tint/50")}>
              <div>
                <BrandMonogram brand={BRAND[o.brand_code]} outlet={`${o.district} ${o.outlet_code}`} />
                {o.consecutive_skip ? (
                  <div className="mt-1"><StatusPill state="warn">Skipped last run too</StatusPill></div>
                ) : o.skips_last5 > 0 ? (
                  <div className="mt-1 text-[11px] text-wp-text-2">{o.skips_last5} skip{o.skips_last5 > 1 ? "s" : ""} in the last 5 runs</div>
                ) : null}
              </div>
              <div className="text-[12px] text-wp-text-2">
                <span className="font-semibold text-wp-text">{o.temp === "chilled" ? "❄ Chilled" : "Dry"}</span> · {Number(o.weight_kg)} kg ·{" "}
                {Number(o.volume_m3)} m³
                <div><OrderLink orderId={o.order_id} className="text-[11px]">{o.confirmation_no} · details</OrderLink></div>
              </div>
              <div>
                {o.history?.length ? <RunHistory history={historyGlyphs(o.history)} /> : <span className="text-[12px] text-wp-muted">No history</span>}
              </div>
              <div className="flex flex-col gap-1.5">
                <Select aria-label={`Reason for ${o.outlet_code}`} value={reason} disabled={released || busy}
                        onChange={(e) => pick(o, e.target.value, note)}
                        className="h-9 w-full text-[13px]">
                  {plan.reasons.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
                </Select>
                {(needsNote(reason) || o.consecutive_skip) && (
                  <input value={note} disabled={released} placeholder={needsNote(reason) ? "Note required: what happened?" : "Optional note: skipped twice, why?"}
                         onChange={(e) => setNotes({ ...notes, [o.order_id]: e.target.value })}
                         onBlur={() => (pending[o.order_id] || note !== (o.drafted_note ?? "")) && note.trim() && void save(o, reason, note.trim())}
                         aria-invalid={noteMissing}
                         className={cn("h-9 rounded-md border bg-wp-surface px-2 text-[13px] outline-none focus:border-wp-focus",
                                       noteMissing ? "border-wp-crit" : "border-wp-border")} />
                )}
                <div className="text-[11px] text-wp-muted">
                  {saving === o.order_id
                    ? "Saving…"
                    : pending[o.order_id]
                      ? <span className="font-semibold text-wp-crit">Type the note; it saves when you leave the box</span>
                      : o.drafted_reason ? "✓ Saved" : "Not saved yet"}
                </div>
              </div>
              <div className="lg:text-right">
                {!released && (
                  <Button variant="secondary" disabled={busy} onClick={() => onTryToFit(o.order_id)}>Try to fit</Button>
                )}
              </div>
            </div>
          );
        })}
      </section>
      <div className="flex flex-wrap items-center gap-3 text-[12px] text-wp-text-2">
        <span>● delivered · ○ no order · ✕ deferred</span>
        {!released && (
          <Button className="ml-auto" onClick={() => onTab("plan")}>Back to the plan to send it</Button>
        )}
      </div>
    </Page>
  );
}

function Page({ children }: { children: ReactNode }) {
  return <div className="mx-auto flex max-w-[1440px] flex-col gap-4 p-4 sm:p-6">{children}</div>;
}
