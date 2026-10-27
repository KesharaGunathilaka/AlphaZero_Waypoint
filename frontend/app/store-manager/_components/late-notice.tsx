"use client";

import { useState } from "react";
import { Button, Select } from "@/components/waypoint/controls";
import { errorMessage, useApi } from "@/lib/api/use-api";
import { formatTime } from "@/lib/format";
import type { DeliveryForecast, ReceivingReply } from "./data";

/** Later times to offer: 15, 30 and 60 minutes past the expected arrival, on the quarter hour. */
function untilOptions(expected: string): string[] {
  const base = Date.parse(expected);
  return [15, 30, 60].map((m) => {
    const t = new Date(base + m * 60_000);
    t.setMinutes(Math.ceil(t.getMinutes() / 15) * 15, 0, 0);
    return t.toISOString();
  });
}

/**
 * Dispatch's model expects this delivery after the store's window closes (today's delays, not the usual pattern).
 * The store answers: it will receive until a later time, or it can't receive late. The answer goes to the
 * dispatcher with this one delivery; the store's own window does not change.
 */
export function LateNotice({ orderId, forecast }: { orderId: number; forecast: DeliveryForecast }) {
  const request = useApi();
  const options = untilOptions(forecast.expected_arrival);
  const [until, setUntil] = useState(options[1]);
  const [sent, setSent] = useState<ReceivingReply | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reply = sent ?? forecast.reply;

  async function answer(kind: ReceivingReply["answer"]) {
    setBusy(true);
    setError(null);
    try {
      const receive_until = kind === "will_receive" ? until : null;
      await request("/store/orders/" + orderId + "/receiving", { method: "POST", body: { answer: kind, receive_until } });
      setSent({ answer: kind, receive_until, replied_at: new Date().toISOString() });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div role="alert" className="flex flex-col gap-2 rounded-md border border-wp-warn bg-wp-warn-tint px-3 py-2">
      <div className="text-[14px] leading-5 font-semibold">
        Likely to arrive after your window closes
        {forecast.window_closes ? ` (${formatTime(forecast.window_closes)})` : ""}. Expected about {formatTime(forecast.expected_arrival)}.
      </div>
      {reply ? (
        <div className="text-[13px] font-semibold text-wp-info">
          {reply.answer === "will_receive"
            ? `You’ll receive until ${formatTime(reply.receive_until!)}. Dispatch can see your answer.`
            : "You can’t receive late. Dispatch can see your answer and will contact you."}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Button className="h-9" disabled={busy} onClick={() => void answer("will_receive")}>
              We’ll receive until {formatTime(until)}
            </Button>
            <Select aria-label="Receive until" className="h-9 w-[92px]" value={until} disabled={busy}
                    onChange={(e) => setUntil(e.target.value)}>
              {options.map((o) => <option key={o} value={o}>{formatTime(o)}</option>)}
            </Select>
            <Button variant="secondary" className="h-9" disabled={busy} onClick={() => void answer("cannot_receive")}>
              We can’t receive late
            </Button>
          </div>
          <div className="text-[11px] text-wp-text-2">Your answer goes to dispatch for this delivery only. Your usual window doesn’t change.</div>
        </>
      )}
      {error && <div className="text-[12px] text-wp-crit">{error}</div>}
    </div>
  );
}
