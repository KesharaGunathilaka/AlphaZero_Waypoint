"use client";

import { useState } from "react";
import type { DriverScreen } from "./driver-nav";
import { BigButton, Body, BottomBar, Card, PhoneScreen, SectionLabel, SyncPill, TopBar } from "./phone-ui";

/** How route 1's nine stops finished. */
const ROUTE_OUTCOMES = [
  ["Delivered in full", "7"],
  ["Delivered in part", "1"],
  ["Not delivered", "1"],
] as const;

/** Both routes together, for the driver checking their own day. */
const DAY_SO_FAR = [
  ["Routes done", "1 of 2"],
  ["Stops done", "9 of 15"],
  ["Records waiting to send", "2"],
  ["On the road since", "05:40"],
] as const;

function TallyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3">
      <span>{label}</span>
      <span className="text-right font-bold">{value}</span>
    </div>
  );
}

/** R1 · Route complete: how the route finished, and what the driver does next. */
export function RouteComplete({ onNavigate }: { onNavigate: (screen: DriverScreen) => void }) {
  const [dayOpen, setDayOpen] = useState(false);

  return (
    <PhoneScreen label="R1 Route complete">
      <TopBar>
        <div>
          <div className="font-bold">RT-03</div>
          <div className="text-[13px] text-wp-text-2">Route 1 of 2</div>
        </div>
        <SyncPill offline pending={2} />
      </TopBar>
      <Body>
        <Card>
          <SectionLabel>ROUTE 1 DONE</SectionLabel>
          <div className="text-[34px] leading-[38px] font-bold">9 of 9 stops</div>
          <div className="text-wp-text-2">2 to send · saved on this phone</div>
          {ROUTE_OUTCOMES.map(([label, value]) => (
            <TallyRow key={label} label={label} value={value} />
          ))}
        </Card>

        <Card>
          <SectionLabel>NEXT</SectionLabel>
          <div className="text-[22px] leading-[26px] font-bold">Route 2 of 2</div>
          <div className="text-wp-text-2">6 stops · first at 09:40</div>
        </Card>

        {dayOpen && (
          <Card>
            <SectionLabel>DAY SO FAR</SectionLabel>
            {DAY_SO_FAR.map(([label, value]) => (
              <TallyRow key={label} label={label} value={value} />
            ))}
          </Card>
        )}
      </Body>
      <BottomBar className="flex flex-col gap-2">
        <BigButton className="w-full" onClick={() => onNavigate("run")}>
          Start Route 2
        </BigButton>
        <BigButton variant="outline" className="w-full" onClick={() => setDayOpen((open) => !open)}>
          {dayOpen ? "Hide day summary" : "Day summary"}
        </BigButton>
      </BottomBar>
    </PhoneScreen>
  );
}
