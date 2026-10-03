"use client";

import { useCallback, useEffect, useState } from "react";
import {
  INCOMING_PLAN_CHANGES,
  INITIAL_PLAN,
  PLAN_FEED_DELAY_MS,
  RECEIVED_PLAN_CHANGES,
  VEHICLES,
  acknowledgePlanChange,
  applyPlanChange,
  sortByDeparture,
  type LoadingVehicle,
  type PlanChange,
  type PlanVersion,
} from "./data";

type PlanFeed = {
  vehicles: LoadingVehicle[];
  /** The plan the dock is working to. */
  plan: PlanVersion;
  /** Changes the loader has not opened yet, newest first. */
  changes: PlanChange[];
};

function initialFeed(): PlanFeed {
  return {
    vehicles: RECEIVED_PLAN_CHANGES.reduce(applyPlanChange, sortByDeparture(VEHICLES)),
    plan: INITIAL_PLAN,
    changes: [...RECEIVED_PLAN_CHANGES].reverse(),
  };
}

/**
 * The dock tablet's subscription to re-issued plans.
 *
 * A change re-sorts the queue by departure time and marks the vehicle, so a run
 * that was moved earlier cannot stay buried further down the list. Opening the
 * vehicle acknowledges it: the loader has seen the new load list by then.
 */
export function usePlanFeed() {
  const [feed, setFeed] = useState(initialFeed);

  const receive = useCallback((change: PlanChange) => {
    setFeed((current) => {
      // Re-delivery of a plan already applied (a reconnect, or React's dev double-mount).
      if (current.plan.version === change.plan.version) return current;
      return {
        vehicles: applyPlanChange(current.vehicles, change),
        plan: change.plan,
        changes: [change, ...current.changes],
      };
    });
  }, []);

  const acknowledge = useCallback((id: string) => {
    setFeed((current) => ({
      ...current,
      vehicles: acknowledgePlanChange(current.vehicles, id),
      changes: current.changes.filter((change) => change.vehicleId !== id),
    }));
  }, []);

  useEffect(() => {
    const timers = INCOMING_PLAN_CHANGES.map((change, i) =>
      setTimeout(() => receive(change), PLAN_FEED_DELAY_MS * (i + 1)),
    );
    return () => timers.forEach(clearTimeout);
  }, [receive]);

  return { ...feed, acknowledge };
}
