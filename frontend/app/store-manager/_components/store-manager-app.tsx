"use client";

import { CheckSquare, ClipboardList, ShoppingCart } from "lucide-react";
import { useState } from "react";
import { AccountButton } from "@/components/waypoint/account-button";
import { BrandMonogram } from "@/components/waypoint/data";
import { Logo } from "@/components/waypoint/logo";
import { Banner, SyncIndicator } from "@/components/waypoint/status";
import { useApiData } from "@/lib/api/use-api";
import { cn } from "@/lib/utils";
import { ConfirmDelivery, type Receipt } from "./confirm-delivery";
import { BRAND, type Outlet, type StoreOrder, type Temp } from "./data";
import { Deliveries } from "./deliveries";
import { OrderDetail } from "./order-detail";
import { PlaceOrder } from "./place-order";

export type StoreScreen = "deliveries" | "order" | "detail" | "confirm";

/** Three things a store manager does: see what is coming, order, confirm what arrived. Order detail opens from a delivery. */
const NAV = [
  { key: "deliveries", label: "Deliveries", Icon: ClipboardList },
  { key: "order", label: "Order", Icon: ShoppingCart },
  { key: "confirm", label: "Confirm", Icon: CheckSquare },
] as const;

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

  const toConfirm = list.filter((o) => o.needs_receipt).length;
  const active = screen === "detail" ? "deliveries" : screen;

  return (
    <div className="flex min-h-screen flex-col bg-wp-surface-2 text-[13px] leading-[18px] text-wp-text md:p-4">
      <div className="mx-auto flex w-full max-w-[1200px] flex-1 flex-col bg-wp-canvas md:flex-none md:overflow-hidden md:rounded-lg md:border md:border-wp-border">
        <header className="sticky top-0 z-20 flex min-h-14 items-center gap-x-4 border-b border-wp-border bg-wp-surface px-4 md:static md:px-6">
          <div className="flex min-w-0 items-center gap-3 py-2">
            <Logo className="h-6 md:h-7" />
            {outlet.data && (
              <span className="truncate text-xs text-wp-text-2">
                <BrandMonogram brand={BRAND[outlet.data.brand_code]} outlet={`${outlet.data.district} ${outlet.data.code}`} />
              </span>
            )}
          </div>

          <nav aria-label="Store sections" className="hidden h-14 items-stretch gap-1 md:flex">
            {NAV.map(({ key, label }) => (
              <button key={key} type="button" onClick={() => goTo(key)} aria-current={active === key ? "page" : undefined}
                      className={cn("flex cursor-pointer items-center gap-2 border-b-[3px] px-3 text-[14px] font-semibold",
                                    active === key ? "border-wp-action text-wp-action" : "border-transparent text-wp-text-2 hover:text-wp-text")}>
                {label}
                {key === "confirm" && toConfirm > 0 && <span className="rounded-full bg-wp-warn-tint px-2 text-[11px] text-wp-warn">{toConfirm}</span>}
              </button>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <span className="hidden sm:inline">
              {orders.error ? (
                <SyncIndicator state="retrying">Can’t reach Waypoint</SyncIndicator>
              ) : (
                <SyncIndicator state={orders.loading ? "sending" : "synced"}>{orders.loading ? "Updating…" : "Up to date"}</SyncIndicator>
              )}
            </span>
            <AccountButton />
          </div>
        </header>

        <main className="flex flex-col gap-6 px-4 pt-5 pb-24 md:px-6 md:pt-6 md:pb-12">
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

      {/* Phone: the three sections sit under the thumb. */}
      <nav aria-label="Store sections" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-3 border-t border-wp-border bg-wp-surface pb-[env(safe-area-inset-bottom)] md:hidden">
        {NAV.map(({ key, label, Icon }) => (
          <button key={key} type="button" onClick={() => goTo(key)} aria-current={active === key ? "page" : undefined}
                  className={cn("relative flex h-16 cursor-pointer flex-col items-center justify-center gap-1 text-[12px] font-semibold",
                                active === key ? "text-wp-action" : "text-wp-text-2")}>
            <Icon aria-hidden className="size-6" />
            {label}
            {key === "confirm" && toConfirm > 0 && (
              <span className="absolute top-2 right-[calc(50%-22px)] rounded-full bg-wp-crit px-1.5 text-[11px] leading-4 text-white">{toConfirm}</span>
            )}
            {active === key && <span className="absolute inset-x-6 top-0 h-[3px] rounded-b bg-wp-action" />}
          </button>
        ))}
      </nav>
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
