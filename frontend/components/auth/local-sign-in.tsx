"use client";

import { LayoutDashboard, PackageCheck, Store, Truck } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { Brand } from "@/components/waypoint/data";
import { DEMO_PASSWORD } from "@/lib/auth-mode";
import { cn } from "@/lib/utils";

export type DemoAccount = {
  email: string;
  name: string;
  role: string;
  outlet: string | null;
  vehicle: string | null;
  depot: string | null;
  brand?: string | null;
  district?: string | null;
  vehicle_class?: string | null;
};

/** The four roles, in the order goods move: plan, load, drive, receive. */
const ROLES: { role: string; title: string; does: string; Icon: typeof Truck }[] = [
  { role: "dispatcher", title: "Dispatcher", does: "Plans the day, watches it run, plans capacity", Icon: LayoutDashboard },
  { role: "loader", title: "Loader", does: "Loads each van at the dock, flags shortages", Icon: PackageCheck },
  { role: "driver", title: "Driver", does: "Runs the trip, records each delivery, works offline", Icon: Truck },
  { role: "store_manager", title: "Store manager", does: "Orders stock, follows the delivery, confirms receipt", Icon: Store },
];
const BRANDS = ["Fresh", "Style", "Tech"] as const;
const BRAND_LOOK: Record<string, Brand> = { Fresh: "fresh", Style: "style", Tech: "tech" };
/** "Waypoint Fresh" -> "Fresh" */
const brandOf = (a: DemoAccount) => a.brand?.split(" ").pop() ?? "";

function detail(a: DemoAccount): string {
  if (a.outlet) return [a.outlet, a.district].filter(Boolean).join(" · ");
  if (a.vehicle) return [a.vehicle, a.vehicle_class].filter(Boolean).join(" · ");
  if (a.depot) return a.depot.includes(" and ") ? `${a.depot} depots` : `${a.depot} depot`;
  return "";
}

/**
 * Local sign-in (Docker delivery): one big tile per role with its demo accounts (store managers grouped by
 * brand), so a judge picks a role, not an email address. Email and password sign-in stays below.
 */
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

  const account = (a: DemoAccount) => (
    <button
      key={a.email}
      type="button"
      disabled={busy !== null}
      onClick={() => void signIn(a.email, DEMO_PASSWORD)}
      title={a.email}
      className="flex w-full cursor-pointer flex-col items-start rounded-lg border border-wp-border bg-wp-surface px-3 py-2 text-left hover:border-wp-focus hover:bg-wp-surface-2 disabled:opacity-60"
    >
      <span className="text-[14px] font-semibold text-wp-text">{busy === a.email ? "Signing in…" : a.name}</span>
      {detail(a) && <span className="text-[12px] text-wp-muted">{detail(a)}</span>}
    </button>
  );

  return (
    <div className="flex w-full max-w-[1200px] flex-col gap-5">
      <section aria-labelledby="roles-title" className="flex flex-col gap-3">
        <div className="text-center">
          <h2 id="roles-title" className="text-[20px] font-bold text-wp-text">Pick a role to try</h2>
          <p className="text-[13px] text-wp-text-2">
            Tap a person to sign in. Every demo account uses the password{" "}
            <code className="rounded bg-wp-surface-2 px-1.5 py-0.5 font-mono text-[12px]">{DEMO_PASSWORD}</code>.
          </p>
        </div>
        {accounts.length === 0 ? (
          <p className="rounded-xl border border-wp-border bg-wp-surface p-5 text-center text-[13px] text-wp-muted">
            The server did not answer; sign in with an email and password below.
          </p>
        ) : (
          <ul className="grid items-start gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {ROLES.map(({ role, title, does, Icon }) => {
              const people = accounts.filter((a) => a.role === role);
              if (people.length === 0) return null;
              return (
                <li key={role} className="flex flex-col gap-3 rounded-xl border border-wp-border bg-wp-surface p-4 shadow-sm">
                  <div className="flex items-start gap-3">
                    <span className="flex size-11 flex-none items-center justify-center rounded-xl bg-wp-action text-wp-on-action">
                      <Icon aria-hidden className="size-6" />
                    </span>
                    <div>
                      <h3 className="text-[17px] leading-6 font-bold text-wp-text">{title}</h3>
                      <p className="text-[12px] leading-4 text-wp-text-2">{does}</p>
                    </div>
                  </div>
                  {role === "store_manager" ? (
                    <>
                      {BRANDS.filter((b) => people.some((a) => brandOf(a) === b)).map((b) => (
                        <div key={b} className="flex flex-col gap-1.5">
                          <BrandLabel brand={b} />
                          {people.filter((a) => brandOf(a) === b).map(account)}
                        </div>
                      ))}
                      {people.filter((a) => !(BRANDS as readonly string[]).includes(brandOf(a))).map(account)}
                    </>
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      {people.map(account)}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <form onSubmit={submit}
            className="mx-auto flex w-full max-w-[720px] flex-col gap-3 rounded-xl border border-wp-border bg-wp-surface p-4 shadow-sm sm:flex-row sm:items-end">
        <h2 className="sr-only">Sign in with email</h2>
        <label className="flex flex-1 flex-col gap-1 text-[12px] font-semibold text-wp-text-2">
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
        <label className="flex flex-1 flex-col gap-1 text-[12px] font-semibold text-wp-text-2">
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
        <button
          type="submit"
          disabled={busy !== null}
          className="h-11 cursor-pointer rounded-md bg-wp-action px-6 text-[15px] font-semibold text-wp-on-action disabled:opacity-60"
        >
          {busy === email && email ? "Signing in…" : "Sign in"}
        </button>
      </form>
      {error && (
        <p role="alert" className="mx-auto w-full max-w-[720px] rounded-md bg-wp-crit-tint px-3 py-2 text-[13px] text-wp-crit">
          {error}
        </p>
      )}
    </div>
  );
}

function BrandLabel({ brand }: { brand: string }) {
  const look = BRAND_LOOK[brand];
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-[.06em] text-wp-text-2 uppercase">
      <span aria-hidden="true"
            className={cn("inline-flex size-4 items-center justify-center rounded text-[10px] font-bold text-white",
                          look === "fresh" ? "bg-wp-brand-fresh" : look === "style" ? "bg-wp-brand-style" : "bg-wp-brand-tech")}>
        {brand[0]}
      </span>
      {brand}
    </span>
  );
}
