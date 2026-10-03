"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { DISPATCHER } from "./data";

/**
 * The driver's screens live behind a drawer inside the phone, not on a bar beside it:
 * a driver only ever sees the handset, so the navigation has to fit in it.
 */
const SCREENS = [
  ["run", "My run", "●", "R1"],
  ["moving", "Driving", "➤", "R1"],
  ["stop", "Stop details", "▣", "R2"],
  ["deliver", "Record delivery", "✓", "R3"],
  ["problem", "Report a problem", "⚑", "R4"],
] as const;

export type DriverScreen = (typeof SCREENS)[number][0];

type DriverNav = {
  screen: DriverScreen;
  navigate: (screen: DriverScreen) => void;
  menuOpen: boolean;
  openMenu: () => void;
  closeMenu: () => void;
};

const DriverNavContext = createContext<DriverNav | null>(null);

function useDriverNav() {
  const nav = useContext(DriverNavContext);
  if (!nav) throw new Error("Driver navigation is only available inside <DriverNavProvider>.");
  return nav;
}

export function DriverNavProvider({
  screen,
  onNavigate,
  children,
}: {
  screen: DriverScreen;
  onNavigate: (screen: DriverScreen) => void;
  children: ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);

  /** Picking a screen always dismisses the drawer, however the screen was reached. */
  const navigate = useCallback(
    (next: DriverScreen) => {
      setMenuOpen(false);
      onNavigate(next);
    },
    [onNavigate],
  );

  return (
    <DriverNavContext.Provider
      value={{ screen, navigate, menuOpen, openMenu: () => setMenuOpen(true), closeMenu }}
    >
      {children}
    </DriverNavContext.Provider>
  );
}

/** Hamburger that opens the drawer; the bars fold into a cross while it is open. */
export function MenuButton() {
  const { menuOpen, openMenu, closeMenu } = useDriverNav();
  const bar = "absolute h-0.5 w-5 rounded-full bg-wp-text transition-transform duration-200";

  return (
    <button
      type="button"
      aria-label={menuOpen ? "Close menu" : "Open menu"}
      aria-expanded={menuOpen}
      onClick={menuOpen ? closeMenu : openMenu}
      className="relative flex size-11 flex-shrink-0 cursor-pointer items-center justify-center rounded-[10px] border border-wp-border bg-wp-surface"
    >
      <span className={cn(bar, menuOpen ? "rotate-45" : "-translate-y-1.5")} />
      <span className={cn(bar, "transition-opacity", menuOpen && "opacity-0")} />
      <span className={cn(bar, menuOpen ? "-rotate-45" : "translate-y-1.5")} />
    </button>
  );
}

/**
 * Slide-over screen list. Rendered inside the phone frame by `PhoneScreen`, so it
 * dims and covers the handset rather than the page around it.
 */
export function NavDrawer() {
  const { screen, navigate, menuOpen, closeMenu } = useDriverNav();

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeMenu();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen, closeMenu]);

  return (
    <div className={cn("absolute inset-0 z-20", !menuOpen && "pointer-events-none")}>
      <button
        type="button"
        tabIndex={-1}
        aria-hidden
        onClick={closeMenu}
        className={cn(
          "absolute inset-0 cursor-default bg-wp-text/40 backdrop-blur-[2px] transition-opacity duration-200",
          menuOpen ? "opacity-100" : "opacity-0",
        )}
      />
      <nav
        aria-label="Driver screens"
        inert={!menuOpen}
        className={cn(
          "absolute inset-y-0 left-0 flex w-[282px] flex-col border-r border-wp-border bg-wp-surface shadow-xl transition-transform duration-200 ease-out",
          menuOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex flex-col gap-0.5 border-b border-wp-border px-4 py-4">
          <div className="text-xs font-semibold tracking-[.06em] text-wp-muted">DRIVER · RT-03</div>
          <div className="text-[22px] leading-[26px] font-bold">Mahinda</div>
          <div className="text-[13px] text-wp-text-2">Route 1 of 2 · 9 stops</div>
        </div>

        <div className="flex flex-1 flex-col gap-1 overflow-y-auto p-2">
          {SCREENS.map(([key, label, glyph, code]) => {
            const active = key === screen;
            return (
              <button
                key={key}
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => navigate(key)}
                className={cn(
                  "flex min-h-[52px] cursor-pointer items-center gap-3 rounded-[10px] px-3 text-left",
                  active ? "bg-wp-info-tint font-bold text-wp-info" : "font-semibold text-wp-text",
                )}
              >
                <span className="w-5 text-center text-lg leading-none">{glyph}</span>
                <span className="flex-1">{label}</span>
                <span className={cn("text-[11px]", active ? "text-wp-info" : "text-wp-muted")}>{code}</span>
              </button>
            );
          })}
        </div>

        <div className="border-t border-wp-border p-3">
          <a
            href={`tel:${DISPATCHER.tel}`}
            className="flex h-12 items-center justify-center rounded-xl bg-wp-action font-semibold text-wp-on-action"
          >
            ☎ Call dispatcher
          </a>
        </div>
      </nav>
    </div>
  );
}
