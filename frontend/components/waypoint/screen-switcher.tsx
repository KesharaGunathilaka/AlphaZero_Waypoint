"use client";

import { cn } from "@/lib/utils";

const CHROME = {
  /** Standalone bar floating above the app it drives. */
  card: "rounded-lg border border-wp-border bg-wp-surface px-1",
  /** Sits inside a header, so it brings no surface of its own. */
  inline: "",
} as const;

/**
 * Prototype navigation for jumping between a role's screens.
 * Temporary until each screen gets its own route and real data.
 */
export function ScreenSwitcher<K extends string>({
  screens,
  current,
  onChange,
  variant = "card",
  className,
}: {
  screens: readonly (readonly [K, string])[];
  current: K;
  onChange: (key: K) => void;
  variant?: keyof typeof CHROME;
  /** Sizing for the bar itself, e.g. to stretch it to the height of a header. */
  className?: string;
}) {
  return (
    <nav
      aria-label="Screens"
      className={cn(
        "max-w-full overflow-x-auto text-wp-text [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        CHROME[variant],
        className,
      )}
    >
      <div role="tablist" className="flex h-full min-w-max items-stretch">
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
