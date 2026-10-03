import type { Metadata } from "next";
import { SignIn } from "@clerk/nextjs";

export const metadata: Metadata = {
  title: "Sign in · Waypoint",
};

export default function SignInPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-wp-canvas p-6 text-wp-text">
      <h1 className="text-[22px] font-bold">Waypoint</h1>
      {/* `path` keeps Clerk's multi-step flow inside this catch-all route. */}
      <SignIn path="/sign-in" />
    </main>
  );
}
