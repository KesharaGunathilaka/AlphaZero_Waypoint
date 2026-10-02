"use client";

import { useState } from "react";
import { ScreenSwitcher } from "@/components/waypoint/screen-switcher";
import { MyRun, MyRunMoving } from "./my-run";
import { RecordDelivery } from "./record-delivery";
import { ReportProblem } from "./report-problem";
import { StopDetails } from "./stop-details";

const SCREENS = [
  ["run", "R1 · My run"],
  ["moving", "R1 · Moving"],
  ["stop", "R2 · Stop details"],
  ["deliver", "R3 · Record delivery"],
  ["problem", "R4 · Report a problem"],
] as const;
export type DriverScreen = (typeof SCREENS)[number][0];

/** Driver app · Mahinda, RT-03. Phone, portrait. */
export function DriverApp() {
  const [screen, setScreen] = useState<DriverScreen>("run");

  return (
    <div className="flex min-h-screen flex-col items-center gap-4 bg-wp-surface-2 p-4 text-wp-text tabular-nums">
      <ScreenSwitcher screens={SCREENS} current={screen} onChange={setScreen} />
      {screen === "run" && <MyRun onNavigate={setScreen} />}
      {screen === "moving" && <MyRunMoving />}
      {screen === "stop" && <StopDetails onNavigate={setScreen} />}
      {screen === "deliver" && <RecordDelivery onSaved={() => setScreen("run")} />}
      {screen === "problem" && <ReportProblem onClose={() => setScreen("run")} />}
    </div>
  );
}
