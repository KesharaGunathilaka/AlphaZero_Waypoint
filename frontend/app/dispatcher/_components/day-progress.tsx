"use client";

import { Button } from "@/components/waypoint/controls";
import { formatDayTime, timeLeft } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PlanView, Run } from "./data";
import type { PlanActions, Tab } from "./dispatcher-app";

type StepState = "done" | "now" | "attention" | "later";
type Step = { key: string; title: string; detail: string; state: StepState };

const DOT: Record<StepState, string> = {
  done: "bg-wp-good text-white",
  now: "bg-wp-action text-wp-on-action",
  attention: "bg-wp-gauge-amber text-wp-text",
  later: "bg-wp-surface-2 text-wp-muted",
};

/**
 * The dispatcher's day in five steps, with exactly one main button: the next thing to do.
 * Close orders -> build the plan -> check what cannot go -> send to the depot -> watch it run.
 */
export function DayProgress({
  run,
  plan,
  busy,
  actions,
  onTab,
}: {
  run: Run | null;
  plan: PlanView | null;
  busy: boolean;
  actions: PlanActions;
  onTab: (tab: Tab) => void;
}) {
  const closed = Boolean(run?.plan_id);
  const built = Boolean(plan && plan.routes.length > 0);
  const released = plan?.plan.state === "released";
  const dirty = Boolean(plan?.plan.dirty);
  const deferred = plan?.unplanned.length ?? 0;
  const undecided = plan?.unplanned.filter((u) => !u.drafted_reason).length ?? 0;
  const conflicts = plan?.violations.filter((v) => v.code !== "unplanned").length ?? 0;
  const blocked = undecided + conflicts;

  const steps: Step[] = [
    {
      key: "orders",
      title: "Close orders",
      detail: closed
        ? `${plan?.summary?.orders_confirmed ?? run?.orders ?? 0} orders confirmed`
        : run
          ? `${run.orders} placed · stores can order until ${formatDayTime(run.cutoff_at)}`
          : "No orders yet",
      state: closed ? "done" : "now",
    },
    {
      key: "plan",
      title: "Build the plan",
      detail: built ? `${plan!.routes.length} trips · ${plan!.summary?.orders_planned ?? 0} orders on trips` : "The engine fits every order it can",
      state: built ? "done" : closed ? "now" : "later",
    },
    {
      key: "deferred",
      title: "Check what can't go",
      detail: !built
        ? "Orders that cannot fit get a reason"
        : deferred === 0
          ? released ? "Decided before sending" : "Every order fits"
          : undecided
            ? `${undecided} still need a reason`
            : `${deferred} deferred, each with a reason`,
      state: !built ? "later" : undecided ? "attention" : "done",
    },
    {
      key: "release",
      title: "Send to depot",
      detail: released && !dirty
        ? `Plan v${plan!.plan.version} sent to loaders and drivers`
        : released
          ? "You changed the plan: send the update"
          : conflicts
            ? `${conflicts} rule ${conflicts === 1 ? "problem" : "problems"} to fix first`
            : "Loaders and drivers get their trips",
      state: released && !dirty ? "done" : built ? (conflicts ? "attention" : "now") : "later",
    },
    {
      key: "track",
      title: "Watch it run",
      detail: released ? "Live view of every trip" : "After the plan is sent",
      state: released ? "now" : "later",
    },
  ];

  // The one main action: always the first step that is not done yet.
  let main: { label: string; onClick: () => void; disabled?: boolean; hint?: string } | null = null;
  if (!closed) {
    main = { label: "Close orders now", onClick: () => void actions.closeOrders(), disabled: !run,
             hint: run ? `Normally automatic at the cutoff (${timeLeft(run.cutoff_at)})` : undefined };
  } else if (!built) {
    main = { label: "Build the plan", onClick: () => void actions.propose(), hint: "Takes a few seconds; checks every operating rule" };
  } else if (!released || dirty) {
    main = {
      label: released ? `Send update (v${plan!.plan.version + 1})` : "Send plan to depot",
      onClick: () => void actions.release(),
      disabled: blocked > 0,
      hint: blocked > 0
        ? undecided ? "Give every deferred order a reason first" : "Fix the rule problems first"
        : deferred ? `Stores of the ${deferred} deferred ${deferred === 1 ? "order are" : "orders are"} told at the same time` : undefined,
    };
  } else {
    main = { label: "Open live view", onClick: () => onTab("live") };
  }

  return (
    <section aria-label="Today's steps" className="rounded-lg border border-wp-border bg-wp-surface p-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
        <ol className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-5 sm:gap-2">
          {steps.map((s, i) => (
            <li key={s.key} className="flex items-start gap-2 sm:flex-col sm:gap-1.5">
              <div className="flex items-center gap-2 sm:w-full">
                <span aria-hidden="true" className={cn("flex size-6 flex-none items-center justify-center rounded-full text-[12px] font-bold", DOT[s.state])}>
                  {s.state === "done" ? "✓" : s.state === "attention" ? "!" : i + 1}
                </span>
                <span className="hidden h-0.5 flex-1 bg-wp-border sm:block" />
              </div>
              <div>
                <div className={cn("text-[13px] font-semibold", s.state === "later" ? "text-wp-muted" : "text-wp-text")}>
                  {s.title}
                  <span className="sr-only"> ({s.state === "done" ? "done" : s.state === "now" ? "next" : s.state === "attention" ? "needs attention" : "later"})</span>
                </div>
                <div className="text-[12px] text-wp-text-2">
                  {s.key === "deferred" && built && deferred > 0 ? (
                    <button type="button" onClick={() => onTab("deferrals")} className="cursor-pointer text-left underline">
                      {s.detail}
                    </button>
                  ) : (
                    s.detail
                  )}
                </div>
              </div>
            </li>
          ))}
        </ol>
        {main && (
          <div className="flex flex-col items-stretch gap-1 lg:w-[240px]">
            <Button className="min-h-11 text-[14px]" disabled={busy || main.disabled} onClick={main.onClick}>
              {busy ? "Working…" : main.label}
            </Button>
            {main.hint && <div className="text-center text-[11px] text-wp-text-2">{main.hint}</div>}
            {built && !released && (
              <Button variant="link" className="min-h-7 text-[12px]" disabled={busy} onClick={() => void actions.propose()}>
                Rebuild with the engine (drops manual changes)
              </Button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
