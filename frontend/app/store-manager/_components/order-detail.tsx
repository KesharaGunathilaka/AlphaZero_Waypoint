"use client";

import { useState } from "react";
import { Button } from "@/components/waypoint/controls";
import { Timeline } from "@/components/waypoint/data";
import { Banner, StatusPill } from "@/components/waypoint/status";
import { cn } from "@/lib/utils";
import { ORDER_DETAILS, type OrderId } from "./data";
import { storeLayout } from "./layout";
import { LinkButton } from "./link-button";

const COLLAPSED_LINES = 4;

/** S3 · Order detail: what the warehouse did with this order and where it is now. */
export function OrderDetail({ orderId, onBack }: { orderId: OrderId; onBack: () => void }) {
  const [showAll, setShowAll] = useState(false);
  const order = ORDER_DETAILS[orderId];
  const lines = showAll ? order.lines : order.lines.slice(0, COLLAPSED_LINES);
  const hidden = order.lines.length - COLLAPSED_LINES;

  return (
    <>
      <div className="flex flex-col gap-1">
        <LinkButton onClick={onBack} className="no-underline">
          ← Deliveries
        </LinkButton>
        <h1 className={storeLayout.h1}>{order.title}</h1>
        <div className="text-[13px] text-wp-text-2">{order.subtitle}</div>
      </div>
      <Banner state={order.banner.state}>{order.banner.text}</Banner>

      <div className={cn("grid items-start gap-6", storeLayout.colsMain)}>
        <div className="flex min-w-0 flex-col gap-4">
          <section className={cn(storeLayout.card, "flex flex-col gap-4 p-4")}>
            {order.sections.map((section) => (
              <div key={section.label}>
                <div className="text-[11px] font-semibold tracking-[.06em] text-wp-muted">{section.label}</div>
                <div
                  className={cn(
                    "mt-1 flex flex-wrap items-center gap-2",
                    section.lead ? "text-base leading-[22px]" : "text-[13px] leading-[18px]",
                  )}
                >
                  {section.text}
                  {section.pill && <StatusPill state={section.pill.state}>{section.pill.label}</StatusPill>}
                </div>
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="secondary" className={storeLayout.button}>
                ☎ Contact dispatch desk
              </Button>
              <span className="text-xs text-wp-muted">For anything urgent</span>
            </div>
          </section>

          <section className={cn(storeLayout.card, "flex flex-col gap-1 p-4")}>
            <h2 className="mb-2 text-[15px] font-semibold">Order lines</h2>
            {lines.map((line) => (
              <div
                key={line.name}
                className={cn(
                  "flex items-center justify-between gap-2 border-t border-wp-border text-[13px]",
                  storeLayout.rowHeight,
                )}
              >
                <span>{line.name}</span>
                <span className="text-wp-text-2 tabular-nums">{line.qty}</span>
              </div>
            ))}
            {hidden > 0 && (
              <LinkButton onClick={() => setShowAll(!showAll)} className="pt-2">
                {showAll ? "Show fewer lines" : `Show ${hidden} more lines`}
              </LinkButton>
            )}
          </section>
        </div>

        <aside className={cn(storeLayout.card, "flex flex-col gap-3 p-4")}>
          <h2 className="text-[15px] font-semibold">Where it is</h2>
          <Timeline steps={order.timeline} />
        </aside>
      </div>
    </>
  );
}
