"use client";

import { X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { BrandMonogram, Eyebrow, RunHistory } from "@/components/waypoint/data";
import { ProofImage } from "@/components/waypoint/proof-image";
import { StatusPill, type Tone } from "@/components/waypoint/status";
import { useApiData } from "@/lib/api/use-api";
import { formatDay, formatDayTime, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { BRAND, historyGlyphs, type MovedOrder, type OrderRecord, type OrderRow } from "./data";

/** Where an order is now, in the dispatcher's words: one tone, one label, one line of detail. */
export function orderPlace(o: Partial<OrderRow> & Partial<Pick<MovedOrder, "to_date" | "moved_reason" | "moved_kind">>): {
  key: "moved" | "delivered" | "trip" | "cant_go" | "open" | "waiting";
  tone: Tone;
  label: string;
  detail: string;
} {
  if (o.to_date) {
    return { key: "moved", tone: "warn", label: `Moved to ${formatDay(o.to_date)}`,
             detail: `${o.moved_kind === "requeued_after_failure" ? "Not delivered: " : ""}${o.moved_reason ?? ""}` };
  }
  if (o.delivery_outcome) {
    const label = { delivered: "Delivered", delivered_in_part: "Some items missing", not_delivered: "Not delivered" }[o.delivery_outcome];
    const tone: Tone = o.delivery_outcome === "delivered" ? "good" : o.delivery_outcome === "delivered_in_part" ? "warn" : "crit";
    return { key: "delivered", tone, label,
             detail: [o.delivered_at ? formatTime(o.delivered_at) : null, o.receipt_at ? "confirmed by the store" : "store has not confirmed yet"]
               .filter(Boolean).join(" · ") };
  }
  if (o.route_id) {
    return { key: "trip", tone: "info", label: `${o.vehicle ?? "Vehicle"} · trip ${o.route_seq}`,
             detail: `stop ${o.stop_seq}${o.planned_arrival ? ` · planned ${formatTime(o.planned_arrival)}` : ""}${o.failed_before ? " · second try after a failed delivery" : ""}` };
  }
  if (o.draft_reason) return { key: "cant_go", tone: "warn", label: "Can't go on this day", detail: o.draft_reason };
  if (o.failed_before) {
    return { key: "waiting", tone: "warn", label: "Not on a trip yet", detail: "the last delivery failed; it goes on this day's plan first" };
  }
  if (o.status === "placed") return { key: "open", tone: "info", label: "Open", detail: "the store can still change it until the cutoff" };
  return { key: "waiting", tone: "offline", label: "Not on a trip yet", detail: "build the plan to place it" };
}

const UNLOAD: Record<string, string> = { rear_dock: "Rear dock", street: "Street (kerbside)", mall_bay: "Mall bay" };
const hhmm = (t: string) => t.slice(0, 5);

type OpenOrder = (orderId: number) => void;
const OrderPanelContext = createContext<OpenOrder>(() => undefined);

/** Lets any dispatcher screen open an order's full record in a side panel. */
export function OrderPanelProvider({ children }: { children: ReactNode }) {
  const [orderId, setOrderId] = useState<number | null>(null);
  const open = useCallback<OpenOrder>((id) => setOrderId(id), []);
  return (
    <OrderPanelContext.Provider value={open}>
      {children}
      {orderId !== null && <OrderPanel key={orderId} orderId={orderId} onClose={() => setOrderId(null)} />}
    </OrderPanelContext.Provider>
  );
}

export const useOpenOrder = () => useContext(OrderPanelContext);

/** A confirmation number (or any label) that opens the order. */
export function OrderLink({ orderId, children, className }: { orderId: number; children: ReactNode; className?: string }) {
  const open = useOpenOrder();
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); open(orderId); }} title="Open the order"
            className={cn("cursor-pointer font-semibold text-wp-focus underline decoration-wp-focus/40 underline-offset-2 hover:decoration-wp-focus", className)}>
      {children}
    </button>
  );
}

