"use client";

import { Search } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Button, Chip, Select } from "@/components/waypoint/controls";
import { BrandMonogram } from "@/components/waypoint/data";
import { Banner, StatusPill } from "@/components/waypoint/status";
import { useApiData } from "@/lib/api/use-api";
import { formatDay } from "@/lib/format";
import { cn } from "@/lib/utils";
import { BRAND, BRAND_NAME, type BrandCode, type DayOrders, type MovedOrder, type OrderRow } from "./data";
import { orderPlace, useOpenOrder } from "./order-panel";

type Place = ReturnType<typeof orderPlace>["key"];
const STATES: [Place | "all", string][] = [
  ["all", "All"], ["cant_go", "Can't go"], ["moved", "Moved away"], ["waiting", "Not on a trip"], ["open", "Open"],
  ["trip", "On a trip"], ["delivered", "Delivered"],
];
/** What needs a decision first. */
const ORDER: Record<Place, number> = { cant_go: 0, moved: 1, waiting: 2, open: 3, trip: 4, delivered: 5 };
const COLUMNS = "lg:grid lg:grid-cols-[150px_minmax(170px,1.3fr)_88px_118px_52px_minmax(210px,1.4fr)] lg:items-center lg:gap-3";

/**
 * Every order of the delivery day for the chosen depot: what it is, and where it is now (on a trip,
 * can't go, moved away, delivered). Search and filters narrow the list; a row opens the full order.
 */
