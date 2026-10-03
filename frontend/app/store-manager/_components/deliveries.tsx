"use client";

import { Button } from "@/components/waypoint/controls";
import { Eyebrow } from "@/components/waypoint/data";
import { Banner, StatusPill } from "@/components/waypoint/status";
import { cn } from "@/lib/utils";
import { RECENT_DELIVERIES, type OrderId } from "./data";
import { storeLayout } from "./layout";
import { LinkButton } from "./link-button";
import type { StoreScreen } from "./store-manager-app";

/** S1 · Deliveries: what needs the manager now, tomorrow's deliveries and the next order cutoff. */
export function Deliveries({
  receiptNote,
  onOpenOrder,
  onNavigate,
}: {
  /** Set once today's delivery has been confirmed in S4. */
  receiptNote: string | null;
  onOpenOrder: (id: OrderId) => void;
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
            Differs from your order: Dhal 1 kg, 12 of 15 ordered. Short at loading, told to you at 07:15. 4 other
            lines match.
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
            <div className="flex justify-between text-xs text-wp-muted">
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
            <div className="flex justify-between text-xs text-wp-muted">
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

      <section className="flex flex-col gap-2">
        <h2 className="text-[15px] font-semibold">Recent deliveries</h2>
        <div className={cn(storeLayout.card, "overflow-hidden")}>
          {RECENT_DELIVERIES.map((r, i) => (
            <div
              key={r.date}
              className={cn("flex items-center gap-3 px-4 py-2", storeLayout.rowHeight, i > 0 && "border-t border-wp-border")}
            >
              <div className="w-[84px] flex-none text-[13px] font-semibold">{r.date}</div>
              <div className="min-w-0 flex-1 text-[13px] text-wp-text-2">{r.what}</div>
              <StatusPill state={r.state}>{r.pill}</StatusPill>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
