"use client";

import { useState } from "react";
import { Timeline } from "@/components/waypoint/data";
import { Banner, StatusPill, type Tone } from "@/components/waypoint/status";
import { useApiData } from "@/lib/api/use-api";
import { formatDay, formatDayTime, formatLongDay, plural } from "@/lib/format";
import { cn } from "@/lib/utils";
import { arrivalWindow, isMoved, orderKind, orderTimeline, unloadNote, type OrderDetailData, type Outlet, type StoreOrder } from "./data";
import { storeLayout } from "./layout";
import { LinkButton } from "./link-button";
import { ProofImage } from "@/components/waypoint/proof-image";
import { ChangeOrderAction } from "./order-actions";

const COLLAPSED_LINES = 4;

type Section = { label: string; text: string; lead?: boolean; pill?: { state: Tone; label: string } };

/** What the store needs to know about an order now: the headline, why, and what it means for them. */
function explain(o: OrderDetailData): { banner: { state: Tone; text: string }; sections: Section[] } {
  const window = arrivalWindow(o);
  if (o.status === "received") {
    return {
      banner: { state: o.issues.length ? "warn" : "good", text: `Delivered and confirmed by you${o.issues.length ? ` with ${plural(o.issues.length, "issue")}` : ""}.` },
      sections: [
        { label: "DELIVERED", lead: true, text: o.delivered_at ? formatDayTime(o.delivered_at) : "—" },
        { label: "ISSUES", text: o.issues.length ? o.issues.map((i) => `${i.reference_no} · ${i.product} · ${i.type.replace("_", " ")}${i.qty ? ` ${i.qty}` : ""}`).join("; ") : "None reported." },
      ],
    };
  }
  if (o.needs_receipt) {
    return {
      banner: { state: "warn", text: "Delivered. Check it and confirm receipt." },
      sections: [
        { label: "DELIVERED", lead: true, text: o.delivered_at ? formatDayTime(o.delivered_at) : "—" },
        { label: "WHAT IT MEANS FOR YOU", text: "Count what arrived against the driver’s record and confirm, so dispatch can close the run." },
      ],
    };
  }
  if (o.status === "not_delivered") {
    return {
      banner: { state: "crit", text: "This delivery could not be completed. Dispatch will confirm a new day." },
      sections: [{ label: "WHAT HAPPENED", lead: true, text: "The driver recorded the delivery as not completed." }],
    };
  }
  if (isMoved(o)) {
    const day = formatLongDay(o.moved_from!).split(" ")[0];
    return {
      banner: { state: "warn", text: `This order is moved from ${formatDay(o.moved_from!)} to ${formatDay(o.moved_to!)}.` },
      sections: [
        { label: "WHY", lead: true, text: o.moved_reason ?? "Dispatch moved it to the next run." },
        {
          label: "CONTEXT",
          text: o.deferral_count > 1 || o.moved_consecutive
            ? "This order has been moved more than once, so it goes first on the next run."
            : "Moved orders go ahead of new ones on the next run.",
          pill: { state: "warn", label: "Priority" },
        },
        { label: "WHAT IT MEANS FOR YOU", text: `Plan ${day}’s stock without this order. Your other orders are unaffected.` },
      ],
    };
  }
  return {
    banner: window
      ? { state: "good", text: `This order arrives ${formatDay(o.delivery_date)}, ${window}.` }
      : { state: "info", text: `Confirmed for ${formatDay(o.delivery_date)}. The arrival window appears when dispatch releases the plan.` },
    sections: [
      { label: "ARRIVAL WINDOW", lead: true, text: window ? `${formatDay(o.delivery_date)}, ${window}.` : "Not yet: the plan is released after the 16:00 cutoff." },
      { label: "WHAT IT MEANS FOR YOU", text: `${unloadNote(o.unload)}, then confirm receipt on the day so dispatch can close the run.` },
    ],
  };
}

