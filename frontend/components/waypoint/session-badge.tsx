import { UserButton } from "@clerk/nextjs";
import { LocalSignOut } from "@/components/auth/local-sign-out";
import { AUTH_MODE } from "@/lib/auth-mode";
import { ROLE_LABEL, type UserRole } from "@/lib/roles";

/**
 * Floating "who am I / sign out" control.
 *
 * Rendered by each role layout rather than inside the role apps, so switching an
 * account's role in Clerk is all it takes to land in a different app.
 */
export function SessionBadge({ role, isAdmin }: { role: UserRole; isAdmin: boolean }) {
  return (
    <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-full border border-wp-border bg-wp-surface px-3 py-1.5 shadow-sm">
      <span className="text-[11px] font-semibold tracking-[.06em] text-wp-muted">
        {isAdmin ? `ADMIN · ${ROLE_LABEL[role].toUpperCase()}` : ROLE_LABEL[role].toUpperCase()}
      </span>
      {AUTH_MODE === "local" ? <LocalSignOut showName={false} /> : <UserButton />}
    </div>
  );
}
