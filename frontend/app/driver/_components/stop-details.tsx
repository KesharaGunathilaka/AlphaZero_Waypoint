"use client";

import type { DriverScreen } from "./driver-app";
import { BigButton, Body, BottomBar, Card, PhoneScreen, SectionLabel, SyncPill, TopBar } from "./phone-ui";

/** R2 · Stop details: where to unload, who to ask for, and what is on board for this stop. */
export function StopDetails({ onNavigate }: { onNavigate: (screen: DriverScreen) => void }) {
  return (
    <PhoneScreen label="R2 Stop details">
      <TopBar>
        <button type="button" onClick={() => onNavigate("run")} className="cursor-pointer font-semibold">
          ‹ My run
        </button>
        <SyncPill offline />
      </TopBar>
      <Body>
        <div className="flex flex-col gap-1">
          <SectionLabel>STOP 5 OF 9</SectionLabel>
          <div className="text-3xl leading-[34px] font-bold">Fresh Pettah</div>
          <div className="flex gap-4">
            <span className="font-bold">Deliver by 07:30</span>
            <span className="text-wp-text-2">Planned 07:12</span>
          </div>
          <div className="text-[13px] text-wp-text-2">Store opens at 06:00</div>
        </div>

        <Card>
          <div>
            <div className="text-xs text-wp-muted">Unload at</div>
            <div className="text-[22px] leading-[26px] font-bold">Rear dock</div>
          </div>
          <div>
            <div className="text-xs text-wp-muted">Access</div>
            <div className="leading-[22px]">Enter from Prince St. Gate code 4471. Dock 2 is the chilled bay.</div>
          </div>
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-xs text-wp-muted">Store contact</div>
              <div className="font-semibold">Nimal Perera</div>
            </div>
            <button
              type="button"
              className="flex h-11 cursor-pointer items-center rounded-[10px] border border-wp-action px-4 font-semibold text-wp-action"
            >
              ☎ Call
            </button>
          </div>
        </Card>

        <Card className="gap-2">
          <SectionLabel>DELIVERING HERE</SectionLabel>
          <div className="flex min-h-8 items-center justify-between">
            <span>Ambient</span>
            <span className="font-bold">24 crates</span>
          </div>
          <div className="flex min-h-8 items-center justify-between">
            <span>Chilled</span>
            <span className="font-bold text-wp-warn">▲ 18 of 20 crates</span>
          </div>
          <div className="flex min-h-8 items-center justify-between">
            <span>Frozen</span>
            <span className="font-bold">12 crates</span>
          </div>
          <div className="rounded-lg bg-wp-warn-tint px-3 py-2 text-[13px] leading-[18px] font-semibold text-wp-warn">
            ▲ Chilled is 2 crates short. The store has been told.
          </div>
        </Card>
      </Body>
      <BottomBar className="flex flex-col items-center gap-2">
        <BigButton className="w-full" onClick={() => onNavigate("deliver")}>
          I’ve arrived
        </BigButton>
        <button
          type="button"
          onClick={() => onNavigate("problem")}
          className="flex min-h-11 cursor-pointer items-center font-semibold text-wp-action underline"
        >
          Can’t deliver? Report a problem
        </button>
      </BottomBar>
    </PhoneScreen>
  );
}
