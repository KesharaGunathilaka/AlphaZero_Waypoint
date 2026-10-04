"use client";

import { useState } from "react";
import { DriverNavProvider, type DriverScreen } from "./driver-nav";
import { MyRun, MyRunMoving } from "./my-run";
import { RecordDelivery } from "./record-delivery";
import { ReportProblem } from "./report-problem";
import { RouteComplete } from "./route-complete";
import { StopDetails } from "./stop-details";

/** Driver app · Mahinda, RT-03. Phone, portrait; screens are reached from the in-app drawer. */
export function DriverApp() {
  const [screen, setScreen] = useState<DriverScreen>("run");

  return (
    <DriverNavProvider screen={screen} onNavigate={setScreen}>
      <div className="flex min-h-screen flex-col items-center justify-center bg-wp-surface-2 p-4 text-wp-text tabular-nums max-sm:pb-20">
        {screen === "run" && <MyRun onNavigate={setScreen} />}
        {screen === "moving" && <MyRunMoving onNavigate={setScreen} />}
        {screen === "complete" && <RouteComplete onNavigate={setScreen} />}
        {screen === "stop" && <StopDetails onNavigate={setScreen} />}
        {screen === "deliver" && <RecordDelivery onNavigate={setScreen} />}
        {screen === "problem" && <ReportProblem onClose={() => setScreen("run")} />}
      </div>
    </DriverNavProvider>
  );
}
