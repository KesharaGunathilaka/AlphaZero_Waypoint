"use client";

import { useState } from "react";
import { BrandMonogram } from "@/components/waypoint/data";
import { ScreenSwitcher } from "@/components/waypoint/screen-switcher";
import { SyncIndicator } from "@/components/waypoint/status";
import { ConfirmDelivery, type Receipt } from "./confirm-delivery";
import type { OrderId } from "./data";
import { Deliveries } from "./deliveries";
import { OrderDetail } from "./order-detail";
import { PlaceOrder } from "./place-order";

const SCREENS = [
  ["deliveries", "Deliveries"],
  ["order", "Place order"],
  ["detail", "Order detail"],
  ["confirm", "Confirm delivery"],
] as const;
export type StoreScreen = (typeof SCREENS)[number][0];

export function StoreManagerApp() {
  const [screen, setScreen] = useState<StoreScreen>("deliveries");
  const [orderId, setOrderId] = useState<OrderId>("FP-4418");
  const [receipt, setReceipt] = useState<Receipt | null>(null);

  const toDeliveries = () => setScreen("deliveries");

  function openOrder(id: OrderId) {
    setOrderId(id);
    setScreen("detail");
  }

  return (
    <div className="flex min-h-screen flex-col bg-wp-surface-2 p-3 text-[13px] leading-[18px] text-wp-text md:p-4">
      <div className="mx-auto flex w-full max-w-[1200px] flex-col overflow-hidden rounded-xl border border-wp-border bg-wp-canvas md:rounded-lg">
        <header className="flex min-h-14 flex-wrap items-center gap-x-4 border-b border-wp-border bg-wp-surface px-4 md:px-6">
          <div className="flex items-center gap-3 py-3 md:py-0">
            <span className="text-[15px] font-bold">Waypoint</span>
            <span className="flex items-center gap-2 text-xs text-wp-text-2">
              <BrandMonogram brand="fresh" outlet="Pettah" />
            </span>
          </div>

          <ScreenSwitcher
            screens={SCREENS}
            current={screen}
            onChange={setScreen}
            variant="inline"
            className="order-last w-full self-stretch border-t border-wp-border md:order-none md:w-auto md:min-w-0 md:flex-1 md:border-t-0"
          />

          <div className="ml-auto flex items-center gap-4 py-3 md:py-0">
            <span className="hidden text-[11px] text-wp-muted lg:block">Updated Tue 29 Sep 17:30</span>
            <SyncIndicator state="synced">Synced 17:30</SyncIndicator>
          </div>
        </header>

        <main className="flex flex-col gap-6 px-4 pt-6 pb-16 md:px-6 md:pb-12">
          {screen === "deliveries" && (
            <Deliveries
              receiptNote={receiptNote(receipt)}
              onOpenOrder={openOrder}
              onNavigate={setScreen}
            />
          )}
          {screen === "order" && <PlaceOrder onBack={toDeliveries} />}
          {screen === "detail" && <OrderDetail orderId={orderId} onBack={toDeliveries} />}
          {screen === "confirm" && (
            <ConfirmDelivery receipt={receipt} onConfirm={setReceipt} onBack={toDeliveries} />
          )}
        </main>
      </div>
    </div>
  );
}

/** What S1 says about today's delivery once S4 has confirmed it. */
function receiptNote(receipt: Receipt | null) {
  if (!receipt) return null;
  const count = receipt.issues.length;
  if (count === 0) return "Nothing reported.";
  const references = receipt.issues.map((issue) => issue.reference).join(", ");
  return count === 1 ? `1 issue reported, reference ${references}.` : `${count} issues reported, references ${references}.`;
}
