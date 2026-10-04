"use client";

import { useState } from "react";
import { formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { BRAND_CLASS, DISPATCHER, UNLOAD_LABEL, navigationUrl } from "./data";
import type { DriverScreen } from "./driver-nav";
import { BigButton, BigLink, Body, BottomBar, Card, OfflineBanner, PhoneScreen, SectionLabel, SyncPill, TopBar } from "./phone-ui";
import { useRun, type RunStop } from "./use-run";

function RunHeader() {
  const { run, currentTrip, trips } = useRun();
  return (
    <TopBar>
      <div className="min-w-0">
        <div className="truncate font-bold">{run?.driver?.vehicle_source_id ?? currentTrip?.vehicle_code ?? "My run"}</div>
        <div className="text-[13px] text-wp-text-2">
          {currentTrip ? `Trip ${trips.indexOf(currentTrip) + 1} of ${trips.length}` : "No trip"}
        </div>
      </div>
      <SyncPill />
    </TopBar>
  );
}

/** Short-loaded lines on a stop, as the driver needs to hear it before handing over. */
export function shortLoads(stop: RunStop) {
  return stop.orders.flatMap((o) =>
    (o.lines ?? [])
      .filter((l) => stop.loaded[`${o.order_id}-${l.line_no}`] < Number(l.qty))
      .map((l) => ({ name: l.name, short: Number(l.qty) - stop.loaded[`${o.order_id}-${l.line_no}`], unit: l.unit })),
  );
}

/**
 * My run. Built around one question a driver has all day: "what do I do now?"
 * The answer is a single big button at the bottom (Start trip, I'm here, Deliver), the stop it is about
 * is shown in large type above it, and everything else (map, problem, call) is one row of plain buttons.
 */
export function MyRun({ onNavigate }: { onNavigate: (screen: DriverScreen) => void }) {
  const { run, error, currentTrip, currentStop, instructions, seeInstruction, records, isSent, depart, arrive } = useRun();
  const [showStops, setShowStops] = useState(false);

  if (!run) {
    return (
      <PhoneScreen label="My run">
        <RunHeader />
        <Body>
          <Card>
            <div className="text-[18px] font-semibold">{error ? "Can’t download your run yet" : "Downloading your run…"}</div>
            <div className="text-wp-text-2">
              {error ? "Open this screen at the depot, where there is signal. Once it is on the phone it works without signal." : "Once it is here, it works without signal."}
            </div>
          </Card>
        </Body>
      </PhoneScreen>
    );
  }

  if (!currentTrip) {
    return (
      <PhoneScreen label="My run">
        <RunHeader />
        <Body>
          <OfflineBanner />
          <Card>
            <div className="text-[18px] font-semibold">No trips for you yet</div>
            <div className="text-wp-text-2">Your trips appear here when dispatch sends the plan.</div>
          </Card>
        </Body>
        <BottomBar>
          <BigLink variant="plain" className="w-full" href={`tel:${DISPATCHER.tel}`}>☎ Call dispatcher</BigLink>
        </BottomBar>
      </PhoneScreen>
    );
  }

  const done = currentTrip.stops.filter((s) => s.status === "done");
  const mine = Object.values(records).filter((r) => r.route_id === currentTrip.route_id);
  const waiting = mine.filter((r) => !isSent(r)).length;
  const stop = currentStop;
  const short = stop ? shortLoads(stop) : [];
  const loaded = currentTrip.state === "loaded" || currentTrip.departed;

  // The one next step.
  let step: { label: string; sub?: string; onClick: () => void };
  if (!currentTrip.departed) {
    step = {
      label: "Start trip",
      sub: loaded ? "Van is loaded. Tap when you drive off." : "Still loading at the dock. Tap when you drive off.",
      onClick: () => depart(currentTrip),
    };
  } else if (stop && !stop.arrivedAt) {
    step = { label: "I’m here", sub: `Tap when you reach ${stop.outlet.code}`, onClick: () => { arrive(stop); onNavigate("deliver"); } };
  } else if (stop) {
    step = { label: "Deliver", sub: "Hand over and record it", onClick: () => onNavigate("deliver") };
  } else {
    step = { label: "Trip done", onClick: () => onNavigate("complete") };
  }

  return (
    <PhoneScreen label="My run">
      <RunHeader />
      <Body className="gap-3">
        <OfflineBanner />
        {instructions.map((i) => (
          <div key={i.instruction_id} className="flex flex-col gap-2 rounded-xl border-2 border-wp-info bg-wp-info-tint p-3 text-wp-info">
            <div className="text-[13px] font-semibold">MESSAGE FROM DISPATCH</div>
            <div className="text-[18px] leading-6 font-bold">{i.text ?? i.type.replaceAll("_", " ")}</div>
            <button type="button" onClick={() => seeInstruction(i)}
                    className="flex min-h-12 cursor-pointer items-center justify-center rounded-[10px] bg-wp-info font-semibold text-wp-surface">
              OK, got it
            </button>
          </div>
        ))}

        {stop ? (
          <Card className="gap-2">
            <div className="flex items-center justify-between">
              <SectionLabel>
                {currentTrip.departed ? "NEXT STOP" : "FIRST STOP"} · {stop.seq} OF {currentTrip.stops.length}
              </SectionLabel>
              <div className={cn("rounded px-2 py-0.5 text-[13px] font-bold text-white", BRAND_CLASS[stop.outlet.brand])}>{stop.outlet.brand}</div>
            </div>
            <div className="text-[26px] leading-[30px] font-bold">{stop.outlet.name}</div>
            <div className="flex items-end gap-6">
              <div>
                <div className="text-[13px] text-wp-muted">Arrive by</div>
                <div className="text-[40px] leading-[42px] font-bold">{stop.closes?.slice(0, 5) ?? "—"}</div>
              </div>
              <div className="pb-1">
                <div className="text-[13px] text-wp-muted">Plan</div>
                <div className="text-[20px] font-semibold">{formatTime(stop.planned_arrival)}</div>
              </div>
            </div>
            <div className="text-[16px]">
              Unload: <b>{UNLOAD_LABEL[stop.outlet.unload]}</b>
              {stop.orders.some((o) => o.temp === "chilled") && <b className="text-wp-info"> · ❄ Chilled</b>}
            </div>
            {stop.opens && !stop.arrivedAt && (
              <div className="text-[13px] text-wp-text-2">Store opens for delivery at {stop.opens.slice(0, 5)}. Early? Wait until then.</div>
            )}
            {short.length > 0 && (
              <div className="rounded-lg bg-wp-warn-tint px-3 py-2 font-semibold text-wp-warn">
                ▲ Loaded short: {short.map((s) => `${s.name} (${s.short} missing)`).join(", ")}. The store knows.
              </div>
            )}
            <button type="button" onClick={() => onNavigate("stop")} className="self-start py-1 font-semibold text-wp-focus underline">
              Access, contact and what’s on board
            </button>
          </Card>
        ) : (
          <Card>
            <div className="text-[20px] font-bold">✓ All stops on this trip are done</div>
          </Card>
        )}

        <div className="flex flex-shrink-0 flex-col overflow-hidden rounded-xl border border-wp-border bg-wp-surface">
          <button type="button" onClick={() => setShowStops(!showStops)} aria-expanded={showStops}
                  className="flex min-h-[52px] cursor-pointer items-center justify-between px-4 text-left">
            <span className="font-semibold">✓ {done.length} of {currentTrip.stops.length} stops done</span>
            <span className="text-[13px] text-wp-text-2">
              {waiting ? `${waiting} ${waiting === 1 ? "delivery" : "deliveries"} not sent · ` : ""}{showStops ? "Hide" : "Show all"}
            </span>
          </button>
          {showStops && currentTrip.stops.map((s) => (
            <div key={s.stop_id}
                 className={cn("flex min-h-[52px] items-center justify-between border-t border-wp-border px-4",
                               s.status === "current" && "bg-wp-info-tint font-bold")}>
              <span>
                {s.status === "done" ? "✓" : s.status === "current" ? "➤" : "○"} {s.seq}. {s.outlet.name}
              </span>
              <span className={cn("text-[13px]", s.status !== "current" && "text-wp-text-2")}>
                {s.status === "done"
                  ? Object.values(s.outcomes).map((o) => (o === "delivered" ? "Delivered" : o === "delivered_in_part" ? "Some missing" : "Not delivered")).join(", ")
                  : formatTime(s.planned_arrival)}
              </span>
            </div>
          ))}
        </div>
      </Body>

      <BottomBar className="flex flex-col gap-2">
        <BigButton className="h-16 w-full flex-col gap-0 text-[20px]" onClick={step.onClick}>
          {step.label}
          {step.sub && <span className="text-[12px] font-normal opacity-90">{step.sub}</span>}
        </BigButton>
        <div className="grid grid-cols-3 gap-2">
          {stop ? (
            <BigLink variant="plain" className="h-12 text-[14px]" href={navigationUrl(stop)} target="_blank" rel="noreferrer">🧭 Map</BigLink>
          ) : (
            <span />
          )}
          <BigButton variant="plain" className="h-12 text-[14px]" onClick={() => onNavigate("problem")}>⚑ Problem</BigButton>
          <BigLink variant="plain" className="h-12 text-[14px]" href={`tel:${DISPATCHER.tel}`}>☎ Call</BigLink>
        </div>
      </BottomBar>
    </PhoneScreen>
  );
}
