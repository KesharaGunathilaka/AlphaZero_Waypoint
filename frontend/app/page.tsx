import { redirect } from "next/navigation";
import { getUserContext } from "@/lib/auth";
import { ROLE_HOME } from "@/lib/roles";

/**
 * The role router. Nobody picks a role any more: whoever signs in is sent to the
 * app their Clerk organization role entitles them to.
 */
export default async function Home() {
  const context = await getUserContext();

  if (!context.ok) {
    if (context.reason === "no-org") redirect("/select-org");
    if (context.reason === "signed-out") redirect("/sign-in");
    redirect("/no-access");
  }

  redirect(ROLE_HOME[context.role]);
}
