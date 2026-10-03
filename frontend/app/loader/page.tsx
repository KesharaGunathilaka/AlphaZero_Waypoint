import type { Metadata } from "next";
import { LoaderApp } from "./_components/loader-app";

export const metadata: Metadata = {
  title: "Loader · Waypoint",
};

export default function LoaderPage() {
  return <LoaderApp />;
}