export function Orders({ date }: { date: string | null }) {
  const data = useApiData<DayOrders>(date ? `/dispatch/orders?date=${date}` : null, 30_000);
  const openOrder = useOpenOrder();
  const [state, setState] = useState<Place | "all">("all");
  const [brand, setBrand] = useState<BrandCode | "">("");
  const [temp, setTemp] = useState<"" | "chilled" | "ambient">("");
  const [district, setDistrict] = useState("");
  const [query, setQuery] = useState("");

  const all = useMemo(() => {
    const list: (OrderRow & Partial<MovedOrder>)[] = [...(data.data?.orders ?? []), ...(data.data?.moved_away ?? [])];
    return list.map((o) => ({ o, place: orderPlace(o) }))
      .sort((a, b) => ORDER[a.place.key] - ORDER[b.place.key] || a.o.outlet_code.localeCompare(b.o.outlet_code));
  }, [data.data]);
  const districts = useMemo(() => [...new Set(all.map((x) => x.o.district))].sort(), [all]);
  const count = (key: Place | "all") => (key === "all" ? all.length : all.filter((x) => x.place.key === key).length);

  const q = query.trim().toLowerCase();
  const rows = all.filter(({ o, place }) =>
    (state === "all" || place.key === state) && (!brand || o.brand_code === brand) && (!temp || o.temp === temp) &&
    (!district || o.district === district) &&
    (!q || [o.confirmation_no, o.outlet_code, o.outlet_name, o.vehicle ?? ""].some((v) => v.toLowerCase().includes(q))));
  const filtered = state !== "all" || brand || temp || district || q;

  if (!date) return <Page><div className="text-wp-text-2">Choose a delivery day.</div></Page>;

  return (
    <Page>
      <div className="flex flex-wrap items-end gap-x-4 gap-y-1">
        <h1 className="text-[22px] leading-7 font-bold">Orders for {formatDay(date)}</h1>
        <span className="text-wp-text-2">
          {count("all") - count("moved")} for this day
          {count("trip") ? ` · ${count("trip")} on trips` : ""}
          {count("cant_go") ? ` · ${count("cant_go")} can't go` : ""}
          {count("delivered") ? ` · ${count("delivered")} delivered` : ""}
          {count("moved") ? ` · ${count("moved")} moved away` : ""}
        </span>
      </div>
      {data.error && <Banner state="crit">{data.error}</Banner>}

      <section className="flex flex-col rounded-lg border border-wp-border bg-wp-surface">
        <div className="flex flex-col gap-2 border-b border-wp-border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative flex min-w-[220px] flex-1 items-center sm:max-w-[340px]">
              <Search className="pointer-events-none absolute left-2.5 size-4 text-wp-muted" aria-hidden />
              <input id="orders-search" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Find an order"
                     placeholder="Find order, outlet or vehicle"
                     className="h-9 w-full rounded-md border border-wp-border bg-wp-surface pr-2 pl-8 text-[13px] outline-none focus:border-wp-focus" />
            </label>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Brand">
              {(["F", "S", "T"] as BrandCode[]).map((b) => (
                <Chip key={b} active={brand === b} onClick={() => setBrand(brand === b ? "" : b)}>{BRAND_NAME[b]}</Chip>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Goods">
              <Chip active={temp === "chilled"} onClick={() => setTemp(temp === "chilled" ? "" : "chilled")}>❄ Chilled</Chip>
              <Chip active={temp === "ambient"} onClick={() => setTemp(temp === "ambient" ? "" : "ambient")}>Dry</Chip>
            </div>
            <Select aria-label="District" value={district} onChange={(e) => setDistrict(e.target.value)} className="h-9 text-[13px]">
              <option value="">All districts</option>
              {districts.map((d) => <option key={d} value={d}>{d}</option>)}
            </Select>
          </div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Where the order is">
            {STATES.filter(([key]) => key === "all" || count(key) > 0).map(([key, label]) => (
              <Chip key={key} active={state === key} onClick={() => setState(key)}>{label} · {count(key)}</Chip>
            ))}
          </div>
        </div>

        <div className={cn("hidden border-b border-wp-border px-4 py-2 text-[10px] font-semibold tracking-[.06em] text-wp-muted uppercase", COLUMNS)}>
          <div>Order</div><div>Outlet</div><div>Goods</div><div>Load</div><div>Lines</div><div>Where it is now</div>
        </div>
        {!data.data && !data.error && <div className="p-6 text-wp-text-2">Loading the orders…</div>}
        {rows.map(({ o, place }) => (
          <button key={`${o.order_id}-${o.to_date ?? ""}`} type="button" onClick={() => openOrder(o.order_id)}
                  className={cn("flex w-full cursor-pointer flex-col gap-1.5 border-b border-wp-border px-4 py-2.5 text-left last:border-b-0 hover:bg-wp-surface-2/50",
                                COLUMNS, (place.key === "cant_go" || place.key === "moved") && "bg-wp-warn-tint/40")}>
            <div className="flex flex-col">
              <span className="font-mono text-[12px] font-semibold text-wp-focus">{o.confirmation_no}</span>
              {o.deferral_count > 0 && !o.to_date && (
                <span className="text-[11px] text-wp-text-2">moved here from {formatDay(o.original_delivery_date)}</span>
              )}
            </div>
            <div className="min-w-0">
              <BrandMonogram brand={BRAND[o.brand_code]} outlet={`${o.district} ${o.outlet_code}`} />
              <div className="truncate text-[11px] text-wp-text-2">{o.van_only ? "Van-only · " : ""}{o.unload.replace("_", " ")}</div>
            </div>
            <div className="flex flex-wrap gap-x-3 text-[13px] tabular-nums lg:contents">
              <div>{o.temp === "chilled" ? "❄ Chilled" : "Dry"}</div>
              <div>{Number(o.weight_kg)} kg · {Number(o.volume_m3)} m³</div>
              <div>{o.line_count}<span className="text-wp-text-2 lg:hidden"> lines</span></div>
            </div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <StatusPill state={place.tone}>{place.label}</StatusPill>
              <span className="text-[12px] text-wp-text-2">{place.detail}</span>
            </div>
          </button>
        ))}
        {data.data && rows.length === 0 && (
          <div className="p-6 text-center text-wp-text-2">
            {all.length === 0 ? "No orders for this day yet." : "No order matches."}{" "}
            {filtered && all.length > 0 && (
              <Button variant="link" onClick={() => { setState("all"); setBrand(""); setTemp(""); setDistrict(""); setQuery(""); }}>Show all</Button>
            )}
          </div>
        )}
      </section>
    </Page>
  );
}

function Page({ children }: { children: ReactNode }) {
  return <div className="mx-auto flex max-w-[1440px] flex-col gap-4 p-4 sm:p-6">{children}</div>;
}
