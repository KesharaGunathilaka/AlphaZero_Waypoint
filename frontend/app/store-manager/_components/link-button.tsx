"use client";

import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/** Inline text action styled as a link. */
export function LinkButton({
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={cn(
        "cursor-pointer text-left text-xs font-semibold text-wp-action underline hover:text-wp-focus",
        className,
      )}
      {...props}
    />
  );
}