/** Every status change, deferral and store notice of an order, oldest first. */
export function orderEvents(o: OrderRecord): [string, string][] {
  return [
    ...o.timeline.map((t): [string, string] => [t.at, `Status: ${t.to_status.replaceAll("_", " ")}${t.note ? ` (${t.note})` : ""}`]),
    ...o.deferrals.map((d): [string, string] => [d.decided_at,
      `Deferred by ${d.decided_by}: ${d.reason}${d.note ? `. Note: ${d.note}` : ""}. Moved ${formatDay(d.from_date)} → ${formatDay(d.to_date)}`]),
    ...o.notices.map((n): [string, string] => [n.created_at, `Store told: ${n.title}${n.read_at ? ` · read ${formatTime(n.read_at)}` : " · not read yet"}`]),
  ].sort((a, b) => a[0].localeCompare(b[0]));
}

function OrderPanel({ orderId, onClose }: { orderId: number; onClose: () => void }) {
  const record = useApiData<OrderRecord>(`/dispatch/orders/${orderId}`);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const o = record.data;
  const events = useMemo(() => (o ? orderEvents(o) : []), [o]);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/25" onClick={onClose} aria-hidden />
      <aside role="dialog" aria-modal="true" aria-label={o ? `Order ${o.confirmation_no}` : "Order"}
             className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[560px] flex-col border-l border-wp-border bg-wp-surface text-[13px] shadow-xl">
        <div className="flex items-start gap-3 border-b border-wp-border px-5 py-4">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="font-mono text-[12px] text-wp-text-2">{o?.confirmation_no ?? "Order"}</span>
            {o?.brand_code && <BrandMonogram brand={BRAND[o.brand_code]} outlet={`${o.district} ${o.outlet_code}`} />}
          </div>
          <button type="button" onClick={onClose} aria-label="Close the order" className="ml-auto cursor-pointer rounded p-1 text-wp-muted hover:bg-wp-surface-2">
            <X className="size-4" aria-hidden />
          </button>
        </div>

        {!o ? (
          <div className="p-5 text-wp-text-2">{record.error ?? "Loading the order…"}</div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-4">
            <Where o={o} />

            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
              <Fact label="Delivery day" value={o.delivery_date ? formatDay(o.delivery_date) : "—"}
                    note={o.deferral_count && o.original_delivery_date ? `moved here from ${formatDay(o.original_delivery_date)}` : undefined} />
              <Fact label="Goods" value={o.temp === "chilled" ? "❄ Chilled" : "Dry"} note={o.brand_name} />
              <Fact label="Load" value={`${Number(o.weight_kg ?? 0)} kg`} note={`${Number(o.volume_m3 ?? 0)} m³`} />
              <Fact label="Lines" value={String(o.line_count ?? o.lines?.length ?? 0)} />
              <Fact label="Placed" value={o.placed_at ? formatDayTime(o.placed_at) : "—"} note={o.source === "dispatcher" ? "by the dispatcher" : "by the store"} />
              <Fact label="Status" value={(o.status ?? "").replaceAll("_", " ")} />
            </dl>

            <section className="flex flex-col gap-2">
              <Eyebrow>Outlet · {o.outlet_name}</Eyebrow>
              <div className="flex flex-wrap gap-1.5">
                {o.unload && <Tag>{UNLOAD[o.unload] ?? o.unload}</Tag>}
                {o.van_only && <Tag tone="warn">Van-only access</Tag>}
                {(o.outlet?.windows ?? []).map((w) => (
                  <Tag key={`${w.kind}${w.opens}`}>{w.kind === "delivery" ? "Delivery window" : "Mall access"} {hhmm(w.opens)}–{hhmm(w.closes)}</Tag>
                ))}
                {o.outlet && !o.outlet.windows?.length && <Tag>No delivery window on this day</Tag>}
              </div>
              {(o.outlet?.address || o.outlet?.access_note) && (
                <div className="text-wp-text-2">{[o.outlet?.address, o.outlet?.access_note].filter(Boolean).join(" · ")}</div>
              )}
            </section>

            <section className="flex flex-col gap-1.5">
              <Eyebrow>What is in it · {o.lines?.length ?? 0} {o.lines?.length === 1 ? "line" : "lines"}</Eyebrow>
              <div className="overflow-x-auto rounded-md border border-wp-border">
                <table className="w-full min-w-[420px] text-left tabular-nums">
                  <thead className="bg-wp-surface-2/60 text-[10px] font-semibold tracking-[.06em] text-wp-muted uppercase">
                    <tr><th className="px-2.5 py-1.5">#</th><th className="px-2.5 py-1.5">Item</th><th className="px-2.5 py-1.5 text-right">Qty</th>
                        <th className="px-2.5 py-1.5 text-right">kg</th><th className="px-2.5 py-1.5 text-right">m³</th></tr>
                  </thead>
                  <tbody>
                    {(o.lines ?? []).map((l) => (
                      <tr key={l.line_no} className="border-t border-wp-border">
                        <td className="px-2.5 py-1.5 text-wp-muted">{l.line_no}</td>
                        <td className="px-2.5 py-1.5">
                          <div className="font-semibold">{l.name}</div>
                          <div className="text-[11px] text-wp-muted">{l.sku}{l.fragile ? " · fragile" : ""}{l.high_value ? " · high value" : ""}</div>
                        </td>
                        <td className="px-2.5 py-1.5 text-right whitespace-nowrap">{Number(l.qty)} {l.unit}</td>
                        <td className="px-2.5 py-1.5 text-right">{Number(l.kg).toFixed(1)}</td>
                        <td className="px-2.5 py-1.5 text-right">{Number(l.m3).toFixed(3)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-wp-border font-semibold">
                      <td className="px-2.5 py-1.5" colSpan={3}>Order total</td>
                      <td className="px-2.5 py-1.5 text-right">{Number(o.weight_kg ?? 0).toFixed(1)}</td>
                      <td className="px-2.5 py-1.5 text-right">{Number(o.volume_m3 ?? 0).toFixed(3)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </section>

            <section className="flex flex-col gap-1.5">
              <Eyebrow>Trail</Eyebrow>
              {events.length === 0 && <div className="text-wp-text-2">Nothing recorded yet.</div>}
              {events.map(([time, text], i) => (
                <div key={i} className="flex gap-3">
                  <span className="w-28 flex-none text-wp-text-2">{formatDayTime(time)}</span>
                  <span>{text}</span>
                </div>
              ))}
            </section>

            <div className="grid gap-4 sm:grid-cols-2">
              <section className="flex flex-col gap-1.5">
                <Eyebrow>Outlet&apos;s last runs</Eyebrow>
                {o.history.length ? <RunHistory history={historyGlyphs(o.history)} /> : <div className="text-wp-text-2">No earlier runs recorded</div>}
              </section>
              <section className="flex flex-col gap-1.5">
                <Eyebrow>Delivery proof</Eyebrow>
                {o.proof.length ? (
                  <div className="flex flex-wrap gap-2">{o.proof.map((p) => <ProofImage key={p.attachment_id} id={p.attachment_id} kind={p.kind} />)}</div>
                ) : (
                  <div className="text-wp-text-2">None yet</div>
                )}
              </section>
            </div>
          </div>
        )}
      </aside>
    </>
  );
}

function Where({ o }: { o: OrderRecord }) {
  const place = orderPlace(o);
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-wp-border bg-wp-surface-2/40 px-3 py-2.5">
      <Eyebrow>Where it is now</Eyebrow>
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill state={place.tone}>{place.label}</StatusPill>
        <span className="text-wp-text-2">{place.detail}</span>
      </div>
      {o.deferrals.length > 0 && (
        <div className="text-[12px] text-wp-text-2">
          Deferred {o.deferrals.length} {o.deferrals.length === 1 ? "time" : "times"} · last: {o.deferrals[o.deferrals.length - 1].reason}
        </div>
      )}
    </div>
  );
}

function Fact({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex min-w-0 flex-col">
      <dt className="text-[10px] font-semibold tracking-[.06em] text-wp-muted uppercase">{label}</dt>
      <dd className="m-0 font-semibold first-letter:uppercase">{value}</dd>
      {note && <dd className="m-0 text-[11px] text-wp-text-2">{note}</dd>}
    </div>
  );
}

function Tag({ children, tone }: { children: ReactNode; tone?: "warn" }) {
  return (
    <span className={cn("rounded border px-1.5 py-0.5 text-[12px]",
                        tone === "warn" ? "border-wp-warn/40 bg-wp-warn-tint text-wp-warn" : "border-wp-border text-wp-text-2")}>
      {children}
    </span>
  );
}
