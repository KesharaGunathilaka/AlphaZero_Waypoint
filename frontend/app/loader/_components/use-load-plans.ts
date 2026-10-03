"use client";

import { useCallback, useState } from "react";
import { LOAD_PLANS, type LineFlag, type LoadLine, type LoadStop } from "./data";

type Plans = Record<string, LoadStop[]>;

/**
 * Rewrites one line of one stop, leaving every other object identical. Touching
 * a line reopens its stop: whatever the loader signed off has just changed.
 */
function editLine(
  plans: Plans,
  vehicleId: string,
  stopNumber: number,
  lineId: string,
  edit: (line: LoadLine) => LoadLine,
): Plans {
  return {
    ...plans,
    [vehicleId]: plans[vehicleId].map((stop) =>
      stop.stop !== stopNumber
        ? stop
        : {
            ...stop,
            confirmed: false,
            lines: stop.lines.map((line) => (line.id === lineId ? edit(line) : line)),
          },
    ),
  };
}

/**
 * The lines on board, per vehicle.
 *
 * Confirmations, flags and therefore the load gauges all come from here, so the
 * queue, the load list and the departure check never disagree about a vehicle.
 */
export function useLoadPlans() {
  const [plans, setPlans] = useState<Plans>(LOAD_PLANS);

  const toggleLine = useCallback((vehicleId: string, stopNumber: number, lineId: string) => {
    setPlans((current) =>
      editLine(current, vehicleId, stopNumber, lineId, (line) =>
        // A flagged line is settled with the dispatcher; the flag comes off first.
        line.flag ? line : { ...line, confirmed: !line.confirmed },
      ),
    );
  }, []);

  /**
   * Signs the stop off: everything not already settled by a flag is loaded, and
   * the stop is confirmed with its flags intact, since a flag is the record of
   * what the dispatcher was told rather than unfinished work.
   */
  const confirmStop = useCallback((vehicleId: string, stopNumber: number) => {
    setPlans((current) => ({
      ...current,
      [vehicleId]: current[vehicleId].map((stop) =>
        stop.stop !== stopNumber
          ? stop
          : {
              ...stop,
              confirmed: true,
              lines: stop.lines.map((line) => (line.flag ? line : { ...line, confirmed: true })),
            },
      ),
    }));
  }, []);

  /**
   * Sends or withdraws a flag. A missing line has nothing on board, so it is
   * also unconfirmed; a short or damaged line still loads what arrived.
   */
  const setFlag = useCallback(
    (vehicleId: string, stopNumber: number, lineId: string, flag: LineFlag | null) => {
      setPlans((current) =>
        editLine(current, vehicleId, stopNumber, lineId, (line) =>
          flag
            ? { ...line, flag, confirmed: flag.type !== "Missing" }
            : { ...line, flag: undefined, confirmed: false },
        ),
      );
    },
    [],
  );

  return { plans, toggleLine, confirmStop, setFlag };
}
