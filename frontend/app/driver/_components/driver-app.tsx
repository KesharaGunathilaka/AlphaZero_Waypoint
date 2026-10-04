"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { DriverNavProvider, type DriverScreen } from "./driver-nav";
import { MyRun } from "./my-run";
import { RecordDelivery } from "./record-delivery";
import { ReportProblem } from "./report-problem";
import { RouteComplete } from "./route-complete";
import { StopDetails } from "./stop-details";
import { RunProvider, useRun } from "./use-run";

const noop = () => () => {};

/** Driver app. Phone, portrait, full screen; works without signal. */
export function DriverApp() {
  const [screen, setScreen] = useState<DriverScreen>("run");
  // The run lives on the phone (localStorage). The server cannot see it, so the run is only read once the
  // page is hydrated: the server's HTML and the phone's first render then match (no hydration error).
  const hydrated = useSyncExternalStore(noop, () => true, () => false);

  // Production builds cache the app shell so the run reopens after a reload with no signal.
  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js", { scope: "/driver" });
    }
  }, []);

  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-wp-surface-2 text-wp-text tabular-nums sm:p-4">
      {hydrated ? (
        <RunProvider>
          <DriverNavProvider screen={screen} onNavigate={setScreen}>
            <Screens screen={screen} onNavigate={setScreen} />
          </DriverNavProvider>
        </RunProvider>
      ) : (
        <div className="text-wp-text-2">Opening your run…</div>
      )}
    </div>
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
      {shown === "complete" && <RouteComplete onNavigate={onNavigate} />}
      {shown === "stop" && <StopDetails onNavigate={onNavigate} />}
      {shown === "deliver" && <RecordDelivery onNavigate={onNavigate} />}
      {shown === "problem" && <ReportProblem onClose={() => onNavigate("run")} />}
    </>
  );
}
