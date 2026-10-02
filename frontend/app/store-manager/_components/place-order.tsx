"use client";

import { useState } from "react";
import { Button, Stepper } from "@/components/waypoint/controls";
import { Banner, StatusPill } from "@/components/waypoint/status";
import { cn } from "@/lib/utils";
import { DRY_GOODS } from "./data";
import type { StoreLayout } from "./layout";
import { LinkButton } from "./link-button";

const COLLAPSED_LINES = 5;
const USUAL_ORDER = DRY_GOODS.map((g) => g.usual);

/** S2 · Place order: pre-filled from the usual order, change only what differs. */
export function PlaceOrder({ layout, onBack }: { layout: StoreLayout; onBack: () => void }) {
  const [qty, setQty] = useState(USUAL_ORDER);
  const [showAll, setShowAll] = useState(false);
  const [placed, setPlaced] = useState(false);
  const [offline, setOffline] = useState(false);
  const [draftNote, setDraftNote] = useState("");

  const lineCount = qty.filter((q) => q > 0).length;
  const totalQty = qty.reduce((sum, q) => sum + q, 0);
  const visible = showAll ? DRY_GOODS : DRY_GOODS.slice(0, COLLAPSED_LINES);

  if (placed) {
    return (
      <div className={cn(layout.card, "flex flex-col gap-4 p-6")}>
        <div>
          <StatusPill state="good">Order placed</StatusPill>
        </div>
        <div>
          <div className="text-[11px] font-semibold tracking-[.06em] text-wp-muted">CONFIRMATION NUMBER</div>
          <div className="text-3xl leading-8 font-bold tabular-nums">FP-4431</div>
        </div>
        <div className="text-[13px] leading-[18px]">
          Scheduled for Thu 1 Oct. {lineCount} lines, {totalQty} units. Your arrival window appears after the 16:00
          cutoff on Wed 30 Sep.
        </div>
        <div className="flex flex-wrap gap-3">
          <Button className={layout.button} onClick={onBack}>
            Back to Deliveries
          </Button>
          <Button variant="secondary" className={layout.button} onClick={() => setPlaced(false)}>
            Change order
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className={layout.h1}>Place order</h1>
          <div className="text-[13px] text-wp-text-2">Delivery Thu 1 Oct · Fresh Pettah</div>
        </div>
        <StatusPill state="info">Closes Wed 30 Sep 16:00 · 22 h 30 min left</StatusPill>
      </div>

      {offline && (
        <Banner state="offline">
          You’re offline. The order is not placed until a confirmation number appears. Save it as a draft and place
          it when you’re back online.
        </Banner>
      )}

      <div className={cn("grid items-start gap-6", layout.colsMain)}>
        <div className="flex min-w-0 flex-col gap-4">
          <section className={cn(layout.card, "flex flex-col gap-3 p-4")}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-[15px] font-semibold">Dry groceries</h2>
              <button
                type="button"
                onClick={() => setQty(USUAL_ORDER)}
                className="h-8 cursor-pointer rounded-2xl border border-wp-border bg-wp-surface-2 px-3 text-xs font-semibold text-wp-text"
              >
                Repeat last order
              </button>
            </div>
            <div className="text-xs text-wp-muted">Pre-filled from your usual order. Change only what differs.</div>
            <input
              placeholder="Search to add an item"
              aria-label="Search to add an item"
              className={cn(
                "rounded-md border border-wp-border bg-wp-surface px-3 text-[13px] text-wp-text",
                layout.inputHeight,
              )}
            />
            <div>
              {visible.map((line, i) => (
                <div
                  key={line.name}
                  className={cn("flex items-center gap-3 border-t border-wp-border py-2", layout.rowHeight)}
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-semibold">{line.name}</div>
                    <div className="text-[11px] text-wp-muted">Usual {line.usual}</div>
                  </div>
                  <Stepper
                    label={line.name}
                    value={qty[i]}
                    onChange={(v) => setQty((q) => q.map((x, j) => (j === i ? Math.max(0, v) : x)))}
                  />
                </div>
              ))}
            </div>
            <LinkButton onClick={() => setShowAll(!showAll)}>
              {showAll ? "Show fewer lines" : `Show ${DRY_GOODS.length - COLLAPSED_LINES} more lines`}
            </LinkButton>
          </section>

          <section className={cn(layout.card, "flex flex-col gap-2 p-4")}>
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-[15px] font-semibold">Chilled</h2>
              <StatusPill state="offline">Nothing due</StatusPill>
            </div>
            <div className="text-[13px] leading-[18px] text-wp-text-2">
              Your chilled days are Mon, Wed and Fri. Thu 1 Oct is not one of them. Your chilled order FP-4418, moved
              from Wed 30 Sep, is already scheduled for Thu 1 Oct.
            </div>
          </section>
        </div>

        <aside className={cn(layout.card, "flex flex-col gap-3 p-4")}>
          <h2 className="text-[15px] font-semibold">Summary</h2>
          <div className="flex justify-between text-[13px]">
            <span>Dry groceries</span>
            <span className="tabular-nums">
              {lineCount} lines · {totalQty} units
            </span>
          </div>
          <div className="flex justify-between text-[13px]">
            <span>Chilled</span>
            <span className="text-wp-muted">None</span>
          </div>
          <div className="border-t border-wp-border pt-3 text-[13px] leading-[18px] text-wp-text-2">
            We send this order to the warehouse when you place it. Your arrival window appears after the 16:00 cutoff
            on Wed 30 Sep. An order placed after 16:00 joins the Fri 2 Oct run.
          </div>
          <Button
            className="h-14 w-full text-base"
            onClick={() =>
              offline ? setDraftNote("Not placed. You’re offline. No confirmation number yet.") : setPlaced(true)
            }
          >
            Place order
          </Button>
          <Button
            variant="secondary"
            className={cn("w-full", layout.button)}
            onClick={() =>
              setDraftNote("Draft saved at 17:31. The order is not placed until a confirmation number appears.")
            }
          >
            Save draft
          </Button>
          <div className="min-h-4 text-xs text-wp-muted">{draftNote}</div>
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
