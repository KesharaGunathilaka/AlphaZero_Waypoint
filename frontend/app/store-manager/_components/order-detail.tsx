"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/waypoint/controls";
import { Timeline } from "@/components/waypoint/data";
import { Banner, StatusPill } from "@/components/waypoint/status";
import { cn } from "@/lib/utils";
import { CHILLED_LINES, CHILLED_ORDER_TIMELINE } from "./data";
import type { StoreLayout } from "./layout";
import { LinkButton } from "./link-button";

const COLLAPSED_LINES = 4;

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-semibold tracking-[.06em] text-wp-muted">{label}</div>
      {children}
    </div>
  );
}

/** S3 · Order detail: why the chilled order moved and where it is now. */
export function OrderDetail({ layout, onBack }: { layout: StoreLayout; onBack: () => void }) {
  const [showAll, setShowAll] = useState(false);
  const lines = showAll ? CHILLED_LINES : CHILLED_LINES.slice(0, COLLAPSED_LINES);

  return (
    <>
      <div className="flex flex-col gap-1">
        <LinkButton onClick={onBack} className="no-underline">
          ← Deliveries
        </LinkButton>
        <h1 className={layout.h1}>Order FP-4418 · Chilled</h1>
        <div className="text-[13px] text-wp-text-2">Fresh Pettah · Placed Mon 28 Sep 14:10</div>
      </div>
      <Banner state="warn">This order is moved from Wed 30 Sep to Thu 1 Oct.</Banner>

      <div className={cn("grid items-start gap-6", layout.colsMain)}>
        <div className="flex min-w-0 flex-col gap-4">
          <section className={cn(layout.card, "flex flex-col gap-4 p-4")}>
            <Section label="WHY">
              <div className="mt-1 text-base leading-[22px]">
                No refrigerated van that can reach your store was free on Wed 30 Sep.
              </div>
            </Section>
            <Section label="CONTEXT">
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[13px] leading-[18px]">
                This is the second move in the last 5 runs. <StatusPill state="warn">Priority</StatusPill>
              </div>
            </Section>
            <Section label="WHAT IT MEANS FOR YOU">
              <div className="mt-1 text-[13px] leading-[18px]">
                Plan Wednesday’s chilled stock without this order. Dry groceries (FP-4417) are unaffected and still
                arrive Wed 30 Sep 08:30–10:00.
              </div>
            </Section>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="secondary" className={layout.button}>
                ☎ Contact dispatch desk
              </Button>
              <span className="text-xs text-wp-muted">For anything urgent</span>
            </div>
          </section>

          <section className={cn(layout.card, "flex flex-col gap-1 p-4")}>
            <h2 className="mb-2 text-[15px] font-semibold">Order lines</h2>
            {lines.map((line) => (
              <div
                key={line.name}
                className={cn(
                  "flex items-center justify-between gap-2 border-t border-wp-border text-[13px]",
                  layout.rowHeight,
                )}
              >
                <span>{line.name}</span>
                <span className="text-wp-text-2 tabular-nums">{line.qty}</span>
              </div>
            ))}
            <LinkButton onClick={() => setShowAll(!showAll)} className="pt-2">
              {showAll ? "Show fewer lines" : `Show ${CHILLED_LINES.length - COLLAPSED_LINES} more lines`}
            </LinkButton>
          </section>
        </div>

        <aside className={cn(layout.card, "flex flex-col gap-3 p-4")}>
          <h2 className="text-[15px] font-semibold">Where it is</h2>
          <Timeline steps={CHILLED_ORDER_TIMELINE} />
        </aside>
      </div>
    </>
  );
}
