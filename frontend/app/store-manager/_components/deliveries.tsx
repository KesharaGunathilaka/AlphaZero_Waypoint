"use client";

import { useState } from "react";
import { Button } from "@/components/waypoint/controls";
import { Eyebrow } from "@/components/waypoint/data";
import { Banner, StatusPill } from "@/components/waypoint/status";
import { useApiData } from "@/lib/api/use-api";
import { formatDay, formatDayTime, formatLongDay, formatTime, plural, timeLeft, todayIso } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  arrivalWindow,
  categoryName,
  isMoved,
  orderKind,
  orderPill,
  unloadNote,
  type OrderSlot,
  type Outlet,
  type StoreOrder,
  type Temp,
} from "./data";
import { storeLayout } from "./layout";
import { LinkButton } from "./link-button";
import { ChangeOrderAction } from "./order-actions";

const DONE: StoreOrder["status"][] = ["received", "not_delivered"];

/** S1 · Deliveries: what needs the manager now, the next deliveries and the next order cutoff. */
export function Deliveries({
  outlet,
  orders,
  receiptNote,
  onOpenOrder,
  onChangeOrder,
  onPlaceOrder,
  onConfirm,
}: {
  outlet: Outlet;
  orders: StoreOrder[];
  /** Set once a delivery has been confirmed in S4. */
  receiptNote: string | null;
  onOpenOrder: (id: number) => void;
  onChangeOrder: (order: StoreOrder) => void;
  onPlaceOrder: (temp: Temp) => void;
  onConfirm: () => void;
}) {
  const toReceive = orders.find((o) => o.needs_receipt);
  const today = todayIso();

  // The next day this store expects goods: an open order's date, or the day a moved order was due.
  const open = orders.filter((o) => !DONE.includes(o.status) && !o.needs_receipt);
  const expectedDay = (o: StoreOrder) => (isMoved(o) ? o.moved_from! : o.delivery_date);
  const nextDay = open.map(expectedDay).filter((d) => d >= today).sort()[0];
  const nextCards = nextDay ? open.filter((o) => expectedDay(o) === nextDay || o.delivery_date === nextDay) : [];
  const recent = orders.filter((o) => DONE.includes(o.status) || o.needs_receipt).slice(0, 6);
  const temps: Temp[] = outlet.brand_code === "F" ? ["ambient", "chilled"] : ["ambient"];

  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className={storeLayout.h1}>Deliveries</h1>
        <div className="text-[13px] text-wp-text-2">
          {outlet.name} · {formatLongDay(today)} {today.slice(0, 4)}
        </div>
      </div>

      {toReceive ? (
        <div className={cn("flex flex-col gap-3 border border-wp-warn bg-wp-warn-tint p-4", storeLayout.radius)}>
          <div className="text-[11px] font-semibold tracking-[.06em] text-wp-warn">▲ NEEDS YOU</div>
          <div className="text-xl leading-[26px] font-semibold">
            {orderKind(toReceive)} arrived{toReceive.delivered_at ? ` at ${formatTime(toReceive.delivered_at)}` : ""}.
            Confirm receipt.
          </div>
          <div className="text-[13px] leading-[18px]">
            {toReceive.status === "delivered_in_part"
              ? "The driver recorded a part delivery. Check what arrived line by line."
              : "Check what arrived against what the driver recorded, and report anything missing or damaged."}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button className={storeLayout.button} onClick={onConfirm}>
              Confirm receipt
            </Button>
            <span className="text-xs text-wp-text-2">Order {toReceive.confirmation_no}</span>
          </div>
        </div>
      ) : (
        receiptNote && <Banner state="good">Receipt confirmed. {receiptNote}</Banner>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-[15px] font-semibold">{nextDay ? `Next delivery · ${formatDay(nextDay)}` : "Next delivery"}</h2>
        {nextCards.length === 0 && (
          <div className={cn(storeLayout.card, "p-4 text-[13px] text-wp-text-2")}>
            No deliveries planned. Place an order before the 16:00 cutoff for the next operating day.
          </div>
        )}
        <div className={cn("grid gap-4", storeLayout.cols2)}>
          {nextCards.map((order) =>
            isMoved(order) && order.moved_from === nextDay ? (
              <MovedCard key={order.order_id} order={order} onOpenOrder={onOpenOrder} onChangeOrder={onChangeOrder} />
            ) : (
              <ScheduledCard key={order.order_id} order={order} onOpenOrder={onOpenOrder} onChangeOrder={onChangeOrder} />
            ),
          )}
        </div>
      </section>

      {temps.map((temp) => (
        <NextOrderCard key={temp} temp={temp} brand={outlet.brand_code} onPlaceOrder={onPlaceOrder}
                       onOpenOrder={onOpenOrder} />
      ))}

      <RecentDeliveries orders={recent} onOpenOrder={onOpenOrder} />
    </>
  );
}

function ScheduledCard({
  order,
  onOpenOrder,
  onChangeOrder,
}: {
  order: StoreOrder;
  onOpenOrder: (id: number) => void;
  onChangeOrder: (order: StoreOrder) => void;
}) {
  const pill = orderPill(order);
  const window = arrivalWindow(order);
  return (
    <div className={cn(storeLayout.card, "flex flex-col gap-3 p-4")}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-[15px] font-semibold">{orderKind(order)}</div>
        <StatusPill state={pill.state}>{pill.label}</StatusPill>
      </div>
      <div>
        <div className="text-[11px] font-semibold tracking-[.06em] text-wp-muted">ARRIVAL WINDOW</div>
        {window ? (
          <div className="text-3xl leading-8 font-bold tabular-nums">{window}</div>
        ) : (
          <div className="text-[15px] leading-[22px] font-semibold text-wp-text-2">After the 16:00 cutoff</div>
        )}
      </div>
      <div className="text-[13px] leading-[18px] text-wp-text-2">
        {unloadNote(order.unload)}. {plural(order.lines?.length ?? 0, "line")}.{" "}
        {order.status === "on_the_way" && order.stops_before_yours !== null
          ? `${plural(order.stops_before_yours, "stop")} before yours.`
          : window
            ? "The plan is released."
            : "Your arrival window appears when dispatch releases the plan."}
      </div>
      <ChangeOrderAction order={order} onChangeOrder={onChangeOrder} className="mt-auto" />
      <div className="flex justify-between gap-2 text-xs text-wp-muted">
        <span>Order {order.confirmation_no}</span>
        <LinkButton onClick={() => onOpenOrder(order.order_id)}>Details</LinkButton>
      </div>
    </div>
  );
}

function MovedCard({
  order,
  onOpenOrder,
  onChangeOrder,
}: {
  order: StoreOrder;
  onOpenOrder: (id: number) => void;
  onChangeOrder: (order: StoreOrder) => void;
}) {
  return (
    <div className={cn("flex flex-col gap-3 border border-wp-warn bg-wp-warn-tint p-4", storeLayout.radius)}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-[15px] font-semibold">{orderKind(order)}</div>
        <StatusPill state="warn">Moved</StatusPill>
      </div>
      <div className="text-xl leading-[26px] font-semibold text-wp-warn">
        Not arriving on {formatLongDay(order.moved_from!).split(" ")[0]}
      </div>
      <div className="text-[13px] leading-[18px]">
        {order.moved_reason} It will come on <b>{formatDay(order.moved_to!)}</b>. Plan {formatLongDay(order.moved_from!).split(" ")[0]}’s
        {order.temp === "chilled" ? " chilled" : ""} stock without it.
        {order.moved_consecutive ? " This is a second move in a row, so it goes first on the next run." : ""}
      </div>
      <ChangeOrderAction order={order} onChangeOrder={onChangeOrder} className="mt-auto" />
      <div className="flex justify-between gap-2 text-xs text-wp-muted">
        <span>Order {order.confirmation_no}</span>
        <LinkButton onClick={() => onOpenOrder(order.order_id)}>See why and what changes</LinkButton>
      </div>
    </div>
  );
}

/** The next order this outlet can place for one temperature class, with the cutoff countdown. */
function NextOrderCard({
  temp,
  brand,
  onPlaceOrder,
  onOpenOrder,
}: {
  temp: Temp;
  brand: StoreOrder["brand_code"];
  onPlaceOrder: (temp: Temp) => void;
  onOpenOrder: (id: number) => void;
}) {
  const slot = useApiData<OrderSlot>(`/store/order-slot?temp=${temp}`, 60_000);
  if (!slot.data) return null;
  const s = slot.data;
  const placed = s.existing_order_id !== null;
  return (
    <div className={cn(storeLayout.card, "flex flex-wrap items-center justify-between gap-4 p-4")}>
      <div className="flex flex-col gap-1">
        <Eyebrow className="text-[11px]">
          Next {categoryName(brand, temp).toLowerCase()} order · for {formatDay(s.delivery_date)}
        </Eyebrow>
        <div className="text-xl leading-[26px] font-semibold">Closes {formatDayTime(s.cutoff_at)}</div>
        <div className="text-[13px] text-wp-text-2">
          {timeLeft(s.cutoff_at)}
          {s.closed_date ? ` · the ${formatDay(s.closed_date)} run has already closed` : ""}
        </div>
      </div>
      {placed ? (
        <Button variant="secondary" className={storeLayout.button} onClick={() => onOpenOrder(s.existing_order_id!)}>
          Order placed · view
        </Button>
      ) : (
        <Button variant="secondary" className={storeLayout.button} onClick={() => onPlaceOrder(temp)}>
          Place order
        </Button>
      )}
    </div>
  );
}

/** Each row opens a brief record of what arrived and what was raised against it. */
function RecentDeliveries({ orders, onOpenOrder }: { orders: StoreOrder[]; onOpenOrder: (id: number) => void }) {
  const [openOrder, setOpenOrder] = useState<number | null>(null);
  if (orders.length === 0) return null;

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-[15px] font-semibold">Recent deliveries</h2>
      <div className={cn(storeLayout.card, "overflow-hidden")}>
        {orders.map((order, i) => {
          const open = openOrder === order.order_id;
          const pill = orderPill(order);
          return (
            <div key={order.order_id} className={cn(i > 0 && "border-t border-wp-border")}>
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpenOrder(open ? null : order.order_id)}
                className={cn(
                  "flex w-full cursor-pointer items-center gap-3 px-4 py-2 text-left hover:bg-wp-surface-2",
                  storeLayout.rowHeight,
                )}
              >
                <span className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-3">
                  <span className="text-[13px] font-semibold sm:w-[84px] sm:flex-none">{formatDay(order.delivery_date)}</span>
                  <span className="min-w-0 truncate text-[13px] text-wp-text-2">
                    {orderKind(order)}, {plural(order.lines?.length ?? 0, "line")}
                  </span>
                </span>
                <StatusPill state={pill.state}>{pill.label}</StatusPill>
                <span aria-hidden="true" className={cn("text-xs text-wp-muted transition-transform", open && "rotate-180")}>
                  ▾
                </span>
              </button>
              {open && (
                <div className="flex flex-col gap-3 border-t border-wp-border bg-wp-surface-2 px-4 py-3">
                  <div className={cn("grid gap-3", storeLayout.colsReceipt)}>
                    <Fact label="ORDER" value={order.confirmation_no} />
                    <Fact label="ARRIVED" value={order.delivered_at ? formatDayTime(order.delivered_at) : "—"} />
                    <Fact label="OUTCOME" value={order.delivery_outcome?.replaceAll("_", " ") ?? "—"} />
                    <Fact label="YOU CONFIRMED" value={order.receipt_at ? formatDayTime(order.receipt_at) : "Not yet"} />
                  </div>
                  <LinkButton onClick={() => onOpenOrder(order.order_id)}>Open the full record</LinkButton>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-semibold tracking-[.06em] text-wp-muted">{label}</div>
      <div className="mt-0.5 text-[13px] font-semibold capitalize">{value}</div>
    </div>
  );
}
