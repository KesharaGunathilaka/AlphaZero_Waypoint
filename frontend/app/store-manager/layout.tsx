import { requireRole } from "@/lib/auth";
import { SessionBadge } from "@/components/waypoint/session-badge";

/** Signed-out users are sent to sign-in; a wrong role is sent to its own app. */
export default async function Layout({ children }: LayoutProps<"/store-manager">) {
  const { isAdmin } = await requireRole("org:store_manager");

  return (
    <>
      {children}
      <SessionBadge role="org:store_manager" isAdmin={isAdmin} />
    </>
  );
}
