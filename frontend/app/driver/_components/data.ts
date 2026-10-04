// Stand-in data for the driver prototype. Replace with the run API once it exists.

/** Dispatch desk for RT-03. Dialled from the call buttons on every screen. */
export const DISPATCHER = { name: "Dispatch · Colombo", tel: "+94112345678" };

/** The stop the prototype is parked on: Fresh Pettah, stop 5 of 9. */
export const CURRENT_STOP = {
  name: "Fresh Pettah",
  contact: { name: "Nimal Perera", tel: "+94771234567" },
  /** Rear dock on Prince St., used to hand the turn-by-turn off to the phone's map app. */
  destination: "6.9355,79.8487",
};

/** Opens the phone's map app at the stop, rather than shipping our own turn-by-turn. */
export function navigationUrl(destination: string) {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
}
