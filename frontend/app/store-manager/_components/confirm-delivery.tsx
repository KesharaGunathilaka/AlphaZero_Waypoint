"use client";

import { useState } from "react";
import { Button, Stepper } from "@/components/waypoint/controls";
import { StatusPill, type Tone } from "@/components/waypoint/status";
import { cn } from "@/lib/utils";
import { DELIVERED_LINES, ISSUE_TYPES, type DeliveredLine, type Issue, type ReportedIssue } from "./data";
import { storeLayout } from "./layout";
import { LinkButton } from "./link-button";

export type Receipt = { issues: ReportedIssue[] };

/** Issues are numbered in delivery order, from the first free reference in this prototype. */
const FIRST_REFERENCE = 7720;
const EMPTY_ISSUE: Issue = { type: "Damaged", qty: 1 };

function lineStatus(line: DeliveredLine, issue: Issue | undefined): { state: Tone; label: string } {
  if (issue) return { state: "crit", label: `${issue.type} ${issue.qty}` };
  if (line.delivered < line.ordered) return { state: "warn", label: `Short ${line.ordered - line.delivered} at loading` };
  return { state: "good", label: `Received ${line.delivered}` };
}

/** S4 · Confirm delivery: compare ordered, delivered and received, and report issues per line. */
export function ConfirmDelivery({
  receipt,
  onConfirm,
  onBack,
}: {
  receipt: Receipt | null;
  onConfirm: (receipt: Receipt) => void;
  onBack: () => void;
}) {
  /** Reported issues, keyed by line name. */
  const [issues, setIssues] = useState<Record<string, Issue>>({});
  /** The line whose report panel is open, and the unsaved values in it. */
  const [openLine, setOpenLine] = useState<string | null>(null);
  const [draft, setDraft] = useState<Issue>(EMPTY_ISSUE);

  const reported = DELIVERED_LINES.filter((line) => issues[line.name]).map((line, i) => ({
    line: line.name,
    reference: `IS-${FIRST_REFERENCE + i}`,
    ...issues[line.name],
  }));

  function openPanel(line: DeliveredLine) {
    if (openLine === line.name) return setOpenLine(null);
    setDraft(issues[line.name] ?? EMPTY_ISSUE);
    setOpenLine(line.name);
  }

  function saveIssue(name: string) {
    setIssues((current) => ({ ...current, [name]: draft }));
    setOpenLine(null);
  }

  function removeIssue(name: string) {
    setIssues((current) => {
      const next = { ...current };
      delete next[name];
      return next;
    });
    setOpenLine(null);
  }

  if (receipt) {
    const count = receipt.issues.length;
    return (
      <div className={cn(storeLayout.card, "flex flex-col gap-4 p-6")}>
        <div>
          <StatusPill state="good">Receipt confirmed</StatusPill>
        </div>
        <div className="text-xl leading-[26px] font-semibold">
          {count === 0
            ? "Confirmed. Everything arrived as shown."
            : `Confirmed with ${count} ${count === 1 ? "issue" : "issues"}.`}
        </div>
        {count === 0 ? (
          <div className="text-[13px] leading-[18px] text-wp-text-2">Recorded Tue 29 Sep 17:32 against DR-20931.</div>
        ) : (
          <div className="flex flex-col gap-2">
            {receipt.issues.map((issue) => (
              <div key={issue.line} className="flex flex-wrap items-baseline gap-x-2 text-[13px] leading-[18px]">
                <span className="font-semibold">{issue.line}</span>
                <span className="text-wp-text-2">
                  {issue.type}, {issue.qty} unit{issue.qty === 1 ? "" : "s"}
                  {issue.photo ? " · photo attached" : ""}
                </span>
                <span className="font-semibold text-wp-crit tabular-nums">{issue.reference}</span>
              </div>
            ))}
            <div className="text-[13px] leading-[18px] text-wp-text-2">
              Dispatch has the record. Confirmed Tue 29 Sep 17:32 against DR-20931.
            </div>
          </div>
        )}
        <div>
          <Button className={storeLayout.button} onClick={onBack}>
            Back to Deliveries
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-1">
        <LinkButton onClick={onBack} className="no-underline">
          ← Deliveries
        </LinkButton>
        <h1 className={storeLayout.h1}>Confirm delivery</h1>
        <div className="text-[13px] text-wp-text-2">Fresh · Dry groceries · Order FP-4409</div>
      </div>

      <div className={cn(storeLayout.card, "grid gap-4 p-4", storeLayout.colsReceipt)}>
        {[
          ["DELIVERED", "Tue 29 Sep 09:42"],
          ["DRIVER · VEHICLE", "K. Perera · RT-03"],
          ["SIGNED BY", "S. Fernando"],
          ["PHOTO · RECORD", "1 attached · DR-20931"],
        ].map(([label, value]) => (
          <div key={label}>
            <div className="text-[11px] font-semibold tracking-[.06em] text-wp-muted">{label}</div>
            <div className="mt-0.5 text-[15px] font-semibold">{value}</div>
          </div>
        ))}
      </div>

      <div className={cn(storeLayout.card, "overflow-hidden")}>
        <div
          className={cn(
            "grid gap-2 bg-wp-surface-2 px-4 py-2 text-[10px] font-semibold tracking-[.06em] text-wp-muted",
            storeLayout.colsLine,
          )}
        >
          <span>ITEM</span>
          <span>ORDERED</span>
          <span>DRIVER DELIVERED</span>
          <span>YOU RECEIVED</span>
        </div>

        {DELIVERED_LINES.map((line) => {
          const issue = issues[line.name];
          const status = lineStatus(line, issue);
          const open = openLine === line.name;
          return (
            <div key={line.name} className="border-t border-wp-border">
              <div
                className={cn(
                  "grid items-center gap-2 px-4 py-2 text-[13px] tabular-nums",
                  storeLayout.colsLine,
                  storeLayout.rowHeight,
                )}
              >
                <span className="font-semibold">{line.name}</span>
                <span>{line.ordered}</span>
                <span>{line.delivered}</span>
                <span className="flex flex-wrap items-center gap-2">
                  <StatusPill state={status.state}>{status.label}</StatusPill>
                  <LinkButton onClick={() => openPanel(line)} aria-expanded={open}>
                    {issue ? "Edit" : "Report issue"}
                  </LinkButton>
                </span>
              </div>
              {line.note && <div className="px-4 pb-3 text-xs leading-4 text-wp-text-2">{line.note}</div>}

              {open && (
                <div className="mx-4 mb-4 flex flex-col gap-3 rounded-lg border border-wp-border bg-wp-canvas p-4">
                  <div className="text-[13px] font-semibold">What went wrong with {line.name}?</div>
                  <div className="flex flex-wrap gap-2">
                    {ISSUE_TYPES.map((type) => (
                      <button
                        key={type}
                        type="button"
                        aria-pressed={draft.type === type}
                        onClick={() => setDraft((d) => ({ ...d, type }))}
                        className={cn(
                          "cursor-pointer rounded-md border px-3 text-xs font-semibold",
                          storeLayout.inputHeight,
                          draft.type === type
                            ? "border-wp-action bg-wp-action text-wp-on-action"
                            : "border-wp-border bg-wp-surface text-wp-text",
                        )}
                      >
                        {type}
                      </button>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-end gap-4">
                    <Stepper
                      label="Quantity affected"
                      value={draft.qty}
                      onChange={(qty) =>
                        setDraft((d) => ({ ...d, qty: Math.min(Math.max(1, qty), Math.max(1, line.delivered)) }))
                      }
                    />
                    <PhotoPicker
                      line={line.name}
                      photo={draft.photo}
                      onChange={(photo) => setDraft((d) => ({ ...d, photo }))}
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <Button className={storeLayout.button} onClick={() => saveIssue(line.name)}>
                      {issue ? "Save issue" : "Add issue"}
                    </Button>
                    <LinkButton onClick={() => setOpenLine(null)}>Cancel</LinkButton>
                    {issue && (
                      <LinkButton className="text-wp-crit" onClick={() => removeIssue(line.name)}>
                        Remove issue
                      </LinkButton>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex flex-col items-start gap-3">
        <Button className="min-h-14 px-6 text-base" onClick={() => onConfirm({ issues: reported })}>
          {reported.length === 0
            ? "Everything arrived as shown"
            : `Confirm with ${reported.length} ${reported.length === 1 ? "issue" : "issues"}`}
        </Button>
        <div className="text-xs leading-4 text-wp-muted">
          {reported.length > 0
            ? "A reference number is issued for each issue and sent to dispatch."
            : "Dhal 1 kg is confirmed as 12 received, 3 short at loading."}
        </div>
      </div>
    </>
  );
}

/** The photo button opens the camera on a phone and the file picker on a desktop. */
function PhotoPicker({
  line,
  photo,
  onChange,
}: {
  line: string;
  photo: string | undefined;
  onChange: (photo: string | undefined) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold text-wp-text-2">Photo</span>
      <div className="flex items-center gap-2">
        <label
          className={cn(
            "inline-flex cursor-pointer items-center justify-center rounded-md border border-wp-border px-4 text-xs leading-4 font-semibold",
            storeLayout.button,
          )}
        >
          {photo ? "Replace photo" : "Add photo"}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            aria-label={`Add a photo of ${line}`}
            className="sr-only"
            onChange={(e) => onChange(e.target.files?.[0]?.name)}
          />
        </label>
        {photo && (
          <span className="flex items-center gap-2 text-xs text-wp-text-2">
            <span className="max-w-40 truncate">{photo}</span>
            <LinkButton onClick={() => onChange(undefined)}>Remove</LinkButton>
          </span>
        )}
      </div>
    </div>
  );
}
