"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

// Building blocks for the driver's phone screens: large type and 44–56px touch targets.

export function PhoneScreen({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      data-screen-label={label}
      className="flex h-[844px] w-[390px] max-w-full flex-col overflow-hidden rounded-xl border border-wp-border bg-wp-canvas text-base"
    >
      {children}
    </div>
  );
}

export function TopBar({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-wp-border bg-wp-surface px-4 py-3">
      {children}
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
        "flex h-14 cursor-pointer items-center justify-center rounded-xl text-base font-semibold",
        BIG_BUTTON_VARIANTS[variant],
        className,
      )}
      {...props}
    />
  );
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
