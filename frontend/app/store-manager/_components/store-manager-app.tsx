"use client";

import { useState } from "react";
import { BrandMonogram } from "@/components/waypoint/data";
import { Logo } from "@/components/waypoint/logo";
import { ScreenSwitcher } from "@/components/waypoint/screen-switcher";
import { Banner, SyncIndicator } from "@/components/waypoint/status";
import { useApiData } from "@/lib/api/use-api";
import { formatTime } from "@/lib/format";
import { ConfirmDelivery, type Receipt } from "./confirm-delivery";
import { BRAND, type Outlet, type StoreOrder, type Temp } from "./data";
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

/** What the order screen is doing: a new order of one temperature class, or changing an existing one. */
export type OrderIntent = { temp: Temp; editing: StoreOrder | null };

export function StoreManagerApp() {
  const outlet = useApiData<Outlet>("/store/outlet");
  const orders = useApiData<StoreOrder[]>("/store/orders", 30_000);

  const [screen, setScreen] = useState<StoreScreen>("deliveries");
  const [orderId, setOrderId] = useState<number | null>(null);
  const [intent, setIntent] = useState<OrderIntent>({ temp: "ambient", editing: null });
  const [receipt, setReceipt] = useState<Receipt | null>(null);

  const list = orders.data ?? [];
  const toReceive = list.find((o) => o.needs_receipt) ?? null;
  const shownOrderId = orderId ?? list[0]?.order_id ?? null;
  const confirmId = receipt?.orderId ?? toReceive?.order_id ?? null;

  function goTo(next: StoreScreen) {
    if (next === "order") setIntent({ temp: "ambient", editing: null });
    if (next === "confirm") setReceipt(null);
    setScreen(next);
  }

  function openOrder(id: number) {
    setOrderId(id);
    setScreen("detail");
  }

  function placeOrder(temp: Temp) {
    setIntent({ temp, editing: null });
    setScreen("order");
  }

  function changeOrder(order: StoreOrder) {
    setIntent({ temp: order.temp, editing: order });
    setScreen("order");
  }

  async function backToDeliveries() {
    setScreen("deliveries");
    await orders.reload();
  }

  return (
    <div className="flex min-h-screen flex-col bg-wp-surface-2 p-3 text-[13px] leading-[18px] text-wp-text md:p-4">
      <div className="mx-auto flex w-full max-w-[1200px] flex-col overflow-hidden rounded-xl border border-wp-border bg-wp-canvas md:rounded-lg">
        <header className="flex min-h-14 flex-wrap items-center gap-x-4 border-b border-wp-border bg-wp-surface px-4 md:px-6">
          <div className="flex items-center gap-3 py-3 md:py-0">
            <Logo className="h-6 md:h-7" />
            {outlet.data && (
              <span className="flex items-center gap-2 text-xs text-wp-text-2">
                <BrandMonogram brand={BRAND[outlet.data.brand_code]} outlet={`${outlet.data.district} ${outlet.data.code}`} />
              </span>
            )}
          </div>

          <ScreenSwitcher
            screens={SCREENS}
            current={screen}
            onChange={goTo}
            variant="inline"
            className="order-last w-full self-stretch border-t border-wp-border md:order-none md:w-auto md:min-w-0 md:flex-1 md:border-t-0"
          />

          <div className="ml-auto flex items-center gap-4 py-3 md:py-0">
            {orders.error ? (
              <SyncIndicator state="retrying">Can’t reach Waypoint</SyncIndicator>
            ) : (
              <SyncIndicator state={orders.loading ? "sending" : "synced"}>
                {orders.loading ? "Updating…" : `Updated ${formatTime(new Date())}`}
              </SyncIndicator>
            )}
          </div>
        </header>

        <main className="flex flex-col gap-6 px-4 pt-6 pb-16 md:px-6 md:pb-12">
          {(outlet.error || (orders.error && !orders.data)) && (
            <Banner state="crit" action="Try again" onAction={() => { void outlet.reload(); void orders.reload(); }}>
              {outlet.error ?? orders.error}
            </Banner>
          )}
          {!outlet.data || !orders.data ? (
            !outlet.error && !orders.error && <div className="text-[13px] text-wp-text-2">Loading your deliveries…</div>
          ) : (
            <>
              {screen === "deliveries" && (
                <Deliveries
                  outlet={outlet.data}
                  orders={list}
                  receiptNote={receipt ? receiptNote(receipt) : null}
                  onOpenOrder={openOrder}
                  onChangeOrder={changeOrder}
                  onPlaceOrder={placeOrder}
                  onConfirm={() => goTo("confirm")}
                />
              )}
              {screen === "order" && (
                <PlaceOrder
                  key={`${intent.temp}-${intent.editing?.order_id ?? "new"}`}
                  outlet={outlet.data}
                  intent={intent}
                  onChangeIntent={setIntent}
                  onBack={backToDeliveries}
                />
              )}
              {screen === "detail" &&
                (shownOrderId === null ? (
                  <div className="text-[13px] text-wp-text-2">No orders yet.</div>
                ) : (
                  <OrderDetail
                    key={shownOrderId}
                    orderId={shownOrderId}
                    outlet={outlet.data}
                    onChangeOrder={changeOrder}
                    onBack={backToDeliveries}
                  />
                ))}
              {screen === "confirm" &&
                (confirmId === null ? (
                  <div className="flex flex-col gap-3">
                    <Banner state="good">Nothing is waiting for you to confirm.</Banner>
                  </div>
                ) : (
                  <ConfirmDelivery
                    key={confirmId}
                    orderId={confirmId}
                    receipt={receipt}
                    onConfirm={(r) => { setReceipt(r); void orders.reload(); }}
                    onBack={backToDeliveries}
                  />
                ))}
            </>
          )}
        </main>
      </div>
    </div>
  );
}

/** What S1 says about the delivery once S4 has confirmed it. */
function receiptNote(receipt: Receipt) {
  const count = receipt.issues.length;
  if (count === 0) return "Nothing reported.";
  const references = receipt.issues.map((issue) => issue.reference).join(", ");
  return count === 1
    ? `1 issue reported, reference ${references}.`
    : `${count} issues reported, references ${references}.`;
}
