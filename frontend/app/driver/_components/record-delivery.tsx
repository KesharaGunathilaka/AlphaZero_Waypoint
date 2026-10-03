"use client";

import { useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { CURRENT_STOP } from "./data";
import type { DriverScreen } from "./driver-nav";
import { BigButton, Body, BottomBar, Card, ChoiceTile, PhoneScreen, SectionLabel, SyncPill, TopBar } from "./phone-ui";
import { SignaturePad } from "./signature-pad";

const OUTCOMES = [
  { key: "full", icon: "✓", label: "In full" },
  { key: "part", icon: "▲", label: "In part" },
  { key: "none", icon: "✕", label: "Not delivered" },
] as const;
type Outcome = (typeof OUTCOMES)[number]["key"];

const FROZEN_LOADED = 12;
const SHORT_REASONS = ["Freezer full at store", "Damaged in transit", "Store refused", "Other"];
const REFUSED_REASONS = ["Store closed", "Nobody to receive", "Store refused the load", "Access blocked", "Other"];

const selectClass = "h-11 rounded-[10px] border border-wp-border bg-wp-surface px-3 text-base text-wp-text";

/** R3 · Record delivery: outcome, quantities, and proof. Saved on the phone until signal returns. */
export function RecordDelivery({ onNavigate }: { onNavigate: (screen: DriverScreen) => void }) {
  const [outcome, setOutcome] = useState<Outcome>("part");
  const [frozen, setFrozen] = useState(10);
  const [receivedBy, setReceivedBy] = useState(CURRENT_STOP.contact.name);
  const [signed, setSigned] = useState(false);
  const [photos, setPhotos] = useState(0);
  const photoInput = useRef<HTMLInputElement>(null);

  const delivered = outcome !== "none";
  /** Nothing left the van, so the quantities are zero whatever the steppers were set to. */
  const frozenDelivered = outcome === "full" ? FROZEN_LOADED : frozen;
  /** A signature is the proof for anything handed over; a refusal is proved by its reason. */
  const canSave = !delivered || (signed && receivedBy.trim().length > 0);

  const stepperButton =
    "flex size-11 cursor-pointer items-center justify-center rounded-[10px] border border-wp-border bg-wp-surface text-xl";

  return (
    <PhoneScreen label="R3 Record delivery">
      <TopBar>
        <button
          type="button"
          onClick={() => onNavigate("stop")}
          className="min-w-0 cursor-pointer text-left font-semibold"
        >
          <div className="truncate font-bold">‹ {CURRENT_STOP.name}</div>
          <div className="text-[13px] font-normal text-wp-text-2">Arrived 07:09</div>
        </button>
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

        {delivered ? (
          <>
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
                  frozenDelivered < FROZEN_LOADED && "bg-wp-warn-tint",
                )}
              >
                <div className="flex items-center justify-between">
                  <span>Frozen</span>
                  {outcome === "full" ? (
                    <span className="font-bold">
                      {FROZEN_LOADED} of {FROZEN_LOADED}
                    </span>
                  ) : (
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
                  )}
                </div>
                {frozenDelivered < FROZEN_LOADED && (
                  <select aria-label="Why fewer frozen crates" className={selectClass}>
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
                placeholder="Received by"
                value={receivedBy}
                onChange={(e) => setReceivedBy(e.target.value)}
                className="h-12 rounded-[10px] border border-wp-border bg-wp-surface px-3 text-base text-wp-text placeholder:text-wp-muted"
              />
              <SignaturePad signed={signed} onSignedChange={setSigned} />
              <input
                ref={photoInput}
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                className="hidden"
                onChange={(e) => setPhotos(e.target.files?.length ?? 0)}
              />
              <button
                type="button"
                onClick={() => photoInput.current?.click()}
                className="flex h-11 cursor-pointer items-center justify-center rounded-[10px] border border-wp-border font-semibold"
              >
                {photos > 0 ? `${photos} photo${photos > 1 ? "s" : ""} added · change` : "Add photo (optional)"}
              </button>
            </Card>
          </>
        ) : (
          <Card>
            <SectionLabel>WHY WAS NOTHING DELIVERED?</SectionLabel>
            <select aria-label="Why nothing was delivered" className={selectClass}>
              {REFUSED_REASONS.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
            <input
              placeholder="Add a note (optional)"
              aria-label="Add a note"
              className="h-12 rounded-[10px] border border-wp-border bg-wp-surface px-3 text-base text-wp-text placeholder:text-wp-muted"
            />
            <div className="rounded-lg bg-wp-crit-tint px-3 py-2 text-[13px] leading-[18px] font-semibold text-wp-crit">
              ✕ The full load stays on the van. Dispatch is told as soon as you have signal.
            </div>
          </Card>
        )}
      </Body>
      <BottomBar className="flex flex-col items-center gap-2">
        <BigButton className="w-full" disabled={!canSave} onClick={() => onNavigate("run")}>
          Save delivery
        </BigButton>
        <div className="text-center text-[13px] text-wp-text-2">
          {canSave ? "Saved on this phone · sends when signal returns" : "Add a name and a signature to save"}
        </div>
      </BottomBar>
    </PhoneScreen>
  );
}
