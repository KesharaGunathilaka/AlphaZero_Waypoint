"use client";

import { useState } from "react";
import { Button } from "@/components/waypoint/controls";
import { Eyebrow } from "@/components/waypoint/data";
import { Banner, StatusPill } from "@/components/waypoint/status";
import { cn } from "@/lib/utils";
import { RECENT_DELIVERIES, type OrderId, type RecentDelivery } from "./data";
import { storeLayout } from "./layout";
import { LinkButton } from "./link-button";
import { ChangeOrderAction } from "./order-actions";
import type { StoreScreen } from "./store-manager-app";

/** S1 · Deliveries: what needs the manager now, tomorrow's deliveries and the next order cutoff. */
export function Deliveries({
  receiptNote,
  onOpenOrder,
  onChangeOrder,
  onNavigate,
}: {
  /** Set once today's delivery has been confirmed in S4. */
  receiptNote: string | null;
  onOpenOrder: (id: OrderId) => void;
  onChangeOrder: (id: OrderId) => void;
  onNavigate: (screen: StoreScreen) => void;
}) {
  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className={storeLayout.h1}>Deliveries</h1>
        <div className="text-[13px] text-wp-text-2">Fresh Pettah · Tue 29 Sep 2026</div>
      </div>

      {receiptNote === null ? (
        <div className={cn("flex flex-col gap-3 border border-wp-warn bg-wp-warn-tint p-4", storeLayout.radius)}>
          <div className="text-[11px] font-semibold tracking-[.06em] text-wp-warn">▲ NEEDS YOU</div>
          <div className="text-xl leading-[26px] font-semibold">Today’s delivery arrived at 09:42. Confirm receipt.</div>
          <div className="text-[13px] leading-[18px]">
            Differs from your order: Dhal 1 kg, 12 of 15 ordered. Short at the warehouse, told to you at 07:15. 4
            other lines match.
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button className={storeLayout.button} onClick={() => onNavigate("confirm")}>
              Confirm receipt
            </Button>
            <span className="text-xs text-wp-text-2">Record DR-20931 · Unconfirmed for 7 h 48 min</span>
          </div>
        </div>
      ) : (
        <Banner state="good">Receipt confirmed for today’s delivery. {receiptNote}</Banner>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-[15px] font-semibold">Tomorrow · Wed 30 Sep</h2>
        <div className={cn("grid gap-4", storeLayout.cols2)}>
          <div className={cn(storeLayout.card, "flex flex-col gap-3 p-4")}>
            <div className="flex items-center justify-between gap-2">
              <div className="text-[15px] font-semibold">Fresh · Dry groceries</div>
              <StatusPill state="good">Scheduled</StatusPill>
            </div>
            <div>
              <div className="text-[11px] font-semibold tracking-[.06em] text-wp-muted">ARRIVAL WINDOW</div>
              <div className="text-3xl leading-8 font-bold tabular-nums">08:30–10:00</div>
            </div>
            <div className="text-[13px] leading-[18px] text-wp-text-2">
              Unload at the rear door. 2 pallets, 46 lines of stock. Plan released after the 16:00 cutoff on Tue 29
              Sep.
            </div>
            <ChangeOrderAction orderId="FP-4417" onChangeOrder={onChangeOrder} className="mt-auto" />
            <div className="flex justify-between gap-2 text-xs text-wp-muted">
              <span>Order FP-4417</span>
              <LinkButton onClick={() => onOpenOrder("FP-4417")}>Details</LinkButton>
            </div>
          </div>

          <div className={cn("flex flex-col gap-3 border border-wp-warn bg-wp-warn-tint p-4", storeLayout.radius)}>
            <div className="flex items-center justify-between gap-2">
              <div className="text-[15px] font-semibold">Fresh · Chilled</div>
              <StatusPill state="warn">Moved</StatusPill>
            </div>
            <div className="text-xl leading-[26px] font-semibold text-wp-warn">Not arriving on Wednesday</div>
            <div className="text-[13px] leading-[18px]">
              No refrigerated van that can reach your store was free. It will come on <b>Thu 1 Oct</b>. Plan
              Wednesday’s chilled stock without it.
            </div>
            <ChangeOrderAction orderId="FP-4418" onChangeOrder={onChangeOrder} className="mt-auto" />
            <div className="flex justify-between gap-2 text-xs text-wp-muted">
              <span>Order FP-4418</span>
              <LinkButton onClick={() => onOpenOrder("FP-4418")}>See why and what changes</LinkButton>
            </div>
          </div>
        </div>
      </section>

      <div className={cn(storeLayout.card, "flex flex-wrap items-center justify-between gap-4 p-4")}>
        <div className="flex flex-col gap-1">
          <Eyebrow className="text-[11px]">Next order · for Thu 1 Oct</Eyebrow>
          <div className="text-xl leading-[26px] font-semibold">Closes Wed 30 Sep 16:00</div>
          <div className="text-[13px] text-wp-text-2">22 h 30 min left</div>
        </div>
        <Button variant="secondary" className={storeLayout.button} onClick={() => onNavigate("order")}>
          Place or change order
        </Button>
      </div>

      <RecentDeliveries />
    </>
  );
}

/** Each row opens a brief record of what arrived and what was raised against it. */
function RecentDeliveries() {
  const [openOrder, setOpenOrder] = useState<string | null>(null);

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-[15px] font-semibold">Recent deliveries</h2>
      <div className={cn(storeLayout.card, "overflow-hidden")}>
        {RECENT_DELIVERIES.map((delivery, i) => {
          const open = openOrder === delivery.order;
          return (
            <div key={delivery.order} className={cn(i > 0 && "border-t border-wp-border")}>
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpenOrder(open ? null : delivery.order)}
                className={cn(
                  "flex w-full cursor-pointer items-center gap-3 px-4 py-2 text-left hover:bg-wp-surface-2",
                  storeLayout.rowHeight,
                )}
              >
                <span className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-3">
                  <span className="text-[13px] font-semibold sm:w-[84px] sm:flex-none">{delivery.date}</span>
                  <span className="min-w-0 truncate text-[13px] text-wp-text-2">{delivery.what}</span>
                </span>
                <StatusPill state={delivery.state}>{delivery.pill}</StatusPill>
                <span
                  aria-hidden="true"
                  className={cn("text-xs text-wp-muted transition-transform", open && "rotate-180")}
                >
                  ▾
                </span>
              </button>
              {open && <RecentDeliveryDetail delivery={delivery} />}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function RecentDeliveryDetail({ delivery }: { delivery: RecentDelivery }) {
  return (
    <div className="flex flex-col gap-3 border-t border-wp-border bg-wp-surface-2 px-4 py-3">
      <div className={cn("grid gap-3", storeLayout.colsReceipt)}>
        <Fact label="ORDER" value={delivery.order} />
        <Fact label="ARRIVED" value={delivery.arrived} />
        <Fact label="DRIVER · VEHICLE" value={delivery.driver} />
        <Fact label="YOU COUNTED" value={delivery.counted} />
      </div>
      <div className="text-[13px] leading-[18px]">{delivery.summary}</div>
      {delivery.issues && (
        <div className="flex flex-col gap-1">
          <div className="text-[11px] font-semibold tracking-[.06em] text-wp-muted">ISSUES RAISED</div>
          {delivery.issues.map((issue) => (
            <div key={issue} className="text-[13px] font-semibold text-wp-crit">
              {issue}
            </div>
          ))}
        </div>
      )}
      <div className="text-xs text-wp-muted">Receipt confirmed {delivery.confirmed}</div>
    </div>
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
