"use client";

import { useRef, useState } from "react";
import { formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { NOT_DELIVERED_REASONS, SHORT_REASONS, type LocalRecord, type Outcome, type SnapshotOrder } from "./data";
import type { DriverScreen } from "./driver-nav";
import { BigButton, Body, BottomBar, Card, ChoiceTile, OfflineBanner, PhoneScreen, SectionLabel, SyncPill, TopBar } from "./phone-ui";
import { SignaturePad } from "./signature-pad";
import { useRun, type RunStop } from "./use-run";

const OUTCOMES = [
  { key: "delivered", icon: "✓", label: "In full" },
  { key: "delivered_in_part", icon: "▲", label: "In part" },
  { key: "not_delivered", icon: "✕", label: "Not delivered" },
] as const;

const fieldClass = "h-12 rounded-[10px] border border-wp-border bg-wp-surface px-3 text-base text-wp-text";
const stepperButton =
  "flex size-11 cursor-pointer items-center justify-center rounded-[10px] border border-wp-border bg-wp-surface text-xl";

/** R3 · Record delivery: one order at a time — outcome, quantities and proof. Saved on the phone first. */
export function RecordDelivery({ onNavigate }: { onNavigate: (screen: DriverScreen) => void }) {
  const { currentStop, trips, records } = useRun();
  // After the last order of a stop is saved, the stop is done and "current" moves on: keep showing it.
  const [stopId, setStopId] = useState<number | null>(currentStop?.stop_id ?? null);
  const stop = trips.flatMap((t) => t.stops).find((s) => s.stop_id === stopId) ?? currentStop;
  const [editing, setEditing] = useState<LocalRecord | null>(null);
  const [saved, setSaved] = useState<LocalRecord | null>(null);

  if (!stop) {
    return (
      <PhoneScreen label="R3 Record delivery">
        <TopBar>
          <button type="button" onClick={() => onNavigate("run")} className="cursor-pointer font-semibold">‹ My run</button>
          <SyncPill />
        </TopBar>
        <Body><Card>No stop is waiting for a delivery record.</Card></Body>
      </PhoneScreen>
    );
  }

  const nextOrder = stop.orders.find((o) => !stop.outcomes[o.order_id]);
  const order = editing ? stop.orders.find((o) => o.order_id === editing.order_id) : nextOrder;

  if (saved && !editing) {
    return (
      <DeliverySaved
        stop={stop}
        record={saved}
        moreOrders={Boolean(nextOrder)}
        onNext={() => {
          setSaved(null);
          if (!nextOrder) {
            setStopId(null);
            onNavigate("run");
          }
        }}
        onEdit={() => setEditing(records[saved.order_id] ?? saved)}
      />
    );
  }

  if (!order) {
    return (
      <PhoneScreen label="R3 Record delivery">
        <TopBar>
          <button type="button" onClick={() => onNavigate("run")} className="cursor-pointer font-semibold">‹ My run</button>
          <SyncPill />
        </TopBar>
        <Body><Card>Every order at {stop.outlet.name} is recorded.</Card></Body>
      </PhoneScreen>
    );
  }

  return (
    <DeliveryForm
      key={`${order.order_id}-${editing?.delivery_id ?? "new"}`}
      stop={stop}
      order={order}
      editing={editing}
      onBack={() => onNavigate("stop")}
      onSaved={(record) => {
        setStopId(stop.stop_id);
        setEditing(null);
        setSaved(record);
      }}
    />
  );
}

function DeliveryForm({
  stop,
  order,
  editing,
  onBack,
  onSaved,
}: {
  stop: RunStop;
  order: SnapshotOrder;
  editing: LocalRecord | null;
  onBack: () => void;
  onSaved: (record: LocalRecord) => void;
}) {
  const { saveDelivery } = useRun();
  const lines = order.lines ?? [];
  const loadedOf = (lineNo: number) => stop.loaded[`${order.order_id}-${lineNo}`];

  const [outcome, setOutcome] = useState<Outcome>(editing?.outcome ?? "delivered");
  const [qty, setQty] = useState<Record<number, number>>(() =>
    Object.fromEntries(lines.map((l) => [l.line_no, editing?.lines.find((x) => x.line_no === l.line_no)?.delivered_qty ?? loadedOf(l.line_no)])),
  );
  const [shortReason, setShortReason] = useState<Record<number, string>>({});
  const [reason, setReason] = useState<string>(editing?.reason ?? NOT_DELIVERED_REASONS[0].code);
  const [note, setNote] = useState("");
  const [receivedBy, setReceivedBy] = useState(editing?.received_by ?? "");
  const [signature, setSignature] = useState<string | null>(null);
  const [photos, setPhotos] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const photoInput = useRef<HTMLInputElement>(null);

  const delivered = outcome !== "not_delivered";
  const shortLines = lines.filter((l) => qty[l.line_no] < loadedOf(l.line_no));
  const problems = [
    delivered && !receivedBy.trim() && "Enter who received the goods.",
    outcome === "delivered_in_part" && shortLines.length === 0 && "Lower at least one quantity for a part delivery, or choose In full.",
    outcome === "delivered_in_part" && shortLines.some((l) => !shortReason[l.line_no]) && "Pick a reason for each short line.",
    outcome === "delivered_in_part" && shortLines.some((l) => shortReason[l.line_no] === "other") && !note.trim() && "Add a note for “Other”.",
    outcome === "not_delivered" && reason === "other" && !note.trim() && "Add a note for “Other”.",
  ].filter(Boolean) as string[];

  async function save() {
    setSaving(true);
    const signatureBlob = signature ? await (await fetch(signature)).blob() : null;
    const record = await saveDelivery({
      stop,
      order,
      outcome,
      receivedBy: delivered ? receivedBy.trim() : null,
      reasonCode: outcome === "not_delivered" ? reason : outcome === "delivered_in_part" ? (shortReason[shortLines[0]?.line_no] ?? null) : null,
      note: note.trim() || null,
      lines: delivered
        ? lines.map((l) => {
            const delivered_qty = outcome === "delivered" ? loadedOf(l.line_no) : qty[l.line_no];
            return { line_no: l.line_no, delivered_qty, reason_code: delivered_qty < loadedOf(l.line_no) ? shortReason[l.line_no] : null };
          })
        : [],
      signature: delivered ? signatureBlob : null,
      photos,
      supersedes: editing?.delivery_id ?? null,
    });
    setSaving(false);
    onSaved(record);
  }

  const addPhoto = (
    <>
      <input ref={photoInput} type="file" accept="image/*" capture="environment" multiple className="hidden"
             onChange={(e) => setPhotos(Array.from(e.target.files ?? []))} />
      <button type="button" onClick={() => photoInput.current?.click()}
              className="flex h-11 cursor-pointer items-center justify-center rounded-[10px] border border-wp-border font-semibold">
        {photos.length > 0 ? `${photos.length} photo${photos.length > 1 ? "s" : ""} added · change` : "Add photo"}
      </button>
    </>
  );

  return (
    <PhoneScreen label={`R3 Record delivery · ${outcome}`}>
      <TopBar>
        <button type="button" onClick={onBack} className="min-w-0 cursor-pointer text-left font-semibold">
          <div className="truncate font-bold">‹ {stop.outlet.name}</div>
          <div className="text-[13px] font-normal text-wp-text-2">
            {stop.arrivedAt ? `Arrived ${formatTime(stop.arrivedAt)}` : "Not arrived yet"} · {order.temp === "chilled" ? "❄ chilled" : "ambient"}
            {stop.orders.length > 1 ? ` · order ${stop.orders.indexOf(order) + 1} of ${stop.orders.length}` : ""}
          </div>
        </button>
        <SyncPill />
      </TopBar>
      <Body>
        <OfflineBanner />
        {editing && (
          <div className="rounded-xl bg-wp-info-tint p-3 text-[13px] leading-[18px] font-semibold text-wp-info">
            ● Correcting the record saved {formatTime(editing.recorded_at)}. It is sent as a correction beside the original.
          </div>
        )}
        <div className="grid grid-cols-3 gap-2">
          {OUTCOMES.map((o) => (
            <ChoiceTile key={o.key} selected={outcome === o.key}
                        selectedClassName={o.key === "delivered_in_part" ? "border-2 border-wp-warn bg-wp-warn-tint font-bold text-wp-warn" : undefined}
                        onClick={() => setOutcome(o.key)} className="flex-col gap-1 text-[13px]">
              <span className="text-xl">{o.icon}</span>
              {o.label}
            </ChoiceTile>
          ))}
        </div>

        {delivered ? (
          <>
            <Card>
              <SectionLabel>{outcome === "delivered" ? "DELIVERING" : "QUANTITIES HANDED OVER"}</SectionLabel>
              {lines.map((l) => {
                const loaded = loadedOf(l.line_no);
                const short = outcome === "delivered_in_part" && qty[l.line_no] < loaded;
                return (
                  <div key={l.line_no} className={cn("flex flex-col gap-2", short && "rounded-lg bg-wp-warn-tint px-3 py-2")}>
                    <div className="flex min-h-11 items-center justify-between gap-2">
                      <span className="min-w-0">{l.name}</span>
                      {outcome === "delivered" ? (
                        <span className="font-bold whitespace-nowrap">{loaded} of {loaded}</span>
                      ) : (
                        <span className="flex items-center gap-2">
                          <button type="button" aria-label={`Fewer ${l.name}`} className={stepperButton}
                                  onClick={() => setQty((q) => ({ ...q, [l.line_no]: Math.max(0, q[l.line_no] - 1) }))}>−</button>
                          <span className="min-w-14 text-center font-bold">{qty[l.line_no]} of {loaded}</span>
                          <button type="button" aria-label={`More ${l.name}`} className={stepperButton}
                                  onClick={() => setQty((q) => ({ ...q, [l.line_no]: Math.min(loaded, q[l.line_no] + 1) }))}>+</button>
                        </span>
                      )}
                    </div>
                    {short && (
                      <select aria-label={`Why fewer ${l.name}`} className={cn(fieldClass, "h-11")} value={shortReason[l.line_no] ?? ""}
                              onChange={(e) => setShortReason((r) => ({ ...r, [l.line_no]: e.target.value }))}>
                        <option value="">Why fewer?</option>
                        {SHORT_REASONS.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
                      </select>
                    )}
                    {loaded < Number(l.qty) && (
                      <div className="text-[11px] text-wp-text-2">Loaded {loaded} of {Number(l.qty)} ordered: short at the depot.</div>
                    )}
                  </div>
                );
              })}
              {outcome === "delivered_in_part" && (
                <input placeholder="Add a note" aria-label="Add a note" className={fieldClass} value={note} onChange={(e) => setNote(e.target.value)} />
              )}
            </Card>

            <Card>
              <SectionLabel>PROOF · NAME, SIGNATURE, PHOTO</SectionLabel>
              <div className={cn(fieldClass, "flex items-center gap-2")}>
                <span className="flex-shrink-0 text-wp-text-2">Received by:</span>
                <input aria-label="Received by" value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)}
                       placeholder="Name" className="min-w-0 flex-1 bg-transparent text-base text-wp-text outline-none" />
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
                <ChoiceTile key={r.code} selected={reason === r.code} onClick={() => setReason(r.code)}
                            className="min-h-[52px] justify-start gap-2 px-4 text-left">
                  <span className="w-4 text-center">{reason === r.code ? "✓" : "○"}</span>
                  {r.label}
                </ChoiceTile>
              ))}
              <input placeholder="Add a note" aria-label="Add a note" className={fieldClass} value={note} onChange={(e) => setNote(e.target.value)} />
            </Card>
            <Card>
              <SectionLabel>PROOF</SectionLabel>
              {addPhoto}
            </Card>
          </>
        )}
      </Body>
      <BottomBar className="flex flex-col items-center gap-2">
        {problems.length > 0 && <div className="text-center text-[13px] font-semibold text-wp-warn">▲ {problems[0]}</div>}
        <BigButton className="w-full" disabled={saving || problems.length > 0} onClick={() => void save()}>
          {saving ? "Saving…" : editing ? "Save correction" : "Save delivery"}
        </BigButton>
        <div className="text-center text-[13px] text-wp-text-2">Saved on this phone · sends when there is signal</div>
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
 * R3 · Saved. The driver's receipt for what went onto the phone, whether it has left the phone yet,
 * and the way to correct it (a correction is added beside the original, never overwriting it).
 */
