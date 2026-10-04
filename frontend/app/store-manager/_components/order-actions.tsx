"use client";

import { Button } from "@/components/waypoint/controls";
import { cn } from "@/lib/utils";
import type { StoreOrder } from "./data";
import { storeLayout } from "./layout";

/**
 * Change an order, or say why it can no longer be changed.
 * An order is editable until its cutoff; after that it is on a van plan and only dispatch can move it.
 * The server has the final word (it refuses a change after the cutoff with the reason).
 */
export function ChangeOrderAction({
  order,
  onChangeOrder,
  className,
}: {
  order: StoreOrder;
  onChangeOrder: (order: StoreOrder) => void;
  className?: string;
}) {
  const open = order.status === "placed";
  // A locked order shows why in words, not as a grey button that does nothing.
  if (!open) {
    return <div className={cn("text-xs text-wp-muted", className)}>🔒 Locked at the cutoff · call dispatch to change it</div>;
  }
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1", className)}>
      <Button variant="secondary" className={storeLayout.button} onClick={() => onChangeOrder(order)}>
        Change order
      </Button>
      <span className="text-xs text-wp-muted">Open until the 16:00 cutoff</span>
    </div>
  );
}
