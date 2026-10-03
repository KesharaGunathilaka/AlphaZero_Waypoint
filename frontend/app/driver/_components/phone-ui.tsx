"use client";

import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { MenuButton, NavDrawer } from "./driver-nav";

// Building blocks for the driver's phone screens: large type and 44–56px touch targets.

/** A 360×800 handset — the small end of the phones drivers actually carry. */
export function PhoneScreen({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      data-screen-label={label}
      className="relative flex h-[800px] max-h-[calc(100dvh-2rem)] max-sm:max-h-[calc(100dvh-6rem)] w-[360px] max-w-full flex-col overflow-hidden rounded-[22px] border border-wp-border bg-wp-canvas text-base shadow-lg"
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
  return <div className={cn("border-t border-wp-border bg-wp-surface px-4 py-3", className)}>{children}</div>;
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

export function SyncPill({ offline }: { offline: boolean }) {
  return offline ? (
    <div className="rounded-full bg-wp-offline-tint px-3 py-1.5 text-[13px] font-semibold text-wp-offline">
      ○ Offline · 3 to send
    </div>
  ) : (
    <div className="rounded-full bg-wp-good-tint px-3 py-1.5 text-[13px] font-semibold text-wp-good">
      ✓ Synced 06:31
    </div>
  );
}
