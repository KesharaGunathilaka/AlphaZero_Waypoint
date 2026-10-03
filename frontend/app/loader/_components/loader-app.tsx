"use client";

import { useState } from "react";
import { findVehicle, isFullyLoaded, progressOf } from "./data";
import { DepartureCheck } from "./departure-check";
import { LoadList } from "./load-list";
import { useLoadPlans } from "./use-load-plans";
import { usePlanFeed } from "./use-plan-feed";
import { VehiclesToLoad } from "./vehicles-to-load";

type LoaderScreen = "vehicles" | "list" | "departure";

/** Loader screens for the shared dock tablet (landscape, dark theme). */
export function LoaderApp() {
  const [screen, setScreen] = useState<LoaderScreen>("vehicles");
  const [vehicleId, setVehicleId] = useState("RT-03");
  const { vehicles, plan, changes, acknowledge } = usePlanFeed();
  const { plans, toggleLine, confirmStop, setFlag } = useLoadPlans();
  const vehicle = findVehicle(vehicles, vehicleId);
  const stops = plans[vehicle.id];

  /**
   * Opening a vehicle acknowledges any plan change on it, since its new load
   * list is what comes up. A vehicle with nothing left to load opens its
   * departure check instead.
   */
  function openVehicle(id: string) {
    setVehicleId(id);
    acknowledge(id);
    setScreen(isFullyLoaded(progressOf(plans[id])) ? "departure" : "list");
  }

  return (
    <div
      data-theme="dark"
      className="flex min-h-screen flex-col items-center gap-4 bg-[#05080d] p-4 text-base text-wp-text tabular-nums"
    >
      {screen === "vehicles" && (
        <VehiclesToLoad
          vehicles={vehicles}
          plans={plans}
          plan={plan}
          changes={changes}
          onOpenVehicle={openVehicle}
        />
      )}
      {screen === "list" && (
        <LoadList
          vehicle={vehicle}
          stops={stops}
          onToggleLine={(stop, lineId) => toggleLine(vehicle.id, stop, lineId)}
          onConfirmStop={(stop) => confirmStop(vehicle.id, stop)}
          onFlag={(stop, lineId, flag) => setFlag(vehicle.id, stop, lineId, flag)}
          onBack={() => setScreen("vehicles")}
          onDepartureCheck={() => setScreen("departure")}
        />
      )}
      {screen === "departure" && (
        <DepartureCheck
          vehicle={vehicle}
          stops={stops}
          plan={plan}
          onReopen={() => setScreen("list")}
          onBack={() => setScreen("vehicles")}
        />
      )}
    </div>
  );
}
