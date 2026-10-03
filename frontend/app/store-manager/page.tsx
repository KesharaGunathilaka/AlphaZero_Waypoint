import type { Metadata } from "next";
import { StoreManagerApp } from "./_components/store-manager-app";

export const metadata: Metadata = {
  title: "Store manager · Waypoint",
};

export default function StoreManagerPage() {
  return <StoreManagerApp />;
}
