"use client";

import { useEffect, useState } from "react";
import { DriverNavProvider, type DriverScreen } from "./driver-nav";
import { MyRun, MyRunMoving } from "./my-run";
import { RecordDelivery } from "./record-delivery";
import { ReportProblem } from "./report-problem";
import { RouteComplete } from "./route-complete";
import { StopDetails } from "./stop-details";
import { RunProvider, useRun } from "./use-run";

/** Driver app. Phone, portrait; screens are reached from the in-app drawer. Works without signal. */
export function DriverApp() {
  const [screen, setScreen] = useState<DriverScreen>("run");

  // Production builds cache the app shell so the run reopens after a reload with no signal.
  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js", { scope: "/driver" });
    }
  }, []);

  return (
    <RunProvider>
      <DriverNavProvider screen={screen} onNavigate={setScreen}>
        <div className="flex min-h-screen flex-col items-center justify-center bg-wp-surface-2 p-4 text-wp-text tabular-nums max-sm:pb-20">
          <Screens screen={screen} onNavigate={setScreen} />
        </div>
      </DriverNavProvider>
    </RunProvider>
  );
}

function Screens({ screen, onNavigate }: { screen: DriverScreen; onNavigate: (s: DriverScreen) => void }) {
  const { trips, currentTrip } = useRun();
  // Between trips (one finished, the next not started) "My run" is the trip summary.
  const betweenTrips = trips.some((t) => t.done) && (!currentTrip || currentTrip.done || !currentTrip.departed);
  const shown = screen === "run" && betweenTrips ? "complete" : screen;

  return (
    <>
      {shown === "run" && <MyRun onNavigate={onNavigate} />}
      {shown === "moving" && <MyRunMoving onNavigate={onNavigate} />}
      {shown === "complete" && <RouteComplete onNavigate={onNavigate} />}
      {shown === "stop" && <StopDetails onNavigate={onNavigate} />}
      {shown === "deliver" && <RecordDelivery onNavigate={onNavigate} />}
      {shown === "problem" && <ReportProblem onClose={() => onNavigate("run")} />}
    </>
  );
}
