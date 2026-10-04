"use client";

import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { formatTime } from "@/lib/format";
import { MenuButton, NavDrawer } from "./driver-nav";
import { useRun } from "./use-run";

// Building blocks for the driver's phone screens: large type and 44–56px touch targets.

/**
 * The driver's screen. On a phone it fills the whole display (every pixel is for the road, not a frame);
 * on a bigger screen (demo, office) it shows as a 360×800 handset, the small end of the phones drivers carry.
 */
export function PhoneScreen({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      data-screen-label={label}
      className="relative flex h-[100dvh] w-full flex-col overflow-hidden bg-wp-canvas text-base sm:h-[800px] sm:max-h-[calc(100dvh-2rem)] sm:w-[360px] sm:rounded-[22px] sm:border sm:border-wp-border sm:shadow-lg"
    >
      {children}
      <NavDrawer />
    </div>
  );
}

/** Carries the drawer handle on every screen, then lays the screen's own header out beside it. */
export function TopBar({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 border-b border-wp-border bg-wp-surface px-3 py-3">
      <MenuButton />
      <div className="flex min-w-0 flex-1 items-center justify-between gap-2">{children}</div>
    </div>
  );
}

export function BottomBar({ children, className }: { children: ReactNode; className?: string }) {
  // Safe-area padding keeps the buttons clear of the phone's home bar.
  return <div className={cn("border-t border-wp-border bg-wp-surface px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]", className)}>{children}</div>;
}

export function Body({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-1 flex-col gap-4 overflow-y-auto p-4", className)}>{children}</div>;
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-3 rounded-xl border border-wp-border bg-wp-surface p-4", className)}>
      {children}
    </div>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="text-xs font-semibold tracking-[.06em] text-wp-muted">{children}</div>;
}

const BIG_BUTTON_VARIANTS = {
  primary: "bg-wp-action text-wp-on-action",
  outline: "border border-wp-action text-wp-action",
  plain: "border border-wp-border",
} as const;

const BIG_BUTTON_BASE =
  "flex h-14 shrink-0 cursor-pointer items-center justify-center rounded-xl px-2 text-center text-base leading-tight font-semibold";

export function BigButton({
  variant = "primary",
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof BIG_BUTTON_VARIANTS }) {
  return (
    <button
      type={type}
      className={cn(
        BIG_BUTTON_BASE,
        "disabled:cursor-not-allowed disabled:opacity-50",
        BIG_BUTTON_VARIANTS[variant],
        className,
      )}
      {...props}
    />
  );
}

/** A BigButton that leaves the app — a `tel:` dial or a hand-off to the phone's map. */
export function BigLink({
  variant = "primary",
  className,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: keyof typeof BIG_BUTTON_VARIANTS }) {
  return <a className={cn(BIG_BUTTON_BASE, BIG_BUTTON_VARIANTS[variant], className)} {...props} />;
}

/** Large selectable tile, used for delivery outcomes and problem types. */
export function ChoiceTile({
  selected,
  selectedClassName = "border-2 border-wp-action bg-wp-info-tint font-bold",
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { selected: boolean; selectedClassName?: string }) {
  return (
    <button
      type={type}
      aria-pressed={selected}
      className={cn(
        "flex min-h-[76px] cursor-pointer items-center justify-center rounded-xl px-2 text-center",
        selected ? selectedClassName : "border border-wp-border bg-wp-surface font-semibold",
        className,
      )}
      {...props}
    />
  );
}

/** Where the phone's records are: all sent, sending, or waiting for signal. Never claims more than it knows. */
export function SyncPill() {
  const { outbox } = useRun();
  if (!outbox.online) {
    return (
      <div className="rounded-full bg-wp-offline-tint px-3 py-1.5 text-[13px] font-semibold whitespace-nowrap text-wp-offline">
        ○ No signal · {outbox.pending} to send
      </div>
    );
  }
  if (outbox.pending > 0) {
    return (
      <div className="rounded-full bg-wp-info-tint px-3 py-1.5 text-[13px] font-semibold whitespace-nowrap text-wp-info">
        ● Sending {outbox.pending}…
      </div>
    );
  }
  return (
    <div className="rounded-full bg-wp-good-tint px-3 py-1.5 text-[13px] font-semibold whitespace-nowrap text-wp-good">
      ✓ All sent{outbox.lastSyncAt ? ` ${formatTime(outbox.lastSyncAt)}` : ""}
    </div>
  );
}

/**
 * The degradation screen's message: working without signal is normal, and nothing is lost.
 * Records the server refused (a stop changed by dispatch, say) are listed, never dropped silently.
 */
export function OfflineBanner() {
  const { outbox, fromCache, run } = useRun();
  return (
    <>
      {!outbox.online && (
        <div className="rounded-xl bg-wp-offline-tint p-3 leading-[22px] font-semibold text-wp-offline">
          ○ No signal{outbox.simulated ? " (simulated)" : ""}. Everything you record is saved on this phone and sent
          when signal returns.
          {outbox.pending > 0 && <div className="text-[13px] font-normal">{outbox.pending} {outbox.pending === 1 ? "record" : "records"} (arrivals, deliveries) waiting to send.</div>}
        </div>
      )}
      {outbox.online && fromCache && run && (
        <div className="rounded-xl bg-wp-info-tint p-3 text-[13px] leading-[18px] font-semibold text-wp-info">
          ● Showing the run saved on this phone. Updating…
        </div>
      )}
      {outbox.rejected.length > 0 && (
        <div className="flex flex-col gap-1 rounded-xl border border-wp-warn bg-wp-warn-tint p-3 text-[13px] leading-[18px] text-wp-warn">
          <b>▲ Dispatch did not accept {outbox.rejected.length === 1 ? "a record" : `${outbox.rejected.length} records`}:</b>
          {outbox.rejected.slice(0, 3).map((r) => (
            <span key={r.event_id}>{r.reject_reason}</span>
          ))}
          <button type="button" onClick={outbox.dismissRejected} className="self-start font-semibold underline">
            Got it · call dispatch if unsure
          </button>
        </div>
      )}
    </>
  );
}
