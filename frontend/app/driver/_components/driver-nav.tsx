"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { AccountButton } from "@/components/waypoint/account-button";
import { cn } from "@/lib/utils";
import { DISPATCHER } from "./data";
import { useRun } from "./use-run";

/**
 * The driver moves forward with the big button on each screen; this menu only holds the few places a
 * driver jumps to on purpose, and the account. No screen codes: a driver should never see "R1".
 */
const MENU = [
  ["run", "My run", "●"],
  ["problem", "Report a problem", "⚑"],
] as const;

export type DriverScreen = "run" | "complete" | "stop" | "deliver" | "problem";

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

/** Labelled menu button: an icon alone ("hamburger") is easy to miss for someone new to apps. */
export function MenuButton() {
  const { menuOpen, openMenu, closeMenu } = useDriverNav();
  const bar = "absolute h-0.5 w-4 rounded-full bg-wp-text transition-transform duration-200";

  return (
    <button
      type="button"
      aria-expanded={menuOpen}
      onClick={menuOpen ? closeMenu : openMenu}
      className="flex h-11 flex-shrink-0 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-[10px] border border-wp-border bg-wp-surface px-2"
    >
      <span aria-hidden className="relative flex h-3 w-4 items-center justify-center">
        <span className={cn(bar, menuOpen ? "rotate-45" : "-translate-y-1")} />
        <span className={cn(bar, "transition-opacity", menuOpen && "opacity-0")} />
        <span className={cn(bar, menuOpen ? "-rotate-45" : "translate-y-1")} />
      </span>
      <span className="text-[10px] leading-none font-semibold">{menuOpen ? "Close" : "Menu"}</span>
    </button>
  );
}

/**
 * Slide-over screen list. Rendered inside the phone frame by `PhoneScreen`, so it
 * dims and covers the handset rather than the page around it.
 */
export function NavDrawer() {
  const { screen, navigate, menuOpen, closeMenu } = useDriverNav();
  const { run, currentTrip, trips, outbox } = useRun();
  const driver = run?.driver;

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
          <div className="text-xs font-semibold tracking-[.06em] text-wp-muted">
            DRIVER · {driver?.vehicle_source_id ?? "no vehicle"}
          </div>
          <div className="text-[22px] leading-[26px] font-bold">{driver?.name ?? "…"}</div>
          <div className="text-[13px] text-wp-text-2">
            {currentTrip ? `Trip ${trips.indexOf(currentTrip) + 1} of ${trips.length} · ${currentTrip.stops.length} stops` : "No trips yet"}
          </div>
        </div>

        <div className="flex flex-1 flex-col gap-1 overflow-y-auto p-2">
          {MENU.map(([key, label, glyph]) => {
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
              </button>
            );
          })}
        </div>

        <label className="mx-3 mb-2 flex min-h-12 cursor-pointer items-center justify-between gap-3 rounded-[10px] border border-dashed border-wp-border px-3 text-[13px] font-semibold">
          <span>
            Simulate no signal
            <span className="block text-[11px] font-normal text-wp-text-2">Demo: records wait on the phone</span>
          </span>
          <input type="checkbox" className="size-5" checked={outbox.simulated} onChange={(e) => outbox.simulate(e.target.checked)} />
        </label>
        <div className="flex flex-col gap-2 border-t border-wp-border p-3">
          <a
            href={`tel:${DISPATCHER.tel}`}
            className="flex h-12 items-center justify-center rounded-xl bg-wp-action font-semibold text-wp-on-action"
          >
            ☎ Call dispatcher
          </a>
          <AccountButton showName className="justify-center" />
        </div>
      </nav>
    </div>
  );
}
