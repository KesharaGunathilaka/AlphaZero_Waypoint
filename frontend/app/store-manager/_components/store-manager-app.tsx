"use client";

import { useState } from "react";
import { BrandMonogram } from "@/components/waypoint/data";
import { Logo } from "@/components/waypoint/logo";
import { ScreenSwitcher } from "@/components/waypoint/screen-switcher";
import { SyncIndicator } from "@/components/waypoint/status";
import { ConfirmDelivery, type Receipt } from "./confirm-delivery";
import { Deliveries } from "./deliveries";
import { OrderDetail } from "./order-detail";
import { PlaceOrder } from "./place-order";

const SCREENS = [
  ["deliveries", "S1 · Deliveries"],
  ["order", "S2 · Place order"],
  ["detail", "S3 · Order detail"],
  ["confirm", "S4 · Confirm delivery"],
] as const;
export type StoreScreen = (typeof SCREENS)[number][0];

export function StoreManagerApp() {
  const [screen, setScreen] = useState<StoreScreen>("deliveries");
  const [receipt, setReceipt] = useState<Receipt | null>(null);

  const toDeliveries = () => setScreen("deliveries");

  return (
    <div className="flex min-h-screen flex-col items-center gap-3 bg-wp-surface-2 p-3 text-[13px] leading-[18px] text-wp-text md:gap-4 md:p-4">
      <ScreenSwitcher
        screens={SCREENS}
        current={screen}
        onChange={setScreen}
        className="w-full max-w-[1200px]"
      />

      <div className="relative flex w-full max-w-[1200px] flex-col overflow-hidden rounded-xl border border-wp-border bg-wp-canvas md:rounded-lg">
        <header className="flex min-h-14 flex-wrap items-center gap-x-4 gap-y-1 border-b border-wp-border bg-wp-surface px-4 py-3 md:px-6 md:py-0">
          <Logo />
          <div className="flex items-center gap-2 text-xs text-wp-text-2">
            <BrandMonogram brand="fresh" outlet="Pettah" />
          </div>
          <div className="flex-1" />
          <div className="hidden text-[11px] text-wp-muted sm:block">Updated Tue 29 Sep 17:30</div>
          <SyncIndicator state="synced">Synced 17:30</SyncIndicator>
        </header>

        <main className="flex flex-col gap-6 px-4 pt-6 pb-24 md:px-6 md:pb-8">
          {screen === "deliveries" && (
            <Deliveries
              receiptNote={
                receipt && (receipt.issue ? "1 issue reported, reference IS-7720." : "Nothing reported.")
              }
              onNavigate={setScreen}
            />
          )}
          {screen === "order" && <PlaceOrder onBack={toDeliveries} />}
          {screen === "detail" && <OrderDetail onBack={toDeliveries} />}
          {screen === "confirm" && (
            <ConfirmDelivery receipt={receipt} onConfirm={setReceipt} onBack={toDeliveries} />
          )}
        </main>
      </div>
    </div>
  );
}
