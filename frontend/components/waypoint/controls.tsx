"use client";

import type { ButtonHTMLAttributes, SelectHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const BUTTON_VARIANTS = {
  primary: "border-wp-action bg-wp-action text-wp-on-action",
  secondary: "border-wp-border bg-transparent text-wp-text",
  link: "border-transparent bg-transparent text-wp-focus underline",
} as const;

export function Button({
  variant = "primary",
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof BUTTON_VARIANTS }) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex min-h-8 cursor-pointer items-center justify-center rounded-md border px-4 text-xs leading-4 font-semibold transition-opacity duration-150 disabled:cursor-not-allowed disabled:opacity-60",
        BUTTON_VARIANTS[variant],
        className,
      )}
      {...props}
    />
  );
}

export function Stepper({
  label,
  value,
  onChange,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  step?: number;
}) {
  const buttonClass =
    "size-11 cursor-pointer rounded-md border border-wp-border bg-wp-surface text-lg font-semibold text-wp-text";
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold text-wp-text-2">{label}</span>
      <div className="flex items-center gap-2">
        <button type="button" aria-label="Decrease" className={buttonClass} onClick={() => onChange(value - step)}>
          −
        </button>
        <span className="min-w-12 text-center text-[15px] font-bold tabular-nums">{value}</span>
        <button type="button" aria-label="Increase" className={buttonClass} onClick={() => onChange(value + step)}>
          +
        </button>
      </div>
    </div>
  );
}

/** Pill-shaped toggle used for filter chips and presets. */
export function Chip({
  active,
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { active: boolean }) {
  return (
    <button
      type={type}
      aria-pressed={active}
      className={cn(
        "h-8 cursor-pointer rounded-full border px-3 text-xs font-semibold",
        active ? "border-wp-action bg-wp-action text-wp-on-action" : "border-wp-border bg-wp-surface text-wp-text",
        className,
      )}
      {...props}
    />
  );
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn("h-8 rounded-md border border-wp-border bg-wp-surface px-2 text-xs text-wp-text", className)}
      {...props}
    />
  );
}
