"use client";

import { useState } from "react";
import { formatTime } from "@/lib/format";
import type { DriverScreen } from "./driver-nav";
import { BigButton, Body, BottomBar, Card, OfflineBanner, PhoneScreen, SectionLabel, SyncPill, TopBar } from "./phone-ui";
import { useRun, type RunTrip } from "./use-run";

function TallyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3">
      <span>{label}</span>
      <span className="text-right font-bold">{value}</span>
    </div>
  );
}

function tally(trip: RunTrip) {
  const outcomes = trip.stops.flatMap((s) => Object.values(s.outcomes));
  return [
    ["Delivered in full", outcomes.filter((o) => o === "delivered").length],
    ["Delivered in part", outcomes.filter((o) => o === "delivered_in_part").length],
    ["Not delivered", outcomes.filter((o) => o === "not_delivered").length],
  ] as const;
}

/** R1 · Route complete: how the trip finished, and what the driver does next. */
export function RouteComplete({ onNavigate }: { onNavigate: (screen: DriverScreen) => void }) {
  const { trips, records, isSent, depart, run } = useRun();
  const [dayOpen, setDayOpen] = useState(false);
  const finished = [...trips].reverse().find((t) => t.done) ?? null;
  const next = trips.find((t) => !t.done) ?? null;
  const waiting = Object.values(records).filter((r) => !isSent(r)).length;

  return (
    <PhoneScreen label="R1 Route complete">
      <TopBar>
        <div>
          <div className="font-bold">{run?.driver?.vehicle_source_id ?? "My run"}</div>
          <div className="text-[13px] text-wp-text-2">{finished ? `Trip ${trips.indexOf(finished) + 1} of ${trips.length}` : ""}</div>
        </div>
        <SyncPill />
      </TopBar>
      <Body>
        <OfflineBanner />
        {finished && (
          <Card>
            <SectionLabel>TRIP {trips.indexOf(finished) + 1} DONE</SectionLabel>
            <div className="text-[34px] leading-[38px] font-bold">
              {finished.stops.length} of {finished.stops.length} stops
            </div>
            <div className="text-wp-text-2">{waiting ? `${waiting} to send · saved on this phone` : "Everything sent"}</div>
            {tally(finished).map(([label, value]) => (
              <TallyRow key={label} label={`${label} (orders)`} value={String(value)} />
            ))}
          </Card>
        )}
        {next ? (
          <Card>
            <SectionLabel>NEXT</SectionLabel>
            <div className="text-[22px] leading-[26px] font-bold">Trip {trips.indexOf(next) + 1} of {trips.length}</div>
            <div className="text-wp-text-2">
              {next.stops.length} stops · departs {formatTime(next.depart_at)}
              {next.state !== "loaded" && !next.departed ? " · still being loaded at the dock" : ""}
            </div>
          </Card>
        ) : (
          <Card>
            <SectionLabel>DAY DONE</SectionLabel>
            <div className="text-[22px] leading-[26px] font-bold">All trips finished</div>
            <div className="text-wp-text-2">Head back to the depot. Keep the app open until everything is sent.</div>
          </Card>
        )}
        {dayOpen && (
          <Card>
            <SectionLabel>DAY SO FAR</SectionLabel>
            <TallyRow label="Trips done" value={`${trips.filter((t) => t.done).length} of ${trips.length}`} />
            <TallyRow label="Stops done" value={`${trips.flatMap((t) => t.stops).filter((s) => s.status === "done").length} of ${trips.flatMap((t) => t.stops).length}`} />
            <TallyRow label="Records waiting to send" value={String(waiting)} />
          </Card>
        )}
      </Body>
      <BottomBar className="flex flex-col gap-2">
        {next && (
          <BigButton className="w-full" onClick={() => { depart(next); onNavigate("run"); }}>
            Start trip {trips.indexOf(next) + 1}
          </BigButton>
        )}
        <BigButton variant="outline" className="w-full" onClick={() => setDayOpen((open) => !open)}>
          {dayOpen ? "Hide day summary" : "Day summary"}
        </BigButton>
      </BottomBar>
    </PhoneScreen>
  );
}
