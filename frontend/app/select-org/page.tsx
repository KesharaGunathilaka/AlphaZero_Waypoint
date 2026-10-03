import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { OrganizationList } from "@clerk/nextjs";
import { Logo } from "@/components/waypoint/logo";

export const metadata: Metadata = {
  title: "Choose depot · Waypoint",
};

/**
 * Clerk roles only exist inside an organization, so a session with no active
 * organization has no role. Users land here until they pick one; "/" then
 * forwards them to their role's app.
 */
export default async function SelectOrgPage() {
  const { userId, orgId } = await auth();

  if (!userId) redirect("/sign-in");
  if (orgId) redirect("/");

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-wp-canvas p-6 text-wp-text">
      <h1>
        <Logo className="h-12" />
      </h1>
      <p className="text-[13px] text-wp-text-2">Choose your depot to continue.</p>
      <OrganizationList hidePersonal afterSelectOrganizationUrl="/" afterCreateOrganizationUrl="/" />
    </main>
  );
}
