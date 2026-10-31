"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useApiData } from "@/lib/api/use-api";

/**
 * The time the apps work to. Normally the real time; during a demo the server can run a "demo clock"
 * (GET /clock), so the delivery morning can be shown in the afternoon. Countdowns, "late" and the time
 * stamped on driver and loader records all read appNow(); the server's own stamps stay on real time.
 */

const KEY = "wp.clock.offset";
let offsetMs = 0;
const listeners = new Set<() => void>();

if (typeof window !== "undefined") {
  try {
    offsetMs = Number(window.localStorage.getItem(KEY)) || 0;
  } catch {
    // storage blocked: start on real time; the next /clock read sets the offset
  }
}

/** Take the server's clock (from GET /clock or a demo clock change) as the app's clock. */
export function applyClock(clock: Pick<Clock, "offset_seconds">) {
  setOffset(Number(clock.offset_seconds) * 1000);
}

function setOffset(ms: number) {
  if (ms === offsetMs) return;
  offsetMs = ms;
  try {
    window.localStorage.setItem(KEY, String(ms));
  } catch {
    // keep it in memory only
  }
  listeners.forEach((l) => l());
}

/** Now, on the app's clock. */
export function appNow(): Date {
  return new Date(Date.now() + offsetMs);
}

/** Today's date in Sri Lanka on the app's clock, as YYYY-MM-DD. */
export function appToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Colombo" }).format(appNow());
}

export type Clock = { now: string; real_now: string; offset_seconds: number; demo_controls: boolean };

/** Keeps the app's clock in step with the server (every minute) and returns what the server said. */
export function useClockSync() {
  const clock = useApiData<Clock>("/clock", 60_000);
  useEffect(() => {
    if (clock.data) applyClock(clock.data);
  }, [clock.data]);
  return clock;
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** The demo clock's offset in ms (0 = real time); re-renders when it changes. */
export function useClockOffset(): number {
  return useSyncExternalStore(subscribe, () => offsetMs, () => 0);
}

/** One ticking "now" per interval, shared by every component that asks for that interval. */
type Ticker = { subscribe: (onChange: () => void) => () => void; get: () => Date };
const tickers = new Map<number, Ticker>();

function ticker(everyMs: number): Ticker {
  let ticker = tickers.get(everyMs);
  if (!ticker) {
    let current = appNow();
    const subs = new Set<() => void>();
    let timer: ReturnType<typeof setInterval> | undefined;
    const update = () => {
      current = appNow();
      subs.forEach((s) => s());
    };
    ticker = {
      subscribe(onChange) {
        if (subs.size === 0) {
          current = appNow();
          timer = setInterval(update, everyMs);
          listeners.add(update);
        }
        subs.add(onChange);
        return () => {
          subs.delete(onChange);
          if (subs.size === 0) {
            clearInterval(timer);
            listeners.delete(update);
          }
        };
      },
      get: () => current,
    };
    tickers.set(everyMs, ticker);
  }
  return ticker;
}

/** appNow(), re-rendered every `everyMs` (and when the demo clock moves): for countdowns. */
export function useNow(everyMs = 30_000): Date {
  const t = ticker(everyMs);
  return useSyncExternalStore(t.subscribe, t.get, t.get);
}
