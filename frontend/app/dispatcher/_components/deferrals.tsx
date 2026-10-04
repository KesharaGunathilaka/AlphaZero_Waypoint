"use client";

import { Button } from "@/components/waypoint/controls";
import { BrandMonogram, Eyebrow, RunHistory } from "@/components/waypoint/data";
import { StatusPill } from "@/components/waypoint/status";
import { cn } from "@/lib/utils";
import { DEFERRALS, DEFERRAL_REASONS, OTHER_REASON } from "./data";

export type DeferralState = {
  reasons: Record<string, number>;
  notes: Record<string, string>;
  confirmed: boolean;
};

export const INITIAL_DEFERRAL_STATE: DeferralState = {
  reasons: Object.fromEntries(DEFERRALS.map((d) => [d.id, d.defaultReason])),
  notes: {},
  confirmed: false,
};

/** D2 · Overflow & deferrals: record a reason for each order that cannot be served. */
export function Deferrals({
  state,
  onChange,
  onConfirm,
  onGoToPlanBoard,
}: {
  state: DeferralState;
  onChange: (state: DeferralState) => void;
  onConfirm: () => void;
  onGoToPlanBoard: () => void;
}) {
  const needsNote = (id: string, streak?: boolean) => streak || state.reasons[id] === OTHER_REASON;
  const missingNotes = DEFERRALS.filter((d) => needsNote(d.id, d.streak) && !(state.notes[d.id] ?? "").trim()).length;

  const status = state.confirmed
    ? "Recorded by Kasun at 16:05."
    : missingNotes > 0
      ? `${missingNotes} order needs a written note before you can confirm.`
      : `All ${DEFERRALS.length} orders have a reason. Ready to confirm.`;

  return (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-4 p-6">
      <div>
        <h1 className="text-[22px] leading-6 font-bold">3 orders cannot be served on Wed 30 Sep</h1>
        <div className="mt-1 text-wp-text-2">
          Record a reason for each order, then confirm. The reason is pre-selected from what the system found.
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_320px] items-start gap-4">
        <div className="flex flex-col gap-4">
          {DEFERRALS.map((order) => {
            const reason = state.reasons[order.id];
            return (
              <div
                key={order.id}
                className={cn(
                  "rounded-lg border bg-wp-surface p-4",
                  order.streak ? "border-wp-gauge-amber" : "border-wp-border",
                )}
              >
                <div className="flex flex-wrap items-center gap-4">
                  <BrandMonogram brand={order.brand} outlet={order.outlet} />
                  <span className="text-xs text-wp-text-2">{order.load}</span>
                  <span className="ml-auto">
                    <StatusPill state={order.pillState}>{order.pill}</StatusPill>
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-3">
                    <div>
                      <Eyebrow>System found</Eyebrow>
                      <div className="mt-0.5">{order.found}</div>
                    </div>
                    <div>
                      <Eyebrow>Last five runs</Eyebrow>
                      <RunHistory history={order.history} />
                      <div className="text-[11px] text-wp-muted">● delivered · ○ no order · ✕ deferred</div>
                    </div>
                    <div>
                      <Eyebrow>If deferred</Eyebrow>
                      <div className="mt-0.5">{order.consequence}</div>
                    </div>
                  </div>

                  <fieldset className="flex flex-col gap-2">
                    <legend className="mb-2">
                      <Eyebrow>Reason</Eyebrow>
                    </legend>
                    {DEFERRAL_REASONS.map((label, i) => (
                      <label
                        key={label}
                        className={cn(
                          "flex min-h-8 cursor-pointer items-center gap-2 rounded-md border bg-wp-surface px-3 py-2",
                          reason === i ? "border-wp-action" : "border-wp-border",
                        )}
                      >
                        <input
                          type="radio"
                          name={`reason-${order.id}`}
                          checked={reason === i}
                          onChange={() => onChange({ ...state, reasons: { ...state.reasons, [order.id]: i } })}
                        />
                        <span>{label}</span>
                      </label>
                    ))}
                    {needsNote(order.id, order.streak) && (
                      <div className="flex flex-col gap-1">
                        <label htmlFor={`note-${order.id}`} className="text-[11px] font-semibold text-wp-warn">
                          ▲{" "}
                          {order.streak
                            ? "Second consecutive skip: a written note is required"
                            : "Note required for “Other”"}
                        </label>
                        <textarea
                          id={`note-${order.id}`}
                          value={state.notes[order.id] ?? ""}
                          onChange={(e) => onChange({ ...state, notes: { ...state.notes, [order.id]: e.target.value } })}
                          placeholder="Why is this outlet being skipped again?"
                          className="min-h-14 rounded-md border border-wp-border bg-wp-surface p-2 text-wp-text"
                        />
                      </div>
                    )}
                    <div className="mt-1 flex items-center gap-4">
                      <a
                        href="#"
                        onClick={(e) => {
                          e.preventDefault();
                          onGoToPlanBoard();
                        }}
                        className="text-xs text-wp-focus hover:text-wp-action"
                      >
                        Make room in D1 ({order.blocker} highlighted)
                      </a>
                    </div>
                  </fieldset>
                </div>
              </div>
            );
          })}
        </div>

        <aside className="sticky top-4 flex flex-col gap-3 rounded-lg border border-wp-border bg-wp-surface p-4">
          <h2 className="text-[15px] leading-5 font-semibold">What confirming does</h2>
          <ol className="flex flex-col gap-2 text-wp-text-2">
            <li>1. Store managers are told the reason and the new date, Thu 1 Oct.</li>
            <li>2. Orders join the next run, flagged “deferred once”.</li>
            <li>3. The decision is logged with your name, the time and the reason.</li>
          </ol>
          <div className="border-t border-wp-border pt-3 text-xs text-wp-text-2">{status}</div>
          <Button className="min-h-10 w-full" disabled={missingNotes > 0 || state.confirmed} onClick={onConfirm}>
            {state.confirmed ? "Deferrals confirmed" : `Confirm ${DEFERRALS.length} deferrals`}
          </Button>
          {state.confirmed && (
            <div className="rounded-md bg-wp-good-tint px-3 py-2 font-semibold text-wp-good">
              ✓ 3 deferrals recorded. Stores notified.
            </div>
          )}
          <div className="text-[11px] text-wp-muted">
            A deferral undone in D1 is recorded as “withdrawn before confirm” and nothing is sent.
          </div>
        </aside>
      </div>
    </div>
  );
}
