"use client";

import { useState, type ReactNode } from "react";
import { Button, Chip, Select } from "@/components/waypoint/controls";
import { BrandMonogram, Eyebrow, KpiTile, RunHistory } from "@/components/waypoint/data";
import { ProofImage } from "@/components/waypoint/proof-image";
import { Banner, StatusPill, type Tone } from "@/components/waypoint/status";
import { useApiData } from "@/lib/api/use-api";
import { formatDay, formatDayTime, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { BRAND, historyGlyphs, type BrandCode, type Ledger as LedgerData, type LedgerRecord, type OrderRecord } from "./data";
import { OrderLink, orderEvents } from "./order-panel";

const withIssue = (r: LedgerRecord) =>
  r.record_type === "delivery" && (r.outcome !== "delivered" || r.disputed || r.awaiting_store || r.proof_complete === false);

const PRESETS = {
  streak: { label: "Skipped 2+ runs in a row", match: (r: LedgerRecord) => r.record_type === "deferral" && r.consecutive_skip },
  issue: { label: "Delivered with an issue", match: withIssue },
  deferrals: { label: "All deferrals", match: (r: LedgerRecord) => r.record_type === "deferral" },
  all: { label: "Everything", match: () => true },
};
type Preset = keyof typeof PRESETS;

function outcomeStyle(r: LedgerRecord): { state: Tone; label: string } {
  if (r.record_type === "deferral") return { state: r.consecutive_skip ? "warn" : "info", label: r.outcome === "deferred" ? "Deferred" : "Not delivered, moved" };
  if (r.outcome === "not_delivered") return { state: "crit", label: "Not delivered" };
  if (withIssue(r)) return { state: "warn", label: r.awaiting_store ? "Awaiting store" : "Delivered with an issue" };
  return { state: "good", label: "Delivered" };
}

const ROW_COLUMNS = "grid grid-cols-[minmax(0,1.3fr)_130px_90px_170px_minmax(0,1.4fr)_120px_110px] gap-3";

/** Records: deferrals and deliveries over time, with each order's event trail. */
export function Ledger() {
  const ledger = useApiData<LedgerData>("/dispatch/ledger", 60_000);
  const [preset, setPreset] = useState<Preset>("deferrals");
  const [brand, setBrand] = useState<"" | BrandCode>("");
  const [depot, setDepot] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});

  if (!ledger.data) {
    return <Page>{ledger.error ? <Banner state="crit">{ledger.error}</Banner> : <div className="text-wp-text-2">Loading the ledger…</div>}</Page>;
  }

  const { headline, records, per_day } = ledger.data;
  const depots = [...new Set(records.map((r) => r.depot))].sort();
  const rows = records.filter(PRESETS[preset].match).filter((r) => !brand || r.brand_code === brand).filter((r) => !depot || r.depot === depot);
  const week = per_day.slice(-7);
  const maxPerDay = Math.max(1, ...week.map((d) => d.deferred ?? 0));
  const skippedTwice = records.filter((r) => r.record_type === "deferral" && r.consecutive_skip);

  function exportCsv() {
    const header = ["depot", "outlet", "order", "run", "record", "outcome", "reason", "note", "by", "when"];
    const body = rows.map((r) => [r.depot, r.outlet_name, r.confirmation_no, r.service_date, r.record_type, r.outcome, r.reason ?? "",
                                  r.note ?? "", r.decided_by, r.at]);
    const csv = [header, ...body].map((line) => line.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: "waypoint-ledger.csv" });
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Page>
      <div className="flex flex-wrap items-center gap-4">
        <div>
          <h1 className="text-[22px] leading-6 font-bold">Record ledger</h1>
          <div className="mt-1 text-[11px] text-wp-text-2">
            Data through {headline?.data_through ? formatDayTime(headline.data_through) : "now"} · Closed days excluded
          </div>
        </div>
        <div className="ml-auto"><Button variant="secondary" onClick={exportCsv} disabled={rows.length === 0}>Export CSV</Button></div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(Object.keys(PRESETS) as Preset[]).map((key) => (
          <Chip key={key} active={preset === key} onClick={() => setPreset(key)}>{PRESETS[key].label}</Chip>
        ))}
        <span className="mx-2 h-5 w-px bg-wp-border" />
        <Select aria-label="Brand" value={brand} onChange={(e) => setBrand(e.target.value as "" | BrandCode)}>
          <option value="">All brands</option>
          <option value="F">Fresh</option>
          <option value="S">Style</option>
          <option value="T">Tech</option>
        </Select>
        {depots.length > 1 && (
          <Select aria-label="Depot" value={depot} onChange={(e) => setDepot(e.target.value)}>
            <option value="">All depots</option>
            {depots.map((d) => <option key={d} value={d}>{d}</option>)}
          </Select>
        )}
        <Button variant="link" onClick={() => { setPreset("all"); setBrand(""); setDepot(""); }}>Reset</Button>
      </div>

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-[repeat(3,minmax(0,1fr))_minmax(0,1.3fr)]">
        <KpiTile label="Deferred orders, 7 days" value={headline?.deferred_last_7d ?? 0}
                 context={`${headline?.deferred_prev_7d ?? 0} in the 7 days before`} />
        <KpiTile label="Outlets skipped twice running" value={headline?.outlets_skipped_twice_running ?? 0}
                 context={skippedTwice.length ? Array.from(new Set(skippedTwice.map((r) => r.outlet_name))).join(", ") : "None"} />
        <KpiTile label="Delivered with an issue, 7 days" value={headline?.delivered_with_issue_last_7d ?? 0} context="Reported by store managers" />
        <div className="rounded-lg border border-wp-border bg-wp-surface p-4">
          <Eyebrow className="leading-[14px]">Deferrals per day</Eyebrow>
          <div className="mt-2 flex h-[88px] items-end gap-3">
            {week.map((d) => (
              <div key={d.day} className="flex h-full flex-1 flex-col items-center justify-end gap-0.5">
                <div className="text-[11px] font-semibold">{d.is_working ? (d.deferred ?? 0) : "closed"}</div>
                {d.is_working ? (
                  <div className="w-full rounded-[3px] bg-wp-text-2" style={{ height: Math.max(2, ((d.deferred ?? 0) / maxPerDay) * 56) }} />
                ) : (
                  <div className="h-0 w-full border-b border-dashed border-wp-muted" />
                )}
                <div className="text-[10px] text-wp-muted">{formatDay(d.day).split(" ")[0]}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-wp-border bg-wp-surface px-4 pt-2 pb-4">
        <div className="min-w-[980px]">
          <div className={cn(ROW_COLUMNS, "py-2 text-[10px] font-semibold tracking-[.06em] text-wp-muted uppercase")}>
            <div>Outlet</div><div>Order</div><div>Run</div><div>Outcome</div><div>Reason or note</div><div>Decided by</div><div>When</div>
          </div>
          {rows.map((r) => {
            const key = `${r.record_type}-${r.record_id}`;
            const isOpen = !!open[key];
            const style = outcomeStyle(r);
            return (
              <div key={key} className="border-t border-wp-border">
                <button type="button" aria-expanded={isOpen} onClick={() => setOpen({ ...open, [key]: !isOpen })}
                        className={cn(ROW_COLUMNS, "min-h-9 w-full cursor-pointer items-center py-2 text-left")}>
                  <div><BrandMonogram brand={BRAND[r.brand_code]} outlet={r.outlet_name} />
                    {depots.length > 1 && <div className="ml-8 text-[11px] text-wp-muted">{r.depot} depot</div>}</div>
                  <div>{r.confirmation_no}</div>
                  <div>{formatDay(r.service_date)}</div>
                  <div><StatusPill state={style.state}>{style.label}</StatusPill></div>
                  <div>{r.reason ?? (r.record_type === "delivery" ? "—" : "")}{r.note ? ` · ${r.note}` : ""}</div>
                  <div>{r.decided_by}</div>
                  <div className="text-wp-text-2">{formatDayTime(r.at)}</div>
                </button>
                {isOpen && <OrderTrail orderId={r.order_id} />}
              </div>
            );
          })}
          {rows.length === 0 && (
            <div className="p-8 text-center text-wp-text-2">
              Nothing matches.{" "}
              <Button variant="link" onClick={() => { setPreset("all"); setBrand(""); }}>Show everything</Button>
            </div>
          )}
        </div>
      </div>
    </Page>
  );
}

/** One order's trail: every status change, deferral and notice, the outlet's last runs and the proof. */
function OrderTrail({ orderId }: { orderId: number }) {
  const record = useApiData<OrderRecord>(`/dispatch/orders/${orderId}`);
  if (!record.data) return <div className="mb-2 rounded-lg bg-wp-canvas p-4 text-wp-text-2">{record.error ?? "Loading the record…"}</div>;
  const o = record.data;
  const events = orderEvents(o);

  return (
    <div className="mb-2 grid grid-cols-1 gap-6 rounded-lg bg-wp-canvas p-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <div>
        <div className="mb-2 flex items-center gap-3">
          <Eyebrow>Event timeline</Eyebrow>
          <OrderLink orderId={orderId} className="text-[12px]">Open the full order (items, outlet, trip)</OrderLink>
        </div>
        {events.map(([time, text], i) => (
          <div key={i} className="flex gap-3 py-1">
            <span className="w-24 flex-none text-wp-text-2">{formatDayTime(time)}</span>
            <span>{text}</span>
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-3">
        <div>
          <Eyebrow>Last five runs</Eyebrow>
          {o.history.length ? <RunHistory history={historyGlyphs(o.history)} /> : <div className="text-wp-text-2">No earlier runs recorded</div>}
        </div>
        <div>
          <Eyebrow className="mb-1">Proof</Eyebrow>
          {o.proof.length ? (
            <Row>
              {o.proof.map((p) => <ProofImage key={p.attachment_id} id={p.attachment_id} kind={p.kind} />)}
              <div className="self-center text-[11px] text-wp-text-2">Device time {formatTime(o.proof[0].device_time)}</div>
            </Row>
          ) : (
            <div className="text-wp-text-2">No proof on record.</div>
          )}
        </div>
      </div>
    </div>
  );
}

const Row = ({ children }: { children: ReactNode }) => <div className="flex flex-wrap gap-2">{children}</div>;

function Page({ children }: { children: ReactNode }) {
  return <div className="mx-auto flex max-w-[1440px] flex-col gap-4 p-4 sm:p-6">{children}</div>;
}
