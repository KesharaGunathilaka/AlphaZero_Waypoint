"use client";

import { Bell, BellOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/waypoint/controls";
import type { Exception } from "./data";

/**
 * Live calls for attention the moment something new needs a decision: a short sound and the count in the browser
 * tab, so a dispatcher working in another tab or window still notices. Critical problems (a failed delivery, a
 * driver's report, a store that can't receive late) sound twice; a stop newly likely to miss its window once.
 * What is already on the list when Live opens stays quiet. The sound can be switched off; the choice is kept on
 * this computer.
 */

const PREF = "wp-live-sound";
const keyOf = (e: Exception) => [e.kind, e.route_id, e.stop_id, e.order_id, e.flag_id].join(":");
const calls = (e: Exception) => e.severity === "crit" || e.kind === "likely_late";

function readPref(): boolean {
  try {
    return localStorage.getItem(PREF) !== "off";
  } catch {
    return true;
  }
}

function chime(ctx: AudioContext, urgent: boolean) {
  (urgent ? [880, 660] : [660]).forEach((hz, i) => {
    const tone = ctx.createOscillator();
    const gain = ctx.createGain();
    const t = ctx.currentTime + i * 0.24;
    tone.type = "sine";
    tone.frequency.value = hz;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    tone.connect(gain).connect(ctx.destination);
    tone.start(t);
    tone.stop(t + 0.22);
  });
}

export function useLiveAlerts(exceptions: Exception[] | undefined) {
  const [on, setOn] = useState(readPref);
  const onRef = useRef(on);
  const seen = useRef<Set<string> | null>(null);
  const audio = useRef<AudioContext | null>(null);
  const count = (exceptions ?? []).filter(calls).length;

  // Browsers only play sound after the person has used the page: open the audio on the first click.
  useEffect(() => {
    const unlock = () => {
      audio.current ??= new AudioContext();
      void audio.current.resume();
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    return () => window.removeEventListener("pointerdown", unlock);
  }, []);

  useEffect(() => {
    if (!exceptions) return;
    const open = exceptions.filter(calls);
    const keys = new Set(open.map(keyOf));
    const before = seen.current;
    seen.current = keys;
    if (before === null) return;
    const fresh = open.filter((e) => !before.has(keyOf(e)));
    if (fresh.length > 0 && onRef.current && audio.current) chime(audio.current, fresh.some((e) => e.severity === "crit"));
  }, [exceptions]);

  useEffect(() => {
    const base = document.title.replace(/^\(\d+\) /, "");
    document.title = count > 0 ? `(${count}) ${base}` : base;
    return () => {
      document.title = document.title.replace(/^\(\d+\) /, "");
    };
  }, [count]);

  function toggle() {
    const next = !on;
    setOn(next);
    onRef.current = next;
    try {
      localStorage.setItem(PREF, next ? "on" : "off");
    } catch {
      // the choice just isn't remembered
    }
    if (next) {
      audio.current ??= new AudioContext();
      void audio.current.resume().then(() => chime(audio.current!, false));
    }
  }

  return { on, toggle, count };
}

export function AlertSoundToggle({ on, toggle, count }: { on: boolean; toggle: () => void; count: number }) {
  return (
    <Button variant="secondary" className="h-8 gap-1.5" onClick={toggle} aria-pressed={on}
            title="A short sound when something new needs a decision; the count also shows in the browser tab">
      {on ? <Bell className="size-3.5" aria-hidden /> : <BellOff className="size-3.5" aria-hidden />}
      Alert sound {on ? "on" : "off"}
      {count > 0 && <span className="rounded-full bg-wp-crit px-1.5 text-[11px] leading-4 font-bold text-wp-on-action">{count}</span>}
    </Button>
  );
}
