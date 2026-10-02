"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { BigButton, Body, BottomBar, Card, ChoiceTile, PhoneScreen, SectionLabel, SyncPill, TopBar } from "./phone-ui";

const OUTCOMES = [
  { key: "full", icon: "✓", label: "In full" },
  { key: "part", icon: "▲", label: "In part" },
  { key: "none", icon: "✕", label: "Not delivered" },
] as const;
type Outcome = (typeof OUTCOMES)[number]["key"];

const FROZEN_LOADED = 12;
const SHORT_REASONS = ["Freezer full at store", "Damaged in transit", "Store refused", "Other"];

/** R3 · Record delivery: outcome, quantities, and proof. Saved on the phone until signal returns. */
export function RecordDelivery({ onSaved }: { onSaved: () => void }) {
  const [outcome, setOutcome] = useState<Outcome>("part");
  const [frozen, setFrozen] = useState(10);

  const stepperButton =
    "flex size-11 cursor-pointer items-center justify-center rounded-[10px] border border-wp-border bg-wp-surface text-xl";

  return (
    <PhoneScreen label="R3 Record delivery">
      <TopBar>
        <div>
          <div className="font-bold">Fresh Pettah</div>
          <div className="text-[13px] text-wp-text-2">Arrived 07:09</div>
        </div>
        <SyncPill offline />
      </TopBar>
      <Body>
        <div className="grid grid-cols-3 gap-2">
          {OUTCOMES.map((o) => (
            <ChoiceTile
              key={o.key}
              selected={outcome === o.key}
              selectedClassName={
                o.key === "full"
                  ? "border-2 border-wp-good bg-wp-good-tint text-wp-good font-bold"
                  : o.key === "part"
                    ? "border-2 border-wp-warn bg-wp-warn-tint text-wp-warn font-bold"
                    : "border-2 border-wp-crit bg-wp-crit-tint text-wp-crit font-bold"
              }
              onClick={() => setOutcome(o.key)}
              className="flex-col gap-1 text-[13px]"
            >
              <span className="text-xl">{o.icon}</span>
              {o.label}
            </ChoiceTile>
          ))}
        </div>

        <Card>
          <SectionLabel>QUANTITIES (CRATES)</SectionLabel>
          <div className="flex min-h-11 items-center justify-between">
            <span>Ambient</span>
            <span className="font-bold">24 of 24</span>
          </div>
          <div className="flex min-h-11 items-center justify-between">
            <span>Chilled</span>
            <span className="font-bold">18 of 18</span>
          </div>
          <div
            className={cn(
              "flex flex-col gap-2 rounded-lg px-3 py-2",
              frozen < FROZEN_LOADED && "bg-wp-warn-tint",
            )}
          >
            <div className="flex items-center justify-between">
              <span>Frozen</span>
              <span className="flex items-center gap-2">
                <button
                  type="button"
                  aria-label="Fewer frozen crates"
                  className={stepperButton}
                  onClick={() => setFrozen((n) => Math.max(0, n - 1))}
                >
                  −
                </button>
                <span className="min-w-14 text-center font-bold">
                  {frozen} of {FROZEN_LOADED}
                </span>
                <button
                  type="button"
                  aria-label="More frozen crates"
                  className={stepperButton}
                  onClick={() => setFrozen((n) => Math.min(FROZEN_LOADED, n + 1))}
                >
                  +
                </button>
              </span>
            </div>
            {frozen < FROZEN_LOADED && (
              <select
                aria-label="Why fewer frozen crates"
                className="h-11 rounded-[10px] border border-wp-border bg-wp-surface px-3 text-base text-wp-text"
              >
                {SHORT_REASONS.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            )}
          </div>
        </Card>

        <Card>
          <SectionLabel>PROOF · SIGNATURE REQUIRED (REAR DOCK)</SectionLabel>
          <input
            aria-label="Received by"
            defaultValue="Nimal Perera"
            className="h-12 rounded-[10px] border border-wp-border bg-wp-surface px-3 text-base text-wp-text"
          />
          <div className="flex h-[88px] items-center justify-center rounded-[10px] border border-dashed border-wp-muted text-wp-muted">
            Sign here
          </div>
          <button
            type="button"
            className="flex h-11 cursor-pointer items-center justify-center rounded-[10px] border border-wp-border font-semibold"
          >
            Add photo (optional)
          </button>
        </Card>
      </Body>
      <BottomBar className="flex flex-col items-center gap-2">
        <BigButton className="w-full" onClick={onSaved}>
          Save delivery
        </BigButton>
        <div className="text-[13px] text-wp-text-2">Saved on this phone · sends when signal returns</div>
      </BottomBar>
    </PhoneScreen>
  );
}