function DeliverySaved({
  stop,
  record,
  moreOrders,
  onNext,
  onEdit,
}: {
  stop: RunStop;
  record: LocalRecord;
  moreOrders: boolean;
  onNext: () => void;
  onEdit: () => void;
}) {
  const { isSent } = useRun();
  const sent = isSent(record);
  const outcome = OUTCOMES.find((o) => o.key === record.outcome)!;
  const units = record.lines.reduce((n, l) => n + l.delivered_qty, 0);

  return (
    <PhoneScreen label="R3 Saved">
      <TopBar>
        <div className="min-w-0">
          <div className="truncate font-bold">{stop.outlet.name}</div>
          <div className="text-[13px] text-wp-text-2">{stop.arrivedAt ? `Arrived ${formatTime(stop.arrivedAt)}` : ""}</div>
        </div>
        <SyncPill />
      </TopBar>
      <Body>
        {sent ? (
          <div className="rounded-xl bg-wp-good-tint p-3 leading-[22px] font-semibold text-wp-good">✓ Sent to dispatch and the store.</div>
        ) : (
          <div className="rounded-xl bg-wp-offline-tint p-3 leading-[22px] font-semibold text-wp-offline">
            ○ Saved on this phone. Not sent yet: it goes when there is signal.
          </div>
        )}
        <Card>
          <SectionLabel>DELIVERY RECORD</SectionLabel>
          <RecordRow label="Outcome" value={`${outcome.icon} ${outcome.label}`} />
          {record.outcome !== "not_delivered" ? (
            <>
              <RecordRow label="Units handed over" value={String(units)} />
              <RecordRow label="Received by" value={record.received_by ?? "—"} />
              <RecordRow label="Proof" value={[record.signed && "signature", record.photos && `${record.photos} photo${record.photos > 1 ? "s" : ""}`].filter(Boolean).join(", ") || "none"} />
            </>
          ) : (
            <RecordRow label="Reason" value={NOT_DELIVERED_REASONS.find((r) => r.code === record.reason)?.label ?? record.reason ?? "—"} />
          )}
          <RecordRow label="Recorded" value={`${formatTime(record.recorded_at)} (phone)`} />
        </Card>
        <p className="leading-[22px] text-wp-text-2">
          Need to change it? A correction is added beside this record, so the original is never lost.
        </p>
      </Body>
      <BottomBar className="flex flex-col gap-2">
        <BigButton className="w-full" onClick={onNext}>
          {moreOrders ? "Next order at this stop" : "Next stop"}
        </BigButton>
        <BigButton variant="outline" className="w-full" onClick={onEdit}>
          Correct this record
        </BigButton>
      </BottomBar>
    </PhoneScreen>
  );
}
