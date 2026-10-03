import type { Metadata } from "next";
import { DispatcherApp } from "./_components/dispatcher-app";

export const metadata: Metadata = {
  title: "Dispatcher · Waypoint",
};

export default function DispatcherPage() {
  return <DispatcherApp />;
}
