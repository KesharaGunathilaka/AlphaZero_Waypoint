"use client";

import { useState, type ReactNode } from "react";
import { Button, Stepper } from "@/components/waypoint/controls";
import { Banner, StatusPill, type Tone } from "@/components/waypoint/status";
import { errorMessage, shrinkImage, useApi, useApiData, useUpload } from "@/lib/api/use-api";
import { formatDayTime, plural } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  ISSUE_API_TYPE,
  ISSUE_RULES,
  ISSUE_TYPES,
  orderKind,
  type Issue,
  type IssueType,
  type OrderDetailData,
  type ReportedIssue,
} from "./data";
import { storeLayout } from "./layout";
import { LinkButton } from "./link-button";

export type Receipt = { orderId: number; confirmationNo: string; issues: ReportedIssue[]; confirmedAt: Date };

/** One delivered line: what was ordered, what the driver recorded handing over, and why they differ. */
type DeliveredLine = {
  lineNo: number;
  name: string;
  ordered: number;
  delivered: number;
  /** Shown under the line when the shortfall was known before delivery. */
  note?: string;
};

const EMPTY_ISSUE: Issue = { type: "Missing", qty: 1 };

function deliveredLines(order: OrderDetailData): DeliveredLine[] {
  return order.receipt_lines.map((l) => {
    const ordered = Number(l.ordered_qty);
    const loaded = Number(l.expected_qty ?? ordered);
    return {
      lineNo: l.line_no,
      name: l.product_name,
      ordered,
      delivered: Number(l.delivered_qty ?? loaded),
      note:
        loaded < ordered
          ? `Loaded ${loaded} of ${ordered} at the depot: short at the warehouse, recorded before the van left.`
          : undefined,
    };
  });
}

/** What you actually took in: an issue that removes units lowers it, damage does not. */
function receivedCount(line: DeliveredLine, issue: Issue | undefined) {
  if (!issue) return line.delivered;
  if (issue.type === "Nothing arrived") return 0;
  return ISSUE_RULES[issue.type].reducesReceived ? Math.max(0, line.delivered - issue.qty) : line.delivered;
}

/**
 * The pill names the gap it is about: an issue you raised sits between what the driver
 * recorded and what you counted, a warehouse shortfall between your order and the van.
 */
function lineStatus(line: DeliveredLine, issue: Issue | undefined): { state: Tone; label: string } {
  if (issue) {
    if (issue.type === "Nothing arrived") return { state: "crit", label: "Nothing arrived" };
    if (issue.type === "Damaged") return { state: "crit", label: `${issue.qty} damaged` };
    if (issue.type === "Wrong item") return { state: "crit", label: `${issue.qty} wrong item` };
    return { state: "crit", label: `${issue.qty} missing` };
  }
  if (line.delivered < line.ordered) {
    return { state: "warn", label: `${line.ordered - line.delivered} short at the warehouse` };
  }
  return { state: "good", label: "Matches order" };
}

/** Reads back what a saved issue means for the line, in the same words as the receipt. */
function issueSentence(line: DeliveredLine, issue: Issue) {
  const received = receivedCount(line, issue);
  const recorded = `the ${line.delivered} the driver recorded`;
  if (issue.type === "Damaged") {
    return `You received ${received} of ${recorded}, ${issue.qty} of them damaged.`;
  }
  if (issue.type === "Wrong item") {
    const instead = issue.instead?.trim();
    return `You received ${received} of ${recorded}. ${issue.qty} were the wrong item${
      instead ? ` (${instead})` : ""
    }.`;
  }
  return `You received ${received} of ${recorded}.`;
}

