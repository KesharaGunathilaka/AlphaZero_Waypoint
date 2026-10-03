"use client";

import { cn } from "@/lib/utils";

/**
 * Prototype navigation for jumping between a role's screens.
 * Temporary until each screen gets its own route and real data.
 */
export function ScreenSwitcher<K extends string>({
  screens,
  current,
  onChange,
  className,
}: {
  screens: readonly (readonly [K, string])[];
  current: K;
  onChange: (key: K) => void;
  /** Sizing for the bar itself, e.g. to match the width of the app below it. */
  className?: string;
}) {
  return (
    <nav
      aria-label="Screens"
      className={cn(
        "max-w-full overflow-x-auto rounded-lg border border-wp-border bg-wp-surface text-wp-text",
        "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className,
      )}
    >
      <div role="tablist" className="flex min-w-max items-stretch px-1">
        {screens.map(([key, label]) => (
          <Tab key={key} active={current === key} onClick={() => onChange(key)}>
            {label}
          </Tab>
        ))}
      </div>
    </nav>
  );
}

function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "relative cursor-pointer whitespace-nowrap px-3 py-3 text-xs font-semibold transition-colors",
        "after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full",
        active ? "text-wp-action after:bg-wp-action" : "text-wp-muted hover:text-wp-text",
      )}
    >
      {children}
    </button>
  );
}
