"use client";

import { LogOut } from "lucide-react";
import { useLocalSession } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

/** Local sign-in: who is signed in, and a sign-out button (clears the httpOnly session cookie). */
export function LocalSignOut({ showName = true, className }: { showName?: boolean; className?: string }) {
  const { name } = useLocalSession();
  return (
    <form action="/auth/logout" method="post" className={cn("flex items-center gap-2", className)}>
      {showName && name && <span className="text-[12px] font-semibold text-wp-text">{name}</span>}
      <button
        type="submit"
        aria-label="Sign out"
        title="Sign out"
        className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-wp-border bg-wp-surface px-2.5 text-[12px] font-semibold text-wp-text-2 hover:bg-wp-surface-2"
      >
        <LogOut className="size-3.5" aria-hidden />
        Sign out
      </button>
    </form>
  );
}
