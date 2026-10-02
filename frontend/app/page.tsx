import { redirect } from "next/navigation";
import { getUserContext } from "@/lib/auth";

const ROLE_ROUTES = {
  "org:dispatcher": "/dispatcher",
  "org:driver": "/driver",
  "org:loader": "/loader",
  "org:store-manager": "/store-manager",
} as const;

export default async function HomePage() {
  const context = await getUserContext();

  if (!context.ok) {
    redirect("/sign-in");
  }

  redirect(ROLE_ROUTES[context.role]);
}
