"use client";

import { useState } from "react";
import { Button, Chip, Select } from "@/components/waypoint/controls";
import { BrandMonogram, Eyebrow, KpiTile, RunHistory } from "@/components/waypoint/data";
import { StatusPill } from "@/components/waypoint/status";
import { cn } from "@/lib/utils";
import { DEFERRALS_PER_DAY, LEDGER, type LedgerRow } from "./data";

const PRESETS = {
  streak: { label: "Skipped 2+ runs in a row", match: (r: LedgerRow) => r.streak >= 2 },
  issue: { label: "Delivered with an issue", match: (r: LedgerRow) => r.outcome === "Delivered with an issue" },
  all: { label: "All deferrals", match: (r: LedgerRow) => r.outcome === "Deferred" },
};
type Preset = keyof typeof PRESETS;

const ROW_COLUMNS = "grid grid-cols-[minmax(0,1.3fr)_90px_90px_150px_minmax(0,1.6fr)_90px_110px] gap-3";

/** D4 · Record ledger: deferrals and delivery issues over time, with each order's event trail. */
export function Ledger() {
  const [preset, setPreset] = useState<Preset>("streak");
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const rows = LEDGER.filter(PRESETS[preset].match);

  return (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-4 p-6">
      <div className="flex flex-wrap items-center gap-4">
        <div>
          <h1 className="text-[22px] leading-6 font-bold">Record ledger</h1>
          <div className="mt-1 text-[11px] text-wp-text-2">Data through Tue 29 Sep 05:58 · Closed days excluded</div>
        </div>
        <div className="ml-auto">
          <Button variant="secondary">Export CSV</Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(Object.keys(PRESETS) as Preset[]).map((key) => (
          <Chip key={key} active={preset === key} onClick={() => setPreset(key)}>
            {PRESETS[key].label}
          </Chip>
        ))}
        <span className="mx-2 h-5 w-px bg-wp-border" />
        <Select aria-label="Period">
          <option>Last 7 days</option>
          <option>Last 30 days</option>
        </Select>
        <Select aria-label="Brand">
          <option>All brands</option>
          <option>Fresh</option>
          <option>Style</option>
          <option>Tech</option>
        </Select>
        <Select aria-label="Outlet">
          <option>All outlets</option>
        </Select>
        <Select aria-label="Outcome">
          <option>Any outcome</option>
          <option>Deferred</option>
          <option>Delivered with an issue</option>
        </Select>
        <Button variant="link" onClick={() => setPreset("all")}>
          Reset
        </Button>
      </div>

      <div className="grid grid-cols-[repeat(3,minmax(0,1fr))_minmax(0,1.3fr)] gap-4">
        <KpiTile label="Deferred orders" value="14" context="▲ 5 more than the previous 7 days (9)" />
        <KpiTile label="Outlets skipped twice running" value="2" context="Tech Dehiwala, Fresh Kirulapone" />
        <KpiTile label="Delivered with an issue" value="6" context="Of 812 deliveries in 7 days" />
        <div className="rounded-lg border border-wp-border bg-wp-surface p-4">
          <Eyebrow className="leading-[14px]">Deferrals per day</Eyebrow>
          <div className="mt-2 flex h-[88px] items-end gap-3">
            {DEFERRALS_PER_DAY.map(([day, count]) => (
              <div key={day} className="flex h-full flex-1 flex-col items-center justify-end gap-0.5">
                <div className="text-[11px] font-semibold">{count ?? "closed"}</div>
                {count === null ? (
                  <div className="h-0 w-full border-b border-dashed border-wp-muted" />
                ) : (
                  <div className="w-full rounded-[3px] bg-wp-text-2" style={{ height: count * 14 }} />
                )}
                <div className="text-[10px] text-wp-muted">{day}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-wp-border bg-wp-surface px-4 pt-2 pb-4">
        <div className={cn(ROW_COLUMNS, "py-2 text-[10px] font-semibold tracking-[.06em] text-wp-muted uppercase")}>
          <div>Outlet</div>
          <div>Order</div>
          <div>Run</div>
          <div>Outcome</div>
          <div>Reason or proof</div>
          <div>Decided by</div>
          <div>When</div>
        </div>

        {rows.map((r) => {
          const isOpen = !!open[r.order];
          return (
            <div key={r.order} className="border-t border-wp-border">
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => setOpen({ ...open, [r.order]: !isOpen })}
                className={cn(ROW_COLUMNS, "min-h-9 w-full cursor-pointer items-center py-2 text-left")}
              >
                <div>
                  <BrandMonogram brand={r.brand} outlet={r.outlet} />
                </div>
                <div>{r.order}</div>
                <div>{r.run}</div>
                <div>
                  <StatusPill state={r.state}>{r.outcome}</StatusPill>
                </div>
                <div>{r.reason}</div>
                <div>{r.by}</div>
                <div className="text-wp-text-2">{r.when}</div>
              </button>

              {isOpen && (
                <div className="mb-2 grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-6 rounded-lg bg-wp-canvas p-4">
                  <div>
                    <Eyebrow className="mb-2">Event timeline</Eyebrow>
                    {r.timeline.map(([time, text], i) => (
                      <div key={i} className="flex gap-3 py-1">
                        <span className="w-11 flex-none text-wp-text-2">{time}</span>
                        <span>{text}</span>
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-col gap-3">
                    <div>
                      <Eyebrow>Last five runs</Eyebrow>
                      <RunHistory history={r.history} />
                    </div>
                    <div>
                      <Eyebrow className="mb-1">Proof</Eyebrow>
                      {r.proof === "yes" && (
                        <div className="flex gap-2">
                          <ProofPlaceholder label="Signature" />
                          <ProofPlaceholder label="Photo" />
                          <div className="self-center text-[11px] text-wp-text-2">Device time {r.deviceTime}</div>
                        </div>
                      )}
                      {r.proof === "none" && (
                        <div className="font-semibold text-wp-offline">⊘ Proof waiting on driver&apos;s phone</div>
                      )}
                      {r.proof === "na" && <div className="text-wp-text-2">No delivery, so no proof.</div>}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {rows.length === 0 && (
          <div className="p-8 text-center text-wp-text-2">
            No deferrals match. Try “All deferrals”.{" "}
            <Button variant="link" onClick={() => setPreset("all")}>
              Reset filters
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function ProofPlaceholder({ label }: { label: string }) {
  return (
    <div className="flex h-14 w-[88px] items-center justify-center rounded-md border border-dashed border-wp-border text-[11px] text-wp-muted">
      {label}
    </div>
  );
}
