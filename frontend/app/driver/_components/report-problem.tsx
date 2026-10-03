"use client";

import { useState } from "react";
import { DISPATCHER } from "./data";
import { BigButton, BigLink, Body, BottomBar, Card, ChoiceTile, PhoneScreen, SectionLabel, TopBar } from "./phone-ui";

const PROBLEMS = [
  "Running late",
  "Can’t reach the outlet",
  "Outlet closed",
  "Vehicle problem",
  "Load problem",
  "Something else",
];
const DELAYS = ["15 min", "30 min", "60+ min"];

/** R4 · Report a problem. Works offline: the report is queued and sent when signal returns. */
export function ReportProblem({ onClose }: { onClose: () => void }) {
  const [problem, setProblem] = useState(PROBLEMS[0]);
  const [delay, setDelay] = useState(DELAYS[1]);

  return (
    <PhoneScreen label="R4 Report a problem">
      <TopBar>
        <div className="font-bold">Report a problem</div>
        <button type="button" onClick={onClose} className="cursor-pointer font-semibold">
          ✕ Close
        </button>
      </TopBar>
      <Body>
        <BigLink href={`tel:${DISPATCHER.tel}`}>☎ Call dispatcher now</BigLink>
        <div className="rounded-xl bg-wp-offline-tint p-3 leading-[22px] font-semibold text-wp-offline">
          ○ No signal. Your report is kept on this phone and sent automatically. Call if it can’t wait.
        </div>

        <div className="grid grid-cols-2 gap-2">
          {PROBLEMS.map((p) => (
            <ChoiceTile key={p} selected={problem === p} onClick={() => setProblem(p)} className="gap-2">
              {problem === p && "✓ "}
              {p}
            </ChoiceTile>
          ))}
        </div>

        {problem === "Running late" && (
          <Card>
            <SectionLabel>HOW LATE?</SectionLabel>
            <div className="grid grid-cols-3 gap-2">
              {DELAYS.map((d) => (
                <ChoiceTile key={d} selected={delay === d} onClick={() => setDelay(d)} className="min-h-14">
                  {delay === d && "✓ "}
                  {d}
                </ChoiceTile>
              ))}
            </div>
            <input
              placeholder="Add a note (optional)"
              aria-label="Add a note"
              className="h-12 rounded-[10px] border border-wp-border bg-wp-surface px-3 text-base text-wp-text placeholder:text-wp-muted"
            />
          </Card>
        )}
      </Body>
      <BottomBar>
        <BigButton className="w-full" onClick={onClose}>
          Save report
        </BigButton>
      </BottomBar>
    </PhoneScreen>
  );
}
