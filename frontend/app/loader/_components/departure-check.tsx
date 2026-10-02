"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { CARD, LiveStatus, Meter, PRIMARY_TOUCH_BUTTON, TOUCH_BUTTON, TabletPill, TabletScreen } from "./tablet-ui";

const PIN_LENGTH = 4;
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"];

/** L3 · Departure check: review shortfalls and final load, then release the vehicle with a PIN. */
export function DepartureCheck({ onReopen }: { onReopen: () => void }) {
  const [pin, setPin] = useState("");
  const [released, setReleased] = useState(false);

  function press(key: string) {
    if (key === "⌫") setPin((p) => p.slice(0, -1));
    else if (key) setPin((p) => (p.length < PIN_LENGTH ? p + key : p));
  }

  return (
    <TabletScreen label="L3 Departure check">
      <header className="flex h-[72px] flex-none items-center justify-between border-b border-wp-border bg-wp-surface px-6">
        <div className="text-xl font-bold">Departure check · RT-03</div>
        <LiveStatus />
      </header>

      <div className="grid flex-1 grid-cols-[minmax(0,1fr)_400px] gap-6 p-6">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-3">
            <TabletPill tone="good" className="h-12 px-5 text-[17px]">
              ✓ 9 of 9 stops loaded
            </TabletPill>
            <TabletPill tone="good" className="h-12 px-5 text-[17px]">
              ✓ 58 of 58 lines confirmed
            </TabletPill>
          </div>

          <div className="flex flex-col gap-3 rounded-[10px] border-2 border-wp-warn bg-wp-warn-tint p-5">
            <div className="text-[13px] font-semibold tracking-[.06em] text-wp-warn">▲ SHORTFALL · 1 LINE</div>
            <div className="text-3xl leading-8 font-bold">2 crates short</div>
            <div>Chilled yoghurt cups · Stop 6 · Fresh Borella · 10 of 12 crates loaded</div>
            <div className="text-wp-text-2">Flagged 04:12 · Dispatcher replied: “Proceed short.”</div>
            <div className="border-t border-wp-warn pt-3">
              Will be shown to: the driver at Stop 6, and Fresh Borella on its order.
            </div>
          </div>

          <div className={cn(CARD, "flex flex-col gap-4 p-5")}>
            <div className="text-[13px] font-semibold tracking-[.06em] text-wp-muted">FINAL LOAD</div>
            <div className="grid grid-cols-2 gap-6">
              <Meter label="Weight" value="2,610 of 2,800 kg · 93%" percent={93} fillClassName="bg-wp-gauge-amber" />
              <Meter label="Volume" value="20.1 of 22.0 m³ · 91%" percent={91} fillClassName="bg-wp-gauge-amber" />
            </div>
            <div className="grid grid-cols-3 gap-4 border-t border-wp-border pt-4">
              {[
                ["Loaded by", "Nuwan"],
                ["Finished", "05:12"],
                ["Departure", "05:30"],
              ].map(([label, value]) => (
                <div key={label}>
                  <div className="text-[13px] text-wp-muted">{label}</div>
                  <div className="font-semibold">{value}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className={cn(CARD, "flex flex-col gap-4 self-start p-6")}>
          <div>
            <div className="text-xl leading-[26px] font-semibold">Enter your PIN to release</div>
            <div className="text-sm text-wp-text-2">The tablet is shared, so release is signed by you.</div>
          </div>
          <div className="flex h-8 items-center justify-center gap-4" aria-label={`${pin.length} of ${PIN_LENGTH} digits entered`}>
            {Array.from({ length: PIN_LENGTH }, (_, i) => (
              <span
                key={i}
                className={cn("size-[18px] rounded-full", i < pin.length ? "bg-wp-text" : "border-2 border-wp-text-2")}
              />
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2 text-center text-[26px] font-semibold">
            {KEYS.map((key, i) =>
              key ? (
                <button
                  key={i}
                  type="button"
                  onClick={() => press(key)}
                  aria-label={key === "⌫" ? "Delete" : key}
                  className={cn(
                    "h-[60px] cursor-pointer rounded-lg",
                    key === "⌫" ? "text-[22px]" : "bg-wp-surface-2",
                  )}
                >
                  {key}
                </button>
              ) : (
                <span key={i} />
              ),
            )}
          </div>
          <button
            type="button"
            disabled={pin.length < PIN_LENGTH || released}
            onClick={() => setReleased(true)}
            className={cn(PRIMARY_TOUCH_BUTTON, "h-16 text-[17px] disabled:cursor-not-allowed disabled:opacity-60")}
          >
            {released ? "✓ RT-03 released to driver" : "Release RT-03 to driver"}
          </button>
          <button type="button" onClick={onReopen} className={TOUCH_BUTTON}>
            Reopen loading
          </button>
          <div className="text-center text-[13px] text-wp-muted">
            Sets RT-03 to Loaded on the driver’s phone and the dispatcher’s monitor.
          </div>
        </div>
      </div>
    </TabletScreen>
  );
}
