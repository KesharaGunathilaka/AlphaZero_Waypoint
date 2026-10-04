import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SignUp } from "@clerk/nextjs";
import { Logo } from "@/components/waypoint/logo";
import { AUTH_MODE } from "@/lib/auth-mode";

export const metadata: Metadata = {
  title: "Sign up · Waypoint",
};

export default function SignUpPage() {
  // Local sign-in has fixed demo accounts; nobody signs up.
  if (AUTH_MODE === "local") redirect("/sign-in");
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-wp-canvas p-6 text-wp-text">
      <h1>
        <Logo className="h-12" />
      </h1>
      <SignUp path="/sign-up" />
    </main>
  );
}
