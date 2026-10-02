import Link from "next/link";

const ROLES = [
  { href: "/dispatcher", label: "Dispatcher", description: "Plan board, deferrals, live run monitor, ledger" },
  { href: "/loader", label: "Loader", description: "Dock tablet: load lists, flags, departure check" },
  { href: "/driver", label: "Driver", description: "Phone app: my run, stops, deliveries, problems" },
  { href: "/store-manager", label: "Store manager", description: "Deliveries, orders and receipt confirmation" },
];

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-wp-canvas p-6 text-wp-text">
      <h1 className="text-[22px] font-bold">Waypoint</h1>
      <ul className="grid w-full max-w-2xl gap-3 sm:grid-cols-2">
        {ROLES.map((role) => (
          <li key={role.href}>
            <Link
              href={role.href}
              className="flex flex-col gap-1 rounded-lg border border-wp-border bg-wp-surface p-4 hover:border-wp-action"
            >
              <span className="text-[15px] font-semibold">{role.label}</span>
              <span className="text-[13px] text-wp-text-2">{role.description}</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
