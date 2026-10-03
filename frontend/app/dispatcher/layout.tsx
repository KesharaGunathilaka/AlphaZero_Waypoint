import { requireRole } from "@/lib/auth";
import { SessionBadge } from "@/components/waypoint/session-badge";

/** Signed-out users are sent to sign-in; a wrong role is sent to its own app. */
export default async function Layout({ children }: LayoutProps<"/dispatcher">) {
  const { isAdmin } = await requireRole("org:dispatcher");

  return (
    <>
      {children}
      <SessionBadge role="org:dispatcher" isAdmin={isAdmin} />
    </>
  );
}