/** S3 · Order detail: what the warehouse did with this order and where it is now. */
export function OrderDetail({
  orderId,
  outlet,
  onChangeOrder,
  onBack,
}: {
  orderId: number;
  outlet: Outlet;
  onChangeOrder: (order: StoreOrder) => void;
  onBack: () => void;
}) {
  const detail = useApiData<OrderDetailData>(`/store/orders/${orderId}`, 30_000);
  const [showAll, setShowAll] = useState(false);

  if (detail.error && !detail.data) return <Banner state="crit">{detail.error}</Banner>;
  if (!detail.data) return <div className="text-[13px] text-wp-text-2">Loading the order…</div>;

  const order = detail.data;
  const { banner, sections } = explain(order);
  const lines = showAll ? order.lines : order.lines.slice(0, COLLAPSED_LINES);
  const hidden = order.lines.length - COLLAPSED_LINES;

  return (
    <>
      <div className="flex flex-col gap-1">
        <LinkButton onClick={onBack} className="no-underline">
          ← Deliveries
        </LinkButton>
        <h1 className={storeLayout.h1}>
          Order {order.confirmation_no} · {orderKind(order)}
        </h1>
        <div className="text-[13px] text-wp-text-2">
          {outlet.name} · Placed {formatDayTime(order.placed_at)}
        </div>
      </div>
      <Banner state={banner.state}>{banner.text}</Banner>

      <div className={cn("grid items-start gap-6", storeLayout.colsMain)}>
        <div className="flex min-w-0 flex-col gap-4">
          <section className={cn(storeLayout.card, "flex flex-col gap-4 p-4")}>
            {sections.map((section) => (
              <div key={section.label}>
                <div className="text-[11px] font-semibold tracking-[.06em] text-wp-muted">{section.label}</div>
                <div className={cn("mt-1 flex flex-wrap items-center gap-2", section.lead ? "text-base leading-[22px]" : "text-[13px] leading-[18px]")}>
                  {section.text}
                  {section.pill && <StatusPill state={section.pill.state}>{section.pill.label}</StatusPill>}
                </div>
              </div>
            ))}
            {order.delivery && (
              <div className={cn("grid gap-3", storeLayout.colsReceipt)}>
                <Fact label="DRIVER · VEHICLE" value={`${order.delivery.driver_name} · ${order.delivery.vehicle_source_id}`} />
                <Fact label="SIGNED BY" value={order.delivery.received_by ?? "—"} />
                <Fact label="PROOF" value={order.proof.length ? `${plural(order.proof.length, "file")} attached` : "None"} />
              </div>
            )}
            {order.proof.length > 0 && (
              <div className="flex flex-wrap gap-3">
                {order.proof.map((p) => (
                  <ProofImage key={p.attachment_id} id={p.attachment_id} kind={p.kind} />
                ))}
              </div>
            )}
          </section>

          {["placed", "confirmed", "planned"].includes(order.status) && (
            <section className={cn(storeLayout.card, "flex flex-col gap-3 p-4")}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-[15px] font-semibold">Change this order</h2>
                <ChangeOrderAction order={order} onChangeOrder={onChangeOrder} />
              </div>
              <div className="text-[13px] leading-[18px] text-wp-text-2">
                {order.changeable
                  ? `You can change what is on this order until the cutoff${order.cutoff_at ? ` (${formatDayTime(order.cutoff_at)})` : ""}.`
                  : "This order is past its cutoff and on the van plan, so it can no longer be changed here. Call the dispatch desk if something must move."}
              </div>
            </section>
          )}

          <section className={cn(storeLayout.card, "flex flex-col gap-1 p-4")}>
            <h2 className="mb-2 text-[15px] font-semibold">Order lines</h2>
            {lines.map((line) => (
              <div key={line.line_no} className={cn("flex items-center justify-between gap-2 border-t border-wp-border text-[13px]", storeLayout.rowHeight)}>
                <span>{line.product}</span>
                <span className="text-wp-text-2 tabular-nums">
                  {Number(line.qty)} {line.unit}
                </span>
              </div>
            ))}
            {hidden > 0 && (
              <LinkButton onClick={() => setShowAll(!showAll)} className="pt-2">
                {showAll ? "Show fewer lines" : `Show ${hidden} more lines`}
              </LinkButton>
            )}
          </section>
        </div>

        <aside className={cn(storeLayout.card, "flex flex-col gap-3 p-4")}>
          <h2 className="text-[15px] font-semibold">Where it is</h2>
          <Timeline steps={orderTimeline(order)} />
        </aside>
      </div>
    </>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-semibold tracking-[.06em] text-wp-muted">{label}</div>
      <div className="mt-0.5 text-[13px] font-semibold">{value}</div>
    </div>
  );
}
