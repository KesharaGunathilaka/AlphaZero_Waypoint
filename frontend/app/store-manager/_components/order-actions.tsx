"use client";

import { Button } from "@/components/waypoint/controls";
import { cn } from "@/lib/utils";
import { ORDER_DETAILS, type OrderId } from "./data";
import { storeLayout } from "./layout";

/**
 * Change an order, or say why it can no longer be changed.
 * An order is editable until its cutoff; after that it is on a van plan and only dispatch can move it.
 */
export function ChangeOrderAction({
  orderId,
  onChangeOrder,
  className,
}: {
  orderId: OrderId;
  onChangeOrder: (id: OrderId) => void;
  className?: string;
}) {
  const { change } = ORDER_DETAILS[orderId];
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1", className)}>
      <Button
        variant="secondary"
        className={storeLayout.button}
        disabled={!change.open}
        onClick={() => onChangeOrder(orderId)}
      >
        Change order
      </Button>
      <span className="text-xs text-wp-muted">
        {change.open ? `Open until ${change.cutoff}` : `Closed ${change.cutoff}`}
      </span>
    </div>
  );
}
