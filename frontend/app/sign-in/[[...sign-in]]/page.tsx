import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SignIn } from "@clerk/nextjs";
import { LocalSignIn, type DemoAccount } from "@/components/auth/local-sign-in";
import { Logo } from "@/components/waypoint/logo";
import { AUTH_MODE } from "@/lib/auth-mode";
import { getLocalSession } from "@/lib/local-session";

export const metadata: Metadata = {
  title: "Sign in · Waypoint",
};

/** The demo accounts the API can sign in locally (empty if the API is not reachable yet). */
async function demoAccounts(): Promise<DemoAccount[]> {
  const base = (process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/+$/, "");
  try {
    const res = await fetch(`${base}/api/v1/auth/accounts`, { cache: "no-store" });
    return res.ok ? ((await res.json()) as DemoAccount[]) : [];
  } catch {
    return [];
  }
}

export default async function SignInPage() {
  if (AUTH_MODE === "local" && (await getLocalSession())) redirect("/");

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-wp-canvas p-4 text-wp-text sm:p-6">
      <h1>
        <Logo className="h-12" />
      </h1>
      {AUTH_MODE === "local" ? (
        <LocalSignIn accounts={await demoAccounts()} />
      ) : (
        // `path` keeps Clerk's multi-step flow inside this catch-all route.
        <SignIn path="/sign-in" />
      )}
    </main>
  );
}
