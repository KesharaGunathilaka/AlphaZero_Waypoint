import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { SignOutButton, UserButton } from "@clerk/nextjs";

export const metadata: Metadata = {
  title: "No access · Waypoint",
};

/** Signed in and in an organization, but with no Waypoint role assigned. */
export default async function NoAccessPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-wp-canvas p-6 text-center text-wp-text">
      <UserButton />
      <h1 className="text-[22px] font-bold">No role assigned</h1>
      <p className="max-w-sm text-[13px] text-wp-text-2">
        Your account is in the organization but has not been given a Waypoint role yet. Ask an admin to
        assign you Dispatcher, Driver, Loader or Store manager.
      </p>
      <SignOutButton>
        <button
          type="button"
          className="h-8 cursor-pointer rounded-md border border-wp-border bg-wp-surface px-3 text-xs font-semibold"
        >
          Sign out
        </button>
      </SignOutButton>
    </main>
  );
}