/** S4 · Confirm delivery: compare ordered, delivered and received, and report issues per line. */
export function ConfirmDelivery({
  orderId,
  receipt,
  onConfirm,
  onBack,
}: {
  orderId: number;
  receipt: Receipt | null;
  onConfirm: (receipt: Receipt) => void;
  onBack: () => void;
}) {
  const detail = useApiData<OrderDetailData>(`/store/orders/${orderId}`);
  const request = useApi();
  const upload = useUpload();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Reported issues, keyed by line name. */
  const [issues, setIssues] = useState<Record<string, Issue>>({});
  /** The line whose report panel is open, and the unsaved values in it. */
  const [openLine, setOpenLine] = useState<string | null>(null);
  const [draft, setDraft] = useState<Issue>(EMPTY_ISSUE);

  if (receipt) return <ConfirmedReceipt receipt={receipt} onBack={onBack} />;
  if (detail.error && !detail.data) return <Banner state="crit">{detail.error}</Banner>;
  if (!detail.data) return <div className="text-[13px] text-wp-text-2">Loading the delivery…</div>;

  const order = detail.data;
  const lines = deliveredLines(order);
  const reportedLines = lines.filter((line) => issues[line.name]);

  async function confirm() {
    setError(null);
    setSending(true);
    try {
      const result = await request<{ issues: { issue_id: string; reference_no: string; line_no: number }[] }>(
        `/store/orders/${order.order_id}/receipt`,
        {
          method: "POST",
          body: {
            issues: reportedLines.map((line) => {
              const issue = issues[line.name];
              return {
                line_no: line.lineNo,
                type: ISSUE_API_TYPE[issue.type],
                qty: issue.type === "Nothing arrived" ? Math.max(1, line.delivered) : issue.qty,
                note: issue.instead?.trim() ? `Arrived instead: ${issue.instead.trim()}` : null,
              };
            }),
          },
        },
      );
      // Photos go up once each issue exists, so they can be attached to it.
      for (const line of reportedLines) {
        const photo = issues[line.name].photo;
        const saved = result.issues.find((i) => i.line_no === line.lineNo);
        if (photo && saved) {
          await upload(await shrinkImage(photo), { kind: "photo", issue_id: saved.issue_id });
        }
      }
      onConfirm({
        orderId: order.order_id,
        confirmationNo: order.confirmation_no,
        confirmedAt: new Date(),
        issues: reportedLines.map((line) => ({
          line: line.name,
          reference: result.issues.find((i) => i.line_no === line.lineNo)?.reference_no ?? "",
          ...issues[line.name],
        })),
      });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSending(false);
    }
  }

  function openPanel(line: DeliveredLine) {
    if (openLine === line.name) return setOpenLine(null);
    setDraft(issues[line.name] ?? { ...EMPTY_ISSUE, qty: Math.min(1, line.delivered) || 1 });
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

  return (
    <>
      <div className="flex flex-col gap-1">
        <LinkButton onClick={onBack} className="no-underline">
          ← Deliveries
        </LinkButton>
        <h1 className={storeLayout.h1}>Confirm delivery</h1>
        <div className="text-[13px] text-wp-text-2">
          {orderKind(order)} · Order {order.confirmation_no}
        </div>
      </div>
      {error && <Banner state="crit">{error}</Banner>}

      <div className={cn(storeLayout.card, "grid gap-4 p-4", storeLayout.colsReceipt)}>
        {[
          ["DELIVERED", order.delivery ? formatDayTime(order.delivery.delivered_at) : "—"],
          ["DRIVER · VEHICLE", order.delivery ? `${order.delivery.driver_name} · ${order.delivery.vehicle_source_id}` : "—"],
          ["SIGNED BY", order.delivery?.received_by ?? "—"],
          ["PROOF", order.proof.length ? `${plural(order.proof.length, "file")} attached` : "None"],
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
            "hidden gap-2 bg-wp-surface-2 px-4 py-2 text-[10px] font-semibold tracking-[.06em] text-wp-muted md:grid",
            storeLayout.colsLine,
          )}
        >
          <span>ITEM</span>
          <span>ORDERED</span>
          <span>DRIVER DELIVERED</span>
          <span>YOU RECEIVED</span>
        </div>

        {lines.map((line) => {
          const issue = issues[line.name];
          const status = lineStatus(line, issue);
          const received = receivedCount(line, issue);
          const open = openLine === line.name;
          return (
            <div key={line.name} className="border-t border-wp-border">
              <div
                className={cn(
                  "grid items-center gap-x-3 gap-y-2 px-4 py-3 text-[13px] tabular-nums md:gap-2 md:py-2",
                  storeLayout.colsLine,
                  storeLayout.rowHeight,
                )}
              >
                <span className="col-span-2 font-semibold md:col-span-1">{line.name}</span>
                <Count label="Ordered">{line.ordered}</Count>
                <Count label="Driver delivered">{line.delivered}</Count>
                <span className="col-span-2 flex flex-wrap items-center gap-2 md:col-span-1">
                  <Count label="You received">
                    <span className={cn("font-semibold", received < line.delivered && "text-wp-crit")}>{received}</span>
                  </Count>
                  <StatusPill state={status.state}>{status.label}</StatusPill>
                  <LinkButton onClick={() => openPanel(line)} aria-expanded={open}>
                    {issue ? "Edit" : "Report issue"}
                  </LinkButton>
                </span>
              </div>

              {issue && !open && (
                <div className="px-4 pb-3 text-xs leading-4 text-wp-text-2">{issueSentence(line, issue)}</div>
              )}
              {line.note && !issue && <div className="px-4 pb-3 text-xs leading-4 text-wp-text-2">{line.note}</div>}

              {open && (
                <IssuePanel
                  line={line}
                  draft={draft}
                  editing={Boolean(issue)}
                  onDraft={setDraft}
                  onSave={() => saveIssue(line.name)}
                  onRemove={() => removeIssue(line.name)}
                  onCancel={() => setOpenLine(null)}
                />
              )}
            </div>
          );
        })}
      </div>

      <div className="flex flex-col items-start gap-3">
        <Button className="min-h-14 w-full px-6 text-base sm:w-auto" disabled={sending} onClick={confirm}>
          {sending
            ? "Sending…"
            : reportedLines.length === 0
              ? "Everything arrived as shown"
              : `Confirm with ${plural(reportedLines.length, "issue")}`}
        </Button>
        <div className="text-xs leading-4 text-wp-muted">
          {reportedLines.length > 0 ? (
            "A reference number is issued for each issue and sent to dispatch."
          ) : (
            <WarehouseShortNote lines={lines} />
          )}
        </div>
      </div>
    </>
  );
}

/** A count with the column heading repeated, because the headings are hidden on a phone. */
function Count({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="flex items-baseline gap-2 md:block">
      <span className="text-[10px] font-semibold tracking-[.06em] text-wp-muted md:hidden">
        {label.toUpperCase()}
      </span>
      {children}
    </span>
  );
}

/**
 * The lines the warehouse could not fill. That gap was settled before the van left, so confirming
 * accepts it rather than raising it: only a gap against the driver's own count becomes an issue.
 */
function WarehouseShortNote({ lines }: { lines: DeliveredLine[] }) {
  const short = lines.filter((line) => line.delivered < line.ordered);
  if (short.length === 0) return <>Every line matches what you ordered.</>;
  return (
    <>
      {short
        .map(
          (line) =>
            `${line.name} is confirmed as ${line.delivered} received, ${line.ordered - line.delivered} short at the warehouse.`,
        )
        .join(" ")}
    </>
  );
}

/** The report form, which changes with the kind of issue being reported. */
function IssuePanel({
  line,
  draft,
  editing,
  onDraft,
  onSave,
  onRemove,
  onCancel,
}: {
  line: DeliveredLine;
  draft: Issue;
  editing: boolean;
  onDraft: (issue: Issue) => void;
  onSave: () => void;
  onRemove: () => void;
  onCancel: () => void;
}) {
  const rules = ISSUE_RULES[draft.type];
  const maxQty = Math.max(1, line.delivered);

  function chooseType(type: IssueType) {
    onDraft({
      ...draft,
      type,
      qty: type === "Nothing arrived" ? maxQty : Math.min(draft.qty, maxQty),
      instead: type === "Wrong item" ? draft.instead : undefined,
    });
  }

  return (
    <div className="mx-4 mb-4 flex flex-col gap-3 rounded-xl border border-wp-border bg-wp-canvas p-4 md:rounded-lg">
      <div className="text-[13px] font-semibold">What went wrong with {line.name}?</div>

      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        {ISSUE_TYPES.map((type) => (
          <button
            key={type}
            type="button"
            aria-pressed={draft.type === type}
            onClick={() => chooseType(type)}
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

      <div className="text-[13px] text-wp-text-2">{rules.prompt}</div>

      {draft.type !== "Nothing arrived" && (
        <div className="flex flex-wrap items-end gap-4">
          <Stepper
            label={`${rules.qtyLabel} (max ${maxQty})`}
            value={draft.qty}
            onChange={(qty) => onDraft({ ...draft, qty: Math.min(Math.max(1, qty), maxQty) })}
          />
          <PhotoPicker line={line.name} photo={draft.photo} onChange={(photo) => onDraft({ ...draft, photo })} />
        </div>
      )}

      {draft.type === "Nothing arrived" && (
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-wp-text-2">Units missing</span>
            <span className="text-[15px] font-bold tabular-nums">All {maxQty}</span>
          </div>
          <PhotoPicker line={line.name} photo={draft.photo} onChange={(photo) => onDraft({ ...draft, photo })} />
        </div>
      )}

      {draft.type === "Wrong item" && (
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold text-wp-text-2">What arrived instead?</span>
          <input
            value={draft.instead ?? ""}
            onChange={(e) => onDraft({ ...draft, instead: e.target.value })}
            placeholder="e.g. Coconut oil, 500 ml"
            className={cn(
              "w-full max-w-80 rounded-md border border-wp-border bg-wp-surface px-3 text-[13px] text-wp-text",
              storeLayout.inputHeight,
            )}
          />
        </label>
      )}

      <div className="rounded-md bg-wp-surface-2 px-3 py-2 text-xs leading-4 text-wp-text-2">
        {issueSentence(line, draft)}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button className={storeLayout.button} onClick={onSave}>
          {editing ? "Save issue" : "Add issue"}
        </Button>
        <LinkButton onClick={onCancel}>Cancel</LinkButton>
        {editing && (
          <LinkButton className="text-wp-crit" onClick={onRemove}>
            Remove issue
          </LinkButton>
        )}
      </div>
    </div>
  );
}

function ConfirmedReceipt({ receipt, onBack }: { receipt: Receipt; onBack: () => void }) {
  const count = receipt.issues.length;
  return (
    <div className={cn(storeLayout.card, "flex flex-col gap-4 p-4 md:p-6")}>
      <div>
        <StatusPill state="good">Receipt confirmed</StatusPill>
      </div>
      <div className="text-xl leading-[26px] font-semibold">
        {count === 0
          ? "Confirmed. Everything arrived as shown."
          : `Confirmed with ${count} ${count === 1 ? "issue" : "issues"}.`}
      </div>
      {count === 0 ? (
        <div className="text-[13px] leading-[18px] text-wp-text-2">
          Recorded {formatDayTime(receipt.confirmedAt)} against order {receipt.confirmationNo}.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {receipt.issues.map((issue) => (
            <div key={issue.line} className="flex flex-col gap-1 border-l-2 border-wp-crit pl-3">
              <div className="flex flex-wrap items-baseline gap-x-2 text-[13px] leading-[18px]">
                <span className="font-semibold">{issue.line}</span>
                <span className="font-semibold text-wp-crit tabular-nums">{issue.reference}</span>
              </div>
              <div className="text-[13px] leading-[18px] text-wp-text-2">
                {issue.type === "Nothing arrived" ? "Nothing arrived" : `${issue.type}, ${issue.qty} unit${issue.qty === 1 ? "" : "s"}`}
                {issue.instead?.trim() ? ` · arrived instead: ${issue.instead.trim()}` : ""}
                {issue.photo ? " · photo attached" : ""}
              </div>
            </div>
          ))}
          <div className="text-[13px] leading-[18px] text-wp-text-2">
            Dispatch has the record. Confirmed {formatDayTime(receipt.confirmedAt)} against order {receipt.confirmationNo}.
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

/** The photo button opens the camera on a phone and the file picker on a desktop. */
function PhotoPicker({
  line,
  photo,
  onChange,
}: {
  line: string;
  photo: File | undefined;
  onChange: (photo: File | undefined) => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-[11px] font-semibold text-wp-text-2">Photo</span>
      <div className="flex min-w-0 items-center gap-2">
        <label
          className={cn(
            "inline-flex cursor-pointer items-center justify-center rounded-md border border-wp-border px-4 text-xs leading-4 font-semibold whitespace-nowrap",
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
            onChange={(e) => onChange(e.target.files?.[0])}
          />
        </label>
        {photo && (
          <span className="flex min-w-0 items-center gap-2 text-xs text-wp-text-2">
            <span className="min-w-0 truncate">{photo.name}</span>
            <LinkButton onClick={() => onChange(undefined)}>Remove</LinkButton>
          </span>
        )}
      </div>
    </div>
  );
}
