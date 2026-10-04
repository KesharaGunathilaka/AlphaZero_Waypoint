"use client";

import { UserButton } from "@clerk/nextjs";
import { LocalSignOut } from "@/components/auth/local-sign-out";
import { AUTH_MODE } from "@/lib/auth-mode";

/**
 * Who is signed in, and sign out. Sits inside each app's own header or menu, so it never covers
 * the screen the way a floating badge did (the driver's bottom buttons, the loader's confirm button).
 */
export function AccountButton({ showName = false, className }: { showName?: boolean; className?: string }) {
  if (AUTH_MODE === "local") return <LocalSignOut showName={showName} className={className} />;
  return (
    <span className={className}>
      <UserButton />
    </span>
  );
}
