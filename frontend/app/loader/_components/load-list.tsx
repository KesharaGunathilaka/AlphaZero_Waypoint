"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  FLAG_TYPES,
  flagLabel,
  flagSummary,
  isFullyLoaded,
  progressOf,
  type FlagType,
  type LineFlag,
  type LoadLine,
  type LoadStop,
  type LoadingVehicle,
} from "./data";
import { CARD, LiveStatus, Meter, PRIMARY_TOUCH_BUTTON, TOUCH_BUTTON, TabletPill, TabletScreen, type Outbox } from "./tablet-ui";

/** Thousands separator without `toLocaleString`, which can differ server to client. */
function kg(value: number) {
  return Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function gaugeFill(percent: number) {
  if (percent >= 100) return "bg-wp-crit";
  if (percent >= 90) return "bg-wp-gauge-amber";
  return "bg-wp-text-2";
}

/** The time a flag was sent. Only ever called from a click, so never on the server. */
function clockTime() {
  return new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
}

const STOP_TONE = {
  /** Signed off with nothing flagged. */
  good: "border border-wp-good bg-wp-good-tint",
  /** Something on the stop was flagged to the dispatcher. */
  warn: "border border-wp-warn bg-wp-warn-tint",
  /** Being loaded now. */
  open: "border-2 border-wp-action bg-wp-surface",
  /** Not started. */
  idle: "border border-wp-border bg-wp-surface",
} as const;

/** A flagged stop stays amber whether or not it is signed off; the tick says which. */
function stopTone(stop: LoadStop): keyof typeof STOP_TONE {
  const progress = progressOf([stop]);
  if (progress.flags > 0) return "warn";
  if (stop.confirmed) return "good";
  if (progress.confirmed > 0) return "open";
  return "idle";
}

const STOP_ICON = { good: "✓", warn: "▲", open: "●", idle: "○" } as const;

/** L2 · Load list: loads the last stop first, with a per-line flag sheet. */
export function LoadList({
  vehicle,
  stops,
  who,
  outbox,
  onToggleLine,
  onConfirmStop,
  onFlag,
  onBack,
  onDepartureCheck,
}: {
  vehicle: LoadingVehicle;
  stops: LoadStop[];
  who: string;
  outbox: Outbox;
  onToggleLine: (stop: number, lineId: string) => void;
  onConfirmStop: (stop: number) => void;
  onFlag: (stop: number, lineId: string, flag: LineFlag | null) => void;
  onBack: () => void;
  onDepartureCheck: () => void;
}) {
  /** The stop being loaded now is open; the rest are one tap away. */
  const [openStop, setOpenStop] = useState(() => (stops.find((s) => !s.confirmed) ?? stops[0])?.stop ?? -1);
  const [flagAt, setFlagAt] = useState<{ stop: number; lineId: string } | null>(null);

  const progress = progressOf(stops);
  const ready = isFullyLoaded(progress);
  const stopsToConfirm = progress.stops - progress.stopsConfirmed;
  /** What the departure check is still waiting for: lines first, then sign-off. */
  const remainder =
    progress.outstanding > 0
      ? `${progress.outstanding} ${progress.outstanding === 1 ? "line" : "lines"} remain`
      : stopsToConfirm > 0
        ? `${stopsToConfirm} ${stopsToConfirm === 1 ? "stop" : "stops"} to confirm`
        : "";
  const percent = progress.lines ? Math.round((progress.confirmed / progress.lines) * 100) : 0;
  const weightPercent = Math.round((progress.weightKg / vehicle.capacityKg) * 100);
  const volumePercent = Math.round((progress.volumeM3 / vehicle.capacityM3) * 100);

  const flagStop = flagAt && stops.find((s) => s.stop === flagAt.stop);
  const flagLine = flagStop?.lines.find((l) => l.id === flagAt?.lineId);

  return (
    <TabletScreen label="L2 Load list" className="relative">
      <header className="flex min-h-[88px] flex-none flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-wp-border bg-wp-surface px-4 py-3 md:px-6">
        <div className="flex items-center gap-4">
          <button type="button" onClick={onBack} className={TOUCH_BUTTON}>
            ‹ Vehicles
          </button>
          <div>
            <div className="text-3xl leading-8 font-bold">{vehicle.label}</div>
            <div className="text-base font-medium text-wp-text-2">
              {vehicle.type} · departs {vehicle.departs}
            </div>
          </div>
        </div>
        <div className="w-full min-w-[220px] flex-1 md:max-w-[340px]">
          <div className="mb-2 flex justify-between">
            <b>
              {progress.confirmed} of {progress.lines} lines loaded
            </b>
            <span>{percent}%</span>
          </div>
          <div className="h-2 rounded bg-wp-surface-2">
            <div className="h-2 rounded bg-wp-text-2" style={{ width: `${percent}%` }} />
          </div>
        </div>
        <LiveStatus who={who} outbox={outbox} />
      </header>

      <div className="grid flex-1 grid-cols-1 gap-6 p-4 md:p-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex flex-col gap-3">
          <div>
            <div className="text-xl leading-[26px] font-semibold">Load in this order — last stop first</div>
            <div className="text-wp-text-2">Stop 1 unloads first, so it loads last. Tap a stop to open it.</div>
          </div>

          {stops.map((stop) => (
            <StopCard
              key={stop.stop}
              stop={stop}
              open={openStop === stop.stop}
              onToggle={() => setOpenStop((current) => (current === stop.stop ? -1 : stop.stop))}
              onToggleLine={(lineId) => onToggleLine(stop.stop, lineId)}
              onConfirmStop={() => onConfirmStop(stop.stop)}
              onFlagLine={(lineId) => setFlagAt({ stop: stop.stop, lineId })}
            />
          ))}
        </div>

        <div className="flex flex-col gap-4">
          <div className={cn(CARD, "flex flex-col gap-5 p-5")}>
            <div className="text-[13px] font-semibold tracking-[.06em] text-wp-muted">VEHICLE LOAD</div>
            <Meter
              label="Weight"
              value={`${kg(progress.weightKg)} of ${kg(vehicle.capacityKg)} kg · ${weightPercent}%`}
              percent={Math.min(weightPercent, 100)}
              fillClassName={gaugeFill(weightPercent)}
            />
            <Meter
              label="Volume"
              value={`${progress.volumeM3.toFixed(1)} of ${vehicle.capacityM3.toFixed(1)} m³ · ${volumePercent}%`}
              percent={Math.min(volumePercent, 100)}
              fillClassName={gaugeFill(volumePercent)}
            />
            <div className="flex justify-between">
              <span>Refrigeration</span>
              <b>{vehicle.refrigerated ? "On" : "Not fitted"}</b>
            </div>
            <div className="flex justify-between">
              <span>Flags</span>
              {progress.flags > 0 ? (
                <b className="text-wp-warn">▲ {progress.flags} sent</b>
              ) : (
                <b className="text-wp-muted">None</b>
              )}
            </div>
          </div>
          <div className="flex-1" />
          {/* Every line loaded or flagged, and every stop signed off. Sticks to the bottom on a portrait tablet. */}
          <button
            type="button"
            onClick={onDepartureCheck}
            disabled={!ready}
            className={cn(
              "sticky bottom-3 flex h-[72px] items-center justify-center rounded-[10px] px-4 text-center text-[17px] font-semibold shadow-lg lg:static lg:shadow-none",
              ready
                ? "cursor-pointer bg-wp-action text-wp-on-action"
                : "cursor-default border border-wp-border bg-wp-surface-2 text-wp-muted",
            )}
          >
            Departure check{remainder && ` · ${remainder}`}
          </button>
        </div>
      </div>

      {flagStop && flagLine && (
        <FlagSheet
          key={flagLine.id}
          stop={flagStop}
          line={flagLine}
          onSend={(flag) => {
            onFlag(flagStop.stop, flagLine.id, flag);
            setFlagAt(null);
          }}
          onClose={() => setFlagAt(null)}
        />
      )}
    </TabletScreen>
  );
}

/** One stop: a row when closed, its lines when open. */
function StopCard({
  stop,
  open,
  onToggle,
  onToggleLine,
  onConfirmStop,
  onFlagLine,
}: {
  stop: LoadStop;
  open: boolean;
  onToggle: () => void;
  onToggleLine: (lineId: string) => void;
  onConfirmStop: () => void;
  onFlagLine: (lineId: string) => void;
}) {
  const tone = stopTone(stop);
  const progress = progressOf([stop]);
  const icon = stop.confirmed ? "✓" : STOP_ICON[tone];

  return (
    <div className={cn("overflow-hidden rounded-[10px]", STOP_TONE[tone])}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={cn(
          "flex w-full cursor-pointer items-center justify-between gap-4 px-4 text-left",
          open ? "min-h-[72px] py-3" : "min-h-14",
        )}
      >
        <span>
          <span className={cn(open && "text-xl leading-[26px] font-semibold")}>
            <span className={cn(tone === "good" && "text-wp-good", tone === "warn" && "text-wp-warn")}>
              {icon}
            </span>{" "}
            <b>Stop {stop.stop}</b> · {stop.outlet}
            {!open && ` · ${stop.unload}`}
          </span>
          {open && (
            <span className="block text-base font-normal text-wp-text-2">
              Unloading: {stop.unload} · deliver by {stop.deliverBy} · {progress.confirmed} of {progress.lines} lines
            </span>
          )}
        </span>
        <span className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1 whitespace-nowrap">
          {stop.confirmed && progress.flags > 0 && (
            <span className="font-semibold text-wp-warn">Confirmed with a flag</span>
          )}
          {!open && (
            <span className={cn("font-semibold", tone === "good" && "text-wp-good")}>
              {progress.confirmed} of {progress.lines} lines
            </span>
          )}
          {progress.flags > 0 && <TabletPill tone="warn">▲ {progress.flags} flagged</TabletPill>}
          <span className="text-wp-text-2">{open ? "⌃" : "›"}</span>
        </span>
      </button>

      {open && (
        <div className="border-t border-wp-border bg-wp-surface">
          {stop.lines.map((line) =>
            line.flag ? (
              <FlaggedLine key={line.id} line={line} onEditFlag={() => onFlagLine(line.id)} />
            ) : (
              <LineRow
                key={line.id}
                line={line}
                onToggle={() => onToggleLine(line.id)}
                onFlag={() => onFlagLine(line.id)}
              />
            ),
          )}
          {/* After the lines: tick them off, then sign the stop off. */}
          <div className="border-t border-wp-border p-3">
            <button
              type="button"
              onClick={onConfirmStop}
              disabled={stop.confirmed}
              className={cn(PRIMARY_TOUCH_BUTTON, "w-full disabled:cursor-default disabled:opacity-60")}
            >
              {stop.confirmed
                ? "✓ Stop confirmed"
                : progress.flags > 0
                  ? `Confirm stop ${stop.stop} with ${progress.flags} flagged`
                  : progress.confirmed < progress.lines
                    ? `All loaded in full · confirm stop ${stop.stop}`
                    : `Confirm stop ${stop.stop}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function LineRow({ line, onToggle, onFlag }: { line: LoadLine; onToggle: () => void; onFlag: () => void }) {
  return (
    <div className="flex min-h-16 items-center gap-4 border-b border-wp-border px-4 last:border-b-0">
      <button
        type="button"
        aria-label={`${line.confirmed ? "Unconfirm" : "Confirm"} ${line.product}`}
        aria-pressed={line.confirmed}
        onClick={onToggle}
        className={cn(
          "inline-flex size-10 cursor-pointer items-center justify-center rounded-lg text-[22px] font-bold",
          line.confirmed ? "bg-wp-good text-white" : "border-2 border-wp-text-2",
        )}
      >
        {line.confirmed && "✓"}
      </button>
      <div className="w-20 flex-none text-right">
        <div className="text-[24px] leading-7 font-bold">{line.units}</div>
        <div className="text-[12px] text-wp-text-2">{line.unit}</div>
      </div>
      <div className="min-w-0 flex-1 text-[17px] font-semibold">{line.product}</div>
      <span className="hidden rounded-md border border-wp-border px-2 py-1 text-[13px] text-wp-text-2 sm:inline">{line.tag}</span>
      <button
        type="button"
        aria-label={`Flag ${line.product}`}
        onClick={onFlag}
        className={cn(TOUCH_BUTTON, "w-[88px] px-0 text-[15px]")}
      >
        ⚑ Flag
      </button>
    </div>
  );
}

/** A line the loader flagged: the dispatcher has it, and loading carried on. */
function FlaggedLine({ line, onEditFlag }: { line: LoadLine; onEditFlag: () => void }) {
  return (
    <div className="border-b border-wp-border bg-wp-warn-tint px-4 py-3 last:border-b-0">
      <div className="flex min-h-14 items-center gap-4">
        <span className="inline-flex size-10 items-center justify-center rounded-lg bg-wp-warn text-xl font-bold text-wp-warn-tint">
          ▲
        </span>
        <div className="flex-1">
          <b>{line.product}</b> · {flagSummary(line)}
        </div>
        <span className="rounded-md border border-wp-warn px-2 py-1 text-[13px] text-wp-text">{line.tag}</span>
        <TabletPill tone="warn" className="bg-wp-surface">
          ▲ {flagLabel(line)}
        </TabletPill>
        <button
          type="button"
          aria-label={`Change the flag on ${line.product}`}
          onClick={onEditFlag}
          className={cn(TOUCH_BUTTON, "w-[88px] border-wp-warn px-0 text-[15px] text-wp-warn")}
        >
          ⚑ Change
        </button>
      </div>
      <div className="mt-1 ml-14 text-[15px] text-wp-text">
        {line.flag?.sent ? `Sent to the dispatcher ${line.flag.at}` : "Saved on the tablet, sending…"}
        {(line.flag?.photo || line.flag?.photoFile) && " · photo attached"}
      </div>
      {line.flag?.reply && (
        <div className="mt-1 ml-14 text-[15px] font-semibold text-wp-info">Dispatcher: {line.flag.reply}</div>
      )}
    </div>
  );
}

const FLAG_HELP: Record<FlagType, string> = {
  Missing: "The line never arrived at the dock. Nothing from it goes on board.",
  Short: "Fewer units than ordered. What did arrive is loaded.",
  Damaged: "Some units are not fit to send. The rest is loaded.",
};

/** Flag sheet: opens over the list. Flags reach the dispatcher and loading continues. */
function FlagSheet({
  stop,
  line,
  onSend,
  onClose,
}: {
  stop: LoadStop;
  line: LoadLine;
  onSend: (flag: LineFlag | null) => void;
  onClose: () => void;
}) {
  const existing = line.flag;
  const [type, setType] = useState<FlagType>(existing?.type ?? "Short");
  const [units, setUnits] = useState(existing?.units ?? 1);
  const [photo, setPhoto] = useState<File | undefined>(existing?.photoFile);

  /** All of a missing line is missing; anything short of the whole line is Short. */
  const max = type === "Missing" ? line.units : Math.max(1, line.units - (type === "Short" ? 1 : 0));
  const affected = type === "Missing" ? line.units : Math.min(units, max);
  const loaded = line.units - affected;

  function chooseType(next: FlagType) {
    setType(next);
    setUnits(1);
    if (next !== "Damaged") setPhoto(undefined);
  }

  return (
    <div className="absolute inset-0 z-10" role="dialog" aria-modal="true" aria-labelledby="flag-sheet-title">
      <div className="absolute inset-0 bg-[rgba(5,8,13,.72)]" onClick={onClose} />
      <div className="absolute top-1/2 left-1/2 flex w-[680px] -translate-x-1/2 -translate-y-1/2 flex-col gap-5 rounded-xl border border-wp-border bg-wp-surface p-6 shadow-[0_12px_40px_rgba(0,0,0,.5)]">
        <div>
          <div id="flag-sheet-title" className="text-xl leading-[26px] font-semibold">
            {existing ? "Change the flag" : "Flag a line"}
          </div>
          <div className="text-wp-text-2">
            Stop {stop.stop} · {stop.outlet} · {line.product} · {line.units} {line.unit} ordered
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {FLAG_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={type === t}
              onClick={() => chooseType(t)}
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

        <div className="text-[15px] text-wp-text-2">{FLAG_HELP[type]}</div>

        {type !== "Missing" && (
          <div className="flex items-center justify-between">
            <div>
              <div className="font-semibold">{type === "Short" ? "Short by" : "Damaged"}</div>
              <div className="text-[13px] text-wp-muted">
                {loaded} of {line.units} {line.unit} {type === "Short" ? "loaded" : "fit to load"}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label="Fewer"
                onClick={() => setUnits((n) => Math.max(1, n - 1))}
                className="inline-flex size-14 cursor-pointer items-center justify-center rounded-lg border border-wp-border text-[26px]"
              >
                −
              </button>
              <span className="w-24 text-center text-3xl font-bold">{affected}</span>
              <button
                type="button"
                aria-label="More"
                onClick={() => setUnits((n) => Math.min(max, n + 1))}
                className="inline-flex size-14 cursor-pointer items-center justify-center rounded-lg border border-wp-border text-[26px]"
              >
                +
              </button>
            </div>
          </div>
        )}

        {/* A photo is only evidence of damage, so it is only offered for damage. */}
        {type === "Damaged" && (
          <label
            className={cn(
              "flex min-h-14 cursor-pointer items-center justify-between rounded-lg border border-dashed px-4",
              photo ? "border-wp-action text-wp-text" : "border-wp-border",
            )}
          >
            <span>{photo ? `✓ Photo attached · ${photo.name}` : existing?.photo ? "✓ Photo sent earlier · add another" : "Add photo"}</span>
            <span className="text-wp-text-2">{photo ? "Replace" : "›"}</span>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              aria-label={`Photo of the damaged ${line.product}`}
              onChange={(e) => setPhoto(e.target.files?.[0])}
            />
          </label>
        )}

        <div className="text-sm text-wp-text-2">
          Goes to the dispatcher now, and loading can continue. Without a connection it is queued and sent when you
          are back online.
        </div>

        <div className="flex items-center justify-end gap-3">
          {existing && !existing.sent && (
            <button type="button" onClick={() => onSend(null)} className={cn(TOUCH_BUTTON, "mr-auto px-6")}>
              Remove flag
            </button>
          )}
          <button type="button" onClick={onClose} className={cn(TOUCH_BUTTON, "px-7")}>
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSend({ type, units: affected, photo: Boolean(photo), photoFile: photo, at: clockTime() })}
            className={cn(PRIMARY_TOUCH_BUTTON, "px-8")}
          >
            {existing ? "Update flag" : "Send flag"}
          </button>
        </div>
      </div>
    </div>
  );
}
