"use client";

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
      <div>
        <div className="font-bold">{run?.driver?.vehicle_source_id ?? currentTrip?.vehicle_code ?? "My run"}</div>
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

/** R1 · My run, while stopped. */
export function MyRun({ onNavigate }: { onNavigate: (screen: DriverScreen) => void }) {
  const { run, error, currentTrip, currentStop, instructions, seeInstruction, records, isSent } = useRun();

  if (!run) {
    return (
      <PhoneScreen label="R1 My run">
        <RunHeader />
        <Body>
          <Card>
            <div className="font-semibold">{error ? "Can’t download your run yet." : "Downloading your run…"}</div>
            <div className="text-wp-text-2">
              {error ? `${error} Open this screen at the depot, where there is signal, and it is kept on the phone.` : "Once it is here, it works without signal."}
            </div>
          </Card>
        </Body>
      </PhoneScreen>
    );
  }

  if (!currentTrip) {
    return (
      <PhoneScreen label="R1 My run">
        <RunHeader />
        <Body>
          <OfflineBanner />
          <Card>
            <div className="font-semibold">No trips for you yet.</div>
            <div className="text-wp-text-2">Your trips appear here once dispatch releases the plan and your vehicle is loaded.</div>
          </Card>
        </Body>
      </PhoneScreen>
    );
  }

  const done = currentTrip.stops.filter((s) => s.status === "done");
  const mine = Object.values(records).filter((r) => r.route_id === currentTrip.route_id);
  const waiting = mine.filter((r) => !isSent(r)).length;
  const stop = currentStop;
  const short = stop ? shortLoads(stop) : [];

  return (
    <PhoneScreen label="R1 My run">
      <RunHeader />
      <Body className="gap-3">
        <OfflineBanner />
        {instructions.map((i) => (
          <div key={i.instruction_id} className="flex flex-col gap-2 rounded-xl border border-wp-info bg-wp-info-tint p-3 text-wp-info">
            <div className="leading-[22px] font-semibold">● Dispatch: {i.text ?? i.type.replaceAll("_", " ")}</div>
            <button type="button" onClick={() => seeInstruction(i)}
                    className="flex min-h-11 cursor-pointer items-center self-start rounded-[10px] border border-wp-info bg-wp-surface px-5 font-semibold">
              Got it
            </button>
          </div>
        ))}
        {!currentTrip.departed && (
          <div className="rounded-xl bg-wp-info-tint p-3 text-[13px] leading-[18px] font-semibold text-wp-info">
            ● {currentTrip.state === "loaded" ? "Loaded and released by the dock." : "Still being loaded at the dock."} Departs{" "}
            {formatTime(currentTrip.depart_at)}.
          </div>
        )}

        {stop && (
          <Card>
            <div className="flex items-center justify-between">
              <SectionLabel>
                NEXT · STOP {stop.seq} OF {currentTrip.stops.length}
              </SectionLabel>
              <div className={cn("rounded px-2 py-0.5 text-[13px] font-bold text-white", BRAND_CLASS[stop.outlet.brand])}>{stop.outlet.brand}</div>
            </div>
            <div className="text-[22px] leading-[26px] font-bold">{stop.outlet.name}</div>
            <div className="flex gap-6">
              <div>
                <div className="text-xs text-wp-muted">Deliver by</div>
                <div className="text-3xl leading-8 font-bold">{stop.closes?.slice(0, 5) ?? "—"}</div>
              </div>
              <div>
                <div className="text-xs text-wp-muted">Planned</div>
                <div className="leading-8 font-semibold">{formatTime(stop.planned_arrival)}</div>
              </div>
            </div>
            <div className="font-semibold">Unload: {UNLOAD_LABEL[stop.outlet.unload]}</div>
            {short.length > 0 && (
              <div className="rounded-lg bg-wp-warn-tint px-3 py-2 font-semibold text-wp-warn">
                ▲ Short-loaded: {short.map((s) => `${s.name} ${s.short} short`).join(", ")}
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <BigLink variant="outline" href={navigationUrl(stop)} target="_blank" rel="noreferrer">
                Navigate
              </BigLink>
              <BigButton onClick={() => onNavigate("stop")}>Open stop</BigButton>
            </div>
          </Card>
        )}

        <div className="flex flex-shrink-0 flex-col overflow-hidden rounded-xl border border-wp-border bg-wp-surface">
          <div className="flex min-h-[52px] items-center justify-between border-b border-wp-border px-4 text-wp-text-2">
            <span>✓ {done.length} of {currentTrip.stops.length} stops done</span>
            {mine.length > 0 && (
              <span className="text-[13px]">
                {mine.length - waiting} sent · {waiting} saved on phone
              </span>
            )}
          </div>
          {currentTrip.stops.map((s) => (
            <div key={s.stop_id}
                 className={cn("flex min-h-[52px] items-center justify-between border-b border-wp-border px-4 last:border-b-0",
                               s.status === "current" && "bg-wp-info-tint font-bold")}>
              <span>
                {s.status === "done" ? "✓" : s.status === "current" ? "●" : "○"} {s.seq} {s.outlet.name}
              </span>
              <span className={cn("text-[13px]", s.status !== "current" && "text-wp-text-2")}>
                {s.status === "done" ? Object.values(s.outcomes).map((o) => (o === "delivered" ? "Delivered" : o === "delivered_in_part" ? "In part" : "Not delivered")).join(", ") : formatTime(s.planned_arrival)}
              </span>
            </div>
          ))}
        </div>
      </Body>
      <BottomBar className="grid grid-cols-2 gap-2">
        <BigButton variant="plain" onClick={() => onNavigate("problem")}>
          ⚑ Report a problem
        </BigButton>
        <BigLink variant="plain" href={`tel:${DISPATCHER.tel}`}>
          ☎ Call dispatcher
        </BigLink>
      </BottomBar>
    </PhoneScreen>
  );
}

/** R1 · My run, while moving: read-only so the driver is not tempted to tap. */
export function MyRunMoving({ onNavigate }: { onNavigate: (screen: DriverScreen) => void }) {
  const { currentTrip, currentStop } = useRun();
  return (
    <PhoneScreen label="R1 Moving">
      <RunHeader />
      <Body>
        <div className="rounded-xl bg-wp-offline-tint p-3 leading-[22px] font-semibold text-wp-offline">
          ⊘ Moving. Park to open stops or record deliveries.
        </div>
        {currentStop && currentTrip ? (
          <Card className="flex-1 justify-center px-4 py-6">
            <SectionLabel>
              NEXT · STOP {currentStop.seq} OF {currentTrip.stops.length}
            </SectionLabel>
            <div className="text-3xl leading-[34px] font-bold">{currentStop.outlet.name}</div>
            <div className="text-3xl leading-8 font-bold">by {currentStop.closes?.slice(0, 5) ?? "—"}</div>
            <div className="text-wp-text-2">Planned {formatTime(currentStop.planned_arrival)} · {UNLOAD_LABEL[currentStop.outlet.unload]}</div>
          </Card>
        ) : (
          <Card className="flex-1 justify-center">No stop to drive to.</Card>
        )}
      </Body>
      <BottomBar className="flex flex-col gap-2">
        <BigLink className="w-full" href={`tel:${DISPATCHER.tel}`}>
          ☎ Call dispatcher
        </BigLink>
        <BigButton variant="plain" className="h-11 w-full" onClick={() => onNavigate("run")}>
          I’ve parked · back to my run
        </BigButton>
      </BottomBar>
    </PhoneScreen>
  );
}
