import Image from "next/image";
import { cn } from "@/lib/utils";

const SOURCES = {
  default: "/waypoint-logo.png",
  // Knocked out to --wp-text for dark surfaces, e.g. the loader's dock tablet.
  light: "/waypoint-logo-light.png",
} as const;

/** Intrinsic size of the artwork in `public/`. */
const WIDTH = 348;
const HEIGHT = 209;

/**
 * The Waypoint wordmark, used anywhere the product name is shown as branding.
 * Set the height with `className`; the width follows the artwork's ratio.
 */
export function Logo({
  variant = "default",
  className,
  priority = true,
}: {
  variant?: keyof typeof SOURCES;
  className?: string;
  priority?: boolean;
}) {
  return (
    <Image
      src={SOURCES[variant]}
      alt="Waypoint"
      width={WIDTH}
      height={HEIGHT}
      priority={priority}
      className={cn("h-7 w-auto", className)}
    />
  );
}
