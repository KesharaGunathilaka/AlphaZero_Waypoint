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

/** Clock reading written onto the record; the prototype runs on a fixed morning. */
const RECORDED_AT = "07:21";

/** Each outcome is its own screen in the spec, so each carries its own label. */
const SCREEN_LABEL: Record<Outcome, string> = {
  full: "R3 Delivered in full",
  part: "R3 Record delivery (in part)",
  none: "R3 Not delivered",
};

const FROZEN_LOADED = 12;
const SHORT_REASONS = ["Freezer full at store", "Damaged in transit", "Store refused", "Other"];
const NOT_DELIVERED_REASONS = ["Outlet closed", "Access blocked", "Refused", "Window missed"];

const fieldClass = "h-12 rounded-[10px] border border-wp-border bg-wp-surface px-3 text-base text-wp-text";

/** R3 · Record delivery: outcome, quantities, and proof. Saved on the phone until signal returns. */
export function RecordDelivery({ onNavigate }: { onNavigate: (screen: DriverScreen) => void }) {
  const [outcome, setOutcome] = useState<Outcome>("part");
  const [frozen, setFrozen] = useState(10);
  const [reason, setReason] = useState(NOT_DELIVERED_REASONS[1]);
  const [receivedBy, setReceivedBy] = useState(CURRENT_STOP.contact.name);
  const [signature, setSignature] = useState<string | null>(null);
  const [photos, setPhotos] = useState(0);
  /** Set once the record is written to the phone; cleared by "Edit record". */
  const [saved, setSaved] = useState(false);
  const photoInput = useRef<HTMLInputElement>(null);

  const delivered = outcome !== "none";
  const frozenShort = outcome === "part" && frozen < FROZEN_LOADED;
  const frozenDelivered = outcome === "full" ? FROZEN_LOADED : frozen;

  if (saved) {
    return (
      <DeliverySaved
        outcome={outcome}
        frozen={frozenDelivered}
        receivedBy={receivedBy}
        reason={reason}
        onEdit={() => setSaved(false)}
        onNextStop={() => onNavigate("run")}
      />
    );
  }

  const stepperButton =
    "flex size-11 cursor-pointer items-center justify-center rounded-[10px] border border-wp-border bg-wp-surface text-xl";

  const addPhoto = (
    <>
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
    </>
  );

  return (
    <PhoneScreen label={SCREEN_LABEL[outcome]}>
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
              // Only a part-delivery is a warning; the other two are clean outcomes.
              selectedClassName={
                o.key === "part" ? "border-2 border-wp-warn bg-wp-warn-tint font-bold text-wp-warn" : undefined
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
              <SectionLabel>{outcome === "full" ? "DELIVERING (CRATES)" : "QUANTITIES (CRATES)"}</SectionLabel>
              <div className="flex min-h-11 items-center justify-between">
                <span>Ambient</span>
                <span className="font-bold">24 of 24</span>
              </div>
              <div className="flex min-h-11 items-center justify-between">
                <span>Chilled</span>
                <span className="font-bold">18 of 18</span>
              </div>
              {outcome === "full" ? (
                <div className="flex min-h-11 items-center justify-between">
                  <span>Frozen</span>
                  <span className="font-bold">
                    {FROZEN_LOADED} of {FROZEN_LOADED}
                  </span>
                </div>
              ) : (
                // The tint and the reason only appear once the count drops below the load.
                <div className={cn("flex flex-col gap-2", frozenShort && "rounded-lg bg-wp-warn-tint px-3 py-2")}>
                  <div className="flex min-h-11 items-center justify-between">
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
                  {frozenShort && (
                    <select aria-label="Why fewer frozen crates" className={cn(fieldClass, "h-11")}>
                      {SHORT_REASONS.map((r) => (
                        <option key={r}>{r}</option>
                      ))}
                    </select>
                  )}
                </div>
              )}
            </Card>

            <Card>
              <SectionLabel>PROOF · SIGNATURE REQUIRED (REAR DOCK)</SectionLabel>
              <div className={cn(fieldClass, "flex items-center gap-2")}>
                <span className="flex-shrink-0 text-wp-text-2">Received by:</span>
                <input
                  aria-label="Received by"
                  value={receivedBy}
                  onChange={(e) => setReceivedBy(e.target.value)}
                  className="min-w-0 flex-1 bg-transparent text-base text-wp-text outline-none"
                />
              </div>
              <SignaturePad value={signature} onChange={setSignature} />
              {addPhoto}
            </Card>
          </>
        ) : (
          <>
            <Card>
              <SectionLabel>REASON</SectionLabel>
              {NOT_DELIVERED_REASONS.map((r) => (
                <ChoiceTile
                  key={r}
                  selected={reason === r}
                  onClick={() => setReason(r)}
                  className="min-h-[52px] justify-start gap-2 px-4 text-left"
                >
                  <span className="w-4 text-center">{reason === r ? "✓" : "○"}</span>
                  {r}
                </ChoiceTile>
              ))}
              <input placeholder="Add a note (optional)" aria-label="Add a note" className={fieldClass} />
            </Card>

            <Card>
              <SectionLabel>PROOF</SectionLabel>
              {addPhoto}
            </Card>
          </>
        )}
      </Body>
      <BottomBar className="flex flex-col items-center gap-2">
        <BigButton className="w-full" onClick={() => setSaved(true)}>
          Save delivery
        </BigButton>
        <div className="text-center text-[13px] text-wp-text-2">
          Saved on this phone · sends when signal returns
        </div>
      </BottomBar>
    </PhoneScreen>
  );
}

function RecordRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3">
      <span>{label}</span>
      <span className="text-right font-bold">{value}</span>
    </div>
  );
}

/**
 * R3 · Saved, awaiting sync. The driver's receipt for what went onto the phone,
 * and the last chance to change it before dispatch ever sees it.
 */
function DeliverySaved({
  outcome,
  frozen,
  receivedBy,
  reason,
  onEdit,
  onNextStop,
}: {
  outcome: Outcome;
  frozen: number;
  receivedBy: string;
  reason: string;
  onEdit: () => void;
  onNextStop: () => void;
}) {
  const { icon, label } = OUTCOMES.find((o) => o.key === outcome)!;
  const delivered = outcome !== "none";

  return (
    <PhoneScreen label="R3 Saved, awaiting sync">
      <TopBar>
        <div className="min-w-0">
          <div className="truncate font-bold">{CURRENT_STOP.name}</div>
          <div className="text-[13px] text-wp-text-2">Arrived 07:09</div>
        </div>
        <SyncPill offline />
      </TopBar>
      <Body>
        <div className="rounded-xl bg-wp-offline-tint p-3 leading-[22px] font-semibold text-wp-offline">
          ○ Saved on this phone. Not sent yet.
        </div>

        <Card>
          <SectionLabel>DELIVERY RECORD</SectionLabel>
          <RecordRow label="Outcome" value={`${icon} ${label}`} />
          {delivered ? (
            <>
              <RecordRow label="Frozen" value={`${frozen} of ${FROZEN_LOADED}`} />
              <RecordRow label="Received by" value={receivedBy} />
            </>
          ) : (
            <RecordRow label="Reason" value={reason} />
          )}
          <RecordRow label="Recorded" value={`${RECORDED_AT} (phone)`} />
        </Card>

        <p className="leading-[22px] text-wp-text-2">
          You can edit this record until it is sent. After that, an edit adds a correction beside the original.
        </p>
      </Body>
      <BottomBar className="flex flex-col gap-2">
        <BigButton className="w-full" onClick={onNextStop}>
          Next stop
        </BigButton>
        <BigButton variant="outline" className="w-full" onClick={onEdit}>
          Edit record
        </BigButton>
      </BottomBar>
    </PhoneScreen>
  );
}
