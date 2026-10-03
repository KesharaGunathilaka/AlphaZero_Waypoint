import type { Metadata } from "next";
import { SignUp } from "@clerk/nextjs";
import { Logo } from "@/components/waypoint/logo";

export const metadata: Metadata = {
  title: "Sign up · Waypoint",
};

export default function SignUpPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-wp-canvas p-6 text-wp-text">
      <h1>
        <Logo className="h-12" />
      </h1>
      <SignUp path="/sign-up" />
    </main>
  );
}
