"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Inline text action styled as a link. */
export function LinkButton({
  onClick,
  children,
  className,
}: {
  onClick: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "cursor-pointer text-left text-xs font-semibold text-wp-action underline hover:text-wp-focus",
        className,
      )}
    >
      {children}
    </button>
  );
}
