"use client";

import { useState } from "react";
import { Button, Stepper } from "@/components/waypoint/controls";
import { StatusPill, type Tone } from "@/components/waypoint/status";
import { cn } from "@/lib/utils";
import { DELIVERED_LINES, ISSUE_TYPES, type DeliveredLine, type Issue, type IssueType } from "./data";
import { storeLayout } from "./layout";
import { LinkButton } from "./link-button";

export type Receipt = { issue: Issue | null };

function lineStatus(line: DeliveredLine, issue: Issue | null): { state: Tone; label: string } {
  if (line.reportable && issue) return { state: "crit", label: `${issue.type} ${issue.qty}` };
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
  const [issue, setIssue] = useState<Issue | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [issueType, setIssueType] = useState<IssueType>("Damaged");
  const [issueQty, setIssueQty] = useState(1);

  if (receipt) {
    const reported = receipt.issue;
    return (
      <div className={cn(storeLayout.card, "flex flex-col gap-4 p-6")}>
        <div>
          <StatusPill state="good">Receipt confirmed</StatusPill>
        </div>
        <div className="text-xl leading-[26px] font-semibold">
          {reported ? "Confirmed with 1 issue. Reference IS-7720." : "Confirmed. Everything arrived as shown."}
        </div>
        <div className="text-[13px] leading-[18px] text-wp-text-2">
          {reported
            ? `Coconut oil 1 L: ${reported.type}, ${reported.qty} unit(s). Dispatch has the record. Confirmed Tue 29 Sep 17:32.`
            : "Recorded Tue 29 Sep 17:32 against DR-20931."}
        </div>
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
          const status = lineStatus(line, issue);
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
                  {line.reportable && (
                    <LinkButton onClick={() => setPanelOpen(!panelOpen)}>{issue ? "Edit" : "Report issue"}</LinkButton>
                  )}
                </span>
              </div>
              {line.note && <div className="px-4 pb-3 text-xs leading-4 text-wp-text-2">{line.note}</div>}

              {line.reportable && panelOpen && (
                <div className="mx-4 mb-4 flex flex-col gap-3 rounded-lg border border-wp-border bg-wp-canvas p-4">
                  <div className="text-[13px] font-semibold">What went wrong with {line.name}?</div>
                  <div className="flex flex-wrap gap-2">
                    {ISSUE_TYPES.map((type) => (
                      <button
                        key={type}
                        type="button"
                        aria-pressed={issueType === type}
                        onClick={() => setIssueType(type)}
                        className={cn(
                          "cursor-pointer rounded-md border px-3 text-xs font-semibold",
                          storeLayout.inputHeight,
                          issueType === type
                            ? "border-wp-action bg-wp-action text-wp-on-action"
                            : "border-wp-border bg-wp-surface text-wp-text",
                        )}
                      >
                        {type}
                      </button>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center gap-4">
                    <Stepper label="Quantity affected" value={issueQty} onChange={(v) => setIssueQty(Math.max(1, v))} />
                    <Button variant="secondary" className={storeLayout.button}>
                      Add photo
                    </Button>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      className={storeLayout.button}
                      onClick={() => {
                        setIssue({ type: issueType, qty: issueQty });
                        setPanelOpen(false);
                      }}
                    >
                      Add issue
                    </Button>
                    <LinkButton onClick={() => setPanelOpen(false)}>Cancel</LinkButton>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex flex-col items-start gap-3">
        <Button className="min-h-14 px-6 text-base" onClick={() => onConfirm({ issue })}>
          {issue ? "Confirm with 1 issue" : "Everything arrived as shown"}
        </Button>
        <div className="text-xs leading-4 text-wp-muted">
          {issue
            ? "A reference number is issued for each issue and sent to dispatch."
            : "Dhal 1 kg is confirmed as 12 received, 3 short at loading."}
        </div>
      </div>
    </>
  );
}
