"use client";

import { useState, type FormEvent } from "react";
import { DEMO_PASSWORD } from "@/lib/auth-mode";

export type DemoAccount = {
  email: string;
  name: string;
  role: string;
  outlet: string | null;
  vehicle: string | null;
  depot: string | null;
};

const ROLE_LABEL: Record<string, string> = {
  dispatcher: "Dispatcher",
  loader: "Loader",
  driver: "Driver",
  store_manager: "Store manager",
  admin: "Admin (all apps)",
};

function detail(a: DemoAccount): string {
  if (a.outlet) return `Outlet ${a.outlet}`;
  if (a.vehicle) return `Vehicle ${a.vehicle}`;
  if (a.depot) return a.depot.includes(" and ") ? `${a.depot} depots` : `${a.depot} depot`;
  return "Every role's app";
}

/** Local sign-in (Docker delivery): email + password, plus one-tap sign-in for each demo account. */
export function LocalSignIn({ accounts }: { accounts: DemoAccount[] }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function signIn(emailValue: string, passwordValue: string) {
    setBusy(emailValue);
    setError(null);
    try {
      const res = await fetch("/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailValue, password: passwordValue }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Sign-in failed. Try again.");
      // A full load on purpose: the root layout (kept across client navigations) must read the new cookie.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-in failed. Try again.");
      setBusy(null);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    void signIn(email, password);
  }

  return (
    <div className="grid w-full max-w-[880px] gap-4 md:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
      <form onSubmit={submit} className="flex flex-col gap-3 rounded-xl border border-wp-border bg-wp-surface p-5 shadow-sm">
        <h2 className="text-[17px] font-bold text-wp-text">Sign in</h2>
        <label className="flex flex-col gap-1 text-[12px] font-semibold text-wp-text-2">
          Email
          <input
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-11 rounded-md border border-wp-border bg-wp-surface px-3 text-[15px] font-normal text-wp-text outline-none focus:border-wp-focus"
          />
        </label>
        <label className="flex flex-col gap-1 text-[12px] font-semibold text-wp-text-2">
          Password
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-11 rounded-md border border-wp-border bg-wp-surface px-3 text-[15px] font-normal text-wp-text outline-none focus:border-wp-focus"
          />
        </label>
        {error && (
          <p role="alert" className="rounded-md bg-wp-crit-tint px-3 py-2 text-[13px] text-wp-crit">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy !== null}
          className="h-11 cursor-pointer rounded-md bg-wp-action text-[15px] font-semibold text-wp-on-action disabled:opacity-60"
        >
          {busy === email && email ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <section className="flex flex-col gap-2 rounded-xl border border-wp-border bg-wp-surface p-5 shadow-sm">
        <h2 className="text-[17px] font-bold text-wp-text">Demo accounts</h2>
        <p className="text-[13px] text-wp-text-2">
          Tap an account to sign in. All of them use the password{" "}
          <code className="rounded bg-wp-surface-2 px-1.5 py-0.5 font-mono text-[12px]">{DEMO_PASSWORD}</code>.
        </p>
        <ul className="mt-1 grid gap-2 sm:grid-cols-2">
          {accounts.map((a) => (
            <li key={a.email}>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void signIn(a.email, DEMO_PASSWORD)}
                className="flex w-full cursor-pointer flex-col items-start rounded-lg border border-wp-border px-3 py-2.5 text-left hover:border-wp-focus hover:bg-wp-surface-2 disabled:opacity-60"
              >
                <span className="text-[11px] font-semibold uppercase tracking-[.06em] text-wp-action">
                  {ROLE_LABEL[a.role] ?? a.role}
                </span>
                <span className="text-[14px] font-semibold text-wp-text">
                  {busy === a.email ? "Signing in…" : a.name}
                </span>
                <span className="text-[12px] text-wp-muted">
                  {detail(a)} · {a.email}
                </span>
              </button>
            </li>
          ))}
          {accounts.length === 0 && (
            <li className="text-[13px] text-wp-muted">The server did not answer; sign in with an email and password.</li>
          )}
        </ul>
      </section>
    </div>
  );
}
