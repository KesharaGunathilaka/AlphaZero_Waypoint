"use client";

import { useState } from "react";
import { ScreenSwitcher } from "@/components/waypoint/screen-switcher";
import { DepartureCheck } from "./departure-check";
import { LoadList } from "./load-list";
import { VehiclesToLoad } from "./vehicles-to-load";

const SCREENS = [
  ["vehicles", "L1 · Vehicles to load"],
  ["list", "L2 · Load list"],
  ["flag", "L2 · Flag sheet"],
  ["departure", "L3 · Departure check"],
] as const;
type LoaderScreen = (typeof SCREENS)[number][0];

/** Loader screens for the shared dock tablet (landscape, dark theme). */
export function LoaderApp() {
  const [screen, setScreen] = useState<LoaderScreen>("vehicles");

  return (
    <div
      data-theme="dark"
      className="flex min-h-screen flex-col items-center gap-4 bg-[#05080d] p-4 text-base text-wp-text tabular-nums"
    >
      <ScreenSwitcher screens={SCREENS} current={screen} onChange={setScreen} />
      {screen === "vehicles" && <VehiclesToLoad onOpenVehicle={() => setScreen("list")} />}
      {(screen === "list" || screen === "flag") && (
        <LoadList
          flagOpen={screen === "flag"}
          onFlagOpenChange={(open) => setScreen(open ? "flag" : "list")}
          onBack={() => setScreen("vehicles")}
        />
      )}
      {screen === "departure" && <DepartureCheck onReopen={() => setScreen("list")} />}
    </div>
  );
}
