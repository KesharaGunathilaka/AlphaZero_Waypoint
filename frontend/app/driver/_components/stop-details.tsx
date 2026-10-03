"use client";

import { formatTime } from "@/lib/format";
import { UNLOAD_LABEL, navigationUrl } from "./data";
import type { DriverScreen } from "./driver-nav";
import { shortLoads } from "./my-run";
import { BigButton, BigLink, Body, BottomBar, Card, OfflineBanner, PhoneScreen, SectionLabel, SyncPill, TopBar } from "./phone-ui";
import { useRun } from "./use-run";

/** R2 · Stop details: where to unload, who to ask for, and what is on board for this stop. */
export function StopDetails({ onNavigate }: { onNavigate: (screen: DriverScreen) => void }) {
  const { currentTrip, currentStop: stop, arrive } = useRun();

  if (!stop || !currentTrip) {
    return (
      <PhoneScreen label="R2 Stop details">
        <TopBar>
          <button type="button" onClick={() => onNavigate("run")} className="cursor-pointer font-semibold">‹ My run</button>
          <SyncPill />
        </TopBar>
        <Body><Card>No stop to open: every stop on this trip is done.</Card></Body>
      </PhoneScreen>
    );
  }

  const short = shortLoads(stop);

  return (
    <PhoneScreen label="R2 Stop details">
      <TopBar>
        <button type="button" onClick={() => onNavigate("run")} className="cursor-pointer font-semibold">
          ‹ My run
        </button>
        <SyncPill />
      </TopBar>
      <Body>
        <OfflineBanner />
        <div className="flex flex-col gap-1">
          <SectionLabel>
            STOP {stop.seq} OF {currentTrip.stops.length} · {stop.outlet.code}
          </SectionLabel>
          <div className="text-3xl leading-[34px] font-bold">{stop.outlet.name}</div>
          <div className="flex gap-4">
            <span className="font-bold">Deliver by {stop.closes?.slice(0, 5) ?? "—"}</span>
            <span className="text-wp-text-2">Planned {formatTime(stop.planned_arrival)}</span>
          </div>
          {stop.opens && (
            <div className="text-[13px] text-wp-text-2">
              Window opens {stop.opens.slice(0, 5)}. Arriving early means waiting until then.
            </div>
          )}
        </div>

        <Card>
          <div>
            <div className="text-xs text-wp-muted">Unload at</div>
            <div className="text-[22px] leading-[26px] font-bold">{UNLOAD_LABEL[stop.outlet.unload]}</div>
          </div>
          {stop.outlet.access_note && (
            <div>
              <div className="text-xs text-wp-muted">Access</div>
              <div className="leading-[22px]">{stop.outlet.access_note}</div>
            </div>
          )}
          {stop.outlet.contact_name && (
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-xs text-wp-muted">Store contact</div>
                <div className="font-semibold">{stop.outlet.contact_name}</div>
              </div>
              {stop.outlet.contact_phone && (
                <a href={`tel:${stop.outlet.contact_phone}`}
                   className="flex h-11 flex-shrink-0 items-center rounded-[10px] border border-wp-action px-4 font-semibold text-wp-action">
                  ☎ Call
                </a>
              )}
            </div>
          )}
        </Card>

        <Card className="gap-2">
          <SectionLabel>DELIVERING HERE</SectionLabel>
          {stop.orders.map((order) => (
            <div key={order.order_id} className="flex flex-col gap-1">
              <div className="text-[13px] font-semibold text-wp-text-2">
                {order.temp === "chilled" ? "❄ Chilled" : "Ambient"} · order {order.ref}
              </div>
              {(order.lines ?? []).map((l) => {
                const loaded = stop.loaded[`${order.order_id}-${l.line_no}`];
                return (
                  <div key={l.line_no} className="flex min-h-8 items-center justify-between">
                    <span>{l.name}</span>
                    <span className={loaded < Number(l.qty) ? "font-bold text-wp-warn" : "font-bold"}>
                      {loaded < Number(l.qty) ? `▲ ${loaded} of ${Number(l.qty)}` : Number(l.qty)} {l.unit}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
          {short.length > 0 && (
            <div className="rounded-lg bg-wp-warn-tint px-3 py-2 text-[13px] leading-[18px] font-semibold text-wp-warn">
              ▲ Loaded short at the depot. The store has been told.
            </div>
          )}
        </Card>
      </Body>
      <BottomBar className="flex flex-col items-center gap-2">
        <div className="grid w-full grid-cols-2 gap-2">
          <BigLink variant="outline" href={navigationUrl(stop)} target="_blank" rel="noreferrer">
            Navigate
          </BigLink>
          <BigButton
            onClick={() => {
              arrive(stop);
              onNavigate("deliver");
            }}
          >
            {stop.arrivedAt ? "Record delivery" : "I’ve arrived"}
          </BigButton>
        </div>
        <button type="button" onClick={() => onNavigate("problem")}
                className="flex min-h-11 cursor-pointer items-center font-semibold text-wp-action underline">
          Can’t deliver? Report a problem
        </button>
      </BottomBar>
    </PhoneScreen>
  );
}
