"use client";

import { useState } from "react";
import { DISPATCHER, PROBLEMS } from "./data";
import { BigButton, BigLink, Body, BottomBar, Card, ChoiceTile, PhoneScreen, SectionLabel, TopBar } from "./phone-ui";
import { useRun } from "./use-run";

const DELAYS = [
  { label: "15 min", minutes: 15 },
  { label: "30 min", minutes: 30 },
  { label: "60+ min", minutes: 60 },
];

/** R4 · Report a problem. Works offline: the report is queued and sent when signal returns. */
export function ReportProblem({ onClose }: { onClose: () => void }) {
  const { outbox, reportProblem, currentTrip, currentStop } = useRun();
  const [problem, setProblem] = useState<string>(PROBLEMS[0].code);
  const [delay, setDelay] = useState(DELAYS[1].minutes);
  const [note, setNote] = useState("");
  const [sent, setSent] = useState(false);
  const needsNote = problem === "other" && !note.trim();

  function save() {
    reportProblem(problem, problem === "running_late" ? delay : null, note.trim() || null);
    setSent(true);
  }

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
        {!outbox.online && (
          <div className="rounded-xl bg-wp-offline-tint p-3 leading-[22px] font-semibold text-wp-offline">
            ○ No signal. Your report is kept on this phone and sent automatically. Call if it can’t wait.
          </div>
        )}
        {sent ? (
          <Card>
            <div className="text-[22px] leading-[26px] font-bold">✓ Report saved</div>
            <div className="text-wp-text-2">
              {outbox.online ? "Dispatch has it." : "It is sent to dispatch when signal returns."} Replies appear on My run.
            </div>
          </Card>
        ) : (
          <>
            <div className="text-[13px] text-wp-text-2">
              {currentStop ? `About stop ${currentStop.seq}, ${currentStop.outlet.name}` : currentTrip ? "About this trip" : ""}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {PROBLEMS.map((p) => (
                <ChoiceTile key={p.code} selected={problem === p.code} onClick={() => setProblem(p.code)} className="gap-2">
                  {problem === p.code && "✓ "}
                  {p.label}
                </ChoiceTile>
              ))}
            </div>
            {problem === "running_late" && (
              <Card>
                <SectionLabel>HOW LATE?</SectionLabel>
                <div className="grid grid-cols-3 gap-2">
                  {DELAYS.map((d) => (
                    <ChoiceTile key={d.minutes} selected={delay === d.minutes} onClick={() => setDelay(d.minutes)} className="min-h-14">
                      {delay === d.minutes && "✓ "}
                      {d.label}
                    </ChoiceTile>
                  ))}
                </div>
              </Card>
            )}
            <input
              placeholder={problem === "other" ? "What happened? (required)" : "Add a note (optional)"}
              aria-label="Add a note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="h-12 rounded-[10px] border border-wp-border bg-wp-surface px-3 text-base text-wp-text placeholder:text-wp-muted"
            />
          </>
        )}
      </Body>
      <BottomBar>
        {sent ? (
          <BigButton className="w-full" onClick={onClose}>Back to my run</BigButton>
        ) : (
          <BigButton className="w-full" disabled={!currentTrip || needsNote} onClick={save}>
            Save report
          </BigButton>
        )}
      </BottomBar>
    </PhoneScreen>
  );
}
