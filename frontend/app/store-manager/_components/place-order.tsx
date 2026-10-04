"use client";

import { useState } from "react";
import { Button, Stepper } from "@/components/waypoint/controls";
import { Banner, StatusPill } from "@/components/waypoint/status";
import { cn } from "@/lib/utils";
import { DRY_GOODS, ORDER_DETAILS, type OrderId } from "./data";
import { storeLayout } from "./layout";
import { LinkButton } from "./link-button";

const COLLAPSED_LINES = 5;

/**
 * S2 · Place order, and the same screen in change mode.
 *
 * A new order starts from the usual dry grocery order. Changing an existing order starts from
 * what is on it today, so the steppers show the quantities the warehouse currently holds.
 * The parent remounts this screen when `editing` changes, so the quantities always match.
 */
export function PlaceOrder({ editing, onBack }: { editing: OrderId | null; onBack: () => void }) {
  const order = editing ? ORDER_DETAILS[editing] : null;
  const catalogue = order ? order.lines.map((line) => ({ name: line.name, usual: line.qty })) : DRY_GOODS;
  const baseline = catalogue.map((line) => line.usual);

  const [qty, setQty] = useState(baseline);
  const [search, setSearch] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [saved, setSaved] = useState(false);
  const [offline, setOffline] = useState(false);
  const [draftNote, setDraftNote] = useState("");

  const lineCount = qty.filter((q) => q > 0).length;
  const totalQty = qty.reduce((sum, q) => sum + q, 0);
  const changed = qty.some((q, i) => q !== baseline[i]);
  const category = order ? order.category : "Dry groceries";
  const cutoff = order ? order.change.cutoff : "Wed 30 Sep 16:00";

  // Lines keep their index into `qty`, so filtering never moves a quantity to another item.
  const term = search.trim().toLowerCase();
  const matches = catalogue.map((line, index) => ({ line, index })).filter(({ line }) =>
    line.name.toLowerCase().includes(term),
  );
  const searching = term.length > 0;
  const visible = searching || showAll ? matches : matches.slice(0, COLLAPSED_LINES);
  const hidden = catalogue.length - COLLAPSED_LINES;

  if (saved) {
    return (
      <div className={cn(storeLayout.card, "flex flex-col gap-4 p-4 md:p-6")}>
        <div>
          <StatusPill state="good">{order ? "Order updated" : "Order placed"}</StatusPill>
        </div>
        <div>
          <div className="text-[11px] font-semibold tracking-[.06em] text-wp-muted">
            {order ? "ORDER" : "CONFIRMATION NUMBER"}
          </div>
          <div className="text-3xl leading-8 font-bold tabular-nums">{order ? order.id : "FP-4431"}</div>
        </div>
        <div className="text-[13px] leading-[18px]">
          {order ? (
            <>
              {category} for {order.delivery}. {lineCount} lines, {totalQty} units. Dispatch has the change and the
              warehouse picks from the new list.
            </>
          ) : (
            <>
              Scheduled for Thu 1 Oct. {lineCount} lines, {totalQty} units. Your arrival window appears after the
              16:00 cutoff on Wed 30 Sep.
            </>
          )}
        </div>
        <div className="flex flex-wrap gap-3">
          <Button className={storeLayout.button} onClick={onBack}>
            Back to Deliveries
          </Button>
          <Button variant="secondary" className={storeLayout.button} onClick={() => setSaved(false)}>
            {order ? "Keep changing" : "Change order"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          {order && (
            <LinkButton onClick={onBack} className="no-underline">
              ← Deliveries
            </LinkButton>
          )}
          <h1 className={storeLayout.h1}>{order ? `Change order ${order.id}` : "Place order"}</h1>
          <div className="text-[13px] text-wp-text-2">
            {order ? `${category} · Delivery ${order.delivery} · Fresh Pettah` : "Delivery Thu 1 Oct · Fresh Pettah"}
          </div>
        </div>
        <StatusPill state="info">Closes {cutoff} · 22 h 30 min left</StatusPill>
      </div>

      {offline && (
        <Banner state="offline">
          You’re offline. {order ? "The change is not saved" : "The order is not placed"} until a confirmation
          appears. Save it as a draft and send it when you’re back online.
        </Banner>
      )}

      <div className={cn("grid items-start gap-6", storeLayout.colsMain)}>
        <div className="flex min-w-0 flex-col gap-4">
          <section className={cn(storeLayout.card, "flex flex-col gap-3 p-4")}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-[15px] font-semibold">{category}</h2>
              <button
                type="button"
                onClick={() => setQty(baseline)}
                className="h-8 cursor-pointer rounded-2xl border border-wp-border bg-wp-surface-2 px-3 text-xs font-semibold text-wp-text"
              >
                {order ? "Reset to current order" : "Repeat last order"}
              </button>
            </div>
            <div className="text-xs text-wp-muted">
              {order
                ? "Pre-filled from what is on this order now. Change only what differs."
                : "Pre-filled from your usual order. Change only what differs."}
            </div>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search your items"
              aria-label="Search your items"
              className={cn(
                "rounded-md border border-wp-border bg-wp-surface px-3 text-[13px] text-wp-text",
                storeLayout.inputHeight,
              )}
            />
            <div>
              {visible.map(({ line, index }) => (
                <div
                  key={line.name}
                  className={cn(
                    "flex flex-wrap items-center justify-between gap-3 border-t border-wp-border py-2",
                    storeLayout.rowHeight,
                  )}
                >
                  <div className="min-w-40 flex-1">
                    <div className="text-[13px] font-semibold">{line.name}</div>
                    <div className="text-[11px] text-wp-muted">
                      {order ? "Now" : "Usual"} {line.usual}
                      {qty[index] !== line.usual && (
                        <span className="ml-2 font-semibold text-wp-action">Changed to {qty[index]}</span>
                      )}
                    </div>
                  </div>
                  <Stepper
                    label={line.name}
                    value={qty[index]}
                    onChange={(v) => setQty((q) => q.map((x, j) => (j === index ? Math.max(0, v) : x)))}
                  />
                </div>
              ))}
              {visible.length === 0 && (
                <div className="border-t border-wp-border py-3 text-[13px] text-wp-text-2">
                  No item matches “{search.trim()}”.
                </div>
              )}
            </div>
            {!searching && hidden > 0 && (
              <LinkButton onClick={() => setShowAll(!showAll)}>
                {showAll ? "Show fewer lines" : `Show ${hidden} more lines`}
              </LinkButton>
            )}
          </section>

          {!order && (
            <section className={cn(storeLayout.card, "flex flex-col gap-2 p-4")}>
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-[15px] font-semibold">Chilled</h2>
                <StatusPill state="offline">Nothing due</StatusPill>
              </div>
              <div className="text-[13px] leading-[18px] text-wp-text-2">
                Your chilled days are Mon, Wed and Fri. Thu 1 Oct is not one of them. Your chilled order FP-4418,
                moved from Wed 30 Sep, is already scheduled for Thu 1 Oct.
              </div>
            </section>
          )}
        </div>

        <aside className={cn(storeLayout.card, "flex flex-col gap-3 p-4")}>
          <h2 className="text-[15px] font-semibold">Summary</h2>
          <div className="flex justify-between gap-2 text-[13px]">
            <span>{category}</span>
            <span className="tabular-nums">
              {lineCount} lines · {totalQty} units
            </span>
          </div>
          {order ? (
            <div className="flex justify-between gap-2 text-[13px]">
              <span>Changed lines</span>
              <span className="tabular-nums">{qty.filter((q, i) => q !== baseline[i]).length}</span>
            </div>
          ) : (
            <div className="flex justify-between gap-2 text-[13px]">
              <span>Chilled</span>
              <span className="text-wp-muted">None</span>
            </div>
          )}
          <div className="border-t border-wp-border pt-3 text-[13px] leading-[18px] text-wp-text-2">
            {order
              ? `We send the change to the warehouse when you save it. You can keep changing this order until the ${cutoff} cutoff.`
              : "We send this order to the warehouse when you place it. Your arrival window appears after the 16:00 cutoff on Wed 30 Sep. An order placed after 16:00 joins the Fri 2 Oct run."}
          </div>
          <Button
            className="min-h-14 w-full text-base"
            disabled={Boolean(order) && !changed}
            onClick={() =>
              offline
                ? setDraftNote(
                    order
                      ? "Not saved. You’re offline. The warehouse still has the old list."
                      : "Not placed. You’re offline. No confirmation number yet.",
                  )
                : setSaved(true)
            }
          >
            {order ? "Save changes" : "Place order"}
          </Button>
          <Button
            variant="secondary"
            className={cn("w-full", storeLayout.button)}
            onClick={() =>
              order
                ? onBack()
                : setDraftNote("Draft saved at 17:31. The order is not placed until a confirmation number appears.")
            }
          >
            {order ? "Discard changes" : "Save draft"}
          </Button>
          <div className="min-h-4 text-xs text-wp-muted">
            {draftNote || (order && !changed ? "Nothing changed yet." : "")}
          </div>
          <label className="flex items-center gap-2 text-xs text-wp-text-2">
            <input
              type="checkbox"
              checked={offline}
              onChange={() => {
                setOffline(!offline);
                setDraftNote("");
              }}
            />{" "}
            Preview offline state
          </label>
        </aside>
      </div>
    </>
  );
}
