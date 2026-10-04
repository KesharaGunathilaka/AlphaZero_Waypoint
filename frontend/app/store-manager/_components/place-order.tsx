"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Stepper } from "@/components/waypoint/controls";
import { Banner, StatusPill } from "@/components/waypoint/status";
import { errorMessage, useApi, useApiData } from "@/lib/api/use-api";
import { formatDay, formatDayTime, plural, timeLeft } from "@/lib/format";
import { cn } from "@/lib/utils";
import { categoryName, type OrderSlot, type Outlet, type Product, type StoreOrder, type Temp } from "./data";
import { storeLayout } from "./layout";
import { LinkButton } from "./link-button";
import type { OrderIntent } from "./store-manager-app";

const COLLAPSED_LINES = 5;

type Placed = { confirmation_no: string; delivery_date: string; joined_later_run?: boolean };

/** True while the browser has a connection. */
function useOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

/**
 * S2 · Place order, and the same screen in change mode.
 *
 * A new order starts from the outlet's usual order. Changing an existing order starts from what is on
 * it today. The parent remounts this screen when the temperature class or the order changes.
 */
export function PlaceOrder({
  outlet,
  intent,
  onChangeIntent,
  onBack,
}: {
  outlet: Outlet;
  intent: OrderIntent;
  onChangeIntent: (intent: OrderIntent) => void;
  onBack: () => void;
}) {
  const { temp, editing } = intent;
  const request = useApi();
  const online = useOnline();
  const products = useApiData<Product[]>(`/store/products?temp=${temp}`);
  const usual = useApiData<{ product_id: number; qty: number }[]>(editing ? null : `/store/usual?temp=${temp}`);
  const slot = useApiData<OrderSlot>(`/store/order-slot?temp=${temp}`);
  const existing = useApiData<StoreOrder[]>(!editing && slot.data?.existing_order_id ? "/store/orders" : null);

  const draftKey = `wp-order-draft-${outlet.code}-${temp}`;
  const catalogue = useMemo(() => products.data ?? [], [products.data]);
  const baseline = useMemo(() => {
    const source = editing ? (editing.lines ?? []) : (usual.data ?? []);
    return catalogue.map((p) => Number(source.find((l) => l.product_id === p.product_id)?.qty ?? 0));
  }, [catalogue, editing, usual.data]);

  // A draft saved on this device wins over the usual order (new orders only).
  const draft = useMemo(() => {
    if (editing || catalogue.length === 0) return null;
    try {
      const saved = JSON.parse(localStorage.getItem(draftKey) ?? "null") as Record<string, number> | null;
      return saved ? catalogue.map((p) => saved[p.product_id] ?? 0) : null;
    } catch {
      return null; // no storage in this browser (or on the server render)
    }
  }, [catalogue, draftKey, editing]);

  /** Quantities the manager has changed; until then the form shows the draft or the baseline. */
  const [qty, setQty] = useState<number[] | null>(null);
  const [requestId] = useState(() => crypto.randomUUID());
  const [search, setSearch] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<Placed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draftNote, setDraftNote] = useState("");

  const values = qty ?? draft ?? baseline;
  const lineCount = values.filter((q) => q > 0).length;
  const totalQty = values.reduce((sum, q) => sum + q, 0);
  const changed = values.some((q, i) => q !== baseline[i]);
  const category = categoryName(outlet.brand_code, temp);
  const deliveryDay = editing ? editing.delivery_date : slot.data?.delivery_date;
  const cutoff = slot.data?.cutoff_at;
  const alreadyOrdered = !editing && existing.data?.find((o) => o.order_id === slot.data?.existing_order_id);

  // Lines keep their index into `values`, so filtering never moves a quantity to another item.
  const term = search.trim().toLowerCase();
  const matches = catalogue.map((line, index) => ({ line, index })).filter(({ line }) => line.name.toLowerCase().includes(term));
  const searching = term.length > 0;
  const visible = searching || showAll ? matches : matches.slice(0, COLLAPSED_LINES);
  const hidden = catalogue.length - COLLAPSED_LINES;

  async function submit() {
    setError(null);
    setSaving(true);
    const lines = catalogue
      .map((p, i) => ({ product_id: p.product_id, qty: values[i] }))
      .filter((l) => l.qty > 0);
    try {
      if (editing) {
        const result = await request<Placed>(`/store/orders/${editing.order_id}`, { method: "PUT", body: { lines } });
        setSaved(result);
      } else {
        const result = await request<Placed>("/store/orders", {
          method: "POST",
          body: { client_request_id: requestId, temp, lines },
        });
        try {
          localStorage.removeItem(draftKey);
        } catch {}
        setSaved(result);
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  function saveDraft() {
    try {
      localStorage.setItem(draftKey, JSON.stringify(Object.fromEntries(catalogue.map((p, i) => [p.product_id, values[i]]))));
      setDraftNote("Draft saved on this device. The order is not placed until a confirmation number appears.");
    } catch {
      setDraftNote("This browser cannot save drafts.");
    }
  }

  if (saved) {
    return (
      <div className={cn(storeLayout.card, "flex flex-col gap-4 p-4 md:p-6")}>
        <div>
          <StatusPill state="good">{editing ? "Order updated" : "Order placed"}</StatusPill>
        </div>
        <div>
          <div className="text-[11px] font-semibold tracking-[.06em] text-wp-muted">CONFIRMATION NUMBER</div>
          <div className="text-3xl leading-8 font-bold tabular-nums">{saved.confirmation_no}</div>
        </div>
        <div className="text-[13px] leading-[18px]">
          {category} for {formatDay(saved.delivery_date)}. {plural(lineCount, "line")}, {totalQty} units.{" "}
          {editing
            ? "Dispatch has the change and the warehouse picks from the new list."
            : "Your arrival window appears after the 16:00 cutoff, when dispatch releases the plan."}
          {saved.joined_later_run ? " The run you asked for had closed, so it joins the next one." : ""}
        </div>
        <div className="flex flex-wrap gap-3">
          <Button className={storeLayout.button} onClick={onBack}>
            Back to Deliveries
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          {editing && (
            <LinkButton onClick={onBack} className="no-underline">
              ← Deliveries
            </LinkButton>
          )}
          <h1 className={storeLayout.h1}>{editing ? `Change order ${editing.confirmation_no}` : "Place order"}</h1>
          <div className="text-[13px] text-wp-text-2">
            {category} · Delivery {deliveryDay ? formatDay(deliveryDay) : "…"} · {outlet.name}
          </div>
        </div>
        {cutoff && (
          <StatusPill state="info">
            Closes {formatDayTime(cutoff)} · {timeLeft(cutoff)}
          </StatusPill>
        )}
      </div>

      {outlet.brand_code === "F" && !editing && (
        <div className="flex gap-2" role="tablist" aria-label="Order type">
          {(["ambient", "chilled"] as Temp[]).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={t === temp}
              onClick={() => onChangeIntent({ temp: t, editing: null })}
              className={cn(
                "cursor-pointer rounded-md border px-4 text-xs font-semibold",
                storeLayout.inputHeight,
                t === temp ? "border-wp-action bg-wp-action text-wp-on-action" : "border-wp-border bg-wp-surface text-wp-text",
              )}
            >
              {categoryName("F", t)}
            </button>
          ))}
        </div>
      )}

      {!online && (
        <Banner state="offline">
          You’re offline. {editing ? "The change is not saved" : "The order is not placed"} until a confirmation
          appears. Save it as a draft and send it when you’re back online.
        </Banner>
      )}
      {alreadyOrdered && (
        <Banner state="info" action="Change it" onAction={() => onChangeIntent({ temp, editing: alreadyOrdered })}>
          You already have a {category.toLowerCase()} order ({alreadyOrdered.confirmation_no}) for{" "}
          {formatDay(alreadyOrdered.delivery_date)}. Change that order instead of placing a second one.
        </Banner>
      )}
      {error && <Banner state="crit">{error}</Banner>}
      {(products.error || usual.error) && <Banner state="crit">{products.error ?? usual.error}</Banner>}

      <div className={cn("grid items-start gap-6", storeLayout.colsMain)}>
        <div className="flex min-w-0 flex-col gap-4">
          <section className={cn(storeLayout.card, "flex flex-col gap-3 p-4")}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-[15px] font-semibold">{category}</h2>
              <button
                type="button"
                onClick={() => setQty(baseline)}
                className="h-8 cursor-pointer rounded-2xl border border-wp-border bg-wp-surface-2 px-3 text-xs font-semibold text-wp-text"
              >
                {editing ? "Reset to current order" : "Repeat usual order"}
              </button>
            </div>
            <div className="text-xs text-wp-muted">
              {editing
                ? "Pre-filled from what is on this order now. Change only what differs."
                : "Pre-filled from your usual order. Change only what differs."}
            </div>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search your items"
              aria-label="Search your items"
              className={cn("rounded-md border border-wp-border bg-wp-surface px-3 text-[13px] text-wp-text", storeLayout.inputHeight)}
            />
            <div>
              {products.loading && catalogue.length === 0 && (
                <div className="border-t border-wp-border py-3 text-[13px] text-wp-text-2">Loading items…</div>
              )}
              {visible.map(({ line, index }) => (
                <div
                  key={line.product_id}
                  className={cn("flex flex-wrap items-center justify-between gap-3 border-t border-wp-border py-2", storeLayout.rowHeight)}
                >
                  <div className="min-w-40 flex-1">
                    <div className="text-[13px] font-semibold">{line.name}</div>
                    <div className="text-[11px] text-wp-muted">
                      {editing ? "Now" : "Usual"} {baseline[index] ?? 0} · per {line.unit}
                      {values[index] !== baseline[index] && (
                        <span className="ml-2 font-semibold text-wp-action">Changed to {values[index]}</span>
                      )}
                    </div>
                  </div>
                  <Stepper
                    label={line.name}
                    value={values[index] ?? 0}
                    onChange={(v) => setQty(values.map((x, j) => (j === index ? Math.max(0, v) : x)))}
                  />
                </div>
              ))}
              {!products.loading && visible.length === 0 && (
                <div className="border-t border-wp-border py-3 text-[13px] text-wp-text-2">No item matches “{search.trim()}”.</div>
              )}
            </div>
            {!searching && hidden > 0 && (
              <LinkButton onClick={() => setShowAll(!showAll)}>
                {showAll ? "Show fewer lines" : `Show ${hidden} more lines`}
              </LinkButton>
            )}
          </section>
        </div>

        <aside className={cn(storeLayout.card, "flex flex-col gap-3 p-4")}>
          <h2 className="text-[15px] font-semibold">Summary</h2>
          <div className="flex justify-between gap-2 text-[13px]">
            <span>{category}</span>
            <span className="tabular-nums">
              {plural(lineCount, "line")} · {totalQty} units
            </span>
          </div>
          {editing && (
            <div className="flex justify-between gap-2 text-[13px]">
              <span>Changed lines</span>
              <span className="tabular-nums">{values.filter((q, i) => q !== baseline[i]).length}</span>
            </div>
          )}
          <div className="border-t border-wp-border pt-3 text-[13px] leading-[18px] text-wp-text-2">
            {editing
              ? "We send the change to the warehouse when you save it. You can keep changing this order until the 16:00 cutoff."
              : `We send this order to the warehouse when you place it. Your arrival window appears after the cutoff${
                  cutoff ? ` (${formatDayTime(cutoff)})` : ""
                }. An order placed after the cutoff joins the next run.`}
          </div>
          <Button
            className="min-h-14 w-full text-base"
            disabled={saving || !online || lineCount === 0 || (Boolean(editing) && !changed) || Boolean(alreadyOrdered)}
            onClick={submit}
          >
            {saving ? "Sending…" : editing ? "Save changes" : "Place order"}
          </Button>
          <Button variant="secondary" className={cn("w-full", storeLayout.button)} onClick={editing ? onBack : saveDraft}>
            {editing ? "Discard changes" : "Save draft"}
          </Button>
          <div className="min-h-4 text-xs text-wp-muted">
            {draftNote ||
              (draft && qty === null ? "Restored your saved draft. It is not an order until a confirmation number appears." : "") ||
              (editing && !changed ? "Nothing changed yet." : "")}
          </div>
        </aside>
      </div>
    </>
  );
}
