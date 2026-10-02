"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { DriverScreen } from "./driver-app";
import { BigButton, Body, BottomBar, Card, PhoneScreen, SectionLabel, SyncPill, TopBar } from "./phone-ui";

const UPCOMING = [
  { glyph: "●", stop: "5 Fresh Pettah", time: "07:12", current: true },
  { glyph: "○", stop: "6 Style Slave Island", time: "07:41" },
  { glyph: "○", stop: "7 Fresh Kollupitiya", time: "08:05" },
];

function RunHeader({ offline }: { offline: boolean }) {
  return (
    <TopBar>
      <div>
        <div className="font-bold">RT-03</div>
        <div className="text-[13px] text-wp-text-2">Route 1 of 2</div>
      </div>
      <SyncPill offline={offline} />
    </TopBar>
  );
}

/** R1 · My run, while stopped (shown offline). */
export function MyRun({ onNavigate }: { onNavigate: (screen: DriverScreen) => void }) {
  const [noticeSeen, setNoticeSeen] = useState(false);

  return (
    <PhoneScreen label="R1 My run">
      <RunHeader offline />
      <Body className="gap-3">
        {!noticeSeen && (
          <div className="flex flex-col gap-2 rounded-xl border border-wp-info bg-wp-info-tint p-3 text-wp-info">
            <div className="leading-[22px] font-semibold">
              ● Stop 7 moved before stop 6. Fresh Kollupitiya opens earlier.
            </div>
            <button
              type="button"
              onClick={() => setNoticeSeen(true)}
              className="flex min-h-11 cursor-pointer items-center self-start rounded-[10px] border border-wp-info bg-wp-surface px-5 font-semibold"
            >
              Got it
            </button>
          </div>
        )}

        <Card>
          <div className="flex items-center justify-between">
            <SectionLabel>NEXT · STOP 5 OF 9</SectionLabel>
            <div className="rounded bg-wp-brand-fresh px-2 py-0.5 text-[13px] font-bold text-white">F</div>
          </div>
          <div className="text-[22px] leading-[26px] font-bold">Fresh Pettah</div>
          <div className="flex gap-6">
            <div>
              <div className="text-xs text-wp-muted">Deliver by</div>
              <div className="text-3xl leading-8 font-bold">07:30</div>
            </div>
            <div>
              <div className="text-xs text-wp-muted">Planned</div>
              <div className="leading-8 font-semibold">07:12 · 4.2 km</div>
            </div>
          </div>
          <div className="font-semibold">Unload at rear dock</div>
          <div className="rounded-lg bg-wp-warn-tint px-3 py-2 font-semibold text-wp-warn">
            ▲ Short-loaded: Chilled 2 crates short
          </div>
          <div className="grid grid-cols-2 gap-2">
            <BigButton variant="outline">Navigate</BigButton>
            <BigButton onClick={() => onNavigate("stop")}>Open stop</BigButton>
          </div>
        </Card>

        <div className="flex flex-shrink-0 flex-col overflow-hidden rounded-xl border border-wp-border bg-wp-surface">
          <div className="flex min-h-[52px] items-center justify-between border-b border-wp-border px-4 text-wp-text-2">
            <span>✓ 4 stops done</span>
            <span className="text-[13px]">2 sent · 2 saved on phone</span>
          </div>
          {UPCOMING.map((s) => (
            <div
              key={s.stop}
              className={cn(
                "flex min-h-[52px] items-center justify-between border-b border-wp-border px-4",
                s.current && "bg-wp-info-tint font-bold",
              )}
            >
              <span>
                {s.glyph} {s.stop}
              </span>
              <span className={cn("text-[13px]", !s.current && "text-wp-text-2")}>{s.time}</span>
            </div>
          ))}
          <div className="flex min-h-11 items-center px-4 text-[13px] text-wp-text-2">2 more stops</div>
        </div>
      </Body>
      <BottomBar className="grid grid-cols-2 gap-2">
        <BigButton variant="plain" onClick={() => onNavigate("problem")}>
          ⚑ Report a problem
        </BigButton>
        <BigButton variant="plain">☎ Call dispatcher</BigButton>
      </BottomBar>
    </PhoneScreen>
  );
}

/** R1 · My run, while moving: read-only so the driver is not tempted to tap. */
export function MyRunMoving() {
  return (
    <PhoneScreen label="R1 Moving">
      <RunHeader offline={false} />
      <Body>
        <div className="rounded-xl bg-wp-offline-tint p-3 leading-[22px] font-semibold text-wp-offline">
          ⊘ Moving. Park to open stops or record deliveries.
        </div>
        <Card className="flex-1 justify-center px-4 py-6">
          <SectionLabel>NEXT · STOP 5 OF 9</SectionLabel>
          <div className="text-3xl leading-[34px] font-bold">Fresh Pettah</div>
          <div className="text-3xl leading-8 font-bold">by 07:30</div>
          <div className="text-wp-text-2">4.2 km · Unload at rear dock</div>
        </Card>
      </Body>
      <BottomBar>
        <BigButton className="w-full">☎ Call dispatcher</BigButton>
      </BottomBar>
    </PhoneScreen>
  );
}
