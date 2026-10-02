"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { CURRENT_STOP_LINES, FLAG_TYPES, LOADED_STOPS, UPCOMING_STOPS, type LoadLine } from "./data";
import { CARD, Meter, PRIMARY_TOUCH_BUTTON, TOUCH_BUTTON, TabletPill, TabletScreen } from "./tablet-ui";

const TOTAL_LINES = 58;
const LOADED_LINES = 31;

/** L2 · Load list for RT-03: loads last stop first, with a per-line flag sheet. */
export function LoadList({
  flagOpen,
  onFlagOpenChange,
  onBack,
}: {
  flagOpen: boolean;
  onFlagOpenChange: (open: boolean) => void;
  onBack: () => void;
}) {
  const [lines, setLines] = useState(CURRENT_STOP_LINES);
  const flagged = lines.find((l) => l.shortBy) ?? lines[2];
  const percent = Math.round((LOADED_LINES / TOTAL_LINES) * 100);

  const toggleConfirmed = (id: string) =>
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, confirmed: !l.confirmed } : l)));

  return (
    <TabletScreen label="L2 Load list" className="relative">
      <header className="flex h-[88px] flex-none items-center justify-between border-b border-wp-border bg-wp-surface px-6">
        <div className="flex items-center gap-5">
          <button type="button" onClick={onBack} className={TOUCH_BUTTON}>
            ‹ Vehicles
          </button>
          <div className="text-3xl leading-8 font-bold">
            RT-03 <span className="text-base font-medium text-wp-text-2">Refrigerated truck · departs 05:30</span>
          </div>
        </div>
        <div className="w-[340px]">
          <div className="mb-2 flex justify-between">
            <b>
              {LOADED_LINES} of {TOTAL_LINES} lines loaded
            </b>
            <span>{percent}%</span>
          </div>
          <div className="h-2 rounded bg-wp-surface-2">
            <div className="h-2 rounded bg-wp-text-2" style={{ width: `${percent}%` }} />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-wp-text-2">Nuwan</span>
          <TabletPill tone="good">● Live</TabletPill>
        </div>
      </header>

      <div className="grid flex-1 grid-cols-[minmax(0,1fr)_340px] gap-6 p-6">
        <div className="flex flex-col gap-3">
          <div>
            <div className="text-xl leading-[26px] font-semibold">Load in this order — last stop first</div>
            <div className="text-wp-text-2">Stop 1 unloads first, so it loads last.</div>
          </div>

          {LOADED_STOPS.map((s) => (
            <div
              key={s.stop}
              className="flex min-h-14 items-center justify-between rounded-[10px] border border-wp-good bg-wp-good-tint px-4"
            >
              <span>
                <span className="text-wp-good">✓</span> <b>Stop {s.stop}</b> · {s.outlet} · {s.unload}
              </span>
              <span className="font-semibold text-wp-good">
                {s.lines} of {s.lines} lines
              </span>
            </div>
          ))}

          <div className="overflow-hidden rounded-[10px] border-2 border-wp-action bg-wp-surface">
            <div className="flex items-center justify-between border-b border-wp-border p-4">
              <div>
                <div className="text-xl leading-[26px] font-semibold">Stop 6 · Fresh Borella</div>
                <div className="text-wp-text-2">Unloading: curb · deliver by 07:10 · 7 of 9 lines</div>
              </div>
              <button type="button" className={PRIMARY_TOUCH_BUTTON}>
                Confirm stop
              </button>
            </div>

            {lines.map((line) =>
              line.shortBy ? (
                <ShortLine key={line.id} line={line} />
              ) : (
                <div key={line.id} className="flex min-h-16 items-center gap-4 border-b border-wp-border px-4">
                  <button
                    type="button"
                    aria-label={`${line.confirmed ? "Unconfirm" : "Confirm"} ${line.product}`}
                    aria-pressed={line.confirmed}
                    onClick={() => toggleConfirmed(line.id)}
                    className={cn(
                      "inline-flex size-10 cursor-pointer items-center justify-center rounded-lg text-[22px] font-bold",
                      line.confirmed ? "bg-wp-good text-white" : "border-2 border-wp-text-2",
                    )}
                  >
                    {line.confirmed && "✓"}
                  </button>
                  <div className="flex-1">
                    <b>{line.product}</b> · {line.quantity}
                  </div>
                  <span className="rounded-md border border-wp-border px-2 py-1 text-[13px] text-wp-text-2">
                    {line.tag}
                  </span>
                  <button
                    type="button"
                    onClick={() => onFlagOpenChange(true)}
                    className={cn(TOUCH_BUTTON, "w-[88px] px-0 text-[15px]")}
                  >
                    ⚑ Flag
                  </button>
                </div>
              ),
            )}
            <div className="flex min-h-14 items-center justify-between px-4 text-wp-text-2">
              <span>Show all 9 lines</span>
              <span>›</span>
            </div>
          </div>

          {UPCOMING_STOPS.map((s) => (
            <div key={s.stop} className={cn(CARD, "flex min-h-14 items-center justify-between px-4")}>
              <span>
                <b>Stop {s.stop}</b> · {s.outlet} · {s.unload}
              </span>
              <span className="text-wp-text-2">0 of {s.lines}</span>
            </div>
          ))}
          <div className="text-sm text-wp-muted">Stops 3, 2 and 1 follow in the same form.</div>
        </div>

        <div className="flex flex-col gap-4">
          <div className={cn(CARD, "flex flex-col gap-5 p-5")}>
            <div className="text-[13px] font-semibold tracking-[.06em] text-wp-muted">VEHICLE LOAD</div>
            <Meter label="Weight" value="1,940 of 2,800 kg · 69%" percent={69} fillClassName="bg-wp-text-2" />
            <Meter label="Volume" value="14.2 of 22.0 m³ · 65%" percent={65} fillClassName="bg-wp-text-2" />
            <div className="flex justify-between">
              <span>Refrigeration</span>
              <b>On</b>
            </div>
            <div className="flex justify-between">
              <span>Flags</span>
              <b className="text-wp-warn">▲ 1 sent</b>
            </div>
          </div>
          <div className="flex-1" />
          <div
            aria-disabled="true"
            className="flex h-[72px] items-center justify-center rounded-[10px] border border-wp-border bg-wp-surface-2 text-[17px] font-semibold text-wp-muted"
          >
            Departure check · {TOTAL_LINES - LOADED_LINES} lines remain
          </div>
        </div>
      </div>

      {flagOpen && <FlagSheet line={flagged} onClose={() => onFlagOpenChange(false)} />}
    </TabletScreen>
  );
}

