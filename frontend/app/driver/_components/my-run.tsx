"use client";

import { useState } from "react";
import { SpareBadge, minutesText, spareMinutes } from "@/components/waypoint/time-window";
import { useNow } from "@/lib/clock";
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

/** Planned driving to a stop: from the depot, or from the stop before once it is unloaded. */
function driveMinutes(trip: { depart_at: string; stops: RunStop[] }, stop: RunStop) {
  const i = trip.stops.indexOf(stop);
  const prev = trip.stops[i - 1];
  const from = prev ? Date.parse(prev.planned_arrival) + Number(prev.service_minutes) * 60_000 : Date.parse(trip.depart_at);
  return Math.max(0, Math.round((Date.parse(stop.planned_arrival) - from) / 60_000));
}

/**
 * My run. Built around one question a driver has all day: "what do I do now?"
 * The answer is a single big button at the bottom (Start trip, I'm here, Deliver), the stop it is about
 * is shown in large type above it, and everything else (map, problem, call) is one row of plain buttons.
 */
/** Messages from dispatch not yet acknowledged: on every screen the driver rests on, not only the run. */
export function DispatchMessages({ instructions, onSeen }: {
  instructions: ReturnType<typeof useRun>["instructions"]; onSeen: ReturnType<typeof useRun>["seeInstruction"];
}) {
  return (
    <>
      {instructions.map((i) => (
        <div key={i.instruction_id} className="flex flex-col gap-2 rounded-xl border-2 border-wp-info bg-wp-info-tint p-3 text-wp-info">
          <div className="text-[13px] font-semibold">MESSAGE FROM DISPATCH</div>
          <div className="text-[18px] leading-6 font-bold">{i.text ?? i.type.replaceAll("_", " ")}</div>
          <button type="button" onClick={() => onSeen(i)}
                  className="flex min-h-12 cursor-pointer items-center justify-center rounded-[10px] bg-wp-info font-semibold text-wp-surface">
            OK, got it
          </button>
        </div>
      ))}
    </>
  );
}

export function MyRun({ onNavigate }: { onNavigate: (screen: DriverScreen) => void }) {
  const { run, error, currentTrip, currentStop, instructions, seeInstruction, records, isSent, depart, arrive } = useRun();
  const [showDone, setShowDone] = useState(false);
  const now = useNow();

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

  // The one next step. Before the loader releases the van there is nothing to start: the button waits.
  let step: { label: string; sub?: string; onClick: () => void; waiting?: boolean };
  if (!currentTrip.departed && !loaded) {
    step = { label: "Waiting for the loader", sub: "The button opens when the van is released to you.", onClick: () => {}, waiting: true };
  } else if (!currentTrip.departed) {
    step = { label: "Start trip", sub: "Van is loaded and released. Tap when you drive off.", onClick: () => depart(currentTrip) };
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
        <DispatchMessages instructions={instructions} onSeen={seeInstruction} />

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
                <div className="text-[13px] text-wp-muted">Planned</div>
                <div className="text-[40px] leading-[42px] font-bold">{formatTime(stop.planned_arrival)}</div>
              </div>
              <div className="pb-1">
                <div className="text-[13px] text-wp-muted">Window</div>
                <div className="text-[20px] font-semibold">
                  {stop.opens && stop.closes ? `${stop.opens.slice(0, 5)}–${stop.closes.slice(0, 5)}` : stop.closes ? `to ${stop.closes.slice(0, 5)}` : "—"}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[14px] text-wp-text-2">
              {/* On the road and already past the planned time: spare counts from now, not from the plan. */}
              <SpareBadge spare={spareMinutes(currentTrip.departed && now.getTime() > Date.parse(stop.planned_arrival) ? now.toISOString() : stop.planned_arrival,
                                              stop.closes)} className="text-[13px]" />
              {!stop.arrivedAt && <span>≈ {minutesText(driveMinutes(currentTrip, stop))} drive {stop.seq === 1 ? "from the depot" : "from the last stop"}</span>}
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

        {/* The stops still to do are always in view, with the drive to each; done stops fold away. */}
        <div className="flex flex-shrink-0 flex-col overflow-hidden rounded-xl border border-wp-border bg-wp-surface">
          <div className="flex min-h-[48px] items-center justify-between px-4">
            <span className="font-semibold">{currentTrip.stops.length - done.length} stops to go · {done.length} done</span>
            {done.length > 0 && (
              <button type="button" onClick={() => setShowDone(!showDone)} aria-expanded={showDone}
                      className="cursor-pointer text-[13px] font-semibold text-wp-focus underline">
                {showDone ? "Hide done" : "Show done"}
              </button>
            )}
          </div>
          {waiting > 0 && (
            <div className="border-t border-wp-border px-4 py-2 text-[13px] text-wp-text-2">
              {waiting} {waiting === 1 ? "delivery" : "deliveries"} saved on the phone, not sent yet
            </div>
          )}
          {currentTrip.stops.filter((s) => showDone || s.status !== "done").map((s) => (
            <div key={s.stop_id}
                 className={cn("flex min-h-[52px] items-center justify-between gap-3 border-t border-wp-border px-4",
                               s.status === "current" && "bg-wp-info-tint font-bold")}>
              <span className="min-w-0">
                {s.status === "done" ? "✓" : s.status === "current" ? "➤" : "○"} {s.seq}. {s.outlet.name}
                {s.status !== "done" && (
                  <span className="block text-[12px] font-normal text-wp-text-2">≈ {minutesText(driveMinutes(currentTrip, s))} drive</span>
                )}
              </span>
              <span className={cn("flex-shrink-0 text-right text-[13px]", s.status !== "current" && "text-wp-text-2")}>
                {s.status === "done"
                  ? Object.values(s.outcomes).map((o) => (o === "delivered" ? "Delivered" : o === "delivered_in_part" ? "Some missing" : "Not delivered")).join(", ")
                  : formatTime(s.planned_arrival)}
              </span>
            </div>
          ))}
        </div>
      </Body>

      <BottomBar className="flex flex-col gap-2">
        <BigButton className="h-16 w-full flex-col gap-0 text-[20px]" onClick={step.onClick} disabled={step.waiting}>
          {step.waiting ? "⏳ " : ""}{step.label}
          {step.sub && <span className="text-[12px] font-normal opacity-90">{step.sub}</span>}
        </BigButton>
        {step.waiting && (
          <button type="button" className="cursor-pointer text-[13px] text-wp-text-2 underline"
                  onClick={() => {
                    if (window.confirm("Start the trip before the loader has released the van? Only do this if the dock told you to.")) depart(currentTrip);
                  }}>
            Loader can’t release it? Start anyway
          </button>
        )}
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
