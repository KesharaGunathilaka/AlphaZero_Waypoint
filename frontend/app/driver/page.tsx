import type { Metadata } from "next";
import { DriverApp } from "./_components/driver-app";

export const metadata: Metadata = {
  title: "Driver · Waypoint",
};

export default function DriverPage() {
  return <DriverApp />;
}
