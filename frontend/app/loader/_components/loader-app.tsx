"use client";

import { useState } from "react";
import { useApiData } from "@/lib/api/use-api";
import { isFullyLoaded, type LoadingVehicle } from "./data";
import { DepartureCheck } from "./departure-check";
import { LoadList } from "./load-list";
import { TabletScreen } from "./tablet-ui";
import { useDock, useLoadPlan } from "./use-dock";
import { VehiclesToLoad } from "./vehicles-to-load";

type LoaderScreen = "vehicles" | "list" | "departure";

/** Loader screens for the shared dock tablet (landscape, dark theme). */
export function LoaderApp() {
  const [screen, setScreen] = useState<LoaderScreen>("vehicles");
  const [routeId, setRouteId] = useState<number | null>(null);
  const me = useApiData<{ name: string; depot: string | null }>("/me");
  const dock = useDock();
  const vehicle = dock.vehicles.find((v) => v.routeId === routeId) ?? null;
  const who = me.data?.name ?? "";

  /**
   * Opening a vehicle acknowledges any plan change on it, since its new load list is what comes up.
   * A vehicle with nothing left to load opens its departure check instead.
   */
  function openVehicle(id: string) {
    const v = dock.vehicles.find((x) => x.id === id);
    if (!v) return;
    setRouteId(v.routeId);
    dock.acknowledge(v.routeId);
    setScreen(v.released || isFullyLoaded(dock.progress[id]) ? "departure" : "list");
  }

  return (
    <div data-theme="dark" className="flex min-h-screen flex-col items-center gap-4 bg-[#05080d] p-4 text-base text-wp-text tabular-nums">
      {screen === "vehicles" || !vehicle ? (
        <VehiclesToLoad
          vehicles={dock.vehicles}
          progress={dock.progress}
          plan={dock.plan}
          depot={me.data?.depot ?? null}
          who={who}
          outbox={dock.outbox}
          loading={!dock.feed.data && !dock.feed.error}
          error={dock.feed.error}
          onOpenVehicle={openVehicle}
        />
      ) : (
        <TripScreens key={vehicle.routeId} vehicle={vehicle} screen={screen} who={who} outbox={dock.outbox}
                     onScreen={setScreen} />
      )}
    </div>
  );
}

/** The load list and departure check of one trip, sharing its load plan. */
function TripScreens({
  vehicle,
  screen,
  who,
  outbox,
  onScreen,
}: {
  vehicle: LoadingVehicle;
  screen: LoaderScreen;
  who: string;
  outbox: ReturnType<typeof useDock>["outbox"];
  onScreen: (s: LoaderScreen) => void;
}) {
  const plan = useLoadPlan(vehicle.routeId, outbox);

  if (!plan.detail.data) {
    return (
      <TabletScreen label="Loading">
        <div className="p-6 text-wp-text-2">{plan.detail.error ?? `Opening ${vehicle.label}…`}</div>
      </TabletScreen>
    );
  }

  return screen === "departure" ? (
    <DepartureCheck
      vehicle={vehicle}
      stops={plan.stops}
      who={who}
      outbox={outbox}
      released={plan.released}
      onRelease={plan.release}
      onReopen={() => {
        if (plan.released) plan.reopen();
        onScreen("list");
      }}
      onBack={() => onScreen("vehicles")}
    />
  ) : (
    <LoadList
      vehicle={vehicle}
      stops={plan.stops}
      who={who}
      outbox={outbox}
      onToggleLine={plan.toggleLine}
      onConfirmStop={plan.confirmStop}
      onFlag={(stop, lineId, flag) => void plan.setFlag(stop, lineId, flag)}
      onBack={() => onScreen("vehicles")}
      onDepartureCheck={() => onScreen("departure")}
    />
  );
}
