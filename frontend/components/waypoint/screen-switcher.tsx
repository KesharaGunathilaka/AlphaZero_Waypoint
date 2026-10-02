"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Prototype toolbar for jumping between a role's screens.
 * Temporary until each screen gets its own route and real data.
 */
export function ScreenSwitcher<K extends string>({
  screens,
  current,
  onChange,
  children,
}: {
  screens: readonly (readonly [K, string])[];
  current: K;
  onChange: (key: K) => void;
  /** Extra toolbar controls, e.g. a device toggle. */
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-wp-border bg-wp-surface px-3 py-2 text-wp-text">
      <span className="text-[11px] font-semibold tracking-[.06em] text-wp-muted">SCREEN</span>
      {screens.map(([key, label]) => (
        <SwitcherButton key={key} active={current === key} onClick={() => onChange(key)}>
          {label}
        </SwitcherButton>
      ))}
      {children}
    </div>
  );
}

export function SwitcherButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "h-8 cursor-pointer rounded-md border border-wp-border px-3 text-xs font-semibold",
        active ? "bg-wp-action text-wp-on-action" : "bg-wp-surface text-wp-text",
      )}
    >
      {children}
    </button>
  );
}