function ShortLine({ line }: { line: LoadLine }) {
  return (
    <div className="border-b border-wp-border bg-wp-warn-tint px-4 py-3">
      <div className="flex min-h-14 items-center gap-4">
        <span className="inline-flex size-10 items-center justify-center rounded-lg bg-wp-warn text-xl font-bold text-wp-warn-tint">
          ▲
        </span>
        <div className="flex-1">
          <b>{line.product}</b> · {line.ordered! - line.shortBy!} of {line.ordered} crates loaded
        </div>
        <span className="rounded-md border border-wp-warn px-2 py-1 text-[13px] text-wp-text">{line.tag}</span>
        <TabletPill tone="warn" className="bg-wp-surface">
          ▲ {line.shortBy} crates short
        </TabletPill>
      </div>
      <div className="mt-1 ml-14 text-[15px] text-wp-text">Dispatcher told 04:12 · Reply: “Proceed short.”</div>
    </div>
  );
}

/** Flag sheet: opens over the list. Flags are sent to the dispatcher and loading can continue. */
function FlagSheet({ line, onClose }: { line: LoadLine; onClose: () => void }) {
  const [type, setType] = useState<(typeof FLAG_TYPES)[number]>("Short");
  const [shortBy, setShortBy] = useState(2);
  const ordered = line.ordered ?? 12;

  return (
    <div className="absolute inset-0 z-10" role="dialog" aria-modal="true" aria-labelledby="flag-sheet-title">
      <div className="absolute inset-0 bg-[rgba(5,8,13,.72)]" onClick={onClose} />
      <div className="absolute top-1/2 left-1/2 flex w-[680px] -translate-x-1/2 -translate-y-1/2 flex-col gap-5 rounded-xl border border-wp-border bg-wp-surface p-6 shadow-[0_12px_40px_rgba(0,0,0,.5)]">
        <div>
          <div id="flag-sheet-title" className="text-xl leading-[26px] font-semibold">
            Flag a line
          </div>
          <div className="text-wp-text-2">
            Stop 6 · Fresh Borella · {line.product} · {ordered} crates ordered
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {FLAG_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={type === t}
              onClick={() => setType(t)}
              className={cn(
                "inline-flex h-14 cursor-pointer items-center justify-center rounded-lg font-semibold",
                type === t ? "border-2 border-wp-action bg-wp-surface-2" : "border border-wp-border",
              )}
            >
              {type === t && "✓ "}
              {t}
            </button>
          ))}
        </div>
        {type === "Short" && (
          <div className="flex items-center justify-between">
            <div>
              <div className="font-semibold">Short by</div>
              <div className="text-[13px] text-wp-muted">
                {ordered - shortBy} of {ordered} crates loaded
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label="Fewer"
                onClick={() => setShortBy((n) => Math.max(1, n - 1))}
                className="inline-flex size-14 cursor-pointer items-center justify-center rounded-lg border border-wp-border text-[26px]"
              >
                −
              </button>
              <span className="w-24 text-center text-3xl font-bold">{shortBy}</span>
              <button
                type="button"
                aria-label="More"
                onClick={() => setShortBy((n) => Math.min(ordered, n + 1))}
                className="inline-flex size-14 cursor-pointer items-center justify-center rounded-lg border border-wp-border text-[26px]"
              >
                +
              </button>
            </div>
          </div>
        )}
        <button
          type="button"
          className="flex min-h-14 cursor-pointer items-center justify-between rounded-lg border border-dashed border-wp-border px-4"
        >
          <span>
            Add photo <span className="text-wp-muted">(optional, for damage)</span>
          </span>
          <span className="text-wp-text-2">›</span>
        </button>
        <div className="text-sm text-wp-text-2">
          Goes to the dispatcher now, and loading can continue. Without a connection it is queued and sent when you
          are back online.
        </div>
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className={cn(TOUCH_BUTTON, "px-7")}>
            Cancel
          </button>
          <button type="button" onClick={onClose} className={cn(PRIMARY_TOUCH_BUTTON, "px-8")}>
            Send flag
          </button>
        </div>
      </div>
    </div>
  );
}
