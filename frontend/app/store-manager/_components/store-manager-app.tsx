"use client";

import { useState } from "react";
import { BrandMonogram } from "@/components/waypoint/data";
import { ScreenSwitcher, SwitcherButton } from "@/components/waypoint/screen-switcher";
import { SyncIndicator } from "@/components/waypoint/status";
import { cn } from "@/lib/utils";
import { ConfirmDelivery, type Receipt } from "./confirm-delivery";
import { Deliveries } from "./deliveries";
import { storeLayout } from "./layout";
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
  const [phone, setPhone] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);

  const layout = storeLayout(phone);
  const toDeliveries = () => setScreen("deliveries");

  return (
    <div className="flex min-h-screen flex-col items-center gap-4 bg-wp-surface-2 p-4 text-[13px] leading-[18px] text-wp-text">
      <ScreenSwitcher screens={SCREENS} current={screen} onChange={setScreen}>
        <span className="mx-1 h-5 w-px bg-wp-border" />
        <SwitcherButton active={!phone} onClick={() => setPhone(false)}>
          Desktop
        </SwitcherButton>
        <SwitcherButton active={phone} onClick={() => setPhone(true)}>
          Phone
        </SwitcherButton>
      </ScreenSwitcher>

      <div
        className={cn(
          "relative flex max-w-full flex-col overflow-hidden border border-wp-border bg-wp-canvas",
          phone ? "w-[390px] rounded-xl" : "w-[1200px] rounded-lg",
        )}
      >
        <header
          className={cn(
            "flex min-h-14 flex-wrap items-center gap-4 border-b border-wp-border bg-wp-surface",
            phone ? "px-4" : "px-6",
          )}
        >
          <div className="text-[15px] font-bold">Waypoint</div>
          <div className="flex items-center gap-2 text-xs text-wp-text-2">
            <BrandMonogram brand="fresh" outlet="Pettah" />
          </div>
          <div className="flex-1" />
          <div className="text-[11px] text-wp-muted">Updated Tue 29 Sep 17:30</div>
          <SyncIndicator state="synced">Synced 17:30</SyncIndicator>
        </header>

        <main className={cn("flex flex-col gap-6 pt-6", phone ? "px-4 pb-24" : "px-6 pb-8")}>
          {screen === "deliveries" && (
            <Deliveries
              layout={layout}
              receiptNote={
                receipt && (receipt.issue ? "1 issue reported, reference IS-7720." : "Nothing reported.")
              }
              onNavigate={setScreen}
            />
          )}
          {screen === "order" && <PlaceOrder layout={layout} onBack={toDeliveries} />}
          {screen === "detail" && <OrderDetail layout={layout} onBack={toDeliveries} />}
          {screen === "confirm" && (
            <ConfirmDelivery layout={layout} receipt={receipt} onConfirm={setReceipt} onBack={toDeliveries} />
          )}
        </main>
      </div>
    </div>
  );
}
